/**
 * /api/admin/blocked-vehicles — CRUD véhicules refusés (marque + modèle)
 */
import { supabase, requireAdmin } from '../../_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase.from('blocked_vehicles').select('*').order('brand');
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ items: data || [] });
    }
    if (req.method === 'POST') {
      const { data, error } = await supabase.from('blocked_vehicles').insert(req.body).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ item: data });
    }
    const { id } = req.query;
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { data, error } = await supabase.from('blocked_vehicles').update(req.body).eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ item: data });
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabase.from('blocked_vehicles').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }
    return res.status(405).end();
  } catch (err) {
    console.error('[admin/blocked-vehicles]', err);
    return res.status(500).json({ error: err.message });
  }
}
