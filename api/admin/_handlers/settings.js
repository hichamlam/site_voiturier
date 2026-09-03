/**
 * /api/admin/settings — paramètres de contact & réassurance (clé/valeur)
 *
 * GET  : renvoie toutes les valeurs connues (chaîne vide si jamais renseigné)
 * PUT / POST : met à jour un sous-ensemble des clés, avec validation stricte
 *              côté serveur (téléphone FR, email, URL https, longueurs).
 *
 * Tolère l'absence de la table `settings` (base pas encore migrée avec
 * supabase/schema.sql) : GET renvoie alors des valeurs vides au lieu d'une
 * erreur 500, pour ne pas casser le reste du back-office.
 */
import { supabase, requireAdmin } from '../../_lib.js';

// Regex téléphone France : 0X XX XX XX XX ou +33 X XX XX XX XX (espaces,
// points ou tirets tolérés comme séparateurs).
const PHONE_FR = /^(?:\+33\s?|0)[1-9](?:[\s.-]?\d{2}){4}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isHttpsUrl(v) {
  try {
    const u = new URL(v);
    return u.protocol === 'https:';
  } catch {
    return false;
  }
}

// Déclaration des champs autorisés : type de validation + longueur max +
// libellé utilisé dans les messages d'erreur en français.
const FIELDS = {
  contact_phone: { label: 'Téléphone service client', type: 'phone', maxLen: 30 },
  contact_whatsapp: { label: 'Numéro WhatsApp', type: 'phone', maxLen: 30 },
  contact_email: { label: 'Email de contact', type: 'email', maxLen: 200 },
  contact_address: { label: 'Adresse postale / siège', type: 'text', maxLen: 300 },
  google_business_url: { label: 'Lien de la fiche Google Business Profile', type: 'url', maxLen: 500 },
  insurance_company: { label: "Nom de l'assureur", type: 'text', maxLen: 200 },
  insurance_policy_number: { label: 'Numéro de contrat RC pro', type: 'text', maxLen: 100 },
  ga4_id: { label: 'Identifiant GA4', type: 'text', maxLen: 50 },
  google_ads_id: { label: 'Identifiant Google Ads', type: 'text', maxLen: 50 },
};

function emptySettings() {
  const out = {};
  for (const key of Object.keys(FIELDS)) out[key] = '';
  return out;
}

// true si l'erreur Postgres signale que la table n'existe pas encore
// (42P01 = undefined_table), pour distinguer d'une vraie panne.
function isMissingTable(error) {
  return !!error && (error.code === '42P01' || /relation .* does not exist/i.test(error.message || ''));
}

function validateField(key, rawValue) {
  const def = FIELDS[key];
  if (!def) return { error: `Champ inconnu : ${key}` };
  const value = String(rawValue ?? '').trim();
  if (value === '') return { value }; // champ vidé volontairement : toujours autorisé
  if (value.length > def.maxLen) {
    return { error: `${def.label} : ${def.maxLen} caractères maximum` };
  }
  if (def.type === 'phone' && !PHONE_FR.test(value)) {
    return { error: `${def.label} : format de téléphone français invalide (ex. 06 12 34 56 78)` };
  }
  if (def.type === 'email' && !EMAIL_RE.test(value)) {
    return { error: `${def.label} : adresse email invalide` };
  }
  if (def.type === 'url' && !isHttpsUrl(value)) {
    return { error: `${def.label} : doit être un lien https:// valide` };
  }
  return { value };
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('settings').select('key, value');
      if (error) {
        if (isMissingTable(error)) return res.status(200).json({ settings: emptySettings() });
        return res.status(500).json({ error: error.message });
      }
      const settings = emptySettings();
      for (const row of data || []) {
        if (Object.prototype.hasOwnProperty.call(settings, row.key)) {
          settings[row.key] = row.value || '';
        }
      }
      return res.status(200).json({ settings });
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = req.body && typeof req.body === 'object' ? req.body : {};
      const providedKeys = Object.keys(body).filter(k => Object.prototype.hasOwnProperty.call(FIELDS, k));

      if (providedKeys.length === 0) {
        return res.status(400).json({ error: 'Aucun champ valide fourni' });
      }

      const rows = [];
      for (const key of providedKeys) {
        const result = validateField(key, body[key]);
        if (result.error) return res.status(400).json({ error: result.error });
        rows.push({ key, value: result.value, updated_at: new Date().toISOString() });
      }

      const { error } = await supabase.from('settings').upsert(rows, { onConflict: 'key' });
      if (error) {
        if (isMissingTable(error)) {
          return res.status(503).json({
            error: "La table « settings » n'existe pas encore dans Supabase. Exécute d'abord la migration SQL (supabase/schema.sql) puis réessaie.",
          });
        }
        return res.status(500).json({ error: error.message });
      }

      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/settings]', err);
    return res.status(500).json({ error: err.message });
  }
}
