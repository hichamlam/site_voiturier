/* ════════════════════════════════════════════════
   STATE GLOBAL
═══════════════════════════════════════════════ */
const STATE = {
  // Simulateur sur la home
  sim: {
    step: 1,           // 1=dates, 2=catégorie, 3=tarif
    depDate: '', depTime: '08:00',
    retDate: '', retTime: '20:00',
    categoryCode: 'citadine',
    quotedPrice: 0,
  },
  // Tunnel de réservation
  booking: {
    step: 1,
    data: {
      departure: { date:'', time:'08:00', terminal:'' },
      return:    { date:'', time:'20:00', terminal:'' },
      car:       { categoryCode:'citadine', brand:'', model:'', color:'', plate:'' },
      customer:  { firstname:'', lastname:'', email:'', phone:'', flight:'' },
      wash:      { type:'none', price:0 },
      options:   { coveredParking:false, priorityAccess:false },
      promoCode: null,
      promoDiscount: 0,
    },
    payment: 'stripe',
    serverPrice: null,
  },
};

/* ════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════ */
function escapeHtml(s) {
  if (s == null) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
}
function fmtDateShort(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short' });
}

/* ════════════════════════════════════════════════
   API CALLS
═══════════════════════════════════════════════ */
// Cache mémoire des tarifs déjà calculés (clé = payload JSON) : revenir sur
// un choix déjà tarifé est instantané, sans requête serveur.
const priceCache = new Map();
// Appels fetchPrice en attente d'une réponse, requête réseau en cours, et
// minuteur d'anti-rebond.
let priceWaiters = [];
let priceDebounceTimer = null;
let priceAbortController = null;

async function priceRunBatch() {
  priceDebounceTimer = null;
  if (priceWaiters.length === 0) return;

  // Seul le dernier appel compte : c'est lui qui reflète l'état actuel de l'UI.
  const { payload, key } = priceWaiters[priceWaiters.length - 1];

  // Annule la requête précédente encore en vol pour qu'une réponse lente
  // n'écrase pas une réponse plus récente (course entre requêtes).
  if (priceAbortController) priceAbortController.abort();
  const controller = new AbortController();
  priceAbortController = controller;

  // Résout tous les appels en attente, y compris ceux dont la requête a été
  // annulée : sans ça, un `await fetchPrice(...)` supplanté resterait bloqué
  // pour toujours et l'écran garderait son spinner.
  const flush = (value) => {
    const waiters = priceWaiters;
    priceWaiters = [];
    waiters.forEach(w => w.resolve(value));
  };

  try {
    const res = await fetch('/api/pricing', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) { flush(null); return; }
    const data = await res.json();
    priceCache.set(key, data);
    flush(data);
  } catch (e) {
    // Requête annulée : les appels en attente le restent, c'est le lot
    // suivant (déjà lancé) qui les résoudra avec un résultat plus récent.
    if (e.name === 'AbortError') return;
    flush(null);
  }
}

function fetchPrice(payload) {
  const key = JSON.stringify(payload);
  if (priceCache.has(key)) return Promise.resolve(priceCache.get(key));

  return new Promise(resolve => {
    priceWaiters.push({ payload, key, resolve });
    if (priceDebounceTimer) clearTimeout(priceDebounceTimer);
    priceDebounceTimer = setTimeout(priceRunBatch, 250);
  });
}

/* ════════════════════════════════════════════════
   NAV SCROLL
═══════════════════════════════════════════════ */
const nav = document.getElementById('nav');
window.addEventListener('scroll', () => {
  if (window.scrollY > 30) nav.classList.add('scrolled');
  else nav.classList.remove('scrolled');
}, { passive:true });


/* REVEAL ON SCROLL */
const obs = new IntersectionObserver(es => {
  es.forEach(e => {
    if (e.isIntersecting) {
      e.target.classList.add('visible');
      obs.unobserve(e.target);
    }
  });
}, { threshold: 0.12 });
document.querySelectorAll('.reveal').forEach(el => obs.observe(el));

