/**
 * Templates email partagés entre booking, webhook
 */
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
}
function washLabel(t) {
  return ({none:'Aucun', exterieur:'Lavage extérieur', interieur:'Lavage intérieur', complet:'Lavage complet', premium:'Lavage premium'})[t] || '—';
}
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function categoryLabel(code) {
  return ({citadine:'Citadine', berline:'Berline / Break', suv:'SUV / 4×4 / Monospace', utilitaire:'Van / Utilitaire'})[code] || code;
}
function row(label, value, opts = {}) {
  const last = opts.last ? '' : 'border-bottom:1px solid rgba(11,20,38,0.06);';
  const valColor = opts.color || '#0F172A';
  return `<tr>
    <td style="padding:11px 18px;${last}width:42%;font-size:13px;color:#475569;font-weight:600;vertical-align:top;">${label}</td>
    <td style="padding:11px 18px;${last}font-size:14px;color:${valColor};font-weight:600;text-align:right;">${value}</td>
  </tr>`;
}

function detailRows(detail) {
  if (!detail || detail.length === 0) return '';
  return detail.map((d, i) => {
    const isLast = i === detail.length - 1;
    const amount = d.amount < 0 ? `<span style="color:#10B981;">−${Math.abs(d.amount)}€</span>` : `${d.amount}€`;
    return row(escapeHtml(d.label), amount, { last: isLast });
  }).join('');
}

