/**
 * GET /api/health — diagnostic de configuration
 *
 * Répond à la seule question qui compte avant d'ouvrir les réservations :
 * « est-ce que ce déploiement peut réellement encaisser une réservation ? »
 *
 * Vérifie, sans jamais renvoyer la moindre valeur secrète :
 *   1. présence des variables d'environnement
 *   2. la base Supabase répond et contient la grille tarifaire
 *   3. la clé Stripe est valide (et si elle est en test ou en live)
 *   4. le domaine de FROM_EMAIL est bien vérifié dans Resend
 *   5. SITE_URL correspond au domaine réellement servi (retour de paiement Stripe)
 *
 * Accès : ?key=<ADMIN_PASSWORD>. Tant que ADMIN_PASSWORD n'est pas défini,
 * l'endpoint reste ouvert — c'est justement l'état où l'on a besoin de lui —
 * et il le signale dans sa réponse.
 */

const REQUIRED = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'RESEND_API_KEY',
  'FROM_EMAIL',
  'ADMIN_EMAIL',
  'SITE_URL',
  'ADMIN_PASSWORD',
  'ADMIN_SESSION_SECRET',
];

const PLACEHOLDER = /^(COLLER_ICI|TON_|change_moi|ton-email@)/i;

function isSet(name) {
  const v = process.env[name];
  return !!v && v.trim() !== '' && !PLACEHOLDER.test(v.trim());
}

export default async function handler(req, res) {
  const adminPassword = process.env.ADMIN_PASSWORD;
  const guarded = isSet('ADMIN_PASSWORD');
  if (guarded) {
    const key = (req.query && req.query.key) || '';
    if (key !== adminPassword) return res.status(404).json({ error: 'Not found' });
  }

  const problemes = [];
  const rapport = {
    ouvert_sans_mot_de_passe: !guarded || undefined,
    variables: {},
    supabase: null,
    stripe: null,
    resend: null,
    site_url: null,
  };

  // ─── 1. Variables d'environnement ───
  for (const name of REQUIRED) rapport.variables[name] = isSet(name) ? 'ok' : 'MANQUANTE';
  const manquantes = REQUIRED.filter((n) => !isSet(n));
  if (manquantes.length) {
    problemes.push(`Variables d'environnement manquantes sur Vercel : ${manquantes.join(', ')}`);
  }

  // ─── 2. Supabase ───
  if (isSet('SUPABASE_URL') && isSet('SUPABASE_SERVICE_ROLE_KEY')) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { count, error } = await db
        .from('pricing_rules')
        .select('*', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      rapport.supabase = { joignable: true, paliers_tarifaires: count };
      if (!count) {
        problemes.push(
          "La base répond mais la table pricing_rules est vide : le schéma n'a pas été exécuté " +
            '(SQL Editor → coller supabase/schema.sql → Run).'
        );
      }
    } catch (err) {
      rapport.supabase = { joignable: false, erreur: err.message };
      problemes.push(
        `Base Supabase injoignable (${err.message}). Aucun prix ne peut être calculé, ` +
          'aucune réservation enregistrée.'
      );
    }
  }

  // ─── 3. Stripe ───
  if (isSet('STRIPE_SECRET_KEY')) {
    try {
      const { default: Stripe } = await import('stripe');
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
      const balance = await stripe.balance.retrieve();
      rapport.stripe = {
        cle_valide: true,
        mode: balance.livemode ? 'LIVE (vrais paiements)' : 'TEST (carte 4242 uniquement)',
      };
    } catch (err) {
      rapport.stripe = { cle_valide: false, erreur: err.message };
      problemes.push(`Clé Stripe refusée (${err.message}). Aucun paiement possible.`);
    }
  }
  if (!isSet('STRIPE_WEBHOOK_SECRET')) {
    problemes.push(
      "STRIPE_WEBHOOK_SECRET absent : les paiements aboutiront mais le webhook ne pourra pas " +
        'confirmer les réservations (Stripe → Developers → Webhooks → endpoint /api/webhook, ' +
        "événement checkout.session.completed)."
    );
  }

  // ─── 4. Resend : le domaine d'envoi doit être vérifié ───
  if (isSet('RESEND_API_KEY')) {
    try {
      const r = await fetch('https://api.resend.com/domains', {
        headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const body = await r.json();
      const domaines = (body.data || []).map((d) => ({ nom: d.name, statut: d.status }));
      const verifies = domaines.filter((d) => d.statut === 'verified').map((d) => d.nom);
      rapport.resend = { cle_valide: true, domaines, verifies };

      const from = process.env.FROM_EMAIL || '';
      const match = from.match(/@([^>\s]+)/);
      const domaineFrom = match ? match[1].toLowerCase() : null;
      rapport.resend.domaine_expediteur = domaineFrom;
      if (domaineFrom && !verifies.includes(domaineFrom)) {
        problemes.push(
          `FROM_EMAIL utilise « ${domaineFrom} » qui n'est pas vérifié dans Resend ` +
            `(vérifiés : ${verifies.join(', ') || 'aucun'}). Les clients ne recevront ni ` +
            'confirmation ni consignes de prise en charge.'
        );
      }
    } catch (err) {
      rapport.resend = { cle_valide: false, erreur: err.message };
      problemes.push(`Clé Resend refusée (${err.message}). Aucun email ne partira.`);
    }
  }

  // ─── 5. SITE_URL = domaine réellement servi (retour Stripe) ───
  const host = req.headers['x-forwarded-host'] || req.headers.host || '';
  const siteUrl = process.env.SITE_URL || '';
  rapport.site_url = { configure: siteUrl, domaine_servi: host };
  if (siteUrl) {
    if (siteUrl.endsWith('/')) {
      problemes.push('SITE_URL se termine par « / » : les URL de retour Stripe seront malformées.');
    }
    let hostConfigure = '';
    try {
      hostConfigure = new URL(siteUrl).host;
    } catch {
      problemes.push(`SITE_URL n'est pas une URL valide : « ${siteUrl} ».`);
    }
    if (hostConfigure && host && hostConfigure !== host) {
      problemes.push(
        `SITE_URL pointe vers ${hostConfigure} alors que ce déploiement répond sur ${host} : ` +
          "après paiement, le client sera renvoyé ailleurs et ne verra pas sa confirmation."
      );
    }
  }

  return res.status(200).json({
    pret_a_encaisser: problemes.length === 0,
    problemes,
    rapport,
  });
}
