/**
 * Webhook Stripe — checkout.session.completed
 */
import Stripe from 'stripe';
import { Resend } from 'resend';
import { supabase } from './_lib.js';
import { clientEmailHTML, adminEmailHTML } from './_emails.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
const resend = new Resend(process.env.RESEND_API_KEY);

export const config = { api: { bodyParser: false } };

async function buffer(readable) {
  const chunks = [];
  for await (const chunk of readable) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  let event;
  try {
    const buf = await buffer(req);
    event = stripe.webhooks.constructEvent(
      buf,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('[webhook]', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const bookingId = session.metadata?.booking_id;
    if (!bookingId) return res.status(200).json({ received: true });

    const { data: booking } = await supabase.from('bookings').select('*').eq('id', bookingId).single();
    if (!booking) return res.status(200).json({ received: true });

    await supabase.from('bookings').update({
      status: 'confirmed', payment_status: 'paid',
    }).eq('id', bookingId);

    if (booking.promo_code) {
      const { data: pc } = await supabase.from('promo_codes').select('uses_count').eq('code', booking.promo_code).maybeSingle();
      if (pc) {
        await supabase.from('promo_codes').update({ uses_count: (pc.uses_count || 0) + 1 }).eq('code', booking.promo_code);
      }
    }

    const FROM = process.env.FROM_EMAIL || 'Voiturier Orly <contact@voiturier-orly.fr>';
    const ADMIN = process.env.ADMIN_EMAIL || 'contact@voiturier-orly.fr';
    const ctx = {
      reference: booking.reference,
      total: Number(booking.total_price),
      customer: {
        firstname: booking.customer_firstname,
        lastname: booking.customer_lastname,
        email: booking.customer_email,
        phone: booking.customer_phone,
        flight: booking.customer_flight,
      },
      car: {
        brand: booking.car_brand, model: booking.car_model,
        color: booking.car_color, plate: booking.car_plate,
        categoryCode: booking.car_category_code,
      },
      dep: { date: booking.departure_date, time: booking.departure_time, terminal: booking.departure_terminal },
      ret: { date: booking.return_date, time: booking.return_time, terminal: booking.return_terminal },
      wash: { type: booking.wash_type, price: Number(booking.wash_price || 0) },
      options: { coveredParking: booking.has_covered_parking, priorityAccess: booking.has_priority_access },
      surchargesDetail: booking.surcharges_detail || [],
      paymentMode: 'en ligne',
    };

    try {
      await Promise.all([
        resend.emails.send({ from: FROM, to: booking.customer_email, subject: `Confirmation — ${booking.reference}`, html: clientEmailHTML(ctx) }),
        resend.emails.send({ from: FROM, to: ADMIN, subject: `💳 Paiement reçu — ${booking.reference}`, html: adminEmailHTML(ctx) }),
      ]);
    } catch (err) {
      console.error('[webhook] email:', err);
    }
  }

  return res.status(200).json({ received: true });
}
