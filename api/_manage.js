/**
 * Espace client « Gérer ma réservation » — logique partagée
 * (utilisée par api/reservation.js et api/webhook.js).
 *
 * Aucune table supplémentaire : l'accès se fait par jeton signé (HMAC),
 * les modifications payantes voyagent dans les métadonnées Stripe et sont
 * appliquées par le webhook, l'historique va dans bookings.internal_notes.
 *
 * Règles métier (décidées par le propriétaire) :
 *   • nouvelle config PLUS chère → le client paie la différence + 20 € de frais
 *   • nouvelle config MOINS chère (ou égale) → aucun remboursement, prix inchangé
 *   • modifications impossibles à moins de 24 h du rendez-vous concerné
 *   • pas d'annulation en libre-service (CGV : réservation ferme et définitive)
 */
import crypto from 'crypto';
import { Resend } from 'resend';
import { supabase, calculatePrice, checkDatesAvailable, getNotificationEmail, isRealEmail } from './_lib.js';
import { WASH_PRICES } from '../public/pricing-engine.js';
import { modificationEmailHTML } from './_emails.js';

export const MODIFICATION_FEE = 20;           // € ajoutés dès qu'une modification coûte plus cher
export const MIN_HOURS_BEFORE = 24;           // délai mini avant le rendez-vous concerné
export const TERMINALS = ['', 'Orly 1-2', 'Orly 3', 'Orly 4'];
export const WASH_ORDER = ['none', 'exterieur', 'interieur', 'complet', 'premium'];
export const WASH_LABELS = { none: 'Aucun lavage', exterieur: 'Lavage extérieur', interieur: 'Lavage intérieur', complet: 'Lavage complet', premium: 'Lavage premium' };
const ACTIVE = ['confirmed', 'taken', 'in_storage'];

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;

/* ─── Jetons d'accès (distincts des jetons admin) ─────────────────────── */
function key() {
  const base = process.env.ADMIN_SESSION_SECRET || 'dev-secret-change-me';
  return crypto.createHmac('sha256', base).update('dv-manage-booking-v1').digest();
}

export function signManageToken(bookingId, ttlMs) {
  const body = Buffer.from(JSON.stringify({ k: 'm', b: bookingId, exp: Date.now() + ttlMs })).toString('base64url');
  const sig = crypto.createHmac('sha256', key()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyManageToken(token) {
  if (!token || typeof token !== 'string' || token.length > 600) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', key()).update(body).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (data.k !== 'm' || !data.b || !(data.exp > Date.now())) return null;
    return data;
  } catch { return null; }
}

/** Lien envoyé par email : valable jusqu'à 30 jours après le retour. */
export function magicToken(booking) {
  const ret = parisToDate(booking.return_date, '23:59');
  const ttl = Math.max(ret.getTime() + 30 * 86400000 - Date.now(), 7 * 86400000);
  return signManageToken(booking.id, ttl);
}

export function manageUrl(booking) {
  const site = (process.env.SITE_URL || 'https://www.directvoiturier.com').replace(/\/$/, '');
  return `${site}/gerer-ma-reservation?t=${encodeURIComponent(magicToken(booking))}`;
}

/* ─── Heure de Paris ──────────────────────────────────────────────────── */
const hhmm = (t) => String(t || '00:00').slice(0, 5);

function parisOffsetMs(ts) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ts)).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return asUtc - ts;
}

/** « 2026-11-02 » + « 06:30 » (heure de Paris) → Date */
export function parisToDate(date, time) {
  const [y, m, d] = String(date).split('-').map(Number);
  const [hh, mm] = hhmm(time).split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  return new Date(guess - parisOffsetMs(guess));
}

const hoursUntil = (date, time, now = Date.now()) => (parisToDate(date, time).getTime() - now) / 3600000;

