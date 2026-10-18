#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *  GÉNÉRATEUR SEO — Direct Voiturier          usage :  npm run seo
 *
 *  Lit config/seoFacts.mjs, content/reviews.mjs, content/faq-accueil.mjs
 *  et réécrit, dans public/ :
 *   • les zones balisées <!--seo:NOM--> … <!--/seo:NOM--> de chaque page
 *     (en-tête, pied de page, comparatif, tarifs, avis, FAQ, JSON-LD…)
 *   • /conditions-generales.html et /mentions-legales.html
 *   • /llms.txt et /sitemap.xml (lastmod = vraie date de modification git)
 *
 *  ⚠️ Ne pas éditer à la main le contenu entre deux balises seo : il est
 *  écrasé à chaque génération. Modifier les fichiers sources ci-dessus.
 *  Le script est idempotent : le relancer sans rien changer ne modifie rien.
 * ═══════════════════════════════════════════════════════════════
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { seoFacts as F } from '../config/seoFacts.mjs';
import { reviews as REVIEWS } from '../content/reviews.mjs';
import { faqAccueil } from '../content/faq-accueil.mjs';
import { pagesExtra } from '../content/pages-extra.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public');
const SITE = F.url.replace(/\/$/, '');
const YEAR = new Date().getFullYear();

/* ─── Helpers ─────────────────────────────────────────────── */
const isSet = (v) => v !== undefined && v !== null && v !== '' && !String(v).includes('TODO');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const eur = (n) => `${n}&nbsp;€`;
const eurTxt = (n) => `${n} €`;
const nb = (s) => String(s).replace(/ /g, '&nbsp;');
const stripTags = (h) => h.replace(/<a [^>]*>\s*Voir[^<]*<\/a>/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const ratingFr = String(F.rating).replace('.', ',');
const facts = { ...F, ratingFr };
const telHref = isSet(F.phone) ? 'tel:' + String(F.phone).replace(/[^+0-9]/g, '') : '';
const terminalPricesOk = isSet(F.officialParkings.checkedOn);

function replaceRegion(html, name, content, file) {
  const re = new RegExp(`(<!--seo:${name}-->)[\\s\\S]*?(<!--/seo:${name}-->)`);
  if (!re.test(html)) throw new Error(`Balise <!--seo:${name}--> introuvable dans ${file}`);
  return html.replace(re, `$1\n${content}\n$2`);
}
const hasRegion = (html, name) => html.includes(`<!--seo:${name}-->`);

/* ─── Icônes (trait, même famille que le reste du site) ───── */
const IC = {
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  award: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  star: '<path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>',
  plane: '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>',
  bag: '<rect x="5" y="7" width="14" height="13" rx="2"/><path d="M9 7V4h6v3M9 11v5M15 11v5"/>',
  camera: '<path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="4"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="m9 12 2 2 4-4"/>',
  euro: '<path d="M17 6.5A6 6 0 1 0 17 17.5M4 10h9M4 14h9"/>',
  arrow: '<path d="M5 12h14M12 5l7 7-7 7"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  x: '<path d="M7 7l10 10M17 7L7 17"/>',
  walk: '<circle cx="13" cy="4.5" r="1.8"/><path d="M10 21l2-6 3 3v3M8 12l2-4 4 1 2 4M12 15l-1-6"/>',
  pin: '<path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  sparkle: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
  bus: '<rect x="4" y="3" width="16" height="15" rx="3"/><path d="M4 11h16M8 21v-3M16 21v-3"/><circle cx="8" cy="14.5" r=".8"/><circle cx="16" cy="14.5" r=".8"/>',
  hourglass: '<path d="M6 3h12M6 21h12M7 3c0 5 10 5 10 9s-10 4-10 9M17 3c0 5-10 5-10 9s10 4 10 9"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
};
const GOOGLE_MARK = '<svg class="review-google-mark" viewBox="0 0 24 24" aria-hidden="true">'
  + '<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>'
  + '<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>'
  + '<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>'
  + '<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>'
  + '</svg>';
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
const ico = (k, cls = 'h-ico') => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[k]}</svg>`;
const STAR_FILLED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>';
const LOGO_PATH = '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>';

/* ═══ EN-TÊTE (toutes les pages) ═══ */
function header({ home }) {
  const phone = `<a class="h-nav-phone" id="navPhone" href="${telHref || '#'}"${telHref ? '' : ' hidden'} aria-label="Nous appeler">${ico('phone')}<span>${isSet(F.phone) ? esc(F.phone) : ''}</span></a>`;
  const cta = home
    ? `<button class="h-nav-cta" type="button" onclick="openBookingModal()"><span class="long">Réserver à Orly</span><span class="short">Réserver</span>${ico('arrow')}</button>`
    : `<a class="h-nav-cta" href="/#reserver"><span class="long">Réserver à Orly</span><span class="short">Réserver</span>${ico('arrow')}</a>`;
  return `<header class="h-nav" id="nav">
  <div class="h-wrap h-nav-in">
    <a href="/" class="h-logo" aria-label="Direct Voiturier, accueil">
      <span class="h-logo-mark"><svg viewBox="0 0 24 24" aria-hidden="true">${LOGO_PATH}</svg></span>
      <span>
        <span class="h-logo-name">DIRECT <b>VOITURIER</b></span>
        <span class="h-logo-sub">Paris-Orly (1, 2, 3, 4)</span>
      </span>
    </a>
    <nav class="h-nav-links" aria-label="Navigation principale">
      <a href="/comment-ca-marche">Comment ça marche</a>
      <a href="/tarifs">Tarifs</a>
      <a href="/voiturier-orly-terminaux">Terminaux</a>
      <a href="${home ? '' : '/'}#comparatif">Comparatif</a>
      <a href="${home ? '' : '/'}#avis">Avis</a>
      <a href="/faq">FAQ</a>
    </nav>
    <div class="h-nav-right">
      ${phone}
      ${cta}
    </div>
  </div>
