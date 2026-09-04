/**
 * GET /api/config — configuration publique du déploiement
 *
 * Ne renvoie AUCUNE valeur secrète : uniquement des booléens décrivant ce que
 * ce déploiement sait réellement faire. Le front s'en sert pour n'afficher que
 * les moyens de paiement qui fonctionnent, au lieu de proposer un bouton
 * « Carte bancaire » qui échouerait faute de clés Stripe.
 *
 * `contact` expose en plus les coordonnées de contact/réassurance saisies
 * par le propriétaire dans le back-office (onglet Paramètres, table
 * `settings`). Chaque champ n'apparaît QUE s'il a réellement été renseigné :
 * aucune valeur par défaut n'est inventée ici.
 *
 * `promo` expose au plus un code promo à diffuser en bannière sur la page
 * d'accueil. Rien n'est inventé ici non plus : il n'apparaît que si le
 * propriétaire a réellement coché « afficher en bannière » sur un code actif
 * et actuellement valide (dates, quota) dans le back-office.
 */
import { supabase } from './_lib.js';

const PLACEHOLDER = /^(COLLER_ICI|TON_|change_moi|ton-email@)/i;

function isSet(name) {
  const v = process.env[name];
  return !!v && v.trim() !== '' && !PLACEHOLDER.test(v.trim());
}

// Sous-ensemble des clés de la table `settings` destinées au public — les
// identifiants analytics (GA4, Google Ads) restent internes au back-office.
const PUBLIC_KEYS = [
  'contact_phone',
  'contact_whatsapp',
  'contact_email',
  'contact_address',
  'google_business_url',
  'insurance_company',
  'insurance_policy_number',
];

async function loadPublicContact() {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('key, value')
      .in('key', PUBLIC_KEYS);
    if (error || !data) return {};
    const contact = {};
    for (const row of data) {
      const v = (row.value || '').trim();
      if (v !== '') contact[row.key] = v;
    }
    return contact;
  } catch {
    // Table absente (migration pas encore appliquée) ou Supabase injoignable :
    // on ne casse pas /api/config pour autant, on omet juste le contact.
    return {};
  }
}

// Code promo à diffuser publiquement (bannière d'accueil). On récupère au
// plus 5 candidats actifs marqués « bannière » et on filtre en JS avec
// exactement la même logique de validité que calculatePrice (api/_lib.js) :
// fenêtre de dates et quota d'utilisation.
async function loadBannerPromo() {
  try {
    const { data, error } = await supabase
      .from('promo_codes')
      .select('code, discount_type, discount_val, first_booking_only, valid_from, valid_until, max_uses, uses_count')
      .eq('active', true)
      .eq('show_banner', true)
      .order('created_at', { ascending: false })
      .limit(5);
    if (error || !data) return null;

    const today = new Date().toISOString().slice(0, 10);
    for (const promo of data) {
      const validFrom = !promo.valid_from || promo.valid_from <= today;
      const validUntil = !promo.valid_until || promo.valid_until >= today;
      const usesOk = !promo.max_uses || promo.uses_count < promo.max_uses;
      if (validFrom && validUntil && usesOk) {
        // On n'expose pas uses_count/max_uses : c'est une info interne au
        // back-office, pas une donnée à diffuser publiquement.
        return {
          code: promo.code,
          discount_type: promo.discount_type,
          discount_val: promo.discount_val,
          first_booking_only: promo.first_booking_only,
        };
      }
    }
    return null;
  } catch {
    // Colonne show_banner absente (migration pas encore appliquée) ou
    // Supabase injoignable : on ne casse pas /api/config, on omet la promo.
    return null;
  }
}

export default async function handler(req, res) {
  // La clé seule ne suffit pas : sans webhook, le client paie mais la
  // réservation n'est jamais confirmée ni encaissée côté back-office.
  const cleStripe = isSet('STRIPE_SECRET_KEY');
  const webhookStripe = isSet('STRIPE_WEBHOOK_SECRET');
  const contact = await loadPublicContact();
  const promo = await loadBannerPromo();

  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
  const reponse = {
    paiementEnLigne: cleStripe && webhookStripe,
    stripe: { cle: cleStripe, webhook: webhookStripe },
  };
  if (Object.keys(contact).length > 0) reponse.contact = contact;
  if (promo) reponse.promo = promo;
  return res.status(200).json(reponse);
}