/* ─── Ce que le client a le droit de faire ────────────────────────────── */
export function rulesFor(b, now = Date.now()) {
  const active = ACTIVE.includes(b.status);
  const depOk = b.status === 'confirmed' && hoursUntil(b.departure_date, b.departure_time, now) >= MIN_HOURS_BEFORE;
  const retOk = active && hoursUntil(b.return_date, b.return_time, now) >= MIN_HOURS_BEFORE;
  const notOver = active && hoursUntil(b.return_date, b.return_time, now) > 0;
  const blockedPay = ['refunded', 'failed'].includes(b.payment_status);
  let reason = '';
  if (blockedPay) reason = 'Cette réservation a été remboursée ou son paiement a échoué : appelez-nous.';
  else if (b.status === 'cancelled') reason = 'Cette réservation est annulée.';
  else if (b.status === 'returned') reason = 'Cette réservation est terminée : votre véhicule vous a été restitué.';
  else if (!retOk) reason = `Votre retour est dans moins de ${MIN_HOURS_BEFORE} h : pour tout changement, appelez-nous.`;
  else if (!depOk && b.status === 'confirmed') reason = `Votre prise en charge est dans moins de ${MIN_HOURS_BEFORE} h : l'aller ne peut plus être modifié en ligne, appelez-nous.`;
  if (blockedPay) return { departure: false, return: false, options: false, contact: false, reason };
  return {
    departure: depOk,          // date/heure/terminal aller
    return: retOk,             // date/heure retour
    options: retOk,            // ajout de lavage / options
    contact: notOver,          // téléphone, n° de vol (sans impact prix)
    reason,
  };
}

/* ─── Vue « client » d'une réservation (rien d'interne) ───────────────── */
export const STATUS_LABELS = {
  pending: 'Paiement en attente', confirmed: 'Confirmée', taken: 'Véhicule pris en charge',
  in_storage: 'Véhicule stationné', returned: 'Véhicule restitué', cancelled: 'Annulée',
};

export function publicView(b, extras = {}) {
  return {
    reference: b.reference,
    status: b.status,
    statusLabel: STATUS_LABELS[b.status] || b.status,
    paymentMethod: b.payment_method === 'stripe' ? 'stripe' : 'onsite',
    paymentStatus: b.payment_status,
    customer: {
      firstname: b.customer_firstname, lastname: b.customer_lastname,
      email: b.customer_email, phone: b.customer_phone, flight: b.customer_flight || '',
    },
    dep: { date: b.departure_date, time: hhmm(b.departure_time), terminal: b.departure_terminal || '' },
    ret: { date: b.return_date, time: hhmm(b.return_time), terminal: b.return_terminal || '' },
    car: {
      brand: b.car_brand, model: b.car_model, color: b.car_color || '', plate: b.car_plate,
      categoryCode: b.car_category_code || 'citadine',
    },
    wash: { type: b.wash_type || 'none', label: WASH_LABELS[b.wash_type || 'none'] || '—' },
    options: { coveredParking: !!b.has_covered_parking, priorityAccess: !!b.has_priority_access },
    detail: Array.isArray(b.surcharges_detail) ? b.surcharges_detail : [],
    total: r2(b.total_price),
    ...extras,
  };
}

/* ─── Recherche par référence ─────────────────────────────────────────── */
export function normalizeReference(input) {
  let r = String(input || '').toUpperCase().replace(/^\s*R[ÉE]F\s*[-—:]*\s*/, '').replace(/[^A-Z0-9-]/g, '');
  if (!r) return '';
  if (/^VO[A-Z0-9]+$/.test(r) && !r.startsWith('VO-')) r = 'VO-' + r.slice(2);
  if (!r.includes('-')) r = 'VO-' + r;
  return r.slice(0, 40);
}

export const normalizeName = (s) => String(s || '')
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]/g, '');

