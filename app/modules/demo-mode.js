/**
 * demo-mode.js — admin-side demo-sandbox surface (W1–W5 of the demo-engine handoff).
 *
 * Loaded EAGERLY (a plain <script src> near the end of app/index.html, NOT a lazy
 * MODULE_MANIFEST entry) because the banner + telemetry have to arm on boot. It
 * no-ops entirely for non-demo tenants, so the cost on a normal admin boot is one
 * small parse + an early return.
 *
 * Why a module and not inline shell JS: the shell-size ratchet
 * (scripts/lint-shell-size.js) + the decomposition program forbid new inline
 * feature code in index.html. The shell keeps only the demo CSS, the
 * #demoBannerSlot div, and this <script> tag; all behaviour lives here.
 *
 * DISPLAY-ONLY. Everything here is gated on window.DEMO_MODE (set by
 * storefront-tenant.js setGlobals, which the admin also loads — see W1). The real
 * boundary is the server-side flags.demo; these markers only change UI.
 *
 * Surfaces:
 *   W2  renderBanner()        persistent "Demo store — resets in {countdown}" bar.
 *   W3  demoStubHtml/         "Available in the full product" affordances; the
 *       demoBlockCapability    channel-connect + coin-wall shell fns are patched.
 *   W4  demoUpgradeFlow()     avatar item + banners → convertDemoToReal → redirect.
 *   W5  trackAdminEvent       demo_entered_sandbox / key_action / cta_clicked /
 *                             converted funnel into analytics/hits.
 */
