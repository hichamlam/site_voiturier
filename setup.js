#!/usr/bin/env node
/**
 * 🚗 DIRECT VOITURIER — Script de setup interactif
 *
 * Lance avec : node setup.js
 *
 * Ce script :
 *  1. Vérifie que ton Supabase est accessible
 *  2. Te demande tes clés (Resend, Stripe, etc.)
 *  3. Génère un fichier .env.local prêt à l'emploi
 *  4. Te dit exactement ce qui reste à faire
 */

import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import crypto from 'node:crypto';

// ─── Couleurs terminal ──────────────────────────────────────
const c = {
  r: '\x1b[0m', b: '\x1b[1m', dim: '\x1b[2m',
  g: '\x1b[32m', y: '\x1b[33m', red: '\x1b[31m',
  cy: '\x1b[36m', mg: '\x1b[35m',
};
const log = (msg) => console.log(msg);
const ok = (msg) => log(`${c.g}✓${c.r} ${msg}`);
const ko = (msg) => log(`${c.red}✗${c.r} ${msg}`);
const info = (msg) => log(`${c.cy}ℹ${c.r} ${msg}`);
const title = (msg) => log(`\n${c.b}${c.mg}━━ ${msg} ━━${c.r}\n`);

// ─── Constantes Supabase pré-remplies ───────────────────────
const SUPABASE_URL = 'https://menkykunwhevlkbthubj.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lbmt5a3Vud2hldmxrYnRodWJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc2MjAzMzMsImV4cCI6MjA5MzE5NjMzM30.NeMoFsQ_MhYnQktADWl41gkdhlXQFj3dojRaHp5UG3U';
const PROJECT_DASHBOARD = 'https://supabase.com/dashboard/project/menkykunwhevlkbthubj';

const rl = readline.createInterface({ input, output });
const ask = (q) => rl.question(q);

// ─── Tests de connectivité ──────────────────────────────────
async function testSupabase() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pricing_rules?select=count`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` },
    });
    return res.ok || res.status === 401;
  } catch { return false; }
}

