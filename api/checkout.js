/**
 * POST /api/checkout — paiement Stripe
 */
import Stripe from 'stripe';
import { supabase, calculatePrice, checkDatesAvailable, checkVehicleAllowed, upsertClient } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Sans clé Stripe, on refuse tout de suite plutôt que d'enregistrer une
  // réservation « pending » qui n'aboutira jamais.
  if (!process.env.STRIPE_SECRET_KEY) {
    return res.status(503).json({
      error: "Le paiement en ligne n'est pas encore disponible. Choisissez « Sur place ».",
    });
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });

  try {
    const { reference, data, source } = req.body;
    const fromApp = source === 'app';
    if (!reference || !data) return res.status(400).json({ error: 'Missing fields' });

    const { customer, car, departure, return: ret, options = {}, promoCode } = data;
    // L'app envoyait `wash: 'premium'` (texte), le site `wash: { type }` : on accepte les deux.
    const wash = typeof data.wash === 'string' ? { type: data.wash } : data.wash;
    const remark = String(customer?.notes || '').trim().slice(0, 500);

    const avail = await checkDatesAvailable(departure.date, ret.date);
    if (!avail.available) return res.status(409).json({ error: 'Dates non disponibles' });

    const vehicleCheck = await checkVehicleAllowed(car.brand, car.model);
    if (!vehicleCheck.allowed) return res.status(403).json({ error: vehicleCheck.reason });

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
      customerEmail: customer.email,
    });

    // Sans ce garde-fou, le client verrait un prix remisé au récapitulatif
    // (calculé côté front avant que l'e-mail ne soit connu) puis serait
    // débité du plein tarif via Stripe sans aucun avertissement.
    if (promoCode && price.promoRejectedReason === 'first_booking_only') {
      return res.status(409).json({ error: `Le code promo ${promoCode} est réservé à une première réservation.` });
    }
    if (promoCode && price.promoRejectedReason === 'invalid') {
      return res.status(409).json({ error: `Le code promo ${promoCode} n'est plus valable.` });
    }

    const clientId = await upsertClient(customer);

    const { data: booking, error: bookingErr } = await supabase.from('bookings').insert({
      reference,
      client_id: clientId,
      customer_firstname: customer.firstname,
      customer_lastname: customer.lastname || '',
      customer_email: customer.email.toLowerCase(),
      customer_phone: customer.phone,
      customer_flight: customer.flight || '',
      ...(remark ? { internal_notes: `Remarque client : ${remark}` } : {}),
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
      return res.status(500).json({ error: 'Réservation impossible pour le moment, réessayez.' });
    }

    // App mobile : paiement DANS l'app (Stripe PaymentSheet : carte, Google Pay, Apple Pay).
    // Il faut la clé publique côté serveur ; sans elle on retombe sur la page Stripe.
    if (fromApp && req.body.ui === 'sheet' && process.env.STRIPE_PUBLISHABLE_KEY) {
      // Si Stripe refuse (ex. clé limitée sans le droit « PaymentIntents »), on ne bloque
      // jamais le client : on retombe sur la page de paiement Stripe ci-dessous.
      try {
        // Moyens proposés : carte (inclut Google Pay / Apple Pay), Klarna, PayPal.
        // Jamais Link, Bancontact, MB WAY… Si un moyen n'est pas activé sur le compte
        // Stripe, on réessaie sans lui plutôt que de perdre le paiement dans l'app.
        const params = {
          amount: Math.round(price.total * 100),
          currency: 'eur',
          receipt_email: customer.email,
          description: `Direct Voiturier — ${reference} · ${departure.date} → ${ret.date} · ${car.brand} ${car.model} (${car.plate})`.substring(0, 500),
          metadata: { booking_id: booking.id, reference },
        };
        let intent = null;
        for (const types of [['card', 'klarna', 'paypal'], ['card', 'klarna'], ['card']]) {
          try { intent = await stripe.paymentIntents.create({ ...params, payment_method_types: types }); break; }
          catch (err) {
            if (err?.code !== 'parameter_invalid_empty' && err?.type !== 'StripeInvalidRequestError') throw err;
            console.warn('[checkout] moyen de paiement non activé, on réessaie sans :', types.at(-1), err?.message);
          }
        }
        if (!intent) throw new Error('aucun moyen de paiement disponible');
        // La colonne s'appelle stripe_session_id mais accepte aussi un pi_… (voir _confirm.js).
        await supabase.from('bookings').update({ stripe_session_id: intent.id }).eq('id', booking.id);
        return res.status(200).json({
          reference,
          paymentIntentId: intent.id,
          clientSecret: intent.client_secret,
          publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
        });
      } catch (e) {
        console.error('[checkout] paiement dans l\'app indisponible, repli sur la page Stripe :', e?.type || '', e?.code || '', e?.message || e);
      }
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: customer.email,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: {
            name: `Direct Voiturier — ${reference}`,
            description: `${departure.date} → ${ret.date} · ${car.brand} ${car.model} (${car.plate})`.substring(0, 500),
          },
          unit_amount: Math.round(price.total * 100),
        },
        quantity: 1,
      }],
      metadata: { booking_id: booking.id, reference },
      // Page de confirmation avec récap (lit la résa via l'id de session, jamais via l'URL seule)
      // Depuis l'app mobile : la page de confirmation renvoie vers l'app (directvoiturier://)
      success_url: `${process.env.SITE_URL}/reservation-confirmee?session_id={CHECKOUT_SESSION_ID}${fromApp ? '&app=1' : ''}`,
      cancel_url: fromApp
        ? `${process.env.SITE_URL}/reservation-confirmee?app=1&canceled=1`
        : `${process.env.SITE_URL}/?canceled=1&ref=${reference}`,
      locale: 'fr',
    });

    await supabase.from('bookings').update({ stripe_session_id: session.id }).eq('id', booking.id);

    return res.status(200).json({ url: session.url, reference });
  } catch (err) {
    console.error('[checkout]', err);
    // Jamais le message brut de Stripe/Supabase au client (il peut contenir des identifiants).
    return res.status(500).json({ error: 'Paiement momentanément indisponible. Réessayez ou choisissez « Payer sur place ».' });
  }
}
