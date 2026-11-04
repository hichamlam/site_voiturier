/**
 * /api/app — API de l'application mobile Direct Voiturier
 *
 *   POST ?action=otp     { email }          → envoie un code à 6 chiffres par email
 *   POST ?action=verify  { email, code }    → { token, adminToken|null } (client 30 j, admin 7 j si ADMIN_EMAIL)
 *   GET  ?action=me                         (Bearer client) → profil, passages, voitures, réservations
 *   POST ?action=landed  { reference }      (Bearer client) → prévient l'équipe que le client a atterri
 *   POST ?action=admin-refresh              (Bearer admin) → nouveau jeton admin 7 j (renouvellement glissant)
 *   POST ?action=delete-account             (Bearer client) → demande de suppression du compte (exigence stores)
 *   GET  ?action=admin-today                (Bearer admin, cf. /api/admin/login) → mouvements du jour
 *
 * Une seule fonction serverless (limite de 12 fonctions du plan Vercel Hobby :
 * c'est la 12e). Aucune clé n'est exposée à l'app : elle ne parle qu'à cette API.
 * Le code de connexion est sans état (HMAC de l'email + fenêtre de 10 min),
 * donc pas de table à créer.
 */
import crypto from 'crypto';
import { Resend } from 'resend';
import { supabase, requireAdmin, getNotificationEmail } from './_lib.js';

const SECRET = process.env.ADMIN_SESSION_SECRET || 'dev-secret-change-me';
const FROM = () => process.env.FROM_EMAIL || 'Direct Voiturier <contact@directvoiturier.com>';
const WINDOW_MS = 10 * 60 * 1000;
const CLIENT_TTL = 30 * 24 * 3600 * 1000;
const ADMIN_TTL = 7 * 24 * 3600 * 1000;
const isAdminEmail = (email) => !!process.env.ADMIN_EMAIL && normEmail(process.env.ADMIN_EMAIL) === email;

// Jeton admin au format de _lib.js (lu par requireAdmin), durée 7 jours pour l'app.
function signAdmin() {
  const body = Buffer.from(JSON.stringify({ admin: true, via: 'app', exp: Date.now() + ADMIN_TTL })).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return `${body}.${sig}`;
}

const hmac = (purpose, data) =>
  crypto.createHmac('sha256', `${SECRET}:${purpose}`).update(data).digest();

const normEmail = (e) => String(e || '').trim().toLowerCase();
const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;

function otpFor(email, windowIndex) {
  const n = hmac('otp', `${email}|${windowIndex}`).readUInt32BE(0) % 1_000_000;
  return String(n).padStart(6, '0');
}

function signClient(email) {
  const body = Buffer.from(JSON.stringify({ client: true, email, exp: Date.now() + CLIENT_TTL })).toString('base64url');
  return `${body}.${hmac('client', body).toString('base64url')}`;
}

function verifyClient(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = hmac('client', body).toString('base64url');
  try {
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const data = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!data.client || !data.email || data.exp < Date.now()) return null;
    return data;
  } catch { return null; }
}

/* Anti-abus best effort (mémoire de l'instance) */
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  list.push(now);
  hits.set(key, list);
  return list.length > max;
}

function parisToday() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date());
}

const hhmm = (t) => String(t || '').slice(0, 5);
const carOf = (b) => ({
  brand: b.car_brand, model: b.car_model, color: b.car_color || '', plate: b.car_plate,
});

async function otp(req, res) {
  const email = normEmail(req.body?.email);
  if (!isEmail(email)) return res.status(400).json({ error: 'Email invalide' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0];
  if (limited(`otp:${email}`, 3, WINDOW_MS) || limited(`otp-ip:${ip}`, 10, WINDOW_MS)) {
    return res.status(429).json({ error: 'Trop de demandes, réessayez dans quelques minutes' });
  }
  const code = otpFor(email, Math.floor(Date.now() / WINDOW_MS));
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: FROM(),
    to: email,
    subject: `Votre code Direct Voiturier : ${code}`,
    html: `<p>Bonjour,</p><p>Votre code de connexion à l'application Direct Voiturier :</p>
<p style="font-size:28px;font-weight:700;letter-spacing:6px">${code}</p>
<p>Il est valable 10 minutes. Si vous n'êtes pas à l'origine de cette demande, ignorez cet email.</p>`,
  });
  return res.status(200).json({ ok: true });
}

