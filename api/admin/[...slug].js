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
import blockedVehiclesHandler from './_handlers/blocked-vehicles.js';
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
  'blocked-vehicles': blockedVehiclesHandler,
  surcharges: surchargesHandler,
  quotes: quotesHandler,
  'quotes-send': quotesSendHandler,
  templates: templatesHandler,
  'share-booking': shareBookingHandler,
};

export default async function handler(req, res) {
  // Vercel renseigne normalement req.query.slug. On ne s'y fie pas
  // aveuglément : si le paramètre manque ou arrive sous une autre forme, on
  // relit le nom de la route dans l'URL. Une seule route cassée mettrait tout
  // le back-office hors service.
  let nom = null;
  const brut = req.query ? req.query.slug : undefined;
  if (Array.isArray(brut)) nom = brut[0];
  else if (typeof brut === 'string' && brut) nom = brut.split('/')[0];

  if (!nom) {
    const chemin = String(req.url || '').split('?')[0];
    const m = chemin.match(/\/api\/admin\/([^/]+)/);
    if (m) nom = decodeURIComponent(m[1]).replace(/\.js$/, '');
  }

  const route = nom ? routes[nom] : null;
  if (!route) {
    // Message volontairement bavard : sans accès aux logs Vercel, c'est le
    // seul indice visible pour comprendre ce que la plateforme a transmis.
    return res.status(404).json({
      error: `Route admin inconnue : « ${nom || '(vide)'} » (URL reçue : ${req.url || '?'})`,
    });
  }
  return route(req, res);
}
