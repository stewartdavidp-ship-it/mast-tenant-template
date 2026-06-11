/**
 * mast-entity.js — the Entity Engine (keystone, doc 15). Phase 0c.
 *
 * One declarative schema → the standard list (MastUI.list), the slide-out
 * read/edit/create surface (MastUI.slideOut), and export/import (MastIO) — all
 * on-standard BY CONSTRUCTION. A module defines a schema instead of hand-writing
 * UI, so it cannot diverge (see docs/ux-audit/16 enforcement-by-construction).
 *
 * Schema-derivation logic is pure + unit-tested; DOM rendering composes the v2
 * primitives. Specs are validated at registration (fail-loud, like MastFlow).
 *
 * MastEntity.define(key, schema); .renderList(key, opts); .openRecord(key, rec, mode);
 * .exportRows(key, rows, view). Pure: .get, .listColumns, .exportColumns,
 * .canonicalGet, .validate.
 *
 * schema = {
 *   key, label, labelPlural,
 *   fields: [{ name, label, type:'text|number|money|date|bool|select|status',
 *              required?, group?, list?:true, align?, options?, tone?(v)->tone,
 *              get?(row)->value, readOnly? }],
 *   recordId?(row)->id
 * }
 */
(function () {
  'use strict';

  var _registry = Object.create(null);

  function define(key, schema) {
    if (!key || typeof key !== 'string') throw new Error('MastEntity.define: key required');
    if (!schema || !Array.isArray(schema.fields) || !schema.fields.length) {
      throw new Error('[MastEntity] ' + key + ': fields[] required');
    }
    var seen = {}, statusCount = 0;
    schema.fields.forEach(function (f) {
      if (!f.name || !f.label) throw new Error('[MastEntity] ' + key + ': each field needs name+label');
      if (seen[f.name]) throw new Error('[MastEntity] ' + key + ': duplicate field ' + f.name);
      seen[f.name] = 1;
      if (f.type === 'status') statusCount++;
    });
    if (statusCount > 1) throw new Error('[MastEntity] ' + key + ': at most one status field');
    schema.key = key;
    schema.recordId = schema.recordId || function (r) { return r && r.id; };
    _registry[key] = schema;
    return schema;
  }

  function get(key) { return _registry[key]; }

  // ── Pure derivations ────────────────────────────────────────────────
  function fieldValue(f, row) { return (typeof f.get === 'function') ? f.get(row) : (row ? row[f.name] : undefined); }

  // canonical (file/export) string for a field value — no symbols/separators
  function canonicalGet(f, row) {
    var v = fieldValue(f, row);
    if (v == null) return '';
    switch (f.type) {
      case 'money': return isNaN(v) ? '' : Number(v).toFixed(2);
      case 'number': return isNaN(v) ? '' : String(Number(v));
      case 'date': { var d = new Date(v); return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10); }
      case 'bool': return v ? 'true' : 'false';
      case 'tags': return Array.isArray(v) ? v.join('; ') : String(v);
      default: return String(v);
    }
  }

  function exportColumns(key) {
    var s = _registry[key]; if (!s) return [];
    return s.fields.map(function (f) {
      return { key: f.name, label: f.label, get: function (row) { return canonicalGet(f, row); } };
    });
  }

  function listColumns(key) {
    var s = _registry[key]; if (!s) return [];
    return s.fields.filter(function (f) { return f.list; }).map(function (f) {
      return {
        key: f.name, label: f.label,
        align: f.align || (f.type === 'money' || f.type === 'number' ? 'right' : 'left'),
        sortable: f.sortable !== false,
        render: function (row) { return displayCell(f, row); }
      };
    });
  }

  function validate(key, record) {
    var s = _registry[key]; if (!s) return { ok: false, errors: ['unknown entity'] };
    var errors = [];
    s.fields.forEach(function (f) {
      var v = record ? record[f.name] : undefined;
      if (f.required && (v == null || v === '')) errors.push(f.label + ' is required');
      else if ((f.type === 'number' || f.type === 'money') && v != null && v !== '' && isNaN(v)) {
        errors.push(f.label + ' must be a number');
      }
    });
    return { ok: errors.length === 0, errors: errors };
  }

  // ── Display helpers (browser; degrade gracefully without MastUI) ─────
  function esc(s) { return (window.MastUI && window.MastUI._esc) ? window.MastUI._esc(s) : String(s == null ? '' : s); }
  var DASH = '<span style="color:var(--warm-gray);">—</span>';   // one em-dash for every empty scalar
  function displayCell(f, row) {
    var v = fieldValue(f, row);
    var N = window.MastUI && window.MastUI.Num;
    var empty = (v == null || v === '');
    if (f.type === 'money') { var m = N ? N.money(v) : (empty ? '' : '$' + v); return m === '' ? DASH : m; }
    if (f.type === 'date') { var d = N ? N.date(v) : esc(v); return d === '' ? DASH : d; }
    if (f.type === 'number') return empty ? DASH : (N ? N.count(v) : esc(v));
    if ((f.type === 'status' || f.tone) && window.MastUI) {
      if (empty) return DASH;
      var tone = (typeof f.tone === 'function') ? f.tone(v) : 'neutral';
      // f.format maps a stored enum to its display label ('in_progress' →
      // "Working on it") without changing the stored value sort/filter see.
      var label = (typeof f.format === 'function') ? f.format(v) : v;
      return window.MastUI.badge(label, tone);
    }
    if (f.type === 'tags') {
      var arr = Array.isArray(v) ? v : (v ? [v] : []);
      if (!arr.length) return DASH;
      return arr.map(function (x) {
        return '<span style="display:inline-block;font-size:0.72rem;padding:2px 8px;border-radius:999px;background:var(--bg-secondary,rgba(127,127,127,.1));border:1px solid var(--border,rgba(127,127,127,.2));color:var(--warm-gray);margin:1px 4px 1px 0;">' + esc(x) + '</span>';
      }).join('');
    }
    // Defensive: never render a raw object as "[object Object]". A field whose
    // value is an object must declare a get()/render that returns a string.
    if (v && typeof v === 'object') return DASH;
    return empty ? DASH : esc(v);
  }

  // ── DOM: list + record surface (compose v2 primitives) ──────────────
  function renderList(key, opts) {
    opts = opts || {};
    return window.MastUI.list({
      columns: opts.columns || listColumns(key),
      rows: opts.rows || [],
      sortKey: opts.sortKey, sortDir: opts.sortDir, onSortFnName: opts.onSortFnName,
      onRowClickFnName: opts.onRowClickFnName,
      rowId: opts.rowId || (_registry[key] && _registry[key].recordId),
      empty: opts.empty, loading: opts.loading,
      // Opt-in expandable rows (additive — see MastUI.list).
      expandable: opts.expandable, hasChildren: opts.hasChildren,
      expandedIds: opts.expandedIds, onToggleFnName: opts.onToggleFnName,
      childRowsHtml: opts.childRowsHtml, rowActions: opts.rowActions,
      // Opt-in selectable rows (bulk actions — see MastUI.list).
      selectable: opts.selectable, selectedIds: opts.selectedIds,
      onSelectFnName: opts.onSelectFnName, onSelectAllFnName: opts.onSelectAllFnName
    });
  }

  // Is this field an editable control in edit/create mode? (computed/read-only
  // and status-in-read are NOT). Mirrors the branch logic below.
  function _isEditable(f) {
    return !(f.readOnly || typeof f.get === 'function');
  }

  // One read-only label→value row (group header carries the section name, so a
  // field label equal to the group is suppressed to avoid the doubled label).
  function _roRow(f, record, group) {
    var showLabel = String(f.label).toLowerCase() !== String(group || '').toLowerCase();
    return '<div class="form-group" style="margin-bottom:10px;">' +
      (showLabel ? '<div class="form-label" style="font-size:0.78rem;color:var(--warm-gray);">' + esc(f.label) + '</div>' : '') +
      '<div style="font-size:0.9rem;color:var(--text-primary);">' + displayCell(f, record) + '</div></div>';
  }

  // One editable control (select for enums, text input otherwise).
  function _editControl(f, record) {
    var v = record ? record[f.name] : '';
    if ((f.type === 'select' || f.type === 'status') && Array.isArray(f.options) && f.options.length) {
      var cur = (v == null ? '' : String(v));
      var optsHtml = f.options.map(function (o) {
        var ov = (o && typeof o === 'object') ? o.value : o;
        var ol = (o && typeof o === 'object') ? (o.label || o.value) : o;
        return '<option value="' + esc(ov) + '"' + (String(ov) === cur ? ' selected' : '') + '>' + esc(ol) + '</option>';
      }).join('');
      return '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">' + esc(f.label) + (f.required ? ' *' : '') + '</label>' +
        '<select class="form-input" name="' + esc(f.name) + '" style="width:100%;">' + optsHtml + '</select></div>';
    }
    var sval = (v == null) ? '' : (typeof v === 'object' ? canonicalGet(f, record) : v);
    if (f.type === 'textarea') {
      return '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">' + esc(f.label) + (f.required ? ' *' : '') + '</label>' +
        '<textarea class="form-input" name="' + esc(f.name) + '" rows="' + (f.rows || 4) + '" style="width:100%;resize:vertical;box-sizing:border-box;">' + esc(sval) + '</textarea></div>';
    }
    return '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">' + esc(f.label) + (f.required ? ' *' : '') + '</label>' +
      '<input class="form-input" name="' + esc(f.name) + '" value="' + esc(sval) + '" style="width:100%;"></div>';
  }

  // Edit/create form (designed). Leads with the editable fields in cards (one
  // per group that has any), then a single quiet read-only "Details" card with
  // the remaining context — so the thing you can change is never buried under
  // greyed-out values (the old flat-stack edit panel). Read mode still uses the
  // simple value layout via _readFormHtml.
  function _formHtml(key, record, mode) {
    var s = _registry[key];
    var card = window.MastUI.card;   // section card (title + bordered body)
    if (mode === 'read') return _readFormHtml(s, record);
    // Custom edit/create interior — the symmetric opt-in to detail.render (read).
    // For records whose editable controls exceed the generic field form (dates,
    // checkboxes, a multi-select scope picker). The schema's onSave reads the DOM.
    if (s.detail && typeof s.detail.editRender === 'function') return s.detail.editRender(record, mode);

    // Partition fields into editable (status included in edit/create) and
    // read-only context, preserving declaration order within each group.
    var editGroups = {}, editOrder = [], roFields = [];
    s.fields.forEach(function (f) {
      if (_isEditable(f)) {
        var g = f.group || 'Details';
        if (!editGroups[g]) { editGroups[g] = []; editOrder.push(g); }
        editGroups[g].push(f);
      } else {
        roFields.push(f);
      }
    });

    var html = '<div class="mu-editbar"><span class="mu-editpill">' +
      (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' +
      esc(editOrder.length ? ('Update ' + editOrder.map(function (g) { return g.toLowerCase(); }).join(' & ')) : 'Edit this record') +
      '</div>';

    editOrder.forEach(function (g) {
      var inner = editGroups[g].map(function (f) { return _editControl(f, record); }).join('');
      html += card(g, inner);
    });

    // Always-visible read-only context (Option C). Skip in create (no context yet).
    if (mode !== 'create' && roFields.length) {
      var rows = roFields.map(function (f) { return _roRow(f, record, 'Details'); }).join('');
      html += card('Details', rows);
    }
    return html;
  }

  // Read-mode fallback form (when no designed detail template) — grouped
  // value rows, label suppressed when it duplicates the group header.
  function _readFormHtml(s, record) {
    var groups = {}, order = [];
    s.fields.forEach(function (f) {
      if (f.type === 'status') return;   // status shown as the header badge in read
      var g = f.group || 'Details';
      if (!groups[g]) { groups[g] = []; order.push(g); }
      groups[g].push(f);
    });
    var html = '';
    order.forEach(function (g) {
      html += '<div style="margin-bottom:18px;"><div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">' + esc(g) + '</div>';
      groups[g].forEach(function (f) { html += _roRow(f, record, g); });
      html += '</div>';
    });
    return html;
  }

  // ── Designed detail templates (read mode) ──────────────────────────
  var _current = null;     // {key,id,label,record} of the open record
  var _panelStack = [];    // ancestors for in-panel drill-back: [{key,record,label}]

  function chips(labels) {
    return '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + (labels || []).map(function (l) {
      return '<span style="font-size:0.72rem;padding:3px 10px;border-radius:999px;background:var(--bg-secondary,rgba(127,127,127,.08));border:1px solid var(--border,rgba(127,127,127,.2));color:var(--warm-gray);">' + esc(l) + '</span>';
    }).join('') + '</div>';
  }
  function crumbHtml() {
    if (_panelStack.length) {
      return '<div class="mu-crumb"><button onclick="MastEntity.back()">← ' + esc(_panelStack[_panelStack.length - 1].label || 'Back') + '</button></div>';
    }
    return '';
  }
  function renderDetail(s, r) {
    var d = s.detail || {};
    if (d.template === 'transaction') return renderTransaction(window.MastUI, d, r);
    if (d.template === 'party') return renderParty(window.MastUI, d, r);
    // Custom read interior (doc 17 §1: "write an interior renderer + let a schema
    // opt into it"). The renderer composes the same MastUI primitives the built-in
    // templates use — so it inherits the shell and can't drift. Used by records
    // that fit neither stock template (e.g. a promotion: config + product scope).
    if (typeof d.render === 'function') return d.render(window.MastUI, r);
    return _formHtml(s.key, r, 'read');
  }
  function drillLink(entityKey, id, text) {
    return '<button type="button" class="mu-link" onclick="MastEntity.drill(\'' + entityKey + '\',\'' + esc(String(id)) + '\')">' + esc(text) + '</button>';
  }
  function renderTransaction(U, d, r) {
    var m = function (x) { return U.Num.money(x) || '—'; };   // absent money → em-dash; genuine 0 → $0.00
    var cust = d.customer ? d.customer(r) : null;
    var custBlock = cust ? (
      '<div style="font-weight:600;">' + (cust.id ? drillLink(d.customerEntity || 'customers-v2', cust.id, cust.name || cust.email) : esc(cust.name || cust.email)) + '</div>' +
      '<div class="mu-sub" style="margin:2px 0 10px;">' + esc(cust.email || '') + '</div>' +
      (cust.address ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;">' + cust.address + '</div>' : '')
    ) : '<span class="mu-sub">—</span>';
    var items = (d.lineItems ? d.lineItems(r) : []) || [];
    var itemRows = items.map(function (it) {
      return '<tr><td><div class="mu-li">' + U.imageThumb(it.name || '') + '<div>' + esc(it.name || '') + (it.variant ? '<div class="mu-sub">' + esc(it.variant) + '</div>' : '') + '</div></div></td>' +
        '<td class="r">' + esc(it.qty) + '</td><td class="r">' + m(it.price) + '</td><td class="r">' + m(it.total) + '</td></tr>';
    }).join('');
    var itemsTable = '<table class="mu-rel"><thead><tr><th>Product</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Total</th></tr></thead><tbody>' + itemRows + '</tbody></table>';
    var t = (d.totals ? d.totals(r) : {}) || {};
    var totalsHtml = '<div class="mu-totrow"><span>Subtotal</span><span>' + m(t.subtotal) + '</span></div>' +
      '<div class="mu-totrow"><span>Shipping</span><span>' + m(t.shipping) + '</span></div>' +
      '<div class="mu-totrow"><span>Tax</span><span>' + m(t.tax) + '</span></div>' +
      '<div class="mu-totrow grand"><span>Total</span><span>' + m(t.total) + '</span></div>';
    // Process variant (doc 17 §3c, hoisted 2026-06-10 to match products-v2):
    // when the schema declares detail.flow, the lifecycle is governed by
    // MastFlow — and the process is PINNED STRUCTURE above the tab bar (always
    // visible on every pane, collapsible via the chevron _flowRender adds),
    // NOT a tab. Wired async by _initEntityFlow. No status dropdown; status
    // moves through the workflow.
    if (d.flow) {
      return U.stickyHead(U.tiles(d.tiles ? d.tiles(r) : []), '') +
        '<div id="muFlowHost" style="font-size:0.85rem;color:var(--warm-gray);margin:6px 0 14px;">Loading workflow…</div>' +
        U.paneTabsBar([{ key: 'items', label: 'Items' }, { key: 'customer', label: 'Customer' }, { key: 'history', label: 'History' }], 'items') +
        '<div class="mu-pane" data-pane="items">' + U.cardTable('Items', itemsTable) + U.card('Summary', totalsHtml) + '</div>' +
        '<div class="mu-pane" data-pane="customer" hidden>' + U.card('Customer & shipping', custBlock) + '</div>' +
        '<div class="mu-pane" data-pane="history" hidden>' + U.card('Timeline', U.timeline(d.timeline ? d.timeline(r) : [])) + '</div>';
    }
    var ful = (d.fulfillment ? d.fulfillment(r) : {}) || {};
    var fulHtml = U.kv([{ k: 'Status', v: U.badge(ful.status || '—', ful.tone || 'neutral') }, { k: 'Tracking', v: ful.tracking || '—' }]);
    return U.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'items', label: 'Items' }, { key: 'ful', label: 'Fulfillment' }, { key: 'act', label: 'Activity' }], 'ov') +
      '<div class="mu-pane" data-pane="ov">' + U.tiles(d.tiles ? d.tiles(r) : []) + U.card('Customer & shipping', custBlock) + '</div>' +
      '<div class="mu-pane" data-pane="items" hidden>' + U.cardTable('Items', itemsTable) + U.card('Summary', totalsHtml) + '</div>' +
      '<div class="mu-pane" data-pane="ful" hidden>' + U.card('Fulfillment', fulHtml) + '</div>' +
      '<div class="mu-pane" data-pane="act" hidden>' + U.card('Timeline', U.timeline(d.timeline ? d.timeline(r) : [])) + '</div>';
  }
  function renderParty(U, d, r) {
    var c = (d.contact ? d.contact(r) : {}) || {};
    var loc = c.location ? (c.contactId ? drillLink(d.contactEntity || 'contacts-v2', c.contactId, c.location) : esc(c.location)) : '—';
    var contactHtml = U.kv([{ k: 'Email', v: esc(c.email || '') }, { k: 'Location', v: loc }]);
    var orders = (d.relatedOrders ? d.relatedOrders(r) : []) || [];
    var oe = d.orderEntity || 'orders-v2';
    var ordersTable = U.relatedTable([
      { label: 'Order', render: function (o) { return drillLink(oe, o.id, o.number || o.id); } },
      { label: 'Date', render: function (o) { return '<span class="mu-sub">' + esc(o.date) + '</span>'; } },
      { label: 'Total', align: 'right', render: function (o) { return U.Num.money(o.total) || '—'; } },
      { label: 'Status', render: function (o) { return U.badge(o.status, o.tone); } }
    ], orders);
    var notes = (d.notes ? d.notes(r) : '') || '';

    // Base facets: Overview + Orders. Optional facets (Activity/Classes/Wallet)
    // render only when the schema supplies their data fn — so a sparse party
    // record stays simple. Notes is always last.
    var tabs = [{ key: 'ov', label: 'Overview' }, { key: 'orders', label: 'Orders' }];
    var panes = '<div class="mu-pane" data-pane="ov">' + U.card('Contact', contactHtml) + U.card('Segments', chips(d.segments ? d.segments(r) : [])) + '</div>' +
      '<div class="mu-pane" data-pane="orders" hidden>' + U.cardTable('Orders (' + orders.length + ')', ordersTable) + '</div>';

    if (typeof d.activity === 'function') {
      var acts = d.activity(r) || [];
      tabs.push({ key: 'activity', label: 'Activity' });
      panes += '<div class="mu-pane" data-pane="activity" hidden>' +
        U.card('Activity', acts.length ? U.timeline(acts) : '<span class="mu-sub">No activity yet</span>') + '</div>';
    }
    if (typeof d.classes === 'function') {
      var cls = d.classes(r) || [];
      tabs.push({ key: 'classes', label: 'Classes' });
      var clsBody = cls.length ? U.cardTable('Enrollments (' + cls.length + ')', U.relatedTable([
        { label: 'Class', render: function (e) { return esc(e.name || '—'); } },
        { label: 'Session', render: function (e) { return '<span class="mu-sub">' + esc(e.session || '') + '</span>'; } },
        { label: 'Status', render: function (e) { return U.badge(e.status || '—', e.tone || 'neutral'); } }
      ], cls)) : U.card('Enrollments', '<span class="mu-sub">No enrollments</span>');
      panes += '<div class="mu-pane" data-pane="classes" hidden>' + clsBody + '</div>';
    }
    if (typeof d.wallet === 'function') {
      var w = d.wallet(r) || {};
      tabs.push({ key: 'wallet', label: 'Wallet' });
      var walletInner = w.linked
        ? U.kv([{ k: 'Store credit', v: w.credit }, { k: 'Passes', v: w.passes }, { k: 'Membership', v: w.membership }, { k: 'Loyalty points', v: w.loyalty }])
        : '<span class="mu-sub">No linked account — wallet, passes, membership and loyalty live on a customer-facing account. This customer hasn\'t signed in yet.</span>';
      panes += '<div class="mu-pane" data-pane="wallet" hidden>' + U.card('Wallet', walletInner) + '</div>';
    }

    tabs.push({ key: 'notes', label: 'Notes' });
    panes += '<div class="mu-pane" data-pane="notes" hidden>' + U.card('Notes', notes ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;">' + esc(notes) + '</div>' : '<span class="mu-sub">No notes</span>') + '</div>';

    return U.stickyHead(U.tiles(d.tiles ? d.tiles(r) : []), U.paneTabsBar(tabs, 'ov')) + panes;
  }

  // Drill to another object: re-render the SAME panel with the target record and
  // push the current record onto a PANEL-LOCAL stack for back. No route change —
  // route-level nav (MastNavStack) would swap the list underneath and race the
  // overlay-close. The panel stays open across the whole chain.
  function drill(targetKey, id, _retried) {
    var ts = _registry[targetKey];
    // The target entity's schema lives in its module, which may not be loaded
    // yet (e.g. drilling Order→Customer from the orders page). Lazy-load once, retry.
    if (!ts) {
      if (!_retried && window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        MastAdmin.loadModule(targetKey).then(function () { drill(targetKey, id, true); })
          .catch(function () { if (window.showToast) showToast('Could not load ' + targetKey, true); });
        return;
      }
      if (window.showToast) showToast('Cannot open ' + targetKey + ' (not available)', true);
      return;
    }
    if (typeof ts.fetch !== 'function') { if (window.showToast) showToast('Cannot open ' + targetKey + ' (not available)', true); return; }
    if (_current) {
      // Remember which pane tab the user drilled FROM so Back returns there
      // (a fresh re-render otherwise defaults to the first tab).
      var _db = document.getElementById('mastSlideOutBody');
      var _vis = _db && _db.querySelector('.mu-pane:not([hidden])');
      _panelStack.push({ key: _current.key, record: _current.record, label: _current.label, pane: _vis && _vis.getAttribute('data-pane') });
    }
    Promise.resolve(ts.fetch(id)).then(function (rec) {
      if (rec) openRecord(targetKey, rec, 'read', true);
      else { _panelStack.pop(); if (window.showToast) showToast('Not found', true); }
    }).catch(function (e) { _panelStack.pop(); console.error('[MastEntity.drill]', e); if (window.showToast) showToast('Could not open record', true); });
  }
  // Back one level in the panel-local drill chain — re-render the previous record
  // in place (no route nav, panel stays open).
  function back() {
    var prev = _panelStack.pop();
    if (!prev) return;
    openRecord(prev.key, prev.record, 'read', true);
    // Restore the tab the user drilled from (re-render defaults to the first tab).
    if (prev.pane) {
      setTimeout(function () {
        var body = document.getElementById('mastSlideOutBody');
        var btn = body && body.querySelector('.mu-ptabs button[onclick*="\'' + prev.pane + '\'"]');
        if (btn) btn.click();
      }, 0);
    }
  }

  // ── MastFlow integration (Process variant; doc 17 §2/§3c) ───────────
  // A schema with detail.flow composes the existing process-flow engine instead
  // of modelling status as a field: the Process pane hosts MastFlow.renderHeader
  // (stepper + phase checklist + ONE guarded Advance). Mirrors legacy
  // orders.js _initOrderWorkflowHeader, but generic over any flow-bearing entity.
  var _flow = null;  // { schema, record, flowKey, fromPhase } — one panel open at a time

  function _initEntityFlow(s, record) {
    var d = s.detail;
    if (!d || !d.flow || !window.MastAdmin || typeof MastAdmin.loadModule !== 'function') return;
    record.id = record.id || s.recordId(record);
    _flow = { key: s.key, schema: s, record: record, flowKey: d.flow, fromPhase: null };
    // Engine first (it registers window.MastFlow before the spec IIFE checks for it), then the spec.
    MastAdmin.loadModule('workflowEngine')
      .then(function () { return d.flowModule ? MastAdmin.loadModule(d.flowModule) : null; })
      .then(function () { if (!window.MastFlow) throw new Error('MastFlow not loaded'); _flowRender(); })
      .catch(function (e) {
        console.error('[MastEntity] flow init failed', e);
        var host = document.getElementById('muFlowHost');
        if (host) host.innerHTML = '<span style="color:var(--danger,#b81d1d);">Workflow failed to load.</span>';
      });
  }

  function _flowRender() {
    if (!_flow || !window.MastFlow) return;
    var fk = _flow.flowKey;
    var _d = _flow.schema && _flow.schema.detail;
    // DEFAULT (flipped 2026-06-10, PR C of the process redesign): the guided
    // record header — clickable step rail, red bypassed stages, per-requirement
    // overrides, no Advance/Back buttons — is the standard for every flow
    // surface. A schema may opt OUT with detail.guidedHeader === false (none
    // do today; the classic renderHeader remains only for legacy maker.js).
    var _renderFn = (!(_d && _d.guidedHeader === false) && typeof window.MastFlow.renderGuidedHeader === 'function')
      ? window.MastFlow.renderGuidedHeader
      : window.MastFlow.renderHeader;
    _renderFn(fk, _flow.record, {
      onAdvance: function (target) {
        // A schema may claim the advance — e.g. route to a side-effect-bearing
        // legacy promote/launch (products: Shopify publish on launch) instead of
        // the generic status transition. Returning anything but false = handled.
        // Mirrors detail.onFlowTarget. Schemas without the hook are unchanged.
        if (_d && typeof _d.onFlowAdvance === 'function' && _d.onFlowAdvance(target, _flow.record) !== false) return;
        _flowTransition(target);
      },
      onBack: function (target) { _flowTransition(target); },
      onBranch: function (choiceKey, entryPhase) { _flowTransition(entryPhase, choiceKey); },
      onTarget: function (targetId) { _flowGoTarget(targetId); },
      // Engine-side state changed without a phase transition (e.g. a
      // requirement override) — re-render the header from the live record.
      onRefresh: function () { _flowRender(); }
    }, { expandCurrent: !!(_d && _d.guidedExpandCurrent) }).then(function (res) {
      var host = document.getElementById('muFlowHost');
      if (host) {
        // The process is pinned structure above the tabs — give it an explicit
        // collapse chevron (persisted per-user) so a long rail can get out of
        // the way. Tucked end-state records keep their own hide behavior; the
        // chevron wraps the normal always-visible case.
        if (res.tucked) {
          host.innerHTML = res.html;
        } else {
          var collapsed = false;
          try { collapsed = localStorage.getItem('mastFlowRailCollapsed') === '1'; } catch (e) {}
          var phaseLabel = (res.evaluation && res.evaluation.currentPhase) ? res.evaluation.currentPhase.label : '';
          host.innerHTML =
            '<div style="display:flex;align-items:center;gap:8px;">' +
              '<button type="button" id="muFlowChevron" aria-expanded="' + (!collapsed) + '" ' +
                'style="background:none;border:none;cursor:pointer;color:var(--warm-gray);font-size:0.78rem;padding:2px 4px;display:inline-flex;align-items:center;gap:6px;">' +
                '<span id="muFlowChevronArrow" style="display:inline-block;transition:transform 0.15s;' + (collapsed ? '' : 'transform:rotate(90deg);') + '">▶</span>' +
                '<span style="text-transform:uppercase;letter-spacing:0.5px;">Process</span>' +
              '</button>' +
              '<span id="muFlowChevronPhase" class="mu-sub" style="' + (collapsed ? '' : 'display:none;') + '">· ' + phaseLabel + '</span>' +
            '</div>' +
            '<div id="muFlowRailBody" style="' + (collapsed ? 'display:none;' : '') + '">' + res.html + '</div>';
          var chev = document.getElementById('muFlowChevron');
          if (chev) chev.onclick = function () {
            var body = document.getElementById('muFlowRailBody');
            var arrow = document.getElementById('muFlowChevronArrow');
            var ph = document.getElementById('muFlowChevronPhase');
            var nowCollapsed = body && body.style.display !== 'none';
            if (body) body.style.display = nowCollapsed ? 'none' : '';
            if (arrow) arrow.style.transform = nowCollapsed ? '' : 'rotate(90deg)';
            if (ph) ph.style.display = nowCollapsed ? '' : 'none';
            chev.setAttribute('aria-expanded', String(!nowCollapsed));
            try { localStorage.setItem('mastFlowRailCollapsed', nowCollapsed ? '1' : '0'); } catch (e) {}
          };
        }
      }
      _flow.fromPhase = (res.evaluation && res.evaluation.currentPhase) ? res.evaluation.currentPhase.key : null;
      // Tucked live/active end-state (guided header): the rail is hidden — make
      // the slide-out status pill reveal it on click ("once Active the process
      // bar goes away; click the Active pill and it shows up").
      if (res.tucked && res.railWrapId) {
        var pill = document.querySelector('#mastSlideOutBody .mast-badge');
        if (pill) {
          pill.style.cursor = 'pointer';
          pill.title = 'Show lifecycle';
          pill.onclick = function () {
            var w = document.getElementById(res.railWrapId);
            if (w) w.style.display = (w.style.display === 'none') ? 'block' : 'none';
          };
        }
      }
    }).catch(function (e) { console.error('[MastEntity] renderHeader', e); });
  }

  function _flowTransition(targetPhaseKey, branchChoice) {
    if (!_flow || !window.MastFlow) return;
    var s = _flow.schema, rec = _flow.record, fk = _flow.flowKey;
    var opts = { recordId: rec.id, expectedFromPhase: _flow.fromPhase };
    if (branchChoice) opts.branchChoice = branchChoice;
    window.MastFlow.transition(fk, rec, targetPhaseKey, opts).then(function () {
      if (window.showToast) showToast('Advanced to ' + String(targetPhaseKey).replace(/[-_]/g, ' '));
      // Re-open the whole panel from fresh data so the header status badge + all
      // panes reflect the new phase (not just the flow host). Re-inits the flow.
      if (typeof s.fetch === 'function') {
        return Promise.resolve(s.fetch(rec.id)).then(function (fresh) {
          if (fresh) { fresh.id = fresh.id || s.recordId(fresh); openRecord(_flow.key, fresh, 'read', true); }
          else _flowRender();
        });
      }
      _flowRender();
    }).catch(function (e) {
      console.error('[MastEntity] transition', e);
      var msg = (e && e.code === 'STALE_STATE') ? 'Record changed elsewhere — reopen to continue'
        : ('Could not advance: ' + (e && e.message || e));
      if (window.showToast) showToast(msg, true);
    });
  }

  // Checklist "Go →" target → switch to the relevant detail pane. A schema may
  // supply detail.onFlowTarget(targetId, record) to route its own requirement
  // targets (e.g. deep-link a side-effect-bearing capture to the legacy detail);
  // returning anything other than false marks the target handled. Falls back to
  // the built-in transaction-pane map (orders) when no schema hook claims it.
  function _flowGoTarget(targetId) {
    var sc = _flow && _flow.schema;
    if (sc && sc.detail && typeof sc.detail.onFlowTarget === 'function') {
      if (sc.detail.onFlowTarget(targetId, _flow.record) !== false) return;
    }
    var map = { 'detail-items': 'items', 'detail-payment': 'items', 'detail-customer': 'customer', 'detail-shipping': 'customer' };
    var pane = map[targetId];
    if (!pane) { if (targetId === 'buy-labels' && typeof navigateTo === 'function') navigateTo('ship'); return; }
    var body = document.getElementById('mastSlideOutBody'); if (!body) return;
    var btn = body.querySelector('.mu-ptabs button[onclick*="\'' + pane + '\'"]');
    if (btn) btn.click();
  }

  // Resolve the slide-out title ("Order: SGTE-0188"). The lead field (fields[0])
  // is read from the RAW record property; when that's empty but the field is
  // computed via get(), fall back to get() — so a schema whose title source is
  // materialized via get() (a name with a default, a derived label) titles
  // properly instead of as a bare id. Then fall back to a stable identifier so
  // the title is never just the bare type label. Pure → unit-tested.
  function recordTitle(s, record, mode, key) {
    if (mode === 'create') return 'New ' + (s.label || key);
    var f0 = s.fields[0];
    var name = (record && record[f0.name]) || '';
    if (!name && record && typeof f0.get === 'function') {
      try { name = f0.get(record) || ''; } catch (e) {}
    }
    if (!name && record) name = record.email || record.primaryEmail || record.orderNumber || s.recordId(record) || '';
    return name ? ((s.label ? s.label + ': ' : '') + name) : (s.label || key);
  }

  // Header badge for the record SO — pure (unit-tested). Honors the status
  // field's get() like every other read path: a raw record value can be a
  // non-display type (channels-v2: isActive=true rendered "• true").
  function statusBadge(s, record) {
    var f = s.fields.filter(function (x) { return x.type === 'status'; })[0];
    if (!f || !record) return [];
    var v = f.get ? f.get(record) : record[f.name];
    var label = (typeof f.format === 'function') ? f.format(v) : v;
    return [{ label: label, tone: (f.tone ? f.tone(v) : 'neutral') }];
  }

  function openRecord(key, record, mode, _internal) {
    var s = _registry[key]; if (!s) return;
    mode = mode || 'read';
    // A fresh open (from a list) resets the drill chain; drill/back pass _internal.
    if (!_internal) _panelStack = [];
    var badges = statusBadge(s, record);
    var baseline = JSON.stringify(record || {});
    // Prefix the title with the object type ("Order: SGTE-0188") so it's always
    // clear which kind of record you're on — important when drilling across types.
    var titleText = recordTitle(s, record, mode, key);
    _current = { key: key, id: s.recordId(record), label: titleText, record: record };
    window.MastUI.slideOut.open({
      id: s.recordId(record) || 'new',
      title: titleText,
      size: s.size || 'md',
      mode: mode,
      badges: badges,
      // Read mode offers Edit (→ in-place edit mode) when the entity is editable.
      actions: (mode === 'read' && typeof s.onSave === 'function')
        ? [{ label: 'Edit', primary: true, onClickFnName: 'MastUI.slideOut.edit' }] : undefined,
      // Read mode → designed category template (if declared); else the form.
      // A flow-bearing schema wires its MastFlow header after the DOM lands
      // (covers first open + edit→read re-render; loadModule is cached).
      render: function (ctx) {
        if (ctx.mode === 'read' && s.detail) {
          if (s.detail.flow) setTimeout(function () { _initEntityFlow(s, record); }, 0);
          return crumbHtml() + renderDetail(s, record);
        }
        return _formHtml(key, record, ctx.mode);
      },
      isDirty: function () {
        var panel = document.getElementById('mastSlideOutBody');
        if (!panel) return false;
        var cur = {};
        panel.querySelectorAll('input[name],select[name],textarea[name]').forEach(function (i) { cur[i.name] = i.value; });
        var snap = JSON.parse(baseline);
        return s.fields.some(function (f) { return (f.name in cur) && String(cur[f.name]) !== String(snap[f.name] == null ? '' : snap[f.name]); });
      },
      onSave: function () {
        var panel = document.getElementById('mastSlideOutBody');
        // Start from the original record so read-only/required fields (not
        // rendered as inputs) are still present for validation + persistence.
        var rec = Object.assign({}, record || {});
        panel.querySelectorAll('input[name],select[name],textarea[name]').forEach(function (i) { rec[i.name] = i.value; });
        var v = validate(key, rec);
        if (!v.ok) { if (window.showToast) showToast(v.errors[0], true); return false; }
        return s.onSave ? s.onSave(rec, mode) : true;
      }
    });
    // Cancel-on-leave: register the schema's pane-leave hook (or clear any prior
    // one) so a tab switch cancels in-pane edits. Re-registered on every open /
    // drill / back, so it always matches the record currently on screen.
    if (window.MastUI && window.MastUI.slideOut && typeof window.MastUI.slideOut.onPaneLeave === 'function') {
      var onLeave = s.detail && typeof s.detail.onPaneLeave === 'function' ? s.detail.onPaneLeave : null;
      window.MastUI.slideOut.onPaneLeave(onLeave ? function (prev, next) { onLeave(prev, next, record); } : null);
    }
  }

  function exportRows(key, rows, view) {
    return window.MastIO.exportCsv({ rows: rows || [], columns: exportColumns(key), module: key, view: view || 'all' });
  }

  // The record currently shown in the detail slide-out: {key, id, label, record}
  // or null. Lets surfaces (e.g. MastAskAi.openCurrent) hydrate the open record
  // without each one re-deriving "what's on screen". Reflects drill/back, so it
  // always matches the record actually visible.
  function getCurrent() { return _current; }

  var api = {
    define: define, get: get, listColumns: listColumns, exportColumns: exportColumns,
    canonicalGet: canonicalGet, validate: validate,
    renderList: renderList, openRecord: openRecord, exportRows: exportRows,
    drill: drill, drillLink: drillLink, back: back, getCurrent: getCurrent
  };
  if (typeof window !== 'undefined') window.MastEntity = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { define: define, get: get, listColumns: listColumns, exportColumns: exportColumns, canonicalGet: canonicalGet, validate: validate, recordTitle: recordTitle, statusBadge: statusBadge };
  }
})();
