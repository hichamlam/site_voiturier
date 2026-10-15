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
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
};
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
function footer() {
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
</footer>`;
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
    ...(isSet(F.phone) ? { telephone: telHref.slice(4) } : {}),
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
        <a class="h-trust-i" href="#comparatif"><b><small>Jusqu'à</small>&minus;70&nbsp;%</b><span>vs tarif guichet des parkings officiels</span></a>
        <a class="h-trust-i" href="#comparatif"><b>1h30</b><span>gagnée, sans navette</span></a>
        <div class="h-trust-i"><b>${nb(F.travelers)}</b><span>voyageurs servis</span></div>
      </div>`;

/* ═══ ACCUEIL : tarifs ═══ */
const priceCards = () => `<div class="h-prices reveal">
      <div class="h-price-card"><b>Court séjour</b><div class="amt"><small>dès</small><strong>${eur(F.prices.shortStay)}</strong></div><span>1 jour · aller-retour rapide</span></div>
      <div class="h-price-card"><b>1 semaine</b><div class="amt"><small>dès</small><strong>${eur(F.prices.week)}</strong></div><span>Le prix par jour baisse avec la durée</span></div>
    </div>`;

/* ═══ ACCUEIL : avis ═══ */
function reviewsBlock() {
  const ok = REVIEWS.filter((r) => isSet(r.name) && isSet(r.text) && isSet(r.date) && r.rating >= 1 && r.rating <= 5);
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
        <div class="review-stars" role="img" aria-label="${r.rating} sur 5">${STAR_FILLED.repeat(r.rating)}</div>
        <p class="review-text">« ${esc(r.text)} »</p>
        <div class="review-author">
          <div class="review-avatar" aria-hidden="true">${esc(initials)}</div>
          <div class="review-meta"><div class="review-name">${esc(r.name)}</div><div class="review-trip">Avis Google · ${esc(r.date)}</div></div>
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
  const bars = [
    { us: true, name: F.brand, detail: 'vous descendez au dépose-minute', val: '0&nbsp;min', w: 3 },
    { name: `Parkings ${OP.terminal.names}`, detail: 'chercher une place, marcher avec les valises, payer, retrouver la voiture', val: '≈&nbsp;20 à 40&nbsp;min', w: 30 },
    { name: OP.eco.names, detail: 'navette toutes les 9 à 15 min + 15 min de trajet, deux fois', val: '≈&nbsp;40&nbsp;min à 1h20', w: 60 },
    { name: 'Parking privé avec navette', detail: 'voir le détail ci-dessous', val: '1h30 à 2h', w: 100 },
  ];
  const barHTML = bars.map((b) => `<li class="cmp-bar${b.us ? ' is-us' : ''}">
            <div class="cmp-bar-top"><b>${b.name}</b><strong>${b.val}</strong></div>
            <div class="cmp-bar-track" aria-hidden="true"><span style="--w:${b.w}%"></span></div>
            <p>${b.detail}</p>
          </li>`).join('\n          ');

  const allerSteps = ['Trouver le parking et le point de rendez-vous', 'Attendre la remise des clés ou se garer soi-même', 'Attendre la navette', 'Faire le trajet jusqu\'à l\'aéroport (plus long si bouchons)'];
  const retourSteps = ['Attendre la navette avec vos valises', 'Refaire le trajet jusqu\'au parking', 'Attendre qu\'on retrouve votre voiture, ou la chercher vous-même', 'La sortir du parking, puis enfin partir'];
  const steps = (arr) => arr.map((s, i) => `<li><i>${i + 1}</i><span>${s}</span></li>`).join('');

  const rows = [
    ['Où laisser la voiture', 'Au dépose-minute de votre terminal', 'Dans le parking, à vous de trouver une place', 'Parking extérieur éloigné'],
    ['Marche avec les valises', '0&nbsp;min', '3 à 10&nbsp;min', 'Navette ≈&nbsp;15&nbsp;min + attente'],
    ['Au retour', 'Voiture devant votre terminal, on charge vos valises', 'Retour à pied jusqu\'à la voiture, paiement à la sortie', 'Navette puis recherche de la voiture'],
    ['Retard de vol', 'Suivi du vol, voiturier là à l\'atterrissage', 'Rien', 'Rien'],
    ...(terminalPricesOk ? [['Prix 1 semaine', `<strong>Dès ${eur(F.prices.week)}, tout compris</strong>`, `≈&nbsp;${eur(OP.terminal.counterWeek)} au guichet`, `≈&nbsp;${eur(OP.eco.counterWeek)} au guichet`]] : []),
    ['Lavage pendant le voyage', `Oui, en option (dès ${eur(F.prices.wash.exterieur)})`, 'Non', 'Non'],
  ];
  const cols = [F.brand, `Parkings ${OP.terminal.names}`, OP.eco.names];
  const rowHTML = rows.map((r) => `<tr>
              <th scope="row">${r[0]}</th>
              <td class="is-us" data-label="${cols[0]}">${r[1]}</td>
              <td data-label="${cols[1]}">${r[2]}</td>
              <td data-label="${cols[2]}">${r[3]}</td>
            </tr>`).join('\n            ');
  const source = terminalPricesOk
    ? `Tarifs au guichet (sur place, sans réservation) des parkings officiels de l'aéroport Paris-Orly, relevés le ${esc(OP.checkedOn)}, à titre indicatif. Temps estimés hors bouchons.`
    : 'Temps estimés hors bouchons, à titre indicatif.';

  const why = [
    ['clock', '0 minute de marche', 'Dépose-minute de votre terminal, Orly 1, 2, 3 et 4'],
    ['award', `Présents à Orly depuis ${nb(F.yearsAtOrly)}`, `${nb(F.travelers)} voyageurs accompagnés`],
    ['star', `Noté ${ratingFr}/5`, `sur ${F.reviewCount} avis Google`],
    ['plane', 'Suivi de votre vol', 'On vous attend même si vous atterrissez en retard'],
    ['bag', 'Aide aux bagages', 'On charge vos valises au retour'],
    ['camera', 'Photos de contrôle', 'Prises avec vous à la remise des clés'],
    ['shield', 'Gardiennage sous vidéosurveillance 24h/24', `Option parking couvert +${eur(F.prices.covered)}`],
    ['euro', 'Prix total avant de payer', 'En ligne ou sur place, même prix'],
  ];
  const whyHTML = why.map(([k, t, d]) => `<li class="cmp-why-i"><i>${ico(k, '')}</i><b>${t}</b><span>${d}</span></li>`).join('\n        ');

  return `<section class="h-section h-cmp" id="comparatif" aria-labelledby="cmp-title">
  <div class="h-wrap">
    <div class="h-head reveal">
      <span class="h-eyebrow">Comparatif Orly</span>
      <h2 id="cmp-title">Voiturier ou parking à Orly&nbsp;: combien de temps et d'argent vous perdez&nbsp;?</h2>
      <p>Présents à Orly depuis ${nb(F.yearsAtOrly)}, on connaît chaque parking de l'aéroport. Voici la différence, honnêtement.</p>
    </div>

    <div class="cmp-card reveal">
      <h3 class="cmp-h3">Temps perdu sur l'aller + le retour</h3>
      <ul class="cmp-bars">
          ${barHTML}
      </ul>
      <p class="cmp-zero">Chez nous, le temps perdu, c'est <b>0&nbsp;minute</b>&nbsp;: votre voiturier vous attend au dépose-minute de votre terminal, à l'aller comme au retour.</p>
    </div>

    <div class="cmp-shuttle reveal">
      <h3 class="cmp-h3">Avec une navette, voici ce que vous faites… deux fois</h3>
      <div class="cmp-shuttle-cols">
        <div class="cmp-card"><b class="cmp-col-t">À l'aller</b><ol class="cmp-steps">${steps(allerSteps)}</ol></div>
        <div class="cmp-card"><b class="cmp-col-t">Au retour</b><ol class="cmp-steps">${steps(retourSteps)}</ol></div>
      </div>
      <div class="cmp-result">
        <p><b>Résultat&nbsp;: 1h30 à 2h perdues au minimum, quand tout se passe bien.</b></p>
        <p>Avec ${F.brand}&nbsp;: <b>0 étape</b>. Vous donnez vos clés au dépose-minute, vous les récupérez au même endroit.</p>
      </div>
    </div>

    <div class="cmp-table-wrap reveal">
      <table class="cmp-table">
        <caption class="cmp-h3">${F.brand} ou parkings officiels de l'aéroport Paris-Orly</caption>
        <thead>
          <tr>
            <th scope="col"><span class="h-sr">Critère</span></th>
            <th scope="col" class="is-us"><span class="cmp-rec">Le plus choisi</span>${F.brand}</th>
            <th scope="col">Parkings ${OP.terminal.names}</th>
            <th scope="col">${OP.eco.names}</th>
          </tr>
        </thead>
        <tbody>
            ${rowHTML}
        </tbody>
      </table>
      <p class="cmp-source">${source}</p>
    </div>

    <div class="cmp-why reveal">
      <h3 class="cmp-h3">Pourquoi ${F.brand}</h3>
      <ul class="cmp-why-grid">
        ${whyHTML}
      </ul>
      <div class="cmp-cta"><a class="h-btn lg" href="#reserver" data-focus-calc><span>Calculer mon prix en 30 secondes</span>${ico('arrow')}</a></div>
    </div>
  </div>
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
- P Eco / P Eco 2 : navette d'environ 15 minutes (passage toutes les 9 à 15 minutes), deux fois, soit environ 40 minutes à 1h20 perdues.
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

// 2. Pages secondaires : en-tête + pied de page communs
for (const f of fs.readdirSync(PUB).filter((x) => x.endsWith('.html') && x !== 'index.html')) {
  let h = fs.readFileSync(path.join(PUB, f), 'utf8');
  if (!hasRegion(h, 'header')) continue;
  h = replaceRegion(h, 'header', header({ home: false }), f);
  h = replaceRegion(h, 'footer', footer(), f);
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
const missingReviews = REVIEWS.filter((r) => !isSet(r.name) || !isSet(r.text) || !isSet(r.date)).length;
if (missingReviews) todos.push(`content/reviews.mjs : ${missingReviews} avis à remplir`);
console.log(todos.length ? `\nÀ compléter (${todos.length}) :\n  - ${todos.join('\n  - ')}` : '\nTout est renseigné.');
