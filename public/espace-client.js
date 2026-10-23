/* ════════════════════════════════════════════════════════════════
   ESPACE CLIENT — /reservation-confirmee et /gerer-ma-reservation
   Aucune donnée n'est lue depuis l'URL seule : tout passe par
   /api/reservation (id de session Stripe ou jeton signé).
═══════════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  var PAGE = document.body.getAttribute('data-ec');
  var TOKEN_KEY = 'dv_manage_token';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var eur = function (n) { n = Math.round(Number(n || 0) * 100) / 100; return (n % 1 ? n.toFixed(2).replace('.', ',') : String(n)) + ' €'; };
  var ICO = {
    plane: '<path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    edit: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.8 19.8 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    car: '<path d="M5 17h14M6 17v2M18 17v2M3 13l2-6h14l2 6v4H3z"/><circle cx="7.5" cy="14" r=".8"/><circle cx="16.5" cy="14" r=".8"/>',
    euro: '<path d="M17 6.5A6 6 0 1 0 17 17.5M4 10h9M4 14h9"/>',
    print: '<path d="M6 9V3h12v6M6 18H4a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2"/><rect x="6" y="14" width="12" height="7"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
    logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>',
  };
  var ico = function (n) { return '<svg class="h-ico" viewBox="0 0 24 24" aria-hidden="true">' + ICO[n] + '</svg>'; };

  function fmtDate(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    var d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2], 12));
    var s = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
  function getToken() { try { return sessionStorage.getItem(TOKEN_KEY) || localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } }
  function setToken(t, remember) {
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
      if (remember) localStorage.setItem(TOKEN_KEY, t);
    } catch (e) {}
  }
  function clearToken() { try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

  function api(action, opts) {
    opts = opts || {};
    var url = '/api/reservation?action=' + action + (opts.query ? '&' + opts.query : '');
    var headers = { 'Content-Type': 'application/json' };
    var t = opts.token !== undefined ? opts.token : getToken();
    if (t) headers.Authorization = 'Bearer ' + t;
    return fetch(url, { method: opts.body ? 'POST' : 'GET', headers: headers, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) { var e = new Error(j.error || 'Erreur réseau, réessayez.'); e.status = r.status; e.data = j; throw e; }
          return j;
        });
      });
  }

  function sitePhone(b) {
    var p = (b && b.contactPhone) || '';
    if (!p) { var n = $('#navPhone span'); p = n ? n.textContent.trim() : ''; }
    return p || '07 59 54 23 68';
  }
  var telHref = function (p) { return 'tel:' + String(p).replace(/[^+0-9]/g, ''); };

  /* ─── Blocs communs ─────────────────────────────────────────────── */
  function recapCard(b, title) {
    var opts = [];
    if (b.wash && b.wash.type !== 'none') opts.push(esc(b.wash.label));
    if (b.options.coveredParking) opts.push('Parking couvert');
    if (b.options.priorityAccess) opts.push('Accès prioritaire');
    var paid = b.paymentMethod === 'stripe' && b.paymentStatus === 'paid';
    var detail = (b.detail || []).map(function (d) {
      return '<li><span>' + esc(d.label) + '</span><span' + (d.amount < 0 ? ' class="is-neg"' : '') + '>' + (d.amount < 0 ? '−' + eur(-d.amount) : eur(d.amount)) + '</span></li>';
    }).join('');
    return '<section class="ec-card" aria-labelledby="ec-recap-t">' +
      '<h2 id="ec-recap-t">' + ico('plane') + esc(title || 'Votre réservation') + '</h2>' +
      '<dl class="ec-rows">' +
        '<div class="ec-row"><dt>Aller</dt><dd>' + fmtDate(b.dep.date) + ' à ' + esc(b.dep.time) + '<span>Prise en charge au dépose-minute' + (b.dep.terminal ? ' · ' + esc(b.dep.terminal) : '') + '</span></dd></div>' +
        '<div class="ec-row"><dt>Retour</dt><dd>' + fmtDate(b.ret.date) + ' à ' + esc(b.ret.time) + '<span>' + (b.customer.flight ? 'Vol ' + esc(b.customer.flight) : 'Numéro de vol non renseigné') + '</span></dd></div>' +
        '<div class="ec-row"><dt>Véhicule</dt><dd>' + esc(b.car.brand) + ' ' + esc(b.car.model) + (b.car.color ? ' · ' + esc(b.car.color) : '') + '<span>' + esc(b.car.plate) + '</span></dd></div>' +
        '<div class="ec-row"><dt>Options</dt><dd>' + (opts.length ? opts.join(' · ') : 'Aucune') + '</dd></div>' +
        '<div class="ec-row"><dt>Contact</dt><dd>' + esc(b.customer.firstname) + ' ' + esc(b.customer.lastname || '') + '<span>' + esc(b.customer.phone) + ' · ' + esc(b.customer.email) + '</span></dd></div>' +
      '</dl>' +
      (detail ? '<div class="ec-price"><ul>' + detail + '</ul></div>' : '') +
      '<div class="ec-total"><span>' + (paid ? 'Total payé' : 'Total à régler sur place') + '</span><b>' + eur(b.total) + '</b></div>' +
      (paid ? '' : '<p class="ec-small" style="margin:10px 0 0">Espèces ou carte bancaire, le jour de la prise en charge.</p>') +
    '</section>';
  }

  function nextSteps(b) {
    var phone = sitePhone(b);
    var tel = '<a href="' + telHref(phone) + '">' + esc(phone) + '</a>';
    return '<section class="ec-card" aria-labelledby="ec-steps-t">' +
      '<h2 id="ec-steps-t">' + ico('key') + 'Comment ça se passe</h2>' +
      '<ol class="ec-steps">' +
        '<li><strong>Email de confirmation envoyé</strong><p>À ' + esc(b.customer.email) + '. Pensez à vérifier vos spams.</p></li>' +
        '<li><strong>Le jour J, appelez-nous 45 min avant d\'arriver à Orly</strong><p>Au ' + tel + '. Prévoyez d\'arriver 3 h avant votre vol.</p></li>' +
        '<li><strong>Votre voiturier vous attend au dépose-minute</strong><p>' + (b.dep.terminal ? esc(b.dep.terminal) + '. ' : '') + 'Remise des clés et photos du véhicule sur place.</p></li>' +
        '<li><strong>Au retour, un SMS dès l\'atterrissage</strong><p>Puis un appel une fois vos bagages récupérés : on vous rend la voiture devant le terminal.</p></li>' +
      '</ol>' +
    '</section>';
  }

  function helpCard(b) {
    var phone = sitePhone(b);
    return '<section class="ec-card ec-noprint"><div class="ec-help"><span class="ec-muted">Une question&nbsp;? On répond 7j/7.</span>' +
      '<span><a href="' + telHref(phone) + '">' + esc(phone) + '</a> · <a href="mailto:contact@directvoiturier.com">contact@directvoiturier.com</a></span></div></section>';
  }

  /* Fichier .ics (aller + retour) pour l'agenda du téléphone */
  function downloadIcs(b) {
    var stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    var dt = function (d, t) { return d.replace(/-/g, '') + 'T' + t.replace(':', '') + '00'; };
    var addMin = function (d, t, m) {
      var x = new Date(d + 'T' + t + ':00Z'); x.setUTCMinutes(x.getUTCMinutes() + m);
      return x.toISOString().slice(0, 16).replace(/[-:]/g, '').replace('T', 'T') + '00';
    };
    var phone = sitePhone(b);
    var ev = function (id, d, t, sum, desc) {
      return ['BEGIN:VEVENT', 'UID:' + b.reference + '-' + id + '@directvoiturier.com', 'DTSTAMP:' + stamp,
        'DTSTART;TZID=Europe/Paris:' + dt(d, t), 'DTEND;TZID=Europe/Paris:' + addMin(d, t, 30),
        'SUMMARY:' + sum, 'LOCATION:Aéroport Paris-Orly', 'DESCRIPTION:' + desc.replace(/\n/g, '\\n'),
        'BEGIN:VALARM', 'TRIGGER:-PT1H', 'ACTION:DISPLAY', 'DESCRIPTION:' + sum, 'END:VALARM', 'END:VEVENT'].join('\r\n');
    };
    var ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Direct Voiturier//FR', 'CALSCALE:GREGORIAN',
      ev('aller', b.dep.date, b.dep.time, 'Voiturier Orly — prise en charge (' + b.reference + ')', 'Appelez le ' + phone + ' 45 min avant votre arrivée à Orly.\nDépose-minute ' + (b.dep.terminal || 'de votre terminal') + '.'),
      ev('retour', b.ret.date, b.ret.time, 'Voiturier Orly — retour (' + b.reference + ')', 'SMS au ' + phone + ' dès l\'atterrissage, puis appel une fois les bagages récupérés.'),
      'END:VCALENDAR'].join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
    a.download = 'voiturier-orly-' + b.reference + '.ics';
    document.body.appendChild(a); a.click(); a.remove();
  }

  function copyRef(btn, ref) {
    var done = function () { btn.textContent = 'Copié ✓'; setTimeout(function () { btn.textContent = 'Copier'; }, 1800); };
    if (navigator.clipboard) navigator.clipboard.writeText(ref).then(done, function () {});
    else done();
  }

  function track(name, params) {
    try { if (typeof window.trackEvent === 'function') window.trackEvent(name, params); } catch (e) {}
  }

  /* ═══ PAGE : CONFIRMATION ═══════════════════════════════════════ */
  /* Paramètres secrets (jeton, session Stripe) : lus dans l'URL puis retirés
     par le script en tête de page, avant tout outil de mesure. */
  function param(name) {
    var P = window.__EC_PARAMS;
    if (P && P[name]) return String(P[name]);
    return new URLSearchParams(location.search).get(name) || '';
  }
  function forgetParam(name) {
    try {
      var P = window.__EC_PARAMS || {}; delete P[name];
      sessionStorage.setItem('ec_params:' + location.pathname, JSON.stringify(P));
    } catch (e) {}
  }

  function initConfirm() {
    var root = $('#ec-root');
    var sessionId = param('session_id');
    var t = param('t');
    if (!sessionId && !t) {
      root.innerHTML = '<section class="ec-card ec-center"><h1 style="font-size:1.4rem;margin:0 0 10px">Retrouver ma réservation</h1>' +
        '<p class="ec-muted">Ce lien est incomplet. Connectez-vous avec la référence reçue par email.</p>' +
        '<div class="ec-actions"><a class="ec-btn ec-btn-primary" href="/gerer-ma-reservation">Gérer ma réservation</a></div></section>';
      return;
    }
    var tries = 0;
    (function load() {
      api('confirmation', { query: sessionId ? 'session_id=' + encodeURIComponent(sessionId) : 't=' + encodeURIComponent(t), token: '' })
        .then(function (r) {
          if (r.state === 'processing') {
            if (++tries <= 12) {
              root.innerHTML = '<section class="ec-card ec-center"><span class="ec-spinner"></span><p class="ec-muted" style="margin-top:14px">Nous confirmons votre paiement auprès de la banque…</p></section>';
              return setTimeout(load, 2500);
            }
            root.innerHTML = '<section class="ec-card ec-center"><h1 style="font-size:1.4rem;margin:0 0 10px">Paiement en cours de validation</h1>' +
              '<p class="ec-muted">Votre banque n\'a pas encore confirmé le paiement de la réservation <strong>' + esc(r.reference) + '</strong>. Vous recevrez l\'email de confirmation dès que c\'est fait. Aucun double paiement : inutile de recommencer.</p>' +
              '<div class="ec-actions"><button class="ec-btn ec-btn-ghost" type="button" id="ec-retry">Actualiser</button></div></section>';
            $('#ec-retry').addEventListener('click', function () { tries = 0; load(); });
            return;
          }
          renderConfirm(root, r.booking, r.token, !!sessionId);
        })
        .catch(function (e) {
          root.innerHTML = '<section class="ec-card ec-center"><h1 style="font-size:1.4rem;margin:0 0 10px">Lien expiré ou invalide</h1>' +
            '<p class="ec-muted">' + esc(e.message) + '</p><div class="ec-actions"><a class="ec-btn ec-btn-primary" href="/gerer-ma-reservation">Retrouver ma réservation</a></div></section>';
        });
    })();
  }

  function renderConfirm(root, b, token, fromStripe) {
    setToken(token, false);
    var paid = b.paymentMethod === 'stripe' && b.paymentStatus === 'paid';
    var manage = '/gerer-ma-reservation?t=' + encodeURIComponent(token);
    root.innerHTML =
      '<section class="ec-card"><div class="ec-hero">' +
        '<div class="ec-check"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></div>' +
        '<h1>C\'est confirmé, ' + esc(b.customer.firstname) + '&nbsp;!</h1>' +
        '<p class="ec-muted">' + (paid ? 'Paiement reçu. ' : '') + 'Votre voiturier est réservé. Le récapitulatif vient aussi de partir par email.</p>' +
        '<div class="ec-ref"><span><small>RÉFÉRENCE</small><br>' + esc(b.reference) + '</span><button class="ec-copy" type="button" id="ec-copy">Copier</button></div>' +
      '</div>' +
      '<div class="ec-actions">' +
        '<a class="ec-btn ec-btn-primary" href="' + manage + '">' + ico('edit') + 'Gérer ma réservation</a>' +
        '<button class="ec-btn ec-btn-ghost" type="button" id="ec-ics">' + ico('cal') + 'Ajouter à mon agenda</button>' +
      '</div>' +
      '<p class="ec-small" style="text-align:center;margin:12px 0 0">Changer de dates, de vol ou ajouter une option : possible en ligne jusqu\'à 24&nbsp;h avant le rendez-vous.</p>' +
      '</section>' +
      nextSteps(b) + recapCard(b) +
      '<div class="ec-actions ec-noprint" style="margin:0 0 16px"><button class="ec-btn ec-btn-ghost" type="button" onclick="window.print()">' + ico('print') + 'Imprimer / PDF</button></div>' +
      helpCard(b);
    $('#ec-copy').addEventListener('click', function () { copyRef(this, b.reference); });
    $('#ec-ics').addEventListener('click', function () { downloadIcs(b); });
    document.title = 'Réservation confirmée ' + b.reference + ' | Direct Voiturier';

    // Conversion (une seule fois par référence) — reprend le retour Stripe historique
    if (fromStripe && paid) {
      var key = 'vo_paid_' + b.reference, already = null;
      try { already = sessionStorage.getItem(key) || localStorage.getItem(key); } catch (e) {}
      if (!already) {
        try { sessionStorage.setItem(key, '1'); localStorage.setItem(key, '1'); } catch (e) {}
        track('purchase', { transaction_id: b.reference, value: b.total, currency: 'EUR' });
        var A = window.VO_ANALYTICS || {};
        if (A.ADS_ID && A.ADS_CONVERSION_LABEL) track('conversion', { send_to: A.ADS_ID + '/' + A.ADS_CONVERSION_LABEL, transaction_id: b.reference, value: b.total, currency: 'EUR' });
        if (window.DVAnalytics) window.DVAnalytics.trackEvent('demande_devis_validee', { mode_paiement: 'en_ligne', currency: 'EUR', value: b.total, transaction_id: b.reference });
      }
    }
  }

  /* ═══ PAGE : GÉRER MA RÉSERVATION ═══════════════════════════════ */
  var STATE = { b: null, panel: null, quoteSeq: 0, lastQuote: null };

  function initManage() {
    var q = new URLSearchParams(location.search);
    var t = param('t'), modif = param('modif');
    if (t) setToken(t, false);
    // Usage unique : un rechargement ne doit pas rejouer l'attente de paiement
    // ni écraser une session plus récente.
    forgetParam('t'); forgetParam('modif');
    if (t || modif || q.get('ref')) history.replaceState(null, '', location.pathname);
    STATE.prefillRef = q.get('ref') || '';
    if (!getToken()) return renderLogin();
    loadView(modif ? function () { waitModification(modif); } : null);
  }

  function loadView(after) {
    var root = $('#ec-root');
    root.innerHTML = '<section class="ec-card ec-center"><span class="ec-spinner"></span></section>';
    api('view').then(function (b) { STATE.b = b; renderDashboard(); if (after) after(); })
      .catch(function (e) { clearToken(); renderLogin(e.status === 401 || e.status === 404 ? e.message : ''); });
  }

  function renderLogin(msg) {
    var root = $('#ec-root');
    root.innerHTML =
      '<section class="ec-card">' +
        '<div class="ec-hero" style="padding-bottom:6px"><h1>Gérer ma réservation</h1>' +
        '<p class="ec-muted">Consultez votre réservation, changez vos dates ou votre vol, ajoutez une option.</p></div>' +
        '<form id="ec-login" novalidate style="margin-top:20px">' +
          (msg ? '<p class="ec-error" role="alert">' + esc(msg) + '</p>' : '<p class="ec-error" role="alert" hidden></p>') +
          '<div class="ec-field"><label for="ec-ref">Référence de réservation</label>' +
            '<input id="ec-ref" name="reference" autocomplete="off" autocapitalize="characters" placeholder="VO-XXXXXX" value="' + esc(STATE.prefillRef || '') + '" required>' +
            '<p class="ec-small">Elle figure dans l\'email de confirmation.</p></div>' +
          '<div class="ec-field"><label for="ec-id">Nom de famille ou email</label>' +
            '<input id="ec-id" name="identifier" autocomplete="family-name" placeholder="Dupont" required></div>' +
          '<label class="ec-choice" style="margin-bottom:16px"><input type="checkbox" id="ec-remember"><span>Rester connecté sur cet appareil</span></label>' +
          '<button class="ec-btn ec-btn-primary" type="submit" style="width:100%">' + ico('key') + 'Accéder à ma réservation</button>' +
        '</form>' +
      '</section>' + helpCard(null);
    $('#ec-login').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var btn = this.querySelector('button[type=submit]'), err = this.querySelector('.ec-error');
      var ref = $('#ec-ref').value.trim(), id = $('#ec-id').value.trim();
      if (!ref || !id) { err.hidden = false; err.textContent = 'Indiquez votre référence et votre nom (ou email).'; return; }
      btn.disabled = true; btn.innerHTML = '<span class="ec-spinner"></span>';
      api('login', { body: { reference: ref, identifier: id }, token: '' }).then(function (r) {
        setToken(r.token, $('#ec-remember').checked);
        track('manage_login', {});
        loadView();
      }).catch(function (e) {
        err.hidden = false; err.textContent = e.message;
        btn.disabled = false; btn.innerHTML = ico('key') + 'Accéder à ma réservation';
      });
    });
  }

  function tracker(b) {
    var order = ['confirmed', 'taken', 'in_storage', 'returned'];
    var labels = ['Confirmée', 'Prise en charge', 'Stationnée', 'Restituée'];
    var idx = order.indexOf(b.status);
    if (b.status === 'cancelled') return '<p class="ec-info">Cette réservation est annulée.</p>';
    return '<div class="ec-track" aria-label="Statut : ' + esc(b.statusLabel) + '">' + labels.map(function (l, i) {
      return '<div class="' + (i <= idx ? 'is-done' : '') + '"><i></i>' + l + '</div>';
    }).join('') + '</div>';
  }

  function renderDashboard(flash) {
    var b = STATE.b, r = b.rules, root = $('#ec-root');
    var phone = sitePhone(b);
    var canAny = r.departure || r.return || r.options || r.contact;
    var item = function (id, icon, title, sub, enabled) {
      return '<button type="button" data-panel="' + id + '"' + (enabled ? '' : ' disabled') + '><span class="ec-ic">' + ico(icon) + '</span><span><strong>' + title + '</strong><small>' + sub + '</small></span></button>';
    };
    root.innerHTML =
      '<div class="ec-topbar"><h1>Ma réservation</h1><button class="ec-link ec-noprint" type="button" id="ec-logout">Se déconnecter</button></div>' +
      (flash ? '<p class="ec-success" role="status">' + flash + '</p>' : '') +
      '<section class="ec-card">' +
        '<div class="ec-help" style="margin-bottom:14px"><div class="ec-ref" style="margin:0"><span><small>RÉFÉRENCE</small><br>' + esc(b.reference) + '</span><button class="ec-copy" type="button" id="ec-copy">Copier</button></div>' +
        '<span class="ec-badge ' + (b.status === 'cancelled' || b.status === 'returned' ? 'is-off' : 'is-ok') + '">' + esc(b.statusLabel) + '</span></div>' +
        tracker(b) +
      '</section>' +
      '<section class="ec-card ec-noprint" id="ec-modify">' +
        '<h2>' + ico('edit') + 'Modifier ma réservation</h2>' +
        (r.reason ? '<p class="ec-info">' + esc(r.reason) + ' <a href="' + telHref(phone) + '"><strong>' + esc(phone) + '</strong></a></p>' : '') +
        (canAny ? '<div class="ec-menu">' +
          item('dates', 'cal', 'Changer mes dates ou horaires', r.departure ? 'Aller et retour' : 'Retour uniquement', r.departure || r.return) +
          item('options', 'plus', 'Ajouter une option', 'Lavage, parking couvert…', r.options) +
          item('contact', 'plane', 'Mon vol / mon téléphone', 'Sans frais', r.contact) +
          item('cancel', 'x', 'Annuler', 'Voir les conditions', b.status !== 'cancelled' && b.status !== 'returned') +
        '</div>' : '') +
        '<div id="ec-panel"></div>' +
        '<p class="ec-small" style="margin:14px 0 0">Si la modification coûte plus cher, vous réglez la différence + ' + eur(b.catalog.fee) + ' de frais de modification. Si elle coûte moins cher, le prix reste inchangé (pas de remboursement).</p>' +
      '</section>' +
      recapCard(b) + nextSteps(b) +
      '<div class="ec-actions ec-noprint" style="margin:0 0 16px">' +
        '<button class="ec-btn ec-btn-ghost" type="button" id="ec-ics">' + ico('cal') + 'Ajouter à mon agenda</button>' +
        '<button class="ec-btn ec-btn-ghost" type="button" onclick="window.print()">' + ico('print') + 'Imprimer / PDF</button>' +
      '</div>' + helpCard(b);

    $('#ec-copy').addEventListener('click', function () { copyRef(this, b.reference); });
    $('#ec-ics').addEventListener('click', function () { downloadIcs(b); });
    $('#ec-logout').addEventListener('click', function () { clearToken(); STATE.b = null; renderLogin(); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-panel]'), function (btn) {
      btn.addEventListener('click', function () { openPanel(btn.getAttribute('data-panel')); });
    });
    document.title = 'Ma réservation ' + b.reference + ' | Direct Voiturier';
  }

  function todayIso(offsetDays) {
    var d = new Date(); d.setDate(d.getDate() + (offsetDays || 0));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function openPanel(id) {
    var b = STATE.b, r = b.rules, c = b.catalog, p = $('#ec-panel');
    STATE.panel = id; STATE.lastQuote = null;
    var html = '';
    if (id === 'dates') {
      var dis = r.departure ? '' : ' disabled';
      html = '<fieldset class="ec-fieldset"><legend>Aller (prise en charge)</legend>' +
          (r.departure ? '' : '<p class="ec-small" style="margin:0 0 10px">L\'aller ne peut plus être modifié en ligne.</p>') +
          '<div class="ec-grid2"><div class="ec-field"><label for="f-depDate">Date</label><input type="date" id="f-depDate" min="' + todayIso(1) + '" value="' + b.dep.date + '"' + dis + '></div>' +
          '<div class="ec-field"><label for="f-depTime">Heure</label><input type="time" id="f-depTime" step="300" value="' + b.dep.time + '"' + dis + '></div></div>' +
          '<div class="ec-field"><label for="f-depTerminal">Terminal</label><select id="f-depTerminal"' + dis + '><option value="">Je ne sais pas encore</option>' +
            c.terminals.map(function (t) { return '<option' + (t === b.dep.terminal ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
        '</fieldset>' +
        '<fieldset class="ec-fieldset"><legend>Retour</legend>' +
          '<div class="ec-grid2"><div class="ec-field"><label for="f-retDate">Date</label><input type="date" id="f-retDate" min="' + todayIso(1) + '" value="' + b.ret.date + '"' + (r.return ? '' : ' disabled') + '></div>' +
          '<div class="ec-field"><label for="f-retTime">Heure d\'atterrissage</label><input type="time" id="f-retTime" step="300" value="' + b.ret.time + '"' + (r.return ? '' : ' disabled') + '></div></div>' +
        '</fieldset>';
    } else if (id === 'options') {
      var curIdx = c.wash.map(function (w) { return w.code; }).indexOf(b.wash.type);
      html = '<fieldset class="ec-fieldset"><legend>Lavage pendant votre voyage</legend><div class="ec-choices">' +
        c.wash.map(function (w, i) {
          return '<label class="ec-choice"><input type="radio" name="f-wash" value="' + w.code + '"' + (w.code === b.wash.type ? ' checked' : '') + (i < curIdx ? ' disabled' : '') + '>' +
            '<span>' + esc(w.label) + (w.code === b.wash.type && w.code !== 'none' ? '<small>Déjà réservé</small>' : '') + '</span><b>' + (w.price ? eur(w.price) : '—') + '</b></label>';
        }).join('') + '</div></fieldset>' +
        (c.options.length ? '<fieldset class="ec-fieldset" style="margin-top:14px"><legend>Options</legend><div class="ec-choices">' +
          c.options.map(function (o) {
            var on = !!b.options[o.code];
            return '<label class="ec-choice"><input type="checkbox" data-opt="' + o.code + '"' + (on ? ' checked disabled' : '') + '>' +
              '<span>' + esc(o.label) + '<small>' + (on ? 'Déjà réservé' : esc(o.description)) + '</small></span><b>+' + eur(o.price) + '</b></label>';
          }).join('') + '</div></fieldset>' : '') +
        '<p class="ec-small" style="margin:10px 0 0">Le prix exact (supplément selon votre véhicule inclus) s\'affiche ci-dessous.</p>';
    } else if (id === 'contact') {
      html = '<div class="ec-field"><label for="f-flight">Numéro du vol retour</label><input id="f-flight" maxlength="20" autocapitalize="characters" placeholder="Ex. TO 3021" value="' + esc(b.customer.flight) + '">' +
          '<p class="ec-small">On suit votre vol : en cas de retard, votre voiturier s\'adapte.</p></div>' +
        '<div class="ec-field"><label for="f-phone">Téléphone</label><input id="f-phone" type="tel" autocomplete="tel" value="' + esc(b.customer.phone) + '"></div>';
    } else if (id === 'cancel') {
      var phone = sitePhone(b);
      p.innerHTML = '<div class="ec-quote" style="margin-top:16px"><p style="margin:0 0 8px;font-weight:800;color:var(--ink)">Annulation</p>' +
        '<p class="ec-muted" style="margin:0 0 10px">Selon nos <a href="/conditions-generales" target="_blank">conditions générales</a>, une réservation est ferme et définitive. Pour une annulation signalée au moins 7 jours avant la prise en charge, nous étudions chaque demande au cas par cas.</p>' +
        '<p class="ec-muted" style="margin:0">Plutôt qu\'annuler, vous pouvez aussi <button class="ec-link" type="button" data-goto="dates">changer vos dates</button>.</p>' +
        '<div class="ec-actions"><a class="ec-btn ec-btn-ghost" href="' + telHref(phone) + '">' + ico('phone') + esc(phone) + '</a>' +
        '<a class="ec-btn ec-btn-ghost" href="mailto:contact@directvoiturier.com?subject=' + encodeURIComponent('Annulation ' + b.reference) + '">Écrire un email</a></div></div>';
      var go = p.querySelector('[data-goto]');
      if (go) go.addEventListener('click', function () { openPanel('dates'); });
      p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      return;
    }
    p.innerHTML = '<form id="ec-form" novalidate style="margin-top:18px">' + html +
      '<p class="ec-error" role="alert" hidden></p>' +
      '<div id="ec-quote" class="ec-quote" hidden></div>' +
      '<div class="ec-actions" style="margin-top:6px"><button class="ec-btn ec-btn-primary" type="submit" id="ec-submit" disabled>Choisissez vos changements</button>' +
      '<button class="ec-btn ec-btn-ghost" type="button" id="ec-cancel-panel">Fermer</button></div></form>';
    var form = $('#ec-form');
    form.addEventListener('input', debounce(requote, 450));
    form.addEventListener('change', debounce(requote, 150));
    form.addEventListener('submit', function (e) { e.preventDefault(); submitChange(); });
    $('#ec-cancel-panel').addEventListener('click', function () { p.innerHTML = ''; STATE.panel = null; });
    p.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function debounce(fn, ms) { var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); }; }

  function collect() {
    var b = STATE.b, c = {};
    var v = function (id) { var el = $('#' + id); return el && !el.disabled ? el.value : undefined; };
    if (STATE.panel === 'dates') {
      ['depDate', 'depTime', 'depTerminal', 'retDate', 'retTime'].forEach(function (k) { var x = v('f-' + k); if (x !== undefined) c[k] = x; });
    } else if (STATE.panel === 'options') {
      var w = document.querySelector('input[name="f-wash"]:checked'); if (w) c.washType = w.value;
      Array.prototype.forEach.call(document.querySelectorAll('[data-opt]'), function (el) { if (!el.disabled) c[el.getAttribute('data-opt')] = el.checked; });
    } else if (STATE.panel === 'contact') {
      c.flight = v('f-flight'); c.phone = v('f-phone');
    }
    // N'envoie que ce qui change vraiment
    var cur = { depDate: b.dep.date, depTime: b.dep.time, depTerminal: b.dep.terminal, retDate: b.ret.date, retTime: b.ret.time,
      washType: b.wash.type, coveredParking: b.options.coveredParking, priorityAccess: b.options.priorityAccess, flight: b.customer.flight, phone: b.customer.phone };
    var out = {}, any = false;
    Object.keys(c).forEach(function (k) {
      if (c[k] === undefined) return;
      var a = typeof c[k] === 'string' ? c[k].trim() : c[k];
      var bb = typeof cur[k] === 'string' ? String(cur[k] || '').trim() : cur[k];
      if (k === 'flight') { a = String(a).toUpperCase().replace(/\s+/g, ' '); bb = String(bb).toUpperCase(); }
      if (a !== bb) { out[k] = a; any = true; }
    });
    // Le serveur a besoin de la paire date + heure complète
    if (out.depDate !== undefined || out.depTime !== undefined) { out.depDate = c.depDate; out.depTime = c.depTime; }
    if (out.retDate !== undefined || out.retTime !== undefined) { out.retDate = c.retDate; out.retTime = c.retTime; }
    return any ? out : null;
  }

  function requote() {
    var changes = collect(), box = $('#ec-quote'), btn = $('#ec-submit'), err = $('#ec-form .ec-error');
    if (!box) return;
    err.hidden = true; STATE.lastQuote = null;
    if (!changes) { box.hidden = true; btn.disabled = true; btn.textContent = 'Choisissez vos changements'; return; }
    var seq = ++STATE.quoteSeq;
    btn.disabled = true; btn.innerHTML = '<span class="ec-spinner"></span>';
    api('quote', { body: { changes: changes } }).then(function (q) {
      if (seq !== STATE.quoteSeq) return;
      STATE.lastQuote = { changes: changes, q: q };
      var paidOnline = q.payOnline;
      var lines = '<ul>' + q.summary.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ul>';
      if (q.toPay > 0) {
        lines += '<div class="ec-qline"><span>Différence de prix</span><span>+' + eur(q.extra) + '</span></div>' +
          '<div class="ec-qline"><span>Frais de modification</span><span>+' + eur(q.fee) + '</span></div>' +
          '<div class="ec-qtotal"><span>' + (paidOnline ? 'À payer maintenant' : 'À ajouter au règlement sur place') + '</span><span>' + eur(q.toPay) + '</span></div>';
        btn.innerHTML = paidOnline ? ico('euro') + 'Payer ' + eur(q.toPay) + ' et valider' : 'Valider (+' + eur(q.toPay) + ' sur place)';
      } else {
        lines += '<div class="ec-qtotal"><span>Aucun supplément</span><span>0&nbsp;€</span></div>' +
          (q.priceDiff < 0 ? '<p class="ec-small" style="margin:8px 0 0">Cette nouvelle formule est moins chère, mais le prix de votre réservation reste inchangé (pas de remboursement de la différence).</p>' : '');
        btn.innerHTML = 'Valider la modification';
      }
      box.innerHTML = lines; box.hidden = false; btn.disabled = false;
    }).catch(function (e) {
      if (seq !== STATE.quoteSeq) return;
      if (e.status === 401) { clearToken(); return renderLogin(e.message); }
      box.hidden = true; err.hidden = false; err.textContent = e.message;
      btn.disabled = true; btn.textContent = 'Modification impossible';
    });
  }

  function submitChange() {
    var lq = STATE.lastQuote, btn = $('#ec-submit'), err = $('#ec-form .ec-error');
    if (!lq) return;
    btn.disabled = true; btn.innerHTML = '<span class="ec-spinner"></span> Enregistrement…';
    api('modify', { body: { changes: lq.changes, expectedToPay: lq.q.toPay } }).then(function (r) {
      if (r.url) { track('modification_checkout', { value: r.toPay, currency: 'EUR' }); location.href = r.url; return; }
      track('modification_saved', { value: r.toPay || 0, currency: 'EUR' });
      STATE.b = r.booking;
      renderDashboard('✓ Modification enregistrée. Un email de confirmation vient de partir.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }).catch(function (e) {
      if (e.status === 401) { clearToken(); return renderLogin(e.message); }
      err.hidden = false; err.textContent = e.message;
      if (e.status === 409 && e.data && e.data.toPay !== undefined) { requote(); return; }
      btn.disabled = false; btn.textContent = 'Réessayer';
    });
  }

  /* Retour de Stripe après paiement d'un supplément */
  function waitModification(sessionId) {
    var n = 0;
    var box = document.createElement('p');
    box.className = 'ec-info'; box.setAttribute('role', 'status');
    box.innerHTML = '<span class="ec-spinner" style="width:16px;height:16px;border-width:2px;margin-right:8px"></span>Paiement reçu, enregistrement de votre modification…';
    var top = $('.ec-topbar'); if (top) top.insertAdjacentElement('afterend', box);
    (function poll() {
      api('modstatus', { query: 'session_id=' + encodeURIComponent(sessionId) }).then(function (r) {
        if (r.refunded) {
          box.className = 'ec-error';
          box.textContent = 'Cette modification n\'a pas pu être appliquée (créneau devenu indisponible). Votre réservation est inchangée et le paiement vous sera intégralement remboursé. Un email vient de partir.';
          return;
        }
        if (r.applied) {
          return api('view').then(function (b) { STATE.b = b; renderDashboard('✓ Paiement reçu et modification enregistrée. Un email de confirmation vient de partir.'); });
        }
        if (++n < 15) return setTimeout(poll, 2000);
        box.className = 'ec-success';
        box.textContent = r.paid
          ? '✓ Paiement reçu. Votre modification sera visible ici d\'ici quelques minutes, et vous recevrez un email de confirmation.'
          : 'Le paiement n\'a pas abouti : votre réservation n\'a pas été modifiée.';
      }).catch(function () { box.textContent = 'Paiement reçu : actualisez la page dans quelques instants.'; });
    })();
  }

  if (PAGE === 'confirm') initConfirm();
  else if (PAGE === 'manage') initManage();
})();
