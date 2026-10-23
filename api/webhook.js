/**
 * Webhook Stripe — checkout.session.completed
 */
import Stripe from 'stripe';
import { supabase } from './_lib.js';
import { confirmFromSession } from './_confirm.js';
import { applyPaidModification } from './_manage.js';


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
    await applyPaidModification(event.data.object, stripe);
    return res.status(200).json({ received: true });
  }

  if (event.type === 'checkout.session.completed') {
    // Bascule atomique + e-mails : voir _confirm.js (partagé avec le retour
    // client et le cron de rattrapage — aucun doublon possible).
    try {
      const r = await confirmFromSession(event.data.object, { source: 'webhook' });
      if (!r.confirmed) console.log('[webhook] non confirmée :', r.reason);
    } catch (err) {
      console.error('[webhook]', err.message);
      return res.status(500).json({ error: 'confirm failed' }); // Stripe rejouera
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
