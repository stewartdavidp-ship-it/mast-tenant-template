/**
 * mast-ui.js — shared UI primitives v2 for the operator dashboard redesign.
 *
 * Phase 0b of the UI redesign (see docs/ux-audit/CONTROL-PLANE.md + 02/06–12).
 * Pure, additive, framework-free. Builds ON the existing shell globals:
 *   window.mastSlideOut (v1), MastDirty, MastOverlayNav, mastConfirm,
 *   mastSortRows, mastSortableTh, showToast.
 * Loaded eagerly via a <script> in index.html <head> (wired during integration).
 *
 * Exposes window.MastUI = { Num, badge, tabs, list, slideOut, deepLink }.
 *
 * Conventions: vanilla ES5-ish (var/IIFE), colors via CSS var(--…) tokens only
 * (no hex literals → dark/light safe), font sizes from the 7-value scale.
 */
(function () {
  'use strict';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ── HTML sanitizer (allow-list) ─────────────────────────────────────
  // Operator-authored rich text (contenteditable output) gets stored and later
  // injected RAW into emails + public web pages, so it must be sanitized at the
  // write boundary. Allow-list only: only these tags + per-tag attributes
  // survive; scripts, event handlers, unknown tags, unsafe URL schemes, styles,
  // comments — all stripped. In a browser we parse into an inert <template>
  // (whose content fragment never executes scripts or loads resources) and walk
  // the tree — the robust path. In a non-DOM context (node/SSR) we fall back to
  // escaping EVERYTHING (degrades to safe plain text — never emits raw markup).
  var SANITIZE_ALLOWED = {
    A: ['href', 'title'], B: [], STRONG: [], I: [], EM: [], U: [], BR: [],
    P: [], DIV: [], SPAN: [], H1: [], H2: [], H3: [], H4: [],
    UL: [], OL: [], LI: [], BLOCKQUOTE: [], HR: []
  };
  var SANITIZE_DROP = { SCRIPT: 1, STYLE: 1, IFRAME: 1, OBJECT: 1, EMBED: 1, NOSCRIPT: 1, TEMPLATE: 1, LINK: 1, META: 1, SVG: 1, MATH: 1, TITLE: 1, BASE: 1, FORM: 1, INPUT: 1, BUTTON: 1, TEXTAREA: 1, SELECT: 1, OPTION: 1 };
  // Returns a usable URL for an href, or '' if the scheme is unsafe. http(s),
  // mailto, tel and scheme-less (relative / anchor / query / protocol-relative)
  // are allowed; javascript:, data:, vbscript: and any other scheme are dropped.
  function safeUrl(u) {
    var s = String(u == null ? '' : u).trim();
    if (!s) return '';
    var probe = s.replace(/[\x00-\x20]+/g, '').toLowerCase(); // defeat "java\tscript:" tricks
    if (/^(https?:|mailto:|tel:)/.test(probe)) return s;
    if (/^[a-z][a-z0-9+.\-]*:/.test(probe)) return '';            // any other explicit scheme → unsafe
    return s;                                                       // relative / #anchor / ?query / //host
  }
  function sanitizeHtml(html) {
    html = String(html == null ? '' : html);
    if (!html) return '';
    if (typeof document === 'undefined' || !document.createElement) return esc(html);
    var tpl;
    try { tpl = document.createElement('template'); tpl.innerHTML = html; }
    catch (e) { return esc(html); }
    (function walk(node) {
      Array.prototype.slice.call(node.childNodes || []).forEach(function (child) {
        if (!child.parentNode) return;
        if (child.nodeType === 8) { child.parentNode.removeChild(child); return; } // comment
        if (child.nodeType !== 1) return;                                          // keep text (3)
        var tag = child.tagName;
        if (!Object.prototype.hasOwnProperty.call(SANITIZE_ALLOWED, tag)) {
          if (SANITIZE_DROP[tag]) { child.parentNode.removeChild(child); return; } // drop element + content
          walk(child);                                                             // sanitize subtree, then unwrap
          while (child.firstChild) child.parentNode.insertBefore(child.firstChild, child);
          child.parentNode.removeChild(child);
          return;
        }
        var allowed = SANITIZE_ALLOWED[tag];
        Array.prototype.slice.call(child.attributes || []).forEach(function (attr) {
          var name = attr.name.toLowerCase();
          if (allowed.indexOf(name) === -1) { child.removeAttribute(attr.name); return; }
          if (name === 'href') {
            var ok = safeUrl(attr.value);
            if (ok) child.setAttribute('href', ok); else child.removeAttribute(attr.name);
          }
        });
        if (tag === 'A' && child.getAttribute('href')) {
          child.setAttribute('rel', 'noopener noreferrer nofollow');
          child.setAttribute('target', '_blank');
        }
        walk(child);
      });
    })(tpl.content);
    return tpl.innerHTML;
  }

  // ── Number / money / date formatting ────────────────────────────────
  // Display = pretty (06-B7). Raw = canonical for files/export (13).
  var _nf0 = new Intl.NumberFormat('en-US');
  var _nf2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var Num = {
    // count: 1234 -> "1,234"
    count: function (n) { return (n == null || isNaN(n)) ? '' : _nf0.format(n); },
    // money display: (102000) -> "$102,000.00"; opts.cents:true treats input as integer cents
    money: function (n, opts) {
      if (n == null || isNaN(n)) return '';
      opts = opts || {};
      var v = opts.cents ? n / 100 : n;
      return '$' + _nf2.format(v);
    },
    // money raw for export: -> "102000.00" (no symbol/separators)
    moneyRaw: function (n, opts) {
      if (n == null || isNaN(n)) return '';
      var v = (opts && opts.cents) ? n / 100 : n;
      return v.toFixed(2);
    },
    // Canonical dollar amount from a record that stores EITHER integer cents
    // (centsField) OR a dollar number (dollarField). Cents wins when present +
    // numeric; else the dollar field; else null. The single money source of
    // truth for list + detail + export so cents- and dollar-denominated records
    // render identically (fixes the $0.00-in-detail P0: most real orders are
    // dollar-denominated and carry no *Cents fields).
    moneyVal: function (rec, centsField, dollarField) {
      if (!rec) return null;
      var c = centsField ? rec[centsField] : undefined;
      if (c != null && c !== '' && !isNaN(c)) return Number(c) / 100;
      var d = dollarField ? rec[dollarField] : undefined;
      if (d != null && d !== '' && !isNaN(d)) return Number(d);
      return null;
    },
    // Canonical LINE-ITEM total in DOLLARS — the client mirror of the server's
    // lineItemRevenueCents (order context), ÷100. A line item arrives in several
    // shapes that disagree on unit AND field name, so reading any single field
    // raw miscounts: `lineTotal` is CENTS already ×qty (MCP/createTestOrder), NOT
    // dollars — feeding it to moneyVal as a dollar fallback renders a $1,020 line
    // as "$102,000.00". Resolution (cents-explicit fields win):
    //   lineTotal (cents) → priceCents×qty (cents) → total (dollars) → price×qty
    //   (dollars, per-unit on an order line). qty = quantity ?? qty ?? 1.
    lineTotalVal: function (it) {
      if (!it) return null;
      var qty = (it.quantity != null && !isNaN(it.quantity)) ? Number(it.quantity)
        : (it.qty != null && !isNaN(it.qty)) ? Number(it.qty) : 1;
      if (it.lineTotal != null && it.lineTotal !== '' && !isNaN(it.lineTotal)) return Number(it.lineTotal) / 100;
      if (it.priceCents != null && it.priceCents !== '' && !isNaN(it.priceCents)) return Number(it.priceCents) * qty / 100;
      if (it.total != null && it.total !== '' && !isNaN(it.total)) return Number(it.total);
      if (it.price != null && it.price !== '' && !isNaN(it.price)) return Number(it.price) * qty;
      return null;
    },
    // Human-readable actor label from a stored `by` value (audit trails record
    // a Firebase UID, a system/automation token, or — newer writers — an already
    // human name/email). NEVER surface a raw internal UID to users:
    //   system/automation token → "Automatic"; the signed-in user → their name;
    //   an already-human value (has whitespace or "@") → itself; an opaque UID
    //   (no client-side directory to resolve it) → '' so the caller omits it.
    // Returns '' when there is nothing safe to show.
    actorName: function (by) {
      if (by == null) return '';
      var s = String(by).trim();
      if (!s) return '';
      var low = s.toLowerCase();
      if (low === 'mastflow' || low === 'system' || low === 'workflow' || low === 'automatic' ||
          low === 'cron' || low === 'scheduler' || low === 'webhook') return 'Automatic';
      var cu = (typeof window !== 'undefined') ? window.currentUser : null;
      if (cu && cu.uid && s === cu.uid) return cu.displayName || cu.email || 'You';
      if (/\s/.test(s) || s.indexOf('@') !== -1) return s; // already a name or email
      return ''; // opaque UID — no directory to resolve it; never leak the raw id
    },
    // date display: ISO/Date -> "May 1, 2026"; dateRaw -> "2026-05-01"
    date: function (d) {
      if (d == null || d === '') return '';   // null/empty → '' (not the Unix epoch "Dec 31, 1969")
      var dt, m;
      if (d instanceof Date) {
        dt = d;
      } else if (typeof d === 'string' && (m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ]00:00(?::00)?(?:\.000)?Z?)?$/.exec(d))) {
        // A bare calendar date ('2026-06-07') OR a date stored as midnight-UTC
        // ('2026-06-07T00:00:00.000Z' — e.g. a receipt's receivedAt) represents a
        // CALENDAR date. Build it as LOCAL midnight so it renders the same day in
        // behind-UTC timezones — fixes the PO order-date "Jun 6 → Jun 5" AND the
        // receipt/lot received-date off-by-one. Strings with a real time component
        // (e.g. order timestamps) fall through to native (local) parsing, unchanged.
        dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      } else {
        dt = new Date(d);
      }
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    },
    dateRaw: function (d) {
      if (d == null || d === '') return '';   // null/empty → '' (not the Unix epoch)
      var dt = (d instanceof Date) ? d : new Date(d);
      if (isNaN(dt.getTime())) return '';
      return dt.toISOString().slice(0, 10);
    }
  };

  // ── Badge (one refined soft-tint dot-badge; 11-B4 / 06-B8) ──────────
  // tone -> token. Sentence-case label. Both-mode safe via color-mix.
  var _toneVar = {
    amber: '--amber', teal: '--teal', danger: '--danger', success: '--success',
    warning: '--warning', info: '--info', neutral: '--warm-gray'
  };
  // Soft-tint dot-pill from a single resolved CSS color `c` (hex or var()). The
  // bg/border are derived from `c` via color-mix (both-mode safe). Shared by
  // badge() (tone-driven) and statusBadge() (registry-driven) so the two are
  // visually identical and the markup lives in exactly one place.
  function _badgeHtml(label, c) {
    var style =
      'display:inline-flex;align-items:center;gap:6px;font-size:0.72rem;font-weight:600;' +
      'padding:3px 10px;border-radius:999px;line-height:1.4;white-space:nowrap;' +
      'background:color-mix(in srgb,' + c + ' 16%,transparent);color:' + c + ';' +
      'border:1px solid color-mix(in srgb,' + c + ' 30%,transparent);';
    var dot = '<span style="width:6px;height:6px;border-radius:50%;background:' + c + ';flex:0 0 6px;"></span>';
    return '<span class="mast-badge" style="' + style + '">' + dot + esc(label) + '</span>';
  }
  function badge(label, tone) {
    var v = _toneVar[tone] || _toneVar.neutral;
    return _badgeHtml(label, 'var(' + v + ', var(--warm-gray))');
  }

  // ── Status badge — flat per-domain registry (Track 5; master plan §7 + §12.3) ──
  // ONE canonical status pill to replace ~55 hand-rolled badge markups + ~56
  // status→color/label maps scattered across modules. The registry is FLAT and
  // PER-DOMAIN — { domain: { status: { color, label } } } — because the same word
  // means different things in different domains (an "open" order ≠ an "open"
  // ticket), so a single global map would force false unification (§12.3).
  //
  // `color` is the TEXT color captured VERBATIM from each source map's `color:`
  // field (the hue carrier); the soft-tint bg/border are derived from it (same
  // construction as badge() above). We keep the literal hex rather than mapping
  // to this file's tone vocabulary ON PURPOSE: the captured hues are orange/
  // purple/blue/green/yellow, which have NO token in the palette, and the tones
  // success/warning/info are undefined in :root (they fall back to gray) — so
  // mapping to tones would SILENTLY ERASE the colors these badges show today.
  // `label` is captured AS DISPLAYED today; casing varies by domain (order/rma/
  // material render lowercase, ticket/invoice/product Title-Case) — faithful, not
  // polished, so adoption is a near-no-op. (shared/ is excluded from the
  // hardcoded-hex lint, so these literals are allowed here.)
  // BUILD-ONLY: no call site adopts this yet — adoption is a later per-module pass.
  var _statusRegistry = {
    // order — ORDER_STATUS_BADGE_COLORS (shared/orders-core.js); label = status.replace(/_/g,' ')
    order: {
      pending_payment:    { color: '#FFB74D', label: 'pending payment' },
      payment_failed:     { color: '#EF5350', label: 'payment failed' },
      placed:             { color: '#FFB74D', label: 'placed' },
      confirmed:          { color: '#64B5F6', label: 'confirmed' },
      building:           { color: '#CE93D8', label: 'building' },
      ready:              { color: '#4DB6AC', label: 'ready' },
      pack:               { color: '#4DB6AC', label: 'pack' },
      packing:            { color: '#FFD54F', label: 'packing' },
      packed:             { color: '#66BB6A', label: 'packed' },
      handed_to_carrier:  { color: '#B39DDB', label: 'handed to carrier' },
      shipped:            { color: '#7986CB', label: 'shipped' },
      delivered:          { color: '#66BB6A', label: 'delivered' },
      cancelled:          { color: '#EF5350', label: 'cancelled' },
      return_requested:   { color: '#FFB74D', label: 'return requested' },
      return_approved:    { color: '#FFB74D', label: 'return approved' },
      return_shipped:     { color: '#B39DDB', label: 'return shipped' },
      return_received:    { color: '#64B5F6', label: 'return received' },
      partially_returned: { color: '#FFB74D', label: 'partially returned' },
      refunded:           { color: '#EF5350', label: 'refunded' }
    },
    // invoice — invoiceStatusBadgeStyle map (shared/orders-core.js); source fallback = draft
    invoice: {
      draft:   { color: '#9ca3af', label: 'Draft' },
      sent:    { color: '#60a5fa', label: 'Sent' },
      paid:    { color: '#4ade80', label: 'Paid' },
      overdue: { color: '#f87171', label: 'Overdue' }
    },
    // rma — RMA_STATUS_BADGE_COLORS (app/modules/rma-admin.js); label = status.replace(/-/g,' ')
    rma: {
      requested:       { color: '#FFB74D', label: 'requested' },
      approved:        { color: '#64B5F6', label: 'approved' },
      'shipped-back':  { color: '#CE93D8', label: 'shipped back' },
      received:        { color: '#4DB6AC', label: 'received' },
      inspected:       { color: '#4DB6AC', label: 'inspected' },
      restocked:       { color: '#66BB6A', label: 'restocked' },
      seconds:         { color: '#FFB74D', label: 'seconds' },
      'repair-queued': { color: '#64B5F6', label: 'repair queued' },
      'written-off':   { color: '#BDBDBD', label: 'written off' },
      'refund-issued': { color: '#66BB6A', label: 'refund issued' },
      declined:        { color: '#EF5350', label: 'declined' }
    },
    // ticket (customer service) — STATUS_STYLES + STATUS_LABELS (app/modules/customer-service.js); source fallback = closed
    ticket: {
      open:        { color: '#64B5F6', label: 'Open' },
      in_progress: { color: '#FFD54F', label: 'In Progress' },
      waiting:     { color: '#CE93D8', label: 'Waiting' },
      resolved:    { color: '#4DB6AC', label: 'Resolved' },
      closed:      { color: '#9E9E9E', label: 'Closed' }
    },
    // product — productStatusBadgeHtml styles map (app/modules/maker.js); source fallback = draft. NB: 'ready' shows as "Review".
    product: {
      draft:    { color: '#525252', label: 'Draft' },
      ready:    { color: '#b45309', label: 'Review' },
      active:   { color: 'var(--teal,#2a7c6f)', label: 'Active' },
      archived: { color: '#9a3412', label: 'Archived' }
    },
    // material — MATERIAL_STATUS_COLORS (app/modules/maker.js); label = raw status; source fallback = draft
    material: {
      active:   { color: '#16a34a', label: 'active' },
      draft:    { color: 'var(--amber)', label: 'draft' },
      archived: { color: '#9ca3af', label: 'archived' }
    }
  };

  function _humanizeStatus(s) {
    return String(s == null ? '' : s).replace(/[_-]/g, ' ');
  }
  // statusBadge(status, domain) → the canonical status pill HTML. Unknown domain
  // OR unknown status → a NEUTRAL badge (NEVER throws); the raw status is
  // humanized (underscores/hyphens → spaces, matching the order/rma idiom) so it
  // still reads, and empty/null status → an em-dash. The label is HTML-escaped by
  // _badgeHtml; `domain`/`status` are otherwise used only as lookup keys.
  function statusBadge(status, domain) {
    var key = String(status == null ? '' : status);
    var dom = _statusRegistry[domain];
    var entry = dom && dom[key];
    if (entry) return _badgeHtml(entry.label, entry.color);
    return _badgeHtml(key ? _humanizeStatus(key) : '—', 'var(--warm-gray)');
  }

  // ── Empty state (one canonical "no X yet"; replaces ~60 hand-rolled) ────────
  // Models the dominant idiom: <div class="empty-state"><div class="empty-icon">
  // …</div><div class="empty-title">…</div><p>…</p></div>, reusing the existing
  // .empty-state / .empty-icon / .empty-title CSS (incl. dark-mode) in index.html
  // — zero new CSS. icon/title/hint are all optional and HTML-escaped; pass a
  // plain glyph/emoji for icon (e.g. '📦'), not a raw HTML entity.
  function emptyState(opts) {
    opts = opts || {};
    var icon = opts.icon ? '<div class="empty-icon">' + esc(opts.icon) + '</div>' : '';
    var title = opts.title ? '<div class="empty-title">' + esc(opts.title) + '</div>' : '';
    var hint = opts.hint ? '<p>' + esc(opts.hint) + '</p>' : '';
    return '<div class="empty-state">' + icon + title + hint + '</div>';
  }

  // ── Tabs (one component for L1 module + L2 detail; 10) ──────────────
  // tabs: [{key,label,count?}]; activeKey; onSelectFnName('key') global handler.
  function tabs(items, activeKey, onSelectFnName) {
    items = items || [];
    var bar = 'display:flex;gap:4px;border-bottom:1px solid var(--border,rgba(255,255,255,0.08));' +
              'margin-bottom:16px;overflow-x:auto;';
    var html = '<div class="mast-tabs" role="tablist" style="' + bar + '">';
    items.forEach(function (t) {
      var active = t.key === activeKey;
      var btn =
        'background:transparent;border:0;border-bottom:2px solid ' +
        (active ? 'var(--amber)' : 'transparent') + ';' +
        'color:' + (active ? 'var(--text-primary)' : 'var(--warm-gray)') + ';' +
        'font:inherit;font-size:0.9rem;font-weight:' + (active ? '600' : '400') + ';' +
        'padding:8px 14px;cursor:pointer;white-space:nowrap;';
      var count = (t.count != null)
        ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">' + Num.count(t.count) + '</span>' : '';
      html += '<button role="tab" aria-selected="' + active + '" style="' + btn + '"' +
              ' onclick="' + onSelectFnName + '(\'' + esc(t.key) + '\')">' + esc(t.label) + count + '</button>';
    });
    return html + '</div>';
  }

  // ── List / table (11) ───────────────────────────────────────────────
  // cfg: {
  //   columns:[{key,label,align?,sortable?,render?(row)->html}],
  //   rows:[], sortKey, sortDir, onSortFnName, onRowClickFnName(rowId),
  //   rowId?(row)->id, rowActions?(row)->[{label,onClickFnName}], empty?, loading?
  // }
  function list(cfg) {
    cfg = cfg || {};
    if (cfg.loading) {
      return '<div class="mast-loading" style="padding:40px;text-align:center;color:var(--warm-gray);font-size:0.9rem;">Loading…</div>';
    }
    var rows = cfg.rows || [];
    if (!rows.length) {
      var e = cfg.empty || {};
      return '<div class="mast-empty" style="padding:46px 20px;text-align:center;color:var(--warm-gray);">' +
        '<div style="font-size:1.15rem;color:var(--text-primary);margin-bottom:4px;">' + esc(e.title || 'Nothing here yet') + '</div>' +
        (e.message ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">' + esc(e.message) + '</div>' : '') +
        (e.ctaHtml || '') + '</div>';
    }
    var cols = cfg.columns || [];
    var rowId = cfg.rowId || function (r) { return r && r.id; };
    var th = '';
    // Opt-in selectable rows (bulk actions): reserve a leading checkbox column
    // with an engine-owned select-all header. cfg.selectedIds is a {id:true}
    // map; cfg.onSelectFnName(id, checked) and cfg.onSelectAllFnName(checked)
    // are the module's handlers. Lists that don't set cfg.selectable render
    // exactly as before (operator-ratified engine-first pattern).
    var selCount = 0;
    if (cfg.selectable) {
      rows.forEach(function (r) { if (cfg.selectedIds && cfg.selectedIds[rowId(r)]) selCount++; });
      th += '<th style="width:34px;padding:8px 4px;text-align:center;border-bottom:1px solid var(--border,rgba(255,255,255,0.06));">' +
        (cfg.onSelectAllFnName
          ? '<input type="checkbox" class="mast-select-all" aria-label="Select all"' + (rows.length && selCount === rows.length ? ' checked' : '') +
            ' onclick="event.stopPropagation();' + cfg.onSelectAllFnName + '(this.checked)">'
          : '') + '</th>';
    }
    // Opt-in expandable rows (e.g. a product → its variants): reserve a leading
    // toggle column. Lists that don't set cfg.expandable render exactly as before.
    if (cfg.expandable) th += '<th style="width:34px;border-bottom:1px solid var(--border,rgba(255,255,255,0.06));"></th>';
    cols.forEach(function (c) {
      // Header justifies the SAME as its values — default to LEFT (a bare <th>
      // browser-centers, which mismatched left-aligned text columns).
      var align = c.align === 'right' ? 'text-align:right;' : (c.align === 'center' ? 'text-align:center;' : 'text-align:left;');
      if (c.sortable && cfg.onSortFnName) {
        th += window.mastSortableTh(c.label, c.key, cfg.sortKey, cfg.sortDir, cfg.onSortFnName, align);
      } else {
        th += '<th style="padding:8px 12px;font-size:0.78rem;color:var(--warm-gray);' +
              'border-bottom:1px solid var(--border,rgba(255,255,255,0.06));' + align + '">' + esc(c.label) + '</th>';
      }
    });
    if (cfg.rowActions) th += '<th style="width:36px;border-bottom:1px solid var(--border,rgba(255,255,255,0.06));"></th>';

    var body = '';
    rows.forEach(function (r) {
      var id = rowId(r);
      // Keyboard/AT: a clickable row is a real button — focusable + Enter/Space.
      var click = cfg.onRowClickFnName
        ? ' onclick="' + cfg.onRowClickFnName + '(\'' + esc(id) + '\')"' +
          ' onkeydown="if(event.key===\'Enter\'||event.key===\' \'){event.preventDefault();' + cfg.onRowClickFnName + '(\'' + esc(id) + '\')}"' +
          ' tabindex="0" role="button" style="cursor:pointer;"'
        : '';
      body += '<tr class="mast-row"' + click + '>';
      if (cfg.selectable) {
        var _sel = !!(cfg.selectedIds && cfg.selectedIds[id]);
        body += '<td style="padding:14px 4px;text-align:center;width:34px;' +
                'border-bottom:1px solid var(--border,rgba(255,255,255,0.06));">' +
                '<input type="checkbox" class="mast-row-select" aria-label="Select row"' + (_sel ? ' checked' : '') +
                ' onclick="event.stopPropagation();' + (cfg.onSelectFnName || '') + '(\'' + esc(id) + '\', this.checked)">' +
                '</td>';
      }
      var _canExp = !!(cfg.expandable && cfg.hasChildren && cfg.hasChildren(r));
      var _open = !!(_canExp && cfg.expandedIds && cfg.expandedIds[id]);
      if (cfg.expandable) {
        body += '<td style="padding:14px 4px;text-align:center;width:34px;' +
                'border-bottom:1px solid var(--border,rgba(255,255,255,0.06));">' +
                (_canExp ? '<button class="mast-exp" onclick="event.stopPropagation();' + (cfg.onToggleFnName || '') + '(\'' + esc(id) + '\')" aria-label="Toggle">' + (_open ? '▼' : '▶') + '</button>' : '') +
                '</td>';
      }
      cols.forEach(function (c) {
        var align = c.align === 'right' ? 'text-align:right;font-variant-numeric:tabular-nums;' :
                    (c.align === 'center' ? 'text-align:center;' : '');
        var val = c.render ? c.render(r) : esc(r[c.key]);
        body += '<td style="padding:14px 12px;font-size:0.9rem;color:var(--text-primary);' +
                'border-bottom:1px solid var(--border,rgba(255,255,255,0.06));' + align + '">' + val + '</td>';
      });
      if (cfg.rowActions) {
        body += '<td style="padding:14px 4px;text-align:center;border-bottom:1px solid var(--border,rgba(255,255,255,0.06));">' +
                '<span style="color:var(--warm-gray);cursor:pointer;">⋯</span></td>';
      }
      body += '</tr>';
      // Expanded parent → caller-supplied child <tr>s (must match the column count
      // incl. the leading toggle cell). Keeps domain-specific child markup (the
      // variant tree) in the module while the engine owns the table + styling.
      if (_canExp && _open && typeof cfg.childRowsHtml === 'function') body += (cfg.childRowsHtml(r) || '');
    });

    return '<div class="mast-table-wrap" style="border:1px solid var(--border,rgba(255,255,255,0.08));' +
           'border-radius:12px;overflow:hidden;background:var(--surface-card,var(--card-bg));">' +
           '<table class="mast-table" style="width:100%;border-collapse:collapse;">' +
           '<thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // ── Deep-link helper (?id= in the hash) ─────────────────────────────
  // Deep-link DISABLED: writing `?id=` to location.hash fires `hashchange`,
  // which the SPA router treats as navigation and tears down the open slide-out
  // (broke drilling Order→Customer). Drill/back work via MastNavStack +
  // MastOverlayNav without a URL id; a shareable ?id= can be re-added later via
  // history.replaceState + a router guard. No-op for now.
  var deepLink = { set: function () {}, clear: function () {}, get: function () { return null; } };

  // ── slideOut v2 — the one record surface (05/08/12) ─────────────────
  // Wraps window.mastSlideOut (v1) adding: width tiers + expand, modes
  // (read/edit/create), Cancel/Save footer, MastDirty guard on every exit,
  // and ?id= deep-link. Dirty-guard works by routing the underlying close
  // through MastDirty.checkAndExit for the panel's lifetime.
  var _SIZE = { sm: '420px', md: '640px', lg: '900px', xl: '1140px' };
  var _v2 = { dirtyKey: null, origClose: null, expanded: false };

  function _panel() { return document.getElementById('mastSlideOutPanel'); }
  function _applySize(size, expandable) {
    var p = _panel(); if (!p) return;
    var w = _SIZE[size] || _SIZE.md;
    p.style.width = 'min(' + w + ',100%)';
    // expand-to-full control injected into the header
    var hdr = p.querySelector('header');
    if (expandable && hdr && !hdr.querySelector('.mast-expand-btn')) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'mast-expand-btn'; b.setAttribute('aria-label', 'Expand');
      b.style.cssText = 'background:transparent;border:0;color:var(--warm-gray);font-size:1.15rem;cursor:pointer;padding:0 4px;flex-shrink:0;';
      b.textContent = '⤢';
      b.onclick = function () {
        _v2.expanded = !_v2.expanded;
        p.style.width = _v2.expanded ? '100%' : 'min(' + w + ',100%)';
      };
      hdr.insertBefore(b, hdr.lastElementChild);
    }
    // Feedback access — the global feedback FAB is covered by the panel, so
    // surface it in the header (wired to the existing openFeedbackDialog).
    if (hdr && !hdr.querySelector('.mast-feedback-btn') && typeof window.openFeedbackDialog === 'function') {
      var fb = document.createElement('button');
      fb.type = 'button'; fb.className = 'mast-feedback-btn'; fb.title = 'Send feedback'; fb.setAttribute('aria-label', 'Send feedback');
      fb.style.cssText = 'background:transparent;border:0;color:var(--warm-gray);cursor:pointer;padding:0 4px;flex-shrink:0;display:inline-flex;align-items:center;';
      fb.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>';
      fb.onclick = function () { try { window.openFeedbackDialog(); } catch (e) {} };
      hdr.insertBefore(fb, hdr.lastElementChild);
    }
  }

  function _footer(mode, opts) {
    if (mode === 'read') {
      return (opts.actions || []).map(function (a) {
        var cls = a.primary ? 'btn btn-primary' : 'btn btn-secondary';
        return '<button class="' + cls + '" onclick="' + a.onClickFnName + '()">' + esc(a.label) + '</button>';
      }).join('');
    }
    // edit / create
    var saveLabel = mode === 'create' ? (opts.createLabel || 'Create') : (opts.saveLabel || 'Save');
    return '<button class="btn btn-secondary" onclick="window.MastUI.slideOut.requestClose()">Cancel</button>' +
           '<button class="btn btn-primary" onclick="window.MastUI.slideOut._save()">' + esc(saveLabel) + '</button>';
  }

  var slideOut = {
    _opts: null,
    _paneLeave: null,   // opt-in: fn(prevPaneKey, nextPaneKey) run before a pane tab switch
    // Register a hook fired when the user leaves a pane via the tab bar — lets a
    // record cancel in-pane edits (cancel-on-leave) so no dirty half-state
    // survives a tab switch. Pass null to clear. Auto-cleared on close.
    onPaneLeave: function (fn) { slideOut._paneLeave = (typeof fn === 'function') ? fn : null; },
    open: function (opts) {
      opts = opts || {};
      slideOut._opts = opts;
      _v2.expanded = false;
      var mode = opts.mode || 'read';
      // Status badges belong to READ mode only — in edit/create the status is
      // an editable control inside the form, so the read-mode pill would be a
      // stale duplicate (it lingered at the top of the old edit panel).
      var badgesHtml = (mode === 'read')
        ? (opts.badges || []).map(function (b) { return badge(b.label, b.tone); }).join(' ')
        : '';
      var bodyHtml = (typeof opts.render === 'function') ? opts.render({ mode: mode }) : (opts.bodyHtml || '');
      var subtitle = (opts.subtitle || '') + (badgesHtml ? ' ' : '');

      // Set the deep-link URL BEFORE opening — the shell's history wrapper
      // (MastOverlayNav) closes the active overlay when the URL changes while
      // one is open, so the ?id= must be in place before the panel arms.
      // setMode re-opens with the same id, so no URL change then either.
      if (opts.id && opts.deepLink !== false) deepLink.set(opts.id);
      window.mastSlideOut.open({
        title: opts.title || '',
        subtitle: opts.subtitle || '',
        bodyHtml: (badgesHtml ? '<div style="margin-bottom:14px;">' + badgesHtml + '</div>' : '') + bodyHtml,
        footerHtml: _footer(mode, opts),
        onClose: function () {
          // underlying panel closed — cleanup dirty registration + deep-link
          if (_v2.dirtyKey) { window.MastDirty.unregister(_v2.dirtyKey); _v2.dirtyKey = null; }
          if (_v2.origClose) { window.mastSlideOut.close = _v2.origClose; _v2.origClose = null; }
          if (opts.deepLink !== false) deepLink.clear();
          slideOut._paneLeave = null; // don't leak the pane-leave hook to the next record
          if (typeof opts.onClose === 'function') opts.onClose();
        }
      });
      _applySize(opts.size || 'md', opts.expandable !== false && (opts.size === 'lg' || opts.size === 'xl'));

      // Dirty guard: in edit/create, route the underlying close through
      // MastDirty.checkAndExit so backdrop/Esc/close-button all prompt.
      if (mode !== 'read' && (typeof opts.isDirty === 'function')) {
        _v2.dirtyKey = 'slideout:' + (opts.id || 'panel');
        window.MastDirty.register(_v2.dirtyKey, opts.isDirty, { label: opts.title || 'this record' });
        if (!_v2.origClose) {
          _v2.origClose = window.mastSlideOut.close;
          window.mastSlideOut.close = function () {
            window.MastDirty.checkAndExit(function () { _v2.origClose.call(window.mastSlideOut); });
          };
        }
      }
    },
    // swap mode in place (read ⇄ edit) without closing
    setMode: function (mode) {
      var opts = slideOut._opts; if (!opts) return;
      opts.mode = mode;
      slideOut.open(opts); // re-render with new mode/footer (re-registers dirty guard)
    },
    edit: function () { slideOut.setMode('edit'); },
    requestClose: function () { window.mastSlideOut.close(); },
    _save: function () {
      var opts = slideOut._opts; if (!opts || typeof opts.onSave !== 'function') return;
      Promise.resolve(opts.onSave({ mode: opts.mode })).then(function (res) {
        if (res === false) return; // validation failed — stay, keep data
        if (window.showToast) showToast((opts.mode === 'create' ? 'Created' : 'Saved'));
        if (_v2.dirtyKey) { window.MastDirty.unregister(_v2.dirtyKey); _v2.dirtyKey = null; }
        if (opts.mode === 'create') { slideOut.requestCloseForce(); }
        else { slideOut.setMode('read'); } // back to read on the same record
      }).catch(function (e) {
        console.error('[MastUI.slideOut] save failed', e);
        if (window.showToast) showToast('Save failed: ' + (e && e.message || e), true);
      });
    },
    requestCloseForce: function () {
      if (_v2.dirtyKey) { window.MastDirty.unregister(_v2.dirtyKey); _v2.dirtyKey = null; }
      if (_v2.origClose) { var c = _v2.origClose; _v2.origClose = null; window.mastSlideOut.close = c; }
      window.mastSlideOut.close();
    },
    isOpen: function () { return window.mastSlideOut.isOpen(); }
  };

  // ── Detail-template render components (slot vocabulary; docs 17 + templates-mock) ──
  // Pure string builders the Entity Engine composes into a record panel.
  function tiles(items) { // [{k, v, hero}]
    return '<div class="mu-tiles">' + (items || []).map(function (t) {
      return '<div class="mu-tile' + (t.hero ? ' hero' : '') + '"><div class="mu-tk">' + esc(t.k) + '</div><div class="mu-tv">' + (t.v == null ? '' : t.v) + '</div></div>';
    }).join('') + '</div>';
  }
  // opts: { fill?, headerRight? } — fill = grid-cell card (margin:0;height:100%);
  // headerRight = HTML rendered right-aligned in the header (e.g. an on/off badge).
  function card(title, inner, opts) {
    opts = opts || {};
    var cls = 'mu-card' + (opts.fill ? ' mu-card-fill' : '');
    var head = opts.headerRight
      ? '<h3 class="mu-cardhead"><span>' + esc(title) + '</span>' + opts.headerRight + '</h3>'
      : '<h3>' + esc(title) + '</h3>';
    return '<div class="' + cls + '">' + head + '<div class="mu-cc">' + (inner || '') + '</div></div>';
  }
  // Clickable, grid-cell card — the producer/launcher + read-on-page edit-card shape
  // (doc 17 §13/§15). cfg: { title, body, onClickFnName, arg?, arrow?, headerRight? }.
  // The arrow (e.g. 'Open →' / 'Edit →') is appended bottom-right; clicking fires
  // onClickFnName(arg). Use this instead of hand-rolling a <button>+mu-card.
  function launchCard(cfg) {
    cfg = cfg || {};
    var arrow = cfg.arrow ? ('<div class="mu-arrow" style="margin-top:10px;text-align:right;">' + esc(cfg.arrow) + '</div>') : '';
    var onclick = cfg.onClickFnName ? (' onclick="' + cfg.onClickFnName + '(' + (cfg.arg != null ? "'" + esc(String(cfg.arg)) + "'" : '') + ')"') : '';
    return '<button type="button" class="mu-launch"' + onclick + '>' + card(cfg.title, (cfg.body || '') + arrow, { fill: true, headerRight: cfg.headerRight }) + '</button>';
  }
  // Responsive grid of fill-cards/launchers — the standard producer-surface layout.
  function cardGrid(items) { return '<div class="mu-cardgrid">' + (Array.isArray(items) ? items.join('') : (items || '')) + '</div>'; }

  // ── repeatRows — repeatable form rows + engine-owned "+ Add" (operator-
  // ratified 2026-06-10: standard patterns live in the engine, not per module).
  // cfg: { id, rows, template: fn(item, i) -> rowHtml, addLabel?, spares? }
  // The template's row markup must carry its own data attrs — the consuming
  // module scrapes them on save exactly as before. repeatRowsAdd appends a
  // blank row with the SAME template (kept in a registry keyed by container id)
  // so added rows render and save identically to initial ones.
  var _repeatTemplates = Object.create(null);
  function repeatRows(cfg) {
    cfg = cfg || {};
    _repeatTemplates[cfg.id] = cfg.template;
    var rows = Array.isArray(cfg.rows) ? cfg.rows.slice() : [];
    var spares = (typeof cfg.spares === 'number') ? cfg.spares : 1;
    for (var i = 0; i < spares; i++) rows.push({});
    var html = rows.map(function (r, idx) { return cfg.template(r, idx); }).join('');
    return '<div id="' + esc(cfg.id) + '">' + html + '</div>' +
      '<button type="button" class="btn btn-secondary" style="font-size:0.78rem;padding:4px 12px;margin:2px 0 4px;" ' +
      'onclick="MastUI.repeatRowsAdd(\'' + esc(cfg.id) + '\')">' + esc(cfg.addLabel || '+ Add') + '</button>';
  }
  function repeatRowsAdd(id) {
    var host = (typeof document !== 'undefined') && document.getElementById(id);
    var tpl = _repeatTemplates[id];
    if (!host || typeof tpl !== 'function') return;
    var i = host.children.length;
    host.insertAdjacentHTML('beforeend', tpl({}, i));
    var first = host.lastElementChild && host.lastElementChild.querySelector('input,select,textarea');
    if (first) first.focus();
  }

  // ── Instant-apply controls (live "no Save button" editing) ───────────
  // The "Your Website" builder writes on every keystroke/pick instead of behind
  // a Save button. Two pieces: a KEYED debounce (so many live fields share one
  // timer registry without colliding) and bindInstant (wire an input → debounced
  // writer). Generalized from homepage.js' debounce closure + website.js' onchange
  // color inputs. Usage example (no UI surface here — primitives only):
  //   var hex = MastUI.colorInput({ value: cfg.primary, id: 'brandPrimary',
  //     onInput: function (h) { MastDB.set('brand/config/primary', h); } });
  //   // …after inserting hex.html into the DOM:
  //   MastUI.bindInstant(document.getElementById('brandPrimary'),
  //     { key: 'brand:primary', writer: function (v) { MastDB.set('brand/config/primary', v); } });

  // debounce(key, fn, delay=500): repeated calls with the SAME key reset that
  // key's timer; fn fires once after `delay` ms of quiet. Keyed so distinct
  // fields don't clobber each other's pending writes.
  var _debounceTimers = Object.create(null);
  function debounce(key, fn, delay) {
    if (typeof key === 'function') { fn = key; key = '__default'; } // tolerant: bare-fn call
    if (_debounceTimers[key]) clearTimeout(_debounceTimers[key]);
    _debounceTimers[key] = setTimeout(function () {
      delete _debounceTimers[key];
      if (typeof fn === 'function') fn();
    }, delay == null ? 500 : delay);
  }

  // bindInstant(el, cfg): attach a live listener that runs the value through an
  // optional transform, debounces via debounce(key,…), then calls writer(value).
  // cfg: { key, writer(value), event?, transform?(rawValue)->value, delay? }
  // Default event: 'change' for <select>, 'input' for everything else (text/color/
  // range update continuously). Returns el (chainable). No-op if el/writer absent.
  function bindInstant(el, cfg) {
    cfg = cfg || {};
    if (!el || typeof el.addEventListener !== 'function' || typeof cfg.writer !== 'function') return el;
    var evt = cfg.event || (el.tagName === 'SELECT' ? 'change' : 'input');
    var key = cfg.key || ('bi:' + (el.id || el.name || Math.random().toString(36).slice(2)));
    el.addEventListener(evt, function () {
      var raw = (el.type === 'checkbox') ? el.checked : el.value;
      var val = (typeof cfg.transform === 'function') ? cfg.transform(raw) : raw;
      debounce(key, function () { cfg.writer(val); }, cfg.delay);
    });
    return el;
  }

  // colorInput(cfg): paired <input type=color> + hex text input that stay in
  // sync; every edit (either field) calls onInput(hex). Markup-returning like the
  // other primitives. cfg: { value, onInput?(hex), id?, label? }. onInput, when a
  // global fn name (string) or set via cfg.onInputFnName, is invoked inline; when
  // a function, it's wired by bindInstant after insertion (see usage note above).
  // CHROME uses tokens; the color VALUE is data passed in (kept out of styling so
  // no literal-hex chrome). The two inputs share a class so the sync delegate
  // mirrors one into the other on input.
  function colorInput(cfg) {
    cfg = cfg || {};
    var id = cfg.id || ('mu-col-' + Math.random().toString(36).slice(2));
    var val = cfg.value == null ? '' : String(cfg.value);
    var lbl = cfg.label ? '<label class="mu-ci-label" for="' + esc(id) + '-hex">' + esc(cfg.label) + '</label>' : '';
    // Inline-handler path (string fn name) mirrors website.js:926; the function
    // path is wired by the caller with bindInstant on #<id>-hex / #<id>-color.
    var fn = typeof cfg.onInput === 'string' ? cfg.onInput : cfg.onInputFnName;
    var oninput = fn ? (' oninput="' + esc(fn) + '(this.value)"') : '';
    return '<div class="mu-colorinput" data-ci="' + esc(id) + '">' + lbl +
      '<div class="mu-ci-row">' +
        '<input type="color" id="' + esc(id) + '-color" class="mu-ci-swatch" value="' + esc(val) + '"' + oninput + ' aria-label="' + esc(cfg.label || 'Color') + ' swatch">' +
        '<input type="text" id="' + esc(id) + '-hex" class="mu-ci-hex" value="' + esc(val) + '"' + oninput + ' maxlength="7" spellcheck="false" placeholder="#000000" aria-label="' + esc(cfg.label || 'Color') + ' hex">' +
      '</div></div>';
  }

  // swatchGrid(cfg): a responsive grid of selectable tiles — color schemes, font
  // pairs, "Looks" bundles, layout variants. renderItem(item) renders each tile's
  // inner content (default: a small color swatch keyed off item.value/item.color);
  // the `selected` tile gets a check + ring; click fires onSelectFnName(value).
  // cfg: { items:[{value, label?, color?}], selected, onSelectFnName, renderItem?,
  //        idKey? }. Click is delegated (data-sw / data-val) — no per-tile inline.
  function swatchGrid(cfg) {
    cfg = cfg || {};
    var items = cfg.items || [];
    var idKey = cfg.idKey || 'value';
    var render = typeof cfg.renderItem === 'function' ? cfg.renderItem : function (it) {
      var c = it.color || it.value || '';
      var sw = c ? '<span class="mu-sw-color" style="background:' + esc(c) + ';"></span>' : '';
      return sw + (it.label ? '<span class="mu-sw-label">' + esc(it.label) + '</span>' : '');
    };
    var fn = cfg.onSelectFnName || '';
    return '<div class="mu-swgrid" role="listbox">' + items.map(function (it) {
      var v = it == null ? '' : (it[idKey] != null ? it[idKey] : it.value);
      var on = String(v) === String(cfg.selected);
      return '<button type="button" class="mu-sw' + (on ? ' on' : '') + '" role="option"' +
        ' aria-selected="' + on + '" data-sw="' + esc(fn) + '" data-val="' + esc(v) + '">' +
        render(it) + (on ? '<span class="mu-sw-check" aria-hidden="true">✓</span>' : '') +
        '</button>';
    }).join('') + '</div>';
  }

  // ── validate — shared format checks (empty passes: presence is the form's
  // call; these only reject malformed values).
  var validate = {
    email: function (v) {
      if (v == null || String(v).trim() === '') return true;
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(v).trim());
    },
    phone: function (v) {
      if (v == null || String(v).trim() === '') return true;
      var s = String(v).trim();
      var digits = s.replace(/\D/g, '');
      return digits.length >= 7 && digits.length <= 15 && !/[^\d\s()+.\-ext]/i.test(s);
    }
  };
  // Standard page header — the title/count/actions strip every list-control and
  // launcher screen shares, so moving from any screen to any other doesn't look
  // foreign (doc 17 §13). cfg: { title, count?, subtitle?, actionsHtml? }.
  function pageHeader(cfg) {
    cfg = cfg || {};
    var meta = (cfg.count != null) ? ('<span style="color:var(--warm-gray);font-size:0.9rem;">' + esc(cfg.count) + '</span>') : '';
    var sub = cfg.subtitle ? ('<span style="color:var(--warm-gray);font-size:0.9rem;">' + esc(cfg.subtitle) + '</span>') : '';
    var actions = cfg.actionsHtml ? ('<span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap;">' + cfg.actionsHtml + '</span>') : '';
    return '<div style="display:flex;align-items:baseline;gap:12px;margin-bottom:6px;flex-wrap:wrap;">' +
      '<h1 style="font-size:1.6rem;margin:0;">' + esc(cfg.title || '') + '</h1>' + meta + sub + actions + '</div>';
  }
  function cardTable(title, inner) { return '<div class="mu-card"><h3>' + esc(title) + '</h3>' + (inner || '') + '</div>'; }
  function kv(rows) { // [{k, v}] v is html
    return '<div class="mu-kv">' + (rows || []).map(function (r) {
      return '<span class="mu-k">' + esc(r.k) + '</span><span class="mu-v">' + (r.v == null || r.v === '' ? '—' : r.v) + '</span>';
    }).join('') + '</div>';
  }
  // A compact column-header matrix for period/breakdown metrics, e.g.
  // metricTable({ columns:['30 days','90 days','All time'], rows:[{label:'Units', cells:['0','17','17']}] }).
  // Cells are HTML (like kv values). Clearer than packing "0 / 17 / 17" into one cell.
  function metricTable(cfg) {
    cfg = cfg || {};
    var cols = cfg.columns || [], rows = cfg.rows || [];
    var th = '<th>' + esc(cfg.corner || '') + '</th>' + cols.map(function (c) { return '<th>' + esc(c) + '</th>'; }).join('');
    var body = rows.map(function (r) {
      return '<tr><td>' + esc(r.label) + '</td>' + (r.cells || []).map(function (c) { return '<td>' + (c == null || c === '' ? '—' : c) + '</td>'; }).join('') + '</tr>';
    }).join('');
    return '<table class="mu-mt"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
  }
  function timeline(events) { // [{label, at, done}]
    return '<ul class="mu-tl">' + (events || []).map(function (e) {
      return '<li class="' + (e.done ? '' : 'future') + '"><div class="mu-tt">' + esc(e.label) + '</div><div class="mu-td">' + (e.at ? esc(e.at) : '—') + '</div></li>';
    }).join('') + '</ul>';
  }
  function relatedTable(cols, rows, onRowFn) { // cols:[{label,align,render}], rows:[], onRowFn(name) drill
    var th = cols.map(function (c) { return '<th class="' + (c.align === 'right' ? 'r' : '') + '">' + esc(c.label) + '</th>'; }).join('');
    var body = (rows || []).map(function (r, i) {
      var click = onRowFn ? ' class="mu-rel-click" data-row="' + i + '"' : '';
      return '<tr' + click + '>' + cols.map(function (c) {
        return '<td class="' + (c.align === 'right' ? 'r' : '') + '">' + (c.render ? c.render(r) : esc(r[c.key])) + '</td>';
      }).join('') + '</tr>';
    }).join('');
    return '<table class="mu-rel"><thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table>';
  }
  function imageThumb(name, src) {
    return '<button class="mu-thumb" data-img="' + esc(name) + '"' + (src ? ' data-src="' + esc(src) + '" style="background-image:url(' + esc(src) + ');background-size:cover;"' : '') + '><span class="mu-zoom">⤢</span></button>';
  }
  // image lightbox (singleton). Shows the actual full-size image when a src is
  // given (falls back to the placeholder gradient + caption otherwise).
  function openImg(name, src) {
    var lb = document.getElementById('mu-lightbox');
    if (!lb) {
      lb = document.createElement('div'); lb.id = 'mu-lightbox'; lb.className = 'mu-lightbox';
      lb.innerHTML = '<div><div class="mu-lb-img"></div><div class="mu-lb-cap"></div><div class="mu-lb-hint">click anywhere or press Esc to close</div></div>';
      lb.addEventListener('click', function () { lb.classList.remove('open'); });
      document.body.appendChild(lb);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.classList.remove('open'); });
    }
    var imgEl = lb.querySelector('.mu-lb-img');
    if (src) { imgEl.style.backgroundImage = 'url(' + src + ')'; imgEl.style.backgroundSize = 'contain'; imgEl.style.backgroundRepeat = 'no-repeat'; imgEl.style.backgroundPosition = 'center'; }
    else { imgEl.style.backgroundImage = ''; }
    lb.querySelector('.mu-lb-cap').textContent = name || '';
    lb.classList.add('open');
  }
  // delegated handlers for thumbs (attach once)
  function wireDelegates() {
    if (window.__muWired) return; window.__muWired = true;
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.mu-thumb');
      if (t) { openImg(t.getAttribute('data-img'), t.getAttribute('data-src')); return; }
      // swatchGrid tile → call the module's global handler with the tile value.
      var sw = e.target.closest && e.target.closest('.mu-sw');
      if (sw) {
        var fn = sw.getAttribute('data-sw');
        var ref = fn && (window[fn] || (window.MastUI && window.MastUI[fn]));
        if (typeof ref === 'function') ref(sw.getAttribute('data-val'));
      }
    });
    // colorInput: keep the <input type=color> and the hex text field in sync as
    // either is edited (the onInput/bindInstant write still fires per field).
    document.addEventListener('input', function (e) {
      var el = e.target;
      if (!el || !el.classList) return;
      var host = el.closest && el.closest('.mu-colorinput');
      if (!host) return;
      var sw = host.querySelector('.mu-ci-swatch');
      var hx = host.querySelector('.mu-ci-hex');
      if (!sw || !hx) return;
      var v = String(el.value || '');
      if (el.classList.contains('mu-ci-hex')) {
        // Only mirror a complete, valid #rrggbb into the native color picker
        // (it rejects partials); the text field stays free-form as the user types.
        if (/^#[0-9a-fA-F]{6}$/.test(v) && sw.value !== v) sw.value = v;
      } else if (el.classList.contains('mu-ci-swatch')) {
        if (hx.value !== v) hx.value = v;
      }
    });
  }
  // panel tabs: switch panes inside the slide-out body
  function panelTab(btn, pane) {
    var bar = btn.parentNode; var body = document.getElementById('mastSlideOutBody');
    // Cancel-on-leave: give the open record a chance to discard in-pane edits on
    // the pane being left before we hide it (opt-in via slideOut.onPaneLeave).
    if (body && typeof slideOut._paneLeave === 'function') {
      var visEl = body.querySelector('.mu-pane:not([hidden])');
      var prevPane = visEl && visEl.getAttribute('data-pane');
      if (prevPane && prevPane !== pane) { try { slideOut._paneLeave(prevPane, pane); } catch (e) {} }
    }
    bar.querySelectorAll('button').forEach(function (b) { b.classList.remove('on'); }); btn.classList.add('on');
    if (body) {
      body.querySelectorAll('.mu-pane').forEach(function (el) { el.hidden = el.getAttribute('data-pane') !== pane; });
      body.scrollTop = 0;
    }
  }
  function paneTabsBar(tabs, activeKey) { // [{key,label}]
    return '<div class="mu-ptabs">' + tabs.map(function (t) {
      return '<button class="' + (t.key === activeKey ? 'on' : '') + '" onclick="MastUI.panelTab(this,\'' + t.key + '\')">' + esc(t.label) + '</button>';
    }).join('') + '</div>';
  }
  // Collapsible headline cover (doc 17 §3a) — pinned vitals above the tabs, on
  // every pane; collapse to declutter. Wrap with the tabs in a sticky head so
  // both stay visible while a pane scrolls.
  function stickyHead(coverInner, tabsBar) {
    return '<div class="mu-stickyhead">' +
      (coverInner ? ('<div class="mu-cover" id="muCover">' +
        '<div class="mu-cover-body">' + coverInner + '</div>' +
        '<button class="mu-cover-toggle" onclick="MastUI.toggleCover()" aria-label="Toggle details"><span class="mu-chev">▾</span></button>' +
      '</div>') : '') + tabsBar + '</div>';
  }
  function toggleCover() {
    var c = document.getElementById('muCover'); if (c) c.classList.toggle('collapsed');
  }

  // ── Calendar: a pluggable INDEX control (doc 17 §10) ────────────────
  // Plots entries on a month grid; a click outputs a record id (the occurrence)
  // — the same index→detail handoff a table gives, with a different lens.
  // cfg: { year, month(0-11), entriesByDate:{'YYYY-MM-DD':[{id,label,time?,tone?}]},
  //        onEntryFnName('id'), onNavFnName('prev'|'today'|'next') }
  var _CAL_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  var _CAL_DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function _pad2(n) { return (n < 10 ? '0' : '') + n; }
  function calendar(cfg) {
    cfg = cfg || {};
    var year = cfg.year, month = cfg.month, byDate = cfg.entriesByDate || {};
    var onEntry = cfg.onEntryFnName, onNav = cfg.onNavFnName;
    var startDow = new Date(year, month, 1).getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var head = '<div class="mu-cal-head"><div class="mu-cal-title">' + _CAL_MONTHS[month] + ' ' + year + '</div>' +
      '<div class="mu-cal-nav">' +
        '<button onclick="' + onNav + '(\'prev\')">&#8249; Prev</button>' +
        '<button onclick="' + onNav + '(\'today\')">Today</button>' +
        '<button onclick="' + onNav + '(\'next\')">Next &#8250;</button>' +
      '</div></div>';
    var grid = '<div class="mu-cal-grid">';
    _CAL_DOW.forEach(function (d) { grid += '<div class="mu-cal-dow">' + d + '</div>'; });
    for (var i = 0; i < startDow; i++) grid += '<div class="mu-cal-cell empty"></div>';
    for (var day = 1; day <= daysInMonth; day++) {
      var ds = year + '-' + _pad2(month + 1) + '-' + _pad2(day);
      var es = byDate[ds] || [];
      var evs = es.slice(0, 3).map(function (e) {
        var c = 'var(' + (_toneVar[e.tone] || _toneVar.neutral) + ', var(--warm-gray))';
        return '<button class="mu-cal-ev" onclick="' + onEntry + '(\'' + esc(e.id) + '\')">' +
          '<span class="mu-cal-dot" style="background:' + c + ';"></span>' +
          (e.time ? '<span class="mu-cal-t">' + esc(e.time) + '</span> ' : '') + esc(e.label) + '</button>';
      }).join('');
      var more = es.length > 3 ? '<div class="mu-cal-more">+' + (es.length - 3) + ' more</div>' : '';
      grid += '<div class="mu-cal-cell' + (es.length ? ' has' : '') + '"><div class="mu-cal-day">' + day + '</div>' + evs + more + '</div>';
    }
    grid += '</div>';
    return '<div class="mu-cal">' + head + grid + '</div>';
  }

  // ── One injected, tokenized stylesheet (both-mode safe) ──
  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('mast-ui-styles')) return;
    var css = [
      '.mu-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;}',
      '.mu-tile{background:var(--bg-secondary,rgba(127,127,127,.06));border:1px solid var(--border,rgba(127,127,127,.2));border-radius:10px;padding:12px 14px;}',
      '.mu-tk{font-size:0.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-gray);}',
      '.mu-tv{font-size:1.0rem;font-weight:600;margin-top:5px;font-variant-numeric:tabular-nums;color:var(--text-primary);}',
      '.mu-tile.hero .mu-tv{font-size:1.15rem;}',
      '.mu-card{border:1px solid var(--border,rgba(127,127,127,.2));border-radius:12px;overflow:hidden;margin-bottom:16px;}',
      '.mu-card>h3{font-size:0.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-gray);margin:0;padding:13px 16px;border-bottom:1px solid var(--border,rgba(127,127,127,.2));background:var(--bg-secondary,rgba(127,127,127,.05));font-weight:600;}',
      '.mu-cc{padding:14px 16px;}',
      // Grid-cell card + clickable launcher/edit card (producer surfaces + read-on-page
      // config grids). Use MastUI.card(t,i,{fill:true}) / MastUI.launchCard(...) /
      // MastUI.cardGrid(...) — never hand-write these classes (lint-ux-standards enforces).
      '.mu-card-fill{margin:0;height:100%;}',
      '.mu-launch{all:unset;display:block;box-sizing:border-box;height:100%;cursor:pointer;} .mu-launch:focus-visible .mu-card{box-shadow:0 0 0 2px var(--amber,#C4853C);} .mu-launch:hover .mu-card{border-color:var(--amber,#C4853C);}',
      '.mu-launch .mu-arrow{color:var(--teal,#2A7C6F);font-weight:600;}',
      '.mu-cardgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;margin-top:14px;align-items:stretch;}',
      // colorInput: paired native color swatch + hex text field (instant-apply).
      // Chrome only — the color VALUE is inline data, never baked into these rules.
      '.mu-colorinput{display:flex;flex-direction:column;gap:5px;}',
      '.mu-ci-label{font-size:0.78rem;color:var(--warm-gray);}',
      '.mu-ci-row{display:flex;gap:8px;align-items:center;}',
      '.mu-ci-swatch{width:40px;height:40px;border:1px solid var(--border,rgba(127,127,127,.3));border-radius:8px;cursor:pointer;padding:0;background:transparent;flex:0 0 40px;}',
      '.mu-ci-hex{flex:1;min-width:0;font:inherit;font-size:0.85rem;font-variant-numeric:tabular-nums;text-transform:lowercase;padding:8px 10px;border:1px solid var(--border,rgba(127,127,127,.3));border-radius:8px;background:var(--bg-secondary,rgba(127,127,127,.06));color:var(--text-primary);} .mu-ci-hex:focus{outline:none;border-color:var(--amber,#C4853C);}',
      // swatchGrid: responsive grid of selectable tiles (schemes/fonts/looks/layouts).
      '.mu-swgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px;margin:6px 0 14px;}',
      '.mu-sw{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;min-height:64px;padding:10px;border:1px solid var(--border,rgba(127,127,127,.3));border-radius:10px;background:var(--surface-card,var(--card-bg,#1e1e1e));color:var(--text-primary);font:inherit;font-size:0.78rem;cursor:pointer;text-align:center;} .mu-sw:hover{border-color:var(--amber,#C4853C);} .mu-sw:focus-visible{outline:none;box-shadow:0 0 0 2px var(--amber,#C4853C);}',
      '.mu-sw.on{border-color:var(--amber,#C4853C);box-shadow:0 0 0 1px var(--amber,#C4853C) inset;}',
      '.mu-sw-color{display:block;width:34px;height:34px;border-radius:8px;border:1px solid var(--border,rgba(127,127,127,.25));}',
      '.mu-sw-label{font-size:0.72rem;color:var(--warm-gray);line-height:1.2;}',
      '.mu-sw-check{position:absolute;top:4px;right:6px;font-size:0.72rem;font-weight:700;color:var(--amber,#C4853C);}',
      '.mu-card>h3.mu-cardhead{display:flex;align-items:center;justify-content:space-between;gap:10px;}',
      '.mu-kv{display:grid;grid-template-columns:auto 1fr;gap:8px 24px;font-size:0.9rem;}',
      // Values left-align in a column just past the widest label (not flush-right) —
      // easier to scan than right-justified values of varying length.
      '.mu-kv .mu-k{color:var(--warm-gray);} .mu-kv .mu-v{text-align:left;}',
      // metricTable: a compact column-header matrix for period/breakdown values
      // (e.g. 30d / 90d / All-time) inside a card — clearer than "0 / 17 / 17".
      '.mu-mt{width:100%;border-collapse:collapse;font-size:0.9rem;}',
      '.mu-mt th{font-size:0.72rem;font-weight:600;color:var(--warm-gray);text-transform:uppercase;letter-spacing:.03em;padding:0 0 8px 16px;text-align:right;}',
      '.mu-mt th:first-child{text-align:left;padding-left:0;}',
      '.mu-mt td{padding:7px 0 7px 16px;text-align:right;font-variant-numeric:tabular-nums;border-top:1px solid var(--border,rgba(127,127,127,.18));}',
      '.mu-mt td:first-child{text-align:left;padding-left:0;color:var(--warm-gray);}',
      '.mu-rel{width:100%;border-collapse:collapse;} .mu-rel thead th{text-align:left;font-size:0.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--warm-gray);font-weight:600;padding:0 16px 8px;} .mu-rel th.r,.mu-rel td.r{text-align:right;}',
      '.mu-rel tbody td{padding:11px 16px;border-top:1px solid var(--border,rgba(127,127,127,.15));font-size:0.9rem;font-variant-numeric:tabular-nums;}',
      '.mu-rel-click{cursor:pointer;} .mu-rel-click:hover td{background:color-mix(in srgb,var(--amber,#C4853C) 8%,transparent);}',
      '.mu-tl{list-style:none;margin:0;padding:0;} .mu-tl li{position:relative;padding:0 0 16px 22px;}',
      '.mu-tl li::before{content:"";position:absolute;left:3px;top:3px;width:9px;height:9px;border-radius:50%;background:var(--amber,#C4853C);}',
      '.mu-tl li.future::before{background:transparent;border:2px solid var(--border,#999);} .mu-tl li::after{content:"";position:absolute;left:7px;top:12px;bottom:-2px;width:2px;background:var(--border,rgba(127,127,127,.3));} .mu-tl li:last-child::after{display:none;}',
      '.mu-tt{font-size:0.85rem;font-weight:500;color:var(--text-primary);} .mu-td{font-size:0.78rem;color:var(--warm-gray);}',
      '.mu-thumb{width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,var(--amber-light,#E8B679),var(--teal,#2A7C6F));border:0;padding:0;position:relative;cursor:zoom-in;flex:0 0 40px;} .mu-thumb:hover{box-shadow:0 0 0 2px var(--amber,#C4853C);}',
      '.mu-zoom{position:absolute;right:2px;bottom:2px;width:14px;height:14px;border-radius:4px;background:rgba(0,0,0,.55);color:#fff;font-size:0.72rem;display:flex;align-items:center;justify-content:center;opacity:0;} .mu-thumb:hover .mu-zoom{opacity:1;}',
      '.mu-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.8);display:none;align-items:center;justify-content:center;z-index:12000;cursor:zoom-out;text-align:center;} .mu-lightbox.open{display:flex;}',
      '.mu-lb-img{width:min(70vmin,520px);height:min(70vmin,520px);border-radius:14px;background:linear-gradient(135deg,var(--amber-light,#E8B679),var(--teal,#2A7C6F));box-shadow:0 20px 60px rgba(0,0,0,.5);} .mu-lb-cap{color:#fff;margin-top:14px;font-size:0.9rem;} .mu-lb-hint{color:rgba(255,255,255,.6);font-size:0.78rem;margin-top:4px;}',
      '.mu-ptabs{display:flex;gap:4px;border-bottom:1px solid var(--border,rgba(127,127,127,.2));margin:-4px -4px 16px;position:sticky;top:0;background:var(--surface-card,var(--card-bg,#1e1e1e));z-index:2;}',
      '.mu-ptabs button{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--warm-gray);font:inherit;font-size:0.9rem;padding:11px 14px;cursor:pointer;white-space:nowrap;} .mu-ptabs button.on{border-bottom-color:var(--amber,#C4853C);color:var(--text-primary);font-weight:600;}',
      '.mu-pane[hidden]{display:none;} .mu-grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;} @media(max-width:720px){.mu-grid2{grid-template-columns:1fr;}}',
      '.mu-crumb{margin:-4px -4px 14px;padding:9px 4px;border-bottom:1px solid var(--border,rgba(127,127,127,.2));} .mu-crumb button{background:transparent;border:0;color:var(--teal,#2A7C6F);font:inherit;font-size:0.85rem;cursor:pointer;font-weight:500;}',
      '.mu-link{display:inline;color:var(--teal,#2A7C6F);background:none;border:0;padding:0;font:inherit;cursor:pointer;font-weight:500;} .mu-link:hover{text-decoration:underline;}',
      // Activity facet type-filter pills (mast-entity renderActivityFacet, PR4).
      '.mu-actfilters{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;}',
      '.mu-actfilter{background:transparent;border:1px solid var(--border,rgba(127,127,127,.2));border-radius:999px;color:var(--warm-gray);font:inherit;font-size:0.78rem;padding:4px 12px;cursor:pointer;white-space:nowrap;} .mu-actfilter.on{border-color:var(--amber,#C4853C);color:var(--text-primary);font-weight:600;} .mu-actfilter .mu-sub{font-size:0.72rem;}',
      // Edit-mode affordance bar (designed edit form): "EDITING — update …".
      '.mu-editbar{display:flex;align-items:center;gap:9px;font-size:0.85rem;color:var(--warm-gray);margin:2px 2px 14px;}',
      '.mu-editpill{font-size:0.68rem;font-weight:600;letter-spacing:.04em;padding:2px 9px;border-radius:999px;background:color-mix(in srgb,var(--amber,#C4853C) 16%,transparent);color:var(--amber,#C4853C);border:1px solid color-mix(in srgb,var(--amber,#C4853C) 30%,transparent);}',
      // Visible keyboard focus (06-B / a11y) — no :focus-visible rings existed before.
      '.mast-row:focus-visible{outline:2px solid var(--amber,var(--teal));outline-offset:-2px;} .mu-link:focus-visible,.mu-crumb button:focus-visible{outline:2px solid var(--amber,var(--teal));outline-offset:2px;border-radius:3px;}',
      // Expandable list rows (opt-in via cfg.expandable): the toggle control + the
      // child (sub) row surface. Only applies to lists that emit them.
      '.mast-exp{background:transparent;border:0;color:var(--warm-gray);font-size:0.85rem;line-height:1;cursor:pointer;padding:3px 5px;border-radius:5px;} .mast-exp:hover{color:var(--text-primary);background:color-mix(in srgb,var(--text-primary) 8%,transparent);}',
      '.mast-subrow td{background:color-mix(in srgb,black 14%,transparent);}',
      '.feedback-overlay{z-index:12001 !important;}', // above the slide-out (9000) so the feedback dialog opens on top',
      '.mast-feedback-btn:hover{color:var(--text-primary) !important;}',
      '.mu-li{display:flex;align-items:center;gap:11px;} .mu-sub{color:var(--warm-gray);font-size:0.78rem;} .mu-totrow{display:flex;justify-content:space-between;padding:6px 0;color:var(--warm-gray);font-size:0.9rem;} .mu-totrow.grand{border-top:1px solid var(--border,rgba(127,127,127,.2));margin-top:6px;padding-top:10px;color:var(--text-primary);font-weight:700;font-size:1.0rem;}',
      // Sticky head = collapsible vitals cover + the pane tabs (doc 17 §3a).
      '.mu-stickyhead{position:sticky;top:0;z-index:3;background:var(--surface-card,var(--card-bg,#1e1e1e));margin:-4px -4px 16px;}',
      '.mu-stickyhead .mu-ptabs{position:static;margin:0;}',
      '.mu-cover{position:relative;padding:12px 30px 12px 4px;border-bottom:1px solid var(--border,rgba(127,127,127,.2));}',
      '.mu-cover .mu-tiles{margin:0;}',
      '.mu-cover.collapsed .mu-cover-body{display:none;} .mu-cover.collapsed{padding-top:6px;padding-bottom:6px;}',
      '.mu-cover-toggle{position:absolute;top:8px;right:2px;background:transparent;border:0;color:var(--warm-gray);cursor:pointer;padding:2px 4px;line-height:1;}',
      '.mu-chev{display:inline-block;transition:transform .15s ease;font-size:0.9rem;} .mu-cover.collapsed .mu-chev{transform:rotate(-90deg);}',
      // Calendar index control (doc 17 §10).
      '.mu-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}',
      '.mu-cal-title{font-size:1.15rem;font-weight:600;color:var(--text-primary);}',
      '.mu-cal-nav button{background:transparent;border:1px solid var(--border,rgba(127,127,127,.2));color:var(--warm-gray);border-radius:8px;padding:6px 12px;font:inherit;font-size:0.85rem;cursor:pointer;margin-left:6px;} .mu-cal-nav button:hover{color:var(--text-primary);}',
      '.mu-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border,rgba(127,127,127,.15));border:1px solid var(--border,rgba(127,127,127,.15));border-radius:12px;overflow:hidden;}',
      '.mu-cal-dow{background:var(--surface-dark,var(--bg-secondary,rgba(127,127,127,.05)));padding:8px 9px;font-size:0.72rem;text-transform:uppercase;letter-spacing:.04em;color:var(--warm-gray);}',
      '.mu-cal-cell{background:var(--surface-card,var(--card-bg,#1e1e1e));min-height:104px;padding:6px 7px;display:flex;flex-direction:column;gap:2px;}',
      '.mu-cal-cell.empty{background:transparent;}',
      '.mu-cal-day{font-size:0.78rem;color:var(--warm-gray);} .mu-cal-cell.has .mu-cal-day{color:var(--text-primary);font-weight:600;}',
      '.mu-cal-ev{display:flex;align-items:center;gap:5px;width:100%;text-align:left;background:transparent;border:0;color:var(--text-primary);font:inherit;font-size:0.72rem;padding:2px 3px;border-radius:4px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;} .mu-cal-ev:hover{background:color-mix(in srgb,var(--amber,#C4853C) 14%,transparent);}',
      '.mu-cal-dot{width:6px;height:6px;border-radius:50%;flex:0 0 6px;} .mu-cal-t{color:var(--warm-gray);}',
      '.mu-cal-more{font-size:0.72rem;color:var(--warm-gray);padding:1px 3px;}'
    ].join('\n');
    var s = document.createElement('style'); s.id = 'mast-ui-styles'; s.textContent = css; document.head.appendChild(s);
  }

  // ── prompt — a themed, self-contained input dialog. The engine replacement for
  // window.prompt (which renders in the OS style and ignores the theme). Built from
  // inline var(--…) tokens only — no shell globals, no .mu-* CSS dependency — so it
  // works anywhere the token set resolves (the admin natively; the POS via token
  // aliases). Returns a Promise<string|null> (null = cancelled). opts: { title,
  // value?, placeholder?, confirmLabel?, cancelLabel?, inputmode? }.
  function prompt(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var prev = document.getElementById('mu-prompt'); if (prev) prev.remove();
      var ov = document.createElement('div');
      ov.id = 'mu-prompt';
      ov.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;';
      ov.innerHTML =
        '<div role="dialog" aria-modal="true" style="background:var(--surface-card);border:1px solid var(--border);border-radius:12px;padding:24px;max-width:380px;width:100%;box-shadow:0 12px 40px rgba(0,0,0,0.35);">' +
          '<h3 style="margin:0 0 14px;font-size:1rem;font-weight:600;color:var(--text-primary);">' + esc(opts.title || '') + '</h3>' +
          '<input id="mu-prompt-field" type="text" inputmode="' + esc(opts.inputmode || 'text') + '" ' +
            'value="' + esc(opts.value || '') + '" placeholder="' + esc(opts.placeholder || '') + '" ' +
            'style="width:100%;padding:12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-secondary);color:var(--text-primary);font-size:16px;box-sizing:border-box;">' +
          '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px;">' +
            '<button type="button" id="mu-prompt-cancel" style="padding:10px 18px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-primary);font-size:14px;cursor:pointer;">' + esc(opts.cancelLabel || 'Cancel') + '</button>' +
            '<button type="button" id="mu-prompt-ok" style="padding:10px 18px;border-radius:8px;border:none;background:var(--amber);color:var(--amber-ink,#fff);font-weight:600;font-size:14px;cursor:pointer;">' + esc(opts.confirmLabel || 'OK') + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(ov);
      var field = ov.querySelector('#mu-prompt-field');
      var done = false;
      function close(val) { if (done) return; done = true; ov.remove(); resolve(val); }
      ov.querySelector('#mu-prompt-cancel').onclick = function () { close(null); };
      ov.querySelector('#mu-prompt-ok').onclick = function () { close(field.value); };
      field.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); close(field.value); }
        else if (e.key === 'Escape') { e.preventDefault(); close(null); }
      });
      ov.addEventListener('click', function (e) { if (e.target === ov) close(null); });
      setTimeout(function () { field.focus(); field.select(); }, 0);
    });
  }

  if (typeof window !== 'undefined') {
    injectStyles(); wireDelegates();
    window.MastUI = {
      Num: Num, badge: badge, statusBadge: statusBadge, emptyState: emptyState, tabs: tabs, list: list, slideOut: slideOut, deepLink: deepLink, prompt: prompt, _esc: esc, sanitizeHtml: sanitizeHtml,
      tiles: tiles, card: card, cardTable: cardTable, kv: kv, metricTable: metricTable, timeline: timeline, relatedTable: relatedTable,
      imageThumb: imageThumb, openImg: openImg, panelTab: panelTab, paneTabsBar: paneTabsBar,
      stickyHead: stickyHead, toggleCover: toggleCover, calendar: calendar, pageHeader: pageHeader,
      launchCard: launchCard, cardGrid: cardGrid,
      repeatRows: repeatRows, repeatRowsAdd: repeatRowsAdd, validate: validate,
      debounce: debounce, bindInstant: bindInstant, colorInput: colorInput, swatchGrid: swatchGrid
    };
  }

  // CommonJS export for node-based unit tests of the pure helpers.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Num: Num, badge: badge, statusBadge: statusBadge, emptyState: emptyState, tabs: tabs, list: list, esc: esc, tiles: tiles, kv: kv, timeline: timeline, relatedTable: relatedTable, pageHeader: pageHeader, card: card, launchCard: launchCard, cardGrid: cardGrid, repeatRows: repeatRows, validate: validate, sanitizeHtml: sanitizeHtml, _safeUrl: safeUrl, _sanitizeAllowed: SANITIZE_ALLOWED, debounce: debounce, bindInstant: bindInstant, colorInput: colorInput, swatchGrid: swatchGrid };
  }
})();