/** Le 2e facteur : nom de famille OU email utilisé pour la réservation. */
export function identifierMatches(b, identifier) {
  const id = String(identifier || '').trim();
  if (!id) return false;
  if (id.includes('@')) return id.toLowerCase() === String(b.customer_email || '').toLowerCase();
  const n = normalizeName(id);
  if (n.length < 2) return false;
  return n === normalizeName(b.customer_lastname) ||
    // nom absent à la réservation : on tolère « prénom nom » ou le prénom seul
    (!normalizeName(b.customer_lastname) && n === normalizeName(b.customer_firstname)) ||
    n === normalizeName(`${b.customer_firstname || ''}${b.customer_lastname || ''}`);
}

/* ─── Modifications ───────────────────────────────────────────────────── */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ChangeError extends Error {
  constructor(msg, status = 400) { super(msg); this.status = status; }
}

/**
 * Valide les changements demandés et renvoie la liste normalisée :
 * { fields: {colonne: valeur}, summary: [texte lisible], pricing: bool }
 */
export function validateChanges(b, input, now = Date.now()) {
  if (!input || typeof input !== 'object') throw new ChangeError('Aucune modification reçue.');
  const rules = rulesFor(b, now);
  const fields = {};
  const summary = [];
  let pricing = false;
  const cur = publicView(b);

  const want = (k) => Object.prototype.hasOwnProperty.call(input, k) && input[k] !== undefined && input[k] !== null;
  const fmt = (d) => d ? d.split('-').reverse().join('/') : '';

  // Aller
  const depDate = want('depDate') ? String(input.depDate) : cur.dep.date;
  const depTime = want('depTime') ? String(input.depTime).slice(0, 5) : cur.dep.time;
  const depTerminal = want('depTerminal') ? String(input.depTerminal) : cur.dep.terminal;
  if (depDate !== cur.dep.date || depTime !== cur.dep.time || depTerminal !== cur.dep.terminal) {
    if (!rules.departure) throw new ChangeError(rules.reason || "L'aller ne peut plus être modifié en ligne.", 409);
    if (!DATE_RE.test(depDate) || !TIME_RE.test(depTime)) throw new ChangeError("Date ou heure d'aller invalide.");
    if (!TERMINALS.includes(depTerminal)) throw new ChangeError('Terminal invalide.');
    if (hoursUntil(depDate, depTime, now) < MIN_HOURS_BEFORE) {
      throw new ChangeError(`La nouvelle prise en charge doit être au moins ${MIN_HOURS_BEFORE} h à l'avance.`);
    }
    if (depDate !== cur.dep.date || depTime !== cur.dep.time) {
      fields.departure_date = depDate; fields.departure_time = depTime; pricing = true;
      summary.push(`Aller : ${fmt(cur.dep.date)} ${cur.dep.time} → ${fmt(depDate)} ${depTime}`);
    }
    if (depTerminal !== cur.dep.terminal) {
      fields.departure_terminal = depTerminal;
      summary.push(`Terminal aller : ${cur.dep.terminal || 'non précisé'} → ${depTerminal || 'non précisé'}`);
    }
  }

  // Retour
  const retDate = want('retDate') ? String(input.retDate) : cur.ret.date;
  const retTime = want('retTime') ? String(input.retTime).slice(0, 5) : cur.ret.time;
  if (retDate !== cur.ret.date || retTime !== cur.ret.time) {
    if (!rules.return) throw new ChangeError(rules.reason || 'Le retour ne peut plus être modifié en ligne.', 409);
    if (!DATE_RE.test(retDate) || !TIME_RE.test(retTime)) throw new ChangeError('Date ou heure de retour invalide.');
    if (hoursUntil(retDate, retTime, now) < MIN_HOURS_BEFORE) {
      throw new ChangeError(`Le nouveau retour doit être au moins ${MIN_HOURS_BEFORE} h à l'avance.`);
    }
    fields.return_date = retDate; fields.return_time = retTime; pricing = true;
    summary.push(`Retour : ${fmt(cur.ret.date)} ${cur.ret.time} → ${fmt(retDate)} ${retTime}`);
  }
  if (parisToDate(retDate, retTime) <= parisToDate(depDate, depTime)) {
    throw new ChangeError('Le retour doit être après la prise en charge.');
  }

  // Options : ajout uniquement (lavage seulement vers un lavage supérieur)
  if (want('washType') && input.washType !== cur.wash.type) {
    const w = String(input.washType);
    if (!WASH_ORDER.includes(w)) throw new ChangeError('Lavage inconnu.');
    if (!rules.options) throw new ChangeError(rules.reason || 'Les options ne peuvent plus être modifiées en ligne.', 409);
    if (WASH_ORDER.indexOf(w) < WASH_ORDER.indexOf(cur.wash.type)) {
      throw new ChangeError('Un lavage déjà réservé ne peut pas être réduit en ligne.');
    }
    fields.wash_type = w; pricing = true;
    summary.push(`Lavage : ${WASH_LABELS[cur.wash.type]} → ${WASH_LABELS[w]}`);
  }
  for (const [k, col, label] of [['coveredParking', 'has_covered_parking', 'Parking couvert'], ['priorityAccess', 'has_priority_access', 'Accès prioritaire']]) {
    if (want(k) && !!input[k] !== cur.options[k]) {
      if (!input[k]) throw new ChangeError(`L'option « ${label} » déjà réservée ne peut pas être retirée en ligne.`);
      if (!rules.options) throw new ChangeError(rules.reason || 'Les options ne peuvent plus être modifiées en ligne.', 409);
      fields[col] = true; pricing = true;
      summary.push(`Ajout : ${label}`);
    }
  }

  // Coordonnées (sans impact prix)
  if (want('flight') && String(input.flight).trim() !== cur.customer.flight) {
    const f = String(input.flight).trim().toUpperCase().replace(/\s+/g, ' ');
    if (f.length > 20) throw new ChangeError('Numéro de vol trop long.');
    if (!/^[A-Z0-9 .-]*$/.test(f)) throw new ChangeError('Numéro de vol invalide (lettres et chiffres uniquement).');
    if (!rules.contact) throw new ChangeError(rules.reason || 'Réservation non modifiable.', 409);
    fields.customer_flight = f;
    summary.push(`Vol retour : ${cur.customer.flight || 'non précisé'} → ${f || 'non précisé'}`);
  }
  if (want('phone') && String(input.phone).trim() !== String(cur.customer.phone || '').trim()) {
    const p = String(input.phone).trim();
    if (p.replace(/\D/g, '').length < 8 || p.length > 25 || !/^[+0-9 ().-]+$/.test(p)) throw new ChangeError('Téléphone invalide.');
    if (!rules.contact) throw new ChangeError(rules.reason || 'Réservation non modifiable.', 409);
    fields.customer_phone = p;
    summary.push(`Téléphone : ${cur.customer.phone} → ${p}`);
  }

  if (!summary.length) throw new ChangeError('Aucun changement par rapport à votre réservation.');
  return { fields, summary, pricing };
}

