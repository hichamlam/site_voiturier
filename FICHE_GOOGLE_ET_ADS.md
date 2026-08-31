# Fiche Google + Google Ads — marche à suivre

Deux chantiers. Le premier est gratuit et c'est le plus rentable : votre fiche
existe déjà avec **4,6 ⭐ sur 396 avis**, elle est simplement mal rangée. Le
second est payant et ne doit démarrer qu'une fois le suivi de conversion posé.

---

## CHANTIER 1 — La fiche Google (30 min, gratuit)

### 1.1 Changer la catégorie principale ⚠️ le point le plus important

Aujourd'hui votre fiche est classée **« Parking »**. Google ne vous propose donc
pas — ou très mal — à quelqu'un qui tape « direct voiturier ». La catégorie
principale est le premier critère de tri du référencement local : c'est elle qui
décide des recherches sur lesquelles vous apparaissez.

1. Ouvrez Google Maps (ou tapez « direct voiturier » sur Google en étant connecté
   au compte qui gère la fiche), puis ouvrez votre fiche
2. Cliquez **Modifier le profil** → onglet **À propos**
3. Section **Catégorie d'activité** → **Catégorie principale**
4. Effacez « Parking » et tapez **Service de voiturier**
   → sélectionnez la suggestion de Google (ne créez rien à la main)
5. Dans **Autres catégories**, ajoutez dans cet ordre :
   - `Parking d'aéroport`
   - `Parking`
   - `Service de nettoyage de voitures` *(si vous vendez les lavages)*
6. **Enregistrer**

Le changement est parfois relu par Google : comptez de quelques heures à
3 jours. Ne le refaites pas plusieurs fois de suite, cela rallonge la revue.

### 1.2 Le champ Site Web

Toujours dans **Modifier le profil** → **Coordonnées** → **Site Web** :
mettez `https://directvoiturier.com`

C'est ce lien qui transfère la crédibilité de vos 396 avis vers le site.

### 1.3 Récupérer les deux liens dont j'ai besoin

**Lien de la fiche** (pour afficher « Voir les avis sur Google » sur le site) :
fiche → bouton **Partager** → **Copier le lien**
→ vous obtenez quelque chose comme `https://maps.app.goo.gl/AbCdEf123`

**Lien de demande d'avis** (à envoyer aux clients) :
dans la gestion de votre fiche → **Demander des avis** → Google génère un lien
court `https://g.page/r/.../review` qui ouvre directement la fenêtre de notation.
Ce lien va dans le modèle « Demande d'avis » de votre back-office, à la place de
`{{google_review_link}}` (Admin → Messages).

Envoyez-moi le premier, je le branche sur le site — tout est déjà prêt côté code,
il n'y a qu'une valeur à coller.

### 1.4 Horaires et photos

- **Horaires** : mettez 24h/24 si vous assurez les vols de nuit. Une fiche sans
  horaires perd les recherches « ouvert maintenant », fréquentes à l'aéroport.
- **Photos** : 8 à 10 suffisent. Vos voituriers au dépose-minute, une voiture
  confiée, le badge/la tenue, un intérieur après lavage. Prises au téléphone,
  c'est très bien — Google privilégie la fraîcheur, pas le studio.
- Republiez 2 ou 3 photos par mois : les fiches actives sortent devant.

### 1.5 Le réflexe qui fait tout le reste

Demandez l'avis **au moment où vous rendez les clés**, pas le lendemain. Le
client est content, il a 30 secondes, il le fait. Envoyez le lien court par SMS
ou WhatsApp dans la foulée.

À 396 avis vous êtes déjà crédible ; l'enjeu maintenant est la **fraîcheur**.
Google et les clients regardent les avis des 3 derniers mois. Trois avis par
semaine suffisent à tenir le rang.

