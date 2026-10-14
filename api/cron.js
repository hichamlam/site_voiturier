/**
 * GET /api/cron — tâche planifiée quotidienne (voir vercel.json)
 * Envoie les emails automatiques activés dans le back-office (rappel J-1,
 * demande d'avis). Sans effet tant que l'interrupteur général est coupé.
 * Anti-doublon par réservation : relancer la route ne renvoie rien deux fois.
 */
import { runAutoEmails } from './_autoemails.js';

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const report = await runAutoEmails();
    return res.status(200).json(report);
  } catch (err) {
    console.error('[cron]', err);
    return res.status(500).json({ error: err.message });
  }
}
