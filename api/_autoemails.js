/**
 * Emails automatiques / semi-automatiques (hors confirmation de réservation).
 *
 * - Catalogue des emails (rappel J-1, voiturier assigné, demande d'avis) avec
 *   texte par défaut. Le texte modifiable et l'interrupteur « actif » vivent
 *   dans la table message_templates (déjà utilisée par l'onglet Messages).
 * - Voituriers et affectations : stockés dans la table `settings` (clé/valeur)
 *   sous les clés `valets` et `valet_assignments` (JSON) — aucune migration SQL.
 * - Interrupteur général `auto_emails_enabled` : tant qu'il n'est pas à « true »,
 *   la tâche planifiée n'envoie RIEN.
 * - Anti-doublon : une ligne `autosent:<réf>:<code>` dans `settings` par envoi.
 */
import { Resend } from 'resend';
import { supabase, getContactPhone } from './_lib.js';

export const CATALOG = [
  {
    code: 'reminder_d1_email',
    name: 'Rappel la veille du départ',
    when: 'Envoyé automatiquement la veille de la prise en charge (vers 17h).',
    mode: 'auto',
    subject: 'Rappel : votre prise en charge demain — {{reference}}',
    body:
`Bonjour {{firstname}},

Demain, vous nous confiez votre véhicule.

Comment ça se passe :
• Prévoyez d'arriver à Orly 3h avant votre vol
• Contactez-nous au {{phone_business}} 45 min avant votre arrivée à Orly
• Notre voiturier vous attend au Terminal {{terminal}}

Votre rendez-vous : {{dep_date}} à {{dep_time}}
Véhicule : {{car_brand}} {{car_model}} ({{car_plate}})

Bon voyage,
Direct Voiturier`,
  },
  {
    code: 'valet_assigned_email',
    name: 'Coordonnées du voiturier',
    when: 'Envoyé quand tu cliques « Envoyer au client » dans la réservation, après avoir choisi un voiturier.',
    mode: 'manual',
    subject: 'Votre voiturier — {{reference}}',
    body:
`Bonjour {{firstname}},

Voici le voiturier qui s'occupera de votre véhicule ({{leg_label}}) :

{{valet_name}}
Téléphone : {{valet_phone}}

Rendez-vous : {{leg_date}} à {{leg_time}} — Terminal {{leg_terminal}}

N'hésitez pas à l'appeler directement si besoin.

À très vite,
Direct Voiturier`,
  },
  {
    code: 'post_review_email',
    name: "Demande d'avis après le retour",
    when: 'Envoyé automatiquement le lendemain du retour, si la réservation est marquée « Rendue ».',
    mode: 'auto',
    subject: 'Merci pour ce voyage, {{firstname}}',
    body:
`Bonjour {{firstname}},

Merci d'avoir choisi Direct Voiturier. Votre avis compte beaucoup pour nous :
{{google_review_link}}

À très bientôt,
Direct Voiturier`,
  },
];

export const VARIABLES = [
  'firstname', 'lastname', 'reference', 'dep_date', 'dep_time', 'terminal',
  'ret_date', 'ret_time', 'ret_terminal', 'car_brand', 'car_model', 'car_plate',
  'phone_business', 'google_review_link', 'valet_name', 'valet_phone',
  'leg_label', 'leg_date', 'leg_time', 'leg_terminal',
];

