/**
 * channels-v2.js — sales-channels surface (Shopify/Etsy/Square integrations)
 * re-hosted on the Entity Engine as a read-focused Faceted Record.
 *
 * Legacy channels.js is a list of cards plus an in-place detail with four tabs
 * (overview / products / activity / settings), a Paradigm-A edit mode, an
 * onboarding WIZARD (renderOnboarding) and connect/disconnect/OAuth flows. This
 * twin re-hosts the VIEW: a MastEntity-driven list plus a read slide-out with
 * Overview / Products / Activity facets.
 *
 * Variant (doc 17 §1a test): a channel's isActive is a plain boolean attribute,
 * NOT a governed gated lifecycle → Faceted Record, NO MastFlow, NO process
 * header. Read-focused: connect/disconnect, the onboarding wizard and the
 * settings edits stay on legacy #channels (deep-linked via navigateToClassic).
 * No onSave → no Edit button.
 *
 * Sensitive data: channels can be platform-backed (Etsy/Shopify/Square OAuth).
 * Integration tokens live OUT of band in channel_config/{channel}._tokenStatus
 * (read by ChannelConnection), NEVER on the admin/channels record this module
 * reads — so no secrets are rendered. The legacy module sits on the gated
 * 'channels' route; flag twins bypass the per-route gate, so this module
 * re-checks can('channels','view') at setup and renders an access-restricted
 * state otherwise (mirrors team-v2). Flag-gated (?ui=1) at #channels-v2,
 * side-by-side; never touches channels.js.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, N = U.Num, esc = U._esc;

  // Mirror the legacy route boundary: channels (incl. platform/account ids) is
  // visible to can('channels','view'). If the resolver isn't present, default
  // open (same as legacy, which has no per-axis gate on the route).
  function canViewChannels() { return typeof window.can === 'function' ? window.can('channels', 'view') : true; }

  // Bound reads (lint-unbounded-read). Channels + products are keyed-object
  // reads; orders is the only growth surface, capped via limitToLast.
  var ORDERS_LIMIT = 200;
  var PRODUCTS_LIMIT = 500;

  // ── static metadata (mirrors channels.js CHANNEL_TYPES/ROUTES/PLATFORMS) ──
  var TYPE_LABEL = {
    dtc_online: 'Online Store', own_storefront: 'Own Storefront', mobile_events: 'Craft Fairs',
    marketplace: 'Marketplace', wholesale_prebuy: 'Wholesale', consignment: 'Consignment',
    retail_prebuy: 'Retail Prebuy', social_live: 'Social / Live'
  };
  var ROUTE_LABEL = {
    dtc_online: 'Online (DTC)', marketplace: 'Marketplace', in_person: 'In-Person', wholesale: 'Wholesale'
  };
  var PLATFORM_LABEL = {
    manual: 'Manual / Mast', shopify: 'Shopify', etsy: 'Etsy', square: 'Square',
    squarespace: 'Squarespace', amazon: 'Amazon', tiktok: 'TikTok', instagram: 'Instagram'
  };
  var TYPE_TO_RP = {
    dtc_online: { route: 'dtc_online', platform: 'manual' },
    own_storefront: { route: 'in_person', platform: 'manual' },
    mobile_events: { route: 'in_person', platform: 'square' },
    marketplace: { route: 'marketplace', platform: 'etsy' },
    wholesale_prebuy: { route: 'wholesale', platform: 'manual' },
    consignment: { route: 'wholesale', platform: 'manual' },
    retail_prebuy: { route: 'wholesale', platform: 'manual' },
    social_live: { route: 'marketplace', platform: 'instagram' }
  };
  var ROUTE_DEFAULT_TIER = { dtc_online: 'retail', marketplace: 'retail', in_person: 'direct', wholesale: 'wholesale' };

  // ── shim accessors (mirror channels.js exactly so unmigrated channels read) ──
  function chRoute(ch) {
    if (!ch) return null;
    if (ch.route) return ch.route;
    if (ch.type && TYPE_TO_RP[ch.type]) return TYPE_TO_RP[ch.type].route;
    return null;
  }
  function chPlatform(ch) {
    if (!ch) return null;
    if (ch.platform) return ch.platform;
    if (ch.type && TYPE_TO_RP[ch.type]) return TYPE_TO_RP[ch.type].platform;
    return null;
  }
  function deriveType(route, platform) {
    if (route === 'dtc_online') return 'dtc_online';
    if (route === 'marketplace') return (platform === 'instagram' || platform === 'tiktok') ? 'social_live' : 'marketplace';
    if (route === 'in_person') return platform === 'square' ? 'mobile_events' : 'own_storefront';
    if (route === 'wholesale') return 'wholesale_prebuy';
    return null;
  }
  function chType(ch) {
    if (!ch) return null;
    if (ch.type) return ch.type;
    return deriveType(ch.route, ch.platform);
  }
  function chUsesTier(ch) {
    if (!ch) return 'retail';
    if (ch.usesTier) return ch.usesTier;
    if (ch.defaultPricingTier) return ch.defaultPricingTier;
    var r = chRoute(ch);
    return (r && ROUTE_DEFAULT_TIER[r]) || 'retail';
  }
  function typeLabel(ch) { var t = chType(ch); return (t && TYPE_LABEL[t]) || t || 'Unknown'; }
  function platformLabel(ch) {
    var p = chPlatform(ch);
    if (p && p !== 'manual') return (PLATFORM_LABEL[p] || p) + (ch.platformAccountId ? ' · ' + ch.platformAccountId : '');
    if (ch.externalPlatform) return ch.externalPlatform;
    return p ? (PLATFORM_LABEL[p] || p) : '—';
  }

  function feeSummary(ch) {
    var parts = [];
    if (ch.percentFee) parts.push(parseFloat(ch.percentFee).toFixed(1) + '%');
    if (ch.fixedFeePerOrderCents) parts.push((N.money(ch.fixedFeePerOrderCents, { cents: true }) || '$0.00') + '/order');
    if (ch.monthlyFixedCents) parts.push((N.money(ch.monthlyFixedCents, { cents: true }) || '$0.00') + '/mo');
    return parts.length ? parts.join(' + ') : 'No fees';
  }

  // Phase 2c binding shape: channelBindings[] preferred, legacy channelIds[] fallback.
  function productOnChannel(p, channelId) {
    if (p && Array.isArray(p.channelBindings) && p.channelBindings.length) {
      return p.channelBindings.some(function (b) { return b && b.channelId === channelId; });
    }
    return !!(p && Array.isArray(p.channelIds) && p.channelIds.indexOf(channelId) !== -1);
  }
  function productsForChannel(channelId) {
    return Object.keys(V2.products).map(function (k) { return Object.assign({ _key: k }, V2.products[k]); })
      .filter(function (p) { return productOnChannel(p, channelId); });
  }
  function productCount(channelId) { return productsForChannel(channelId).length; }

  function ordersForChannel(ch) {
    var sources = ch.autoMatchSources || [];
    var out = [];
    Object.keys(V2.orders).forEach(function (k) {
      var o = V2.orders[k];
      if (!o || typeof o !== 'object') return;
      if (o.channelId === ch.channelId || (o.source && sources.indexOf(o.source) !== -1)) {
        out.push(Object.assign({ _key: k }, o));
      }
    });
    out.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    return out;
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('channels-v2', {
    label: 'Channel', labelPlural: 'Channels', size: 'lg',
    route: 'channels-v2',
    recordId: function (ch) { return ch.channelId; },
    // fields[0] (name) is the slide-out title source — a real string property.
    fields: [
      { name: 'name', label: 'Channel', type: 'text', list: true, readOnly: true, group: 'Channel' },
      { name: 'type', label: 'Type', type: 'text', list: true, readOnly: true, get: function (ch) { return typeLabel(ch); } },
      { name: 'isActive', label: 'Status', type: 'status', list: true, readOnly: true,
        get: function (ch) { return ch.isActive === false ? 'Paused' : 'Active'; },
        tone: function (v) { return v === 'Active' ? 'success' : 'neutral'; } },
      { name: 'products', label: 'Products', type: 'number', list: true, readOnly: true, align: 'right',
        get: function (ch) { return productCount(ch.channelId); } },
      { name: 'fees', label: 'Fees', type: 'text', list: true, readOnly: true, get: function (ch) { return feeSummary(ch); } }
    ],
    fetch: function (id) { return Promise.resolve(V2.byId[id] || null); },
    detail: {
      render: function (UI, ch) {
        var pCount = productCount(ch.channelId);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(ch.isActive === false ? 'Paused' : 'Active', ch.isActive === false ? 'neutral' : 'success'), hero: true },
          { k: 'Type', v: esc(typeLabel(ch)) },
          { k: 'Products', v: N.count(pCount) },
          { k: 'Fees', v: esc(feeSummary(ch)) }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' },
          { key: 'products', label: 'Products' },
          { key: 'activity', label: 'Activity' }
        ], 'ov');

        // ── Overview — shape + fee profile + contact + notes (read-only) ──
        var shape = UI.kv([
          { k: 'Route', v: esc((ROUTE_LABEL[chRoute(ch)] || chRoute(ch)) || '—') },
          { k: 'Platform', v: esc(platformLabel(ch)) },
          { k: 'Uses tier', v: esc(chUsesTier(ch)) },
          { k: 'Ownership', v: esc(ch.ownershipModel || '—') },
          { k: 'Pricing', v: esc(ch.pricingModel || '—') },
          { k: 'Inventory', v: esc(ch.inventoryModel || '—') }
        ]);
        var fees = UI.kv([
          { k: 'Summary', v: esc(feeSummary(ch)) },
          { k: 'Percent fee', v: ch.percentFee ? (parseFloat(ch.percentFee).toFixed(1) + '%') : '—' },
          { k: 'Per-order fee', v: ch.fixedFeePerOrderCents ? (N.money(ch.fixedFeePerOrderCents, { cents: true }) || '$0.00') : '—' },
          { k: 'Monthly fee', v: ch.monthlyFixedCents ? (N.money(ch.monthlyFixedCents, { cents: true }) || '$0.00') : '—' }
        ]);
        var hasContact = ch.contactName || ch.contactEmail || ch.contactPhone;
        var contact = UI.kv([
          { k: 'Name', v: ch.contactName ? esc(ch.contactName) : '—' },
          { k: 'Email', v: ch.contactEmail ? '<a href="mailto:' + esc(ch.contactEmail) + '" style="color:var(--teal,teal);">' + esc(ch.contactEmail) + '</a>' : '—' },
          { k: 'Phone', v: ch.contactPhone ? '<a href="tel:' + esc(ch.contactPhone) + '" style="color:var(--teal,teal);">' + esc(ch.contactPhone) + '</a>' : '—' }
        ]);
        var notesText = ch.relationshipNotes || ch.notes || '';
        var notesCard = notesText
          ? UI.card('Notes', '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(notesText) + '</div>')
          : '';
        var termsCard = ch.contractTerms
          ? UI.card('Contract terms', '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(ch.contractTerms) + '</div>')
          : '';
        // Connect / disconnect / settings / the onboarding wizard all stay on
        // legacy #channels. navigateToClassic so the V2 route remap doesn't loop
        // back to this twin.
        var manage = '<div style="margin-top:14px;"><button class="btn btn-secondary" onclick="ChannelsV2.classic()">Manage / connect in classic view →</button></div>';

        // ── Products facet — bound in-memory related collection ──
        var prods = productsForChannel(ch.channelId).sort(function (a, b) {
          return String(a.name || '').localeCompare(String(b.name || ''));
        });
        var prodCols = [
          { label: 'Product', render: function (p) {
              var label = p.name || p.pid || p.id || '—';
              var id = p._key || p.pid || p.id;
              return id ? MastEntity.drillLink('products-v2', id, label) : esc(label);
            } },
          { label: 'Price', align: 'right', render: function (p) { return p.priceCents ? (N.money(p.priceCents, { cents: true }) || '$0.00') : '—'; } },
          { label: 'Status', render: function (p) {
              var st = p.status || 'active';
              var tone = st === 'active' ? 'success' : st === 'draft' ? 'amber' : 'neutral';
              return UI.badge(st, tone);
            } }
        ];
        var prodBody = prods.length
          ? UI.relatedTable(prodCols, prods)
          : '<span class="mu-sub">No products on this channel. Assign products in the classic Channels view.</span>';

        // ── Activity facet — recent orders attributed to this channel ──
        var orders = ordersForChannel(ch).slice(0, 50);
        var ordCols = [
          { label: 'Date', render: function (o) { return '<span class="mu-sub">' + (o.createdAt ? esc(N.date(o.createdAt)) : '—') + '</span>'; } },
          { label: 'Order', render: function (o) { return esc(o.orderId || o.id || o._key || '—'); } },
          { label: 'Total', align: 'right', render: function (o) {
              var v = N.moneyVal(o, 'totalCents', 'total');
              return v == null ? '—' : (N.money(v) || '$0.00');
            } },
          { label: 'Status', render: function (o) { return UI.badge(o.status || '—', 'neutral'); } }
        ];
        var actBody = orders.length
          ? UI.relatedTable(ordCols, orders)
          : '<span class="mu-sub">No orders attributed to this channel yet. Orders match via autoMatchSources or channelId.</span>';

        var ovInner = UI.card('Channel shape', shape) + UI.card('Fee profile', fees);
        if (hasContact) ovInner += UI.card('Contact', contact);
        ovInner += notesCard + termsCard + UI.card('Manage', manage);

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + ovInner + '</div>' +
          '<div class="mu-pane" data-pane="products" hidden>' + UI.cardTable('Products (' + prods.length + ')', prodBody) + '</div>' +
          '<div class="mu-pane" data-pane="activity" hidden>' + UI.cardTable('Recent activity', actBody) + '</div>';
      }
    }
    // No onSave → no Edit button (connect/disconnect/settings/wizard stay on legacy #channels).
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, products: {}, orders: {}, sortKey: 'name', sortDir: 'asc', q: '', typeFilter: '', allowed: true, loaded: false };

  function load() {
    // Channels + products are one-shot keyed-object reads (mirror channels.js:
    // admin/channels, public/products). Orders is the only growth surface —
    // bound with limitToLast. No persistent listeners.
    Promise.all([
      Promise.resolve(MastDB.get('admin/channels')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/products')).catch(function () { return null; }),
      MastDB.query('public/orders').orderByChild('createdAt').limitToLast(ORDERS_LIMIT).once('value')
        .then(function (snap) { return (snap && typeof snap.val === 'function') ? snap.val() : snap; })
        .catch(function () { return null; })
    ]).then(function (res) {
      var cv = res[0] || {};
      var out = [];
      Object.keys(cv).forEach(function (k) {
        var ch = cv[k];
        if (ch && typeof ch === 'object') {
          if (!ch.channelId) ch = Object.assign({ channelId: k }, ch);
          out.push(ch);
        }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.channelId] = r; });
      // Cap the product map defensively so a runaway catalog can't unbound the
      // in-memory facet computations (the read itself is keyed-object, bounded).
      var pv = res[1] || {}; var pkeys = Object.keys(pv).slice(0, PRODUCTS_LIMIT);
      V2.products = {}; pkeys.forEach(function (k) { V2.products[k] = pv[k]; });
      V2.orders = res[2] || {};
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[channels-v2] load', e); render(); });
  }

  function visibleRows() {
    var rows = V2.rows;
    if (V2.typeFilter) rows = rows.filter(function (ch) { return chType(ch) === V2.typeFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (ch) {
        return String(ch.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(platformLabel(ch)).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('channels-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('channelsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'channelsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.allowed) {
      tab.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--warm-gray);">' +
        '<div style="font-size:1.15rem;font-weight:600;margin-bottom:6px;">Channels access restricted</div>' +
        '<div style="font-size:0.9rem;">You don\'t have permission to view sales channels.</div></div>';
      return;
    }
    var active = V2.rows.filter(function (ch) { return ch.isActive !== false; }).length;
    var typeKeys = [''].concat(Object.keys(TYPE_LABEL));
    var filters = typeKeys.map(function (t) {
      var on = V2.typeFilter === t;
      var label = t === '' ? 'All types' : TYPE_LABEL[t];
      return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="ChannelsV2.filter(\'' + esc(t) + '\')">' + esc(label) + '</button>';
    }).join(' ');

    tab.innerHTML =
      U.pageHeader({
        title: 'Channels',
        count: N.count(active) + ' active · ' + N.count(V2.rows.length) + ' total',
        actionsHtml:
          '<button class="btn btn-secondary" onclick="ChannelsV2.classic()">Manage / connect in classic view →</button>' +
          '<button class="btn btn-secondary" onclick="ChannelsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name or platform…" value="' + esc(V2.q) +
        '" oninput="ChannelsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('channels-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ChannelsV2.sort', onRowClickFnName: 'ChannelsV2.open',
        empty: { title: 'No channels', message: V2.loaded ? 'Set up sales channels in the classic Channels view.' : 'Loading…' }
      });
  }

  window.ChannelsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'products' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (t) { V2.typeFilter = t || ''; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('channels-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('channels-v2', rec, 'read');
      });
    },
    // Connect/disconnect, the onboarding wizard and settings edits stay on
    // legacy #channels. navigateToClassic bypasses the V2 route remap so this
    // reaches LEGACY even when V2 routes are active.
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('channels');
      else if (typeof navigateTo === 'function') navigateTo('channels');
    },
    exportCsv: function () { return MastEntity.exportRows('channels-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('channels-v2', {
    routes: { 'channels-v2': { tab: 'channelsV2Tab', setup: function () {
      ensureTab();
      V2.allowed = canViewChannels();
      render();
      if (V2.allowed) load();
    } } }
  });
})();
