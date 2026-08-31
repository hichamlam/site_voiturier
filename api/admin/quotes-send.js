/**
 * POST /api/admin/quotes/send
 * Body : { id }
 * Envoie le devis par email au client
 */
import { Resend } from 'resend';
import { supabase, requireAdmin } from '../_lib.js';

const resend = new Resend(process.env.RESEND_API_KEY);

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
}
function categoryLabel(code) {
  return ({citadine:'Citadine', berline:'Berline / Break', suv:'SUV / 4×4 / Monospace', utilitaire:'Van / Utilitaire'})[code] || code;
}
function washLabel(t) {
  return ({none:'Aucun', exterieur:'Lavage extérieur', interieur:'Lavage intérieur', complet:'Lavage complet', premium:'Lavage premium'})[t] || '—';
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { id } = req.body;
    if (!id) return res.status(400).json({ error: 'id requis' });

    const { data: q } = await supabase.from('quotes').select('*').eq('id', id).single();
    if (!q) return res.status(404).json({ error: 'Devis introuvable' });
    if (!q.customer_email) return res.status(400).json({ error: 'Email client requis' });

    const FROM = process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';

    const detailRows = (q.surcharges_detail || []).map(d => `
      <tr>
        <td style="padding:10px 18px;font-size:13px;color:#475569;border-bottom:1px solid rgba(11,20,38,0.06);">${escapeHtml(d.label)}</td>
        <td style="padding:10px 18px;font-size:13px;color:#0F172A;font-weight:600;text-align:right;border-bottom:1px solid rgba(11,20,38,0.06);">${d.amount < 0 ? '−' + Math.abs(d.amount) : d.amount}€</td>
      </tr>
    `).join('');

    const html = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,sans-serif;color:#0F172A;">
<table width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(11,20,38,0.08);">
<tr><td style="background:linear-gradient(135deg,#0B1426,#75234a,#e8732e);padding:42px 40px;text-align:center;">
  <div style="display:inline-block;background:#E8B362;color:#0B1426;font-weight:800;font-size:13px;padding:7px 16px;border-radius:100px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:16px;">Devis personnalisé</div>
  <h1 style="margin:0;color:#fff;font-size:28px;font-weight:800;">Bonjour ${escapeHtml(q.customer_firstname || '')}</h1>
  <p style="margin:10px 0 0;color:rgba(255,255,255,0.85);font-size:15px;">Voici votre devis Direct Voiturier</p>
</td></tr>
<tr><td style="padding:24px 40px 8px;text-align:center;">
  <div style="display:inline-block;background:#0B1426;color:#E8B362;padding:9px 20px;border-radius:100px;font-weight:800;font-size:14px;">${q.reference}</div>
</td></tr>
<tr><td style="padding:8px 40px 24px;">
  <h2 style="margin:20px 0 10px;font-size:16px;font-weight:800;">Votre voyage</h2>
  <p style="margin:0;font-size:14px;color:#475569;">📅 Du <strong style="color:#0F172A;">${fmtDate(q.departure_date)} à ${q.departure_time?.slice(0,5)}</strong> au <strong style="color:#0F172A;">${fmtDate(q.return_date)} à ${q.return_time?.slice(0,5)}</strong></p>
  <p style="margin:6px 0 0;font-size:14px;color:#475569;">🚗 Véhicule : <strong style="color:#0F172A;">${categoryLabel(q.car_category_code)}</strong></p>
  ${q.wash_type !== 'none' ? `<p style="margin:6px 0 0;font-size:14px;color:#475569;">💧 ${washLabel(q.wash_type)}</p>` : ''}
  ${q.has_covered_parking ? `<p style="margin:6px 0 0;font-size:14px;color:#475569;">🅿️ Parking couvert</p>` : ''}
  ${q.has_priority_access ? `<p style="margin:6px 0 0;font-size:14px;color:#475569;">⚡ Accès prioritaire</p>` : ''}

  <h2 style="margin:24px 0 10px;font-size:16px;font-weight:800;">Détail du tarif</h2>
  <table width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(11,20,38,0.08);border-radius:10px;overflow:hidden;">${detailRows}</table>

  <div style="margin-top:18px;padding:18px 22px;background:#FBF3E0;border-radius:12px;display:flex;justify-content:space-between;">
    <table width="100%"><tr>
      <td style="font-size:15px;font-weight:700;">Total</td>
      <td align="right" style="font-size:30px;font-weight:800;color:#C9913B;">${q.total_price}€</td>
    </tr></table>
  </div>

  <p style="margin:18px 0 0;font-size:13px;color:#475569;text-align:center;">Devis valable jusqu'au <strong>${fmtDate(q.valid_until)}</strong></p>

  <div style="margin-top:24px;text-align:center;">
    <a href="${process.env.SITE_URL || 'https://directvoiturier.com'}" style="display:inline-block;padding:14px 30px;background:#0B1426;color:#E8B362;text-decoration:none;border-radius:100px;font-weight:800;font-size:14px;">Réserver maintenant →</a>
  </div>

  ${q.notes ? `<div style="margin-top:24px;padding:14px 18px;background:#f8fafc;border-left:3px solid #E8B362;border-radius:6px;"><p style="margin:0;font-size:13px;color:#475569;line-height:1.6;">${escapeHtml(q.notes)}</p></div>` : ''}
</td></tr>
<tr><td style="background:#0B1426;padding:22px 40px;text-align:center;">
  <p style="margin:0;color:#E8B362;font-weight:800;font-size:14px;">Direct Voiturier</p>
  <p style="margin:4px 0 0;color:rgba(255,255,255,0.5);font-size:11px;">Service voiturier premium · Aéroport Paris-Orly</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    await resend.emails.send({
      from: FROM,
      to: q.customer_email,
      subject: `Votre devis Direct Voiturier — ${q.reference}`,
      html,
    });

    await supabase.from('quotes').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', id);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('[admin/quotes/send]', err);
    return res.status(500).json({ error: err.message });
  }
}
