/**
 * GET /api/pricing-data — grille tarifaire PUBLIQUE pour le calcul instantané
 * côté navigateur (public/pricing-engine.js).
 *
 * Ne contient rien de confidentiel : ce sont les mêmes tarifs que ceux
 * affichés sur le site. Les codes promo n'y figurent PAS (validés un par un
 * par /api/pricing).
 *
 * Mis en cache par le CDN Vercel : la plupart des visiteurs reçoivent la
 * réponse depuis le cache, sans toucher Supabase. Un changement de tarif dans
 * le back-office est visible sous ~1 min ; de toute façon le prix payé est
 * toujours recalculé par le serveur (checkout / booking).
 */
import { loadPricingRef } from './_lib.js';

export default async function handler(req, res) {
  try {
    const ref = await loadPricingRef();
    // On ne publie que ce qui peut encore servir (dates futures).
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    ref.holidays = ref.holidays.filter(h => h.date >= yesterday);
    ref.blockedDates = ref.blockedDates.filter(b => b.date_end >= yesterday);
    ref.specials = ref.specials.filter(s => s.date_end >= yesterday);
    ref.version = 1;

    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=60, stale-while-revalidate=86400');
    return res.status(200).json(ref);
  } catch (err) {
    console.error('[pricing-data]', err);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(500).json({ error: 'Grille indisponible' });
  }
}
