/**
 * POST /api/checkout — paiement Stripe
 */
import Stripe from 'stripe';
import { supabase, calculatePrice, checkDatesAvailable, upsertClient } from './_lib.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
    const { reference, data } = req.body;
    if (!reference || !data) return res.status(400).json({ error: 'Missing fields' });

    const { customer, car, departure, return: ret, wash, options = {}, promoCode } = data;

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

    const { data: booking, error: bookingErr } = await supabase.from('bookings').insert({
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
      status: 'pending',
      payment_method: 'stripe',
      payment_status: 'pending',
    }).select().single();

    if (bookingErr) {
      console.error('[checkout]', bookingErr);
      return res.status(500).json({ error: bookingErr.message });
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer.email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Voiturier Orly — ${reference}`,
            description: `${departure.date} → ${ret.date} · ${car.brand} ${car.model} (${car.plate})`.substring(0, 500),
          },
          unit_amount: Math.round(price.total * 100),
        },
        quantity: 1,
      }],
      metadata: { booking_id: booking.id, reference },
      success_url: `${process.env.SITE_URL}/?paid=1&ref=${reference}`,
      cancel_url: `${process.env.SITE_URL}/?canceled=1&ref=${reference}`,
      locale: 'fr',
    });

    await supabase.from('bookings').update({ stripe_session_id: session.id }).eq('id', booking.id);

    return res.status(200).json({ url: session.url, reference });
  } catch (err) {
    console.error('[checkout]', err);
    return res.status(500).json({ error: err.message });
  }
}
