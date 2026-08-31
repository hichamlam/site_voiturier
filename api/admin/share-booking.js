/**
 * POST /api/admin/share-booking
 * Body : { reference, to, text }
 * Envoie un email HTML soigné avec toutes les infos de la réservation
 */
import { Resend } from 'resend';
import { supabase, requireAdmin } from '../_lib.js';

const resend = new Resend(process.env.RESEND_API_KEY);

function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
}
function washLabel(t) {
  return ({none:'Aucun', exterieur:'Lavage extérieur', interieur:'Lavage intérieur', complet:'Lavage complet', premium:'Lavage premium'})[t] || '—';
}
function categoryLabel(code) {
  return ({citadine:'Citadine', berline:'Berline / Break', suv:'SUV / 4×4 / Monospace', utilitaire:'Van / Utilitaire'})[code] || code;
}
function statusLabel(s) {
  return ({pending:'En attente', confirmed:'Confirmée', taken:'Prise en charge', in_storage:'En stock', returned:'Restituée', cancelled:'Annulée'})[s] || s;
}
function statusColor(s) {
  return ({pending:'#F59E0B', confirmed:'#10B981', taken:'#3B82F6', in_storage:'#8B5CF6', returned:'#6B7280', cancelled:'#EF4444'})[s] || '#6B7280';
}

function row(label, value) {
  return `<tr>
    <td style="padding:11px 18px;border-bottom:1px solid rgba(11,20,38,0.06);width:42%;font-size:13px;color:#475569;font-weight:600;vertical-align:top;">${label}</td>
    <td style="padding:11px 18px;border-bottom:1px solid rgba(11,20,38,0.06);font-size:14px;color:#0F172A;font-weight:600;text-align:right;">${value}</td>
  </tr>`;
}

