/**
 * AVIS CLIENTS AFFICHÉS SUR L'ACCUEIL (carrousel « Ils nous ont confié leur voiture »)
 *
 * Avis copiés-collés par Alex, mot pour mot. Ne jamais inventer un avis
 * ni modifier son texte (pratique commerciale trompeuse).
 *
 *  name   : prénom + initiale du nom, ex. "Marie C."
 *  rating : note donnée (1 à 5)
 *  trip   : sous-titre affiché sous le nom (destination · durée, ou date)
 *  text   : texte de l'avis, copié tel quel
 *
 * Un avis dont un champ contient encore "TODO_ALEX" n'est pas affiché.
 * Après modification :  npm run seo
 */
export const reviews = [
  { name: "Marie C.", rating: 5, trip: "Bali · 14 jours", text: "Voyage à Bali, retour épuisée à 6h du matin. La voiture m'attendait, propre, à l'endroit prévu. C'est la deuxième fois. Ce sera la troisième." },
  { name: "Thomas R.", rating: 5, trip: "Voyageur fréquent", text: "Je voyage chaque mois pour le travail. Ils savent mon prénom, ma plaque, mes habitudes. C'est ça, le vrai service premium." },
  { name: "Sophie L.", rating: 5, trip: "Lisbonne · 7 jours", text: "Première fois que je laisse ma voiture à quelqu'un. Lavage premium au retour. Je ne reconnaissais plus l'intérieur. Adoptée." },
  { name: "David M.", rating: 5, trip: "New York · 10 jours", text: "Service ultra rapide à l'aller comme au retour. Plus jamais de parking longue durée pour moi. Que du gain de temps." },
  { name: "Aïcha B.", rating: 5, trip: "Marrakech · 5 jours", text: "Avec deux enfants en bas âge et les bagages, c'était un soulagement. Le voiturier nous a même aidés à sortir la poussette." },
  { name: "Julien P.", rating: 5, trip: "Rome · 4 jours", text: "Ponctuel, pro, courtois. Voiture rendue impeccable. Le prix est plus que correct vu la qualité du service. Bravo." },
  { name: "Camille D.", rating: 5, trip: "Athènes · 8 jours", text: "Réservation en 2 minutes, confirmation immédiate. Le retour à 23h, le voiturier était là dans les 10 minutes. Parfait." },
  { name: "Karim S.", rating: 5, trip: "Tokyo · 12 jours", text: "Ma voiture a été garée comme si c'était la leur. Aucune rayure, intérieur nickel grâce à l'option premium. Recommandé à toute ma famille." },
  { name: "Élodie V.", rating: 5, trip: "Barcelone · 3 jours", text: "Honnêtement, je ne savais pas que ça existait. Maintenant je ne peux plus m'en passer. Zéro stress avant un vol, ça n'a pas de prix." },
];