/* AVIS — données */
const REVIEWS = [
  { name:'Marie C.',   trip:'Bali · 14 jours',     text:'Voyage à Bali, retour épuisée à 6h du matin. La voiture m\'attendait, propre, à l\'endroit prévu. C\'est la deuxième fois. Ce sera la troisième.' },
  { name:'Thomas R.',  trip:'Voyageur fréquent',   text:'Je voyage chaque mois pour le travail. Ils savent mon prénom, ma plaque, mes habitudes. C\'est ça, le vrai service premium.' },
  { name:'Sophie L.',  trip:'Lisbonne · 7 jours',  text:'Première fois que je laisse ma voiture à quelqu\'un. Lavage premium au retour. Je ne reconnaissais plus l\'intérieur. Adoptée.' },
  { name:'David M.',   trip:'New York · 10 jours', text:'Service ultra rapide à l\'aller comme au retour. Plus jamais de parking longue durée pour moi. Que du gain de temps.' },
  { name:'Aïcha B.',   trip:'Marrakech · 5 jours', text:'Avec deux enfants en bas âge et les bagages, c\'était un soulagement. Le voiturier nous a même aidés à sortir la poussette.' },
  { name:'Julien P.',  trip:'Rome · 4 jours',      text:'Ponctuel, pro, courtois. Voiture rendue impeccable. Le prix est plus que correct vu la qualité du service. Bravo.' },
  { name:'Camille D.', trip:'Athènes · 8 jours',   text:'Réservation en 2 minutes, confirmation immédiate. Le retour à 23h, le voiturier était là dans les 10 minutes. Parfait.' },
  { name:'Karim S.',   trip:'Tokyo · 12 jours',    text:'Ma voiture a été garée comme si c\'était la leur. Aucune rayure, intérieur nickel grâce à l\'option premium. Recommandé à toute ma famille.' },
  { name:'Élodie V.',  trip:'Barcelone · 3 jours', text:'Honnêtement, je ne savais pas que ça existait. Maintenant je ne peux plus m\'en passer. Zéro stress avant un vol, ça n\'a pas de prix.' },
];
function starsHTML() {
  return Array(5).fill(0).map(() =>
    '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
  ).join('');
}
function googleMarkSVG() {
  return '<svg class="review-google-mark" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">'
    + '<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>'
    + '<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>'
    + '<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>'
    + '<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>'
    + '</svg>';
}
function reviewCardHTML(r) {
  const initials = r.name.split(' ').map(s => s[0]).join('').toUpperCase();
  return `<article class="review-card">
    <div class="review-stars">${starsHTML()}</div>
    <p class="review-text">« ${escapeHtml(r.text)} »</p>
    <div class="review-author">
      <div class="review-avatar">${escapeHtml(initials)}</div>
      <div class="review-meta">
        <div class="review-name">${escapeHtml(r.name)}</div>
        <div class="review-trip">${escapeHtml(r.trip)}</div>
      </div>
      ${googleMarkSVG()}
    </div>
  </article>`;
}
(function() {
  const target = document.getElementById('reviewsTrack');
  if (target) {
    const html = REVIEWS.map(reviewCardHTML).join('');
    target.innerHTML = html + html;
  }
})();

/* ════════════════════════════════════════════════
   SIMULATEUR HOME (card)
═══════════════════════════════════════════════ */
function simInit() {
  const today = new Date();
  const tom = new Date(today); tom.setDate(tom.getDate() + 1);
  const wk = new Date(today); wk.setDate(wk.getDate() + 8);
  const iso = d => d.toISOString().split('T')[0];

  const dep = document.getElementById('sim-dep-date');
  const ret = document.getElementById('sim-ret-date');
  if (dep) { dep.min = iso(today); dep.value = iso(tom); }
  if (ret) { ret.min = iso(today); ret.value = iso(wk); }

  STATE.sim.depDate = iso(tom);
  STATE.sim.retDate = iso(wk);
}

function simGoToStep(n) {
  STATE.sim.step = n;
  document.querySelectorAll('.bk-step').forEach(s => s.classList.remove('active'));
  document.querySelector(`.bk-step[data-step="${n}"]`).classList.add('active');
}

function simNext() {
  const dep = document.getElementById('sim-dep-date').value;
  const depT = document.getElementById('sim-dep-time').value;
  const ret = document.getElementById('sim-ret-date').value;
  const retT = document.getElementById('sim-ret-time').value;

  if (!dep || !ret || new Date(ret) < new Date(dep)) {
    alert('Vérifiez vos dates : la date de retour doit être après la date de départ.');
    return;
  }

  STATE.sim.depDate = dep;
  STATE.sim.depTime = depT;
  STATE.sim.retDate = ret;
  STATE.sim.retTime = retT;
  simGoToStep(2);
}

async function simSelectCategory(code, btn) {
  document.querySelectorAll('.bk-cat').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  STATE.sim.categoryCode = code;

  // Calculer le tarif
  document.getElementById('sim-result-amount').innerHTML = '<span class="spinner" style="border-top-color:var(--blue-deep)"></span>';
  simGoToStep(3);

  const res = await fetchPrice({
    depDate: STATE.sim.depDate,
    depTime: STATE.sim.depTime,
    retDate: STATE.sim.retDate,
    retTime: STATE.sim.retTime,
    carCategoryCode: code,
  });

  if (!res) {
    document.getElementById('sim-result-amount').innerHTML = '<span style="font-size:1rem; color:var(--slate)">Erreur de calcul</span>';
    return;
  }
  if (res.dateBlocked) {
    document.getElementById('sim-result-amount').innerHTML = '<span style="font-size:1.1rem; color:var(--error)">Dates non disponibles</span>';
    document.getElementById('sim-result-meta').textContent = 'Choisissez d\'autres dates';
    return;
  }

  STATE.sim.quotedPrice = res.total;
  document.getElementById('sim-result-amount').innerHTML = `${res.total}<span class="cur">€</span>`;
  document.getElementById('sim-result-meta').textContent = `${res.days} jour${res.days > 1 ? 's' : ''} · ${categoryLabel(code)}`;
}