async function verify(req, res) {
  const email = normEmail(req.body?.email);
  const code = String(req.body?.code || '').replace(/\D/g, '');
  if (!isEmail(email) || code.length !== 6) return res.status(400).json({ error: 'Code invalide' });
  if (limited(`verify:${email}`, 5, WINDOW_MS)) {
    return res.status(429).json({ error: 'Trop d’essais, redemandez un code dans quelques minutes' });
  }
  const w = Math.floor(Date.now() / WINDOW_MS);
  const ok = [w, w - 1].some((i) => {
    const expected = otpFor(email, i);
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(code));
  });
  if (!ok) {
    await new Promise((r) => setTimeout(r, 800));
    return res.status(401).json({ error: 'Code incorrect ou expiré' });
  }
  // Le propriétaire (ADMIN_EMAIL) reçoit aussi un jeton admin : même sécurité que son email.
  return res.status(200).json({ token: signClient(email), adminToken: isAdminEmail(email) ? signAdmin() : null });
}

async function me(req, res) {
  const session = verifyClient(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const email = session.email;

  const [{ data: client }, { data: bookings, error }] = await Promise.all([
    supabase.from('clients').select('firstname, lastname, phone, created_at').ilike('email', email).maybeSingle(),
    supabase.from('bookings')
      .select('reference, status, payment_status, departure_date, departure_time, departure_terminal, return_date, return_time, customer_flight, car_brand, car_model, car_color, car_plate, total_price, taken_at, stored_at, returned_at, created_at')
      .ilike('customer_email', email)
      .order('departure_date', { ascending: false })
      .limit(50),
  ]);
  if (error) throw error;

  const list = bookings || [];
  const cars = [];
  const seen = new Set();
  for (const b of list) {
    const key = String(b.car_plate || '').replace(/[\s-]/g, '').toUpperCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    cars.push(carOf(b));
  }

  const today = parisToday();
  const active = list.filter((b) => b.status !== 'cancelled' && b.status !== 'returned' && b.return_date >= today);
  active.sort((a, b) => a.departure_date.localeCompare(b.departure_date));
  const next = active[0] || null;

  return res.status(200).json({
    profile: client ? { firstname: client.firstname, lastname: client.lastname, phone: client.phone, since: client.created_at } : null,
    email,
    isAdmin: isAdminEmail(email),
    passages: list.filter((b) => b.status === 'returned').length,
    cars,
    next,
    upcoming: active,
    history: list.filter((b) => b.status === 'returned').slice(0, 10),
  });
}

async function adminToday(req, res) {
  if (!requireAdmin(req, res)) return;
  const today = parisToday();
  const { data, error } = await supabase.from('bookings')
    .select('id, reference, status, payment_method, payment_status, customer_firstname, customer_lastname, customer_phone, customer_flight, departure_date, departure_time, departure_terminal, return_date, return_time, car_brand, car_model, car_color, car_plate, total_price')
    .neq('status', 'cancelled')
    .or(`departure_date.eq.${today},return_date.eq.${today}`);
  if (error) throw error;

  const toCollect = (b) =>
    ['cash', 'onsite'].includes(b.payment_method) && b.payment_status !== 'paid' ? Number(b.total_price) : null;

  const moves = [];
  for (const b of data || []) {
    const base = {
      id: b.id,
      reference: b.reference,
      paymentMethod: b.payment_method,
      paymentStatus: b.payment_status,
      name: `${b.customer_firstname} ${b.customer_lastname}`.trim(),
      phone: b.customer_phone,
      car: carOf(b),
      status: b.status,
    };
    if (b.departure_date === today) {
      moves.push({ ...base, type: 'dep', time: hhmm(b.departure_time), terminal: b.departure_terminal || '', cash: toCollect(b) });
    }
    if (b.return_date === today) {
      moves.push({ ...base, type: 'ret', time: hhmm(b.return_time), flight: b.customer_flight || '', cash: b.departure_date === today ? null : toCollect(b) });
    }
  }
  moves.sort((a, b) => a.time.localeCompare(b.time));

  return res.status(200).json({
    date: today,
    departures: moves.filter((m) => m.type === 'dep').length,
    returns: moves.filter((m) => m.type === 'ret').length,
    cashTotal: moves.reduce((s, m) => s + (m.cash || 0), 0),
    moves,
  });
}

async function landed(req, res) {
  const session = verifyClient(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  const reference = String(req.body?.reference || '').trim().toUpperCase().slice(0, 40);
  if (!reference) return res.status(400).json({ error: 'Référence requise' });
  if (limited(`landed:${reference}`, 3, 30 * 60 * 1000)) return res.status(429).json({ error: 'Déjà signalé, l’équipe est prévenue' });

  const { data: b } = await supabase.from('bookings')
    .select('id, reference, status, customer_email, customer_firstname, customer_lastname, customer_phone, customer_flight, return_terminal, departure_terminal, car_brand, car_model, car_plate, internal_notes')
    .eq('reference', reference).maybeSingle();
  if (!b || normEmail(b.customer_email) !== session.email) return res.status(404).json({ error: 'Réservation introuvable' });
  if (!['taken', 'in_storage', 'confirmed'].includes(b.status)) return res.status(409).json({ error: 'Cette réservation n’attend pas de restitution' });

  const time = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date());
  await supabase.from('bookings').update({
    internal_notes: `${b.internal_notes ? b.internal_notes + '\n' : ''}[App] Client atterri à ${time}`,
  }).eq('id', b.id);

  const resend = new Resend(process.env.RESEND_API_KEY);
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  await resend.emails.send({
    from: FROM(),
    to: await getNotificationEmail(),
    subject: `🛬 ${b.customer_firstname} ${b.customer_lastname} a atterri — ${b.reference}`,
    html: `<p><b>${esc(b.customer_firstname)} ${esc(b.customer_lastname)}</b> vient d'atterrir (${time}).</p>
<p>${esc(b.car_brand)} ${esc(b.car_model)} · ${esc(b.car_plate)}<br>Vol ${esc(b.customer_flight) || '—'} · ${esc(b.return_terminal || b.departure_terminal) || 'terminal non précisé'}<br>Tél. ${esc(b.customer_phone)}</p>`,
  });
  return res.status(200).json({ ok: true, at: time });
}

async function adminRefresh(req, res) {
  if (!requireAdmin(req, res)) return;
  return res.status(200).json({ adminToken: signAdmin() });
}

async function deleteAccount(req, res) {
  const session = verifyClient(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });
  if (limited(`del:${session.email}`, 2, 24 * 3600 * 1000)) return res.status(200).json({ ok: true });
  const resend = new Resend(process.env.RESEND_API_KEY);
  const esc = (v) => String(v ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  await Promise.all([
    resend.emails.send({
      from: FROM(), to: await getNotificationEmail(),
      subject: `Demande de suppression de compte — ${session.email}`,
      html: `<p>Le client <b>${esc(session.email)}</b> demande la suppression de son compte depuis l'application.</p><p>À traiter sous 30 jours (RGPD). Les factures restent conservées pour la comptabilité.</p>`,
    }),
    resend.emails.send({
      from: FROM(), to: session.email,
      subject: 'Votre demande de suppression de compte',
      html: `<p>Bonjour,</p><p>Nous avons bien reçu votre demande de suppression de compte Direct Voiturier. Elle sera traitée sous 30 jours. Les factures restent conservées comme la loi l'exige.</p>`,
    }),
  ]);
  return res.status(200).json({ ok: true });
}

const routes = { otp, verify, me, landed, 'admin-refresh': adminRefresh, 'delete-account': deleteAccount, 'admin-today': adminToday };
const methods = { otp: 'POST', verify: 'POST', me: 'GET', landed: 'POST', 'admin-refresh': 'POST', 'delete-account': 'POST', 'admin-today': 'GET' };

export default async function handler(req, res) {
  const action = String(req.query?.action || '');
  const route = routes[action];
  if (!route) return res.status(404).json({ error: 'Action inconnue' });
  if (req.method !== methods[action]) return res.status(405).json({ error: `${methods[action]} only` });
  try {
    return await route(req, res);
  } catch (e) {
    console.error('[api/app]', action, e);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
}