</header>`;
}

/* ═══ PIED DE PAGE (toutes les pages) ═══ */
function footer({ wa = false } = {}) {
  const waNum = isSet(F.whatsapp) ? String(F.whatsapp).replace(/[^0-9]/g, '') : '';
  const waFloat = wa && waNum ? `\n<a class="wa-float" href="https://wa.me/${waNum}?text=${encodeURIComponent('Bonjour, je souhaite réserver un voiturier à Orly.')}" target="_blank" rel="noopener" aria-label="Nous écrire sur WhatsApp"><svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 3C9.4 3 4 8.4 4 15c0 2.1.6 4.2 1.6 6L4 29l8.2-1.5c1.2.6 2.5.9 3.8.9 6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-1.2 0-2.4-.3-3.5-.8l-.6-.3-4.9.9 1-4.7-.4-.6c-.9-1.5-1.4-3.2-1.4-5 0-5.4 4.4-9.8 9.8-9.8s9.8 4.4 9.8 9.8-4.4 9.5-9.8 9.5zm5.4-7.3c-.3-.1-1.7-.9-2-1-.3-.1-.5-.1-.7.1-.2.3-.8 1-.9 1.2-.2.2-.3.2-.6.1-.3-.1-1.2-.5-2.4-1.5-.9-.8-1.5-1.8-1.6-2.1-.2-.3 0-.4.1-.6l.4-.5c.1-.2.2-.3.3-.5.1-.2 0-.4 0-.5 0-.1-.7-1.6-.9-2.2-.2-.6-.5-.5-.7-.5h-.6c-.2 0-.5.1-.8.4-.3.3-1 1-1 2.5s1.1 2.9 1.2 3.1c.1.2 2.1 3.2 5.1 4.5.7.3 1.3.5 1.7.6.7.2 1.4.2 1.9.1.6-.1 1.7-.7 2-1.4.2-.7.2-1.3.2-1.4-.1-.1-.3-.2-.6-.4z"/></svg></a>` : '';
  const tel = telHref ? `\n        <li><a href="${telHref}">${esc(F.phone)}</a></li>` : '';
  return `<footer class="h-footer">
  <div class="h-wrap">
    <div class="h-foot-top">
      <div class="h-foot-brand"><span class="h-logo-mark"><svg viewBox="0 0 24 24" aria-hidden="true">${LOGO_PATH}</svg></span><span>DIRECT VOITURIER Paris-Orly</span></div>
      <div class="h-foot-quick">
        <a href="/voiturier-orly-terminaux">Terminaux 1, 2, 3 &amp; 4</a>
        <a href="/comment-ca-marche">Dépose-minute</a>
        <a href="mailto:${F.email}">Assistance directe</a>
        <a href="/conditions-generales">Conditions générales</a>
      </div>
    </div>
    <div class="h-foot-cols">
      <div><h3>Service</h3><ul>
        <li><a href="/comment-ca-marche">Comment ça marche</a></li>
        <li><a href="/tarifs">Tarifs</a></li>
        <li><a href="/lavage-voiture-orly">Lavages</a></li>
        <li><a href="/reserver-voiturier-orly">Réserver</a></li>
        <li><a href="/horaires-voiturier-orly">Horaires</a></li>
      </ul></div>
      <div><h3>Orly</h3><ul>
        <li><a href="/">Voiturier Orly</a></li>
        <li><a href="/voiturier-orly-1-2">Voiturier Orly 1 et 2</a></li>
        <li><a href="/voiturier-orly-3">Voiturier Orly 3</a></li>
        <li><a href="/voiturier-transavia-orly">Voiturier Transavia Orly</a></li>
        <li><a href="/voiturier-orly-4">Voiturier Orly 4</a></li>
        <li><a href="/parking-orly">Parking Orly</a></li>
      </ul></div>
      <div><h3>Guides</h3><ul>
        <li><a href="/#comparatif">Voiturier ou parking à Orly</a></li>
        <li><a href="/parking-orly-pas-cher">Parking Orly pas cher</a></li>
        <li><a href="/code-promo-voiturier-orly">Code promo -10%</a></li>
        <li><a href="/parking-longue-duree-orly">Parking longue durée Orly</a></li>
        <li><a href="/voiturier-orly-vol-retarde">Vol retardé</a></li>
        <li><a href="/guides-voiturier-orly">Tous nos guides Orly</a></li>
        <li><a href="/faq">FAQ</a></li>
      </ul></div>
      <div><h3>Contact &amp; légal</h3><ul>
        <li><a href="mailto:${F.email}">${F.email}</a></li>${tel}
        <li><a href="/conditions-generales">Conditions générales</a></li>
        <li><a href="/mentions-legales">Mentions légales</a></li>
      </ul></div>
    </div>
    <div class="h-foot-legal">
      <p>${F.brand} est un service indépendant de voiturier et de gardiennage dédié aux voyageurs de l'aéroport Paris-Orly (ORY). Présent à Orly depuis ${nb(F.yearsAtOrly)}, ${nb(F.travelers.replace('+', 'plus de '))} voyageurs accompagnés.</p>
      <p>© ${YEAR} ${F.brand} · Aéroport Paris-Orly</p>
    </div>
  </div>
</footer>${waFloat}`;
}

/* ═══ ACCUEIL : <head> ═══ */
function homeMeta() {
  const desc = `Voiturier à l'aéroport Paris-Orly (Orly 1, 2, 3, 4) : 0 minute de marche, votre voiture au dépose-minute. Note ${ratingFr}/5 sur ${F.reviewCount} avis. Dès ${eurTxt(F.prices.shortStay)}, prix total avant paiement.`;
  const short = `Service voiturier à Paris-Orly depuis ${F.yearsAtOrly}. ${ratingFr}/5 sur Google · ${F.reviewCount} avis.`;
  return `<title>Voiturier aéroport Orly dès ${eurTxt(F.prices.shortStay)} | ${F.brand}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="index, follow, max-image-preview:large">
<link rel="canonical" href="${SITE}/">
<meta property="og:type" content="website">
<meta property="og:url" content="${SITE}/">
<meta property="og:title" content="${F.brand}, voyagez l'esprit léger">
<meta property="og:description" content="${esc(short)}">
<meta property="og:image" content="${SITE}/og-image.jpg">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:type" content="image/jpeg">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${F.brand}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${F.brand}, voyagez l'esprit léger">
<meta name="twitter:description" content="${esc(short)}">
<meta name="twitter:image" content="${SITE}/og-image.jpg">`;
}

const FAQ = faqAccueil(facts);
const BUSINESS_ID = `${SITE}/#business`;
const AIRPORT = { '@type': 'Airport', name: 'Aéroport Paris-Orly (ORY)', iataCode: 'ORY' };