// ─── settings clé/valeur ───
export async function getSetting(key) {
  const { data } = await supabase.from('settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? '';
}
export async function setSetting(key, value) {
  const { error } = await supabase.from('settings')
    .upsert({ key, value: String(value), updated_at: new Date().toISOString() }, { onConflict: 'key' });
  if (error) throw new Error(error.message);
}
async function getJSON(key, fallback) {
  try {
    const raw = await getSetting(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch { return fallback; }
}

export const getValets = () => getJSON('valets', []);
export const getAssignments = () => getJSON('valet_assignments', {});
export async function saveValets(list) { await setSetting('valets', JSON.stringify(list)); }
export async function saveAssignments(map) { await setSetting('valet_assignments', JSON.stringify(map)); }
export async function autoEnabled() { return (await getSetting('auto_emails_enabled')) === 'true'; }

// ─── modèles (message_templates) ───
export async function loadTemplates() {
  const { data } = await supabase.from('message_templates').select('*').eq('channel', 'email');
  const byCode = new Map((data || []).map(t => [t.code, t]));
  const out = [];
  for (const def of CATALOG) {
    let row = byCode.get(def.code);
    if (!row) {
      // Créé désactivé : rien ne part tant que le propriétaire n'a pas coché.
      const ins = await supabase.from('message_templates').insert({
        code: def.code, name: def.name, channel: 'email',
        subject: def.subject, body: def.body, active: false,
      }).select().single();
      row = ins.data || { code: def.code, name: def.name, subject: def.subject, body: def.body, active: false };
    }
    out.push({ ...row, when: def.when, mode: def.mode, defaults: { subject: def.subject, body: def.body } });
  }
  return out;
}

// ─── rendu ───
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function frDate(iso) {
  if (!iso) return '';
  const d = new Date(String(iso).slice(0, 10) + 'T12:00:00Z');
  return d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}
const hhmm = t => (t ? String(t).slice(0, 5) : '');

export function buildVars(b, extra = {}) {
  return {
    firstname: b.customer_firstname || '',
    lastname: b.customer_lastname || '',
    reference: b.reference || '',
    dep_date: frDate(b.departure_date), dep_time: hhmm(b.departure_time),
    terminal: b.departure_terminal || 'indiqué',
    ret_date: frDate(b.return_date), ret_time: hhmm(b.return_time),
    ret_terminal: b.return_terminal || 'indiqué',
    car_brand: b.car_brand || '', car_model: b.car_model || '', car_plate: b.car_plate || '',
    phone_business: extra.phone || 'notre numéro (indiqué sur directvoiturier.com)',
    google_review_link: extra.reviewLink || '',
    valet_name: extra.valetName || '', valet_phone: extra.valetPhone || '',
    leg_label: extra.legLabel || '', leg_date: extra.legDate || '',
    leg_time: extra.legTime || '', leg_terminal: extra.legTerminal || '',
  };
}

export function fill(text, vars) {
  return String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (vars[k] ?? ''));
}

function linkify(escaped) {
  return escaped.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="color:#1B5FA8;font-weight:700;">$1</a>');
}

export function wrapHTML(bodyText, phone) {
  const paras = esc(bodyText).split(/\n{2,}/).map(p =>
    `<p style="margin:0 0 16px;font-size:15px;line-height:1.65;color:#0B1426;">${linkify(p).replace(/\n/g, '<br>')}</p>`
  ).join('');
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#F8FAFC;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#F8FAFC;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;width:100%;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 32px rgba(11,20,38,0.08);">
<tr><td style="background:#1B5FA8;background-image:linear-gradient(135deg,#12406F,#2E7FD3);padding:24px 30px;">
<div style="color:#fff;font-weight:800;font-size:19px;letter-spacing:-0.01em;">Direct Voiturier</div>
<div style="color:rgba(255,255,255,0.75);font-size:11px;letter-spacing:0.16em;text-transform:uppercase;margin-top:3px;">Voiturier à Orly</div>
</td></tr>
<tr><td style="padding:30px 30px 14px;">${paras}</td></tr>
<tr><td style="padding:16px 30px 24px;border-top:1px solid #EEF2F7;font-size:12px;color:#64748B;line-height:1.6;">
Direct Voiturier · voiturier à l'aéroport d'Orly${phone ? ` · <a href="tel:${esc(phone.replace(/\s/g, ''))}" style="color:#1B5FA8;font-weight:700;text-decoration:none;">${esc(phone)}</a>` : ''}<br>
<a href="https://www.directvoiturier.com" style="color:#1B5FA8;">directvoiturier.com</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

function getResend() { return new Resend(process.env.RESEND_API_KEY); }
const FROM = () => process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';

/**
 * Envoie l'email `code` pour la réservation `b`.
 * opts : { to (forcer le destinataire, pour les tests), leg ('dep'|'ret'), valet }
 */
export async function sendAutoEmail(code, b, opts = {}) {
  if (!process.env.RESEND_API_KEY) throw new Error('Resend non configuré');
  const templates = await loadTemplates();
  const t = templates.find(x => x.code === code);
  if (!t) throw new Error('Modèle inconnu : ' + code);

  const phone = await getContactPhone();
  const reviewLink = await getSetting('google_business_url');
  const extra = { phone, reviewLink };

  if (code === 'valet_assigned_email') {
    const leg = opts.leg === 'ret' ? 'ret' : 'dep';
    extra.valetName = opts.valet?.name || '';
    extra.valetPhone = opts.valet?.phone || '';
    extra.legLabel = leg === 'dep' ? 'à la prise en charge' : 'au retour';
    extra.legDate = frDate(leg === 'dep' ? b.departure_date : b.return_date);
    extra.legTime = hhmm(leg === 'dep' ? b.departure_time : b.return_time);
    extra.legTerminal = (leg === 'dep' ? b.departure_terminal : b.return_terminal) || 'indiqué';
  }

  const vars = buildVars(b, extra);
  const subject = fill(t.subject, vars);
  const text = fill(t.body, vars);
  const to = opts.to || b.customer_email;
  if (!to || /@sans-email\.invalid$/i.test(to)) throw new Error("Ce client n'a pas d'adresse email");
  const res = await getResend().emails.send({ from: FROM(), to, subject, html: wrapHTML(text, phone), text });
  if (res?.error) throw new Error(res.error.message || 'Échec Resend');
  return { to, subject };
}

// ─── tâche planifiée ───
function parisISO(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86400000);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

async function alreadySent(ref, code) {
  const { data } = await supabase.from('settings').select('key').eq('key', `autosent:${ref}:${code}`).maybeSingle();
  return !!data;
}
const markSent = (ref, code) => setSetting(`autosent:${ref}:${code}`, new Date().toISOString());

export async function runAutoEmails() {
  const report = { enabled: false, sent: [], skipped: 0, errors: [] };
  if (!(await autoEnabled())) return report;
  report.enabled = true;

  const templates = await loadTemplates();
  const active = code => templates.find(t => t.code === code)?.active === true;
  const reviewLink = await getSetting('google_business_url');

  const jobs = [];
  if (active('reminder_d1_email')) {
    const { data } = await supabase.from('bookings').select('*')
      .eq('departure_date', parisISO(1)).neq('status', 'cancelled');
    for (const b of data || []) jobs.push({ code: 'reminder_d1_email', b });
  }
  if (active('post_review_email') && reviewLink) {
    const { data } = await supabase.from('bookings').select('*')
      .eq('return_date', parisISO(-1)).eq('status', 'returned');
    for (const b of data || []) jobs.push({ code: 'post_review_email', b });
  }

  for (const { code, b } of jobs) {
    try {
      if (!b.customer_email || await alreadySent(b.reference, code)) { report.skipped++; continue; }
      await sendAutoEmail(code, b);
      await markSent(b.reference, code);
      report.sent.push(`${code}:${b.reference}`);
    } catch (e) {
      report.errors.push(`${code}:${b.reference}: ${e.message}`);
    }
  }
  return report;
}
