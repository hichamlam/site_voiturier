/**
 * Répartiteur unique pour /api/admin/* .
 *
 * Le plan Hobby de Vercel limite un déploiement à 12 Serverless Functions ;
 * le back-office comptait à lui seul 12 routes admin (+ 6 routes publiques =
 * 18 au total), ce qui faisait échouer chaque déploiement. Toutes les routes
 * admin sont donc regroupées ici derrière une seule route catch-all — les
 * URLs appelées par le front (`/api/admin/bookings`, `/api/admin/clients`,
 * etc.) ne changent pas, seul le fichier qui les sert change.
 */
import loginHandler from './_handlers/login.js';
import statsHandler from './_handlers/stats.js';
import bookingsHandler from './_handlers/bookings.js';
import clientsHandler from './_handlers/clients.js';
import pricingHandler from './_handlers/pricing.js';
import promosHandler from './_handlers/promos.js';
import vehicleCategoriesHandler from './_handlers/vehicle-categories.js';
import surchargesHandler from './_handlers/surcharges.js';
import quotesHandler from './_handlers/quotes.js';
import quotesSendHandler from './_handlers/quotes-send.js';
import templatesHandler from './_handlers/templates.js';
import shareBookingHandler from './_handlers/share-booking.js';

const routes = {
  login: loginHandler,
  stats: statsHandler,
  bookings: bookingsHandler,
  clients: clientsHandler,
  pricing: pricingHandler,
  promos: promosHandler,
  'vehicle-categories': vehicleCategoriesHandler,
  surcharges: surchargesHandler,
  quotes: quotesHandler,
  'quotes-send': quotesSendHandler,
  templates: templatesHandler,
  'share-booking': shareBookingHandler,
};

export default async function handler(req, res) {
  const slug = Array.isArray(req.query.slug) ? req.query.slug : [req.query.slug];
  const route = routes[slug[0]];
  if (!route) return res.status(404).json({ error: 'Route admin inconnue' });
  return route(req, res);
}
