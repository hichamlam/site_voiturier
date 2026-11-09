/**
 * Prise en charge signée + facture.
 *
 * Règle métier : la facture n'existe qu'à partir du moment où le voiturier
 * VALIDE LA PRISE EN CHARGE (le service a commencé). Valider un paiement seul
 * ne crée pas de facture.
 *
 * Aucune migration : tout vit dans la table clé/valeur `settings`, déjà utilisée
 * ainsi par le reste de l'API.
 *   checkin:<booking_id>  → { paths, signedAt, invoiceNo, invoicedAt }
 *   invoice_seq           → dernier numéro de facture attribué (suite continue)
 * Ces clés ne sortent jamais par /api/config (liste blanche) ni par
 * /api/admin/settings (liste blanche FIELDS).
 */
import { supabase } from './_lib.js';

const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ─── Signature ─────────────────────────────────────────────────────── */
// Tracés SVG envoyés par l'app (zone 300×150). Seules les commandes M/L et des
// nombres sont acceptés : rien d'exécutable ne peut se glisser dans le SVG.
const PATH_RE = /^[ML0-9.\s-]{1,8000}$/;
export function cleanSignature(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.length > 80) return null;
  const out = paths.map((p) => String(p || '').trim()).filter((p) => p && PATH_RE.test(p));
  if (!out.length || out.join('').length > 60000) return null;
  return out;
}
export const signatureSvg = (paths, w = 300, h = 150) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 150" width="${w}" height="${h}" fill="none" stroke="#0A1B2E" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">${(paths || []).filter((p) => PATH_RE.test(p)).map((d) => `<path d="${d}"/>`).join('')}</svg>`;

/* ─── Stockage ──────────────────────────────────────────────────────── */
export async function getCheckin(bookingId) {
  try {
    const { data } = await supabase.from('settings').select('value').eq('key', `checkin:${bookingId}`).maybeSingle();
    return data?.value ? JSON.parse(data.value) : null;
  } catch { return null; }
}

/** Réservations (parmi `ids`) qui ont une facture — sans charger les signatures. */
export async function invoicedIds(ids) {
  if (!ids.length) return new Set();
  try {
    const { data } = await supabase.from('settings').select('key').in('key', ids.map((id) => `checkin:${id}`));
    return new Set((data || []).map((r) => r.key.slice('checkin:'.length)));
  } catch { return new Set(); }
}

async function nextInvoiceNo() {
  // Numérotation continue. Volume faible : on relit juste avant d'écrire puis on
  // vérifie qu'aucun autre appel n'a pris le même numéro (rare, on réessaie).
  for (let attempt = 0; attempt < 5; attempt++) {
    const { data } = await supabase.from('settings').select('value').eq('key', 'invoice_seq').maybeSingle();
    const n = (parseInt(data?.value, 10) || 0) + 1;
    const q = supabase.from('settings');
    const { error, count } = data
      ? await q.update({ value: String(n), updated_at: new Date().toISOString() }, { count: 'exact' }).eq('key', 'invoice_seq').eq('value', data.value)
      : await q.insert({ key: 'invoice_seq', value: String(n) }, { count: 'exact' });
    if (!error && count !== 0) return `F${new Date().getFullYear()}-${String(n).padStart(5, '0')}`;
  }
  throw new Error('Numéro de facture indisponible, réessayez');
}

