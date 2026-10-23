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
  return ({citadine:'Citadine', berline:'Berline / Break', suv:'SUV / Familial / Monospace', utilitaire:'Van / Utilitaire'})[code] || code;
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

// Bouton « Gérer ma réservation » (lien personnel signé, voir api/_manage.js)
function manageBlock(url) {
  if (!url) return '';
  return `<tr><td style="padding:0 40px 24px;">
  <div style="padding:20px 22px;background:#EFF6FF;border-radius:12px;text-align:center;">
    <p style="margin:0 0 6px;font-size:15px;font-weight:800;color:#0F172A;">Un changement de programme ?</p>
    <p style="margin:0 0 14px;font-size:13px;color:#475569;line-height:1.5;">Modifiez vos dates, votre vol ou ajoutez une option en ligne, jusqu'à 24&nbsp;h avant le rendez-vous.</p>
    <a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 26px;background:#1B5FA8;color:#fff;text-decoration:none;border-radius:100px;font-weight:800;font-size:14px;">Gérer ma réservation</a>
  </div>
</td></tr>`;
}

export function clientEmailHTML(ctx) {
  const { reference, total, customer, car, dep, ret, surchargesDetail, paymentMode } = ctx;
  const phone = (ctx.contactPhone || '').trim();
  const phoneLink = phone
    ? `<a href="tel:${escapeHtml(phone.replace(/[^\d+]/g, ''))}" style="color:#1B5FA8;text-decoration:none;font-weight:800;white-space:nowrap;">${escapeHtml(phone)}</a>`
    : `<strong style="color:#1B5FA8;">notre numéro (indiqué sur directvoiturier.com)</strong>`;
  const yearsAtOrly = Math.max(1, new Date().getFullYear() - 2019);
  const step = (n, html) => `<tr>
      <td width="30" valign="top" style="padding:0 0 10px;"><div style="width:22px;height:22px;line-height:22px;border-radius:11px;background:#0B1426;color:#E8B362;font-size:12px;font-weight:800;text-align:center;">${n}</div></td>
      <td valign="top" style="padding:0 0 10px;font-size:14px;color:#334155;line-height:1.55;">${html}</td>
    </tr>`;
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0F172A;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:40px 20px;">
<tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(11,20,38,0.08);">

<tr><td style="background:#0B1426;background-image:linear-gradient(135deg,#0B1426 0%,#1B5FA8 60%,#2E7FD3 100%);padding:48px 40px;text-align:center;">
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

${manageBlock(ctx.manageUrl)}

<tr><td style="padding:0 40px 8px;">
  <h3 style="margin:0 0 14px;font-size:18px;font-weight:800;color:#0F172A;">📍 Le jour J</h3>

  <div style="padding:18px 20px;background:#EFF6FF;border-radius:12px;margin-bottom:14px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:800;color:#1B5FA8;letter-spacing:0.08em;text-transform:uppercase;">🛫 À l'aller</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${step(1, 'Prévoyez d\'arriver à Orly <strong style="color:#0F172A;">3h avant votre vol</strong>.')}
      ${step(2, '<strong style="color:#0F172A;">Contactez-nous 45 min avant votre arrivée sur Orly</strong> au ' + phoneLink + '.')}
      ${step(3, `Notre voiturier vous attend au Terminal ${escapeHtml(dep.terminal || 'indiqué')}.`)}
    </table>
  </div>

  <div style="padding:18px 20px;background:#EFF6FF;border-radius:12px;">
    <p style="margin:0 0 12px;font-size:13px;font-weight:800;color:#1B5FA8;letter-spacing:0.08em;text-transform:uppercase;">🛬 Au retour</p>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
      ${step(1, '<strong style="color:#0F172A;">Dès l\'atterrissage, envoyez-nous un SMS</strong> au ' + phoneLink + ' pour confirmer votre arrivée.')}
      ${step(2, '<strong style="color:#0F172A;">Une fois vos bagages en soute récupérés, appelez-nous</strong>.')}
      ${step(3, 'On vous livre votre véhicule devant le terminal.')}
    </table>
  </div>
</td></tr>

