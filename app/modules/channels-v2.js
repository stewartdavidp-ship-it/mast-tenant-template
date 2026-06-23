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
  function canEditChannels() { return typeof window.can === 'function' ? window.can('channels', 'edit') : true; }
  function canDeleteChannels() { return typeof window.can === 'function' ? window.can('channels', 'delete') : true; }

  // Bound reads (lint-unbounded-read). Channels + products are keyed-object
  // reads; orders is the only growth surface, capped via limitToLast.
  var ORDERS_LIMIT = 200;
  var PRODUCTS_LIMIT = 500;

  // Platforms with an OAuth integration record under
  // admin/businessEntity/channels/{platform} that can be disconnected/revoked
  // server-side (mirrors ChannelsBridge.OAUTH_PLATFORMS / CHANNEL_PLATFORMS).
  var OAUTH_PLATFORMS = ['shopify', 'etsy', 'square'];

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
        // Classic burn-down Wave C: connect/reconnect is native (the OAuth legs
        // live in the per-platform CFs; this just starts the flow).
        var platf = (window.MastChannelShim && MastChannelShim.getPlatform) ? MastChannelShim.getPlatform(ch) : (ch.platform || null);
        var isOAuthPlatform = !!platf && OAUTH_PLATFORMS.indexOf(platf) !== -1;
        var platTitle = platf ? (platf.charAt(0).toUpperCase() + platf.slice(1)) : '';
        var manageBtns = [];
        if (platf && platf !== 'manual' && canEditChannels()) {
          manageBtns.push('<button class="btn btn-secondary" onclick="ChannelsV2.connect(\'' + esc(platf) + '\',\'' + esc(ch.channelId) + '\')">Connect / reconnect ' + esc(platTitle) + ' →</button>');
        }
        // Disconnect / revoke a platform OAuth — only for Shopify/Etsy/Square,
        // where a businessEntity/channels/{platform} integration record exists.
        // Routes through disconnectChannelCallable (token revoke + credential
        // cleanup + webhook removal + Firestore flip + server-side audit).
        if (isOAuthPlatform && canEditChannels()) {
          manageBtns.push('<button class="btn btn-secondary" onclick="ChannelsV2.disconnect(\'' + esc(platf) + '\',\'' + esc(ch.channelId) + '\')" style="color:var(--text-danger);">Disconnect ' + esc(platTitle) + '</button>');
        }
        // Delete the sales channel — plain admin write (no product cascade).
        if (canDeleteChannels()) {
          manageBtns.push('<button class="btn btn-secondary" onclick="ChannelsV2.deleteChannel(\'' + esc(ch.channelId) + '\')" style="color:var(--text-danger);">Delete channel</button>');
        }
        var manage = manageBtns.length
          ? '<div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap;">' + manageBtns.join('') + '</div>'
          : '<span class="mu-sub">No management actions available for your role.</span>';

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
        var addProdBtn = canEditChannels()
          ? '<div style="margin-bottom:10px;"><button class="btn btn-secondary btn-small" onclick="ChannelsV2.addProducts(\'' + esc(ch.channelId) + '\')">+ Add products</button></div>'
          : '';
        var prodBody = addProdBtn + (prods.length
          ? UI.relatedTable(prodCols.concat(canEditChannels() ? [{ label: '', render: function (p) {
              var pid = p._key || p.pid || p.id;
              return pid ? '<button class="btn-link" onclick="event.stopPropagation();ChannelsV2.removeProduct(\'' + esc(ch.channelId) + '\',\'' + esc(String(pid)) + '\')" style="color:var(--text-danger);background:none;border:none;cursor:pointer;font-size:0.78rem;">remove</button>' : '';
            } }] : []), prods)
          : '<span class="mu-sub">No products on this channel yet.</span>');

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

        // ── Cross-links (operations W3): listings to match + open audit
        // findings for THIS channel. Placeholder div + async fill — the counts
        // come from collections this module doesn't otherwise load.
        var health = '<div id="chV2Health" class="mu-sub">Checking listings &amp; findings…</div>';
        setTimeout(function () { fillHealth(ch); }, 0);

        var ovInner = UI.card('Channel shape', shape) + UI.card('Fee profile', fees);
        if (hasContact) ovInner += UI.card('Contact', contact);
        ovInner += notesCard + termsCard + UI.card('Listings & findings', health) + UI.card('Manage', manage);

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + ovInner + '</div>' +
          '<div class="mu-pane" data-pane="products" hidden>' + UI.cardTable('Products (' + prods.length + ')', prodBody) + '</div>' +
          '<div class="mu-pane" data-pane="activity" hidden>' + UI.cardTable('Recent activity', actBody) + '</div>';
      },
      // Light edit (operations W3): name / fees / contact / notes via
      // ChannelsBridge (the same field-scoped update legacy Settings uses).
      // Route/platform/type + connect/disconnect stay on legacy — changing
      // them runs deriveLegacyType and the OAuth wizard there.
      editRender: function (ch, mode) {
        ch = ch || {};
        function fg(label, inner) { return '<div class="form-group"><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function shimSel(id, map, cur, labelKey) {
          var opts = Object.keys(map || {}).map(function (k) {
            var lbl = (map[k] && (map[k][labelKey] || map[k].label)) || k;
            return '<option value="' + esc(k) + '"' + (cur === k ? ' selected' : '') + '>' + esc(lbl) + '</option>';
          }).join('');
          return '<select class="form-input" id="' + id + '" style="width:100%;">' + opts + '</select>';
        }
        // Fall back to the module-local label maps when the bridge hasn't
        // loaded yet (create() preloads channels.js, but it's async).
        function labelMap(obj) { var m = {}; Object.keys(obj).forEach(function (k) { m[k] = { label: obj[k] }; }); return m; }
        var B = window.ChannelsBridge || { ROUTES: labelMap(ROUTE_LABEL), PLATFORMS: labelMap(PLATFORM_LABEL) };
        var curRoute = (window.MastChannelShim && MastChannelShim.getRoute) ? MastChannelShim.getRoute(ch) : ch.route;
        var curPlatform = (window.MastChannelShim && MastChannelShim.getPlatform) ? MastChannelShim.getPlatform(ch) : ch.platform;
        var tierSel = '<select class="form-input" id="chV2Tier" style="width:100%;">' + ['retail', 'wholesale'].map(function (t) {
          return '<option value="' + t + '"' + ((ch.usesTier || 'retail') === t ? ' selected' : '') + '>' + t + '</option>';
        }).join('') + '</select>';
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New channel' : 'Edit this channel') + '</div>' +
          fg('Name *', '<input class="form-input" id="chV2Name" value="' + esc(ch.name || '') + '" style="width:100%;">') +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
          fg('Route *', shimSel('chV2Route', B.ROUTES, curRoute, 'label')) +
          fg('Platform *', shimSel('chV2Platform', B.PLATFORMS, curPlatform, 'label')) +
          fg('Uses tier', tierSel) +
          '</div>' +
          (mode === 'create' ? fg('Platform account id', '<input class="form-input" id="chV2Account" value="" style="width:100%;" placeholder="e.g. mystore (optional)">') : '') +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
          fg('Percent fee (%)', '<input class="form-input" type="number" step="0.1" id="chV2Pct" value="' + (ch.percentFee != null ? ch.percentFee : '') + '" style="width:130px;">') +
          fg('Per-order fee (¢)', '<input class="form-input" type="number" id="chV2PerOrder" value="' + (ch.fixedFeePerOrderCents != null ? ch.fixedFeePerOrderCents : '') + '" style="width:130px;">') +
          fg('Monthly fee (¢)', '<input class="form-input" type="number" id="chV2Monthly" value="' + (ch.monthlyFixedCents != null ? ch.monthlyFixedCents : '') + '" style="width:130px;">') +
          '</div>' +
          fg('Contact name', '<input class="form-input" id="chV2CName" value="' + esc(ch.contactName || '') + '" style="width:100%;">') +
          fg('Contact email', '<input class="form-input" id="chV2CEmail" value="' + esc(ch.contactEmail || '') + '" style="width:100%;">') +
          fg('Contact phone', '<input class="form-input" id="chV2CPhone" value="' + esc(ch.contactPhone || '') + '" style="width:100%;">') +
          fg('Notes', '<textarea class="form-input" id="chV2Notes" rows="3" style="width:100%;resize:vertical;">' + esc(ch.notes || '') + '</textarea>') +
          '<div class="mu-sub">Changing route/platform keeps the legacy type enum consistent automatically.</div>';
      }
    },
    onSave: function (rec) {
      if (typeof window.can === 'function' && !window.can('channels', 'edit')) {
        if (window.showToast) showToast('You don’t have permission to edit channels', true); return false;
      }
      if (!window.ChannelsBridge) { if (window.showToast) showToast('Channels engine still loading — try again', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || ''); }
      var name = val('chV2Name').trim();
      if (!name) { if (window.showToast) showToast('Channel name is required', true); return false; }
      var updates = {
        name: name,
        route: val('chV2Route') || null,
        platform: val('chV2Platform') || null,
        usesTier: val('chV2Tier') || 'retail',
        percentFee: parseFloat(val('chV2Pct')) || 0,
        fixedFeePerOrderCents: parseInt(val('chV2PerOrder'), 10) || 0,
        monthlyFixedCents: parseInt(val('chV2Monthly'), 10) || 0,
        contactName: val('chV2CName').trim() || null,
        contactEmail: val('chV2CEmail').trim() || null,
        contactPhone: val('chV2CPhone').trim() || null,
        notes: val('chV2Notes').trim() || null,
        updatedAt: new Date().toISOString()
      };
      if (arguments.length > 1 && arguments[1] === 'create') {
        // Classic burn-down Wave C: native create over ChannelsBridge.createChannel.
        return Promise.resolve(window.ChannelsBridge.createChannel({
          name: name,
          route: updates.route, platform: updates.platform, usesTier: updates.usesTier,
          platformAccountId: val('chV2Account'),
          percentFee: updates.percentFee, fixedFeePerOrderCents: updates.fixedFeePerOrderCents,
          monthlyFixedCents: updates.monthlyFixedCents,
          contactName: updates.contactName, contactEmail: updates.contactEmail,
          contactPhone: updates.contactPhone, notes: updates.notes
        })).then(function (newId) {
          if (window.writeAudit) writeAudit('create', 'channels', newId);
          if (window.showToast) showToast('Channel created');
          load(); return true;
        }).catch(function (e) {
          console.error('[channels-v2] create', e);
          if (window.showToast) showToast(e && e.message || 'Error creating channel', true);
          return false;
        });
      }
      var id = rec.channelId;
      return Promise.resolve(window.ChannelsBridge.updateChannel(id, updates)).then(function () {
        if (window.writeAudit) writeAudit('update', 'channels', id);
        Object.assign(V2.byId[id] || rec, updates);
        if (window.showToast) showToast('Channel updated');
        load(); return true;
      }).catch(function (e) {
        console.error('[channels-v2] save', e);
        if (window.showToast) showToast('Error saving: ' + (e && e.message || e), true);
        return false;
      });
    }
  });

  // Async fill for the Listings & findings card: unmatched listings (no
  // product_listing_map row, not ignored) + open audit findings touching this
  // channel's platform. Counts link into the mapping/audit V2 queues.
  function fillHealth(ch) {
    var platform = (window.MastChannelShim && MastChannelShim.getPlatform) ? MastChannelShim.getPlatform(ch) : (ch.platform || null);
    var el = function () { return document.getElementById('chV2Health'); };
    if (!platform) { var e0 = el(); if (e0) e0.innerHTML = '<span class="mu-sub">Not a synced platform channel — no listings to match.</span>'; return; }
    Promise.all([
      Promise.resolve(MastDB.get('channel_listings')).catch(function () { return {}; }),
      Promise.resolve(MastDB.get('product_listing_map')).catch(function () { return {}; }),
      Promise.resolve(MastDB.get('audit_results')).catch(function () { return {}; })
    ]).then(function (res) {
      var e = el(); if (!e) return;   // SO closed or re-rendered
      var maps = res[1] || {};
      var unmatched = 0;
      Object.keys(res[0] || {}).forEach(function (k) {
        var L = res[0][k];
        if (L && L._channel === platform && !L._ignored && !maps[k]) unmatched++;
      });
      var findings = 0;
      Object.keys(res[2] || {}).forEach(function (k) {
        var v = res[2][k]; if (!v || (v.state || 'active') !== 'active') return;
        var chs = Array.isArray(v.channels) ? v.channels : (v.channel ? [v.channel] : []);
        if (chs.indexOf(platform) !== -1) findings++;
      });
      e.innerHTML =
        '<div style="display:flex;gap:18px;flex-wrap:wrap;font-size:0.9rem;">' +
        '<span>' + (unmatched
          ? '<button type="button" class="mu-link" onclick="navigateTo(\'mapping\')">' + MastFormat.countNoun(unmatched, 'listing') + ' to match →</button>'
          : '✓ All listings matched') + '</span>' +
        '<span>' + (findings
          ? '<button type="button" class="mu-link" onclick="navigateTo(\'audit\')">' + MastFormat.countNoun(findings, 'open finding') + ' →</button>'
          : '✓ No open findings') + '</span>' +
        '</div>';
    });
  }

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, products: {}, orders: {}, sortKey: 'name', sortDir: 'asc', q: '', typeFilter: '', allowed: true, loaded: false };

  // Keep window.__mastChannelsCache populated + identity-stable for the
  // product-editor / drift / variant-detail consumers (the retired channels.js
  // used to refresh it on #channels visits). Mutate IN PLACE so the absorbed
  // ChannelsBridge's aliased reference (second IIFE) stays on the same object.
  function syncChannelsCache(cv) {
    var cache = window.__mastChannelsCache;
    if (!cache || typeof cache !== 'object') { window.__mastChannelsCache = cache = {}; }
    Object.keys(cache).forEach(function (k) { delete cache[k]; });
    Object.keys(cv || {}).forEach(function (k) { cache[k] = cv[k]; });
  }

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
      syncChannelsCache(cv);
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
          (canEditChannels() ? '<button class="btn btn-primary" onclick="ChannelsV2.create()">+ New channel</button>' : '') +
          '<button class="btn btn-secondary" onclick="ChannelsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name or platform…" value="' + esc(V2.q) +
        '" oninput="ChannelsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('channels-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'ChannelsV2.sort', onRowClickFnName: 'ChannelsV2.open',
        empty: { title: 'No channels', message: V2.loaded ? 'Add your first sales channel to get started.' : 'Loading…' }
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
    // ── Classic burn-down Wave C: native create / connect / product assign ──
    create: function () {
      if (!canEditChannels()) { if (window.showToast) showToast('You don\u2019t have permission to add channels', true); return; }
      // ChannelsBridge now lives in this file's second IIFE (T6 retire of
      // channels.js) \u2014 it's defined at module load, so no preload is needed.
      MastEntity.openRecord('channels-v2', {}, 'create');
    },
    connect: function (platform, channelId) {
      withBridge(function (b) {
        if (!b.connect(platform, channelId)) {
          if (window.showToast) showToast('Connect flow unavailable — try again shortly', true);
        }
      });
    },
    addProducts: function (channelId) {
      withBridge(function () {
        var onChannel = {};
        productsForChannel(channelId).forEach(function (p) { onChannel[p._key || p.pid || p.id] = true; });
        var candidates = Object.keys(V2.products).filter(function (pid) { return !onChannel[pid]; });
        if (!candidates.length) { if (window.showToast) showToast('Every product is already on this channel'); return; }
        var rows = candidates.map(function (pid) {
          var p = V2.products[pid] || {};
          return '<label style="display:flex;align-items:center;gap:8px;padding:4px 2px;font-size:0.85rem;cursor:pointer;">' +
            '<input type="checkbox" class="chV2AddCb" value="' + esc(pid) + '"> ' + esc(p.name || pid) + '</label>';
        }).join('');
        openModal(
          '<div class="modal-header"><h3>Add products to channel</h3>' +
            '<button class="modal-close" onclick="closeModal()">&times;</button></div>' +
          '<div class="modal-body" style="max-height:50vh;overflow-y:auto;">' + rows + '</div>' +
          '<div class="modal-footer">' +
            '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
            '<button class="btn btn-primary" data-ch="' + esc(channelId) + '" onclick="ChannelsV2.addProductsGo(this.dataset.ch)">Add selected</button>' +
          '</div>');
      });
    },
    addProductsGo: function (channelId) {
      var pids = [];
      document.querySelectorAll('.chV2AddCb:checked').forEach(function (cb) { pids.push(cb.value); });
      if (!pids.length) { if (window.showToast) showToast('Select at least one product', true); return; }
      withBridge(function (b) {
        Promise.resolve(b.addProducts(channelId, pids)).then(function (res) {
          if (typeof closeModal === 'function') closeModal();
          if (window.writeAudit) writeAudit('update', 'channels', channelId);
          if (window.showToast) showToast((res.added || 0) + ' ' + MastFormat.plural(res.added, 'product') + ' added');
          reopenAfterLoad(channelId);
        }).catch(function (e) {
          if (window.showToast) showToast('Could not add products: ' + (e && e.message || e), true);
        });
      });
    },
    removeProduct: function (channelId, pid) {
      withBridge(function (b) {
        mastConfirm('Remove this product from the channel? (The product itself is not deleted.)', { title: 'Remove product', confirmLabel: 'Remove' })
          .then(function (ok) {
            if (!ok) return;
            return Promise.resolve(b.removeProduct(channelId, pid)).then(function () {
              if (window.writeAudit) writeAudit('update', 'channels', channelId);
              if (window.showToast) showToast('Removed from channel');
              reopenAfterLoad(channelId);
            });
          }).catch(function (e) {
            if (window.showToast) showToast('Could not remove: ' + (e && e.message || e), true);
          });
      });
    },
    // Delete a sales channel — gated can('channels','delete'), danger confirm,
    // single-sourced through ChannelsBridge.deleteChannel (the legacy doDelete
    // core: plain admin/channels remove, no product-binding cascade).
    deleteChannel: function (channelId) {
      if (!canDeleteChannels()) { if (window.showToast) showToast('You don’t have permission to delete channels', true); return; }
      var rec = V2.byId[channelId] || {};
      withBridge(function (b) {
        if (typeof b.deleteChannel !== 'function') { if (window.showToast) showToast('Channels engine still loading — try again', true); return; }
        mastConfirm('Delete "' + (rec.name || 'this channel') + '"? This cannot be undone. Products stay in your catalog but will no longer be on this channel.', {
          title: 'Delete channel', confirmLabel: 'Delete', cancelLabel: 'Keep', danger: true
        }).then(function (ok) {
          if (!ok) return;
          return Promise.resolve(b.deleteChannel(channelId)).then(function () {
            if (window.writeAudit) writeAudit('delete', 'channels', channelId);
            if (window.showToast) showToast('Channel deleted');
            try { U.slideOut.requestCloseForce(); } catch (e) {}
            load();
          });
        }).catch(function (e) {
          if (window.showToast) showToast('Could not delete: ' + (e && e.message || e), true);
        });
      });
    },
    // Disconnect / revoke a platform OAuth — gated can('channels','edit'),
    // danger confirm, single-sourced through ChannelsBridge.disconnectPlatform
    // (the disconnectChannelCallable CF: token revoke + credential cleanup +
    // webhook removal + Firestore flip + server-side audit). Keyed by PLATFORM.
    disconnect: function (platform, channelId) {
      if (!canEditChannels()) { if (window.showToast) showToast('You don’t have permission to disconnect channels', true); return; }
      if (OAUTH_PLATFORMS.indexOf(platform) === -1) { if (window.showToast) showToast('This channel has no platform integration to disconnect', true); return; }
      var label = platform.charAt(0).toUpperCase() + platform.slice(1);
      withBridge(function (b) {
        if (typeof b.disconnectPlatform !== 'function') { if (window.showToast) showToast('Channels engine still loading — try again', true); return; }
        mastConfirm('Disconnect ' + label + '? Tokens will be revoked, stored credentials deleted, and webhook subscriptions removed. You can reconnect later.', {
          title: 'Disconnect ' + label, confirmLabel: 'Disconnect', cancelLabel: 'Cancel', danger: true
        }).then(function (ok) {
          if (!ok) return;
          if (window.showToast) showToast('Disconnecting ' + label + '…');
          return Promise.resolve(b.disconnectPlatform(platform)).then(function (data) {
            // Server CF owns the integration-record flip + audit; we audit the
            // admin-initiated action locally too (mirrors other V2 write paths).
            if (window.writeAudit) writeAudit('disconnect', 'channels', channelId || platform);
            var msg = label + ' disconnected.';
            if (data && data.platformRevokeStatus === 'revoke-best-effort') {
              msg += ' Platform revoke was best-effort — the Mast app may still appear in your ' + label + ' admin until you remove it there.';
            }
            if (window.showToast) showToast(msg);
            reopenAfterLoad(channelId);
          });
        }).catch(function (e) {
          if (window.showToast) showToast('Disconnect failed: ' + (e && e.message || e), true);
        });
      });
    },
    exportCsv: function () { return MastEntity.exportRows('channels-v2', visibleRows(), 'all'); }
  };

  // Bridge gate + post-write SO refresh (mirror contacts-v2 Wave A).
  // ChannelsBridge is defined in this file's second IIFE (absorbed from the
  // retired channels.js), so it's always present after module load.
  function withBridge(fn) {
    if (window.ChannelsBridge) return fn(window.ChannelsBridge);
    if (window.showToast) showToast('Channels engine unavailable', true);
  }
  function reopenAfterLoad(channelId) {
    Promise.all([
      Promise.resolve(MastDB.get('admin/channels')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/products')).catch(function () { return null; })
    ]).then(function (res) {
      var cv = res[0] || {};
      syncChannelsCache(cv);
      var out = [];
      Object.keys(cv).forEach(function (k) {
        var ch = cv[k];
        if (ch && typeof ch === 'object') { if (!ch.channelId) ch = Object.assign({ channelId: k }, ch); out.push(ch); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r.channelId] = r; });
      var pv = res[1] || {}; var pkeys = Object.keys(pv).slice(0, PRODUCTS_LIMIT);
      V2.products = {}; pkeys.forEach(function (k) { V2.products[k] = pv[k]; });
      render();
      var rec = V2.byId[channelId];
      if (rec) MastEntity.openRecord('channels-v2', rec, 'read', true);
    });
  }

  function channelsSetup() {
    ensureTab();
    V2.allowed = canViewChannels();
    render();
    if (V2.allowed) load();
  }
  MastAdmin.registerModule('channels-v2', {
    routes: {
      'channels-v2': { tab: 'channelsV2Tab', setup: channelsSetup },
      // Legacy #channels route ABSORBED (T6): channels.js is deleted, so the
      // twin owns the bare route directly (no MAST_V2_ROUTE_MAP remap). The
      // shared channelsV2Tab + setup keep it flag-independent for all users.
      'channels': { tab: 'channelsV2Tab', setup: channelsSetup }
    }
  });
})();

