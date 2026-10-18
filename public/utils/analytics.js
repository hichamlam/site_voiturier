/* ═══════════════════════════════════════════════════════════════
   SUIVI GA4 DES ÉVÉNEMENTS — Direct Voiturier
   Chargé sur TOUTES les pages, juste après /tracking.js (qui définit
   window.gtag, le consentement et Google Tag Manager).

   API :  DVAnalytics.trackEvent(nom, params)
     → envoie gtag('event', nom, params) seulement si window.gtag existe.
     → en mode développement, affiche aussi l'événement dans la console
       (et ajoute debug_mode pour le voir dans GA4 > Admin > DebugView).

   Mode développement = localhost, aperçus *.vercel.app, ou n'importe
   quelle page ouverte avec ?debug_analytics=1 (mémorisé pour l'onglet).

   Événements envoyés automatiquement par ce fichier (toutes les pages) :
     clic_bouton_cta  { nom_bouton, emplacement }
     clic_contact     { type: 'telephone' | 'whatsapp', emplacement }
   Événements du formulaire (envoyés par /script.js, page d'accueil) :
     devis_debut, devis_etape, devis_erreur, demande_devis_validee
   ═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  if (typeof window === 'undefined') return;

  // Identifiant de mesure GA4 (flux Web). Le site charge GA4 via Google Tag Manager :
  // sans « send_to », la balise Google de GTM ignore les gtag('event') de la page.
  var GA4_ID = (window.VO_ANALYTICS && window.VO_ANALYTICS.GA4_SEND_TO) || 'G-WD7DE0K2QT';

  var DEV = (function () {
    try {
      var h = window.location.hostname;
      var q = new URLSearchParams(window.location.search).get('debug_analytics');
      if (q === '1') sessionStorage.setItem('dv_debug_analytics', '1');
      if (q === '0') sessionStorage.removeItem('dv_debug_analytics');
      return h === 'localhost' || h === '127.0.0.1' || /\.vercel\.app$/.test(h)
        || sessionStorage.getItem('dv_debug_analytics') === '1';
    } catch (e) { return false; }
  })();

  function trackEvent(eventName, params) {
    if (typeof window === 'undefined' || typeof window.gtag !== 'function') {
      if (DEV) console.warn('[GA4] window.gtag absent, événement non envoyé :', eventName, params || {});
      return false;
    }
    var p = { send_to: GA4_ID };
    var src = params || {};
    for (var k in src) {
      if (Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined && src[k] !== null && src[k] !== '') p[k] = src[k];
    }
    if (DEV) {
      p.debug_mode = true;
      console.log('%c[GA4]%c ' + eventName, 'background:#2563EB;color:#fff;padding:1px 5px;border-radius:3px', 'font-weight:bold', p);
    }
    try { window.gtag('event', eventName, p); } catch (e) { return false; }
    return true;
  }

  /* ── Où se trouve l'élément cliqué ? (paramètre « emplacement ») ── */
  var ZONES = [
    ['#promoBanner', 'bandeau_promo'],
    ['.h-nav', 'en_tete'],
    ['.sticky-cta', 'barre_mobile'],
    ['.wa-float', 'bouton_flottant'],
    ['#bookingHeroCard, .h-hero, .page-hero', 'haut_de_page'],
    ['#bookingModal', 'tunnel_reservation'],
    ['.px', 'bloc_essentiel'],
    ['#comparatif', 'comparatif'],
    ['#lavages', 'lavages'],
    ['.h-final, .final-cta', 'bandeau_final'],
    ['.faq, #faq', 'faq'],
    ['.h-footer, footer', 'pied_de_page'],
  ];
  function emplacement(el) {
    for (var i = 0; i < ZONES.length; i++) {
      try { if (el.closest(ZONES[i][0])) return ZONES[i][1]; } catch (e) {}
    }
    var s = el.closest('section[id], section[class]');
    if (s) return (s.id || String(s.className).split(' ')[0]).replace(/-/g, '_');
    return 'autre';
  }
  function nomBouton(el) {
    if (el.dataset && el.dataset.ctaName) return el.dataset.ctaName;
    // Sur mobile, certains boutons ont un libellé long + court : on garde le long
    var long = el.querySelector && el.querySelector('.long');
    var t = (long ? long.textContent : el.textContent) || el.getAttribute('aria-label') || '';
    return t.replace(/\s+/g, ' ').trim().slice(0, 80) || 'sans_libelle';
  }

  /* ── Boutons d'appel à l'action principaux ── */
  var CTA = [
    '.h-nav-cta',                 // « Réserver » dans l'en-tête
    '.h-btn',                     // gros boutons bleus (calculateur, lavages, comparatif, bandeau final, bloc « L'essentiel »)
    '.page-hero-cta',             // « Calculer mon tarif » en haut des pages
    '.final-cta-btn',             // bandeau final des pages
    '.sticky-cta-btn',            // barre collante mobile
    '.promo-banner-use',          // « J'en profite » (code promo)
    'a[href="#reserver"]', 'a[href="/#reserver"]',
    '[data-cta-name]',
  ].join(',');

  document.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;

    // 1) Téléphone / WhatsApp
    var a = t.closest('a[href]');
    if (a) {
      var h = a.getAttribute('href') || '';
      var type = h.indexOf('tel:') === 0 ? 'telephone'
        : (/wa\.me|whatsapp/i.test(h) ? 'whatsapp' : '');
      if (type) {
        trackEvent('clic_contact', { type: type, emplacement: emplacement(a) });
        return;
      }
    }

    // 2) Boutons principaux (hors boutons internes du tunnel : suivis comme étapes)
    var btn = t.closest(CTA);
    if (!btn || btn.closest('#bookingModal')) return;
    trackEvent('clic_bouton_cta', { nom_bouton: nomBouton(btn), emplacement: emplacement(btn) });
  }, true);

  window.DVAnalytics = { trackEvent: trackEvent, isDev: DEV };
})();
