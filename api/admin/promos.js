/**
 * /api/admin/promos
 *
 * GET                  : liste codes promo
 * POST                 : créer
 * PATCH /?id=xxx       : maj
 * DELETE /?id=xxx      : suppression
 */
import { supabase, requireAdmin } from '../_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('promo_codes').select('*').order('created_at', { ascending: false });
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ codes: data || [] });
    }

    if (req.method === 'POST') {
      const body = req.body;
      if (!body.code || !body.discount_type || body.discount_val == null) {
        return res.status(400).json({ error: 'Champs requis : code, discount_type, discount_val' });
      }
      body.code = body.code.toUpperCase().trim();
      const { data, error } = await supabase.from('promo_codes').insert(body).select().single();
      if (error) {
        if (error.code === '23505') return res.status(409).json({ error: 'Ce code existe déjà' });
        return res.status(500).json({ error: error.message });
      }
      return res.status(200).json({ code: data });
    }

    const { id } = req.query;
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const updates = { ...req.body };
      if (updates.code) updates.code = updates.code.toUpperCase().trim();
      const { data, error } = await supabase
        .from('promo_codes').update(updates).eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ code: data });
    }

    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabase.from('promo_codes').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/promos]', err);
    return res.status(500).json({ error: err.message });
  }
}
