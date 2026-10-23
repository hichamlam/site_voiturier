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
/* Tarif INSTANTANÉ : le calcul tourne dans le navigateur avec le même moteur
   que le serveur (/pricing-engine.js) et la grille publique (/api/pricing-data,
   servie par le cache CDN). Plus aucun aller-retour réseau à chaque clic.
   Le serveur reste la référence : il recalcule tout au paiement, et le
   récapitulatif est revérifié en arrière-plan. Si le moteur ne se charge pas,
   on retombe automatiquement sur /api/pricing. */
let pricingEngine = null;
let pricingRef = null;
const pricingReady = Promise.all([
  import('/pricing-engine.js'),
  fetch('/api/pricing-data').then(r => r.ok ? r.json() : Promise.reject(new Error('pricing-data ' + r.status))),
]).then(([engine, ref]) => { pricingEngine = engine; pricingRef = ref; })
  .catch(e => console.warn('[tarif] calcul local indisponible, repli serveur', e));

// Verdict du serveur par code promo (+ e-mail, pour les codes « 1re réservation ») :
// une fois connu, la remise se recalcule localement elle aussi.
const promoVerdicts = new Map();
const promoKey = p => String(p.promoCode).trim().toUpperCase() + '|' + String(p.customerEmail || '').trim().toLowerCase();

function computePriceLocal(payload) {
  if (!pricingEngine || !pricingRef) return null;
  let promo = null;
  if (payload.promoCode) {
    promo = promoVerdicts.get(promoKey(payload));
    if (!promo) return null; // code jamais vérifié : le serveur doit trancher
  }
  const blocks = pricingEngine.findBlocks(payload.depDate, payload.retDate, pricingRef.blockedDates);
  if (blocks.length) return { dateBlocked: true, blocks, message: 'Ces dates ne sont pas disponibles' };
  const input = { ...payload, depTime: payload.depTime || '08:00', retTime: payload.retTime || '20:00' };
  return { ...pricingEngine.computePrice(input, pricingRef, promo), dateBlocked: false, source: 'local' };
}

// ── Repli / vérification serveur ──
const priceCache = new Map();
let priceWaiters = [];
let priceDebounceTimer = null;
let priceAbortController = null;

async function priceRunBatch() {
  priceDebounceTimer = null;
  if (priceWaiters.length === 0) return;

  // Seul le dernier appel compte : c'est lui qui reflète l'état actuel de l'UI.
  const { payload, key } = priceWaiters[priceWaiters.length - 1];

  // Annule la requête précédente encore en vol (une réponse lente ne doit pas
  // écraser une réponse plus récente).
  if (priceAbortController) priceAbortController.abort();
  const controller = new AbortController();
  priceAbortController = controller;

  // Résout tous les appels en attente (sinon un `await` supplanté resterait
  // bloqué et l'écran garderait son spinner).
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
    if (payload.promoCode && !data.dateBlocked && 'promoRule' in data) {
      promoVerdicts.set(promoKey(payload), { rule: data.promoRule, rejectedReason: data.promoRejectedReason });
    }
    priceCache.set(key, data);
    flush(data);
  } catch (e) {
    if (e.name === 'AbortError') return; // le lot suivant résoudra les appels en attente
    flush(null);
  }
}

function fetchPriceServer(payload, { fresh = false } = {}) {
  const key = JSON.stringify(payload);
  if (!fresh && priceCache.has(key)) return Promise.resolve(priceCache.get(key));
  return new Promise(resolve => {
    priceWaiters.push({ payload, key, resolve });
    if (priceDebounceTimer) clearTimeout(priceDebounceTimer);
    priceDebounceTimer = setTimeout(priceRunBatch, 60);
  });
}

async function fetchPrice(payload) {
  let local = computePriceLocal(payload);
  if (local) return local;
  if (!pricingEngine) {
    // Premier calcul avant la fin du chargement du moteur (quelques ms) : on l'attend.
    await pricingReady;
    local = computePriceLocal(payload);
    if (local) return local;
  }
  return fetchPriceServer(payload);
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

/* AVIS : les vrais avis Google sont écrits dans content/reviews.mjs et rendus
   directement dans le HTML (lisibles par Google et les IA) par « npm run seo ».
   Ici on se contente de dupliquer la liste pour le défilement continu. */
const REVIEWS = [];
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
  if (!target || !target.children.length) return;
  Array.from(target.children).forEach(c => {
    const clone = c.cloneNode(true);
    clone.setAttribute('aria-hidden', 'true');
    target.appendChild(clone);
  });
})();
/* Bouton « Calculer mon prix » du comparatif : remonte au calculateur et ouvre la date */
document.addEventListener('click', e => {
  const a = e.target.closest('[data-focus-calc]');
  if (!a) return;
  const d = document.getElementById('sim-dep-date');
  if (d) setTimeout(() => { try { d.focus({ preventScroll:true }); } catch (_) {} }, 600);
});

