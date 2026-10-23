/**
 * Webhook Stripe — checkout.session.completed
 */
import Stripe from 'stripe';
import { Resend } from 'resend';
import { supabase, getNotificationEmail, getContactPhone } from './_lib.js';
import { clientEmailHTML, adminEmailHTML } from './_emails.js';
import { loadBooking, quoteChanges, applyChanges, notifyModification, manageUrl } from './_manage.js';


export const config = { api: { bodyParser: false } };

/**
 * Corps brut de la requête, octet pour octet.
 *
 * ⚠️ Ne pas remplacer par `for await (const chunk of req)`. Ce projet n'est PAS
 * Next.js : le runtime `@vercel/node` n'honore pas `config.api.bodyParser`, il
 * parse le corps et épuise le flux AVANT d'appeler ce handler. L'itérateur
 * asynchrone renvoie alors 0 octet et `constructEvent` échoue systématiquement
 * en 400 — le client est débité mais la réservation n'est jamais confirmée.
 * Vercel surcharge en revanche `req.on`, qui rejoue le corps bufferisé.
 *
 * Re-sérialiser `req.body` ne marcherait pas davantage : Stripe envoie du JSON
 * indenté, et `JSON.stringify` ne reproduit pas ces octets — donc pas la signature.
 */
function buffer(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Les clients sont créés ici (et non au chargement du module) : sans clés
  // Stripe, la fonction répond proprement 503 au lieu de planter.
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Stripe non configuré' });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  const resend = new Resend(process.env.RESEND_API_KEY);

  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(
      buf,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[webhook]', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Paiement d'une MODIFICATION faite dans « Gérer ma réservation ».
  // Traité avant le bloc suivant, qui ignorerait l'événement (réservation déjà payée).
  if (event.type === 'checkout.session.completed' && event.data.object.metadata?.kind === 'modification') {
    await handleModificationPaid(event.data.object);
    return res.status(200).json({ received: true });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;
    if (!bookingId) return res.status(200).json({ received: true });

    // « completed » ne signifie pas « encaissé » : certains moyens de paiement
    // se dénouent de façon asynchrone. On ne confirme que sur paiement avéré.
    if (session.payment_status !== 'paid') {
      return res.status(200).json({ received: true, ignored: session.payment_status });
    }

    const { data: booking } = await supabase.from('bookings').select('*').eq('id', bookingId).single();
    if (!booking) return res.status(200).json({ received: true });

    // Stripe rejoue le webhook tant qu'il n'a pas obtenu un 2xx (timeout, 5xx…).
    // Sans ce garde-fou, chaque rejeu réincrémente `uses_count` du code promo
    // et renvoie une deuxième fois les deux e-mails au client.
    if (booking.payment_status === 'paid') {
      console.log('[webhook] %s déjà encaissée — rejeu ignoré', booking.reference);
      return res.status(200).json({ received: true, duplicate: true });
    }

    await supabase.from('bookings').update({
      status: 'confirmed', payment_status: 'paid',
    }).eq('id', bookingId);

    if (booking.promo_code) {
      const { data: pc } = await supabase.from('promo_codes').select('uses_count').eq('code', booking.promo_code).maybeSingle();
      if (pc) {
        await supabase.from('promo_codes').update({ uses_count: (pc.uses_count || 0) + 1 }).eq('code', booking.promo_code);
      }
    }

    const FROM = process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';
    const ADMIN = await getNotificationEmail();
    const ctx = {
      reference: booking.reference,
      total: Number(booking.total_price),
      customer: {
        firstname: booking.customer_firstname,
        lastname: booking.customer_lastname,
        email: booking.customer_email,
        phone: booking.customer_phone,
        flight: booking.customer_flight,
      },
      car: {
        brand: booking.car_brand, model: booking.car_model,
        color: booking.car_color, plate: booking.car_plate,
        categoryCode: booking.car_category_code,
      },
      dep: { date: booking.departure_date, time: booking.departure_time, terminal: booking.departure_terminal },
      ret: { date: booking.return_date, time: booking.return_time, terminal: booking.return_terminal },
      wash: { type: booking.wash_type, price: Number(booking.wash_price || 0) },
      options: { coveredParking: booking.has_covered_parking, priorityAccess: booking.has_priority_access },
      surchargesDetail: booking.surcharges_detail || [],
      paymentMode: 'en ligne',
      contactPhone: await getContactPhone(),
      manageUrl: manageUrl(booking),
    };

    try {
      await Promise.all([
        resend.emails.send({ from: FROM, to: booking.customer_email, subject: `Confirmation — ${booking.reference}`, html: clientEmailHTML(ctx) }),
        resend.emails.send({ from: FROM, to: ADMIN, subject: `💳 Paiement reçu — ${booking.reference}`, html: adminEmailHTML(ctx) }),
      ]);
    } catch (err) {
      console.error('[webhook] email:', err);
    }
  }

  // Panier abandonné : la ligne a été créée en « pending » avant la redirection
  // vers Stripe. Sans ça elle encombrerait le back-office indéfiniment et
  // gonflerait le compteur de réservations du client.
  if (event.type === 'checkout.session.expired') {
    const bookingId = event.data.object.metadata?.booking_id;
    if (bookingId) {
      await supabase.from('bookings')
        .update({ status: 'cancelled' })
        .eq('id', bookingId)
        .eq('payment_status', 'pending');
    }
  }

  return res.status(200).json({ received: true });
}

/**
 * Supplément d'une modification payé : on rejoue la validation sur la
 * réservation actuelle (sans re-contrôler le délai de 24 h, déjà vérifié au
 * moment du paiement) puis on enregistre. Idempotent : l'id de session Stripe
 * est inscrit dans internal_notes, un rejeu du webhook ne double rien.
 */
async function handleModificationPaid(session) {
  if (session.payment_status !== 'paid') return;
  const b = await loadBooking(session.metadata?.mod_booking_id);
  if (!b) { console.error('[webhook] modif : réservation introuvable', session.id); return; }
  if (String(b.internal_notes || '').includes(session.id)) {
    console.log('[webhook] modif %s déjà appliquée — rejeu ignoré', session.id);
    return;
  }
  const paid = Math.round(Number(session.amount_total || 0)) / 100;
  let changes = {};
  try { changes = JSON.parse(session.metadata?.changes || '{}'); } catch {}

  let q;
  try {
    // « now » = création de la session : le délai de 24 h était respecté à ce moment-là.
    q = await quoteChanges(b, changes, (session.created || 0) * 1000 || Date.now());
  } catch (err) {
    // Cas très rare (dates bloquées entre-temps…) : le client a payé, on ne
    // perd rien — on note le paiement et on prévient l'admin pour qu'il traite.
    console.error('[webhook] modif non applicable', session.id, err.message);
    const line = `[${new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}] ⚠️ Modification payée ${paid} € (Stripe ${session.id}) NON appliquée automatiquement (${err.message}). Demande : ${JSON.stringify(changes)}`;
    await supabase.from('bookings').update({ internal_notes: [b.internal_notes, line].filter(Boolean).join('\n') }).eq('id', b.id);
    await notifyModification(b, { summary: [`⚠️ À traiter à la main : ${err.message}`, `Demande : ${JSON.stringify(changes)}`], toPay: paid }, { paidOnline: true, adminOnly: true });
    return;
  }
  // On facture ce que le client a réellement payé (montant validé au devis).
  if (paid > 0 && Math.abs(paid - q.toPay) > 0.009) {
    q = { ...q, toPay: paid, extra: Math.round((paid - q.fee) * 100) / 100 };
  }
  const updated = await applyChanges(b, q, { source: 'espace client, payé en ligne', stripeSessionId: session.id });
  await notifyModification(updated, q, { paidOnline: true });
}
