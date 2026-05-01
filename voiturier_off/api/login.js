/**
 * POST /api/admin/login
 * Body : { password }
 * Returns : { token } (à stocker en localStorage côté admin)
 */
import { signToken } from '../_lib.js';
import crypto from 'crypto';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;

  if (!expected) {
    return res.status(500).json({ error: 'ADMIN_PASSWORD non configuré' });
  }
  if (!password || typeof password !== 'string') {
    return res.status(400).json({ error: 'Mot de passe requis' });
  }

  // Comparaison à temps constant pour éviter le timing attack
  const a = Buffer.from(password.padEnd(64, '\0').slice(0, 64));
  const b = Buffer.from(expected.padEnd(64, '\0').slice(0, 64));
  const ok = crypto.timingSafeEqual(a, b) && password.length === expected.length;

  if (!ok) {
    // Petit délai pour ralentir le brute-force
    await new Promise(r => setTimeout(r, 800));
    return res.status(401).json({ error: 'Mot de passe incorrect' });
  }

  const token = signToken({ admin: true });
  return res.status(200).json({ token, expiresIn: 24 * 60 * 60 });
}
