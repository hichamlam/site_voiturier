/**
 * GET /api/config — configuration publique du déploiement
 *
 * Ne renvoie AUCUNE valeur secrète : uniquement des booléens décrivant ce que
 * ce déploiement sait réellement faire. Le front s'en sert pour n'afficher que
 * les moyens de paiement qui fonctionnent, au lieu de proposer un bouton
 * « Carte bancaire » qui échouerait faute de clés Stripe.
 */

const PLACEHOLDER = /^(COLLER_ICI|TON_|change_moi|ton-email@)/i;

function isSet(name) {
  const v = process.env[name];
  return !!v && v.trim() !== '' && !PLACEHOLDER.test(v.trim());
}

export default async function handler(req, res) {
  // La clé seule ne suffit pas : sans webhook, le client paie mais la
  // réservation n'est jamais confirmée ni encaissée côté back-office.
  const cleStripe = isSet('STRIPE_SECRET_KEY');
  const webhookStripe = isSet('STRIPE_WEBHOOK_SECRET');

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  return res.status(200).json({
    paiementEnLigne: cleStripe && webhookStripe,
    stripe: { cle: cleStripe, webhook: webhookStripe },
  });
}
