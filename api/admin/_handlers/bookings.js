/**
 * /api/admin/bookings — réservations
 *
 * GET ?status=&from=&to=&q=&limit=200
 * POST    : création manuelle
 * PATCH ?id=  : maj (incluant pénalités retard)
 * DELETE ?id= : suppression
 */
import { supabase, requireAdmin, calculatePrice, upsertClient, calculateLateFee } from '../../_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === 'GET') return list(req, res);
    if (req.method === 'POST') return create(req, res);
    if (req.method === 'PATCH') return update(req, res);
    if (req.method === 'DELETE') return remove(req, res);
    return res.status(405).end();
  } catch (err) {
    console.error('[admin/bookings]', err);
    return res.status(500).json({ error: err.message });
  }
}

async function list(req, res) {
  const { status, from, to, q, limit = 200 } = req.query;
  let query = supabase.from('bookings').select('*').order('departure_date');

  if (status) query = query.eq('status', status);
  if (from)   query = query.gte('departure_date', from);
  if (to)     query = query.lte('return_date', to);

  const { data, error } = await query.limit(parseInt(limit, 10));
  if (error) return res.status(500).json({ error: error.message });

  let result = data || [];
  if (q && typeof q === 'string') {
    const needle = q.toLowerCase();
    result = result.filter(b =>
      b.reference?.toLowerCase().includes(needle) ||
      b.customer_firstname?.toLowerCase().includes(needle) ||
      b.customer_lastname?.toLowerCase().includes(needle) ||
      b.customer_email?.toLowerCase().includes(needle) ||
      b.customer_phone?.includes(needle) ||
      b.car_plate?.toLowerCase().includes(needle)
    );
  }
  return res.status(200).json({ bookings: result, total: result.length });
}

async function create(req, res) {
  const b = req.body;
  if (!b.customer || !b.car || !b.departure || !b.return) {
    return res.status(400).json({ error: 'Données incomplètes' });
  }

  const reference = b.reference || ('VO-' + Date.now().toString(36).toUpperCase().slice(-6));

  const price = await calculatePrice({
    depDate: b.departure.date,
    depTime: b.departure.time,
    retDate: b.return.date,
    retTime: b.return.time,
    carCategoryCode: b.car.categoryCode || 'citadine',
    washType: b.wash?.type || 'none',
    hasCoveredParking: !!b.options?.coveredParking,
    hasPriorityAccess: !!b.options?.priorityAccess,
    promoCode: b.promoCode,
  });

  const clientId = await upsertClient(b.customer);

  const { data, error } = await supabase.from('bookings').insert({
    reference, client_id: clientId,
    customer_firstname: b.customer.firstname,
    customer_lastname: b.customer.lastname || '',
    customer_email: b.customer.email.toLowerCase(),
    customer_phone: b.customer.phone,
    customer_flight: b.customer.flight || '',
    departure_date: b.departure.date,
    departure_time: b.departure.time,
    departure_terminal: b.departure.terminal || '',
    return_date: b.return.date,
    return_time: b.return.time,
    return_terminal: b.return.terminal || '',
    car_brand: b.car.brand,
    car_model: b.car.model,
    car_color: b.car.color || '',
    car_plate: (b.car.plate || '').toUpperCase(),
    car_category_code: b.car.categoryCode || 'citadine',
    wash_type: b.wash?.type || 'none',
    wash_price: price.washPrice,
    has_covered_parking: !!b.options?.coveredParking,
    has_priority_access: !!b.options?.priorityAccess,
    promo_code: price.promoCode,
    promo_discount: price.promoDiscount,
    base_price: price.basePrice,
    vehicle_surcharge: price.vehicleSurcharge,
    wash_surcharge: price.washSurcharge,
    time_surcharges: price.timeSurcharges,
    options_total: price.optionsTotal,
    total_price: b.total_price ?? price.total,
    surcharges_detail: price.surchargesDetail,
    status: b.status || 'confirmed',
    payment_method: b.payment_method || 'onsite',
    payment_status: b.payment_status || 'pending',
    parking_spot: b.parking_spot || '',
    internal_notes: b.internal_notes || '',
  }).select().single();

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ booking: data });
}

async function update(req, res) {
  const { id, recalc } = req.query;
  if (!id) return res.status(400).json({ error: 'id requis' });

  const updates = {};
  const allowed = [
    'status', 'payment_status', 'payment_method',
    'parking_spot', 'internal_notes',
    'customer_firstname', 'customer_lastname', 'customer_email', 'customer_phone', 'customer_flight',
    'departure_date', 'departure_time', 'departure_terminal',
    'return_date', 'return_time', 'return_terminal',
    'car_brand', 'car_model', 'car_color', 'car_plate', 'car_category_code',
    'wash_type', 'wash_price', 'has_covered_parking', 'has_priority_access',
    'total_price', 'base_price',
    // Pénalités de retard
    'late_dep_active', 'late_dep_actual_time', 'late_dep_fee',
    'late_ret_active', 'late_ret_actual_time', 'late_ret_fee',
    'late_fees_locked',
  ];
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }

  // Si demande de recalcul du prix après modification
  if (recalc === '1') {
    const { data: existing } = await supabase.from('bookings').select('*').eq('id', id).single();
    if (existing) {
      const merged = { ...existing, ...updates };
      const price = await calculatePrice({
        depDate: merged.departure_date,
        depTime: merged.departure_time,
        retDate: merged.return_date,
        retTime: merged.return_time,
        carCategoryCode: merged.car_category_code,
        washType: merged.wash_type,
        hasCoveredParking: !!merged.has_covered_parking,
        hasPriorityAccess: !!merged.has_priority_access,
        promoCode: merged.promo_code,
      });
      updates.base_price = price.basePrice;
      updates.vehicle_surcharge = price.vehicleSurcharge;
      updates.wash_price = price.washPrice;
      updates.wash_surcharge = price.washSurcharge;
      updates.time_surcharges = price.timeSurcharges;
      updates.options_total = price.optionsTotal;
      updates.total_price = price.total;
      updates.surcharges_detail = price.surchargesDetail;
    }
  }

  // Calcul auto pénalités de retard
  if (req.body.compute_late_fees) {
    const { data: existing } = await supabase.from('bookings').select('*').eq('id', id).single();
    if (existing) {
      if (updates.late_dep_active && updates.late_dep_actual_time && existing.departure_time) {
        const fee = calculateLateFee(existing.departure_time, updates.late_dep_actual_time);
        updates.late_dep_fee = fee.fee;
      }
      if (updates.late_ret_active && updates.late_ret_actual_time && existing.return_time) {
        const fee = calculateLateFee(existing.return_time, updates.late_ret_actual_time);
        updates.late_ret_fee = fee.fee;
      }
    }
  }

  // Timestamps automatiques selon le statut
  if (updates.status === 'taken') updates.taken_at = new Date().toISOString();
  if (updates.status === 'in_storage') updates.stored_at = new Date().toISOString();
  if (updates.status === 'returned') updates.returned_at = new Date().toISOString();
  if (updates.status === 'cancelled') updates.cancelled_at = new Date().toISOString();

  const { data, error } = await supabase.from('bookings').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ booking: data });
}

async function remove(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id requis' });
  const { error } = await supabase.from('bookings').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}