function homeJsonLd() {
  const P = F.prices;
  const offer = (name, price, description) => ({ '@type': 'Offer', name, price: String(price), priceCurrency: 'EUR', description, url: `${SITE}/#prix` });
  const business = {
    '@type': 'LocalBusiness',
    '@id': BUSINESS_ID,
    name: F.brand,
    url: `${SITE}/`,
    email: F.email,
    ...(isSet(F.phone) ? { telephone: telHref.slice(4).replace(/^0/, '+33') } : {}),
    image: `${SITE}/og-image.jpg`,
    description: `Service de voiturier à l'aéroport Paris-Orly : prise en charge et restitution au dépose-minute des terminaux Orly 1, 2, 3 et 4, gardiennage sous vidéosurveillance 24h/24. Présent à Orly depuis ${F.yearsAtOrly}.`,
    priceRange: `${P.shortStay} € - ${Math.max(P.wash.premium, P.shortStay)} €`,
    currenciesAccepted: 'EUR',
    paymentAccepted: 'Carte bancaire, Espèces',
    areaServed: [AIRPORT, ...['Orly 1', 'Orly 2', 'Orly 3', 'Orly 4'].map((n) => ({ '@type': 'Place', name: `${n} — Aéroport Paris-Orly` }))],
    openingHoursSpecification: {
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
      opens: F.hours.opens,
      closes: F.hours.closes,
    },
    ...(isSet(F.googleReviewsUrl) ? { sameAs: [F.googleReviewsUrl] } : {}),
  };
  const graph = [
    { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: F.brand, inLanguage: 'fr-FR', publisher: { '@id': BUSINESS_ID } },
    business,
    {
      '@type': 'Service',
      '@id': `${SITE}/#service`,
      serviceType: 'Voiturier aéroport',
      name: 'Voiturier à l\'aéroport Paris-Orly',
      provider: { '@id': BUSINESS_ID },
      areaServed: AIRPORT,
      offers: [
        offer('Court séjour (1 jour)', P.shortStay, 'Dès ' + eurTxt(P.shortStay) + ' : prise en charge, gardiennage et restitution compris'),
        offer('1 semaine', P.week, 'Dès ' + eurTxt(P.week) + ', tout compris'),
        offer('Lavage extérieur', P.wash.exterieur, 'Option pendant le voyage'),
        offer('Lavage intérieur', P.wash.interieur, 'Option pendant le voyage'),
        offer('Lavage complet', P.wash.complet, 'Option pendant le voyage'),
        offer('Lavage premium', P.wash.premium, 'Option pendant le voyage'),
      ],
    },
    {
      '@type': 'FAQPage',
      '@id': `${SITE}/#faq`,
      mainEntity: FAQ.map((x) => ({ '@type': 'Question', name: x.q, acceptedAnswer: { '@type': 'Answer', text: stripTags(x.a) } })),
    },
  ];
  return `<script type="application/ld+json">\n${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}\n</script>`;
}

function homeContact() {
  return `<script>
window.VO_CONTACT = {
  PHONE: '${isSet(F.phone) ? String(F.phone).replace(/'/g, '') : ''}',
  WHATSAPP: '${isSet(F.whatsapp) ? String(F.whatsapp).replace(/[^0-9]/g, '') : ''}',
  GOOGLE_PROFILE: '${isSet(F.googleReviewsUrl) ? String(F.googleReviewsUrl).replace(/'/g, '') : ''}',
};
</script>`;
}

/* ═══ ACCUEIL : héros ═══ */
const heroBadge = () => `<span class="h-badge-ok">Dès ${eur(F.prices.shortStay)}</span>`;
const heroTrust = () => `<div class="h-trust">
        <a class="h-trust-i" href="#comparatif"><b><small>Jusqu'à</small>&minus;70&nbsp;%<sup>*</sup></b><span>vs parkings officiels d'Orly</span></a>
        <a class="h-trust-i" href="#comparatif"><b>1h30</b><span>gagnée, sans navette</span></a>
        <div class="h-trust-i"><b>${nb(F.travelers)}</b><span>voyageurs servis</span></div>
      </div>
      <p class="h-trust-note">* Par rapport au tarif guichet payé sur place des parkings officiels de l'aéroport Paris-Orly.</p>`;

/* ═══ ACCUEIL : tarifs ═══ */
const priceCards = () => `<div class="h-prices reveal">
      <div class="h-price-card"><b>Court séjour</b><div class="amt"><small>dès</small><strong>${eur(F.prices.shortStay)}</strong></div><span>1 jour · aller-retour rapide</span></div>
      <div class="h-price-card"><b>1 semaine</b><div class="amt"><small>dès</small><strong>${eur(F.prices.week)}</strong></div><span>Le prix par jour baisse avec la durée</span></div>
    </div>`;

/* ═══ ACCUEIL : avis ═══ */
function reviewsBlock() {
  const ok = REVIEWS.filter((r) => isSet(r.name) && isSet(r.text) && isSet(r.trip) && r.rating >= 1 && r.rating <= 5);
  const link = isSet(F.googleReviewsUrl)
    ? `<a id="gsLink" href="${esc(F.googleReviewsUrl)}" target="_blank" rel="noopener">Voir tous les avis sur Google</a>`
    : `<a id="gsLink" href="#" hidden target="_blank" rel="noopener">Voir tous les avis sur Google</a>`;
  const rating = `<div class="h-rating reveal">
      <span class="h-rating-n">${ratingFr}<small>/5</small></span>
      <span class="h-stars" aria-hidden="true">${STAR_FILLED.repeat(5)}</span>
      <span class="h-rating-t">${F.reviewCount} avis Google, ${nb(F.travelers)} voyageurs</span>
      ${link}
    </div>`;
  const card = (r) => {
    const initials = r.name.split(/\s+/).map((s) => s[0]).join('').toUpperCase();
    return `<article class="review-card">
        <div class="review-stars" role="img" aria-label="${r.rating} sur 5">${STAR_FILLED.replace('<svg ', '<svg fill="currentColor" ').repeat(r.rating)}</div>
        <p class="review-text">« ${esc(r.text)} »</p>
        <div class="review-author">
          <div class="review-avatar" aria-hidden="true">${esc(initials)}</div>
          <div class="review-meta"><div class="review-name">${esc(r.name)}</div><div class="review-trip">${esc(r.trip)}</div></div>
          ${GOOGLE_MARK}
        </div>
      </article>`;
  };
  const track = ok.length
    ? `\n  <div class="reviews-track-wrap">\n    <div class="reviews-track" id="reviewsTrack">\n      ${ok.map(card).join('\n      ')}\n    </div>\n  </div>`
    : '';
  return `  <div class="h-wrap">
    <div class="h-head reveal">
      <h2>Ils nous ont confié leur voiture</h2>
    </div>
    ${rating}
  </div>${track}`;
}