⚠️ N'achetez jamais d'avis et ne filtrez pas les clients mécontents en amont
(« je vous envoie le lien seulement si tout s'est bien passé »). Google détecte
les deux et une fiche sanctionnée à 396 avis, c'est six ans de travail perdus.

---

## CHANTIER 2 — Google Ads (10 €/jour)

**L'ordre compte.** Le suivi de conversion se pose AVANT la première campagne,
sinon vous payez sans savoir quel clic devient une réservation.

### 2.1 Créer le compte en mode expert

1. `ads.google.com` → **Commencer**
2. Google lance un assistant simplifié : cherchez le lien discret
   **« Passer en mode expert »** (en bas de l'écran) et cliquez dessus
3. Si l'assistant insiste pour créer une campagne : **« Créer un compte sans
   campagne »**, puis validez le pays (France), la devise (EUR) et le fuseau

⚠️ La devise et le fuseau **ne peuvent plus être modifiés** ensuite.

Le mode expert n'est pas un détail : le mode simplifié (Smart Campaigns) diffuse
partout, sans mots-clés négatifs, et brûle 10 €/jour en clics inutiles.

### 2.2 Créer l'action de conversion (AVANT la campagne)

1. Menu **Objectifs** → **Conversions** → **Actions de conversion**
2. **+ Nouvelle action de conversion** → **Site Web**
3. Saisissez `directvoiturier.com` → **Analyser**. Google ne trouvera rien
   (normal, aucune balise n'est encore posée) → choisissez **« Ajouter
   manuellement une action de conversion »**
4. Réglages :
   - Catégorie : **Achat**
   - Nom : `Réservation payée`
   - Valeur : **Utiliser des valeurs différentes pour chaque conversion**
     (une réservation à 29 € ne vaut pas une réservation à 200 €)
   - Comptabilisation : **Une seule** ⚠️ *(sinon un client qui recharge la page
     de confirmation compte plusieurs réservations et fausse tout le pilotage)*
   - Fenêtre de conversion : 30 jours
5. **Créer et continuer** → **Installer la balise vous-même**
6. Notez les deux valeurs affichées :
   - **ID de conversion** : `AW-XXXXXXXXXX`
   - **Libellé de conversion** : une dizaine de caractères, ex. `AbCdEfGhIj`

### 2.3 Créer la propriété GA4 (gratuit, 5 min)

`analytics.google.com` → **Administration** → **Créer** → **Propriété** →
plateforme Web → URL du site. Vous obtenez un identifiant `G-XXXXXXXXXX`.

Utile pour voir où les visiteurs abandonnent dans le tunnel — donc quoi corriger.

### 2.4 Coller les trois identifiants dans le site

Dans `public/index.html`, en haut du fichier :

```js
window.VO_ANALYTICS = {
  GA4_ID: 'G-XXXXXXXXXX',
  ADS_ID: 'AW-XXXXXXXXXX',
  ADS_CONVERSION_LABEL: 'AbCdEfGhIj',
};
```

Puis redéployez (un `git push` suffit, Vercel republie tout seul).

Rien d'autre à câbler : la conversion `purchase` part automatiquement au retour
du paiement Stripe, avec le montant réel de la réservation. Le bandeau cookies
s'affiche également de lui-même dès qu'un identifiant est renseigné (Consent
Mode v2 : tout est refusé par défaut, conformément au RGPD).

### 2.5 Vérifier que ça remonte

Faites une réservation test avec la carte Stripe `4242 4242 4242 4242`
(date future, CVC au hasard), puis ouvrez **Objectifs → Conversions**.

Le statut passe de « Inactif » à **« Enregistre des conversions »** sous 24 à
48 h. **Ne lancez pas la campagne avant d'avoir vu ce statut** : c'est la seule
preuve que le suivi fonctionne.

### 2.6 Monter la campagne

Suivez `GOOGLE_ADS_10_EUROS_PAR_JOUR.md` — mots-clés, annonces, zone
géographique et exclusions y sont déjà rédigés. Trois pièges à la création :

1. **Décochez « Réseau Display »** — coché par défaut, c'est le premier poste de
   gaspillage sur un petit budget
2. **Décochez « Partenaires du réseau de recherche »**
3. **Ciblage géographique** : choisissez **« Présence : personnes se trouvant
   régulièrement dans les zones ciblées »**, et non « intérêt pour » — sinon
   vous payez des clics venant du monde entier

Deux fois par semaine, 10 minutes : **Mots-clés → Termes de recherche**, et
excluez tout ce qui est hors sujet. C'est la seule discipline qui rend un budget
de 10 €/jour rentable.

---

## Ordre de priorité si vous manquez de temps

1. Catégorie principale de la fiche → **Service de voiturier** *(15 min, gratuit,
   c'est le meilleur rapport effort/résultat de toute cette liste)*
2. Champ Site Web + lien de la fiche à me transmettre
3. Numéro de téléphone sur le site *(votre numéro et je le pose)*
4. Demande d'avis systématique à la remise des clés
5. Google Ads

Les quatre premiers sont gratuits et produisent des réservations avant même la
première campagne payante.