function simBack() { simGoToStep(STATE.sim.step - 1); }

function simBookNow() {
  // Pré-remplit le tunnel avec ce qu'on a déjà
  STATE.booking.data.departure.date = STATE.sim.depDate;
  STATE.booking.data.departure.time = STATE.sim.depTime;
  STATE.booking.data.return.date = STATE.sim.retDate;
  STATE.booking.data.return.time = STATE.sim.retTime;
  STATE.booking.data.car.categoryCode = STATE.sim.categoryCode;
  openBookingModal(true);
}

function categoryLabel(code) {
  return ({citadine:'Citadine', berline:'Berline / Break', suv:'SUV / 4×4 / Monospace', utilitaire:'Van / Utilitaire'})[code] || code;
}

/* ════════════════════════════════════════════════
   INFOBULLES « exemples de véhicules » (cartes catégorie)
═══════════════════════════════════════════════ */
const CAT_EXAMPLES = {
  citadine: 'Petite voiture urbaine. Ex. : Renault Clio, Peugeot 208, Citroën C3, Fiat 500, Toyota Yaris, VW Polo.',
  berline: 'Voiture standard ou familiale. Ex. : Peugeot 308 et 508, Renault Mégane, VW Golf et Passat, Audi A4, BMW Série 3, Tesla Model 3.',
  suv: 'Grand véhicule familial. Ex. : Peugeot 3008 et 5008, Renault Captur et Scenic, Dacia Duster, Nissan Qashqai, VW Tiguan, Tesla Model Y, BMW X3.',
  utilitaire: 'Van, fourgon ou pickup. Ex. : Renault Trafic et Master, Citroën Jumpy et Jumper, Peugeot Expert et Boxer, Ford Transit, Mercedes Vito et Sprinter, VW Transporter.'
};

let catTooltipEl = null;
let catTooltipBtn = null;

function ensureCatTooltip() {
  if (catTooltipEl) return catTooltipEl;
  catTooltipEl = document.createElement('div');
  catTooltipEl.className = 'cat-tooltip';
  catTooltipEl.setAttribute('role', 'tooltip');
  catTooltipEl.id = 'catTooltip';
  document.body.appendChild(catTooltipEl);
  return catTooltipEl;
}

function positionCatTooltip(btn, tip) {
  const r = btn.getBoundingClientRect();
  const tw = tip.offsetWidth, th = tip.offsetHeight;
  let left = r.left + r.width / 2 - tw / 2;
  left = Math.max(8, Math.min(left, window.innerWidth - tw - 8));
  let top = r.bottom + 8;
  if (top + th > window.innerHeight - 8) top = r.top - th - 8;
  if (top < 8) top = 8;
  tip.style.left = left + 'px';
  tip.style.top = top + 'px';
}

function openCatInfo(btn) {
  const tip = ensureCatTooltip();
  tip.textContent = CAT_EXAMPLES[btn.dataset.cat] || '';
  tip.classList.add('open');
  btn.setAttribute('aria-expanded', 'true');
  catTooltipBtn = btn;
  positionCatTooltip(btn, tip);
}

function closeCatInfo() {
  if (!catTooltipEl || !catTooltipBtn) return;
  catTooltipEl.classList.remove('open');
  catTooltipBtn.setAttribute('aria-expanded', 'false');
  catTooltipBtn = null;
}

function toggleCatInfo(evt, btn) {
  evt.stopPropagation();
  evt.preventDefault();
  if (catTooltipBtn === btn) closeCatInfo();
  else openCatInfo(btn);
}

document.addEventListener('click', (e) => {
  if (catTooltipBtn && !e.target.closest('.bk-cat-info')) closeCatInfo();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && catTooltipBtn) closeCatInfo();
});
window.addEventListener('scroll', () => { if (catTooltipBtn) positionCatTooltip(catTooltipBtn, catTooltipEl); }, true);
window.addEventListener('resize', () => { if (catTooltipBtn) positionCatTooltip(catTooltipBtn, catTooltipEl); });

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.bk-cat-info').forEach((btn) => {
    btn.addEventListener('mouseenter', () => openCatInfo(btn));
    btn.addEventListener('mouseleave', () => { if (catTooltipBtn === btn) closeCatInfo(); });
  });
});