/* ═══ ACCUEIL : COMPARATIF ═══ */
function comparatif() {
  const OP = F.officialParkings;
  const YES = `<span class="cmp-yes">${ico('check', '')}</span>`;
  const NO = `<span class="cmp-no" aria-label="Non">${ico('x', '')}</span>`;
  const bar = (name, val, w, count) => `<li class="cmp-bar">
            <div class="cmp-bar-top"><b>${name}</b><strong${count ? ` data-count="${count}"` : ''}>${val}</strong></div>
            <div class="cmp-track" aria-hidden="true"><span style="--w:${w}%"></span></div>
          </li>`;

  /* A — Le tableau d'affichage : 2 manches, 1 gagnant (fond sombre, nous en bleu lumineux) */
  const round1 = `<div class="cmp-round">
        <div class="cmp-round-h"><span>Manche 1</span><b>Temps perdu</b><em>aller + retour</em></div>
        <div class="cmp-win">
          <div class="cmp-win-l"><span class="cmp-crown">${ico('award', '')}Gagnant</span><b>${F.brand}</b></div>
          <strong class="cmp-win-n">0<small>min</small></strong>
          <div class="cmp-win-track" aria-hidden="true"><span class="cmp-dot"></span></div>
        </div>
        <ul class="cmp-bars">
          ${bar(`Parkings ${OP.terminal.names}`, '20 à 40&nbsp;min', 30)}
          ${bar('Parking privé + navette', '1h30 à 2h', 100)}
        </ul>
      </div>`;
  const wk = F.prices.week, tw = OP.terminal.counterWeek;
  const round2 = terminalPricesOk ? `<div class="cmp-round">
        <div class="cmp-round-h"><span>Manche 2</span><b>Prix 1 semaine</b><em>tarif guichet*</em></div>
        <div class="cmp-win">
          <div class="cmp-win-l"><span class="cmp-crown">${ico('award', '')}Gagnant</span><b>${F.brand}</b></div>
          <strong class="cmp-win-n"><small>dès</small><span data-count="${wk}">${wk}</span><small>€</small></strong>
          <div class="cmp-win-track" aria-hidden="true"><span style="--w:${Math.round((wk / tw) * 100)}%"></span></div>
          <p class="cmp-save">${ico('check', '')}<span><b>${eur(tw - wk)} de moins</b> qu'en ${OP.terminal.names}</span></p>
        </div>
        <ul class="cmp-bars">
          ${bar(`Parkings ${OP.terminal.names}`, `${tw}&nbsp;€`, 100)}
        </ul>
        <p class="cmp-pct"><strong>&minus;${Math.round((1 - wk / tw) * 100)}&nbsp;%</strong><span>sur votre semaine à Orly</span></p>
      </div>` : '';
  const boardNote = terminalPricesOk
    ? `* Tarif au guichet (payé sur place) des parkings officiels de l'aéroport Paris-Orly, relevé le ${esc(OP.checkedOn)}, indicatif. Temps estimés hors bouchons.`
    : 'Temps estimés hors bouchons, à titre indicatif.';

  /* B — Le tableau : valeurs courtes, coches et croix */
  const rows = [
    ['walk', 'Marche avec les valises', `<strong>0&nbsp;min</strong>`, '3 à 10&nbsp;min'],
    ['pin', 'Où laisser la voiture', `<strong>Devant le terminal</strong>`, 'Dans le parking'],
    ['plane', 'Vol en retard suivi', YES, NO],
    ['bag', 'Aide aux bagages', YES, NO],
    ['sparkle', 'Lavage pendant le voyage', `${YES}<small>dès ${eur(F.prices.wash.exterieur)}</small>`, NO],
  ];
  const cols = [F.brand, OP.terminal.names];
  const rowHTML = rows.map(([k, label, a, b]) => `<tr>
            <th scope="row"><i>${ico(k, '')}</i>${label}</th>
            <td class="is-us" data-label="${cols[0]}">${a}</td>
            <td data-label="${cols[1]}">${b}</td>
          </tr>`).join('\n          ');

  /* C — Le parcours : 8 étapes avec une navette, 2 avec nous */
  const shuttle = [
    ['pin', 'Trouver le parking'], ['key', 'Remettre les clés'], ['hourglass', 'Attendre la navette'], ['bus', 'Trajet vers Orly'],
    ['hourglass', 'Attendre la navette'], ['bus', 'Trajet retour'], ['key', 'Retrouver la voiture'], ['euro', 'Payer et sortir'],
  ];
  const stepLi = ([k, t]) => `<li><i>${ico(k, '')}</i><span>${t}</span></li>`;
  const shuttleHTML = `<div class="cmp-path-row"><em>Aller</em><ol class="cmp-path-steps">${shuttle.slice(0, 4).map(stepLi).join('')}</ol></div>
        <div class="cmp-path-row"><em>Retour</em><ol class="cmp-path-steps">${shuttle.slice(4).map(stepLi).join('')}</ol></div>`;

  /* D — Pourquoi nous : 6 cartes, gros chiffre ou mot-clé */
  const why = [
    ['clock', '0 min', 'de marche, Orly 1 à 4'],
    ['star', `${ratingFr}/5`, `${F.reviewCount} avis Google`],
    ['award', `${cap(nb(F.yearsAtOrly))}`, `à Orly · ${nb(F.travelers)} voyageurs`],
    ['plane', 'Vol suivi', 'même en retard'],
    ['bag', 'Bagages', 'chargés au retour'],
    ['euro', 'Prix total', 'affiché, sans surprise'],
  ];
  const whyHTML = why.map(([k, t, d]) => `<li class="cmp-why-i"><i>${ico(k, '')}</i><b>${t}</b><span>${d}</span></li>`).join('\n        ');

  return `<section class="h-section h-cmp" id="comparatif" aria-labelledby="cmp-title">
  <div class="h-wrap">
    <div class="h-head reveal">
      <span class="h-eyebrow">Comparatif Orly</span>
      <h2 id="cmp-title">Voiturier ou parking à Orly&nbsp;: <span class="cmp-hl">le&nbsp;match</span></h2>
      <p>${terminalPricesOk ? '2 manches. Un seul gagnant.' : 'Le temps perdu, sans bouchons.'}</p>
    </div>

    <div class="cmp-board reveal${terminalPricesOk ? ' has-2' : ''}">
      <div class="cmp-rounds">
      ${round1}
      ${round2}
      </div>
      <p class="cmp-board-note">${boardNote}</p>
    </div>

    <div class="cmp-table-wrap reveal">
      <table class="cmp-table">
        <caption class="h-sr">${F.brand} ou parkings officiels de l'aéroport Paris-Orly</caption>
        <thead>
          <tr>
            <th scope="col"><span class="h-sr">Critère</span></th>
            <th scope="col" class="is-us"><span class="cmp-rec">Le plus choisi</span>${F.brand}</th>
            <th scope="col">${OP.terminal.names}</th>
          </tr>
        </thead>
        <tbody>
          ${rowHTML}
        </tbody>
      </table>
    </div>

    <div class="cmp-path reveal">
      <div class="cmp-path-col is-them">
        <div class="cmp-path-h"><b>Avec une navette</b><strong>8 étapes</strong></div>
        ${shuttleHTML}
        <p class="cmp-path-r">${ico('hourglass', '')}≈&nbsp;1h30 à 2h perdues</p>
      </div>
      <div class="cmp-path-col is-us">
        <div class="cmp-path-h"><b>Avec ${F.brand}</b><strong>2 étapes</strong></div>
        <ol class="cmp-path-steps">
          <li><i>${ico('key', '')}</i><span><em>Aller</em>Vous donnez vos clés au dépose-minute</span></li>
          <li><i>${ico('key', '')}</i><span><em>Retour</em>Vous les récupérez au même endroit</span></li>
        </ol>
        <p class="cmp-path-r">${ico('check', '')}0 attente, 0 navette</p>
      </div>
    </div>

    <div class="cmp-why reveal">
      <h3 class="cmp-why-t">Pourquoi ${F.brand}</h3>
      <ul class="cmp-why-grid">
        ${whyHTML}
      </ul>
      <div class="cmp-cta"><a class="h-btn lg" href="#reserver" data-focus-calc><span>Calculer mon prix en 30 secondes</span>${ico('arrow')}</a>
        <a class="cmp-more" href="/comparatif-parking-orly">Voir le comparatif détaillé des parkings d'Orly ${ico('arrow')}</a></div>
    </div>
  </div>
  <script>(function(){var r=window.matchMedia&&matchMedia('(prefers-reduced-motion: reduce)').matches;if(r||!('IntersectionObserver' in window))return;var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;io.unobserve(e.target);var el=e.target,end=+el.getAttribute('data-count'),html=el.innerHTML,t0=null;function f(t){if(!t0)t0=t;var p=Math.min((t-t0)/1100,1);p=1-Math.pow(1-p,3);el.textContent=Math.round(end*p);if(p<1)requestAnimationFrame(f);else el.innerHTML=html;}requestAnimationFrame(f);});},{threshold:.6});document.querySelectorAll('#comparatif [data-count]').forEach(function(n){io.observe(n);});})();</script>
</section>`;
}

