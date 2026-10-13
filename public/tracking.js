/* ═══════════════════════════════════════════════════════════════
   SUIVI — Google Tag Manager (+ GA4 / Ads en secours) + cookies RGPD
   Chargé dans le <head> de TOUTES les pages (un seul endroit à modifier).

   GTM_ID  : conteneur Google Tag Manager (rempli)
   GA4_ID / ADS_ID : seulement si tu NE passes PAS par GTM
                     (sinon laisse vide, tout se règle dans GTM)

   Consent Mode v2 : tout est "denied" tant que le visiteur n'a pas
   cliqué "Accepter" dans le bandeau cookies.
   ═══════════════════════════════════════════════════════════════ */
window.VO_ANALYTICS = Object.assign({
  GTM_ID: 'GTM-K9QGGB5J',
  GA4_ID: '',                 // ex: 'G-XXXXXXXXXX' (inutile si GTM)
  ADS_ID: '',                 // ex: 'AW-XXXXXXXXXXX' (inutile si GTM)
  ADS_CONVERSION_LABEL: '',
}, window.VO_ANALYTICS || {});

window.dataLayer = window.dataLayer || [];
function gtag(){ dataLayer.push(arguments); }

(function () {
  var A = window.VO_ANALYTICS;
  var stored = null;
  try { stored = localStorage.getItem('vo_consent'); } catch (e) {}

  // 1) Consentement par défaut : refusé (RGPD) — doit passer AVANT le chargement de GTM
  gtag('consent', 'default', {
    ad_storage: 'denied', ad_user_data: 'denied',
    ad_personalization: 'denied', analytics_storage: 'denied',
    wait_for_update: 500,
  });
  if (stored === 'granted') applyConsent(true);

  // 2) Chargement de GTM (ou gtag.js direct si pas de GTM)
  if (A.GTM_ID) {
    window.dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtm.js?id=' + A.GTM_ID;
    document.head.appendChild(s);
  } else if (A.GA4_ID || A.ADS_ID) {
    var g = document.createElement('script');
    g.async = true;
    g.src = 'https://www.googletagmanager.com/gtag/js?id=' + (A.GA4_ID || A.ADS_ID);
    document.head.appendChild(g);
    gtag('js', new Date());
    if (A.GA4_ID) gtag('config', A.GA4_ID);
    if (A.ADS_ID) gtag('config', A.ADS_ID, { allow_enhanced_conversions: true });
  }

  // 3) Bandeau cookies (injecté sur les pages qui n'en ont pas)
  function banner() {
    if (stored === 'granted' || stored === 'denied') return;
    var b = document.getElementById('cookieBanner');
    if (!b) {
      b = document.createElement('div');
      b.className = 'cookie-banner';
      b.id = 'cookieBanner';
      b.setAttribute('role', 'dialog');
      b.setAttribute('aria-label', 'Consentement cookies');
      b.innerHTML =
        '<p>Nous utilisons des cookies de mesure d\'audience et de publicité pour améliorer notre service. ' +
        'Vous pouvez accepter ou refuser, le site fonctionne dans les deux cas.</p>' +
        '<div class="cookie-banner-actions">' +
        '<button class="cookie-refuse" onclick="cookieChoice(false)">Refuser</button>' +
        '<button class="cookie-accept" onclick="cookieChoice(true)">Accepter</button></div>';
      document.body.appendChild(b);
    }
    b.classList.add('show');
  }
  if (A.GTM_ID || A.GA4_ID || A.ADS_ID) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', banner);
    else banner();
  }
})();

function applyConsent(accepted) {
  var v = accepted ? 'granted' : 'denied';
  gtag('consent', 'update', {
    ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v,
  });
}

function cookieChoice(accepted) {
  try { localStorage.setItem('vo_consent', accepted ? 'granted' : 'denied'); } catch (e) {}
  applyConsent(accepted);
  var b = document.getElementById('cookieBanner');
  if (b) b.classList.remove('show');
}

/* Envoi d'un événement (utilisé par script.js : réservation, devis, clics tél/WhatsApp…)
   Avec GTM : on pousse un événement "dataLayer" que GTM sait écouter. */
function trackEvent(name, params) {
  try {
    var A = window.VO_ANALYTICS || {};
    if (A.GTM_ID) dataLayer.push(Object.assign({ event: name }, params || {}));
    else gtag('event', name, params || {});
  } catch (e) {}
}