/* ════════════════════════════════════════════════
   TUNNEL DE RÉSERVATION (3 étapes)
═══════════════════════════════════════════════ */
function openBookingModal(prefilled = false) {
  document.getElementById('bookingModal').classList.add('open');
  document.body.classList.add('modal-open');
  bkGoToStep(1);
  if (prefilled) {
    // Repopule les champs visibles depuis le state
    setTimeout(() => {
      const dep = document.getElementById('bk-dep-date');
      const depT = document.getElementById('bk-dep-time');
      const ret = document.getElementById('bk-ret-date');
      const retT = document.getElementById('bk-ret-time');
      if (dep) dep.value = STATE.booking.data.departure.date;
      if (depT) depT.value = STATE.booking.data.departure.time;
      if (ret) ret.value = STATE.booking.data.return.date;
      if (retT) retT.value = STATE.booking.data.return.time;
      // Catégorie sélectionnée
      document.querySelectorAll('.bk-form-cat').forEach(c => {
        c.classList.toggle('selected', c.dataset.cat === STATE.booking.data.car.categoryCode);
      });
      bkUpdatePriceLive();
    }, 50);
  }
}

function closeBookingModal() {
  document.getElementById('bookingModal').classList.remove('open');
  document.body.classList.remove('modal-open');
}

document.getElementById('bookingModal').addEventListener('click', e => {
  if (e.target.id === 'bookingModal') closeBookingModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeBookingModal();
});

function bkGoToStep(n) {
  STATE.booking.step = n;
  document.querySelectorAll('.modal-step').forEach(el => el.classList.remove('active'));
  const stepEl = document.querySelector(`.modal-step[data-step="${n}"]`);
  if (stepEl) stepEl.classList.add('active');
  const steps = document.querySelectorAll('.modal-progress-step');
  steps.forEach((s, i) => {
    s.classList.remove('active', 'done');
    if (i < n - 1) s.classList.add('done');
    else if (i === n - 1) s.classList.add('active');
  });
  if (n === 3) bkRenderRecap();
  document.querySelector('.modal').scrollTop = 0;
}

function clearErrors() {
  document.querySelectorAll('.form-group.has-error').forEach(g => g.classList.remove('has-error'));
}
function markError(id) {
  const inp = document.getElementById(id);
  if (inp) inp.closest('.form-group').classList.add('has-error');
}

/* Étape 1 : Voyage + véhicule */
async function bkValidateStep1() {
  clearErrors();
  let ok = true;
  const requiredFields = ['bk-dep-date','bk-ret-date','bk-brand','bk-model','bk-plate'];
  requiredFields.forEach(id => {
    const v = document.getElementById(id).value.trim();
    if (!v) { markError(id); ok = false; }
  });
  const dep = document.getElementById('bk-dep-date').value;
  const ret = document.getElementById('bk-ret-date').value;
  if (dep && ret && new Date(ret) < new Date(dep)) {
    markError('bk-ret-date'); ok = false;
  }
  if (!ok) return false;

  // Sauvegarde
  STATE.booking.data.departure.date = dep;
  STATE.booking.data.departure.time = document.getElementById('bk-dep-time').value;
  STATE.booking.data.departure.terminal = document.getElementById('bk-dep-terminal').value;
  STATE.booking.data.return.date = ret;
  STATE.booking.data.return.time = document.getElementById('bk-ret-time').value;
  STATE.booking.data.return.terminal = document.getElementById('bk-ret-terminal').value;
  STATE.booking.data.car.brand = document.getElementById('bk-brand').value.trim();
  STATE.booking.data.car.model = document.getElementById('bk-model').value.trim();
  STATE.booking.data.car.color = document.getElementById('bk-color').value.trim();
  STATE.booking.data.car.plate = document.getElementById('bk-plate').value.trim().toUpperCase();
  return true;
}

async function bkNext1() {
  if (!await bkValidateStep1()) return;
  bkGoToStep(2);
  bkUpdatePriceLive();
}

/* Étape 2 : Coordonnées + options */
function bkValidateStep2() {
  clearErrors();
  let ok = true;
  ['bk-firstname','bk-lastname','bk-phone'].forEach(id => {
    if (!document.getElementById(id).value.trim()) { markError(id); ok = false; }
  });
  const email = document.getElementById('bk-email').value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { markError('bk-email'); ok = false; }
  if (!ok) return false;

  STATE.booking.data.customer.firstname = document.getElementById('bk-firstname').value.trim();
  STATE.booking.data.customer.lastname = document.getElementById('bk-lastname').value.trim();
  STATE.booking.data.customer.email = email;
  STATE.booking.data.customer.phone = document.getElementById('bk-phone').value.trim();
  STATE.booking.data.customer.flight = document.getElementById('bk-flight').value.trim();
  return true;
}

async function bkNext2() {
  if (!bkValidateStep2()) return;
  bkGoToStep(3);
}

function bkPrev() { bkGoToStep(STATE.booking.step - 1); }

/* Catégorie véhicule (étape 1 du tunnel) */
function bkSelectCategory(code, btn) {
  document.querySelectorAll('.bk-form-cat').forEach(b => b.classList.remove('selected'));
  btn.classList.add('selected');
  STATE.booking.data.car.categoryCode = code;
  bkUpdatePriceLive();
}

