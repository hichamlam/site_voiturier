# Campagne Google Ads — 10 €/jour — Direct Voiturier

Objectif : **des réservations payées**, pas des clics. Tout est réglé pour un
petit budget : peu de mots-clés, très ciblés, zone géographique serrée, et un
suivi de conversion branché sur la vraie réservation payée (retour Stripe).

---

## 0. Prérequis (une seule fois, ~30 min)

1. **Créer la conversion avant de lancer la campagne** :
   - Google Ads → Objectifs → Conversions → **+ Nouvelle action de conversion** → Site web
   - Type : *Achat* · Nom : `Réservation payée` · Valeur : utiliser la valeur de la transaction
   - Comptabilisation : **Une seule** par clic
   - Récupérer l'**ID de conversion** (`AW-XXXXXXXXXXX`) et le **libellé** (`AbCdEfGhIj`)
2. **Brancher le site** : dans `public/index.html`, bloc `window.VO_ANALYTICS`,
   remplir `ADS_ID` et `ADS_CONVERSION_LABEL` (et `GA4_ID` si tu crées une
   propriété GA4 — recommandé, gratuit). Redéployer.
   → La conversion `purchase` part automatiquement au retour du paiement
   Stripe (`/?paid=1`). Rien d'autre à faire côté site.
3. Faire une réservation test (carte `4242 4242 4242 4242` en mode test
   Stripe) et vérifier dans Google Ads → Conversions que le statut passe à
   « Enregistre des conversions » sous 24-48 h.

## 1. Structure de la campagne

- **Type** : Réseau de Recherche uniquement (PAS de Display, PAS de partenaires
  de recherche — décocher les deux cases à la création).
- **Budget** : 10 €/jour.
- **Enchères** :
  - Semaines 1-3 : **Maximiser les clics** avec **CPC max plafonné à 0,80 €**
    (le temps d'accumuler des données).
  - Dès ~15 conversions cumulées : passer en **Maximiser les conversions**
    (puis CPA cible ~8-12 € une fois stable).
- **Zone géographique** : rayon de **40 km autour de l'aéroport d'Orly** +
  départements 91, 94, 77, 78. Option de ciblage : « Présence : personnes se
  trouvant régulièrement dans les zones ciblées » (pas « intérêt pour »).
- **Langue** : français.
- **Calendrier** : laisser 24h/24 (les gens réservent le soir).

## 2. Groupe d'annonces unique — mots-clés

En **exact** et **expression** uniquement (jamais de requête large avec 10 €/jour) :

```
[direct voiturier]
[voiturier aéroport orly]
[parking orly voiturier]
[parking orly avec voiturier]
"direct voiturier"
"voiturier aéroport orly"
"parking orly voiturier"
```

## 3. Mots-clés à exclure (liste négative)

```
emploi
recrutement
salaire
offre
job
chauffeur
taxi
vtc
uber
navette
gratuit
location voiture
louer
roissy
cdg
beauvais
avis        ← à retirer plus tard si tu veux capter la comparaison
définition
c'est quoi
```

## 4. Annonce responsive (RSA)

**Titres** (Google en combine 3) :
1. Voiturier à l'Aéroport d'Orly
2. Réservez Votre Direct Voiturier
3. Dès 29€ — Prix Total Affiché
4. Déposez Votre Voiture à Orly
5. Prise en Charge au Dépose-Minute
6. Tarif en 30 Secondes en Ligne
7. Confirmation Immédiate par Email
8. Sans Navette, Sans Détour

**Descriptions** :
1. Obtenez votre tarif avant de réserver. Prix total affiché, paiement sécurisé en ligne ou sur place.
2. Vous descendez au dépose-minute, on prend les clés. Votre voiture vous attend au retour.
3. Réservation en ligne en 2 minutes. Consignes de rendez-vous envoyées par email.

**URL finale** : la page d'accueil.
**Extensions** : ajouter des extensions de liens annexes (Tarifs, Comment ça
marche, FAQ, Avis → ancres #prix #service #faq #avis), extensions d'accroche
(« Prix total avant paiement », « Paiement sécurisé Stripe », « Confirmation
immédiate ») et l'extension d'appel **quand le numéro pro existera**.

## 5. Rythme de pilotage (10 min, 2×/semaine)

1. **Mots-clés → Termes de recherche** : exclure toute requête hors sujet
   (c'est LA discipline qui sauve un petit budget).
2. Vérifier le CPC moyen : s'il dépasse ~0,80 €, baisser le plafond.
3. Ne rien toucher d'autre pendant 2 semaines : l'algorithme a besoin de
   stabilité.
4. Mesure du succès : **coût / réservation payée**, pas le CTR. À 10 €/jour et
   ~0,50-0,80 € le clic ⇒ ~13-20 clics/jour ⇒ avec 3-5 % de conversion,
   attendre ~2-5 réservations/semaine une fois rodé.

## 6. En parallèle (gratuit, fort impact)

- Créer la **fiche Google Business Profile** (catégorie : Service de voiturier /
  Parking) — indispensable pour le SEO local et les vrais avis.
- **Google Search Console** : ajouter le site, soumettre `sitemap.xml`.
- Demander un avis Google à chaque client restitué (lien direct de la fiche).