/* ═══ ACCUEIL : FAQ ═══ */
function faqBlock() {
  const det = (x) => `<details>
        <summary>${x.q}</summary>
        <div class="faq-body"${x.id ? ` id="${x.id}"` : ''}>${x.a}</div>
      </details>`;
  const vis = FAQ.filter((x) => x.visible), extra = FAQ.filter((x) => !x.visible);
  return `    <div class="h-faq reveal">
      ${vis.map(det).join('\n      ')}
      <div class="h-faq-extra" id="faqExtra" hidden>
      ${extra.map(det).join('\n      ')}
      </div>
    </div>
    <p class="h-faq-more"><button type="button" id="faqToggle" aria-expanded="false" aria-controls="faqExtra" data-count="${FAQ.length}">Voir les ${FAQ.length} questions</button></p>`;
}

const sticky = () => `<div class="sticky-cta-price"><span class="from" id="stickyFrom">Dès</span> <strong id="stickyPrice">${F.prices.shortStay}€</strong></div>`;

/* ═══ PAGES LÉGALES ═══ */
function pageShell({ slug, title, description, h1, eyebrow, body, breadcrumbName }) {
  const url = `${SITE}/${slug}`;
  const ld = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'WebSite', '@id': `${SITE}/#website`, url: `${SITE}/`, name: F.brand, inLanguage: 'fr-FR' },
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Accueil', item: `${SITE}/` },
        { '@type': 'ListItem', position: 2, name: breadcrumbName, item: url },
      ] },
    ],
  };
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<!-- Page générée par scripts/build-seo.mjs — ne pas modifier à la main -->
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<meta name="robots" content="index, follow">
<link rel="canonical" href="${url}">
<meta property="og:type" content="website">
<meta property="og:url" content="${url}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}/og-image.jpg">
<meta property="og:locale" content="fr_FR">
<meta property="og:site_name" content="${F.brand}">
<link rel="icon" type="image/svg+xml" href="/favicon.svg?v=2">
<meta name="theme-color" content="#0284C7">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;600;700;800;900&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/style.css">
<link rel="stylesheet" href="/home.css">
<link rel="stylesheet" href="/page.css">
<script type="application/ld+json">
${JSON.stringify(ld)}
</script>
<script src="/tracking.js"></script>
<script src="/utils/analytics.js"></script>
</head>
<body class="home page">
<!--seo:header-->
${header({ home: false })}
<!--/seo:header-->

<main>
<header class="page-hero">
  <div class="container">
    <p class="section-eyebrow">${eyebrow}</p>
    <h1>${h1}</h1>
  </div>
</header>
<section class="legal-page">
  <div class="h-wrap">
${body}
  </div>
</section>
</main>

<!--seo:footer-->
${footer()}
<!--/seo:footer-->
</body>
</html>
`;
}

function cgvPage(indexHtml) {
  const m = indexHtml.match(/<div class="cgv-content">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/);
  if (!m) throw new Error('CGV introuvables dans index.html (div.cgv-content)');
  const inner = m[1]
    .replace(/<h2>[^<]*<\/h2>/, '')
    .replace(/ style="[^"]*"/g, ' class="legal-date"')
    .trim();
  return pageShell({
    slug: 'conditions-generales',
    title: `Conditions générales de vente | ${F.brand}`,
    description: `Conditions générales de vente du service de voiturier ${F.brand} à l'aéroport Paris-Orly : tarifs, paiement, annulation, retards, responsabilité.`,
    h1: 'Conditions générales de vente',
    eyebrow: 'Légal',
    breadcrumbName: 'Conditions générales',
    body: `    <div class="legal-content">\n${inner}\n    </div>`,
  });
}