function priceInput(b, over = {}) {
  const v = { ...b, ...over };
  return {
    depDate: v.departure_date, depTime: hhmm(v.departure_time),
    retDate: v.return_date, retTime: hhmm(v.return_time),
    carCategoryCode: v.car_category_code || 'citadine',
    washType: v.wash_type || 'none',
    hasCoveredParking: !!v.has_covered_parking,
    hasPriorityAccess: !!v.has_priority_access,
    // Sans code promo des deux côtés : on compare deux prix calculés sur la
    // même base (grille du jour), ce qui neutralise remises et ajustements
    // manuels faits par l'admin sur le prix initial.
    promoCode: null, customerEmail: null,
  };
}

/**
 * Devis d'une modification : différence entre l'ancienne et la nouvelle
 * configuration (grille du jour pour les deux).
 */
export async function quoteChanges(b, input, now = Date.now()) {
  const v = validateChanges(b, input, now);
  let diff = 0, newCalc = null;
  if (v.pricing) {
    const merged = { ...b, ...v.fields };
    if (v.fields.departure_date || v.fields.return_date) {
      const avail = await checkDatesAvailable(merged.departure_date, merged.return_date);
      if (!avail.available) throw new ChangeError('Ces dates ne sont pas disponibles. Appelez-nous, on trouvera une solution.', 409);
    }
    const [oldCalc, nc] = await Promise.all([calculatePrice(priceInput(b)), calculatePrice(priceInput(merged))]);
    newCalc = nc;
    diff = r2(nc.total - oldCalc.total);
  }
  const extra = diff > 0 ? diff : 0;
  const fee = extra > 0 ? MODIFICATION_FEE : 0;
  const toPay = r2(extra + fee);
  return {
    changes: input,
    fields: v.fields,
    summary: v.summary,
    priceDiff: diff,           // peut être négatif : pas de remboursement
    extra, fee, toPay,
    currentTotal: r2(b.total_price),
    newTotal: r2(Number(b.total_price) + toPay),
    // Réservation déjà réglée (en ligne OU sur place, encaissée par l'admin) :
    // le supplément se paie en ligne, sinon il ne serait jamais encaissé.
    payOnline: toPay > 0 && b.payment_status === 'paid',
    newCalc,
  };
}