async function testServiceRole(key) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pricing_rules?select=*`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) ? data.length : 0;
  } catch { return null; }
}

async function testStripe(key) {
  if (!key.startsWith('sk_')) return false;
  try {
    const res = await fetch('https://api.stripe.com/v1/balance', {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch { return false; }
}

async function testResend(key) {
  if (!key.startsWith('re_')) return false;
  try {
    const res = await fetch('https://api.resend.com/domains', {
      headers: { Authorization: `Bearer ${key}` },
    });
    return res.ok;
  } catch { return false; }
}

// ─── Workflow ────────────────────────────────────────────────
async function main() {
  console.clear();
  log(`${c.b}${c.y}╔══════════════════════════════════════════════════╗${c.r}`);
  log(`${c.b}${c.y}║   🚗  DIRECT VOITURIER — Setup interactif         ║${c.r}`);
  log(`${c.b}${c.y}╚══════════════════════════════════════════════════╝${c.r}`);
  log(`\n${c.dim}Ce script va te guider pour configurer ton projet.${c.r}`);
  log(`${c.dim}Tu peux faire Ctrl+C à tout moment et relancer plus tard.${c.r}\n`);

  // ─── ÉTAPE 1 : Test Supabase ────────────────────────────
  title('1/5 — Vérification du Supabase');
  info('Test de la connexion à ton Supabase pré-configuré...');
  const sbOk = await testSupabase();
  if (sbOk) ok(`Supabase est UP : ${SUPABASE_URL}`);
  else { ko('Impossible de joindre Supabase. Vérifie ta connexion internet.'); process.exit(1); }

  // ─── ÉTAPE 2 : SUPABASE_SERVICE_ROLE_KEY ────────────────
  title('2/5 — Clé secrète Supabase (service_role)');
  log(`Cette clé donne accès à ta base. Va la chercher ici :\n`);
  log(`  ${c.cy}${PROJECT_DASHBOARD}/settings/api-keys${c.r}`);
  log(`\n  Onglet ${c.b}"Service role"${c.r} → ${c.b}Reveal${c.r} → copie la valeur (commence par eyJhbG...)`);
  const serviceKey = (await ask(`\n${c.b}Colle ta service_role key :${c.r} `)).trim();
  if (!serviceKey || !serviceKey.startsWith('eyJ')) {
    ko('Clé invalide. Une clé service_role commence par "eyJ".');
    process.exit(1);
  }
  info('Test de la clé...');
  const rules = await testServiceRole(serviceKey);
  if (rules === null) { ko('La clé ne fonctionne pas. Vérifie que tu as bien copié la SERVICE_ROLE.'); process.exit(1); }
  ok(`Clé valide ! ${rules} règles tarifaires détectées dans ta base.`);

  // ─── ÉTAPE 3 : Resend ───────────────────────────────────
  title('3/5 — Resend (envoi des emails)');
  log(`Crée un compte gratuit sur ${c.cy}https://resend.com${c.r} (3000 emails/mois)`);
  log(`Puis : ${c.b}Domains → Add → directvoiturier.com${c.r}, ajoute les DNS dans Vercel (domaine acheté là-bas), attends la validation`);
  log(`Enfin : ${c.b}API Keys → Create${c.r} → copie la clé "re_..."`);
  log(`${c.dim}(Tu peux mettre une clé bidon pour l'instant et changer plus tard sur Vercel)${c.r}`);
  const resendKey = (await ask(`\n${c.b}Colle ta clé Resend :${c.r} `)).trim();
  if (resendKey && resendKey.startsWith('re_')) {
    info('Test de la clé...');
    const r = await testResend(resendKey);
    if (r) ok('Clé Resend valide.');
    else log(`${c.y}⚠${c.r} La clé n'a pas répondu (à valider plus tard)`);
  } else if (resendKey) {
    log(`${c.y}⚠${c.r} Format inattendu, à valider plus tard`);
  }

  const fromEmail = (await ask(`${c.b}Email expéditeur${c.r} ${c.dim}[par défaut: contact@directvoiturier.com]${c.r} : `)).trim() || 'contact@directvoiturier.com';
  const adminEmail = (await ask(`${c.b}Ton email perso (pour recevoir les notifications)${c.r} : `)).trim();

  // ─── ÉTAPE 4 : Stripe ───────────────────────────────────
  title('4/5 — Stripe (paiement)');
  log(`Va sur ${c.cy}https://dashboard.stripe.com/apikeys${c.r}`);
  log(`Copie la ${c.b}Secret key${c.r} (sk_live_... ou sk_test_... pour tester)`);
  const stripeKey = (await ask(`\n${c.b}Colle ta Stripe Secret key :${c.r} `)).trim();
  if (stripeKey && stripeKey.startsWith('sk_')) {
    info('Test...');
    const s = await testStripe(stripeKey);
    if (s) ok('Clé Stripe valide.');
    else log(`${c.y}⚠${c.r} La clé n'a pas répondu`);
  }

  log(`\n${c.dim}Le webhook Stripe se crée APRÈS déploiement Vercel.${c.r}`);
  log(`${c.dim}Pour l'instant on met "skip", tu mettras la valeur après.${c.r}`);
  const stripeWebhook = (await ask(`${c.b}STRIPE_WEBHOOK_SECRET${c.r} ${c.dim}[laisse vide]${c.r} : `)).trim() || 'whsec_TO_FILL_AFTER_VERCEL_DEPLOY';

  // ─── ÉTAPE 5 : Admin ────────────────────────────────────
  title('5/5 — Admin back-office');
  let adminPwd = (await ask(`${c.b}Mot de passe admin${c.r} (16+ chars conseillé) : `)).trim();
  if (!adminPwd || adminPwd.length < 8) {
    log(`${c.y}⚠${c.r} Mot de passe trop court — j'en génère un fort pour toi`);
    adminPwd = crypto.randomBytes(16).toString('base64url');
    log(`   ${c.b}${c.g}Mot de passe généré : ${adminPwd}${c.r}`);
    log(`   ${c.y}⚠ NOTE-LE QUELQUE PART MAINTENANT.${c.r}`);
  }
  const sessionSecret = crypto.randomBytes(32).toString('base64url');
  ok('Secret de session généré automatiquement');

  const siteUrl = (await ask(`${c.b}URL du site${c.r} ${c.dim}[https://directvoiturier.com]${c.r} : `)).trim() || 'https://directvoiturier.com';

  // ─── Génération du fichier .env.local ───────────────────
  const envContent = `# Généré automatiquement par setup.js le ${new Date().toISOString()}

# ─── SUPABASE ───────────────────────────────────────────────
SUPABASE_URL=${SUPABASE_URL}
SUPABASE_ANON_KEY=${SUPABASE_ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${serviceKey}

# ─── STRIPE ─────────────────────────────────────────────────
STRIPE_SECRET_KEY=${stripeKey || 'sk_live_TO_FILL'}
STRIPE_WEBHOOK_SECRET=${stripeWebhook}

# ─── RESEND ─────────────────────────────────────────────────
RESEND_API_KEY=${resendKey || 're_TO_FILL'}
FROM_EMAIL="Direct Voiturier <${fromEmail}>"
ADMIN_EMAIL=${adminEmail || 'admin@example.com'}

# ─── SITE ───────────────────────────────────────────────────
SITE_URL=${siteUrl}

# ─── ADMIN ──────────────────────────────────────────────────
ADMIN_PASSWORD=${adminPwd}
ADMIN_SESSION_SECRET=${sessionSecret}
`;

  writeFileSync('.env.local', envContent);
  ok(`Fichier ${c.b}.env.local${c.r} créé avec toutes tes variables !`);

  // ─── Récap final ────────────────────────────────────────
  title('🎉 SETUP TERMINÉ');

  log(`${c.b}${c.g}Ton projet est prêt à être déployé.${c.r}\n`);

  log(`${c.b}📋 Ce qui a été fait :${c.r}`);
  ok('Supabase pré-configuré (projet menkykunwhevlkbthubj sur Paris)');
  ok('Toutes les tables créées (12 tables)');
  ok('Données par défaut insérées (tarifs, catégories, suppléments, fériés, templates)');
  ok('Sécurité RLS activée');
  ok('Fichier .env.local généré avec tes vraies valeurs');
  ok('Mot de passe admin et secret de session générés\n');

  log(`${c.b}📋 Ce qu'il te reste à faire :${c.r}\n`);
  log(`  ${c.b}1.${c.r} ${c.cy}Validation domaine Resend${c.r}`);
  log(`     → Resend → Domains → ajoute directvoiturier.com → ajoute les DNS dans Vercel (Domains → DNS Records)`);
  log(`     → Sans ça, les emails ne partiront pas\n`);
  log(`  ${c.b}2.${c.r} ${c.cy}Push GitHub${c.r}`);
  log(`     ${c.dim}git init && git add . && git commit -m "Initial"${c.r}`);
  log(`     ${c.dim}git remote add origin https://github.com/TON_USER/direct-voiturier.git${c.r}`);
  log(`     ${c.dim}git push -u origin main${c.r}\n`);
  log(`  ${c.b}3.${c.r} ${c.cy}Déploiement Vercel${c.r}`);
  log(`     → vercel.com → Add New → Import depuis GitHub`);
  log(`     → Settings → Environment Variables → copie tout le contenu de .env.local`);
  log(`     → Deploy\n`);
  log(`  ${c.b}4.${c.r} ${c.cy}Webhook Stripe${c.r}`);
  log(`     → Stripe → Webhooks → Add endpoint`);
  log(`     → URL : https://TON-URL.vercel.app/api/webhook`);
  log(`     → Event : checkout.session.completed`);
  log(`     → Signing secret → copie → Vercel → édite STRIPE_WEBHOOK_SECRET → Redeploy\n`);
  log(`  ${c.b}5.${c.r} ${c.cy}Domaine${c.r}`);
  log(`     → Domaine déjà acheté sur Vercel : Settings → Domains → ajoute directvoiturier.com`);
  log(`     → Mets à jour SITE_URL sur Vercel → Redeploy\n`);
  log(`  ${c.b}6.${c.r} ${c.cy}Tests${c.r}`);
  log(`     → Carte test Stripe : 4242 4242 4242 4242 (n'importe quelle date future)`);
  log(`     → Tester admin : https://TON_DOMAINE/admin`);
  log(`     → Mot de passe : ${c.b}${adminPwd}${c.r}\n`);

  log(`${c.b}${c.y}🆘  Tu peux relancer ce script à tout moment pour régénérer les clés.${c.r}\n`);
  log(`${c.dim}Bonne route 🚗${c.r}\n`);

  rl.close();
}

main().catch(err => {
  console.error(`\n${c.red}Erreur :${c.r}`, err.message);
  rl.close();
  process.exit(1);
});
