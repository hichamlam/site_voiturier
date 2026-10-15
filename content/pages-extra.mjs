/**
 * CONTENU AJOUTÉ AUX PAGES SECONDAIRES (bloc « L'essentiel » + questions en plus)
 * Tous les chiffres viennent de config/seoFacts.mjs (paramètre f).
 * Rendu par scripts/build-seo.mjs dans <!--seo:extra--> et <!--seo:extrafaq-->.
 * Le JSON-LD FAQPage de chaque page est reconstruit à partir de TOUTES les
 * questions visibles de la page (anciennes + nouvelles).
 * Après modification :  npm run seo
 *
 * grid   : durées (en jours) affichées en « tuiles prix »
 * vs     : true = affiche la comparaison avec le tarif guichet P1, P2, P3 (si vérifié)
 */
export const pagesExtra = (f) => {
  const g = f.prices.grid;
  const op = f.officialParkings;
  const perDay = (d) => (g[d] / d).toFixed(2).replace('.', ',').replace(',00', '');
  const hours = f.hours.label;
  return {
    'parking-orly': {
      eyebrow: "L'essentiel",
      title: "Le parking d'Orly,<br><span class=\"accent\">sans chercher de place</span>",
      prose: [
        `Avec ${f.brand}, vous ne tournez pas dans un parking, vous ne marchez pas avec vos valises et vous n'attendez aucune navette. Vous arrivez au <strong>dépose-minute de votre terminal</strong> (Orly 1, 2, 3 ou 4), un voiturier prend vos clés et gare votre voiture.`,
        `Au retour, votre voiture vous attend <strong>devant le terminal d'arrivée</strong>. Le service fonctionne ${hours}, et le prix dépend seulement de la durée : tout compris, affiché avant le paiement.`,
      ],
      grid: [1, 3, 7, 14],
      vs: true,
      faq: [
        { q: "Combien coûte un parking à Orly avec voiturier ?", a: `Dès ${g[1]}&nbsp;€ pour une journée, ${g[3]}&nbsp;€ pour 3 jours, ${g[7]}&nbsp;€ pour une semaine et ${g[14]}&nbsp;€ pour deux semaines, tout compris (prise en charge, gardiennage, restitution). Le calculateur donne votre prix exact en 30 secondes.` },
        { q: "Faut-il prendre une navette ?", a: "Non. Vous déposez votre voiture au dépose-minute de votre terminal et vous la récupérez devant le terminal d'arrivée. Aucune navette, aucune marche avec les valises." },
        { q: "À quelle heure puis-je déposer ma voiture ?", a: `Le service fonctionne ${hours}. Un supplément horaire peut s'appliquer très tôt le matin ou tard le soir : il est toujours inclus dans le prix affiché avant le paiement.` },
      ],
    },
    'parking-orly-une-semaine': {
      eyebrow: 'Le calcul exact',
      title: 'Une semaine à Orly,<br><span class="accent">au jour près</span>',
      prose: [
        `Les jours se comptent en jours calendaires : <strong>le jour du départ et le jour du retour sont compris</strong>. Départ un samedi, retour le vendredi suivant : 7 jours, soit ${g[7]}&nbsp;€. Retour le samedi suivant : 8 jours, soit ${g[8]}&nbsp;€.`,
        `Le prix comprend la prise en charge au dépose-minute, le gardiennage pendant toute la semaine et la restitution au terminal d'arrivée. Vous pouvez ajouter un lavage pendant votre voyage, dès ${f.prices.wash.exterieur}&nbsp;€.`,
      ],
      grid: [5, 7, 8, 10],
      vs: true,
      faq: [
        { q: "Du samedi au samedi, combien de jours sont comptés ?", a: `8 jours, car le jour du départ et le jour du retour comptent chacun. Le tarif est alors de ${g[8]}&nbsp;€. Du samedi au vendredi suivant, c'est 7 jours, soit ${g[7]}&nbsp;€.` },
        { q: "Est-ce moins cher que les parkings officiels d'Orly ?", a: op.checkedOn && !String(op.checkedOn).includes('TODO')
          ? `Pour une semaine, le tarif au guichet des parkings ${op.terminal.names} est de ${op.terminal.counterWeek}&nbsp;€ (relevé le ${op.checkedOn}, indicatif). Avec ${f.brand}, la semaine est à ${g[7]}&nbsp;€, voiturier compris.`
          : `Avec ${f.brand}, la semaine est à ${g[7]}&nbsp;€, voiturier compris, sans marche ni navette.` },
      ],
    },
    'parking-orly-week-end': {
      eyebrow: 'Votre week-end',
      title: 'Un week-end,<br><span class="accent">un prix clair</span>',
      prose: [
        `Aller-retour dans la journée : ${g[1]}&nbsp;€. Samedi au dimanche : 2 jours, ${g[2]}&nbsp;€. <strong>Vendredi au dimanche : 3 jours, ${g[3]}&nbsp;€</strong>. Le jour du départ et le jour du retour sont compris.`,
        `Sur un week-end, chaque heure compte : pas de navette à l'aller, pas d'attente au retour. Vous déposez la voiture au terminal et vous partez. Service ${hours}.`,
      ],
      grid: [1, 2, 3, 4],
      vs: false,
      faq: [
        { q: "Combien coûte un voiturier à Orly du vendredi au dimanche ?", a: `${g[3]}&nbsp;€ pour 3 jours (vendredi, samedi, dimanche), tout compris. Du samedi au dimanche : ${g[2]}&nbsp;€.` },
        { q: "Puis-je partir très tôt le matin ?", a: `Oui, le service fonctionne ${hours}. Un supplément horaire peut s'appliquer très tôt ou tard le soir ; il est inclus dans le prix affiché avant le paiement.` },
      ],
    },
    'parking-couvert-orly': {
      eyebrow: 'Bon à savoir',
      title: 'Couvert ou non,<br><span class="accent">le même service</span>',
      prose: [
        "Avec ou sans l'option, rien ne change pour vous : <strong>vous déposez la voiture au dépose-minute de votre terminal</strong> et vous la récupérez devant le terminal d'arrivée.",
        "L'option couvert est utile en hiver (gel, givre, neige), en été (soleil, chaleur) et pour les longs séjours. Elle se combine avec un lavage pendant votre voyage.",
      ],
      grid: [3, 7, 14],
      vs: false,
      faq: [
        { q: "L'option couvert change-t-elle le lieu de prise en charge ?", a: "Non. La prise en charge se fait toujours au dépose-minute de votre terminal, et la restitution devant le terminal d'arrivée." },
        { q: "Peut-on combiner parking couvert et lavage ?", a: `Oui. Les deux options se choisissent au moment de la réservation, et leur prix apparaît dans le récapitulatif avant le paiement. Lavage dès ${f.prices.wash.exterieur}&nbsp;€.` },
      ],
    },
    'parking-longue-duree-orly': {
      eyebrow: 'Long séjour',
      title: 'Plus vous partez longtemps,<br><span class="accent">moins vous payez par jour</span>',
      prose: [
        `Deux semaines : ${g[14]}&nbsp;€. Trois semaines : ${g[21]}&nbsp;€. <strong>Un mois : ${g[30]}&nbsp;€, soit environ ${perDay(30)}&nbsp;€ par jour</strong>, prise en charge, gardiennage et restitution compris.`,
        "Pour un long séjour, l'option parking couvert protège la voiture des intempéries, et un lavage peut être fait juste avant votre retour.",
      ],
      grid: [10, 14, 21, 30],
      vs: false,
      faq: [
        { q: "Combien coûte un voiturier à Orly pour un mois ?", a: `${g[30]}&nbsp;€ pour 30 jours, tout compris. Deux semaines : ${g[14]}&nbsp;€, trois semaines : ${g[21]}&nbsp;€.` },
      ],
    },
    'reserver-voiturier-orly': {
      eyebrow: 'Avant de réserver',
      title: 'Ce qu\'il vous faut<br><span class="accent">pour réserver</span>',
      prose: [
        "Gardez sous la main : <strong>vos dates et heures</strong> aller et retour, <strong>vos terminaux</strong> de départ et d'arrivée, <strong>votre numéro de vol retour</strong> (pour suivre un éventuel retard) et votre voiture (marque, modèle, immatriculation).",
        "Le prix total s'affiche avant le paiement. Vous payez en ligne ou sur place, le montant est le même, et vous recevez la confirmation par email.",
      ],
      grid: [1, 3, 7],
      vs: false,
      faq: [
        { q: "Quelles informations faut-il pour réserver ?", a: "Vos dates et heures aller et retour, vos terminaux, votre numéro de vol retour, vos coordonnées et votre voiture (marque, modèle, immatriculation). Comptez environ 2 minutes." },
      ],
    },
    'lavage-voiture-orly': {
      eyebrow: 'Quelle formule ?',
      title: 'Choisir son lavage<br><span class="accent">en 10 secondes</span>',
      prose: [
        `<strong>Extérieur (${f.prices.wash.exterieur}&nbsp;€)</strong> : carrosserie, jantes, vitres. <strong>Intérieur (${f.prices.wash.interieur}&nbsp;€)</strong> : aspirateur, plastiques, tapis. <strong>Complet (${f.prices.wash.complet}&nbsp;€)</strong> : extérieur et intérieur, la formule la plus choisie. <strong>Premium (${f.prices.wash.premium}&nbsp;€)</strong> : complet, plastiques et désinfection.`,
        "Le lavage est fait pendant votre voyage : vous retrouvez une voiture propre au terminal, sans perdre une minute.",
      ],
      grid: [],
      vs: false,
      faq: [
        { q: "Quelle formule de lavage choisir ?", a: `Extérieur (${f.prices.wash.exterieur}&nbsp;€) pour la carrosserie, Intérieur (${f.prices.wash.interieur}&nbsp;€) pour l'habitacle, Complet (${f.prices.wash.complet}&nbsp;€) pour les deux, Premium (${f.prices.wash.premium}&nbsp;€) pour un nettoyage en profondeur avec désinfection.` },
      ],
    },
    'voiturier-orly-vol-retarde': {
      eyebrow: 'Concrètement',
      title: 'Votre vol a du retard ?<br><span class="accent">Voici ce qui se passe</span>',
      prose: [
        "<strong>1.</strong> À la réservation, vous indiquez votre numéro de vol retour. <strong>2.</strong> Nous suivons ce vol. <strong>3.</strong> À l'atterrissage, vous nous prévenez. <strong>4.</strong> Votre voiture vous attend devant le terminal d'arrivée.",
        "Vous n'avez rien à recalculer : on s'adapte à votre heure réelle d'atterrissage.",
      ],
      grid: [],
      vs: false,
      faq: [
        { q: "J'atterris dans un autre terminal qu'au départ, est-ce un problème ?", a: "Non. Vous indiquez votre terminal de retour à la réservation, et la voiture vous est rendue devant ce terminal d'arrivée." },
        ...(f.phone && !String(f.phone).includes('TODO') ? [{ q: "Comment vous prévenir de mon atterrissage ?", a: `Par téléphone au ${f.phone} ou sur WhatsApp au même numéro.` }] : []),
      ],
    },
    'tarifs': { faq: [] },
  };
};
