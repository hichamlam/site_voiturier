/**
 * Confirmation d'une réservation payée en ligne — partagée par :
 *   1. le webhook Stripe (voie normale)
 *   2. /api/verify-payment (retour du client sur le site après paiement)
 *   3. le cron quotidien (rattrapage)
 *
 * Pourquoi trois voies : le 23/10/2026 le webhook pointait sur
 * directvoiturier.com (sans www), Vercel répondait 308 vers www et Stripe ne
 * suit jamais les redirections. Le client était débité, la résa restait
 * « pending » et aucun e-mail ne partait. Les voies 2 et 3 ne dépendent pas du
 * webhook : elles interrogent Stripe directement.
 *
 * Anti-doublon : la bascule pending → paid est ATOMIQUE (UPDATE … WHERE
 * payment_status = 'pending'). Une seule des trois voies obtient la ligne et
 * envoie les e-mails, même si elles arrivent en même temps.
 */
import { Resend } from 'resend';
import { supabase, getNotificationEmail, getContactPhone } from './_lib.js';
import { clientEmailHTML, adminEmailHTML } from './_emails.js';

const FROM = () => process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';

/**
 * Confirme la réservation liée à une session Stripe Checkout si — et seulement
 * si — Stripe la déclare payée.
 * @returns {Promise<{confirmed: boolean, reason?: string, reference?: string}>}
 */
export async function confirmFromSession(session, { source = 'webhook' } = {}) {
  // Les paiements de MODIFICATION ont leur propre traitement (webhook.js).
  if (session?.metadata?.kind === 'modification') return { confirmed: false, reason: 'modification' };
  const bookingId = session?.metadata?.booking_id;
  if (!bookingId) return { confirmed: false, reason: 'no_booking_id' };

  // « completed » ne signifie pas « encaissé » : certains moyens de paiement
  // se dénouent de façon asynchrone. On ne confirme que sur paiement avéré.
  if (session.payment_status !== 'paid') {
    return { confirmed: false, reason: `not_paid:${session.payment_status}` };
  }

  // Bascule atomique : seule la première voie récupère la ligne.
  const { data: rows, error } = await supabase.from('bookings')
    .update({ status: 'confirmed', payment_status: 'paid' })
    .eq('id', bookingId)
    .eq('payment_status', 'pending')
    .select('*');
  if (error) throw new Error('[confirm] ' + error.message);

  const booking = rows && rows[0];
  if (!booking) return { confirmed: false, reason: 'already_paid_or_missing' };

  console.log('[confirm] %s confirmée (source : %s)', booking.reference, source);

  if (booking.promo_code) {
    const { data: pc } = await supabase.from('promo_codes').select('uses_count').eq('code', booking.promo_code).maybeSingle();
    if (pc) {
      await supabase.from('promo_codes').update({ uses_count: (pc.uses_count || 0) + 1 }).eq('code', booking.promo_code);
    }
  }

  await sendConfirmationEmails(booking);
  return { confirmed: true, reference: booking.reference };
}

async function sendConfirmationEmails(booking) {
  const resend = new Resend(process.env.RESEND_API_KEY);
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
  };

  try {
    await Promise.all([
      resend.emails.send({ from: FROM(), to: booking.customer_email, subject: `Confirmation — ${booking.reference}`, html: clientEmailHTML(ctx) }),
      resend.emails.send({ from: FROM(), to: ADMIN, subject: `💳 Paiement reçu — ${booking.reference}`, html: adminEmailHTML(ctx) }),
    ]);
  } catch (err) {
    console.error('[confirm] email:', err);
  }
}

/**
 * Alerte admin : une résa payée n'a PAS été confirmée par le webhook.
 * Le client est servi (rattrapage), mais le webhook est à réparer.
 */
export async function alertWebhookBroken(references, source) {
  if (!references.length) return;
  try {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const ADMIN = await getNotificationEmail();
    await resend.emails.send({
      from: FROM(),
      to: ADMIN,
      subject: `⚠️ Webhook Stripe en panne — ${references.length} résa rattrapée(s)`,
      html: `<p>Ces réservations étaient payées mais le webhook Stripe ne les avait pas confirmées :</p>
<ul>${references.map(r => `<li><b>${r}</b></li>`).join('')}</ul>
<p>Elles viennent d'être confirmées automatiquement (source : ${source}) et les e-mails sont partis.</p>
<p><b>À faire :</b> Stripe → Développeurs → Webhooks → vérifier que l'URL est
<code>https://www.directvoiturier.com/api/webhook</code> (avec <b>www</b>) et regarder les erreurs.</p>`,
    });
  } catch (err) {
    console.error('[confirm] alerte:', err);
  }
}

/**
 * Rattrapage : toutes les résas Stripe encore « pending » des derniers jours
 * sont vérifiées auprès de Stripe ; celles qui sont payées sont confirmées.
 */
export async function reconcilePendingPayments(stripe, { days = 7, source = 'cron' } = {}) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const { data: pending, error } = await supabase.from('bookings')
    .select('id, reference, stripe_session_id')
    .eq('payment_method', 'stripe')
    .eq('payment_status', 'pending')
    .not('stripe_session_id', 'is', null)
    .gte('created_at', since);
  if (error) throw new Error('[reconcile] ' + error.message);

  const rescued = [];
  for (const b of pending || []) {
    try {
      const session = await stripe.checkout.sessions.retrieve(b.stripe_session_id);
      const r = await confirmFromSession(session, { source });
      if (r.confirmed) rescued.push(r.reference);
    } catch (err) {
      console.error('[reconcile] %s :', b.reference, err.message);
    }
  }
  await alertWebhookBroken(rescued, source);
  return { checked: (pending || []).length, rescued };
}

/**
 * Santé du webhook : Stripe garde la trace des événements qu'il n'a pas réussi
 * à livrer. S'il y en a sur la période, on prévient l'admin — c'est exactement
 * le signal qui aurait révélé la panne du 22-23/10/2026.
 */
export async function checkWebhookHealth(stripe, { hours = 26 } = {}) {
  const gte = Math.floor((Date.now() - hours * 3600 * 1000) / 1000);
  const failed = await stripe.events.list({ delivery_success: false, created: { gte }, limit: 20 });
  const list = failed.data || [];
  if (list.length) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      const ADMIN = await getNotificationEmail();
      await resend.emails.send({
        from: FROM(),
        to: ADMIN,
        subject: `⚠️ Stripe n'arrive pas à joindre le site (${list.length} échec(s))`,
        html: `<p>Stripe a échoué à livrer ${list.length} événement(s) au webhook ces dernières ${hours} h :</p>
<ul>${list.map(e => `<li>${e.type} — ${new Date(e.created * 1000).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}</li>`).join('')}</ul>
<p>Les réservations payées sont rattrapées automatiquement, mais le webhook est à réparer :
Stripe → Développeurs → Webhooks → l'URL doit être <code>https://www.directvoiturier.com/api/webhook</code> (avec <b>www</b>).</p>`,
      });
    } catch (err) {
      console.error('[confirm] alerte santé:', err);
    }
  }
  return { failedDeliveries: list.length };
}
