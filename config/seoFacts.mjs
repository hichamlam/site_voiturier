/**
 * ═══════════════════════════════════════════════════════════════
 *  FICHIER DE FAITS UNIQUE — Direct Voiturier
 *  Tous les chiffres affichés par le site (accueil, JSON-LD, llms.txt,
 *  pied de page, pages légales) viennent d'ici.
 *
 *  Après chaque modification :  npm run seo   puis commit + déploiement.
 *  Toute valeur contenant "TODO_ALEX" est considérée comme NON renseignée :
 *  l'élément correspondant n'est pas affiché sur le site.
 * ═══════════════════════════════════════════════════════════════
 */
export const seoFacts = {
  brand: "Direct Voiturier",
  url: "https://www.directvoiturier.com/",
  email: "contact@directvoiturier.com",
  phone: "TODO_ALEX",            // ex: "06 12 34 56 78" — affiché seulement si renseigné
  whatsapp: "TODO_ALEX",         // ex: "33612345678" (sans +, sans espaces)
  googleReviewsUrl: "TODO_ALEX", // lien de la fiche Google (Maps → ta fiche → Partager → Copier le lien)
  yearsAtOrly: "plus de 6 ans",
  travelers: "+9 000",
  rating: 4.6,
  reviewCount: 396,
  hours: { opens: "04:00", closes: "23:59", label: "7j/7, de 4h à minuit" },
  prices: {
    shortStay: 29,   // Court séjour (1 jour)
    week: 79,        // 1 semaine
    covered: 20,     // option parking couvert
    priority: 20,    // option accès prioritaire
    wash: { exterieur: 29, interieur: 49, complet: 69, premium: 99 },
  },
  // Tarifs AU GUICHET (sur place, sans réservation) des parkings officiels Paris-Orly.
  // À VÉRIFIER avant mise en ligne. Tant que checkedOn vaut "TODO_ALEX",
  // la ligne « Prix 1 semaine » du comparatif n'est PAS affichée.
  officialParkings: {
    checkedOn: "15 octobre 2026",            // vérifié par Alex : P1-P3 = 265 € / 7 jours
    terminal: { names: "P1, P2, P3", counterWeek: 265 },
    eco: { names: "P Eco / P Eco 2", counterWeek: 170, checkedOn: "TODO_ALEX" }, // prix P Eco affiché seulement si vérifié
  },
  // Page Mentions légales — seul endroit du site où une adresse postale apparaît.
  legal: {
    companyName: "TODO_ALEX",        // ex: "Direct Voiturier SAS"
    legalForm: "TODO_ALEX",          // ex: "SAS au capital de 1 000 €" ou "Entreprise individuelle"
    siret: "TODO_ALEX",
    headOffice: "TODO_ALEX",         // adresse du siège social
    publicationDirector: "TODO_ALEX",// prénom + nom
    host: "Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, États-Unis — vercel.com",
  },
};
