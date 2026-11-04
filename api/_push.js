/**
 * Notifications push de l'application (Expo Push Service).
 *
 * Les jetons des téléphones sont rangés dans la table app_push_tokens
 * (cf. supabase/migrations/2026-11-04_app_push_chat.sql).
 * Aucun secret ici : Expo relaie vers Google (FCM) et Apple avec les
 * identifiants stockés côté EAS.
 *
 * Tout est « best effort » : une notif qui échoue ne doit jamais faire
 * échouer une réservation, un paiement ou un message. Ces fonctions ne
 * lèvent donc jamais d'erreur.
 */
import { supabase } from './_lib.js';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';
const isExpoToken = (t) => /^Expo(nent)?PushToken\[[^\]]+\]$/.test(String(t || ''));

async function send(tokens, { title, body, data = {} }) {
  const list = [...new Set(tokens.filter(isExpoToken))];
  if (!list.length) return;
  const messages = list.map((to) => ({
    to, title: String(title).slice(0, 120), body: String(body || '').slice(0, 300),
    data, sound: 'default', priority: 'high', channelId: 'default',
  }));
  try {
    const r = await fetch(EXPO_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(messages),
      signal: AbortSignal.timeout(4000),
    });
    const json = await r.json().catch(() => null);
    // Téléphones désinstallés : on oublie leur jeton.
    const dead = (json?.data || [])
      .map((t, i) => (t?.details?.error === 'DeviceNotRegistered' ? list[i] : null))
      .filter(Boolean);
    if (dead.length) await supabase.from('app_push_tokens').delete().in('token', dead);
  } catch (e) {
    console.error('[push]', e?.message || e);
  }
}

/** Prévient le(s) téléphone(s) admin. */
export async function pushAdmin(msg) {
  try {
    const { data } = await supabase.from('app_push_tokens').select('token').eq('is_admin', true);
    await send((data || []).map((r) => r.token), msg);
  } catch (e) { console.error('[push] admin', e?.message || e); }
}

/** Prévient un client (tous ses téléphones). */
export async function pushClient(email, msg) {
  if (!email) return;
  try {
    const { data } = await supabase.from('app_push_tokens').select('token').ilike('email', String(email).trim());
    await send((data || []).map((r) => r.token), msg);
  } catch (e) { console.error('[push] client', e?.message || e); }
}

/** Enregistre (ou met à jour) le jeton d'un téléphone. */
export async function saveToken({ token, email, isAdmin, platform }) {
  if (!isExpoToken(token)) return false;
  const { error } = await supabase.from('app_push_tokens').upsert({
    token, email, is_admin: !!isAdmin, platform: String(platform || '').slice(0, 10), updated_at: new Date().toISOString(),
  }, { onConflict: 'token' });
  if (error) throw error;
  return true;
}

export const CLIENT_STATUS_PUSH = {
  taken: { title: 'Voiture prise en charge 🔑', body: 'Votre voiturier a récupéré votre voiture. Bon voyage !' },
  in_storage: { title: 'Voiture au parking 🅿️', body: 'Votre voiture est bien garée et sécurisée.' },
  returned: { title: 'Voiture restituée ✅', body: 'Merci et à bientôt chez Direct Voiturier !' },
};