/** Écrit la modification en base (après paiement le cas échéant). */
export async function applyChanges(b, q, { source, stripeSessionId = null, now = new Date() }) {
  const stamp = now.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const day = now.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit' });
  const updates = { ...q.fields };

  if (q.newCalc) {
    if (q.fields.wash_type) updates.wash_price = q.newCalc.washPrice;
    if (q.fields.has_covered_parking || q.fields.has_priority_access) updates.options_total = q.newCalc.optionsTotal;
  }
  const detail = Array.isArray(b.surcharges_detail) ? [...b.surcharges_detail] : [];
  if (q.toPay > 0) {
    detail.push({ kind: 'modification', label: `Modification du ${day} (supplément)`, amount: q.extra });
    detail.push({ kind: 'modification_fee', label: 'Frais de modification', amount: q.fee });
    updates.surcharges_detail = detail;
    updates.total_price = r2(Number(b.total_price) + q.toPay);
  }

  const paid = q.toPay > 0
    ? (stripeSessionId ? ` · +${q.toPay} € payés en ligne (Stripe ${stripeSessionId})` : ` · +${q.toPay} € à régler sur place`)
    : ' · sans supplément';
  const line = `[${stamp}] Modifié par le client (${source})${paid} : ${q.summary.join(' ; ')}`;
  updates.internal_notes = [b.internal_notes, line].filter(Boolean).join('\n');

  // Verrou optimiste : si la ligne a bougé depuis la lecture (admin, autre
  // onglet, webhook concurrent), on n'écrase rien.
  let query = supabase.from('bookings').update(updates).eq('id', b.id);
  if (b.updated_at) query = query.eq('updated_at', b.updated_at);
  const { data, error } = await query.select().maybeSingle();
  if (error) throw error;
  if (!data) throw new ConflictError();

  // Nouvelle date d'aller : le rappel de la veille doit repartir pour la bonne date.
  if (q.fields.departure_date && q.fields.departure_date !== b.departure_date) {
    try { await supabase.from('settings').delete().eq('key', `autosent:${b.reference}:reminder_d1_email`); }
    catch (e) { console.error('[manage] reset rappel', e.message); }
  }
  return data;
}

export class ConflictError extends ChangeError {
  constructor() { super('Votre réservation vient d’être mise à jour. Rechargez la page et recommencez.', 409); this.conflict = true; }
}

/**
 * Modification payée sur Stripe → appliquée. Appelé par le webhook ET par la
 * page de retour (si le webhook tarde). Idempotent : l'id de session est
 * inscrit dans internal_notes ; verrou optimiste contre les appels simultanés.
 * Si la modification n'est plus applicable, le client est remboursé
 * automatiquement et l'admin prévenu. Renvoie 'applied' | 'duplicate' | 'refunded' | 'skipped'.
 */
