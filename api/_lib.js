/**
 * Helpers communs pour les API : Supabase, auth admin, calcul de prix v2
 * v2 : intègre catégories véhicule, suppléments horaires, jours fériés, options
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { computePrice } from '../public/pricing-engine.js';

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

// ─── Auth admin (token signé HMAC, 24h) ───
const SECRET = process.env.ADMIN_SESSION_SECRET || 'dev-secret-change-me';

export function signToken(payload) {
  const data = { ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 };
  const body = Buffer.from(JSON.stringify(data)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expectedSig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

export function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  const session = verifyToken(token);
  if (!session || !session.admin) {
    res.status(401).json({ error: 'Unauthorized' });
    return null;
  }
  return session;
}

// ─── Calcul de prix v3 ───
// Le calcul lui-même vit dans public/pricing-engine.js (partagé avec le
// navigateur, qui affiche ainsi le tarif instantanément). Ici on ne fait que
// charger la grille depuis Supabase — en PARALLÈLE (avant : 6 à 9 requêtes
// enchaînées l'une après l'autre) — puis valider le code promo.
// Toute la grille publique en une seule vague de requêtes parallèles.
export async function loadPricingRef() {
  // Pas de filtre de date ici : le back-office peut recalculer une réservation
  // passée. /api/pricing-data élague ce qui est révolu avant de publier.
  const [rules, categories, specials, surcharges, holidays, blocked] = await Promise.all([
    supabase.from('pricing_rules').select('price_eur, days_min, days_max, extra_per_day_eur').order('days_min'),
    supabase.from('vehicle_categories').select('code, name, surcharge_eur, wash_surcharge_eur, active').eq('active', true),
    supabase.from('pricing_special').select('name, date_start, date_end, multiplier, flat_extra, active').eq('active', true).order('date_start'),
    supabase.from('surcharges').select('kind, name, description, amount_eur, time_start, time_end, applies_to, option_code, active, display_order').eq('active', true).in('kind', ['time_window', 'option']).order('display_order'),
    supabase.from('holidays').select('date, name, surcharge_eur, active').eq('active', true),
    supabase.from('blocked_dates').select('date_start, date_end, reason'),
  ]);
  const err = [rules, categories, specials, surcharges, holidays, blocked].find(r => r.error);
  if (err) throw new Error('Grille tarifaire illisible : ' + err.error.message);
  const sur = surcharges.data || [];
  return {
    rules: rules.data || [],
    categories: categories.data || [],
    specials: specials.data || [],
    timeWindows: sur.filter(s => s.kind === 'time_window'),
    options: sur.filter(s => s.kind === 'option'),
    holidays: holidays.data || [],
    blockedDates: blocked.data || [],
  };
}

// Cache court (instance serverless « chaude ») pour le devis public
// /api/pricing. La réservation et le paiement relisent TOUJOURS la base.
let refCache = null;
export async function getPricingRefCached(ttlMs = 30000) {
  if (refCache && Date.now() - refCache.at < ttlMs) return refCache.promise;
  const promise = loadPricingRef();
  refCache = { at: Date.now(), promise };
  promise.catch(() => { if (refCache && refCache.promise === promise) refCache = null; });
  return promise;
}

// Validation d'un code promo → { rule, rejectedReason }
async function resolvePromo(promoCode, customerEmail) {
  if (!promoCode) return null;
  const code = promoCode.trim().toUpperCase();
  const { data: promo } = await supabase
    .from('promo_codes')
    .select('*')
    .eq('code', code)
    .eq('active', true)
    .maybeSingle();
  if (!promo) return { rule: null, rejectedReason: 'invalid' };

  const today = new Date().toISOString().slice(0, 10);
  const validFrom = !promo.valid_from || promo.valid_from <= today;
  const validUntil = !promo.valid_until || promo.valid_until >= today;
  const usesOk = !promo.max_uses || promo.uses_count < promo.max_uses;

  // Code « première réservation » : au stade du devis (sans e-mail) on
  // l'accepte ; le contrôle réel a lieu à la réservation (booking/checkout
  // transmettent customerEmail). On ne compte que les réservations réellement
  // passées : `pending` = paiement Stripe jamais abouti, `cancelled` = annulée.
  let firstBookingOk = true;
  if (promo.first_booking_only && customerEmail) {
    const { data: existingBooking } = await supabase
      .from('bookings')
      .select('id')
      .eq('customer_email', customerEmail.trim().toLowerCase())
      .not('status', 'in', '(pending,cancelled)')
      .limit(1)
      .maybeSingle();
    firstBookingOk = !existingBooking;
  }

  if (validFrom && validUntil && usesOk && firstBookingOk) {
    return { rule: { code, discount_type: promo.discount_type, discount_val: Number(promo.discount_val) }, rejectedReason: null };
  }
  return { rule: null, rejectedReason: firstBookingOk ? 'invalid' : 'first_booking_only' };
}

/**
 * calculatePrice(input, { cached })
 * cached:true uniquement pour le devis public (/api/pricing). Par défaut la
 * grille est relue en base : réservation, paiement et back-office restent
 * exacts à la seconde près.
 * Renvoie en plus `promoRule` (code validé) pour que le navigateur puisse
 * recalculer la remise localement sans redemander au serveur.
 */
