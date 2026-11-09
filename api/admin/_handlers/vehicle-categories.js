/**
 * /api/admin/vehicle-categories — CRUD catégories véhicule
 */
import { supabase, requireAdmin, pick } from '../../_lib.js';

const COLS = ['code', 'name', 'description', 'surcharge_eur', 'wash_surcharge_eur', 'display_order', 'active'];

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('vehicle_categories').select('*').order('display_order');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ categories: data || [] });
    }
    if (req.method === 'POST') {
      const { data, error } = await supabase.from('vehicle_categories').insert(pick(req.body, COLS)).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ category: data });
    }
    const { id } = req.query;
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { data, error } = await supabase.from('vehicle_categories').update(pick(req.body, COLS)).eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ category: data });
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabase.from('vehicle_categories').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }
    return res.status(405).end();
  } catch (err) {
    console.error('[admin/vehicle-categories]', err);
    return res.status(500).json({ error: err.message });
  }
}
