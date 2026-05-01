/**
 * /api/admin/surcharges — CRUD suppléments
 *
 * GET           : liste tous (time_window + holiday + option)
 * POST          : crée
 * PATCH ?id=    : maj
 * DELETE ?id=   : suppression
 */
import { supabase, requireAdmin } from '../_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const [surchargesQ, holidaysQ] = await Promise.all([
        supabase.from('surcharges').select('*').order('display_order'),
        supabase.from('holidays').select('*').order('date'),
      ]);
      return res.status(200).json({
        surcharges: surchargesQ.data || [],
        holidays: holidaysQ.data || [],
      });
    }
    if (req.method === 'POST') {
      const body = { ...req.body };
      if (body._table === 'holidays') {
        delete body._table;
        const { data, error } = await supabase.from('holidays').insert(body).select().single();
        if (error) return res.status(500).json({ error: error.message });
        return res.status(200).json({ item: data });
      }
      const { data, error } = await supabase.from('surcharges').insert(body).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ item: data });
    }
    const { id, table } = req.query;
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const t = table === 'holiday' ? 'holidays' : 'surcharges';
      const { data, error } = await supabase.from(t).update(req.body).eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ item: data });
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const t = table === 'holiday' ? 'holidays' : 'surcharges';
      const { error } = await supabase.from(t).delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }
    return res.status(405).end();
  } catch (err) {
    console.error('[admin/surcharges]', err);
    return res.status(500).json({ error: err.message });
  }
}