export async function calculatePrice(input, { cached = false } = {}) {
  const [ref, promo] = await Promise.all([
    cached ? getPricingRefCached() : loadPricingRef(),
    resolvePromo(input.promoCode, input.customerEmail),
  ]);
  const price = computePrice(input, ref, promo);
  price.promoRule = promo ? promo.rule : null;
  return price;
}

// ─── Véhicules refusés (marque + modèle) ───
export async function checkVehicleAllowed(brand, model) {
  const b = (brand || '').trim();
  const m = (model || '').trim();
  if (!b || !m) return { allowed: true };
  const { data } = await supabase
    .from('blocked_vehicles')
    .select('reason')
    .ilike('brand', b)
    .ilike('model', m)
    .maybeSingle();
  if (!data) return { allowed: true };
  return { allowed: false, reason: data.reason || `Désolé, nous n'acceptons pas les ${b} ${m}.` };
}

export async function checkDatesAvailable(depDate, retDate) {
  const { data } = await supabase
    .from('blocked_dates')
    .select('date_start, date_end, reason')
    .or(`and(date_start.lte.${retDate},date_end.gte.${depDate})`);
  return { available: !data || data.length === 0, blocks: data || [] };
}

export async function upsertClient(customer) {
  // Email facultatif (réservation saisie à la main) : on retrouve le client par
  // téléphone, sinon on lui fabrique une adresse interne unique (jamais utilisée
  // pour écrire au client, voir isRealEmail).
  const digits = String(customer.phone || '').replace(/\D/g, '');
  let email = String(customer.email || '').trim().toLowerCase();
  if (!email) {
    if (digits) {
      const { data: byPhone } = await supabase.from('clients').select('id').eq('phone', customer.phone).limit(1).maybeSingle();
      if (byPhone) return byPhone.id;
    }
    email = `sans-email-${digits || Date.now()}@sans-email.invalid`;
  }
  const { data: existing } = await supabase
    .from('clients').select('id')
    .eq('email', email).maybeSingle();
  if (existing) {
    await supabase.from('clients').update({
      firstname: customer.firstname,
      lastname: customer.lastname,
      phone: customer.phone,
    }).eq('id', existing.id);
    return existing.id;
  }
  const { data: inserted } = await supabase.from('clients').insert({
    email,
    firstname: customer.firstname,
    lastname: customer.lastname,
    phone: customer.phone,
  }).select('id').single();
  return inserted ? inserted.id : null;
}

export const isRealEmail = e => !!e && !/@sans-email\.invalid$/i.test(e);

// ─── Calcul des pénalités de retard ───
export function calculateLateFee(scheduledTime, actualTime) {
  if (!scheduledTime || !actualTime) return { lateMinutes: 0, fee: 0 };
  const sched = timeToMinutes(scheduledTime);
  const actual = timeToMinutes(actualTime);
  let lateMinutes = actual - sched;
  if (lateMinutes < 0) lateMinutes += 24 * 60; // après minuit
  if (lateMinutes <= 30) return { lateMinutes, fee: 0 };
  if (lateMinutes <= 60) return { lateMinutes, fee: 10 };
  // Au-delà : 10€ pour la 1ère heure puis 15€/h
  const extraHours = Math.ceil((lateMinutes - 60) / 60);
  return { lateMinutes, fee: 10 + extraHours * 15 };
}

// Téléphone affiché dans les mails clients (réglage admin « Téléphone service client »).
export async function getContactPhone() {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'contact_phone').maybeSingle();
    return (data?.value || '').trim();
  } catch {}
  return '';
}

// Adresse qui reçoit les notifications de réservation : réglage admin
// (settings.notification_email) > variable ADMIN_EMAIL > contact@.
export async function getNotificationEmail() {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', 'notification_email').maybeSingle();
    const v = (data?.value || '').trim();
    if (v) return v;
  } catch {}
  return process.env.ADMIN_EMAIL || 'contact@directvoiturier.com';
}