function mentionsPage() {
  const L = F.legal;
  const v = (x) => (isSet(x) ? esc(x) : '<em class="legal-todo">[à compléter]</em>');
  return pageShell({
    slug: 'mentions-legales',
    title: `Mentions légales | ${F.brand}`,
    description: `Mentions légales du site ${F.brand} : éditeur, directeur de la publication, hébergeur, contact.`,
    h1: 'Mentions légales',
    eyebrow: 'Légal',
    breadcrumbName: 'Mentions légales',
    body: `    <div class="legal-content">
      <h3>Éditeur du site</h3>
      <p>Le site ${SITE.replace('https://', '')} est édité par&nbsp;:</p>
      <ul>
        <li><strong>Société&nbsp;:</strong> ${v(L.companyName)}</li>
        <li><strong>Forme juridique&nbsp;:</strong> ${v(L.legalForm)}</li>
        <li><strong>SIRET&nbsp;:</strong> ${v(L.siret)}</li>
        <li><strong>Siège social&nbsp;:</strong> ${v(L.headOffice)}</li>
        <li><strong>Email&nbsp;:</strong> <a href="mailto:${F.email}">${F.email}</a></li>${isSet(F.phone) ? `\n        <li><strong>Téléphone&nbsp;:</strong> <a href="${telHref}">${esc(F.phone)}</a></li>` : ''}
      </ul>
      <h3>Directeur de la publication</h3>
      <p>${v(L.publicationDirector)}</p>
      <h3>Hébergeur</h3>
      <p>${v(L.host)}</p>
      <h3>Données personnelles</h3>
      <p>Les données collectées lors d'une réservation servent uniquement à l'exécution du service, à la facturation et au suivi client. Vous disposez d'un droit d'accès, de rectification et de suppression en écrivant à <a href="mailto:${F.email}">${F.email}</a>. Le détail figure dans nos <a href="/conditions-generales">conditions générales</a>.</p>
      <h3>Cookies</h3>
      <p>Les cookies de mesure d'audience et de publicité ne sont déposés qu'avec votre accord, recueilli via le bandeau affiché lors de votre première visite.</p>
    </div>`,
  });
}

/* ═══ llms.txt ═══ */
function llmsTxt(sitemapUrls) {
  const P = F.prices;
  return `# ${F.brand}

> Service de voiturier et parking à l'aéroport Paris-Orly. Prise en charge au terminal, gardiennage surveillé du véhicule, restitution au retour. Tarif calculé en 30 secondes, prix total affiché avant paiement, dès ${P.shortStay}€. Note ${ratingFr}/5 sur ${F.reviewCount} avis Google.

Présent à l'aéroport Paris-Orly depuis ${F.yearsAtOrly}, ${F.travelers.replace('+', 'plus de ')} voyageurs accompagnés. Horaires : ${F.hours.label}. Court séjour dès ${P.shortStay} €, 1 semaine dès ${P.week} €.

${F.brand} permet aux voyageurs au départ de l'aéroport Paris-Orly (ORY) de confier leur véhicule à un voiturier directement au dépose-minute de leur terminal (Orly 1, 2, 3 et 4), sans navette à attendre. Le véhicule est gardé sous vidéosurveillance 24h/24 et restitué au terminal d'arrivée au retour du client. Le prix est dégressif selon la durée, tout compris (prise en charge, gardiennage, restitution), et affiché avant le paiement.

## Comparatif

- Voiturier ${F.brand} : 0 minute de marche, la voiture est remise et récupérée au dépose-minute du terminal. Suivi du vol en cas de retard, aide aux bagages au retour.
- Parkings officiels P1, P2, P3 : 3 à 10 minutes à pied par trajet avec les valises, soit environ 20 à 40 minutes perdues sur l'aller et le retour.
- Parking privé avec navette : 1h30 à 2h perdues au total (trouver le parking, attendre la navette, le trajet, retrouver la voiture, à l'aller comme au retour).
- Détail : [Voiturier ou parking à Orly](${SITE}/#comparatif)

## Pages

${sitemapUrls.filter((u) => LLMS_PAGES[u.slug]).map((u) => `- [${LLMS_PAGES[u.slug][0]}](${u.loc}): ${LLMS_PAGES[u.slug][1]}`).join('\n')}

## Contact

- Email : ${F.email}${isSet(F.phone) ? `\n- Téléphone : ${F.phone}` : ''}
`;
}
const LLMS_PAGES = {
  '': ['Accueil', 'présentation du service, calcul du tarif, comparatif voiturier / parkings d\'Orly, avis clients, FAQ.'],
  'parking-orly': ['Parking Orly avec voiturier', 'présentation du parking sécurisé associé au service voiturier.'],
  'tarifs': ['Tarifs', 'grille tarifaire et détail de ce qui est inclus.'],
  'comment-ca-marche': ['Comment ça marche', 'étapes du service, de la réservation à la restitution.'],
  'faq': ['FAQ', 'réponses aux questions fréquentes (tarifs, retard de vol, annulation, paiement, assurance des véhicules).'],
  'voiturier-orly-terminaux': ['Voiturier Orly 1, 2, 3 et 4', 'prise en charge au dépose-minute des terminaux Orly 1-2, Orly 3 et Orly 4, restitution au terminal d\'arrivée.'],
  'voiturier-orly-1-2': ['Voiturier Orly 1 et Orly 2', 'prise en charge au dépose-minute d\'Orly 1-2.'],
  'voiturier-orly-3': ['Voiturier Orly 3', 'prise en charge au dépose-minute d\'Orly 3.'],
  'voiturier-transavia-orly': ['Voiturier Transavia Orly', 'voiturier pour les vols Transavia (Orly 1 ou Orly 2).'],
  'voiturier-orly-4': ['Voiturier Orly 4', 'prise en charge au dépose-minute d\'Orly 4.'],
  'horaires-voiturier-orly': ['Horaires du voiturier à Orly', `service ${F.hours.label}.`],
  'parking-orly-pas-cher': ['Parking Orly pas cher', `tarifs dès ${F.prices.shortStay}€ la journée et dès ${F.prices.week}€ la semaine, prix dégressif et tout compris, identique en ligne ou sur place.`],
  'code-promo-voiturier-orly': ['Code promo voiturier Orly', 'code BIENVENUE, -10% sur la première réservation (vérifiée par adresse email), réduction affichée avant paiement, en ligne ou sur place.'],
  'suivi-reservation-voiturier-orly': ['Suivi de réservation voiturier Orly', 'espace client personnel, statut de la réservation à chaque étape (confirmée, prise en charge, stationnée, restituée), notifications automatiques, factures.'],
  'parking-longue-duree-orly': ['Parking longue durée Orly', 'gardiennage sous vidéosurveillance 24h/24, parking couvert et lavage en option.'],
  'lavage-voiture-orly': ['Lavage voiture Orly', `lavage pendant le voyage, Extérieur ${F.prices.wash.exterieur}€, Intérieur ${F.prices.wash.interieur}€, Complet ${F.prices.wash.complet}€, Premium ${F.prices.wash.premium}€.`],
  'guides-voiturier-orly': ['Guides Orly', 'index de tous les guides (comparatifs, prix, terminaux, vacances, options).'],
  'meilleur-voiturier-orly': ['Meilleur voiturier Orly : bien choisir', 'les critères qui comptent pour choisir un voiturier à Orly, et comment Direct Voiturier y répond.'],
  'comparatif-parking-orly': ['Comparatif parking Orly', 'voiturier, parking navette, parking de l\'aéroport, taxi : quelle solution pour aller à Orly ?'],
  'voiturier-ou-parking-navette-orly': ['Voiturier ou parking navette à Orly ?', 'les différences concrètes entre un voiturier et un parking avec navette.'],
  'parking-orly-vacances-toussaint': ['Parking Orly vacances de la Toussaint 2026', 'partir d\'Orly du 17 octobre au 2 novembre 2026 sans stress.'],
  'parking-orly-vacances-noel': ['Parking Orly vacances de Noël 2026', 'partir d\'Orly pour les fêtes, du 19 décembre 2026 au 4 janvier 2027.'],
  'parking-orly-week-end': ['Parking Orly week-end', `un voiturier pour un week-end ou un court séjour, dès ${F.prices.shortStay}€.`],
  'parking-orly-une-semaine': ['Parking Orly une semaine', `une semaine de voyage, dès ${F.prices.week}€ tout compris.`],
  'parking-couvert-orly': ['Parking couvert Orly', 'votre voiture à l\'abri des intempéries pendant votre voyage.'],
  'reserver-voiturier-orly': ['Réserver un voiturier à Orly', 'tarif en 30 secondes, paiement en ligne ou sur place, confirmation par email.'],
  'voiturier-orly-vol-retarde': ['Vol retardé à Orly : que devient votre voiture ?', 'suivi du numéro de vol et adaptation à votre heure d\'atterrissage.'],
  'conditions-generales': ['Conditions générales de vente', 'tarifs, paiement, annulation, retards, responsabilité.'],
  'mentions-legales': ['Mentions légales', 'éditeur du site, hébergeur, contact.'],
};

