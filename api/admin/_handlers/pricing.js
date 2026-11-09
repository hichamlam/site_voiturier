/**
 * /api/admin/pricing
 *
 * GET                                : retourne pricing_rules + pricing_special + blocked_dates
 * POST  ?type=rule|special|block     : crée
 * PATCH ?type=rule|special|block&id  : maj
 * DELETE ?type=rule|special|block&id : suppression
 */
import { supabase, requireAdmin, pick } from '../../_lib.js';

const COLS = {
  rule: ['days_min', 'days_max', 'price_eur', 'label', 'extra_per_day_eur'],
  special: ['name', 'date_start', 'date_end', 'multiplier', 'flat_extra', 'active'],
  block: ['date_start', 'date_end', 'reason'],
};

const TABLES = {
  rule:    'pricing_rules',
  special: 'pricing_special',
  block:   'blocked_dates',
};

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;

  try {
    if (req.method === 'GET') {
      const [rules, specials, blocks] = await Promise.all([
        supabase.from('pricing_rules').select('*').order('days_min'),
        supabase.from('pricing_special').select('*').order('date_start', { ascending: false }),
        supabase.from('blocked_dates').select('*').order('date_start', { ascending: false }),
      ]);
      return res.status(200).json({
        rules: rules.data || [],
        specials: specials.data || [],
        blocks: blocks.data || [],
      });
    }

    const { type, id } = req.query;
    const table = TABLES[type];
    if (!table) return res.status(400).json({ error: 'type invalide (rule, special, block)' });

    if (req.method === 'POST') {
      const { data, error } = await supabase.from(table).insert(pick(req.body, COLS[type])).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ item: data });
    }
    if (req.method === 'PATCH') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { data, error } = await supabase.from(table).update(pick(req.body, COLS[type])).eq('id', id).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ item: data });
    }
    if (req.method === 'DELETE') {
      if (!id) return res.status(400).json({ error: 'id requis' });
      const { error } = await supabase.from(table).delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[admin/pricing]', err);
    return res.status(500).json({ error: err.message });
  }
}
