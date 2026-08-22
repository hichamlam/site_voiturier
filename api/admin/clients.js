/**
 * /api/admin/clients
 *
 * GET                    : liste des clients
 * GET ?id=xxx            : fiche client + ses réservations
 * PATCH /?id=xxx         : maj client (notes, vip, infos)
 * DELETE /?id=xxx        : suppression
 */
import { supabase, requireAdmin } from '../_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === 'GET') return get(req, res);
    if (req.method === 'PATCH') return patch(req, res);
    if (req.method === 'DELETE') return remove(req, res);
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/clients]', err);
    return res.status(500).json({ error: err.message });
  }
}

async function get(req, res) {
  const { id, q } = req.query;

  if (id) {
    const { data: client, error } = await supabase
      .from('clients').select('*').eq('id', id).single();
    if (error) return res.status(404).json({ error: 'Client introuvable' });

    const { data: bookings } = await supabase
      .from('bookings')
      .select('*')
      .eq('client_id', id)
      .order('departure_date', { ascending: false });

    return res.status(200).json({ client, bookings: bookings || [] });
  }

  let query = supabase.from('clients').select('*').order('updated_at', { ascending: false });
  const { data, error } = await query.limit(500);
  if (error) return res.status(500).json({ error: error.message });

  let result = data || [];
  if (q && typeof q === 'string') {
    const needle = q.toLowerCase();
    result = result.filter(c =>
      c.firstname?.toLowerCase().includes(needle) ||
      c.lastname?.toLowerCase().includes(needle) ||
      c.email?.toLowerCase().includes(needle) ||
      c.phone?.includes(needle)
    );
  }

  return res.status(200).json({ clients: result, total: result.length });
}

async function patch(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id requis' });

  const updates = {};
  const allowed = ['firstname', 'lastname', 'email', 'phone', 'notes', 'is_vip'];
  for (const k of allowed) {
    if (req.body[k] !== undefined) updates[k] = req.body[k];
  }
  if (updates.email) updates.email = updates.email.toLowerCase();

  const { data, error } = await supabase
    .from('clients').update(updates).eq('id', id).select().single();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ client: data });
}

async function remove(req, res) {
  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'id requis' });
  const { error } = await supabase.from('clients').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ success: true });
}