/* ═══ sitemap.xml ═══ */
function gitDate(file) {
  try {
    const rel = path.relative(ROOT, file);
    const dirty = execFileSync('git', ['status', '--porcelain', '--', rel], { cwd: ROOT }).toString().trim();
    if (dirty) return new Date().toISOString().slice(0, 10);
    const d = execFileSync('git', ['log', '-1', '--format=%cs', '--', rel], { cwd: ROOT }).toString().trim();
    return d || new Date().toISOString().slice(0, 10);
  } catch { return new Date().toISOString().slice(0, 10); }
}
function buildSitemap() {
  const prev = fs.existsSync(path.join(PUB, 'sitemap.xml')) ? fs.readFileSync(path.join(PUB, 'sitemap.xml'), 'utf8') : '';
  const meta = {};
  for (const m of prev.matchAll(/<loc>([^<]+)<\/loc>[\s\S]*?<changefreq>([^<]+)<\/changefreq>[\s\S]*?<priority>([^<]+)<\/priority>/g)) meta[m[1]] = { cf: m[2], pr: m[3] };
  const files = fs.readdirSync(PUB).filter((f) => f.endsWith('.html')).sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : 0));
  const urls = files.map((f) => {
    const slug = f === 'index.html' ? '' : f.replace(/\.html$/, '');
    const loc = `${SITE}/${slug}`;
    const m = meta[loc] || (slug.match(/^(conditions-generales|mentions-legales)$/) ? { cf: 'yearly', pr: '0.3' } : { cf: 'monthly', pr: '0.6' });
    return { slug, loc, lastmod: gitDate(path.join(PUB, f)), ...m };
  });
  // Ordre : on garde celui de l'ancien sitemap, nouvelles pages à la fin
  const order = Object.keys(meta);
  urls.sort((a, b) => {
    const ia = order.indexOf(a.loc), ib = order.indexOf(b.loc);
    return (ia < 0 ? 1e9 : ia) - (ib < 0 ? 1e9 : ib);
  });
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>
    <loc>${u.loc}</loc>
    <lastmod>${u.lastmod}</lastmod>
    <changefreq>${u.cf}</changefreq>
    <priority>${u.pr}</priority>
  </url>`).join('\n')}
</urlset>
`;
  return { xml, urls };
}

/* ═══ EXÉCUTION ═══ */
const write = (rel, content) => {
  const f = path.join(PUB, rel);
  const before = fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
  if (before !== content) { fs.writeFileSync(f, content); console.log('  ✎', rel); }
};

// 1. Accueil
const idxFile = path.join(PUB, 'index.html');
let idx = fs.readFileSync(idxFile, 'utf8');
const homeRegions = {
  meta: homeMeta(), jsonld: homeJsonLd(), contact: homeContact(), header: header({ home: true }),
  'hero-badge': heroBadge(), 'hero-trust': heroTrust(), prices: priceCards(), reviews: reviewsBlock(),
  comparatif: comparatif(), faq: faqBlock(), footer: footer(), sticky: sticky(),
};
for (const [k, v] of Object.entries(homeRegions)) idx = replaceRegion(idx, k, v, 'index.html');
write('index.html', idx);


