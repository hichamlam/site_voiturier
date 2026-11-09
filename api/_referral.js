/**
 * Parrainage client — sans nouvelle table (tout tient dans `settings`, clé/valeur).
 *
 *   referral:<CODE>        → email du parrain        (le code d'un client)
 *   referral_of:<email>    → <CODE>                   (pour le retrouver vite)
 *   promoowner:<CODE>      → email                    (code « merci » réservé à une personne)
 *   referral_referee_pct   → % offert au filleul      (0 = parrainage coupé)
 *   referral_referrer_pct  → % offert au parrain
 *
 * Règles :
 *   • le filleul doit être un NOUVEAU client (aucune réservation passée) et pas le parrain ;
 *   • le parrain gagne son code « merci » (usage unique, 1 an) quand la voiture du
 *     filleul lui est rendue : service réellement fait, pas de récompense sur une résa fantôme ;
 *   • un code « merci » ne marche que pour l'email du parrain.
 */
import crypto from 'crypto';
import { supabase, SESSION_SECRET, isRealEmail } from './_lib.js';

export const REFERRAL_DEFAULTS = { refereePct: 10, referrerPct: 10 };
const norm = (e) => String(e || '').trim().toLowerCase();
const CODE_RE = /^[A-Z0-9-]{4,20}$/;

async function getSetting(key) {
  const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

const pct = (v, d) => {
  if (v === null || v === undefined || String(v).trim() === '') return d; // jamais réglé : valeur par défaut
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? Math.max(0, Math.min(50, n)) : d;
};

export async function getReferralConfig() {
  try {
    const { data } = await supabase.from('settings').select('key, value').in('key', ['referral_referee_pct', 'referral_referrer_pct']);
    const m = Object.fromEntries((data || []).map((r) => [r.key, r.value]));
    return {
      refereePct: pct(m.referral_referee_pct, REFERRAL_DEFAULTS.refereePct),
      referrerPct: pct(m.referral_referrer_pct, REFERRAL_DEFAULTS.referrerPct),
    };
  } catch { return { ...REFERRAL_DEFAULTS }; }
}

/** A déjà une vraie réservation (pas un paiement abandonné ni une annulation) ? */
async function hasPastBooking(email) {
  const { data } = await supabase.from('bookings').select('id').eq('customer_email', norm(email))
    .not('status', 'in', '(pending,cancelled)').limit(1).maybeSingle();
  return !!data;
}

/** Le code de parrainage d'un client (créé à la première demande). */
export async function ensureReferralCode(email, firstname) {
  const e = norm(email);
  if (!e || !isRealEmail(e)) return null;
  const existing = await getSetting(`referral_of:${e}`);
  if (existing) return existing;
  const base = (String(firstname || '').normalize('NFD').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 6)) || 'DV';
  for (let i = 0; i < 8; i++) {
    const code = `${base}${crypto.randomInt(10, 100)}`;
    const [{ data: taken }, { data: promo }] = await Promise.all([
      supabase.from('settings').select('key').eq('key', `referral:${code}`).maybeSingle(),
      supabase.from('promo_codes').select('code').eq('code', code).maybeSingle(),
    ]);
    if (taken || promo) continue;
    const now = new Date().toISOString();
    // insert (pas upsert) sur referral:<CODE> : deux demandes simultanées ne peuvent pas prendre le même code.
    const { error } = await supabase.from('settings').insert({ key: `referral:${code}`, value: e, updated_at: now });
    if (error) continue;
    await supabase.from('settings').upsert({ key: `referral_of:${e}`, value: code, updated_at: now }, { onConflict: 'key' });
    return code;
  }
  return null;
}

/** Code tapé au paiement → règle de remise filleul, ou motif de refus, ou null (pas un code parrain). */
export async function resolveReferral(code, customerEmail) {
  if (!CODE_RE.test(code)) return null;
  const owner = await getSetting(`referral:${code}`);
  if (!owner) return null;
  const cfg = await getReferralConfig();
  if (cfg.refereePct <= 0) return { rule: null, rejectedReason: 'invalid' };
  if (customerEmail) {
    if (norm(customerEmail) === norm(owner)) return { rule: null, rejectedReason: 'own_referral' };
    if (await hasPastBooking(customerEmail)) return { rule: null, rejectedReason: 'first_booking_only' };
  }
  return { rule: { code, discount_type: 'percent', discount_val: cfg.refereePct }, rejectedReason: null };
}

/** Code « merci » réservé : refusé si un autre email l'utilise. */
export async function promoOwnerMismatch(code, customerEmail) {
  if (!customerEmail) return false;
  const owner = await getSetting(`promoowner:${code}`);
  return !!owner && norm(owner) !== norm(customerEmail);
}

const rewardCode = (bookingId) =>
  'MERCI-' + crypto.createHmac('sha256', SESSION_SECRET).update(`referral-reward:${bookingId}`).digest('hex').slice(0, 6).toUpperCase();

/**
 * Voiture du filleul rendue → le parrain reçoit son code « merci ».
 * Idempotent : le code dépend de la réservation, un 2e appel ne crée rien.
 */
export async function grantReferralReward(booking, { pushClient } = {}) {
  try {
    const code = String(booking?.promo_code || '').toUpperCase();
    if (!code || !CODE_RE.test(code)) return null;
    const referrer = await getSetting(`referral:${code}`);
    if (!referrer || norm(referrer) === norm(booking.customer_email)) return null;
    const cfg = await getReferralConfig();
    if (cfg.referrerPct <= 0) return null;
    const reward = rewardCode(booking.id);
    const until = new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10);
    const { error } = await supabase.from('promo_codes').insert({
      code: reward, discount_type: 'percent', discount_val: cfg.referrerPct, max_uses: 1, uses_count: 0,
      active: true, show_banner: false, first_booking_only: false, valid_until: until,
    });
    if (error) return null; // déjà créé (ou table indisponible) : rien de plus
    await supabase.from('settings').upsert({ key: `promoowner:${reward}`, value: norm(referrer), updated_at: new Date().toISOString() }, { onConflict: 'key' });
    if (pushClient) {
      await pushClient(referrer, {
        title: '🎁 Merci pour le parrainage !',
        body: `${booking.customer_firstname || 'Votre filleul'} a voyagé avec nous : −${cfg.referrerPct} % sur votre prochaine réservation (code ${reward}).`,
        data: { url: '/' },
      }).catch(() => {});
    }
    return reward;
  } catch (e) {
    console.error('[referral] récompense', e.message);
    return null;
  }
}

/** Ce que l'app montre au client : son code, les % et ses codes « merci » encore valables. */
export async function referralSummary(email, firstname) {
  const e = norm(email);
  const [code, cfg] = await Promise.all([ensureReferralCode(e, firstname), getReferralConfig()]);
  let rewards = [];
  try {
    const { data: owned } = await supabase.from('settings').select('key').like('key', 'promoowner:%').eq('value', e).limit(20);
    const codes = (owned || []).map((r) => r.key.slice('promoowner:'.length));
    if (codes.length) {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase.from('promo_codes').select('code, discount_val, uses_count, max_uses, valid_until, active').in('code', codes);
      rewards = (data || [])
        .filter((p) => p.active && (!p.max_uses || p.uses_count < p.max_uses) && (!p.valid_until || p.valid_until >= today))
        .map((p) => ({ code: p.code, pct: Number(p.discount_val), until: p.valid_until }));
    }
  } catch {}
  return { code, refereePct: cfg.refereePct, referrerPct: cfg.referrerPct, enabled: cfg.refereePct > 0, rewards };
}
