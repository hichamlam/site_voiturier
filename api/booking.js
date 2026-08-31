/**
 * POST /api/booking — paiement sur place
 */
import { Resend } from 'resend';
import { supabase, calculatePrice, checkDatesAvailable, upsertClient } from './_lib.js';
import { clientEmailHTML, adminEmailHTML } from './_emails.js';

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { reference, data } = req.body;
    if (!reference || !data) return res.status(400).json({ error: 'Missing fields' });

    const { customer, car, departure, return: ret, wash, options = {}, promoCode } = data;

    if (!customer?.email || !customer?.firstname || !car?.brand || !car?.plate || !departure?.date || !ret?.date) {
      return res.status(400).json({ error: 'Champs requis manquants' });
    }

    const avail = await checkDatesAvailable(departure.date, ret.date);
    if (!avail.available) return res.status(409).json({ error: 'Dates non disponibles' });

    const price = await calculatePrice({
      depDate: departure.date,
      depTime: departure.time,
      retDate: ret.date,
      retTime: ret.time,
      carCategoryCode: car.categoryCode || 'citadine',
      washType: wash?.type || 'none',
      hasCoveredParking: !!options.coveredParking,
      hasPriorityAccess: !!options.priorityAccess,
      promoCode,
    });

    const clientId = await upsertClient(customer);

    const { error: bookingErr } = await supabase.from('bookings').insert({
      reference,
      client_id: clientId,
      customer_firstname: customer.firstname,
      customer_lastname: customer.lastname || '',
      customer_email: customer.email.toLowerCase(),
      customer_phone: customer.phone,
      customer_flight: customer.flight || '',
      departure_date: departure.date,
      departure_time: departure.time,
      departure_terminal: departure.terminal || '',
      return_date: ret.date,
      return_time: ret.time,
      return_terminal: ret.terminal || '',
      car_brand: car.brand,
      car_model: car.model,
      car_color: car.color || '',
      car_plate: car.plate.toUpperCase(),
      car_category_code: car.categoryCode || 'citadine',
      wash_type: wash?.type || 'none',
      wash_price: price.washPrice,
      has_covered_parking: !!options.coveredParking,
      has_priority_access: !!options.priorityAccess,
      promo_code: price.promoCode,
      promo_discount: price.promoDiscount,
      base_price: price.basePrice,
      vehicle_surcharge: price.vehicleSurcharge,
      wash_surcharge: price.washSurcharge,
      time_surcharges: price.timeSurcharges,
      options_total: price.optionsTotal,
      total_price: price.total,
      surcharges_detail: price.surchargesDetail,
      status: 'confirmed',
      payment_method: 'onsite',
      payment_status: 'pending',
    });

    if (bookingErr) {
      console.error('[booking] supabase err:', bookingErr);
      return res.status(500).json({ error: 'Erreur enregistrement: ' + bookingErr.message });
    }

    if (price.promoCode) {
      const { data: pc } = await supabase
        .from('promo_codes').select('uses_count').eq('code', price.promoCode).maybeSingle();
      if (pc) {
        await supabase.from('promo_codes')
          .update({ uses_count: (pc.uses_count || 0) + 1 })
          .eq('code', price.promoCode);
      }
    }

    // Emails
    if (process.env.RESEND_API_KEY) {
      const FROM = process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';
      const ADMIN = process.env.ADMIN_EMAIL || 'contact@directvoiturier.com';
      const ctx = {
        reference, total: price.total, customer, car, dep: departure, ret, wash: wash || { type: 'none' },
        options, surchargesDetail: price.surchargesDetail, paymentMode: 'sur place',
      };

      Promise.all([
        resend.emails.send({ from: FROM, to: customer.email, subject: `Confirmation — ${reference}`, html: clientEmailHTML(ctx) }),
        resend.emails.send({ from: FROM, to: ADMIN, subject: `🛬 Nouvelle résa ${reference} — ${customer.firstname} ${customer.lastname || ''}`, html: adminEmailHTML(ctx) }),
      ]).catch(err => console.error('[booking] email:', err));
    }

    return res.status(200).json({ success: true, reference, total: price.total });

  } catch (err) {
    console.error('[booking]', err);
    return res.status(500).json({ error: err.message });
  }
}
