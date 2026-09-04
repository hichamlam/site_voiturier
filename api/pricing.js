/**
 * POST /api/pricing
 * Body : { depDate, depTime, retDate, retTime, carCategoryCode, washType, hasCoveredParking, hasPriorityAccess, promoCode, customerEmail }
 * customerEmail est optionnel ici : au stade du devis, on ne connaît pas
 * forcément encore le client, donc un code « première réservation » est
 * accepté par défaut (le contrôle réel a lieu à la réservation, cf. _lib.js).
 * Returns : objet de calcul détaillé
 */
import { calculatePrice, checkDatesAvailable } from './_lib.js';

export default async function handler(req, res) {
  try {
    const body = req.method === 'POST' ? req.body : req.query;
    const { depDate, depTime = '08:00', retDate, retTime = '20:00' } = body;

    if (!depDate || !retDate) {
      return res.status(400).json({ error: 'depDate et retDate requis' });
    }

    const avail = await checkDatesAvailable(depDate, retDate);
    if (!avail.available) {
      return res.status(200).json({
        dateBlocked: true,
        blocks: avail.blocks,
        message: 'Ces dates ne sont pas disponibles',
      });
    }

    const price = await calculatePrice({
      depDate, depTime, retDate, retTime,
      carCategoryCode: body.carCategoryCode || 'citadine',
      washType: body.washType || 'none',
      hasCoveredParking: !!body.hasCoveredParking,
      hasPriorityAccess: !!body.hasPriorityAccess,
      promoCode: body.promoCode,
      customerEmail: body.customerEmail,
    });

    return res.status(200).json({ ...price, dateBlocked: false });
  } catch (err) {
    console.error('[pricing]', err);
    return res.status(500).json({ error: err.message });
  }
}