export async function applyPaidModification(session, stripe) {
  if (session?.metadata?.kind !== 'modification' || session.payment_status !== 'paid') return 'skipped';
  const paid = Math.round(Number(session.amount_total || 0)) / 100;
  let changes = {};
  try { changes = JSON.parse(session.metadata?.changes || '{}'); } catch {}

  for (let attempt = 0; attempt < 4; attempt++) {
    const b = await loadBooking(session.metadata?.mod_booking_id);
    if (!b) { console.error('[manage] modif : réservation introuvable', session.id); return 'skipped'; }
    if (String(b.internal_notes || '').includes(session.id)) return 'duplicate';

    let q;
    try {
      // « now » = création de la session : le délai de 24 h était respecté à ce moment-là.
      q = await quoteChanges(b, changes, (session.created || 0) * 1000 || Date.now());
    } catch (err) {
      if (!(err instanceof ChangeError)) throw err;
      return refundUnapplicable(b, session, stripe, paid, changes, err.message);
    }
    // On facture ce que le client a réellement payé (montant validé au devis).
    if (paid > 0 && Math.abs(paid - q.toPay) > 0.009) {
      const fee = q.fee || MODIFICATION_FEE;
      q = { ...q, toPay: paid, fee, extra: r2(paid - fee) };
    }
    try {
      const updated = await applyChanges(b, q, { source: 'espace client, payé en ligne', stripeSessionId: session.id });
      await notifyModification(updated, q, { paidOnline: true });
      return 'applied';
    } catch (err) {
      if (err instanceof ConflictError) continue;   // relire et réessayer
      throw err;
    }
  }
  throw new Error('modification : conflit persistant ' + session.id);
}

async function refundUnapplicable(b, session, stripe, paid, changes, why) {
  const stamp = new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' });
  let refunded = false;
  if (stripe && session.payment_intent) {
    try {
      await stripe.refunds.create({ payment_intent: session.payment_intent }, { idempotencyKey: `dv-modif-refund-${session.id}` });
      refunded = true;
    } catch (e) { console.error('[manage] remboursement auto impossible', session.id, e.message); }
  }
  const line = `[${stamp}] ⚠️ Modification payée ${paid} € (Stripe ${session.id}) NON appliquée (${why}) — ${refunded ? 'client remboursé automatiquement' : 'REMBOURSEMENT À FAIRE À LA MAIN'}. Demande : ${JSON.stringify(changes)}`;
  // Écriture sans verrou : on ajoute seulement une ligne de note.
  const fresh = (await loadBooking(b.id)) || b;
  await supabase.from('bookings').update({ internal_notes: [fresh.internal_notes, line].filter(Boolean).join('\n') }).eq('id', b.id);

  if (process.env.RESEND_API_KEY) {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const FROM = process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';
    const ADMIN = await getNotificationEmail();
    const summary = [`Demande non appliquée : ${why}`];
    const sends = [
      resend.emails.send({ from: FROM, to: ADMIN, subject: `⚠️ Modif ${b.reference} non appliquée${refunded ? ' — remboursée' : ' — REMBOURSER'}`,
        html: modificationEmailHTML({ booking: fresh, summary: [...summary, `Demande : ${JSON.stringify(changes)}`], toPay: paid, paidOnline: true, forAdmin: true,
          heading: '⚠️ Modification non appliquée', moneyHtml: refunded ? `${paid}€ remboursés automatiquement au client.` : `<strong>${paid}€ à rembourser à la main</strong> (remboursement automatique impossible).` }) }),
    ];
    if (refunded && isRealEmail(b.customer_email)) {
      sends.push(resend.emails.send({ from: FROM, to: b.customer_email, subject: `Modification non effectuée — ${b.reference} (remboursée)`,
        html: modificationEmailHTML({ booking: fresh, summary, toPay: 0, paidOnline: true, manageUrl: manageUrl(fresh),
          heading: 'Modification non effectuée', moneyHtml: `Votre réservation est inchangée et vos <strong>${paid}€</strong> vous sont intégralement remboursés (sous 5 à 10 jours sur votre carte). Appelez-nous si besoin.` }) }));
    }
    (await Promise.allSettled(sends)).forEach((r) => { if (r.status === 'rejected') console.error('[manage] email remboursement', r.reason); });
  }
  return 'refunded';
}