export function clientEmailHTML(ctx) {
  const { reference, total, customer, car, dep, ret, surchargesDetail, paymentMode } = ctx;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0F172A;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(11,20,38,0.08);">

<tr><td style="background:linear-gradient(135deg,#0B1426 0%,#75234a 50%,#e8732e 100%);padding:48px 40px;text-align:center;">
  <div style="display:inline-block;background:#E8B362;color:#0B1426;font-weight:800;font-size:14px;padding:8px 16px;border-radius:100px;letter-spacing:0.1em;text-transform:uppercase;margin-bottom:18px;">${paymentMode === 'en ligne' ? 'Paiement reçu' : 'Réservation confirmée'}</div>
  <h1 style="margin:0;color:#fff;font-size:32px;font-weight:800;letter-spacing:-0.02em;line-height:1.1;">Bon voyage,<br><span style="color:#E8B362;font-style:italic;">${escapeHtml(customer.firstname)}</span></h1>
  <p style="margin:14px 0 0;color:rgba(255,255,255,0.85);font-size:16px;font-weight:500;">Votre voiturier vous attend</p>
</td></tr>

<tr><td style="padding:28px 40px 8px;text-align:center;">
  <div style="display:inline-block;background:#0B1426;color:#E8B362;padding:10px 22px;border-radius:100px;font-weight:800;font-size:15px;letter-spacing:0.06em;">RÉF — ${reference}</div>
</td></tr>

<tr><td style="padding:8px 40px 24px;">
  <h2 style="margin:24px 0 12px;font-size:18px;font-weight:800;color:#0F172A;letter-spacing:-0.01em;">Votre réservation</h2>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(11,20,38,0.08);border-radius:12px;overflow:hidden;">
    ${row('🛫 Aller', `${fmtDate(dep.date)} à ${dep.time}${dep.terminal ? '<br>Terminal : ' + escapeHtml(dep.terminal) : ''}`)}
    ${row('🛬 Retour', `${fmtDate(ret.date)} à ${ret.time}${ret.terminal ? '<br>Terminal : ' + escapeHtml(ret.terminal) : ''}`)}
    ${row('🚗 Véhicule', `${escapeHtml(car.brand)} ${escapeHtml(car.model)}${car.color ? ' · ' + escapeHtml(car.color) : ''}<br>Plaque : <strong>${escapeHtml(car.plate)}</strong>`)}
    ${row('Catégorie', categoryLabel(car.categoryCode || 'citadine'))}
    ${customer.flight ? row('✈️ Vol retour', escapeHtml(customer.flight)) : ''}
    ${row('💳 Paiement', paymentMode === 'sur place' ? 'Sur place (espèces ou carte)' : 'Carte bancaire — Payé', { last: true })}
  </table>

  <h2 style="margin:24px 0 12px;font-size:18px;font-weight:800;color:#0F172A;">Détail du tarif</h2>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(11,20,38,0.08);border-radius:12px;overflow:hidden;">
    ${detailRows(surchargesDetail)}
  </table>

  <div style="margin-top:18px;padding:18px 22px;background:#FBF3E0;border-radius:12px;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
      <td style="font-size:15px;color:#0F172A;font-weight:700;">Total ${paymentMode === 'en ligne' ? 'payé' : 'à régler sur place'}</td>
      <td align="right" style="font-size:30px;color:#C9913B;font-weight:800;letter-spacing:-0.02em;">${total}€</td>
    </tr></table>
  </div>
</td></tr>

<tr><td style="padding:0 40px 24px;">
  <h3 style="margin:0 0 12px;font-size:16px;font-weight:800;color:#0F172A;">📍 Le jour J</h3>
  <p style="margin:0 0 8px;font-size:14px;color:#475569;line-height:1.6;">Présentez-vous au moins <strong style="color:#0F172A;">2h à 3h avant votre embarquement</strong> au dépose-minute du Terminal ${escapeHtml(dep.terminal || 'indiqué')}. Notre voiturier vous accueille avec un panneau "Direct Voiturier".</p>
  <p style="margin:8px 0 0;font-size:14px;color:#475569;line-height:1.6;">Au retour, on vous appelle dès l'atterrissage. Le temps de récupérer vos bagages, votre voiture est devant le terminal.</p>
</td></tr>

<tr><td style="padding:0 40px 24px;">
  <div style="padding:14px 18px;background:#f8fafc;border-left:3px solid #E8B362;border-radius:6px;">
    <p style="margin:0 0 6px;font-size:13px;color:#475569;line-height:1.5;"><strong style="color:#0F172A;">Annulation</strong> : étudiée à l'amiable au moins 7 jours avant la date prévue. Pour toute modification : <a href="mailto:contact@directvoiturier.com" style="color:#C9913B;text-decoration:none;font-weight:700;">contact@directvoiturier.com</a></p>
    <p style="margin:0;font-size:13px;color:#475569;line-height:1.5;"><strong style="color:#0F172A;">Retard</strong> : tolérance 30 min. Au-delà, des frais peuvent s'appliquer (10€ pour la 1re heure, 15€/h ensuite).</p>
  </div>
</td></tr>

<tr><td style="padding:0 40px 32px;">
  <p style="margin:0;font-size:10px;color:#94A3B8;line-height:1.5;font-style:italic;">
    Sur demande à l'arrivée : état des lieux contradictoire signé — 15€ à régler sur place.
    En l'absence d'état des lieux contradictoire signé par les deux parties, le prestataire ne peut être tenu responsable d'aucun dommage. Voir conditions générales sur le site.
  </p>
</td></tr>

<tr><td style="background:#0B1426;padding:24px 40px;text-align:center;">
  <p style="margin:0 0 6px;color:#E8B362;font-weight:800;font-size:15px;">Direct Voiturier</p>
  <p style="margin:0;color:rgba(255,255,255,0.5);font-size:12px;">Service voiturier premium · Aéroport Paris-Orly · 6 ans à Orly</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

export function adminEmailHTML(ctx) {
  const { reference, total, customer, car, dep, ret, surchargesDetail, paymentMode, options = {} } = ctx;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,sans-serif;color:#0F172A;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0B1426;padding:30px 40px;">
  <h1 style="margin:0;color:#E8B362;font-size:22px;font-weight:800;">${paymentMode === 'en ligne' ? '💳 Paiement reçu' : '🛬 Nouvelle réservation'}</h1>
  <p style="margin:8px 0 0;color:rgba(255,255,255,0.7);font-size:14px;">Réf <strong style="color:#fff;">${reference}</strong> · <strong style="color:#E8B362;">${total}€</strong></p>
</td></tr>
<tr><td style="padding:24px 40px;">
  <h2 style="margin:0 0 10px;font-size:14px;color:#475569;text-transform:uppercase;letter-spacing:0.1em;">Client</h2>
  <p style="margin:0 0 4px;font-size:15px;font-weight:700;">${escapeHtml(customer.firstname)} ${escapeHtml(customer.lastname || '')}</p>
  <p style="margin:0 0 4px;font-size:13px;color:#475569;">📧 <a href="mailto:${escapeHtml(customer.email)}" style="color:#0EA5E9;">${escapeHtml(customer.email)}</a></p>
  <p style="margin:0 0 16px;font-size:13px;color:#475569;">📱 <a href="tel:${escapeHtml(customer.phone)}" style="color:#0EA5E9;">${escapeHtml(customer.phone)}</a></p>

  <h2 style="margin:18px 0 10px;font-size:14px;color:#475569;text-transform:uppercase;letter-spacing:0.1em;">Voyage</h2>
  <p style="margin:0 0 4px;font-size:14px;">Aller : <strong>${fmtDate(dep.date)} ${dep.time}</strong>${dep.terminal ? ' · ' + escapeHtml(dep.terminal) : ''}</p>
  <p style="margin:0 0 4px;font-size:14px;">Retour : <strong>${fmtDate(ret.date)} ${ret.time}</strong>${ret.terminal ? ' · ' + escapeHtml(ret.terminal) : ''}</p>
  ${customer.flight ? `<p style="margin:0;font-size:14px;">Vol : <strong>${escapeHtml(customer.flight)}</strong></p>` : ''}

  <h2 style="margin:18px 0 10px;font-size:14px;color:#475569;text-transform:uppercase;letter-spacing:0.1em;">Véhicule</h2>
  <p style="margin:0 0 4px;font-size:14px;">${escapeHtml(car.brand)} ${escapeHtml(car.model)}${car.color ? ' ' + escapeHtml(car.color) : ''} · <strong>${escapeHtml(car.plate)}</strong></p>
  <p style="margin:0 0 16px;font-size:13px;color:#475569;">${categoryLabel(car.categoryCode || 'citadine')}</p>

  <h2 style="margin:18px 0 10px;font-size:14px;color:#475569;text-transform:uppercase;letter-spacing:0.1em;">Options</h2>
  <p style="margin:0 0 16px;font-size:14px;">
    Lavage : <strong>${washLabel(ctx.wash?.type || 'none')}</strong>${options.coveredParking ? ' · 🅿️ Parking couvert' : ''}${options.priorityAccess ? ' · ⚡ Accès prioritaire' : ''}
  </p>

  <h2 style="margin:18px 0 10px;font-size:14px;color:#475569;text-transform:uppercase;letter-spacing:0.1em;">Détail tarif</h2>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(11,20,38,0.08);border-radius:8px;overflow:hidden;">
    ${detailRows(surchargesDetail)}
  </table>

  <div style="margin-top:18px;padding:14px 18px;background:#FBF3E0;border-radius:10px;text-align:center;">
    <a href="${process.env.SITE_URL || ''}/admin" style="display:inline-block;padding:10px 22px;background:#0B1426;color:#E8B362;text-decoration:none;border-radius:100px;font-weight:800;font-size:13px;">→ Ouvrir dans le back-office</a>
  </div>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}