/** Enregistre la signature et attribue le numéro de facture (une seule fois). */
export async function saveCheckin(bookingId, paths) {
  const prev = await getCheckin(bookingId);
  const value = {
    paths: paths || prev?.paths || [],
    signedAt: paths ? new Date().toISOString() : prev?.signedAt || null,
    invoiceNo: prev?.invoiceNo || (await nextInvoiceNo()),
    invoicedAt: prev?.invoicedAt || new Date().toISOString(),
  };
  const { error } = await supabase.from('settings')
    .upsert({ key: `checkin:${bookingId}`, value: JSON.stringify(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw error;
  return value;
}

/* ─── Montants ──────────────────────────────────────────────────────── */
export const lateTotal = (b) => r2((b.late_dep_active ? b.late_dep_fee : 0) + (b.late_ret_active ? b.late_ret_fee : 0));
/** Ce que le client doit au total : prix de la résa + retards retenus. */
export const amountDue = (b) => r2(Number(b.total_price) + lateTotal(b));

export function invoiceLines(b) {
  const days = Math.max(1, Math.round((Date.parse(b.return_date) - Date.parse(b.departure_date)) / 86400000) + 1);
  const lines = [{ label: `Service voiturier Orly · ${days} jour${days > 1 ? 's' : ''}`, amount: r2(b.base_price) }];
  const add = (label, amount) => { if (r2(amount) !== 0) lines.push({ label, amount: r2(amount) }); };
  add('Supplément véhicule', b.vehicle_surcharge);
  add('Lavage', Number(b.wash_price || 0) + Number(b.wash_surcharge || 0));
  add('Frais horaires', b.time_surcharges);
  add('Options', b.options_total);
  for (const d of Array.isArray(b.surcharges_detail) ? b.surcharges_detail : []) {
    if (d && (d.kind === 'manual_fee' || d.kind === 'modification_fee')) add(d.label || 'Frais', d.amount);
  }
  if (Number(b.promo_discount) > 0) add(`Code promo ${b.promo_code || ''}`.trim(), -Number(b.promo_discount));
  const sum = r2(lines.reduce((s, l) => s + l.amount, 0));
  add('Ajustement', Number(b.total_price) - sum); // prix modifié à la main par l'admin
  if (b.late_dep_active) add('Frais de retard au dépôt', b.late_dep_fee);
  if (b.late_ret_active) add('Frais de retard au retour', b.late_ret_fee);
  return lines;
}

/* ─── Facture HTML (imprimable / « Enregistrer en PDF ») ────────────── */
export async function companyInfo() {
  const keys = ['company_name', 'company_siret', 'contact_address', 'contact_email', 'contact_phone', 'invoice_mention'];
  const { data } = await supabase.from('settings').select('key, value').in('key', keys);
  const s = Object.fromEntries((data || []).map((r) => [r.key, r.value || '']));
  return s;
}

const frDate = (iso) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(iso));
const eur = (n) => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);

export function invoiceHtml(b, checkin, co) {
  const lines = invoiceLines(b);
  const total = amountDue(b);
  const paid = b.payment_status === 'paid';
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Facture ${esc(checkin.invoiceNo)}</title>
<style>
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#0A1B2E;margin:0;background:#EEF4FA}
.page{max-width:720px;margin:24px auto;background:#fff;border-radius:16px;padding:32px}
h1{font-size:26px;margin:0 0 4px}.muted{color:#51657B;font-size:14px}
.row{display:flex;justify-content:space-between;gap:24px;flex-wrap:wrap;margin:24px 0}
table{width:100%;border-collapse:collapse;margin-top:8px}td{padding:10px 0;border-bottom:1px solid #EEF4FA;font-size:15px}
td:last-child{text-align:right;white-space:nowrap}.tot td{font-weight:800;font-size:18px;border:none;padding-top:16px}
.badge{display:inline-block;padding:4px 10px;border-radius:99px;font-size:13px;font-weight:700}
.btn{display:inline-block;margin-top:24px;padding:12px 20px;border-radius:99px;background:#1E6FD9;color:#fff;font-weight:700;border:none;font-size:15px;cursor:pointer}
@media print{body{background:#fff}.page{margin:0;border-radius:0}.btn{display:none}}
</style></head><body><div class="page">
<div class="row" style="margin-top:0"><div><h1>Facture</h1><div class="muted">N° ${esc(checkin.invoiceNo)} · ${esc(frDate(checkin.invoicedAt))}</div></div>
<div style="text-align:right"><b>${esc(co.company_name || 'Direct Voiturier')}</b><div class="muted">${esc(co.contact_address || '')}${co.company_siret ? `<br>SIRET ${esc(co.company_siret)}` : ''}${co.contact_email ? `<br>${esc(co.contact_email)}` : ''}</div></div></div>
<div class="row"><div><div class="muted">Client</div><b>${esc(`${b.customer_firstname} ${b.customer_lastname}`.trim())}</b><div class="muted">${esc(b.customer_email && !/@sans-email\.invalid$/i.test(b.customer_email) ? b.customer_email : '')}</div></div>
<div><div class="muted">Réservation</div><b>${esc(b.reference)}</b><div class="muted">${esc(b.car_brand)} ${esc(b.car_model)} · ${esc(b.car_plate)}<br>Du ${esc(frDate(b.departure_date))} au ${esc(frDate(b.return_date))}</div></div></div>
<table>${lines.map((l) => `<tr><td>${esc(l.label)}</td><td>${esc(eur(l.amount))}</td></tr>`).join('')}
<tr class="tot"><td>Total TTC</td><td>${esc(eur(total))}</td></tr></table>
<p><span class="badge" style="background:${paid ? '#DDF4EA;color:#0E7C52' : '#FFE9D1;color:#A14E00'}">${paid ? 'Payée' : 'À régler sur place'}</span></p>
${co.invoice_mention ? `<p class="muted">${esc(co.invoice_mention)}</p>` : ''}
${checkin.paths?.length ? `<div class="muted" style="margin-top:20px">Prise en charge signée par le client le ${esc(frDate(checkin.signedAt))}</div>${signatureSvg(checkin.paths, 180, 90)}` : ''}
<button class="btn" onclick="window.print()">Enregistrer en PDF / imprimer</button>
</div></body></html>`;
}
