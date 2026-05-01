# 🚗 Voiturier Orly — v2 finale

Site vitrine + tunnel de réservation Stripe + back-office complet, prêt à déployer.

---

## ✅ CE QUI EST DÉJÀ FAIT POUR TOI

J'ai pré-configuré ton **Supabase** automatiquement. Tu n'as RIEN à faire dessus, sauf récupérer **une seule clé secrète** (étape 1 ci-dessous).

**Projet Supabase créé :**
- Nom : `voiturier-orly`
- URL : `https://menkykunwhevlkbthubj.supabase.co`
- Région : Paris (eu-west-3)
- Toutes les tables créées et pré-remplies :
  - ✅ Tarifs (10 paliers)
  - ✅ Catégories véhicule (4 par défaut)
  - ✅ Suppléments horaires (4 tranches)
  - ✅ Options (parking couvert, accès prioritaire)
  - ✅ Jours fériés 2026 (11)
  - ✅ Templates messages (6 SMS/emails)
  - ✅ Sécurité RLS activée

Tu peux voir ton projet ici : https://supabase.com/dashboard/project/menkykunwhevlkbthubj

---

## 🚀 DÉPLOIEMENT — 4 ÉTAPES (≈ 25 minutes)

### Étape 1️⃣ — Récupérer la clé secrète Supabase (1 min)

1. Va sur : https://supabase.com/dashboard/project/menkykunwhevlkbthubj/settings/api-keys
2. Clique sur **Reveal** à côté de la clé `service_role` (la deuxième, marquée "secret")
3. Copie la valeur (commence par `eyJhbG...`) → ce sera `SUPABASE_SERVICE_ROLE_KEY`

⚠️ Cette clé donne un **accès total** à ta base de données. Ne la partage jamais, ne la mets jamais dans le code front. Elle ne va que dans les variables d'environnement Vercel.

### Étape 2️⃣ — Resend pour les emails (5 min)

1. Crée un compte gratuit sur https://resend.com (3000 emails/mois)
2. **Domains → Add Domain** → tape `voiturier-orly.fr`
3. Resend te donne 3 entrées DNS (TXT, MX, CNAME). Va sur OVH → Zone DNS → ajoute-les
4. Clique **Verify** sur Resend (5-10 min de propagation DNS)
5. **API Keys → Create** → copie la clé `re_...` → c'est `RESEND_API_KEY`

### Étape 3️⃣ — Stripe (3 min)

Tu as déjà Stripe pour Gooach. Tu peux soit utiliser le même compte, soit créer un compte séparé pour Voiturier Orly.

1. https://dashboard.stripe.com → **Developers → API keys** → copie la **Secret key** (`sk_live_...`)
2. Le webhook se fait **après** Vercel (étape 4) — saute pour l'instant

### Étape 4️⃣ — GitHub + Vercel + DNS (15 min)

1. **Push sur GitHub** (nouveau repo privé)
   ```bash
   cd voiturier
   git init && git add . && git commit -m "Initial"
   git remote add origin https://github.com/TON_USER/voiturier-orly.git
   git push -u origin main
   ```

2. **Vercel → Add New → Project → Import** depuis GitHub
   - Framework Preset : **Other**
   - **Environment Variables** : ouvre `.env.example` du projet et copie toutes les variables. Les valeurs Supabase y sont déjà pré-remplies. Tu n'as qu'à compléter :
     - `SUPABASE_SERVICE_ROLE_KEY` (étape 1)
     - `STRIPE_SECRET_KEY` (étape 3)
     - `RESEND_API_KEY` (étape 2)
     - `FROM_EMAIL` = `Voiturier Orly <contact@voiturier-orly.fr>`
     - `ADMIN_EMAIL` = ton email perso
     - `SITE_URL` = (mettre l'URL Vercel temporaire d'abord, ex. `https://voiturier-xxx.vercel.app`)
     - `ADMIN_PASSWORD` = un mot de passe long et fort
     - `ADMIN_SESSION_SECRET` = `openssl rand -base64 32` ou n'importe quel string aléatoire 32+ chars
   - `STRIPE_WEBHOOK_SECRET` = laisse vide pour l'instant
   - **Deploy**

