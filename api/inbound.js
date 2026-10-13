/**
 * /api/inbound — transfert des mails reçus sur contact@directvoiturier.com
 *
 * Resend (réception activée sur le domaine) appelle cette route à chaque mail
 * reçu (événement `email.received`). On récupère le mail complet puis on le
 * renvoie vers l'adresse de notification (Paramètres admin, sinon ADMIN_EMAIL),
 * avec « Répondre à » = l'expéditeur d'origine.
 *
 * Expéditeur du transfert = contact@directvoiturier.com : l'adresse perso
 * n'apparaît jamais côté client.
 */
import { getNotificationEmail } from './_lib.js';

const API = 'https://api.resend.com';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const key = process.env.INBOUND_RESEND_KEY || process.env.RESEND_API_KEY;
  if (!key) return res.status(500).json({ error: 'Resend non configuré' });

  // Secret optionnel : si INBOUND_SECRET est défini, l'URL doit contenir ?s=<secret>
  if (process.env.INBOUND_SECRET && req.query?.s !== process.env.INBOUND_SECRET) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  try {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    if (body.type && body.type !== 'email.received') return res.status(200).json({ ignored: true });
    const id = body.data?.email_id || body.data?.id;
    if (!id) return res.status(400).json({ error: 'email_id manquant' });

    // On relit le mail chez Resend : un id inventé échoue ici.
    const r = await fetch(`${API}/emails/receiving/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    let mail;
    if (r.ok) {
      mail = await r.json();
    } else {
      // Clé sans droit de lecture (ex. « sending_access ») : on transfère au moins
      // les infos du webhook plutôt que de perdre le mail.
      console.error('[inbound] lecture du mail impossible:', r.status, await r.text());
      mail = { ...body.data, text: `(Le contenu n'a pas pu être lu — code ${r.status}. Ouvre le mail dans resend.com > Emails > Received.)` };
    }

    const FROM = process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';
    const dest = await getNotificationEmail();
    // Garde-fou anti-boucle : jamais de transfert vers une adresse du domaine
    if (/@directvoiturier\.com$/i.test(dest)) {
      console.error('[inbound] destination = domaine du site, transfert ignoré (renseigne Paramètres > Email de réception)');
      return res.status(200).json({ skipped: 'no external destination' });
    }
    const sender = mail.from || body.data?.from || '';
    const senderAddr = (sender.match(/<([^>]+)>/) || [null, sender])[1];
    const senderName = sender.replace(/<[^>]*>/, '').replace(/["']/g, '').trim() || senderAddr;

    const intro = `<p style="font:13px Arial;color:#64748b;margin:0 0 12px;border-bottom:1px solid #e2e8f0;padding-bottom:8px;">Mail reçu sur <b>${esc((mail.to || []).join(', ') || 'contact@directvoiturier.com')}</b> de <b>${esc(sender)}</b> — répondre à ce mail répond directement au client.</p>`;
    const html = intro + (mail.html || `<pre style="font:14px Arial;white-space:pre-wrap;">${esc(mail.text || '(message vide)')}</pre>`);

    const out = await fetch(`${API}/emails`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: `${senderName.replace(/[<>"]/g, '')} via Direct Voiturier <contact@directvoiturier.com>`,
        to: dest,
        reply_to: senderAddr,
        subject: mail.subject || '(sans objet)',
        html,
        text: mail.text || undefined,
      }),
    });
    if (!out.ok) {
      const t = await out.text();
      console.error('[inbound] forward:', out.status, t);
      return res.status(502).json({ error: 'transfert échoué' });
    }
    return res.status(200).json({ forwarded: true });
  } catch (err) {
    console.error('[inbound]', err);
    return res.status(500).json({ error: err.message });
  }
}
