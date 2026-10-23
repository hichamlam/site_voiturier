/**
 * Moteur de calcul du tarif — SOURCE UNIQUE, partagée navigateur / serveur.
 *
 *  - Navigateur : chargé par script.js (import dynamique) avec la grille
 *    publique /api/pricing-data → tarif calculé instantanément, sans aller-retour.
 *  - Serveur    : api/_lib.js (calculatePrice) l'importe avec la grille lue en
 *    base → c'est ce calcul qui fait foi pour le paiement et la réservation.
 *
 * Fonctions pures, aucune dépendance, aucun accès réseau.
 *
 * ref = {
 *   rules:        pricing_rules        (price_eur, days_min, days_max, extra_per_day_eur)
 *   categories:   vehicle_categories   actives
 *   specials:     pricing_special      actifs
 *   timeWindows:  surcharges kind=time_window actifs
 *   options:      surcharges kind=option actifs
 *   holidays:     holidays actifs
 *   blockedDates: blocked_dates
 * }
 */

export const WASH_PRICES = { none: 0, exterieur: 29, interieur: 49, complet: 69, premium: 99 };

const r2 = n => Math.round(n * 100) / 100;

function timeToMinutes(t) {
  if (!t) return 0;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + m;
}

// Créneau horaire, y compris ceux qui passent minuit (ex. 22:00 → 03:30)
export function isInTimeWindow(time, windowStart, windowEnd) {
  const t = timeToMinutes(time);
  const s = timeToMinutes(windowStart);
  const e = timeToMinutes(windowEnd);
  return s <= e ? (t >= s && t < e) : (t >= s || t < e);
}

// Comptage par date calendaire inclusive (ex : 2 au 5 septembre = 4 jours)
export function countDays(depDate, retDate) {
  return Math.max(1, Math.round((new Date(retDate) - new Date(depDate)) / 86400000) + 1);
}

// Même règle que checkDatesAvailable (api/_lib.js) : chevauchement de période
export function findBlocks(depDate, retDate, blockedDates = []) {
  return blockedDates.filter(b => b.date_start <= retDate && b.date_end >= depDate);
}

/**
 * promo (optionnel) = {
 *   rule: { code, discount_type, discount_val } | null   — code DÉJÀ validé
 *   rejectedReason: 'invalid' | 'first_booking_only' | null
 * }
 */