3. **Stripe Webhook** (une fois Vercel déployé)
   - Stripe → **Developers → Webhooks → + Add endpoint**
   - URL : `https://TON-URL-VERCEL.vercel.app/api/webhook`
   - Event : `checkout.session.completed`
   - **Add** → page du webhook → **Signing secret → Reveal** → `whsec_...`
   - Retour Vercel → Settings → Env Variables → édite `STRIPE_WEBHOOK_SECRET` → **Redeploy**

4. **Domaine voiturier-orly.fr (OVH → Vercel)**
   - Vercel → **Settings → Domains** → ajoute `voiturier-orly.fr` et `www.voiturier-orly.fr`
   - Vercel te donne 2 entrées DNS (A pour la racine, CNAME pour www)
   - OVH → Zone DNS → ajoute-les → attends 10-30 min
   - Une fois propagé : Vercel → édite `SITE_URL` = `https://www.voiturier-orly.fr` → Redeploy

### Étape 5️⃣ — Test (5 min)

1. Ouvre `https://TON_DOMAINE`
2. Clique **Réserver** → fais une résa test (carte test Stripe : `4242 4242 4242 4242`, n'importe quelle date future)
3. Vérifie que tu reçois les 2 emails (client + admin)
4. Ouvre `https://TON_DOMAINE/admin` → connexion avec `ADMIN_PASSWORD`
5. Tu vois la résa, tu peux la confirmer / mettre en stock / restituer

---

## 🎯 STRUCTURE DU PROJET

```
voiturier/
├── api/
│   ├── _lib.js              # Helpers Supabase + auth + calcul prix
│   ├── _emails.js           # Templates HTML emails
│   ├── pricing.js           # Calcul prix (public)
│   ├── checkout.js          # Stripe Checkout
│   ├── booking.js           # Réservation paiement sur place
│   ├── webhook.js           # Webhook Stripe
│   └── admin/
│       ├── login.js         # Auth admin
│       ├── stats.js         # KPIs dashboard
│       ├── bookings.js      # CRUD réservations + pénalités retard
│       ├── clients.js       # CRUD clients
│       ├── pricing.js       # Grille + spéciaux + bloqués
│       ├── promos.js        # Codes promo
│       ├── vehicle-categories.js  # CRUD catégories véhicule
│       ├── surcharges.js    # CRUD suppléments + jours fériés
│       ├── quotes.js        # CRUD devis
│       ├── quotes-send.js   # Envoi devis par email
│       └── templates.js     # CRUD templates SMS/email
├── public/
│   ├── index.html           # Site vitrine + simulateur 3 étapes + tunnel 3 étapes
│   ├── style.css            # Tous les styles
│   ├── script.js            # Toute la logique front
│   ├── robots.txt
│   ├── sitemap.xml
│   └── admin/
│       └── index.html       # Back-office SPA complète
├── supabase/
│   └── schema.sql           # Schema complet (référence — déjà appliqué automatiquement)
├── package.json
├── vercel.json
├── .env.example             # Variables d'environnement
└── README.md                # Ce fichier
```

---

## 📊 FONCTIONNALITÉS

### Site public
- ✅ Hero cinématographique coucher de soleil + avion
- ✅ **Simulateur 3 étapes** dans la card (dates → catégorie → tarif → "Réserver")
- ✅ 3 étapes "Comment ça marche" : *On vous attend* / *Elle est entre de bonnes mains* / *Elle vous attend*
- ✅ Bande Google sous les étapes (4,9⭐ + 9 000 voyageurs)
- ✅ Tarifs simple (court séjour / semaine)
- ✅ Lavages : 3 cartes vitrine (Express / Complet ★ / Premium)
- ✅ Carrousel d'avis Google
- ✅ Tunnel de réservation **3 étapes** :
  1. Voyage + véhicule (catégorie + marque + modèle + plaque + couleur optionnelle)
  2. Coordonnées + lavage (4 options + badge "Le plus choisi" sur 69€) + options (parking couvert, accès prioritaire)
  3. Récap détaillé + code promo + paiement Stripe ou sur place
- ✅ Bouton "Continuer · 89€" qui se met à jour en temps réel
- ✅ Confirmation visuelle après paiement
- ✅ CGV protectrices intégrées (lien dans footer + tunnel)
- ✅ SEO complet (meta, OG, schema.org, sitemap)
- ✅ Mobile responsive parfait (proportions date/heure corrigées)

### Back-office `/admin`
- ✅ Login sécurisé (HMAC token, 24h)
- ✅ **Dashboard** : KPIs (revenus du mois, départs/retours du jour, voitures en stock)
- ✅ **Calendrier intelligent** : vue mois + vue semaine (départs en bleu, retours en orange, en stock comptabilisé)
- ✅ **Liste réservations** filtrable + workflow complet (Confirmer → Prise en charge → En stock → Restituer / Annuler)
- ✅ Édition complète d'une réservation (toutes les infos, toutes les dates, recalcul prix auto)
- ✅ Emplacement parking + notes internes
- ✅ Pénalités retard (aller + retour) — calcul auto, validation manuelle
- ✅ **Clients** : CRM complet, VIP, historique, total dépensé
- ✅ **Tarifs & dates** : grille tarifaire éditable, périodes spéciales, dates bloquées
- ✅ **Codes promo** : CRUD complet (% ou €, validité, max utilisations)
- ✅ **Catégories véhicule** : éditables (nom, surcoût voiturier, surcoût lavage, actif/inactif)
- ✅ **Suppléments & frais** : tranches horaires + jours fériés + options visibles client
- ✅ **Devis** : génération auto avec calcul de prix, envoi par email, conversion en réservation
- ✅ **Templates messages** : 6 pré-rédigés, copier-coller en 1 clic, modifiables

### Sécurité juridique
- ✅ Décharge totale de responsabilité par défaut
- ✅ Plafond 450€ uniquement avec état des lieux contradictoire (15€, mention discrète)
- ✅ Renonciation au droit de rétractation 14 jours (article L221-28 12°)
- ✅ Aucun remboursement obligatoire
- ✅ Pénalités retard automatiques (10€ après 30 min, 15€/heure ensuite)
- ✅ Exclusions complètes : objets, vol, mécanique, clés, climatique, vandalisme

---

## 🔧 GESTION QUOTIDIENNE

### Ouvrir l'admin
`https://www.voiturier-orly.fr/admin` puis ton mot de passe

### Modifier un tarif
Admin → **Tarifs & dates** → modifier la grille par paliers (1 jour 29€, 2 jours 49€, etc.)

### Tarif spécial pour une période
Admin → **Tarifs & dates → Tarifs spéciaux** : ex. Vacances de Noël, multiplicateur 1.20 (+20%)

### Bloquer des dates
Admin → **Tarifs & dates → Dates bloquées** → impossible de réserver sur ces dates

### Modifier une catégorie véhicule
Admin → **Catégories véhicule** → édite nom et surcoût (silencieux côté client)

### Ajouter un supplément horaire
Admin → **Suppléments & frais → Suppléments horaires** → ex. 23h-5h = +20€

### Créer un code promo
Admin → **Codes promo → Nouveau** → ex. ETE2026, -10%, validité 31 août 2026

### Workflow d'une réservation
Liste ou calendrier → clic sur la résa → flow :
1. **Confirmer** (si en attente)
2. **Prise en charge** (le client est arrivé)
3. **En stock** (voiture garée + emplacement, ex. B-12)
4. **Restituer** (rendue au client)

À tout moment : **Annuler**, **Mettre payé**, ajouter notes internes.

### Envoyer un message
Admin → **Messages → bouton "Copier"** → colle dans WhatsApp ou ton SMS

### Faire un devis
Admin → **Devis → Nouveau devis** → remplis le formulaire → Vercel calcule le prix → envoi auto par email → client peut payer en ligne plus tard

### Pénalités retard
Sur la fiche d'une réservation → toggle "Activer pénalités aller/retour" → entre l'heure réelle → le système calcule automatiquement → tu valides ou tu modifies

---

## 🛠️ DÉVELOPPEMENT LOCAL

```bash
npm install
npm install -g vercel
vercel login
vercel link
vercel env pull .env.local
vercel dev
```
Site sur `http://localhost:3000`, admin sur `http://localhost:3000/admin`

---

## ❓ DÉPANNAGE

**Les emails n'arrivent pas**
- Vérifie que ton domaine est bien validé chez Resend (DNS propagés)
- Logs Vercel : Vercel → Deployments → ta fonction → Logs

**Le webhook Stripe ne marche pas**
- Vérifie que `STRIPE_WEBHOOK_SECRET` correspond bien au webhook créé
- Dans Stripe → ton webhook → onglet "Recent deliveries" tu vois les requêtes/erreurs
- L'URL doit être **exactement** `https://ton-domaine/api/webhook`

**Erreur 401 sur /admin**
- Mot de passe incorrect, ou la session a expiré (24h max)
- Vérifie que `ADMIN_PASSWORD` est bien défini sur Vercel

**Le calcul de prix donne 0€**
- `SUPABASE_SERVICE_ROLE_KEY` mal configurée → les API ne peuvent pas lire la grille
- Test : `curl https://ton-domaine/api/pricing -H "Content-Type: application/json" -d '{"depDate":"2026-06-01","retDate":"2026-06-08"}'`

---

## 📋 CE QUI RESTE À FAIRE (côté humain)

Voici la checklist exhaustive de ce que tu dois faire à la main :

### Avant déploiement
- [ ] Récupérer la `SUPABASE_SERVICE_ROLE_KEY` (étape 1)
- [ ] Créer un compte Resend + valider domaine voiturier-orly.fr (DNS sur OVH)
- [ ] Récupérer la `STRIPE_SECRET_KEY` depuis ton dashboard Stripe

### Déploiement
- [ ] Push le code sur GitHub
- [ ] Importer le repo sur Vercel
- [ ] Ajouter les variables d'environnement (toutes celles du `.env.example`)
- [ ] Déployer
- [ ] Créer le webhook Stripe pointant vers `/api/webhook`
- [ ] Récupérer le `STRIPE_WEBHOOK_SECRET` et l'ajouter à Vercel + redeploy

### Domaine
- [ ] OVH → Zone DNS → ajouter les entrées DNS de Vercel pour voiturier-orly.fr
- [ ] Vercel → Settings → Domains → ajouter voiturier-orly.fr
- [ ] Modifier `SITE_URL` sur Vercel pour pointer vers ton domaine

### Tests
- [ ] Tester une réservation Stripe (carte test 4242…)
- [ ] Tester une réservation paiement sur place
- [ ] Tester l'admin (login, créer/modifier/annuler une résa)
- [ ] Tester le calendrier (vue mois + vue semaine)
- [ ] Tester un devis
- [ ] Vérifier la réception des emails (client + admin)

### Personnalisation (optionnel)
- [ ] Remplacer le logo SVG (avion) par ton vrai logo
- [ ] Ajouter `og-image.jpg` dans `/public` (image partage social, 1200x630px)
- [ ] Ajouter `favicon.svg` dans `/public`
- [ ] Mettre ton vrai téléphone dans le schema.org du `<head>` de `index.html` (actuellement `+33600000000`)
- [ ] Adapter les CGV avec ton SIRET/numéro RCS si besoin

### Marketing
- [ ] Configurer Google Search Console + soumettre le sitemap
- [ ] Configurer Google My Business (pour la note 4,9⭐ qui s'affiche)
- [ ] (Optionnel) Brevo/Twilio pour automatiser les SMS

---

## 🆘 SUPPORT

Si tu bloques sur une étape, dis-moi exactement où et je te débloque.

**Bonne route 🚗**
