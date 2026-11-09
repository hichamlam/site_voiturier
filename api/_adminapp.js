/**
 * Espace admin de l'application (routes branchées dans api/app.js, Bearer admin).
 *
 *   GET  admin-board?from=AAAA-MM-JJ&to=AAAA-MM-JJ  → décollages, atterrissages, stock, espèces
 *   GET  admin-resa?id=                              → fiche complète (frais, retard, reçu)
 *   POST admin-step { id, step, … }                  → take | park | return | cash
 *   POST admin-fee  { id, label, amount } | { id, removeIndex }
 *
 * « take » = valider la prise en charge : signature du client, frais de retard
 * éventuels, statut « pris en charge » et création du reçu.
 */
import { grantReferralReward } from './_referral.js';
import { supabase, requireAdmin, getLateFeeConfig, lateFeeForMinutes } from './_lib.js';
import { pushClient, CLIENT_STATUS_PUSH } from './_push.js';
import { amountDue, cleanSignature, getCheckin, invoiceLines, saveCheckin } from './_invoice.js';

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const hhmm = (t) => String(t || '').slice(0, 5);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const parisToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
const parisNowMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date()).split(':').map(Number);
  return h * 60 + m;
};
const toMin = (t) => { const [h, m] = hhmm(t).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const minToTime = (n) => { const v = ((Math.round(n) % 1440) + 1440) % 1440; return `${String(Math.floor(v / 60)).padStart(2, '0')}:${String(v % 60).padStart(2, '0')}`; };
const onSite = (b) => ['cash', 'onsite'].includes(b.payment_method);
const name = (b) => `${b.customer_firstname || ''} ${b.customer_lastname || ''}`.trim();
const carLine = (b) => [b.car_brand, b.car_model, b.car_color].filter(Boolean).join(' ');

async function valetMap(rows) {
  const ids = [...new Set(rows.map((b) => b.valet_id).filter(Boolean))];
  if (!ids.length) return new Map();
  try {
    const { data } = await supabase.from('valets').select('id, name, phone').in('id', ids);
    return new Map((data || []).map((v) => [v.id, v]));
  } catch { return new Map(); }
}

const BOARD_COLS = 'id, reference, status, payment_method, payment_status, customer_firstname, customer_lastname, customer_phone, customer_flight, departure_date, departure_time, departure_terminal, return_date, return_time, return_terminal, car_brand, car_model, car_color, car_plate, parking_spot, total_price, late_dep_active, late_dep_fee, late_ret_active, late_ret_fee';

async function selectWithValet(build) {
  // valet_id vient d'une migration : si elle manque, on lit sans.
  const first = await build(`${BOARD_COLS}, valet_id`);
  if (!first.error) return first.data || [];
  const second = await build(BOARD_COLS);
  if (second.error) throw second.error;
  return second.data || [];
}

export async function adminBoard(req, res) {
  if (!requireAdmin(req, res)) return;
  const today = parisToday();
  const from = DATE_RE.test(String(req.query.from)) ? String(req.query.from) : today;
  const to = DATE_RE.test(String(req.query.to)) ? String(req.query.to) : from;
  if (to < from || Date.parse(to) - Date.parse(from) > 62 * 86400000) return res.status(400).json({ error: 'Période invalide (62 jours maximum)' });

  const [moving, stock] = await Promise.all([
    selectWithValet((cols) => supabase.from('bookings').select(cols)
      .not('status', 'in', '(cancelled,pending)')
      .or(`and(departure_date.gte.${from},departure_date.lte.${to}),and(return_date.gte.${from},return_date.lte.${to})`)
      .limit(1000)),
    selectWithValet((cols) => supabase.from('bookings').select(cols).in('status', ['taken', 'in_storage']).order('return_date').limit(500)),
  ]);
  const valets = await valetMap([...moving, ...stock]);
  const due = (b) => (onSite(b) && b.payment_status !== 'paid' ? amountDue(b) : 0);
  const base = (b) => ({
    id: b.id, reference: b.reference, status: b.status, name: name(b), phone: b.customer_phone || '',
    car: carLine(b), plate: b.car_plate || '', spot: b.parking_spot || '',
    valet: b.valet_id ? valets.get(b.valet_id) || null : null, paid: b.payment_status === 'paid',
  });

  const moves = [];
  for (const b of moving) {
    // Espèces : à la prise en charge si la voiture n'est pas encore prise, sinon au retour.
    const cashAtDep = b.status === 'confirmed';
    if (b.departure_date >= from && b.departure_date <= to) {
      moves.push({ ...base(b), type: 'dep', date: b.departure_date, time: hhmm(b.departure_time), where: b.departure_terminal || '', done: b.status !== 'confirmed', cash: cashAtDep ? due(b) : 0 });
    }
    if (b.return_date >= from && b.return_date <= to) {
      moves.push({ ...base(b), type: 'ret', date: b.return_date, time: hhmm(b.return_time), where: b.customer_flight ? `Vol ${b.customer_flight}` : b.return_terminal || '', done: b.status === 'returned', cash: cashAtDep && b.departure_date >= from ? 0 : due(b) });
    }
  }
  moves.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const stockList = stock.map((b) => ({ ...base(b), type: 'stock', date: b.return_date, time: hhmm(b.return_time), where: b.parking_spot ? `Place ${b.parking_spot}` : '', done: false, cash: due(b) }));

  return res.status(200).json({
    from, to, today,
    departures: moves.filter((m) => m.type === 'dep').length,
    returns: moves.filter((m) => m.type === 'ret').length,
    stockCount: stockList.length,
    cashTotal: r2(moves.reduce((s, m) => s + (m.done ? 0 : m.cash), 0)),
    moves,
    stock: stockList,
  });
}

async function loadResa(id) {
  const { data: b, error } = await supabase.from('bookings').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return b;
}

async function resaView(b) {
  const [checkin, lateCfg, valets, fees] = await Promise.all([
    getCheckin(b.id),
    getLateFeeConfig(),
    valetMap([b]),
    supabase.from('surcharges').select('id, name, amount_eur').eq('kind', 'option').eq('option_code', 'manual').eq('active', true).order('display_order'),
  ]);
  const detail = Array.isArray(b.surcharges_detail) ? b.surcharges_detail : [];
  return {
    id: b.id, reference: b.reference, status: b.status, name: name(b),
    firstname: b.customer_firstname, lastname: b.customer_lastname,
    email: /@sans-email\.invalid$/i.test(b.customer_email || '') ? '' : b.customer_email, phone: b.customer_phone || '',
    flight: b.customer_flight || '',
    dep: { date: b.departure_date, time: hhmm(b.departure_time), where: b.departure_terminal || '' },
    ret: { date: b.return_date, time: hhmm(b.return_time), where: b.return_terminal || '' },
    car: { brand: b.car_brand, model: b.car_model, color: b.car_color || '', plate: b.car_plate || '' },
    wash: b.wash_type || 'none', spot: b.parking_spot || '', notes: b.internal_notes || '',
    payment: { method: onSite(b) ? 'onsite' : 'online', paid: b.payment_status === 'paid' },
    total: r2(b.total_price), due: amountDue(b),
    lines: invoiceLines(b),
    manualFees: detail.map((d, i) => ({ ...d, index: i })).filter((d) => d.kind === 'manual_fee').map((d) => ({ index: d.index, label: d.label, amount: r2(d.amount) })),
    feeCatalog: (fees.data || []).map((f) => ({ id: f.id, label: f.name, amount: r2(f.amount_eur) })),
    late: {
      dep: { active: !!b.late_dep_active, fee: r2(b.late_dep_fee), actual: hhmm(b.late_dep_actual_time) },
      ret: { active: !!b.late_ret_active, fee: r2(b.late_ret_fee), actual: hhmm(b.late_ret_actual_time) },
      cfg: lateCfg,
    },
    valet: b.valet_id ? valets.get(b.valet_id) || null : null,
    signed: !!checkin?.paths?.length, signedAt: checkin?.signedAt || null,
    invoiceNo: checkin?.invoiceNo || null,
    today: parisToday(), nowMinutes: parisNowMinutes(),
  };
}

export async function adminResa(req, res) {
  if (!requireAdmin(req, res)) return;
  const id = String(req.query.id || '');
  if (!id) return res.status(400).json({ error: 'id requis' });
  const b = await loadResa(id);
  if (!b) return res.status(404).json({ error: 'Réservation introuvable' });
  return res.status(200).json({ resa: await resaView(b) });
}

/** Retard : `minutes` saisi à la main, sinon calculé avec l'heure actuelle. */
function lateFields(b, prefix, schedTime, late, cfg) {
  if (!late || late.apply === undefined) return {};
  if (!late.apply) return { [`${prefix}_active`]: false, [`${prefix}_fee`]: 0 };
  let minutes = Number(late.minutes);
  if (!Number.isFinite(minutes)) {
    minutes = parisNowMinutes() - toMin(schedTime);
    if (minutes < -720) minutes += 1440; // passé minuit
  }
  minutes = Math.max(0, Math.min(Math.round(minutes), 24 * 60));
  return {
    [`${prefix}_active`]: true,
    [`${prefix}_actual_time`]: minToTime(toMin(schedTime) + minutes),
    [`${prefix}_fee`]: lateFeeForMinutes(minutes, cfg),
  };
}

export async function adminStep(req, res) {
  if (!requireAdmin(req, res)) return;
  const id = String(req.body?.id || '');
  const step = String(req.body?.step || '');
  const b = id ? await loadResa(id) : null;
  if (!b) return res.status(404).json({ error: 'Réservation introuvable' });
  const cfg = await getLateFeeConfig();
  const now = new Date().toISOString();
  let updates = {};

  if (step === 'take') {
    if (b.status !== 'confirmed') return res.status(409).json({ error: 'Cette voiture est déjà prise en charge' });
    const paths = req.body?.signature == null ? null : cleanSignature(req.body.signature);
    if (req.body?.signature != null && !paths) return res.status(400).json({ error: 'Signature illisible, recommencez' });
    updates = { status: 'taken', taken_at: now, ...lateFields(b, 'late_dep', b.departure_time, req.body?.late, cfg) };
    // Reçu d'abord : s'il échoue, la voiture n'est pas marquée prise en charge.
    await saveCheckin(b.id, paths, b.reference);
  } else if (step === 'park') {
    if (!['taken', 'confirmed'].includes(b.status)) return res.status(409).json({ error: 'Étape impossible pour cette réservation' });
    updates = { status: 'in_storage', stored_at: now, parking_spot: String(req.body?.spot || b.parking_spot || '').trim().slice(0, 20) };
  } else if (step === 'return') {
    if (!['taken', 'in_storage'].includes(b.status)) return res.status(409).json({ error: 'La voiture doit être prise en charge avant d’être rendue' });
    updates = { status: 'returned', returned_at: now, ...lateFields(b, 'late_ret', b.return_time, req.body?.late, cfg) };
  } else if (step === 'cash') {
    updates = { payment_status: 'paid' };
  } else if (step === 'late') {
    // Ajuster un retard après coup (ex. « ne pas compter »).
    const which = req.body?.which === 'ret' ? 'ret' : 'dep';
    updates = lateFields(b, `late_${which}`, which === 'ret' ? b.return_time : b.departure_time, req.body?.late, cfg);
  } else if (step === 'spot') {
    updates = { parking_spot: String(req.body?.spot || '').trim().slice(0, 20) };
  } else {
    return res.status(400).json({ error: 'Étape inconnue' });
  }

  const { data, error } = await supabase.from('bookings').update(updates).eq('id', b.id).select('*').single();
  if (error) throw error;
  if (updates.status === 'returned') await grantReferralReward(data, { pushClient });
  const msg = CLIENT_STATUS_PUSH[updates.status];
  if (msg && data.customer_email) {
    const body = updates.status === 'taken' ? `${msg.body} Votre reçu est disponible dans l'app.` : msg.body;
    await pushClient(data.customer_email, { ...msg, body, data: { url: `/voiture/${data.reference}` } });
  }
  return res.status(200).json({ resa: await resaView(data) });
}

export async function adminFee(req, res) {
  if (!requireAdmin(req, res)) return;
  const id = String(req.body?.id || '');
  const b = id ? await loadResa(id) : null;
  if (!b) return res.status(404).json({ error: 'Réservation introuvable' });
  const detail = Array.isArray(b.surcharges_detail) ? [...b.surcharges_detail] : [];
  let total = Number(b.total_price);

  if (req.body?.removeIndex !== undefined) {
    const i = Number(req.body.removeIndex);
    if (!Number.isInteger(i) || !detail[i] || detail[i].kind !== 'manual_fee') return res.status(400).json({ error: 'Frais introuvable' });
    total -= Number(detail[i].amount || 0);
    detail.splice(i, 1);
  } else {
    const label = String(req.body?.label || '').trim().slice(0, 80);
    const amount = r2(req.body?.amount);
    if (!label || !Number.isFinite(amount) || amount === 0 || Math.abs(amount) > 5000) return res.status(400).json({ error: 'Nom et montant valides requis' });
    detail.push({ kind: 'manual_fee', label, amount });
    total += amount;
  }
  const { data, error } = await supabase.from('bookings')
    .update({ surcharges_detail: detail, total_price: r2(Math.max(0, total)) }).eq('id', b.id).select('*').single();
  if (error) throw error;
  return res.status(200).json({ resa: await resaView(data) });
}