export function computePrice(input, ref, promo = null) {
  const {
    depDate, depTime, retDate, retTime,
    carCategoryCode = 'citadine',
    washType = 'none',
    hasCoveredParking = false,
    hasPriorityAccess = false,
  } = input;

  const detail = [];

  // 1. Durée
  const days = countDays(depDate, retDate);

  // 2. Tarif de base (grille dégressive)
  const rules = ref.rules || [];
  const rule = rules
    .filter(r => Number(r.days_min) <= days && Number(r.days_max) >= days)
    .sort((a, b) => Number(b.days_min) - Number(a.days_min))[0];

  let basePrice;
  if (rule) {
    basePrice = Number(rule.price_eur);
    if (rule.extra_per_day_eur && days > Number(rule.days_min)) {
      basePrice += (days - Number(rule.days_min)) * Number(rule.extra_per_day_eur);
    }
  } else {
    // Séjour plus long que la grille (ou trou) : dernier palier en dessous,
    // extrapolé au-delà de son days_max.
    const lastRule = rules
      .filter(r => Number(r.days_max) < days)
      .sort((a, b) => Number(b.days_max) - Number(a.days_max))[0];
    if (lastRule) {
      basePrice = Number(lastRule.price_eur);
      if (lastRule.extra_per_day_eur && days > Number(lastRule.days_max)) {
        basePrice += (days - Number(lastRule.days_max)) * Number(lastRule.extra_per_day_eur);
      }
    } else {
      basePrice = 29; // grille vide : dernier recours
    }
  }
  basePrice = r2(basePrice);
  detail.push({ kind: 'base', label: `Voiturier ${days} jour${days > 1 ? 's' : ''}`, amount: basePrice });

  // 3. Catégorie véhicule
  let vehicleSurcharge = 0;
  let washSurchargeFromCategory = 0;
  let categoryName = 'Citadine';
  const category = (ref.categories || []).find(c => c.code === carCategoryCode && c.active !== false);
  if (category) {
    vehicleSurcharge = Number(category.surcharge_eur || 0);
    washSurchargeFromCategory = Number(category.wash_surcharge_eur || 0);
    categoryName = category.name;
    if (vehicleSurcharge > 0) {
      detail.push({ kind: 'vehicle', label: `Catégorie ${category.name}`, amount: vehicleSurcharge });
    }
  }

  // 4. Tarifs spéciaux période (sur la date de départ)
  for (const sp of (ref.specials || [])) {
    if (sp.active === false || !(sp.date_start <= depDate && sp.date_end >= depDate)) continue;
    const before = basePrice;
    basePrice = basePrice * Number(sp.multiplier || 1) + Number(sp.flat_extra || 0);
    const diff = r2(basePrice - before);
    if (diff > 0) detail.push({ kind: 'special', label: `Période : ${sp.name}`, amount: diff });
  }

  // 5. Lavage
  const washPrice = WASH_PRICES[washType] || 0;
  let washSurcharge = 0;
  if (washPrice > 0) {
    detail.push({ kind: 'wash', label: `Lavage ${washType}`, amount: washPrice });
    if (washType !== 'exterieur' && washSurchargeFromCategory > 0) {
      washSurcharge = washSurchargeFromCategory;
      detail.push({ kind: 'wash_surcharge', label: `Supplément lavage (${categoryName})`, amount: washSurcharge });
    }
  }

  // 6. Suppléments horaires (un seul créneau au départ, un seul au retour)
  let timeSurcharges = 0;
  const windows = (ref.timeWindows || []).filter(w => w.active !== false);
  const dep = windows.find(w => (w.applies_to === 'departure' || w.applies_to === 'both') && isInTimeWindow(depTime, w.time_start, w.time_end));
  if (dep) {
    timeSurcharges += Number(dep.amount_eur);
    detail.push({ kind: 'time_dep', label: `Horaire départ (${dep.description || dep.name})`, amount: Number(dep.amount_eur) });
  }
  const ret = windows.find(w => (w.applies_to === 'return' || w.applies_to === 'both') && isInTimeWindow(retTime, w.time_start, w.time_end));
  if (ret) {
    timeSurcharges += Number(ret.amount_eur);
    detail.push({ kind: 'time_ret', label: `Horaire retour (${ret.description || ret.name})`, amount: Number(ret.amount_eur) });
  }

  // 7. Jours fériés (départ ou retour)
  for (const h of (ref.holidays || [])) {
    if (h.active === false || (h.date !== depDate && h.date !== retDate)) continue;
    timeSurcharges += Number(h.surcharge_eur);
    const which = h.date === depDate ? 'départ' : 'retour';
    detail.push({ kind: 'holiday', label: `Jour férié ${which} (${h.name})`, amount: Number(h.surcharge_eur) });
  }

  // 8. Options
  let optionsTotal = 0;
  for (const opt of (ref.options || [])) {
    if (opt.active === false) continue;
    if ((opt.option_code === 'covered_parking' && hasCoveredParking) ||
        (opt.option_code === 'priority_access' && hasPriorityAccess)) {
      optionsTotal += Number(opt.amount_eur);
      detail.push({ kind: 'option', label: opt.name, amount: Number(opt.amount_eur) });
    }
  }

  // 9. Sous-total
  const subtotal = r2(basePrice + vehicleSurcharge + washPrice + washSurcharge + timeSurcharges + optionsTotal);

  // 10. Code promo (déjà validé par le serveur)
  let promoDiscount = 0;
  let promoApplied = null;
  const promoRule = promo && promo.rule;
  if (promoRule) {
    promoDiscount = promoRule.discount_type === 'percent'
      ? r2(subtotal * Number(promoRule.discount_val) / 100)
      : Number(promoRule.discount_val);
    promoDiscount = Math.min(promoDiscount, subtotal);
    promoApplied = promoRule.code;
    detail.push({ kind: 'promo', label: `Code promo ${promoRule.code}`, amount: -promoDiscount });
  }

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
    promoRejectedReason: promoRule ? null : ((promo && promo.rejectedReason) || null),
    total: Math.max(0, r2(subtotal - promoDiscount)),
    surchargesDetail: detail,
  };
}