(function () {
  'use strict';

  // Self-contained esc — don't depend on the shell's esc() being defined yet.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
  }
  function track(action) {
    try { if (typeof window.trackAdminEvent === 'function') window.trackAdminEvent('ev', action); } catch (_e) {}
  }

  // ── W2 — persistent banner + live reset countdown ─────────────────────────
  var _timer = null;
  function countdownText() {
    if (window.MastDemo && window.DEMO_RESET_AT) {
      var t = window.MastDemo.formatCountdown(window.DEMO_RESET_AT);
      if (t) return t;
    }
    return '—';
  }
  function renderBanner() {
    var slot = document.getElementById('demoBannerSlot');
    if (!slot) return;
    if (!window.DEMO_MODE) {
      slot.style.display = 'none';
      slot.innerHTML = '';
      if (_timer) { clearInterval(_timer); _timer = null; }
      return;
    }
    // W5 — demo_entered_sandbox: once per sandbox on first admin load. The
    // localStorage flag is shared with the same-origin storefront.
    try {
      if (!localStorage.getItem('__mast_demo_entered')) {
        localStorage.setItem('__mast_demo_entered', '1');
        track('demo_entered_sandbox');
      }
    } catch (_e) {}

    var sink = window.DEMO_EMAIL_SINK
      ? '<span class="demo-banner-sink">&middot; all email goes to ' + esc(window.DEMO_EMAIL_SINK) + '</span>'
      : '';
    slot.style.display = '';
    slot.innerHTML =
      '<div class="demo-banner" role="status" aria-live="polite">' +
        '<div class="demo-banner-message">' +
          '🧪 <strong>Demo store</strong> &mdash; resets in ' +
          '<span class="demo-banner-countdown" id="demoCountdown">' + esc(countdownText()) + '</span> ' +
          sink +
        '</div>' +
        '<button class="demo-banner-cta" onclick="demoUpgradeFlow(\'banner\')" ' +
          'aria-label="Start your own store">⭐ Start my own store</button>' +
      '</div>';

    if (_timer) clearInterval(_timer);
    _timer = setInterval(function () {
      var el = document.getElementById('demoCountdown');
      if (!el) { clearInterval(_timer); _timer = null; return; }
      el.textContent = countdownText();
    }, 1000);
  }

  // ── W4 — demo → real conversion ───────────────────────────────────────────
  // Uses the admin's mastConfirm / showToast / mastAlert (never native
  // confirm/alert — the UX-standard ratchet forbids them in modules).
  var _inFlight = false;
  function notify(msg, isError) {
    if (typeof window.showToast === 'function') { window.showToast(msg, !!isError); return; }
    if (typeof window.mastAlert === 'function') window.mastAlert(msg, { title: isError ? 'Something went wrong' : 'Heads up' });
  }
  function demoUpgradeFlow(source) {
    if (!window.DEMO_MODE) return;
    track('demo_cta_clicked');                       // every click, any outcome
    if (_inFlight) return;

    var confirmMsg = 'We’ll spin up a fresh Mast store that’s yours to keep — your ' +
      'demo edits can come with you. This sandbox stays as-is until it expires.';
    var asked = (typeof window.mastConfirm === 'function')
      ? window.mastConfirm(confirmMsg, { title: 'Start my own store', confirmText: 'Create my store' })
      : Promise.resolve(true);   // no native-dialog fallback; proceed if helper missing

    asked.then(function (ok) {
      if (!ok) return;
      _inFlight = true;
      notify('Setting up your real store…');

      var callConvert = null;
      try { callConvert = firebase.functions().httpsCallable('convertDemoToReal'); } catch (_e) { callConvert = null; }
      if (!callConvert) { upgradeNotReady(); _inFlight = false; return; }

      var tid = window.TENANT_ID || (typeof TENANT_ID !== 'undefined' ? TENANT_ID : null);
      callConvert({ tenantId: tid, source: source || 'unknown' })
        .then(function (res) {
          var data = (res && res.data) || {};
          if (data.url || data.tenantId) {
            track('demo_converted');                 // best-effort before nav
            window.location.href = data.url || ('https://' + data.tenantId + '.runmast.com/app/');
          } else {
            upgradeNotReady();
            _inFlight = false;
          }
        })
        .catch(function (err) {
          _inFlight = false;
          // not-found / unimplemented / internal → the [ARCH] convert CF isn't
          // deployed yet (parallel session). Treat as "coming soon".
          var code = String((err && (err.code || err.message)) || '');
          if (/not-found|unimplemented|internal/i.test(code)) upgradeNotReady();
          else notify('Couldn’t start your real store. Please try again.', true);
        });
    });
  }
  function upgradeNotReady() {
    notify('Claiming your demo as a real store is rolling out shortly — we’ll have it ready for you very soon.');
  }

  // ── W5 — demo_key_action (first meaningful action, deduped once) ───────────
  function markDemoKeyAction(kind) {
    if (!window.DEMO_MODE) return;
    try {
      if (localStorage.getItem('__mast_demo_key_action')) return;
      localStorage.setItem('__mast_demo_key_action', kind || '1');
    } catch (_e) {}
    track('demo_key_action');
  }

  // ── W3 — "available in the full product" affordances ──────────────────────
  function demoStubHtml(opts) {
    opts = opts || {};
    var key = opts.key || 'feature';
    return '<div class="empty-state demo-stub">' +
      '<div class="empty-icon">' + (opts.icon || '🔒') + '</div>' +
      '<div class="empty-title">' + esc(opts.title || 'Available in the full product') + '</div>' +
      '<p>' + esc(opts.body || 'This is a live demo, so this feature is switched off here. It works end-to-end in your own Mast store.') + '</p>' +
      '<button class="btn btn-primary btn-small" style="margin-top:16px;" ' +
        'onclick="demoUpgradeFlow(\'stub_' + esc(key) + '\')">⭐ Start my own store</button>' +
      '</div>';
  }
  function demoBlockCapability(opts) {
    if (!window.DEMO_MODE) return false;
    opts = opts || {};
    var key = opts.key || 'feature';
    var title = opts.title || 'Available in the full product';
    var body = opts.body || 'This is a live demo, so this action is switched off here. It works end-to-end in your own Mast store.';
    var html =
      '<div style="text-align:center;padding:8px 4px;">' +
        '<div style="font-size:1.6rem;margin-bottom:10px;">' + (opts.icon || '🔒') + '</div>' +
        '<h3 style="margin:0 0 8px;font-size:1.15rem;">' + esc(title) + '</h3>' +
        '<p style="color:var(--warm-gray);font-size:0.9rem;line-height:1.5;margin:0 auto 20px;max-width:340px;">' + esc(body) + '</p>' +
        '<div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap;">' +
          '<button class="btn btn-primary" onclick="closeModal();demoUpgradeFlow(\'stub_' + esc(key) + '\')">⭐ Start my own store</button>' +
          '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
        '</div>' +
      '</div>';
    if (typeof window.openModal === 'function') window.openModal(html);
    else if (typeof window.mastAlert === 'function') window.mastAlert(body, { title: title });
    return true;
  }

  // Expose for the lazy admin modules (sales/fulfillment/maker/email-log) and the
  // inline onclick handlers in the banner / affordance markup.
  window.demoUpgradeFlow = demoUpgradeFlow;
  window.markDemoKeyAction = markDemoKeyAction;
  window.demoStubHtml = demoStubHtml;
  window.demoBlockCapability = demoBlockCapability;
  window.renderDemoBanner = renderBanner;

  // ── Patches onto existing shell functions (channels + token wall + avatar) ──
  // Wrapping (not editing) keeps the demo gates out of the shell's inline JS.
  // Each guard is a no-op for real tenants, so the wrappers are inert off-demo.
  function patch(name, wrapper) {
    var orig = window[name];
    if (typeof orig !== 'function' || orig.__demoPatched) return;
    var wrapped = wrapper(orig);
    wrapped.__demoPatched = true;
    window[name] = wrapped;
  }
  function installPatches() {
    // W3 — channel OAuth is hard-disabled under the demo safety envelope.
    patch('connectChannel', function (orig) {
      return function () {
        if (demoBlockCapability({ key: 'channels', icon: '🔌',
          title: 'Channel connections are in the full product',
          body: 'Connecting Shopify, Etsy, Square and other sales channels is switched off in this live demo — it works end-to-end in your own Mast store.' })) return;
        return orig.apply(this, arguments);
      };
    });
    // W3 — the coin wallet is zeroed in demo, so every coin-metered action (AI
    // drafts, etc.) hits this single "buy coins" choke point. Frame it instead.
    patch('openCoinPurchaseModal', function (orig) {
      return function () {
        if (demoBlockCapability({ key: 'ai', icon: '✨',
          title: 'AI tools are in the full product',
          body: 'AI drafting and other coin-powered tools are switched off in this live demo — they work end-to-end in your own Mast store.' })) return;
        return orig.apply(this, arguments);
      };
    });
    // W4 — avatar-menu CTA. renderAvatarMenu rebuilds innerHTML on every open, so
    // wrap it and re-inject the item after each build (idempotent).
    patch('renderAvatarMenu', function (orig) {
      return function () {
        var r = orig.apply(this, arguments);
        try { injectAvatarItem(); } catch (_e) {}
        return r;
      };
    });
  }
  function injectAvatarItem() {
    if (!window.DEMO_MODE) return;
    var menu = document.getElementById('avatarMenu');
    if (!menu || menu.querySelector('[data-demo-cta]')) return;
    var divider = menu.querySelector('.avatar-menu-divider');  // end of personal section (after Subscription)
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avatar-menu-item';
    btn.setAttribute('role', 'menuitem');
    btn.setAttribute('data-demo-cta', '');
    btn.innerHTML = '<span>⭐ Start my own store</span>';
    btn.onclick = function () { if (typeof window.closeAvatarMenu === 'function') window.closeAvatarMenu(); demoUpgradeFlow('avatar_menu'); };
    if (divider && divider.parentNode) divider.parentNode.insertBefore(btn, divider);
    else menu.appendChild(btn);
  }

  // W4 — storefront convert-CTA deep-link. The public storefront can't run the
  // authenticated convert itself, so its banner routes here with ?demo_convert=1.
  // Auto-open the flow once, then strip the param so a reload doesn't re-fire.
  function handleConvertDeepLink() {
    try {
      if (window.DEMO_MODE && /[?&]demo_convert=1\b/.test(location.search)) {
        if (history.replaceState) history.replaceState(null, '', location.pathname + location.hash);
        setTimeout(function () { demoUpgradeFlow('storefront_banner'); }, 700);
      }
    } catch (_e) {}
  }

  // Arm after tenant resolution (window.DEMO_MODE is set by setGlobals before
  // TENANT_READY resolves). Patches are installed regardless (inert off-demo) so
  // the channel/coin gates hold even if DEMO_MODE flips late.
  function arm() {
    installPatches();
    if (!window.DEMO_MODE) return;
    renderBanner();
    handleConvertDeepLink();
  }
  function start() {
    if (window.TENANT_READY && typeof window.TENANT_READY.then === 'function') {
      window.TENANT_READY.then(arm, arm);
    } else {
      arm();
    }
  }
  start();
})();