// ════════════════════════════════════════════════════════════════════════
// ChannelsBridge + MastChannelShim — ABSORBED VERBATIM from the retired
// channels.js (T6 V1 retirement). These are state-free write cores + shim
// accessors consumed flag-independently by other surfaces:
//   • window.MastChannelShim    — index.html _shimRoute/_shimPlatform/_shimType
//   • window.ChannelsBridge     — channels-v2's own create/edit/connect/delete
//   • window.channelReconnect   — audit.js reconnect action
//   • window.__mastChannelsCache — products-v2 / unified-drift-dialog /
//                                  variant-detail-tabs (product-editor cache)
// This IIFE is NOT flag-gated (the consumers run for legacy-UI users too).
// channelsData aliases window.__mastChannelsCache so the cache stays the single
// source of truth (the first IIFE's syncChannelsCache mutates it in place).
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.MastDB) return;

  // channelId → channel object. Aliased to the shared product-editor cache so
  // bridge create/delete mutations and the V2 list loader stay consistent.
  var channelsData = window.__mastChannelsCache || (window.__mastChannelsCache = {});

  var CHANNEL_TYPES = {
    dtc_online:       { label: 'Online Store',    color: '#3b82f6', ownership: 'owned',   pricing: 'full_retail',  inventory: 'retained' },
    own_storefront:   { label: 'Own Storefront',  color: '#14b8a6', ownership: 'owned',   pricing: 'full_retail',  inventory: 'retained' },
    mobile_events:    { label: 'Craft Fairs',     color: '#f97316', ownership: 'owned',   pricing: 'full_retail',  inventory: 'retained' },
    marketplace:      { label: 'Marketplace',     color: '#8b5cf6', ownership: 'partner', pricing: 'full_retail',  inventory: 'synced' },
    wholesale_prebuy: { label: 'Wholesale',       color: '#22c55e', ownership: 'partner', pricing: 'wholesale',    inventory: 'transferred' },
    consignment:      { label: 'Consignment',     color: '#f59e0b', ownership: 'partner', pricing: 'negotiated',   inventory: 'consigned' },
    retail_prebuy:    { label: 'Retail Prebuy',   color: '#10b981', ownership: 'partner', pricing: 'wholesale',    inventory: 'transferred' },
    social_live:      { label: 'Social / Live',   color: '#ec4899', ownership: 'partner', pricing: 'full_retail',  inventory: 'retained' }
  };

  var ROUTES = {
    dtc_online:   { label: 'Online (DTC)',  color: '#3b82f6', defaultUsesTier: 'retail',    desc: 'Your own e-commerce storefront.' },
    marketplace:  { label: 'Marketplace',   color: '#8b5cf6', defaultUsesTier: 'retail',    desc: 'Etsy, Amazon, third-party platform.' },
    in_person:    { label: 'In-Person',     color: '#f97316', defaultUsesTier: 'direct',    desc: 'Brick-and-mortar, craft fairs, pop-ups.' },
    wholesale:    { label: 'Wholesale',     color: '#22c55e', defaultUsesTier: 'wholesale', desc: 'Retailers, galleries, consignment.' }
  };

  var PLATFORMS = {
    manual:      { label: 'Manual / Mast' },
    shopify:     { label: 'Shopify' },
    etsy:        { label: 'Etsy' },
    square:      { label: 'Square' },
    squarespace: { label: 'Squarespace' },
    amazon:      { label: 'Amazon' },
    tiktok:      { label: 'TikTok' },
    instagram:   { label: 'Instagram' }
  };

  // Map legacy `type` → derived `(route, platform)`. Used by the shim when a
  // channel only carries the legacy field, and by the new form's preset chips.
  var TYPE_TO_ROUTE_PLATFORM = {
    dtc_online:       { route: 'dtc_online',  platform: 'manual' },
    own_storefront:   { route: 'in_person',   platform: 'manual' },
    mobile_events:    { route: 'in_person',   platform: 'square' },
    marketplace:      { route: 'marketplace', platform: 'etsy' },
    wholesale_prebuy: { route: 'wholesale',   platform: 'manual' },
    consignment:      { route: 'wholesale',   platform: 'manual' },
    retail_prebuy:    { route: 'wholesale',   platform: 'manual' },
    social_live:      { route: 'marketplace', platform: 'instagram' }
  };

  // Reverse derivation — when a channel has only the new fields, synthesize a
  // legacy `type` for backwards-compat readers (typeBadge, type-specific
  // overview cards). Keep the mapping conservative: only derive when we have
  // a confident answer; otherwise return null and the reader handles it.
  function deriveLegacyType(route, platform) {
    if (route === 'dtc_online') return 'dtc_online';
    if (route === 'marketplace') {
      if (platform === 'instagram' || platform === 'tiktok') return 'social_live';
      return 'marketplace';
    }
    if (route === 'in_person') {
      if (platform === 'square') return 'mobile_events';
      return 'own_storefront';
    }
    if (route === 'wholesale') return 'wholesale_prebuy';
    return null;
  }

  // Shim accessors — every reader of ch.type / ch.defaultPricingTier / etc.
  // should call these so unmigrated channels stay readable.
  function getChannelRoute(ch) {
    if (!ch) return null;
    if (ch.route) return ch.route;
    if (ch.type && TYPE_TO_ROUTE_PLATFORM[ch.type]) return TYPE_TO_ROUTE_PLATFORM[ch.type].route;
    return null;
  }
  function getChannelPlatform(ch) {
    if (!ch) return null;
    if (ch.platform) return ch.platform;
    if (ch.type && TYPE_TO_ROUTE_PLATFORM[ch.type]) return TYPE_TO_ROUTE_PLATFORM[ch.type].platform;
    return null;
  }
  function getChannelType(ch) {
    if (!ch) return null;
    if (ch.type) return ch.type; // legacy still authoritative when present
    return deriveLegacyType(ch.route, ch.platform);
  }
  function getChannelPlatformAccountId(ch) {
    if (!ch) return null;
    return ch.platformAccountId || null;
  }
  function getChannelUsesTier(ch) {
    if (!ch) return 'retail';
    if (ch.usesTier) return ch.usesTier;
    if (ch.defaultPricingTier) return ch.defaultPricingTier; // legacy fallback
    var route = getChannelRoute(ch);
    if (route && ROUTES[route]) return ROUTES[route].defaultUsesTier;
    return 'retail';
  }

  // Reconnect handler — routes to the per-platform OAuth start endpoint.
  // The actual OAuth flow lives in the per-platform CF (etsyOAuthStart,
  // shopifyOAuthStart, etc.); we just navigate there with the tenant context.
  // (channels.js retired: the V1 detail-tab fallback is gone, so when no OAuth
  // start hook is wired we route to the channels surface — same as audit.js's
  // own fallback.)
  window.channelReconnect = function(platform) {
    if (!platform) return;
    // Find the first channel for this platform so the OAuth start endpoint
    // can resume context (account binding, route, etc.).
    var ch = Object.values(channelsData).find(function(c) {
      return getChannelPlatform(c) === platform;
    });
    if (typeof window.startChannelOAuth === 'function') {
      window.startChannelOAuth(platform, ch && ch.channelId);
    } else if (typeof window.navigateTo === 'function') {
      window.navigateTo('channels');
    }
  };

  // Phase 2a (D23, D25) — expose shim accessors + metadata for product editor,
  // recipe handshake banner, and E2E verification.
  window.MastChannelShim = {
    ROUTES: ROUTES,
    PLATFORMS: PLATFORMS,
    TYPE_TO_ROUTE_PLATFORM: TYPE_TO_ROUTE_PLATFORM,
    deriveLegacyType: deriveLegacyType,
    getRoute: getChannelRoute,
    getPlatform: getChannelPlatform,
    getPlatformAccountId: getChannelPlatformAccountId,
    getType: getChannelType,
    getUsesTier: getChannelUsesTier
  };

  // V2 bridge — state-free write cores shared with channels-v2 (playbook §4 /
  // classic burn-down Wave C: the twin never re-implements a write).
  window.ChannelsBridge = {
    ROUTES: ROUTES,
    PLATFORMS: PLATFORMS,
    deriveLegacyType: deriveLegacyType,
    updateChannel: function(channelId, updates) {
      if (!channelId) return Promise.reject(new Error('channelId required'));
      // Keep the legacy `type` enum consistent when the new-shape pair changes
      // (same rule as the legacy Settings save).
      if (updates && updates.route && updates.platform) {
        var derived = deriveLegacyType(updates.route, updates.platform);
        if (derived) updates.type = derived;
      }
      return MastDB.update('admin/channels/' + channelId, updates);
    },
    // Create — the saveNew() core with explicit fields (both shapes written,
    // exactly like legacy; multi-channel-per-platform allowed w/ console.warn).
    createChannel: function(input) {
      input = input || {};
      var name = (input.name || '').trim();
      var route = input.route || '';
      var platform = input.platform || '';
      if (!name) return Promise.reject(new Error('Channel name is required.'));
      if (!route) return Promise.reject(new Error('Please pick a Route.'));
      if (!platform) return Promise.reject(new Error('Please pick a Platform.'));
      var sharing = Object.values(channelsData || {}).filter(function(other) {
        return getChannelPlatform(other) === platform;
      });
      if (sharing.length > 0) {
        console.warn('[channels] Multi-channel on platform "' + platform + '" — order attribution falls back to first match until Phase 3 webhook reverse-routing lands.');
      }
      var id = MastUtil.genId('ch_');
      var now = new Date().toISOString();
      var derivedType = deriveLegacyType(route, platform) || 'dtc_online';
      var t = CHANNEL_TYPES[derivedType] || {};
      var channel = {
        channelId: id,
        name: name,
        type: derivedType,
        ownershipModel: t.ownership || 'owned',
        pricingModel: t.pricing || 'full_retail',
        inventoryModel: t.inventory || 'retained',
        route: route,
        platform: platform,
        platformAccountId: (input.platformAccountId || '').trim() || null,
        usesTier: input.usesTier || (ROUTES[route] && ROUTES[route].defaultUsesTier) || 'retail',
        percentFee: parseFloat(input.percentFee) || 0,
        fixedFeePerOrderCents: parseInt(input.fixedFeePerOrderCents, 10) || 0,
        monthlyFixedCents: parseInt(input.monthlyFixedCents, 10) || 0,
        externalPlatform: (input.externalPlatform || '').trim() || null,
        defaultEligibility: input.defaultEligibility === 'opt-out' ? 'opt-out' : 'opt-in',
        contactName: (input.contactName || '').trim() || null,
        contactEmail: (input.contactEmail || '').trim() || null,
        contactPhone: (input.contactPhone || '').trim() || null,
        notes: (input.notes || '').trim() || null,
        autoMatchSources: [],
        isActive: true,
        createdAt: now,
        updatedAt: now
      };
      return MastDB.set('admin/channels/' + id, channel).then(function() {
        channelsData[id] = channel;
        window.__mastChannelsCache = channelsData; // Phase 2c — sync product-editor cache
        return id;
      });
    },
    // Product assignment — confirmAddProducts/removeProduct cores with a
    // FRESH product read (the module cache may be cold from the V2 twin).
    // Dual-writes channelBindings (new) + channelIds (legacy), same as legacy.
    addProducts: async function(channelId, pids) {
      if (!channelId || !Array.isArray(pids) || !pids.length) throw new Error('channelId + product ids required');
      var fresh = await MastDB.get('public/products') || {};
      var batch = {}, added = 0;
      pids.forEach(function(pid) {
        var p = fresh[pid];
        if (!p) return;
        var ids = Array.isArray(p.channelIds) ? p.channelIds.slice() : [];
        var bindings = Array.isArray(p.channelBindings) ? p.channelBindings.slice() : [];
        var alreadyBound = bindings.some(function(b) { return b && b.channelId === channelId; });
        if (!alreadyBound) { bindings.push({ channelId: channelId, excludedVariantIds: [] }); batch[pid + '/channelBindings'] = bindings; }
        if (ids.indexOf(channelId) === -1) { ids.push(channelId); batch[pid + '/channelIds'] = ids; }
        if (!alreadyBound) added++;
      });
      if (!added) return { added: 0 };
      await MastDB.update('public/products', batch);
      return { added: added };
    },
    removeProduct: async function(channelId, pid) {
      if (!channelId || !pid) throw new Error('channelId + product id required');
      var p = await MastDB.get('public/products/' + pid);
      if (!p) throw new Error('Product not found');
      var batch = {};
      batch[pid + '/channelIds'] = (Array.isArray(p.channelIds) ? p.channelIds : []).filter(function(id) { return id !== channelId; });
      batch[pid + '/channelBindings'] = (Array.isArray(p.channelBindings) ? p.channelBindings : []).filter(function(b) { return b && b.channelId !== channelId; });
      await MastDB.update('public/products', batch);
      return true;
    },
    // OAuth connect/reconnect — same per-platform start endpoint the legacy
    // banner uses (the OAuth legs live in the per-platform CFs).
    connect: function(platform, channelId) {
      if (typeof window.startChannelOAuth === 'function') { window.startChannelOAuth(platform, channelId || null); return true; }
      if (typeof window.channelReconnect === 'function') { window.channelReconnect(platform); return true; }
      return false;
    },
    // Delete a sales channel — the doDelete() core (plain admin write, no
    // product-binding cascade: legacy leaves channelIds/channelBindings on
    // products untouched, so a deleted channel's id simply stops matching).
    deleteChannel: function(channelId) {
      if (!channelId) return Promise.reject(new Error('channelId required'));
      return MastDB.remove('admin/channels/' + channelId).then(function() {
        if (channelsData && channelsData[channelId]) {
          delete channelsData[channelId];
          window.__mastChannelsCache = channelsData; // keep product-editor cache in sync
        }
        return true;
      });
    },
    // Platforms with an OAuth integration record under
    // admin/businessEntity/channels/{platform}. Only these can be disconnected.
    OAUTH_PLATFORMS: ['shopify', 'etsy', 'square'],
    // Disconnect / revoke a platform OAuth — single-sources the Settings>Channels
    // disconnectChannel() flow: the disconnectChannelCallable CF revokes the
    // platform token, deletes stored credentials (Secret Manager), removes webhook
    // subscriptions, flips the Firestore integration record, and audits server-side.
    // Keyed by PLATFORM (shopify/etsy/square), not by sales-channel id — one OAuth
    // record per platform. Returns the CF payload ({ platformRevokeStatus, ... }).
    disconnectPlatform: function(platform) {
      if (!platform) return Promise.reject(new Error('platform required'));
      if (this.OAUTH_PLATFORMS.indexOf(platform) === -1) {
        return Promise.reject(new Error('Not an OAuth platform: ' + platform));
      }
      if (typeof firebase === 'undefined' || !firebase.functions) {
        return Promise.reject(new Error('Cloud Functions unavailable'));
      }
      var tenantId = (typeof MastDB !== 'undefined' && typeof MastDB.tenantId === 'function') ? MastDB.tenantId() : null;
      if (!tenantId) return Promise.reject(new Error('Tenant not resolved'));
      var fn = firebase.functions().httpsCallable('disconnectChannelCallable');
      return fn({ tenantId: tenantId, platform: platform }).then(function(result) {
        return (result && result.data) || {};
      });
    }
  };
})();
