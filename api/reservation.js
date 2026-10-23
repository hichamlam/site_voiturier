/**
 * /api/reservation — espace client « Gérer ma réservation » + page de confirmation
 *
 *   GET  ?action=confirmation&session_id=cs_…   récap après paiement Stripe
 *   GET  ?action=confirmation&t=<jeton>          récap (paiement sur place, lien email)
 *   POST ?action=login     { reference, identifier }   → { token }
 *   GET  ?action=view                                   (Authorization: Bearer <jeton>)
 *   POST ?action=quote     { changes }                  → devis de la modification
 *   POST ?action=modify    { changes }                  → applique ou renvoie l'URL Stripe
 *   GET  ?action=modstatus&session_id=cs_…              → modification payée appliquée ?
 *
 * Une seule fonction serverless pour tout l'espace client (limite du plan Vercel).
 */
import Stripe from 'stripe';
import { supabase, getContactPhone } from './_lib.js';
import {
  signManageToken, verifyManageToken, magicToken, publicView, rulesFor,
  normalizeReference, identifierMatches, quoteChanges, applyChanges, loadBooking,
  optionCatalog, ChangeError, compactChanges, notifyModification,
} from './_manage.js';

const SESSION_TTL = 2 * 3600 * 1000; // connexion par référence + nom : 2 h

/* Anti-force brute (par instance) : 8 essais ratés / 15 min / IP */
const attempts = new Map();
function tooMany(ip) {
  const now = Date.now();
  const list = (attempts.get(ip) || []).filter((t) => now - t < 15 * 60 * 1000);
  attempts.set(ip, list);
  if (attempts.size > 5000) attempts.clear();
  return list.length >= 8;
}
const fail = (ip) => attempts.set(ip, [...(attempts.get(ip) || []), Date.now()]);
const clientIp = (req) => String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'x';

function stripeClient() {
  return process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' }) : null;
}

async function authed(req, res) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : (req.query.t || '');
  const data = verifyManageToken(token);
  if (!data) { res.status(401).json({ error: 'Session expirée : reconnectez-vous avec votre référence.' }); return null; }
  const b = await loadBooking(data.b);
  if (!b || b.status === 'pending') { res.status(404).json({ error: 'Réservation introuvable.' }); return null; }
  return b;
}

async function fullView(b) {
  const [catalog, contactPhone] = await Promise.all([optionCatalog(), getContactPhone()]);
  return publicView(b, { rules: rulesFor(b), catalog, contactPhone });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const action = String(req.query.action || '');
  try {
    switch (action) {
      case 'confirmation': return await confirmation(req, res);
      case 'login': return await login(req, res);
      case 'view': {
        if (req.method !== 'GET') return res.status(405).end();
        const b = await authed(req, res); if (!b) return;
        return res.status(200).json(await fullView(b));
      }
      case 'quote': {
        if (req.method !== 'POST') return res.status(405).end();
        const b = await authed(req, res); if (!b) return;
        const q = await quoteChanges(b, req.body?.changes);
        return res.status(200).json({
          summary: q.summary, priceDiff: q.priceDiff, extra: q.extra, fee: q.fee, toPay: q.toPay,
          currentTotal: q.currentTotal, newTotal: q.newTotal, payOnline: q.payOnline,
        });
      }
      case 'modify': return await modify(req, res);
      case 'modstatus': return await modstatus(req, res);
      default: return res.status(404).json({ error: 'Action inconnue' });
    }
  } catch (err) {
    if (err instanceof ChangeError) return res.status(err.status).json({ error: err.message });
    console.error('[reservation]', action, err);
    return res.status(500).json({ error: 'Une erreur est survenue. Réessayez ou appelez-nous.' });
  }
}

/* ─── Page de confirmation ─────────────────────────────────────────────── */
async function confirmation(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const sessionId = String(req.query.session_id || '');
  let b = null;
  let paidNow = false;

  if (sessionId) {
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: 'Lien invalide.' });
    const { data } = await supabase.from('bookings').select('*').eq('stripe_session_id', sessionId).maybeSingle();
    b = data;
    if (!b) return res.status(404).json({ error: 'Réservation introuvable.' });
    if (b.payment_status !== 'paid') {
      // Le webhook peut arriver quelques secondes après le retour du client :
      // on interroge Stripe directement pour ne pas l'inquiéter pour rien.
      const stripe = stripeClient();
      if (stripe) {
        try {
          const s = await stripe.checkout.sessions.retrieve(sessionId);
          paidNow = s.payment_status === 'paid' && s.metadata?.booking_id === b.id;
        } catch (e) { console.error('[reservation] stripe retrieve', e.message); }
      }
      if (!paidNow) return res.status(200).json({ state: 'processing', reference: b.reference });
    }
  } else {
    const data = verifyManageToken(String(req.query.t || ''));
    if (!data) return res.status(401).json({ error: 'Lien expiré.' });
    b = await loadBooking(data.b);
    if (!b || b.status === 'pending') return res.status(404).json({ error: 'Réservation introuvable.' });
  }

  const view = publicView(b, { contactPhone: await getContactPhone() });
  if (paidNow) { view.paymentStatus = 'paid'; view.status = 'confirmed'; view.statusLabel = 'Confirmée'; }
  return res.status(200).json({ state: 'ok', booking: view, token: magicToken(b) });
}

