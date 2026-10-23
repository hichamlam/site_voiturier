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
import { supabase, getContactPhone, isRealEmail } from './_lib.js';
import { confirmFromSession } from './_confirm.js';
import {
  signManageToken, verifyManageToken, magicToken, publicView, rulesFor,
  normalizeReference, identifierMatches, quoteChanges, applyChanges, loadBooking,
  optionCatalog, ChangeError, ConflictError, compactChanges, notifyModification, applyPaidModification,
} from './_manage.js';

const SESSION_TTL = 2 * 3600 * 1000; // connexion par référence + nom : 2 h
const CONFIRM_LINK_TTL = 7 * 86400000; // lien de retour Stripe : 7 jours

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
/* Verrou persistant par référence (toutes instances confondues) : 10 échecs / h.
   Stocké dans la table settings, déjà utilisée en clé/valeur — aucune migration. */
const REF_MAX_FAILS = 10, REF_WINDOW = 3600 * 1000;
async function refLocked(ref) {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', `loginfail:${ref}`).maybeSingle();
    const v = data?.value ? JSON.parse(data.value) : null;
    return !!v && v.n >= REF_MAX_FAILS && Date.now() - v.since < REF_WINDOW;
  } catch { return false; }
}
async function refFail(ref) {
  try {
    const key = `loginfail:${ref}`;
    const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
    let v = data?.value ? JSON.parse(data.value) : null;
    if (!v || Date.now() - v.since >= REF_WINDOW) v = { n: 0, since: Date.now() };
    v.n += 1;
    await supabase.from('settings').upsert({ key, value: JSON.stringify(v) }, { onConflict: 'key' });
  } catch (e) { console.error('[reservation] refFail', e.message); }
}
async function refReset(ref) {
  try { await supabase.from('settings').delete().eq('key', `loginfail:${ref}`); } catch {}
}
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
    // Le lien de retour Stripe reste dans l'historique du navigateur : il ne
    // donne accès à la réservation que 7 jours, ensuite → connexion classique.
    if (b.created_at && Date.now() - new Date(b.created_at).getTime() > CONFIRM_LINK_TTL) {
      return res.status(401).json({ error: 'Ce lien a expiré. Connectez-vous avec votre référence et votre nom.' });
    }
    if (b.payment_status !== 'paid') {
      // Le webhook peut arriver quelques secondes après le retour du client :
      // on interroge Stripe directement pour ne pas l'inquiéter pour rien.
      const stripe = stripeClient();
      if (stripe) {
        try {
          const s = await stripe.checkout.sessions.retrieve(sessionId);
          paidNow = s.payment_status === 'paid' && s.metadata?.booking_id === b.id;
          // Filet de sécurité : si Stripe dit « payé », on ENREGISTRE la
          // confirmation et on envoie les e-mails (sans doublon si le webhook
          // passe en même temps). Avant, on se contentait de l'afficher : si le
          // webhook était en panne, la résa restait « pending » pour toujours.
          if (paidNow) await confirmFromSession(s, { source: 'retour client' });
        } catch (e) { console.error('[reservation] stripe retrieve/confirm', e.message); }
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

  if (await refLocked(reference)) {
    return res.status(429).json({ error: 'Trop d’essais sur cette référence. Réessayez dans une heure ou appelez-nous.' });
  }
  const { data: b } = await supabase.from('bookings').select('*').eq('reference', reference).maybeSingle();
  if (!b || b.status === 'pending') return notFound();
  if (!identifierMatches(b, identifier)) { await refFail(reference); return notFound(); }
  await refReset(reference);

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
      ...(isRealEmail(b.customer_email) ? { customer_email: b.customer_email } : {}),
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

  // Gratuit, ou paiement sur place : on applique tout de suite
  // (une relecture si la réservation a bougé entre-temps).
  let updated;
  try { updated = await applyChanges(b, q, { source: 'espace client' }); }
  catch (err) {
    if (!(err instanceof ConflictError)) throw err;
    const fresh = await loadBooking(b.id);
    const q2 = await quoteChanges(fresh, req.body?.changes);
    if (q2.toPay !== q.toPay || q2.payOnline) throw err;
    updated = await applyChanges(fresh, q2, { source: 'espace client' });
  }
  await notifyModification(updated, q, { paidOnline: false });
  return res.status(200).json({ applied: true, toPay: q.toPay, booking: await fullView(updated) });
}

async function modstatus(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const b = await authed(req, res); if (!b) return;
  const sessionId = String(req.query.session_id || '');
  if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return res.status(400).json({ error: 'Lien invalide.' });
  const noteLine = String(b.internal_notes || '').split('\n').find((l) => l.includes(sessionId));
  if (noteLine && noteLine.includes('NON appliquée')) return res.status(200).json({ applied: false, paid: true, refunded: true });
  let applied = !!noteLine;
  let paid = applied;
  if (!applied) {
    const stripe = stripeClient();
    if (stripe) {
      try {
        const s = await stripe.checkout.sessions.retrieve(sessionId);
        if (s.metadata?.mod_booking_id !== b.id) return res.status(404).json({ error: 'Paiement introuvable.' });
        paid = s.payment_status === 'paid';
        // Webhook en retard : on applique nous-mêmes (idempotent, verrouillé).
        if (paid) {
          const r = await applyPaidModification(s, stripe);
          if (r === 'applied' || r === 'duplicate') applied = true;
          if (r === 'refunded') return res.status(200).json({ applied: false, paid: true, refunded: true });
        }
      } catch (e) { console.error('[reservation] modstatus', e.message); /* on répond « en cours » */ }
    }
  }
  return res.status(200).json({ applied, paid });
}