/* Wash options (étape 2) */
document.addEventListener('click', e => {
  const wash = e.target.closest('.wash-option');
  if (wash) {
    document.querySelectorAll('.wash-option').forEach(o => o.classList.remove('selected'));
    wash.classList.add('selected');
    wash.querySelector('input[type="radio"]').checked = true;
    STATE.booking.data.wash.type = wash.dataset.wash;
    STATE.booking.data.wash.price = parseInt(wash.dataset.price, 10) || 0;
    bkUpdatePriceLive();
  }
  const toggle = e.target.closest('.toggle-option');
  if (toggle) {
    const cb = toggle.querySelector('input[type="checkbox"]');
    cb.checked = !cb.checked;
    toggle.classList.toggle('selected', cb.checked);
    if (toggle.dataset.option === 'covered') {
      STATE.booking.data.options.coveredParking = cb.checked;
    } else if (toggle.dataset.option === 'priority') {
      STATE.booking.data.options.priorityAccess = cb.checked;
    }
    bkUpdatePriceLive();
  }
  const pay = e.target.closest('.payment-option');
  if (pay) {
    document.querySelectorAll('.payment-option').forEach(o => o.classList.remove('selected'));
    pay.classList.add('selected');
    pay.querySelector('input[type="radio"]').checked = true;
    STATE.booking.payment = pay.dataset.payment;
  }
});

/* Calcul de prix live (mise à jour bouton continue) */
async function bkUpdatePriceLive() {
  const data = STATE.booking.data;
  if (!data.departure.date || !data.return.date) return;

  const res = await fetchPrice({
    depDate: data.departure.date,
    depTime: data.departure.time,
    retDate: data.return.date,
    retTime: data.return.time,
    carCategoryCode: data.car.categoryCode,
    washType: data.wash.type,
    hasCoveredParking: data.options.coveredParking,
    hasPriorityAccess: data.options.priorityAccess,
    promoCode: data.promoCode,
    customerEmail: data.customer?.email || null,
  });
  if (!res || res.dateBlocked) return;
  STATE.booking.serverPrice = res;

  // Met à jour les boutons "Continuer · XX€" sur tous les écrans
  document.querySelectorAll('.bk-continue-amount').forEach(el => {
    el.textContent = ` · ${res.total}€`;
  });
}

/* Étape 3 : récap */
async function bkRenderRecap() {
  const data = STATE.booking.data;

  // Recalcule pour avoir le détail à jour
  const res = await fetchPrice({
    depDate: data.departure.date, depTime: data.departure.time,
    retDate: data.return.date, retTime: data.return.time,
    carCategoryCode: data.car.categoryCode,
    washType: data.wash.type,
    hasCoveredParking: data.options.coveredParking,
    hasPriorityAccess: data.options.priorityAccess,
    promoCode: data.promoCode,
    customerEmail: data.customer?.email || null,
  });

  if (!res) {
    document.getElementById('bk-recap').innerHTML = '<p style="color:var(--error)">Erreur de calcul</p>';
    return;
  }
  STATE.booking.serverPrice = res;

  let detailHtml = '<div class="recap-row"><span class="recap-label">Voyage</span><span class="recap-value">' +
    fmtDateShort(data.departure.date) + ' ' + data.departure.time +
    ' → ' + fmtDateShort(data.return.date) + ' ' + data.return.time +
    '</span></div>';

  detailHtml += '<div class="recap-row"><span class="recap-label">Véhicule</span><span class="recap-value">' +
    escapeHtml(data.car.brand) + ' ' + escapeHtml(data.car.model) +
    (data.car.color ? ' · ' + escapeHtml(data.car.color) : '') +
    '<br>' + escapeHtml(data.car.plate) + '</span></div>';

  // Détail des frais
  for (const d of (res.surchargesDetail || [])) {
    const cls = d.amount < 0 ? 'recap-value success' : 'recap-value';
    const sign = d.amount < 0 ? '−' : '';
    detailHtml += `<div class="recap-row">
      <span class="recap-label">${escapeHtml(d.label)}</span>
      <span class="${cls}">${sign}${Math.abs(d.amount)}€</span>
    </div>`;
  }

  detailHtml += `<div class="recap-total">
    <span class="lbl">Total</span>
    <span class="val">${res.total}€</span>
  </div>`;

  document.getElementById('bk-recap').innerHTML = detailHtml;
}