<tr><td style="padding:22px 40px 30px;">
  <p style="margin:0 0 6px;font-size:10px;font-weight:700;color:#94A3B8;text-transform:uppercase;letter-spacing:0.06em;">Conditions de la prestation — extrait des conditions générales</p>
  <p style="margin:0 0 5px;font-size:10px;color:#94A3B8;line-height:1.5;">
    <strong>1. Acceptation.</strong> La validation de la réservation vaut acceptation pleine et entière des conditions générales de vente, consultables en intégralité sur directvoiturier.com (« Conditions générales », bas de page).
    <strong>2. Annulation.</strong> Toute réservation est ferme et définitive : aucun remboursement en cas d'annulation ou de non-présentation. À titre purement commercial et sans obligation, les annulations communiquées au moins 7 jours avant la prise en charge peuvent être étudiées à l'amiable (contact@directvoiturier.com). Conformément à l'article L221-28 12° du Code de la consommation, le droit de rétractation de 14 jours ne s'applique pas à un service de gardiennage à date déterminée ; le Client y renonce expressément.
  </p>
  <p style="margin:0 0 5px;font-size:10px;color:#94A3B8;line-height:1.5;">
    <strong>3. Retard à l'aller.</strong> Tolérance de 30 minutes. Au-delà, sans préavis téléphonique, le Prestataire peut annuler la réservation sans remboursement ou appliquer 50 € de frais de réorganisation.
    <strong>4. Retard au retour.</strong> Tolérance de 30 minutes après l'horaire convenu, puis 10 € pour la première heure entamée, 15 € par heure supplémentaire, 50 € par jour entamé au-delà de 24 h, et 50 € de pénalité forfaitaire en l'absence de préavis téléphonique (SMS et appel à l'atterrissage). Ces frais sont dus et facturés au Client.
  </p>
  <p style="margin:0 0 5px;font-size:10px;color:#94A3B8;line-height:1.5;">
    <strong>5. Véhicules de grand gabarit.</strong> Un supplément de 50 € s'applique aux véhicules de grand gabarit : vans, utilitaires, pick-up, minibus et monospaces/ludospaces longs, notamment (liste non exhaustive) Renault Trafic, Master, Espace ; Citroën C4 SpaceTourer et Grand C4 SpaceTourer, SpaceTourer, Jumpy, Jumper, Berlingo ; Peugeot Rifter, Traveller, Expert, Boxer, Partner ; Opel Vivaro, Zafira Life ; Fiat Ducato, Scudo, Talento ; Ford Transit, Tourneo ; Mercedes Vito, Classe V, Sprinter ; VW Transporter, Caravelle, Multivan ; Toyota Proace.
    <strong>6. État des lieux.</strong> Un état des lieux contradictoire signé par les deux parties peut être réalisé à la prise en charge, sur demande du Client : 15 € à régler sur place. À défaut d'état des lieux contradictoire signé, le Client reconnaît l'absence de dommage préexistant comme de dommage subi pendant la garde, et le Prestataire ne peut être tenu responsable d'aucun dommage allégué. En cas d'état des lieux signé, la responsabilité du Prestataire est limitée à 450 € par sinistre.
  </p>
  <p style="margin:0;font-size:10px;color:#94A3B8;line-height:1.5;">
    <strong>7. Exclusions.</strong> Le Prestataire n'est pas responsable des objets laissés dans le véhicule, du vol par effraction ou de la force majeure, des pannes préexistantes, de la perte ou casse des clés hors faute lourde prouvée, des dommages climatiques, des actes de tiers hors parking surveillé, ni des dommages indirects.
    <strong>8. Obligations du Client.</strong> Véhicule en état de circulation, en règle (carte grise, contrôle technique, assurance), avec un niveau de carburant suffisant ; le Client en est le propriétaire ou a l'autorisation expresse du propriétaire.
    <strong>9. Données.</strong> Traitées conformément au RGPD, uniquement pour l'exécution du service ; droit d'accès, de rectification et de suppression : contact@directvoiturier.com.
  </p>
</td></tr>

<tr><td style="background:#0B1426;padding:24px 40px;text-align:center;">
  <p style="margin:0 0 6px;color:#E8B362;font-weight:800;font-size:15px;">Direct Voiturier</p>
  <p style="margin:0;color:rgba(255,255,255,0.5);font-size:12px;">Service voiturier premium · Aéroport Paris-Orly · ${yearsAtOrly} ans à Orly</p>
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

/**
 * Email envoyé au client ET à l'admin après une modification faite dans
 * l'espace « Gérer ma réservation ».
 */
export function modificationEmailHTML({ booking, summary, toPay, paidOnline, manageUrl, forAdmin = false }) {
  const b = booking;
  const lines = summary.map((s) => `<li style="margin:0 0 6px;">${escapeHtml(s)}</li>`).join('');
  const money = toPay > 0
    ? (paidOnline ? `Supplément réglé en ligne : <strong>${toPay}€</strong> (différence + frais de modification).`
                  : `Supplément de <strong>${toPay}€</strong> (différence + frais de modification) à régler sur place.`)
    : 'Aucun supplément.';
  const due = b.payment_method === 'stripe' && b.payment_status === 'paid' ? 'payé' : 'à régler sur place';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#0F172A;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f8fafc;padding:40px 20px;"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:16px;overflow:hidden;">
<tr><td style="background:#0B1426;background-image:linear-gradient(135deg,#0B1426 0%,#1B5FA8 100%);padding:34px 40px;text-align:center;">
  <p style="margin:0 0 8px;color:rgba(255,255,255,.75);font-size:13px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;">${forAdmin ? '✏️ Modification client' : 'Modification enregistrée'}</p>
  <h1 style="margin:0;color:#fff;font-size:24px;font-weight:800;">Réservation ${escapeHtml(b.reference)}</h1>
  ${forAdmin ? `<p style="margin:8px 0 0;color:rgba(255,255,255,.8);font-size:14px;">${escapeHtml(b.customer_firstname)} ${escapeHtml(b.customer_lastname || '')} · ${escapeHtml(b.customer_phone)}</p>` : ''}
</td></tr>
<tr><td style="padding:28px 40px 8px;">
  <h2 style="margin:0 0 10px;font-size:16px;font-weight:800;">Ce qui a changé</h2>
  <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;color:#334155;line-height:1.5;">${lines}</ul>
  <p style="margin:0 0 18px;font-size:14px;color:#334155;">${money}</p>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid rgba(11,20,38,0.08);border-radius:12px;overflow:hidden;">
    ${row('🛫 Aller', `${fmtDate(b.departure_date)} à ${String(b.departure_time).slice(0, 5)}${b.departure_terminal ? '<br>' + escapeHtml(b.departure_terminal) : ''}`)}
    ${row('🛬 Retour', `${fmtDate(b.return_date)} à ${String(b.return_time).slice(0, 5)}`)}
    ${b.customer_flight ? row('✈️ Vol retour', escapeHtml(b.customer_flight)) : ''}
    ${row('🧽 Lavage', washLabel(b.wash_type || 'none'))}
    ${b.has_covered_parking || b.has_priority_access ? row('Options', [b.has_covered_parking ? 'Parking couvert' : '', b.has_priority_access ? 'Accès prioritaire' : ''].filter(Boolean).join(' · ')) : ''}
    ${row('Total', `${Number(b.total_price)}€ (${due})`, { last: true })}
  </table>
</td></tr>
<tr><td style="padding:22px 40px 32px;text-align:center;">
  ${forAdmin
    ? `<a href="${process.env.SITE_URL || ''}/admin" style="display:inline-block;padding:12px 26px;background:#0B1426;color:#fff;text-decoration:none;border-radius:100px;font-weight:800;font-size:13px;">→ Ouvrir dans le back-office</a>`
    : (manageUrl ? `<a href="${escapeHtml(manageUrl)}" style="display:inline-block;padding:12px 26px;background:#1B5FA8;color:#fff;text-decoration:none;border-radius:100px;font-weight:800;font-size:14px;">Voir ma réservation</a>` : '')}
</td></tr>
<tr><td style="background:#0B1426;padding:20px 40px;text-align:center;"><p style="margin:0;color:rgba(255,255,255,0.6);font-size:12px;">Direct Voiturier · Aéroport Paris-Orly</p></td></tr>
</table></td></tr></table></body></html>`;
}