export async function loadBooking(id) {
  const { data } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
  return data || null;
}

export async function optionCatalog() {
  const { data } = await supabase.from('surcharges').select('option_code, name, description, amount_eur')
    .eq('kind', 'option').eq('active', true).order('display_order');
  return {
    wash: WASH_ORDER.map((code) => ({ code, label: WASH_LABELS[code], price: WASH_PRICES[code] || 0 })),
    options: (data || []).filter((o) => ['covered_parking', 'priority_access'].includes(o.option_code))
      .map((o) => ({ code: o.option_code === 'covered_parking' ? 'coveredParking' : 'priorityAccess', label: o.name, description: o.description || '', price: Number(o.amount_eur) })),
    terminals: TERMINALS.filter(Boolean),
    fee: MODIFICATION_FEE,
    minHours: MIN_HOURS_BEFORE,
  };
}

/* Ne garde que les clés connues (et des valeurs courtes) pour les métadonnées Stripe. */
export function compactChanges(c = {}) {
  const keys = ['depDate', 'depTime', 'depTerminal', 'retDate', 'retTime', 'washType', 'coveredParking', 'priorityAccess', 'flight', 'phone'];
  const out = {};
  for (const k of keys) if (c[k] !== undefined && c[k] !== null) out[k] = typeof c[k] === 'boolean' ? c[k] : String(c[k]).slice(0, 30);
  return out;
}

export async function notifyModification(booking, q, { paidOnline, adminOnly = false }) {
  if (!process.env.RESEND_API_KEY) return;
  const resend = new Resend(process.env.RESEND_API_KEY);
  const FROM = process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';
  const ADMIN = await getNotificationEmail();
  const base = { booking, summary: q.summary, toPay: q.toPay, paidOnline };
  const results = await Promise.allSettled([
    !adminOnly && isRealEmail(booking.customer_email) && resend.emails.send({ from: FROM, to: booking.customer_email, subject: `Modification enregistrée — ${booking.reference}`, html: modificationEmailHTML({ ...base, manageUrl: manageUrl(booking) }) }),
    resend.emails.send({ from: FROM, to: ADMIN, subject: `✏️ Modif client ${booking.reference}${q.toPay > 0 ? ` (+${q.toPay}€)` : ''}`, html: modificationEmailHTML({ ...base, forAdmin: true }) }),
  ]);
  results.forEach((r) => {
    if (r.status === 'rejected') console.error('[reservation] email:', r.reason);
    else if (r.value?.error) console.error('[reservation] email:', r.value.error);
  });
}


/**
 * Rattrapage (cron) : modifications payées sur Stripe ces derniers jours mais
 * pas encore appliquées (webhook en panne ET client parti avant la page de
 * retour). Idempotent : une modif déjà appliquée est ignorée.
 */
export async function reconcileModifications(stripe, { days = 3 } = {}) {
  const gte = Math.floor((Date.now() - days * 86400000) / 1000);
  const applied = [], refunded = [];
  let checked = 0;
  for await (const s of stripe.checkout.sessions.list({ created: { gte }, status: 'complete', limit: 100 })) {
    if (s.metadata?.kind !== 'modification' || s.payment_status !== 'paid') continue;
    checked++;
    try {
      const r = await applyPaidModification(s, stripe);
      if (r === 'applied') applied.push(s.metadata.reference);
      if (r === 'refunded') refunded.push(s.metadata.reference);
    } catch (e) { console.error('[manage] rattrapage modif', s.id, e.message); }
  }
  return { modifChecked: checked, modifApplied: applied, modifRefunded: refunded };
}