/* Code promo */
async function bkApplyPromo() {
  const code = document.getElementById('bk-promo').value.trim().toUpperCase();
  const msg = document.getElementById('bk-promo-msg');
  if (!code) {
    STATE.booking.data.promoCode = null;
    STATE.booking.data.promoDiscount = 0;
    msg.style.display = 'none';
    bkRenderRecap();
    return;
  }
  msg.style.display = 'block';
  msg.style.color = 'var(--slate)';
  msg.textContent = '⏳ Vérification…';
  STATE.booking.data.promoCode = code;
  await bkRenderRecap();
  const sp = STATE.booking.serverPrice;
  if (sp && sp.promoCode) {
    STATE.booking.data.promoDiscount = sp.promoDiscount;
    msg.style.color = 'var(--success)';
    msg.textContent = `✓ Code « ${sp.promoCode} » appliqué — économie de ${sp.promoDiscount}€`;
  } else {
    STATE.booking.data.promoCode = null;
    msg.style.color = 'var(--error)';
    msg.textContent = (sp && sp.promoRejectedReason === 'first_booking_only')
      ? '✕ Ce code est réservé à une première réservation.'
      : '✕ Code invalide ou expiré';
  }
}

/* Confirmation finale */
async function bkConfirm() {
  const btn = document.getElementById('bk-confirm-btn');
  const btnText = document.getElementById('bk-confirm-text');
  const original = btnText.innerHTML;
  btn.disabled = true;
  btnText.innerHTML = '<span class="spinner"></span> Traitement…';

  const ref = 'VO-' + Date.now().toString(36).toUpperCase().slice(-6);
  const payload = {
    reference: ref,
    data: {
      ...STATE.booking.data,
      promoCode: STATE.booking.data.promoCode,
    },
  };

  try {
    if (STATE.booking.payment === 'stripe') {
      const res = await fetch('/api/checkout', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur paiement');
      if (json.url) { window.location.href = json.url; return; }
    } else {
      const res = await fetch('/api/booking', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Erreur');
    }
    document.getElementById('bk-confirm-name').textContent = STATE.booking.data.customer.firstname + ' !';
    document.getElementById('bk-confirm-ref').textContent = 'RÉF — ' + ref;
    bkGoToStep(4);
  } catch (err) {
    alert('Erreur : ' + err.message + '\nContactez-nous : contact@directvoiturier.com');
    btn.disabled = false;
    btnText.innerHTML = original;
  }
}

/* CGV modal */
function openCGV() {
  document.getElementById('cgvModal').classList.add('open');
  document.body.classList.add('modal-open');
}
function closeCGV() {
  document.getElementById('cgvModal').classList.remove('open');
  document.body.classList.remove('modal-open');
}

/* Moyens de paiement réellement disponibles sur ce déploiement.
   Tant que Stripe n'est pas configuré (clé + webhook), on retire le paiement
   par carte au lieu d'afficher un bouton qui échouerait, et on bascule le
   tunnel sur « Sur place ». Aucune promesse affichée qui ne soit tenable. */
async function applyPaymentConfig() {
  let cfg;
  try {
    const res = await fetch('/api/config');
    if (!res.ok) return;
    cfg = await res.json();
  } catch { return; }
  initPromoBanner(cfg);
  if (cfg.paiementEnLigne !== false) return;

  const stripeOpt = document.getElementById('payment-option-stripe');
  const onsiteOpt = document.getElementById('payment-option-onsite');
  if (stripeOpt) {
    stripeOpt.hidden = true;
    stripeOpt.classList.remove('selected');
    const radio = stripeOpt.querySelector('input[type="radio"]');
    if (radio) { radio.checked = false; radio.disabled = true; }
  }
  if (onsiteOpt) {
    onsiteOpt.classList.add('selected');
    const radio = onsiteOpt.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
  }
  STATE.booking.payment = 'onsite';

  const faq = document.getElementById('faq-payment');
  if (faq) {
    faq.textContent = 'Sur place, le jour du départ, en espèces ou par carte bancaire. ' +
      'Rien à régler au moment de la réservation.';
  }
}

/* ════════════════════════════════════════════════
   BANDEAU CODE PROMO
   — diffusé par /api/config (clé « promo »), absente si rien à diffuser
   — masqué définitivement pour ce code une fois fermé (mémorisé par code)
═══════════════════════════════════════════════ */
function initPromoBanner(cfg) {
  const promo = cfg && cfg.promo;
  const banner = document.getElementById('promoBanner');
  if (!promo || !promo.code || !banner) return;

  let dismissed = false;
  try { dismissed = localStorage.getItem('dv_promo_dismissed_' + promo.code) === '1'; } catch {}
  if (dismissed) return;

  const cible = promo.first_booking_only ? 'votre première réservation' : 'votre réservation';
  // Number() : une valeur numérique Postgres peut revenir en « 10.00 », qu'on
  // n'affiche pas tel quel dans une accroche commerciale.
  const valeur = Number(promo.discount_val);
  const remise = promo.discount_type === 'fixed' ? `${valeur}€` : `${valeur}%`;

  const text = document.getElementById('promoBannerText');
  if (text) {
    text.textContent = '';
    text.append('Code ');
    const strong = document.createElement('strong');
    strong.textContent = promo.code;
    text.append(strong, ` : -${remise} sur ${cible}`);
  }

  STATE.promo = promo;
  banner.hidden = false;
}

function promoBannerUse() {
  const promo = STATE.promo;
  if (!promo) return;

  // On pré-remplit le champ ET l'état : le code est ainsi pris en compte dès
  // le premier calcul de tarif, sans que le client ait à cliquer « Appliquer ».
  const champ = document.getElementById('bk-promo');
  if (champ) champ.value = promo.code;
  STATE.booking.data.promoCode = promo.code;

  // On masque le bandeau sans mémoriser de refus : le client n'a rien refusé,
  // et il doit le retrouver s'il revient sans avoir réservé.
  const banner = document.getElementById('promoBanner');
  if (banner) banner.hidden = true;

  // Volontairement pas de bkApplyPromo() ici : sans dates saisies, le calcul
  // échouerait et afficherait « code invalide » à tort. Le code est vérifié
  // par le serveur au premier tarif calculé, puis au récapitulatif.
  openBookingModal();
}

function promoBannerDismiss() {
  const banner = document.getElementById('promoBanner');
  if (banner) banner.hidden = true;
  const promo = STATE.promo;
  if (promo) {
    try { localStorage.setItem('dv_promo_dismissed_' + promo.code, '1'); } catch {}
  }
}

/* Init */
document.addEventListener('DOMContentLoaded', () => {
  simInit();
  applyPaymentConfig();
  // Init dates du tunnel aussi (au cas où ouvert sans simulateur)
  const today = new Date();
  const tom = new Date(today); tom.setDate(tom.getDate()+1);
  const wk = new Date(today); wk.setDate(wk.getDate()+8);
  const iso = d => d.toISOString().split('T')[0];
  ['bk-dep-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.min = iso(today); el.value = iso(tom); }
  });
  ['bk-ret-date'].forEach(id => {
    const el = document.getElementById(id);
    if (el) { el.min = iso(today); el.value = iso(wk); }
  });
});

/* ════════════════════════════════════════════════
   ANALYTICS & CONSENTEMENT
   — Aucun envoi tant que VO_ANALYTICS n'est pas configuré (voir index.html)
   — Consent Mode v2 : denied par défaut, granted si le visiteur accepte
═══════════════════════════════════════════════ */
function trackEvent(name, params = {}) {
  try {
    if (typeof gtag !== 'function') return;
    gtag('event', name, params);
  } catch {}
}

function analyticsConfigured() {
  const A = window.VO_ANALYTICS || {};
  return !!(A.GA4_ID || A.ADS_ID);
}

function cookieChoice(accepted) {
  try { localStorage.setItem('vo_consent', accepted ? 'granted' : 'denied'); } catch {}
  applyConsent(accepted);
  const b = document.getElementById('cookieBanner');
  if (b) b.classList.remove('show');
}

function applyConsent(accepted) {
  if (typeof gtag !== 'function') return;
  const v = accepted ? 'granted' : 'denied';
  gtag('consent', 'update', {
    ad_storage: v, ad_user_data: v, ad_personalization: v, analytics_storage: v,
  });
}

(function initConsent() {
  if (!analyticsConfigured()) return; // pas de traceur → pas de bandeau
  let stored = null;
  try { stored = localStorage.getItem('vo_consent'); } catch {}
  if (stored === 'granted') applyConsent(true);
  else if (stored === 'denied') applyConsent(false);
  else {
    const b = document.getElementById('cookieBanner');
    if (b) b.classList.add('show');
  }
})();

/* Conversion "réservation payée" — envoyée au retour de Stripe (?paid=1) */
function trackPurchase(ref, value) {
  trackEvent('purchase', {
    transaction_id: ref || undefined,
    value: value || undefined,
    currency: 'EUR',
  });
  const A = window.VO_ANALYTICS || {};
  if (A.ADS_ID && A.ADS_CONVERSION_LABEL) {
    trackEvent('conversion', {
      send_to: A.ADS_ID + '/' + A.ADS_CONVERSION_LABEL,
      transaction_id: ref || undefined,
      value: value || undefined,
      currency: 'EUR',
    });
  }
}

/* ════════════════════════════════════════════════
   RETOUR STRIPE — /?paid=1&ref=XX ou /?canceled=1
   Avant : le client payait puis revenait sur la home sans AUCUNE confirmation.
═══════════════════════════════════════════════ */
(function handleStripeReturn() {
  const q = new URLSearchParams(window.location.search);
  const ref = q.get('ref') || '';
  if (q.get('paid') === '1') {
    // Écran de confirmation (étape 4 du tunnel)
    document.getElementById('bookingModal').classList.add('open');
    document.body.classList.add('modal-open');
    document.getElementById('bk-confirm-name').textContent = '';
    document.getElementById('bk-confirm-ref').textContent = ref ? 'RÉF — ' + ref : '';
    bkGoToStep(4);
    // Conversion : une seule fois par référence
    let already = null;
    try { already = sessionStorage.getItem('vo_paid_' + ref); } catch {}
    if (!already) {
      try { sessionStorage.setItem('vo_paid_' + ref, '1'); } catch {}
      trackPurchase(ref);
    }
    history.replaceState(null, '', window.location.pathname);
  } else if (q.get('canceled') === '1') {
    // Paiement abandonné : réouvrir le tunnel pour laisser une 2e chance
    trackEvent('checkout_abandoned', { reference: ref });
    openBookingModal();
    history.replaceState(null, '', window.location.pathname);
  }
})();

/* ════════════════════════════════════════════════
   ÉVÉNEMENTS DE CONVERSION (hooks non intrusifs)
═══════════════════════════════════════════════ */
(function wrapForTracking() {
  // Début de devis (simulateur)
  const _simNext = window.simNext;
  window.simNext = function() { trackEvent('quote_started'); return _simNext.apply(this, arguments); };

  // Tarif affiché
  const _simSelectCategory = window.simSelectCategory;
  window.simSelectCategory = async function(code, btn) {
    const r = await _simSelectCategory.apply(this, arguments);
    if (STATE.sim.quotedPrice > 0) {
      trackEvent('quote_shown', { value: STATE.sim.quotedPrice, currency: 'EUR', category: code });
    }
    return r;
  };

  // Début de réservation (ouverture du tunnel)
  const _openBookingModal = window.openBookingModal;
  window.openBookingModal = function(prefilled) {
    trackEvent('begin_checkout', { prefilled: !!prefilled });
    return _openBookingModal.apply(this, arguments);
  };

  // Coordonnées complétées (étape 2 → 3)
  const _bkNext2 = window.bkNext2;
  window.bkNext2 = async function() { 
    const before = STATE.booking.step;
    const r = await _bkNext2.apply(this, arguments);
    if (STATE.booking.step === 3 && before !== 3) trackEvent('add_contact_info');
    return r;
  };

  // Confirmation cliquée (paiement sur place = conversion directe ici ;
  // paiement Stripe = conversion au retour ?paid=1)
  const _bkConfirm = window.bkConfirm;
  window.bkConfirm = async function() {
    const total = STATE.booking.serverPrice ? STATE.booking.serverPrice.total : undefined;
    trackEvent('confirm_clicked', { payment: STATE.booking.payment, value: total, currency: 'EUR' });
    const r = await _bkConfirm.apply(this, arguments);
    if (STATE.booking.payment !== 'stripe' && STATE.booking.step === 4) {
      trackEvent('reservation_sur_place', { value: total, currency: 'EUR' });
    }
    return r;
  };
})();

/* Contact direct — active les boutons tél/WhatsApp dès que VO_CONTACT est rempli */
(function(){
  const C = window.VO_CONTACT || {};
  const phoneRaw = (C.PHONE || '').trim();
  if (phoneRaw) {
    const tel = phoneRaw.replace(/[^+0-9]/g, '');
    const nav = document.getElementById('navPhone');
    if (nav) {
      nav.href = 'tel:' + tel;
      nav.querySelector('span').textContent = phoneRaw;
      nav.hidden = false;
    }
    // Remplace le numéro du schema.org par le vrai
    const ld = document.querySelector('script[type="application/ld+json"]');
    if (ld) {
      try {
        const data = JSON.parse(ld.textContent);
        data.telephone = tel;
        ld.textContent = JSON.stringify(data);
      } catch (e) {}
    }
  }
  const gp = (C.GOOGLE_PROFILE || '').trim();
  if (gp) {
    const l = document.getElementById('gsLink');
    if (l) { l.href = gp; l.hidden = false; }
  }
  const wa = (C.WHATSAPP || '').replace(/[^0-9]/g, '');
  if (wa) {
    const f = document.getElementById('waFloat');
    if (f) {
      f.href = 'https://wa.me/' + wa + '?text='
        + encodeURIComponent('Bonjour, je souhaite réserver un voiturier à Orly.');
      f.hidden = false;
    }
  }
})();

/* Clics tel: / WhatsApp / mailto (délégation — couvre les liens futurs) */
document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a) return;
  const h = a.getAttribute('href') || '';
  if (h.startsWith('tel:')) trackEvent('phone_click', { number: h.slice(4) });
  else if (h.includes('wa.me') || h.includes('whatsapp')) trackEvent('whatsapp_click');
  else if (h.startsWith('mailto:')) trackEvent('email_click');
});

/* ════════════════════════════════════════════════
   CTA MOBILE COLLANT — apparaît une fois le hero dépassé
═══════════════════════════════════════════════ */
(function stickyCtaInit() {
  const bar = document.getElementById('stickyCta');
  const hero = document.querySelector('.hero, .page-hero');
  if (!bar || !hero) return;
  const io2 = new IntersectionObserver(entries => {
    entries.forEach(en => {
      const show = !en.isIntersecting;
      bar.classList.toggle('show', show);
      bar.setAttribute('aria-hidden', show ? 'false' : 'true');
    });
  }, { threshold: 0.05 });
  io2.observe(hero);
})();