/* ════════════════════════════════════════════════
   SIMULATEUR HOME (card)
═══════════════════════════════════════════════ */
function simInit() {
  // Aucune date pré-remplie : le prix n'apparaît que quand le client choisit ses dates
  const iso = d => d.toISOString().split('T')[0];
  const min = iso(new Date());
  const dep = document.getElementById('sim-dep-date');
  const ret = document.getElementById('sim-ret-date');
  if (dep) { dep.min = min; dep.value = ''; }
  if (ret) { ret.min = min; ret.value = ''; }
  STATE.sim.depDate = '';
  STATE.sim.retDate = '';
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
  document.getElementById('sim-result-meta').textContent = `${res.days} jour${res.days > 1 ? 's' : ''}`;
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
  return ({citadine:'Citadine', berline:'Berline / Break', suv:'SUV / Familial / Monospace', utilitaire:'Van / Utilitaire'})[code] || code;
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
  bkShowDates(!prefilled);
}

function bkFmtDate(iso, t) {
  if (!iso) return '';
  const d = new Date(iso + 'T12:00:00');
  const s = d.toLocaleDateString('fr-FR', { weekday:'short', day:'numeric', month:'short' });
  return s + (t ? ' à ' + t.replace(':', 'h') : '');
}
function bkShowDates(editing) {
  const f = document.getElementById('bk-dates-fields'), r = document.getElementById('bk-dates-recap');
  if (!f || !r) return;
  const D = STATE.booking.data;
  const ok = !editing && D.departure.date && D.return.date;
  f.hidden = !!ok; r.hidden = !ok;
  if (ok) {
    document.getElementById('bk-recap-text').textContent =
      bkFmtDate(D.departure.date, D.departure.time) + '  →  ' + bkFmtDate(D.return.date, D.return.time);
    const q = STATE.sim && STATE.sim.quotedPrice;
    document.getElementById('bk-recap-price').textContent = q ? 'Total ' + q + ' €' : '';
  }
}
function bkEditDates() { bkShowDates(true); }

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

/* Étape 1 : dates + coordonnées */
async function bkValidateStep1() {
  clearErrors();
  let ok = true;
  ['bk-dep-date','bk-ret-date','bk-firstname','bk-lastname','bk-phone'].forEach(id => {
    if (!document.getElementById(id).value.trim()) { markError(id); ok = false; }
  });
  const dep = document.getElementById('bk-dep-date').value;
  const ret = document.getElementById('bk-ret-date').value;
  if (dep && ret && new Date(ret) < new Date(dep)) { markError('bk-ret-date'); ok = false; }
  const email = document.getElementById('bk-email').value.trim();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { markError('bk-email'); ok = false; }
  if (!ok) return false;

  STATE.booking.data.departure.date = dep;
  STATE.booking.data.departure.time = document.getElementById('bk-dep-time').value;
  STATE.booking.data.return.date = ret;
  STATE.booking.data.return.time = document.getElementById('bk-ret-time').value;
  STATE.booking.data.customer.firstname = document.getElementById('bk-firstname').value.trim();
  STATE.booking.data.customer.lastname = document.getElementById('bk-lastname').value.trim();
  STATE.booking.data.customer.email = email;
  STATE.booking.data.customer.phone = document.getElementById('bk-phone').value.trim();
  STATE.booking.data.customer.flight = document.getElementById('bk-flight').value.trim().toUpperCase();
  return true;
}

async function bkNext1() {
  if (!await bkValidateStep1()) return;
  bkGoToStep(2);
  bkUpdatePriceLive();
}

