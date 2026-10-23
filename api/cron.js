/**
 * GET /api/cron — tâche planifiée quotidienne (voir vercel.json)
 * Envoie les emails automatiques activés dans le back-office (rappel J-1,
 * demande d'avis). Sans effet tant que l'interrupteur général est coupé.
 * Anti-doublon par réservation : relancer la route ne renvoie rien deux fois.
 * Vérifie aussi les paiements Stripe (rattrapage + santé du webhook) : voir _confirm.js.
 */
import Stripe from 'stripe';
import { runAutoEmails } from './_autoemails.js';
import { reconcilePendingPayments, checkWebhookHealth } from './_confirm.js';
import { reconcileModifications } from './_manage.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    // 1) Paiements : rattrapage des résas payées restées « pending » + santé
    //    du webhook. Indépendant des e-mails auto : une erreur ici ne bloque rien.
    let payments = null;
    if (process.env.STRIPE_SECRET_KEY) {
      try {
        const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
        payments = {
          ...(await reconcilePendingPayments(stripe, { source: 'cron' })),
          ...(await checkWebhookHealth(stripe)),
          ...(await reconcileModifications(stripe)),
        };
      } catch (err) {
        console.error('[cron] paiements', err);
        payments = { error: err.message };
      }
    }
    // 2) E-mails automatiques (rappel J-1, avis…)
    const report = await runAutoEmails();
    return res.status(200).json({ ...report, payments });
  } catch (err) {
    console.error('[cron]', err);
    return res.status(500).json({ error: err.message });
  }
}
