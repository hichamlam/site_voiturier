/**
 * /api/admin/ops — voituriers, affectations, emails automatiques
 *
 * GET                       : état complet (voituriers, affectations, modèles d'emails, interrupteur général)
 * PUT   {valets:[…]}        : enregistre la liste des voituriers
 * POST  {action:'assign', reference, leg:'dep'|'ret', valet_id|null}
 * POST  {action:'send-valet', reference, leg}     : envoie au client les coordonnées du voiturier
 * POST  {action:'send', reference, code}          : envoie un email maintenant (rappel, avis…)
 * POST  {action:'test', code, to?}                : envoie un exemple à l'adresse de notification
 * POST  {action:'master', enabled}                : interrupteur général des envois automatiques
 * POST  {action:'template', code, active?, subject?, body?, reset?}
 * POST  {action:'run'}                            : lance la tâche du soir tout de suite
 */
import { supabase, requireAdmin, getNotificationEmail } from '../../_lib.js';
import {
  CATALOG, VARIABLES, loadTemplates, getValets, saveValets, getAssignments, saveAssignments,
  autoEnabled, setSetting, sendAutoEmail, runAutoEmails,
} from '../../_autoemails.js';

const clean = (s, n) => String(s ?? '').trim().slice(0, n);

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const [valets, assignments, templates, enabled] = await Promise.all([
        getValets(), getAssignments(), loadTemplates(), autoEnabled(),
      ]);
      return res.status(200).json({ valets, assignments, templates, enabled, variables: VARIABLES });
    }

    if (req.method === 'PUT') {
      const list = Array.isArray(req.body?.valets) ? req.body.valets : null;
      if (!list) return res.status(400).json({ error: 'valets requis' });
      const valets = list.slice(0, 30).map((v, i) => ({
        id: clean(v.id, 40) || ('v' + Date.now().toString(36) + i),
        name: clean(v.name, 80),
        phone: clean(v.phone, 30),
        active: v.active !== false,
      })).filter(v => v.name);
      await saveValets(valets);
      return res.status(200).json({ valets });
    }

    if (req.method !== 'POST') return res.status(405).end();
    const body = req.body || {};

    switch (body.action) {
      case 'assign': {
        if (!body.reference || !['dep', 'ret'].includes(body.leg)) return res.status(400).json({ error: 'reference et leg requis' });
        const map = await getAssignments();
        const cur = map[body.reference] || {};
        if (body.valet_id) cur[body.leg] = body.valet_id; else delete cur[body.leg];
        if (Object.keys(cur).length) map[body.reference] = cur; else delete map[body.reference];
        await saveAssignments(map);
        return res.status(200).json({ assignments: map });
      }

      case 'send-valet': {
        const leg = body.leg === 'ret' ? 'ret' : 'dep';
        const { data: b } = await supabase.from('bookings').select('*').eq('reference', body.reference).maybeSingle();
        if (!b) return res.status(404).json({ error: 'Réservation introuvable' });
        const [valets, map] = await Promise.all([getValets(), getAssignments()]);
        const valet = valets.find(v => v.id === map[b.reference]?.[leg]);
        if (!valet) return res.status(400).json({ error: "Choisis d'abord un voiturier" });
        const out = await sendAutoEmail('valet_assigned_email', b, { leg, valet });
        return res.status(200).json({ success: true, to: out.to });
      }

      case 'send': {
        if (!CATALOG.some(c => c.code === body.code)) return res.status(400).json({ error: 'Modèle inconnu' });
        const { data: b } = await supabase.from('bookings').select('*').eq('reference', body.reference).maybeSingle();
        if (!b) return res.status(404).json({ error: 'Réservation introuvable' });
        const out = await sendAutoEmail(body.code, b);
        return res.status(200).json({ success: true, to: out.to });
      }

      case 'test': {
        if (!CATALOG.some(c => c.code === body.code)) return res.status(400).json({ error: 'Modèle inconnu' });
        const to = clean(body.to, 200) || await getNotificationEmail();
        const sample = {
          reference: 'TEST-0000', customer_firstname: 'Alex', customer_lastname: 'Exemple',
          customer_email: to, departure_date: new Date(Date.now() + 86400000).toISOString().slice(0, 10),
          departure_time: '08:30', departure_terminal: 'Orly 4',
          return_date: new Date(Date.now() + 8 * 86400000).toISOString().slice(0, 10),
          return_time: '20:15', return_terminal: 'Orly 1-2',
          car_brand: 'Renault', car_model: 'Clio', car_plate: 'AB-123-CD',
        };
        const valets = await getValets();
        const out = await sendAutoEmail(body.code, sample, {
          to, leg: 'dep', valet: valets[0] || { name: 'Prénom du voiturier', phone: '06 00 00 00 00' },
        });
        return res.status(200).json({ success: true, to: out.to });
      }

      case 'master': {
        await setSetting('auto_emails_enabled', body.enabled ? 'true' : 'false');
        return res.status(200).json({ enabled: !!body.enabled });
      }

      case 'template': {
        const def = CATALOG.find(c => c.code === body.code);
        if (!def) return res.status(400).json({ error: 'Modèle inconnu' });
        await loadTemplates(); // crée la ligne si elle n'existe pas encore
        const upd = {};
        if (body.reset) { upd.subject = def.subject; upd.body = def.body; }
        if (typeof body.subject === 'string') upd.subject = clean(body.subject, 300);
        if (typeof body.body === 'string') upd.body = String(body.body).slice(0, 6000);
        if (typeof body.active === 'boolean') upd.active = body.active;
        if (!Object.keys(upd).length) return res.status(400).json({ error: 'Rien à modifier' });
        if (upd.body !== undefined && !upd.body.trim()) return res.status(400).json({ error: 'Le texte ne peut pas être vide' });
        const { error } = await supabase.from('message_templates').update(upd).eq('code', body.code);
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ success: true, templates: await loadTemplates() });
      }

      case 'run': {
        return res.status(200).json(await runAutoEmails());
      }

      default:
        return res.status(400).json({ error: 'Action inconnue' });
    }
  } catch (err) {
    console.error('[admin/ops]', err);
    return res.status(500).json({ error: err.message });
  }
}
