/**
 * /api/admin/quotes — devis
 *
 * GET                    : liste
 * GET ?id=               : détail
 * POST                   : créer (calcule prix auto)
 * PATCH ?id=             : modifier
 * DELETE ?id=            : supprimer
 * POST ?action=convert&id= : convertir en réservation
 */
import { supabase, requireAdmin, calculatePrice } from '../_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    const { id, action } = req.query;

    if (req.method === 'GET') {
      if (id) {
        const { data, error } = await supabase.from('quotes').select('*').eq('id', id).single();
        if (error) return res.status(404).json({ error: error.message });
        return res.status(200).json({ quote: data });
      }
      const { data, error } = await supabase.from('quotes').select('*').order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ quotes: data || [] });
    }

    if (req.method === 'POST' && action === 'convert' && id) {
      // Conversion devis → réservation
      const { data: quote } = await supabase.from('quotes').select('*').eq('id', id).single();
      if (!quote) return res.status(404).json({ error: 'Devis introuvable' });

      const ref = 'VO-' + Date.now().toString(36).toUpperCase().slice(-6);
      const { data: booking, error } = await supabase.from('bookings').insert({
        reference: ref,
        customer_firstname: quote.customer_firstname,
        customer_lastname: quote.customer_lastname,
        customer_email: quote.customer_email,
        customer_phone: quote.customer_phone,
        departure_date: quote.departure_date,
        departure_time: quote.departure_time,
        return_date: quote.return_date,
        return_time: quote.return_time,
        car_brand: 'À renseigner',
        car_model: '',
        car_plate: 'TEMP',
        car_category_code: quote.car_category_code,
        wash_type: quote.wash_type,
        has_covered_parking: quote.has_covered_parking,
        has_priority_access: quote.has_priority_access,
        promo_code: quote.promo_code,
        base_price: quote.base_price,
        total_price: quote.total_price,
        surcharges_detail: quote.surcharges_detail,
        status: 'pending',
        payment_method: 'onsite',
        payment_status: 'pending',
      }).select().single();

      if (error) return res.status(500).json({ error: error.message });

      await supabase.from('quotes').update({
        status: 'accepted',
        converted_to_booking_id: booking.id,
      }).eq('id', id);

      return res.status(200).json({ booking });
    }

    if (req.method === 'POST') {
      const b = req.body;
      if (!b.departure_date || !b.return_date) {
        return res.status(400).json({ error: 'Dates requises' });
      }

      const price = await calculatePrice({
        depDate: b.departure_date,
        depTime: b.departure_time || '08:00',
        retDate: b.return_date,
        retTime: b.return_time || '20:00',
        carCategoryCode: b.car_category_code || 'citadine',
        washType: b.wash_type || 'none',
        hasCoveredParking: !!b.has_covered_parking,
        hasPriorityAccess: !!b.has_priority_access,
        promoCode: b.promo_code,
      });

      const ref = 'DV-' + Date.now().toString(36).toUpperCase().slice(-6);
      const validUntil = new Date(); validUntil.setDate(validUntil.getDate() + 30);

      const { data, error } = await supabase.from('quotes').insert({
        reference: ref,
        customer_firstname: b.customer_firstname || '',
        customer_lastname: b.customer_lastname || '',
        customer_email: b.customer_email || '',
        customer_phone: b.customer_phone || '',
        departure_date: b.departure_date,
        departure_time: b.departure_time || '08:00',
        return_date: b.return_date,
        return_time: b.return_time || '20:00',
        car_category_code: b.car_category_code || 'citadine',
        wash_type: b.wash_type || 'none',
        has_covered_parking: !!b.has_covered_parking,
        has_priority_access: !!b.has_priority_access,
        promo_code: price.promoCode,
        base_price: price.basePrice,
        total_price: price.total,
        surcharges_detail: price.surchargesDetail,
        status: 'draft',
        valid_until: validUntil.toISOString().slice(0, 10),
        notes: b.notes || '',
      }).select().single();

      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ quote: data });
    }

    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const updates = { ...req.body };
      // Si on change un paramètre tarifaire, recalculer
      if (updates.departure_date || updates.return_date || updates.car_category_code || updates.wash_type !== undefined) {
        const { data: existing } = await supabase.from('quotes').select('*').eq('id', id).single();
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
          updates.total_price = price.total;
          updates.surcharges_detail = price.surchargesDetail;
        }
      }
      const { data, error } = await supabase.from('quotes').update(updates).eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ quote: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabase.from('quotes').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(405).end();
  } catch (err) {
    console.error('[admin/quotes]', err);
    return res.status(500).json({ error: err.message });
  }
}
