/**
 * Helpers communs pour les API : Supabase, auth admin, calcul de prix v2
 * v2 : intègre catégories véhicule, suppléments horaires, jours fériés, options
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';

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

// ─── Utils horaire ───
function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// Vérifie si une heure tombe dans un créneau (gère les créneaux qui passent minuit)
function isInTimeWindow(time, windowStart, windowEnd) {
  const t = timeToMinutes(time);
  const s = timeToMinutes(windowStart);
  const e = timeToMinutes(windowEnd);
  if (s <= e) {
    return t >= s && t < e;
  } else {
    // Créneau qui passe minuit (ex. 22:00 → 03:30)
    return t >= s || t < e;
  }
}

// ─── Calcul de prix v2 ───
export async function calculatePrice(input) {
  const {
    depDate, depTime, retDate, retTime,
    carCategoryCode = 'citadine',
    washType = 'none',
    hasCoveredParking = false,
    hasPriorityAccess = false,
    promoCode = null,
    customerEmail = null,
  } = input;

  const detail = []; // détail pour affichage facture

  // 1. Durée
  const d1 = new Date(depDate);
  const d2 = new Date(retDate);
  // Comptage par date calendaire inclusive (ex: 2 au 5 septembre = 4 jours), pas par tranche de 24h.
  const days = Math.max(1, Math.round((d2 - d1) / 86400000) + 1);

  // 2. Tarif de base depuis la grille
  const { data: rule } = await supabase
    .from('pricing_rules')
    .select('price_eur, days_min, days_max, extra_per_day_eur')
    .lte('days_min', days)
    .gte('days_max', days)
    .order('days_min', { ascending: false })
    .limit(1)
    .maybeSingle();

  let basePrice;
  if (rule) {
    basePrice = Number(rule.price_eur);
    // Palier dégressif : au-delà de days_min, on ajoute extra_per_day_eur par jour.
    if (rule.extra_per_day_eur && days > rule.days_min) {
      basePrice += (days - rule.days_min) * Number(rule.extra_per_day_eur);
    }
  } else {
    // Aucun palier ne couvre `days` (séjour plus long que la grille, ou trou
    // dans la grille) : on se replie sur le dernier palier situé EN DESSOUS
    // de `days`, et on extrapole avec son extra_per_day_eur au-delà de SON
    // days_max, pour ne pas retomber sur un tarif plancher inférieur aux
    // paliers existants.
    const { data: lastRule } = await supabase
      .from('pricing_rules')
      .select('price_eur, days_max, extra_per_day_eur')
      .lt('days_max', days)
      .order('days_max', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastRule) {
      basePrice = Number(lastRule.price_eur);
      if (lastRule.extra_per_day_eur && days > lastRule.days_max) {
        basePrice += (days - lastRule.days_max) * Number(lastRule.extra_per_day_eur);
      }
    } else {
      // Grille totalement vide : dernier recours.
      basePrice = 29;
    }
  }
  basePrice = Math.round(basePrice * 100) / 100;
  detail.push({ kind: 'base', label: `Voiturier ${days} jour${days > 1 ? 's' : ''}`, amount: basePrice });

  // 3. Surcharge catégorie véhicule
  let vehicleSurcharge = 0;
  let washSurchargeFromCategory = 0;
  let categoryName = 'Citadine';

  const { data: category } = await supabase
    .from('vehicle_categories')
    .select('*')
    .eq('code', carCategoryCode)
    .eq('active', true)
    .maybeSingle();

  if (category) {
    vehicleSurcharge = Number(category.surcharge_eur || 0);
    washSurchargeFromCategory = Number(category.wash_surcharge_eur || 0);
    categoryName = category.name;
    if (vehicleSurcharge > 0) {
      detail.push({ kind: 'vehicle', label: `Catégorie ${category.name}`, amount: vehicleSurcharge });
    }
  }

  // 4. Tarifs spéciaux période
  const { data: specials } = await supabase
    .from('pricing_special')
    .select('*')
    .eq('active', true)
    .lte('date_start', depDate)
    .gte('date_end', depDate);

  if (specials && specials.length > 0) {
    for (const sp of specials) {
      const before = basePrice;
      basePrice = basePrice * Number(sp.multiplier || 1) + Number(sp.flat_extra || 0);
      const diff = Math.round((basePrice - before) * 100) / 100;
      if (diff > 0) {
        detail.push({ kind: 'special', label: `Période : ${sp.name}`, amount: diff });
      }
    }
  }

  // 5. Lavage
  const washPrices = { none: 0, exterieur: 29, interieur: 49, complet: 69, premium: 99 };
  const washPrice = washPrices[washType] || 0;
  let washSurcharge = 0;

  if (washPrice > 0) {
    detail.push({ kind: 'wash', label: `Lavage ${washType}`, amount: washPrice });
    // Supplément lavage selon catégorie (sauf extérieur seul)
    if (washType !== 'exterieur' && washSurchargeFromCategory > 0) {
      washSurcharge = washSurchargeFromCategory;
      detail.push({ kind: 'wash_surcharge', label: `Supplément lavage (${categoryName})`, amount: washSurcharge });
    }
  }

  // 6. Suppléments horaires (sur dep_time et ret_time)
  let timeSurcharges = 0;
  const { data: timeWindows } = await supabase
    .from('surcharges')
    .select('*')
    .eq('kind', 'time_window')
    .eq('active', true);

  if (timeWindows) {
    // Pour le DÉPART
    for (const w of timeWindows) {
      if (w.applies_to !== 'departure' && w.applies_to !== 'both') continue;
      if (isInTimeWindow(depTime, w.time_start, w.time_end)) {
        timeSurcharges += Number(w.amount_eur);
        detail.push({ kind: 'time_dep', label: `Horaire départ (${w.description || w.name})`, amount: Number(w.amount_eur) });
        break; // un seul créneau qui matche au départ
      }
    }
    // Pour le RETOUR
    for (const w of timeWindows) {
      if (w.applies_to !== 'return' && w.applies_to !== 'both') continue;
      if (isInTimeWindow(retTime, w.time_start, w.time_end)) {
        timeSurcharges += Number(w.amount_eur);
        detail.push({ kind: 'time_ret', label: `Horaire retour (${w.description || w.name})`, amount: Number(w.amount_eur) });
        break;
      }
    }
  }

  // 7. Jours fériés (départ ou retour)
  const { data: holidays } = await supabase
    .from('holidays')
    .select('*')
    .eq('active', true)
    .in('date', [depDate, retDate]);

  if (holidays && holidays.length > 0) {
    for (const h of holidays) {
      timeSurcharges += Number(h.surcharge_eur);
      const which = h.date === depDate ? 'départ' : 'retour';
      detail.push({ kind: 'holiday', label: `Jour férié ${which} (${h.name})`, amount: Number(h.surcharge_eur) });
    }
  }

  // 8. Options (parking couvert, accès prioritaire)
  let optionsTotal = 0;
  if (hasCoveredParking || hasPriorityAccess) {
    const { data: options } = await supabase
      .from('surcharges')
      .select('*')
      .eq('kind', 'option')
      .eq('active', true);

    if (options) {
      for (const opt of options) {
        if (opt.option_code === 'covered_parking' && hasCoveredParking) {
          optionsTotal += Number(opt.amount_eur);
          detail.push({ kind: 'option', label: opt.name, amount: Number(opt.amount_eur) });
        }
        if (opt.option_code === 'priority_access' && hasPriorityAccess) {
          optionsTotal += Number(opt.amount_eur);
          detail.push({ kind: 'option', label: opt.name, amount: Number(opt.amount_eur) });
        }
      }
    }
  }

  // 9. Sous-total avant promo
  let subtotal = basePrice + vehicleSurcharge + washPrice + washSurcharge + timeSurcharges + optionsTotal;
  subtotal = Math.round(subtotal * 100) / 100;

  // 10. Code promo
  let promoDiscount = 0;
  let promoApplied = null;
  let promoRejectedReason = null;

  if (promoCode) {
    const code = promoCode.trim().toUpperCase();
    const { data: promo } = await supabase
      .from('promo_codes')
      .select('*')
      .eq('code', code)
      .eq('active', true)
      .maybeSingle();

    if (promo) {
      const today = new Date().toISOString().slice(0, 10);
      const validFrom = !promo.valid_from || promo.valid_from <= today;
      const validUntil = !promo.valid_until || promo.valid_until >= today;
      const usesOk = !promo.max_uses || promo.uses_count < promo.max_uses;

      // Code réservé à une première réservation : au stade du devis/simulateur
      // (calculatePrice appelé sans customerEmail), on ne connaît pas encore le
      // client, donc on ne peut pas le disqualifier — on l'accepte par défaut.
      // Le contrôle réel a lieu à la réservation, où api/booking.js et
      // api/checkout.js transmettent bien customerEmail.
      let firstBookingOk = true;
      if (promo.first_booking_only && customerEmail) {
        // On ne compte que les réservations qui ont réellement eu lieu :
        // `pending` désigne un paiement Stripe jamais abouti (la ligne est
        // créée avant la redirection), et `cancelled` une réservation annulée.
        // Sans cette exclusion, un paiement abandonné brûlerait définitivement
        // le droit du client à son code de bienvenue, sans recours possible.
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
        if (promo.discount_type === 'percent') {
          promoDiscount = Math.round((subtotal * Number(promo.discount_val) / 100) * 100) / 100;
        } else {
          promoDiscount = Number(promo.discount_val);
        }
        promoDiscount = Math.min(promoDiscount, subtotal);
        promoApplied = code;
        detail.push({ kind: 'promo', label: `Code promo ${code}`, amount: -promoDiscount });
      } else if (!firstBookingOk) {
        promoRejectedReason = 'first_booking_only';
      } else {
        promoRejectedReason = 'invalid';
      }
    } else {
      promoRejectedReason = 'invalid';
    }
  }

  const total = Math.max(0, Math.round((subtotal - promoDiscount) * 100) / 100);

  return {
    days,
    basePrice,
    vehicleSurcharge,
    washPrice,
    washSurcharge,
    timeSurcharges,
    optionsTotal,
    promoCode: promoApplied,
    promoDiscount,
    promoRejectedReason,
    total,
    surchargesDetail: detail,
  };
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
  const { data: existing } = await supabase
    .from('clients').select('id')
    .eq('email', customer.email.toLowerCase()).maybeSingle();
  if (existing) {
    await supabase.from('clients').update({
      firstname: customer.firstname,
      lastname: customer.lastname,
      phone: customer.phone,
    }).eq('id', existing.id);
    return existing.id;
  }
  const { data: inserted } = await supabase.from('clients').insert({
    email: customer.email.toLowerCase(),
    firstname: customer.firstname,
    lastname: customer.lastname,
    phone: customer.phone,
  }).select('id').single();
  return inserted ? inserted.id : null;
}

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