/* ─── Connexion référence + nom ────────────────────────────────────────── */
async function login(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const ip = clientIp(req);
  if (tooMany(ip)) return res.status(429).json({ error: 'Trop d’essais. Patientez 15 minutes ou appelez-nous.' });

  const reference = normalizeReference(req.body?.reference);
  const identifier = String(req.body?.identifier || '').slice(0, 120);
  const notFound = () => { fail(ip); return res.status(404).json({ error: 'Aucune réservation ne correspond. Vérifiez la référence (dans votre email) et le nom.' }); };
  if (!reference || !identifier) return notFound();

  const { data: b } = await supabase.from('bookings').select('*').eq('reference', reference).maybeSingle();
  if (!b || b.status === 'pending' || !identifierMatches(b, identifier)) return notFound();

  return res.status(200).json({ token: signManageToken(b.id, SESSION_TTL) });
}

/* ─── Modification ─────────────────────────────────────────────────────── */
async function modify(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  const b = await authed(req, res); if (!b) return;
  const q = await quoteChanges(b, req.body?.changes);

  // Le client a validé un montant : s'il a changé entre-temps (grille modifiée),
  // on le lui redemande plutôt que de facturer autre chose.
  const accepted = req.body?.expectedToPay;
  if (accepted !== undefined && Number(accepted) !== q.toPay) {
    return res.status(409).json({ error: 'Le montant a changé, merci de vérifier le nouveau récapitulatif.', toPay: q.toPay });
  }

  if (q.payOnline) {
    const stripe = stripeClient();
    if (!stripe) return res.status(503).json({ error: 'Paiement en ligne indisponible : appelez-nous pour cette modification.' });
    const site = (process.env.SITE_URL || 'https://www.directvoiturier.com').replace(/\/$/, '');
    const token = magicToken(b);
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: b.customer_email,
      line_items: [
        { price_data: { currency: 'eur', unit_amount: Math.round(q.extra * 100), product_data: { name: `Modification ${b.reference} — supplément`, description: q.summary.join(' · ').slice(0, 500) } }, quantity: 1 },
        { price_data: { currency: 'eur', unit_amount: Math.round(q.fee * 100), product_data: { name: 'Frais de modification' } }, quantity: 1 },
      ],
      // ⚠️ Pas de clé `booking_id` ici : le webhook « session expirée » annule
      // les réservations qui en portent une (paniers abandonnés).
      metadata: {
        kind: 'modification',
        mod_booking_id: b.id,
        reference: b.reference,
        changes: JSON.stringify(compactChanges(req.body?.changes)).slice(0, 500),
        to_pay: String(q.toPay),
      },
      success_url: `${site}/gerer-ma-reservation?modif={CHECKOUT_SESSION_ID}&t=${encodeURIComponent(token)}`,
      cancel_url: `${site}/gerer-ma-reservation?t=${encodeURIComponent(token)}`,
      locale: 'fr',
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
    });
    return res.status(200).json({ url: session.url, toPay: q.toPay });
  }

  // Gratuit, ou paiement sur place : on applique tout de suite.
  const updated = await applyChanges(b, q, { source: 'espace client' });
  await notifyModification(updated, q, { paidOnline: false });
  return res.status(200).json({ applied: true, toPay: q.toPay, booking: await fullView(updated) });
}

async function modstatus(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const b = await authed(req, res); if (!b) return;
  const sessionId = String(req.query.session_id || '');
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: 'Lien invalide.' });
  const applied = String(b.internal_notes || '').includes(sessionId);
  let paid = applied;
  if (!applied) {
    const stripe = stripeClient();
    if (stripe) {
      try {
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        if (s.metadata?.mod_booking_id !== b.id) return res.status(404).json({ error: 'Paiement introuvable.' });
        paid = s.payment_status === 'paid';
      } catch { /* on répond « en cours » */ }
    }
  }
  return res.status(200).json({ applied, paid });
}

