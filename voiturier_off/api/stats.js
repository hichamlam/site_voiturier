/**
 * /api/admin/stats
 * GET : KPIs pour le dashboard
 */
import { supabase, requireAdmin } from '../_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return res.status(405).end();

  try {
    const today = new Date().toISOString().slice(0, 10);
    const monthStart = today.slice(0, 8) + '01';

    const [
      { count: total },
      { count: today_dep },
      { count: today_ret },
      { count: in_storage },
      { data: month_rev },
      { data: upcoming },
    ] = await Promise.all([
      supabase.from('bookings').select('*', { count: 'exact', head: true }),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('departure_date', today).neq('status', 'cancelled'),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('return_date', today).neq('status', 'cancelled'),
      supabase.from('bookings').select('*', { count: 'exact', head: true }).eq('status', 'in_storage'),
      supabase.from('bookings').select('total_price').gte('departure_date', monthStart).eq('payment_status', 'paid'),
      supabase.from('bookings').select('reference, customer_firstname, customer_lastname, departure_date, departure_time, departure_terminal, car_brand, car_model, car_plate').gte('departure_date', today).neq('status', 'cancelled').order('departure_date').limit(8),
    ]);

    const monthRevenue = (month_rev || []).reduce((s, b) => s + Number(b.total_price || 0), 0);

    return res.status(200).json({
      total_bookings: total || 0,
      today_departures: today_dep || 0,
      today_returns: today_ret || 0,
      in_storage: in_storage || 0,
      month_revenue: Math.round(monthRevenue * 100) / 100,
      upcoming: upcoming || [],
    });
  } catch (err) {
    console.error('[admin/stats]', err);
    return res.status(500).json({ error: err.message });
  }
}