function buildHTML(b, customNote) {
  const totalParts = [];
  totalParts.push(row('Voiturier de base', `${b.base_price}€`));
  if (b.vehicle_surcharge > 0) totalParts.push(row(`Catégorie ${categoryLabel(b.car_category_code)}`, `+${b.vehicle_surcharge}€`));
  if (b.wash_price > 0) totalParts.push(row(washLabel(b.wash_type), `${b.wash_price}€`));
  if (b.wash_surcharge > 0) totalParts.push(row('Supplément lavage véhicule', `+${b.wash_surcharge}€`));
  if (b.time_surcharges > 0) totalParts.push(row('Suppléments horaires/fériés', `+${b.time_surcharges}€`));
  if (b.options_total > 0) totalParts.push(row('Options', `+${b.options_total}€`));
  if (b.promo_code) totalParts.push(row(`Code promo ${b.promo_code}`, `<span style="color:#10B981;">−${b.promo_discount}€</span>`));

  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0F172A;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="640" cellspacing="0" cellpadding="0" style="max-width:640px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(11,20,38,0.08);">

<tr><td style="background:linear-gradient(135deg,#0B1426 0%,#75234a 50%,#e8732e 100%);padding:36px 40px;">
  <div style="display:inline-block;background:${statusColor(b.status)};color:white;font-weight:800;font-size:11px;padding:6px 12px;border-radius:100px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:14px;">${statusLabel(b.status)}${b.payment_status === 'paid' ? ' · PAYÉ' : ''}</div>
  <h1 style="margin:0;color:#fff;font-size:26px;font-weight:800;letter-spacing:-0.02em;">Réservation ${b.reference}</h1>
  <p style="margin:8px 0 0;color:rgba(255,255,255,0.8);font-size:14px;">${escapeHtml(b.customer_firstname)} ${escapeHtml(b.customer_lastname)} · ${b.car_brand} ${b.car_model} · ${escapeHtml(b.car_plate)}</p>
</td></tr>

${customNote ? `<tr><td style="padding:18px 40px 0;">
  <div style="padding:14px 18px;background:#FBF3E0;border-left:3px solid #E8B362;border-radius:6px;">
    <p style="margin:0 0 4px;font-size:11px;font-weight:800;letter-spacing:0.1em;text-transform:uppercase;color:#C9913B;">Note</p>
    <p style="margin:0;font-size:13px;color:#0F172A;line-height:1.55;white-space:pre-wrap;">${escapeHtml(customNote)}</p>
  </div>
</td></tr>` : ''}

<tr><td style="padding:24px 40px 8px;">
  <h2 style="margin:0 0 12px;font-size:14px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">👤 Client</h2>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(11,20,38,0.08);border-radius:12px;overflow:hidden;">
    ${row('Nom complet', `${escapeHtml(b.customer_firstname)} ${escapeHtml(b.customer_lastname)}`)}
    ${row('📱 Téléphone', `<a href="tel:${escapeHtml(b.customer_phone)}" style="color:#0EA5E9;text-decoration:none;">${escapeHtml(b.customer_phone)}</a>`)}
    ${row('📧 Email', `<a href="mailto:${escapeHtml(b.customer_email)}" style="color:#0EA5E9;text-decoration:none;">${escapeHtml(b.customer_email)}</a>`)}
    ${b.customer_flight ? row('✈️ Vol', escapeHtml(b.customer_flight)) : ''}
  </table>

  <h2 style="margin:24px 0 12px;font-size:14px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">📅 Voyage</h2>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(11,20,38,0.08);border-radius:12px;overflow:hidden;">
    ${row('🛫 Aller', `${fmtDate(b.departure_date)}<br>à ${(b.departure_time || '').slice(0,5)}${b.departure_terminal ? ' · ' + escapeHtml(b.departure_terminal) : ''}`)}
    ${row('🛬 Retour', `${fmtDate(b.return_date)}<br>à ${(b.return_time || '').slice(0,5)}${b.return_terminal ? ' · ' + escapeHtml(b.return_terminal) : ''}`)}
  </table>

  <h2 style="margin:24px 0 12px;font-size:14px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">🚗 Véhicule</h2>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(11,20,38,0.08);border-radius:12px;overflow:hidden;">
    ${row('Modèle', `${escapeHtml(b.car_brand)} ${escapeHtml(b.car_model)}${b.car_color ? ' · ' + escapeHtml(b.car_color) : ''}`)}
    ${row('Plaque', `<strong style="font-size:15px;">${escapeHtml(b.car_plate)}</strong>`)}
    ${row('Catégorie', categoryLabel(b.car_category_code))}
    ${b.parking_spot ? row('📍 Emplacement', `<strong>${escapeHtml(b.parking_spot)}</strong>`) : ''}
  </table>

  <h2 style="margin:24px 0 12px;font-size:14px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">💰 Tarif</h2>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(11,20,38,0.08);border-radius:12px;overflow:hidden;">
    ${totalParts.join('')}
  </table>
  <div style="margin-top:14px;padding:18px 22px;background:#FBF3E0;border-radius:12px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td style="font-size:14px;color:#0F172A;font-weight:700;">Total</td>
      <td align="right" style="font-size:28px;color:#C9913B;font-weight:800;letter-spacing:-0.02em;">${b.total_price}€</td>
    </tr></table>
  </div>

  ${b.internal_notes ? `<h2 style="margin:24px 0 12px;font-size:14px;font-weight:800;letter-spacing:0.08em;text-transform:uppercase;color:#475569;">📝 Notes internes</h2>
  <div style="padding:14px 18px;background:#f8fafc;border-radius:10px;font-size:13px;color:#475569;line-height:1.55;white-space:pre-wrap;">${escapeHtml(b.internal_notes)}</div>` : ''}

</td></tr>

<tr><td style="background:#0B1426;padding:22px 40px;text-align:center;">
  <p style="margin:0;color:#E8B362;font-weight:800;font-size:13px;">Direct Voiturier</p>
  <p style="margin:4px 0 0;color:rgba(255,255,255,0.5);font-size:11px;">Partage interne — réservation ${b.reference}</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { reference, to, text } = req.body;
    if (!reference || !to) return res.status(400).json({ error: 'reference et to requis' });

    const { data: b } = await supabase.from('bookings').select('*').eq('reference', reference).single();
    if (!b) return res.status(404).json({ error: 'Réservation introuvable' });

    if (!process.env.RESEND_API_KEY) {
      return res.status(500).json({ error: 'Resend non configuré' });
    }

    const FROM = process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';
    const html = buildHTML(b, text);

    await resend.emails.send({
      from: FROM,
      to,
      subject: `[Direct Voiturier] Réservation ${b.reference} — ${b.customer_firstname} ${b.customer_lastname}`,
      html,
      text: text || `Réservation ${b.reference} — ${b.customer_firstname} ${b.customer_lastname}`,
    });

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[admin/share-booking]', err);
    return res.status(500).json({ error: err.message });
  }
}
