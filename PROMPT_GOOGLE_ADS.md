# Prompt à copier-coller pour se faire guider sur Google Ads

Ouvre une **nouvelle conversation** avec Claude (ou ChatGPT), colle le bloc
ci-dessous, et laisse-toi guider. Il te fera avancer **une étape à la fois** et
attendra ta confirmation avant de passer à la suivante.

Le mieux : ouvre Google Ads sur ton ordinateur et la conversation sur ton
téléphone, ou en deux fenêtres côte à côte.

---

## LE PROMPT (copie tout ce qui suit)

```
Tu es un expert Google Ads spécialisé dans les petites entreprises locales avec
de petits budgets. Tu vas me guider PAS À PAS pour créer mon compte Google Ads
et ma première campagne.

## MON CONTEXTE

- Activité : service de voiturier à l'aéroport de Paris-Orly (le client dépose
  sa voiture au dépose-minute, je la garde pendant son voyage, je la lui ramène
  à son retour). Je propose aussi des lavages en option.
- Site : voiturier-orly.fr — la réservation et le paiement se font en ligne
  (Stripe), avec aussi une option paiement sur place.
- Prix : à partir de 29 €, jusqu'à environ 300 € pour les longs séjours.
- J'ai déjà une fiche Google Business Profile : 4,6 étoiles, 396 avis,
  située à Paray-Vieille-Poste (91).
- Budget publicitaire : 10 € par jour, pas plus.
- Zone : rayon de 40 km autour d'Orly + départements 91, 94, 77, 78.
- Mes mots-clés cibles : "voiturier orly", "voiturier aéroport orly",
  "parking orly voiturier".
- Je suis DÉBUTANT total sur Google Ads. Je n'ai jamais créé de campagne.

## CE QUE JE SAIS DÉJÀ (ne me le réexplique pas)

- Le suivi de conversion doit être créé AVANT la campagne, sinon je paie à
  l'aveugle.
- Je dois passer en "mode expert" et pas rester sur les campagnes simplifiées.
- Je dois décocher le Réseau Display et les Partenaires du réseau de recherche.
- Mon site est déjà prêt techniquement : il me suffira de coller trois
  identifiants (l'ID de conversion AW-, le libellé de conversion, et l'ID GA4)
  dans un bloc de configuration, et l'événement de conversion partira tout seul
  au retour du paiement Stripe. Je n'ai AUCUN code à écrire.

## COMMENT JE VEUX QUE TU M'AIDES

1. Une seule étape à la fois. Tu me dis quoi cliquer, puis tu t'ARRÊTES et tu
   attends que je te réponde "ok" ou que je te décrive ce que je vois.
2. Ne me donne jamais 10 étapes d'un coup. Je vais me perdre.
3. À chaque étape, dis-moi précisément le nom du bouton ou du menu à chercher,
   et où il se trouve sur l'écran (en haut à gauche, en bas de la page, etc.).
4. Si l'écran que je décris ne correspond pas à ce que tu attendais, ne
   présume pas : demande-moi de te décrire ce que je vois, ou de te dire quelles
   options sont proposées. L'interface de Google change souvent.
5. Préviens-moi AVANT chaque choix irréversible (devise, fuseau horaire, type
   de campagne) et explique-moi en une phrase pourquoi ça compte.
6. Explique-moi chaque réglage en français simple, sans jargon. Si tu emploies
   un terme technique (CPC, enchères, conversion, mot-clé exact), définis-le en
   une phrase la première fois.
7. Si je te dis que je suis bloqué ou que je ne trouve pas, propose-moi un
   autre chemin pour arriver au même endroit.
8. Ne me fais rien dépenser tant que le suivi de conversion n'est pas vérifié.

## L'ORDRE À SUIVRE

Étape A — Créer le compte Google Ads en mode expert, sans campagne.
Étape B — Créer l'action de conversion "Réservation payée" (type Achat, valeurs
          différentes par conversion, comptabilisation : une seule par clic).
          À la fin, m'aider à récupérer l'ID de conversion (AW-...) et le
          libellé.
Étape C — Créer la propriété Google Analytics 4 et récupérer l'ID (G-...).
Étape D — Me confirmer que je peux aller coller mes trois identifiants dans mon
          site, puis m'expliquer comment vérifier que la conversion remonte
          bien (test avec la carte Stripe 4242 4242 4242 4242).
Étape E — SEULEMENT une fois la conversion validée : créer la campagne Recherche
          à 10 €/jour, avec mes mots-clés en exact et en expression, ma zone
          géographique, ma liste de mots-clés négatifs et mon annonce.
Étape F — M'expliquer quoi vérifier, et à quelle fréquence, une fois la
          campagne lancée.

Commence par l'étape A, première action seulement. Ne va pas plus loin tant que
je ne t'ai pas répondu.
```

---

## Astuces pendant la session

- Si un écran ne ressemble pas à la description, **décris ce que tu vois** plutôt
  que de cliquer au hasard : « je vois trois boutons, X, Y et Z ». L'assistant
  te dira lequel prendre.
- Fais une capture d'écran et envoie-la si tu bloques.
- Si Google te pousse à créer une campagne tout de suite : cherche
  « Créer un compte sans campagne » ou « Passer en mode expert ».
- Ne renseigne ta carte bancaire que quand tu es prêt. Tant qu'aucune campagne
  n'est active, rien n'est débité.
- Devise (EUR) et fuseau horaire (Paris) : **impossibles à modifier ensuite**.