/* ═══ PAGES SECONDAIRES : bloc « L'essentiel » + FAQ (contenu : content/pages-extra.mjs) ═══ */
const EXTRA = pagesExtra(F);
const ENT = { nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', agrave: 'à', Agrave: 'À', Eacute: 'É', ugrave: 'ù', ocirc: 'ô', ccedil: 'ç', amp: '&', middot: '·', euro: '€', minus: '−', rarr: '→', mdash: '—', quot: '"', lt: '<', gt: '>' };
const decode = (t) => t.replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCodePoint(parseInt(x, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&([a-z]+);/gi, (m, n) => (n in ENT ? ENT[n] : m));
const faqItem = ({ q, a }) => `      <details class="faq-item">
        <summary>${q}</summary>
        <div class="faq-body">${a}</div>
      </details>`;
const dayLabel = (d) => ({ 1: '1 jour', 7: '1 semaine', 14: '2 semaines', 21: '3 semaines', 30: '1 mois' }[d] || `${d} jours`);
const WA_NUM = isSet(F.whatsapp) ? String(F.whatsapp).replace(/[^0-9]/g, '') : '';
const WA_ICON = '<svg viewBox="0 0 32 32" fill="currentColor" aria-hidden="true"><path d="M16 3C9.4 3 4 8.4 4 15c0 2.1.6 4.2 1.6 6L4 29l8.2-1.5c1.2.6 2.5.9 3.8.9 6.6 0 12-5.4 12-12S22.6 3 16 3zm0 21.8c-1.2 0-2.4-.3-3.5-.8l-.6-.3-4.9.9 1-4.7-.4-.6c-.9-1.5-1.4-3.2-1.4-5 0-5.4 4.4-9.8 9.8-9.8s9.8 4.4 9.8 9.8-4.4 9.5-9.8 9.5z"/></svg>';
function contactLinks() {
  const tel = telHref ? `<a class="px-call" href="${telHref}">${ico('phone', '')}<span>${esc(F.phone)}</span></a>` : '';
  const wa = WA_NUM ? `<a class="px-wa" href="https://wa.me/${WA_NUM}?text=${encodeURIComponent('Bonjour, je souhaite réserver un voiturier à Orly.')}" target="_blank" rel="noopener">${WA_ICON}<span>WhatsApp</span></a>` : '';
  return tel + wa;
}
function extraBlock(slug, e) {
  const G = F.prices.grid, OP = F.officialParkings;
  const tiles = (e.grid || []).filter((d) => G[d]).map((d) => `<li${d === 7 ? ' class="is-key"' : ''}><span>${dayLabel(d)}</span><b>${G[d]}<small>&nbsp;€</small></b></li>`).join('');
  const vsOk = e.vs && terminalPricesOk;
  const vs = vsOk ? `<div class="px-vs"><p><span>1 semaine au guichet ${OP.terminal.names}*</span><s>${eur(OP.terminal.counterWeek)}</s></p><p class="is-us"><span>1 semaine avec ${F.brand}</span><b>${eur(G[7])}</b></p><strong>&minus;${eur(OP.terminal.counterWeek - G[7])}</strong></div>` : '';
  const note = [vsOk ? `* Tarif au guichet des parkings officiels de l'aéroport Paris-Orly, relevé le ${esc(OP.checkedOn)}, indicatif.` : '', tiles ? 'Prix de base tout compris, jour du départ et jour du retour inclus, hors options.' : ''].filter(Boolean).join(' ');
  return `<section class="px" aria-labelledby="px-t">
  <div class="container">
    <div class="section-head">
      <p class="section-eyebrow">${e.eyebrow}</p>
      <h2 class="section-title" id="px-t">${e.title}</h2>
    </div>
    <div class="px-card">${tiles ? `\n      <ul class="px-tiles">${tiles}</ul>` : ''}${vs ? `\n      ${vs}` : ''}
      <div class="px-prose">${e.prose.map((t) => `<p>${t}</p>`).join('')}</div>
      <div class="px-actions"><a class="h-btn" href="/#reserver"><span>Calculer mon prix exact</span>${ico('arrow')}</a>${contactLinks()}</div>${note ? `\n      <p class="px-note">${note}</p>` : ''}
    </div>
  </div>
</section>`;
}
// Le FAQPage JSON-LD reprend exactement les questions visibles de la page.
function syncFaqLd(h) {
  const items = [...h.matchAll(/<details class="faq-item"[^>]*>\s*<summary>([\s\S]*?)<\/summary>\s*<div class="faq-body"[^>]*>([\s\S]*?)<\/div>\s*<\/details>/g)]
    .map(([, q, a]) => ({ '@type': 'Question', name: decode(stripTags(q)), acceptedAnswer: { '@type': 'Answer', text: decode(stripTags(a)) } }));
  const m = h.match(/(<script type="application\/ld\+json">\s*)([\s\S]*?)(\s*<\/script>)/);
  if (!m || !items.length) return h;
  let data; try { data = JSON.parse(m[2]); } catch { return h; }
  if (!data['@graph']) return h;
  const g = data['@graph'];
  const i = g.findIndex((n) => n['@type'] === 'FAQPage');
  const node = { '@type': 'FAQPage', mainEntity: items };
  if (i >= 0) g[i] = node; else g.push(node);
  return h.replace(m[0], m[1] + JSON.stringify(data) + m[3]);
}

// 2. Pages secondaires : en-tête + pied de page communs
for (const f of fs.readdirSync(PUB).filter((x) => x.endsWith('.html') && !['index.html', 'conditions-generales.html', 'mentions-legales.html'].includes(x))) {
  let h = fs.readFileSync(path.join(PUB, f), 'utf8');
  if (!hasRegion(h, 'header')) continue;
  h = replaceRegion(h, 'header', header({ home: false }), f);
  h = replaceRegion(h, 'footer', footer({ wa: true }), f);
  const slug = f.replace(/\.html$/, '');
  const ex = EXTRA[slug];
  if (ex && hasRegion(h, 'extra')) h = replaceRegion(h, 'extra', extraBlock(slug, ex), f);
  if (ex && hasRegion(h, 'extrafaq')) h = replaceRegion(h, 'extrafaq', (ex.faq || []).map(faqItem).join('\n'), f);
  h = syncFaqLd(h);
  write(f, h);
}

// 3. Pages légales (générées entièrement)
write('conditions-generales.html', cgvPage(idx));
write('mentions-legales.html', mentionsPage());

// 4. Sitemap puis llms.txt (le sitemap regarde git : à générer après les pages)
const { xml, urls } = buildSitemap();
write('sitemap.xml', xml);
write('llms.txt', llmsTxt(urls));

// 5. Récapitulatif des valeurs à compléter
const todos = [];
const walk = (o, p) => { for (const [k, v] of Object.entries(o)) { if (v && typeof v === 'object') walk(v, `${p}.${k}`); else if (String(v).includes('TODO')) todos.push(`${p}.${k}`); } };
walk(F, 'seoFacts');
const missingReviews = REVIEWS.filter((r) => !isSet(r.name) || !isSet(r.text) || !isSet(r.trip)).length;
if (missingReviews) todos.push(`content/reviews.mjs : ${missingReviews} avis à remplir`);
console.log(todos.length ? `\nÀ compléter (${todos.length}) :\n  - ${todos.join('\n  - ')}` : '\nTout est renseigné.');
