/**
 * FAQ DE L'ACCUEIL — source unique de la FAQ visible ET du JSON-LD FAQPage.
 * `a` peut contenir du HTML simple (strong, a) : le JSON-LD reprend le même texte, balises retirées.
 * `visible: true` = affichée d'emblée ; les autres sont derrière le bouton « Voir les N questions ».
 * Après modification :  npm run seo
 */
export const faqAccueil = (f) => [
  {
    visible: true,
    q: "Le prix affiché est-il vraiment le prix final ?",
    a: "Oui. Le tarif calculé inclut la prise en charge, la restitution et le gardiennage à Orly. Les seules options en plus sont celles que vous choisissez vous-même, toujours détaillées dans le récapitulatif <strong>avant</strong> le paiement.",
  },
  {
    visible: true,
    q: "Mon vol est retardé, que se passe-t-il ?",
    a: "Indiquez votre numéro de vol à la réservation : on le suit et votre voiturier est là quand vous atterrissez, même avec du retard.",
  },
  {
    visible: true,
    q: "Puis-je annuler ou modifier ma réservation ?",
    a: `Les réservations sont fermes selon nos conditions générales, mais nous étudions chaque demande au cas par cas et faisons un geste quand c'est possible, surtout si vous nous prévenez au moins 7 jours avant. Écrivez-nous à ${f.email}.`,
  },
  {
    q: "Voiturier ou parking officiel à Orly : qu'est-ce qui est le plus rapide ?",
    a: "Avec un voiturier, 0 minute de marche : vous déposez vos clés au dépose-minute de votre terminal. Avec un parking officiel, comptez 3 à 10 min à pied par trajet (P1, P2, P3), ou une navette d'environ 15 min (P Eco). <a href=\"#comparatif\">Voir le comparatif</a>",
  },
  {
    q: "Depuis quand êtes-vous à Orly ?",
    a: `Depuis ${f.yearsAtOrly}, avec ${f.travelers} voyageurs accompagnés et une note de ${f.ratingFr}/5 sur ${f.reviewCount} avis Google.`,
  },
  {
    q: "Quel est le prix pour un court séjour ?",
    a: `Dès ${f.prices.shortStay} € pour 1 jour, prise en charge, gardiennage et restitution compris. Le prix exact s'affiche dès que vous entrez vos dates.`,
  },
  {
    q: "Comment se passe la prise en charge à Orly ?",
    a: "Après votre réservation, vous recevez un email avec toutes les consignes. Le jour J, votre voiturier vous accueille directement au dépose-minute de votre terminal.",
  },
  {
    q: "Quels sont vos horaires ?",
    a: `Nos voituriers interviennent 7 jours sur 7, de 4h00 à minuit. Si votre vol part avant 4h00 ou atterrit après minuit, écrivez-nous avant de réserver à ${f.email}. <a href="/horaires-voiturier-orly">Voir nos horaires</a>`,
  },
  {
    q: "Comment payer ?",
    id: "faq-payment",
    a: "En ligne par carte bancaire via Stripe (paiement sécurisé, confirmation immédiate) ou sur place en carte ou espèces. Le montant est identique dans les deux cas.",
  },
  {
    q: "Où est garée ma voiture pendant mon voyage ?",
    a: "Votre véhicule est gardé sur notre parking à quelques minutes d'Orly. Une option parking couvert est proposée si vous préférez un emplacement à l'abri des intempéries.",
  },
];