/* Étape 2 : véhicule + options (prix unique, pas de catégorie) */
function bkValidateStep2() {
  clearErrors();
  let ok = true;
  ['bk-brand','bk-model','bk-plate'].forEach(id => {
    if (!document.getElementById(id).value.trim()) { markError(id); ok = false; }
  });
  if (!ok) return false;
  const term = document.getElementById('bk-dep-terminal').value;
  STATE.booking.data.departure.terminal = term;
  STATE.booking.data.return.terminal = term;
  STATE.booking.data.car.categoryCode = 'citadine';
  STATE.booking.data.car.brand = document.getElementById('bk-brand').value.trim();
  STATE.booking.data.car.model = document.getElementById('bk-model').value.trim();
  STATE.booking.data.car.color = document.getElementById('bk-color').value.trim();
  STATE.booking.data.car.plate = document.getElementById('bk-plate').value.trim().toUpperCase();
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

/* Payload de tarif du tunnel : construit à UN seul endroit */
function bkPricePayload() {
  const data = STATE.booking.data;
  return {
    depDate: data.departure.date, depTime: data.departure.time,
    retDate: data.return.date, retTime: data.return.time,
    carCategoryCode: data.car.categoryCode,
    washType: data.wash.type,
    hasCoveredParking: data.options.coveredParking,
    hasPriorityAccess: data.options.priorityAccess,
    promoCode: data.promoCode,
    customerEmail: data.customer?.email || null,
  };
}

/* Calcul de prix live (mise à jour bouton continue).
   `seq` : seule la DERNIÈRE demande a le droit d'écrire à l'écran. Avant, une
   réponse lente (ex. « avec lavage ») arrivait après le clic « sans lavage »
   et réaffichait l'ancien prix. */
let bkLiveSeq = 0;
async function bkUpdatePriceLive() {
  const data = STATE.booking.data;
  if (!data.departure.date || !data.return.date) return;
  const seq = ++bkLiveSeq;
  const res = await fetchPrice(bkPricePayload());
  if (seq !== bkLiveSeq) return; // un clic plus récent a pris le relais
  if (!res || res.dateBlocked) return;
  STATE.booking.serverPrice = res;

  // Met à jour les boutons "Continuer · XX€" sur tous les écrans
  document.querySelectorAll('.bk-continue-amount').forEach(el => {
    el.textContent = ` · ${res.total}€`;
  });
}

/* Étape 3 : récap — affiché instantanément (calcul local), puis revérifié en
   arrière-plan par le serveur, qui fait foi : en cas d'écart (tarif modifié
   à l'instant dans le back-office), le récap se met à jour tout seul. */
let bkRecapSeq = 0;
async function bkRenderRecap() {
  const seq = ++bkRecapSeq;
  const payload = bkPricePayload();
  const res = await fetchPrice(payload);
  if (seq !== bkRecapSeq) return;
  bkPaintRecap(res);
  if (res && res.source === 'local') {
    fetchPriceServer(payload).then(srv => {
      if (seq !== bkRecapSeq || !srv) return;
      if (srv.dateBlocked || srv.total !== res.total || srv.promoCode !== res.promoCode) bkPaintRecap(srv);
    });
  }
}

function bkPaintRecap(res) {
  const data = STATE.booking.data;
  if (!res || res.dateBlocked) {
    document.getElementById('bk-recap').innerHTML = res && res.dateBlocked
      ? '<p style="color:var(--error)">Ces dates ne sont plus disponibles</p>'
      : '<p style="color:var(--error)">Erreur de calcul</p>';
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
      // Lien vers l'espace client (récap complet + modifications)
      const manageBox = document.getElementById('bk-confirm-manage');
      if (manageBox && json.manageToken) {
        document.getElementById('bk-confirm-manage-link').href = '/reservation-confirmee?t=' + encodeURIComponent(json.manageToken);
        manageBox.hidden = false;
      }
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
  // Le numéro saisi dans le back-office (Paramètres) prime sur celui figé au build
  const ct = cfg.contact || {};
  if (ct.contact_phone || ct.contact_whatsapp) {
    applyContact({ PHONE: ct.contact_phone || '', WHATSAPP: ct.contact_whatsapp || '', GOOGLE_PROFILE: ct.google_business_url || '' });
  }
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
  const remise = promo.discount_type === 'fixed' ? `${valeur}\u00A0€` : `${valeur}\u00A0%`;

  const text = document.getElementById('promoBannerText');
  if (text) {
    text.textContent = '';
    // Deux blocs : l'offre, puis le code (2 lignes nettes sur mobile, 1 ligne sur ordinateur).
    const offre = document.createElement('span');
    offre.className = 'promo-banner-offer';
    offre.textContent = `-${remise} sur ${cible}`;
    const ligneCode = document.createElement('span');
    ligneCode.className = 'promo-banner-code';
    const strong = document.createElement('strong');
    strong.textContent = promo.code;
    // Bouton copier collé au code : icône presse-papier + « Copier ».
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'promo-banner-copy';
    copy.id = 'promoBannerCopy';
    copy.setAttribute('aria-label', 'Copier le code ' + promo.code);
    copy.addEventListener('click', promoBannerCopy);
    ligneCode.append('avec le code ', strong, ' ', copy);
    text.append(offre, ' ', ligneCode);
    promoCopyLabel(copy, false);
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

function promoCopyLabel(btn, copied) {
  btn.innerHTML = copied
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>Copié'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/></svg>Copier';
}

function promoBannerCopy() {
  const promo = STATE.promo;
  const btn = document.getElementById('promoBannerCopy');
  if (!promo || !btn) return;
  const done = () => {
    promoCopyLabel(btn, true);
    clearTimeout(btn._t);
    btn._t = setTimeout(() => promoCopyLabel(btn, false), 2500);
  };
  // Repli execCommand : navigator.clipboard est absent hors HTTPS et sur
  // certains navigateurs intégrés (Instagram, Facebook…).
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = promo.code;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch {}
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(promo.code).then(done, fallback);
  } else {
    fallback();
  }
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
/* trackEvent / consentement cookies : voir /tracking.js (chargé dans le <head>) */

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
      // GA4 : réservation payée en ligne avec succès (retour Stripe)
      if (window.DVAnalytics) window.DVAnalytics.trackEvent('demande_devis_validee', { mode_paiement: 'en_ligne', currency: 'EUR', transaction_id: ref || undefined });
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
function applyContact(C){
  C = C || {};
  let phoneRaw = (C.PHONE || '').trim();
  if (/^0\d{9}$/.test(phoneRaw.replace(/\s/g, ''))) phoneRaw = phoneRaw.replace(/\s/g, '').replace(/(\d{2})(?=\d)/g, '$1 ');
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
        if (!data['@graph']) { // le @graph de l'accueil contient déjà le numéro (npm run seo)
          data.telephone = tel;
          ld.textContent = JSON.stringify(data);
        }
      } catch (e) {}
    }
  }
  const gp = (C.GOOGLE_PROFILE || '').trim();
  if (gp) {
    const l = document.getElementById('gsLink');
    if (l) { l.href = gp; l.hidden = false; }
  }
  if (phoneRaw) {
    const tel = phoneRaw.replace(/[^+0-9]/g, '');
    document.querySelectorAll('[data-phone]').forEach(a => { a.href = 'tel:' + tel; a.hidden = false; });
    document.querySelectorAll('[data-phone-label]').forEach(s => { s.textContent = phoneRaw; });
  }
  const wa = (C.WHATSAPP || '').replace(/[^0-9]/g, '');
  if (wa) {
    document.querySelectorAll('[data-whatsapp]').forEach(a => {
      a.href = 'https://wa.me/' + wa + '?text=' + encodeURIComponent('Bonjour, j\'ai une question sur le voiturier à Orly.');
      a.hidden = false;
    });
    const f = document.getElementById('waFloat');
    if (f) {
      f.href = 'https://wa.me/' + wa + '?text='
        + encodeURIComponent('Bonjour, je souhaite réserver un voiturier à Orly.');
      f.hidden = false;
    }
  }
}
applyContact(window.VO_CONTACT);

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
  const hero = document.querySelector('.hero, .page-hero, .h-hero');
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

/* ════════════════════════════════════════════════
   HOME — calculateur en direct (tarif serveur /api/pricing),
   catégories, formules de lavage et comparateur avant/après
═══════════════════════════════════════════════ */
const HOME_WASH_LABEL = { none:'sans lavage', exterieur:'lavage extérieur', interieur:'lavage intérieur', complet:'lavage complet', premium:'lavage premium' };
let homeQuoteSeq = 0;
let homeTouched = false;
let homeLastTracked = '';

function homeReadInputs() {
  const v = id => (document.getElementById(id) || {}).value || '';
  STATE.sim.depDate = v('sim-dep-date');
  STATE.sim.depTime = v('sim-dep-time') || '08:00';
  STATE.sim.retDate = v('sim-ret-date');
  STATE.sim.retTime = v('sim-ret-time') || '20:00';
  const s = STATE.sim;
  return !!(s.depDate && s.retDate && new Date(s.retDate) >= new Date(s.depDate));
}

function homeSticky(total) {
  const p = document.getElementById('stickyPrice');
  const f = document.getElementById('stickyFrom');
  if (!p || !f) return;
  if (total) { p.textContent = total + '€'; f.textContent = 'Votre tarif'; }
  else { p.textContent = '29€'; f.textContent = 'Dès'; }
}

async function homeQuote(userAction = true) {
  const amount = document.getElementById('sim-result-amount');
  const meta = document.getElementById('sim-result-meta');
  if (!amount || !meta) return;
  if (userAction && !homeTouched) { homeTouched = true; trackEvent('quote_started'); }
  STATE.sim.quotedPrice = 0;
  const sum = document.getElementById('h-sum');
  const incl = document.getElementById('h-incl');
  if (incl) incl.hidden = true;
  const washLine = document.getElementById('h-sum-wash');
  const wash = STATE.booking.data.wash.type;
  if (washLine) washLine.textContent = (wash === 'none' ? 'Sans lavage' : HOME_WASH_LABEL[wash].replace(/^./, c => c.toUpperCase()) + ' inclus');

  if (!homeReadInputs()) {
    homeQuoteSeq++;
    amount.className = 'h-price muted';
    if (!STATE.sim.depDate || !STATE.sim.retDate) {
      // Aucune date choisie : on n'affiche aucun prix
      amount.textContent = '—';
      meta.textContent = 'Choisissez vos dates';
      if (sum) sum.hidden = true; // carte prix masquée tant qu'il n'y a pas de dates
    } else {
      if (sum) sum.hidden = false;
      amount.textContent = 'Vérifiez vos dates';
      meta.textContent = 'Le retour doit suivre le départ';
    }
    homeSticky(null);
    return;
  }
  const seq = ++homeQuoteSeq;
  if (sum) sum.hidden = false;
  amount.className = 'h-price';
  amount.innerHTML = '<span class="spinner"></span>';
  const s = STATE.sim;
  const payload = { depDate:s.depDate, depTime:s.depTime, retDate:s.retDate, retTime:s.retTime, carCategoryCode:s.categoryCode };
  if (wash !== 'none') payload.washType = wash;
  const res = await fetchPrice(payload);
  if (seq !== homeQuoteSeq) return; // une saisie plus récente a pris le relais

  if (!res) {
    amount.className = 'h-price muted';
    amount.textContent = 'Tarif indisponible';
    meta.textContent = 'Réessayez dans un instant';
    homeSticky(null);
    return;
  }
  if (res.dateBlocked) {
    amount.className = 'h-price muted';
    amount.textContent = 'Complet';
    meta.textContent = 'Dates non disponibles — choisissez d\'autres dates';
    homeSticky(null);
    return;
  }
  STATE.sim.quotedPrice = res.total;
  amount.className = 'h-price';
  amount.innerHTML = `${res.total}<span class="cur">€</span>`;
  meta.textContent = `${res.days} jour${res.days > 1 ? 's' : ''}`;
  if (incl) incl.hidden = false;
  homeSticky(res.total);
  const key = JSON.stringify(payload);
  if (homeTouched && key !== homeLastTracked) {
    homeLastTracked = key;
    trackEvent('quote_shown', { value: res.total, currency: 'EUR', category: s.categoryCode });
  }
}

function homeSelectCat(code) {
  STATE.sim.categoryCode = code;
  document.querySelectorAll('.h-cat').forEach(b => b.setAttribute('aria-pressed', b.dataset.cat === code ? 'true' : 'false'));
  homeQuote();
}

function homeSelectWash(key) {
  // Source unique des prix : les options du tunnel (data-price), identiques au serveur
  const opt = document.querySelector(`.wash-option[data-wash="${key}"]`);
  if (!opt) return;
  document.querySelectorAll('.wash-option').forEach(o => o.classList.toggle('selected', o === opt));
  const radio = opt.querySelector('input[type="radio"]');
  if (radio) radio.checked = true;
  STATE.booking.data.wash.type = key;
  STATE.booking.data.wash.price = parseInt(opt.dataset.price, 10) || 0;
  let label = '';
  document.querySelectorAll('.h-pill').forEach(b => {
    const on = b.dataset.homeWash === key;
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    if (on) label = b.querySelector('b').textContent;
  });
  const pill = document.querySelector(`.h-pill[data-home-wash="${key}"]`);
  const desc = document.getElementById('h-wash-desc');
  if (desc && pill) {
    desc.innerHTML = '';
    const b = document.createElement('b'); b.textContent = label;
    desc.append(b, '. ' + pill.dataset.desc);
  }
  homeQuote();
}

function homeBook() {
  if (!document.getElementById('sim-dep-date')) { openBookingModal(); return; }
  if (!homeReadInputs()) {
    const card = document.getElementById('bookingHeroCard');
    if (card) card.scrollIntoView({ behavior:'smooth', block:'center' });
    homeQuote();
    return;
  }
  simBookNow();
}

/* Comparateur avant / après (souris, doigt, clavier) */
(function homeWashSlider() {
  const stage = document.getElementById('washContainer');
  const dirty = document.getElementById('dirtyLayer');
  const handle = document.getElementById('washHandle');
  if (!stage || !dirty || !handle) return;
  const knob = handle.querySelector('button');
  let pct = 50, dragging = false;
  const set = p => {
    pct = Math.max(5, Math.min(95, p));
    dirty.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
    handle.style.left = pct + '%';
    if (knob) knob.setAttribute('aria-valuenow', Math.round(pct));
  };
  const fromX = x => { const r = stage.getBoundingClientRect(); set(((x - r.left) / r.width) * 100); };
  stage.addEventListener('pointerdown', e => {
    dragging = true; fromX(e.clientX);
    if (e.target.closest('#washHandle')) { try { stage.setPointerCapture(e.pointerId); } catch (_) {} }
  });
  stage.addEventListener('pointermove', e => { if (dragging) fromX(e.clientX); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(t => stage.addEventListener(t, () => { dragging = false; }));
  if (knob) knob.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { set(pct - 5); e.preventDefault(); }
    if (e.key === 'ArrowRight') { set(pct + 5); e.preventDefault(); }
  });
})();

document.addEventListener('DOMContentLoaded', () => {
  const d = document.getElementById('sim-dep-date'), r = document.getElementById('sim-ret-date');
  if (d && r) {
    // Pas de dates pré-remplies : le prix s'affiche seulement quand le client choisit ses dates
    const iso = x => x.toISOString().split('T')[0];
    d.min = iso(new Date()); r.min = iso(new Date());
  }
  if (document.getElementById('bookingHeroCard')) homeQuote(false);
});

(function(){ var t=document.getElementById('faqToggle'), x=document.getElementById('faqExtra'); if(!t||!x) return;
  t.addEventListener('click', function(){ var open=x.hidden; x.hidden=!open; t.setAttribute('aria-expanded', open); t.textContent= open ? 'Masquer les questions' : 'Voir les ' + (t.dataset.count || '') + ' questions'; });
})();

/* ════════════════════════════════════════════════
   GA4 — ENTONNOIR DE DEVIS / RÉSERVATION (voir /utils/analytics.js)
   Hooks non intrusifs : on enveloppe les fonctions existantes sans
   changer leur comportement.
   Étapes réelles du tunnel :
     0 tarif_affiche               (calculateur de l'accueil)
     1 dates_et_coordonnees        (tunnel, écran 1)
     2 vehicule_et_options         (tunnel, écran 2)
     3 recapitulatif_et_paiement   (tunnel, écran 3 : clic « Confirmer »)
═══════════════════════════════════════════════ */
(function ga4Funnel() {
  const T = (name, params) => { try { return window.DVAnalytics && window.DVAnalytics.trackEvent(name, params); } catch (e) {} };
  const ETAPES = { 0: 'tarif_affiche', 1: 'dates_et_coordonnees', 2: 'vehicule_et_options', 3: 'recapitulatif_et_paiement' };
  const CHAMPS = {
    'bk-dep-date': 'date_depart', 'bk-ret-date': 'date_retour', 'bk-firstname': 'prenom', 'bk-lastname': 'nom',
    'bk-phone': 'telephone', 'bk-email': 'email', 'bk-brand': 'marque', 'bk-model': 'modele', 'bk-plate': 'immatriculation',
  };
  const etape = (n, extra) => T('devis_etape', Object.assign({ etape: n, nom_etape: ETAPES[n] }, extra || {}));

  // devis_debut : une seule fois par page (premier champ touché ou ouverture du tunnel)
  let started = false;
  const debut = (source) => { if (started) return; started = true; T('devis_debut', { source }); };
  const card = document.getElementById('bookingHeroCard');
  if (card) {
    const onFirst = (e) => { if (e.target.closest('input, select, button, [role="button"]')) debut('calculateur_accueil'); };
    card.addEventListener('focusin', onFirst);
    card.addEventListener('pointerdown', onFirst);
  }
  const _open = window.openBookingModal;
  window.openBookingModal = function () { debut('tunnel_reservation'); return _open.apply(this, arguments); };

  // Erreurs de saisie : champs marqués en rouge par bkValidateStep1/2
  const erreurs = (n) => {
    const step = document.querySelector(`.modal-step[data-step="${n}"]`);
    if (!step) return;
    const ids = [...step.querySelectorAll('.form-group.has-error input, .form-group.has-error select')].map(i => CHAMPS[i.id] || i.id);
    if (!ids.length) return;
    T('devis_erreur', { champ_erreur: ids[0], champs_erreur: ids.join(','), nb_erreurs: ids.length, etape: n, nom_etape: ETAPES[n], formulaire: 'tunnel_reservation' });
  };

  // Étapes 1 et 2 du tunnel
  [['bkNext1', 1], ['bkNext2', 2]].forEach(([fn, n]) => {
    const orig = window[fn];
    window[fn] = async function () {
      const before = STATE.booking.step;
      const r = await orig.apply(this, arguments);
      if (before === n && STATE.booking.step === n + 1) etape(n);
      else if (STATE.booking.step === n) erreurs(n);
      return r;
    };
  });

  // Étape 3 (clic « Confirmer ») puis succès / échec de l'envoi
  const _confirm = window.bkConfirm;
  window.bkConfirm = async function () {
    const paiement = STATE.booking.payment === 'stripe' ? 'en_ligne' : 'sur_place';
    const total = STATE.booking.serverPrice ? STATE.booking.serverPrice.total : undefined;
    etape(3, { mode_paiement: paiement, value: total, currency: 'EUR' });
    const r = await _confirm.apply(this, arguments);
    const btn = document.getElementById('bk-confirm-btn');
    if (STATE.booking.step === 4 && paiement === 'sur_place') {
      const ref = (document.getElementById('bk-confirm-ref').textContent || '').replace(/^RÉF\s*—\s*/, '');
      T('demande_devis_validee', { mode_paiement: paiement, value: total, currency: 'EUR', transaction_id: ref || undefined });
    } else if (STATE.booking.step !== 4 && btn && !btn.disabled) {
      // L'envoi a échoué (bouton réactivé) — pour Stripe, le bouton reste désactivé pendant la redirection
      T('devis_erreur', { champ_erreur: 'envoi_serveur', etape: 3, nom_etape: ETAPES[3], formulaire: 'tunnel_reservation' });
    }
    return r;
  };

  // Calculateur de l'accueil : tarif affiché (une fois) et tentative de réserver avec des dates invalides
  let tarifVu = false;
  const _quote = window.homeQuote;
  window.homeQuote = async function (userAction = true) {
    const r = await _quote.apply(this, arguments);
    if (userAction !== false && !tarifVu && STATE.sim.quotedPrice > 0) {
      tarifVu = true;
      etape(0, { value: STATE.sim.quotedPrice, currency: 'EUR', formulaire: 'calculateur_accueil' });
    }
    return r;
  };
  const _book = window.homeBook;
  window.homeBook = function () {
    if (document.getElementById('sim-dep-date') && !homeReadInputs()) {
      const s = STATE.sim;
      const champ = !s.depDate ? 'date_depart' : (!s.retDate ? 'date_retour' : 'date_retour_avant_depart');
      T('devis_erreur', { champ_erreur: champ, etape: 0, nom_etape: ETAPES[0], formulaire: 'calculateur_accueil' });
    }
    return _book.apply(this, arguments);
  };
})();
