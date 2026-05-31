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
      return window.MastUI.badge(v, tone);
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
      columns: listColumns(key),
      rows: opts.rows || [],
      sortKey: opts.sortKey, sortDir: opts.sortDir, onSortFnName: opts.onSortFnName,
      onRowClickFnName: opts.onRowClickFnName,
      rowId: _registry[key] && _registry[key].recordId,
      empty: opts.empty, loading: opts.loading
    });
  }

  function _formHtml(key, record, mode) {
    var s = _registry[key];
    var groups = {};
    s.fields.forEach(function (f) {
      if (f.type === 'status' && mode !== 'edit' && mode !== 'create') return;
      var g = f.group || 'Details';
      (groups[g] = groups[g] || []).push(f);
    });
    var html = '';
    Object.keys(groups).forEach(function (g) {
      html += '<div style="margin-bottom:18px;"><div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px;">' + esc(g) + '</div>';
      groups[g].forEach(function (f) {
        var v = record ? record[f.name] : '';
        if (mode === 'read') {
          // Suppress the field label when it duplicates its group header (e.g.
          // group "Order" + field "Order") — avoids the double-label.
          var showLabel = String(f.label).toLowerCase() !== String(g).toLowerCase();
          html += '<div class="form-group" style="margin-bottom:10px;">' +
                  (showLabel ? '<div class="form-label" style="font-size:0.78rem;color:var(--warm-gray);">' + esc(f.label) + '</div>' : '') +
                  '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));">' + displayCell(f, record) + '</div></div>';
        } else if (f.readOnly || typeof f.get === 'function') {
          // Computed/read-only fields show their value (not an editable input) —
          // avoids "[object Object]" for derived fields and uneditable identity fields.
          html += '<div class="form-group" style="margin-bottom:12px;"><div class="form-label" style="font-size:0.78rem;color:var(--warm-gray);">' + esc(f.label) + '</div>' +
                  '<div style="font-size:0.9rem;color:var(--charcoal,var(--text));">' + displayCell(f, record) + '</div></div>';
        } else if ((f.type === 'select' || f.type === 'status') && Array.isArray(f.options) && f.options.length) {
          // Enum fields edit as a constrained <select> (not a free-text input
          // that accepts "banana"). options: ['a',...] or [{value,label},...].
          var cur = (v == null ? '' : String(v));
          var optsHtml = f.options.map(function (o) {
            var ov = (o && typeof o === 'object') ? o.value : o;
            var ol = (o && typeof o === 'object') ? (o.label || o.value) : o;
            return '<option value="' + esc(ov) + '"' + (String(ov) === cur ? ' selected' : '') + '>' + esc(ol) + '</option>';
          }).join('');
          html += '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">' + esc(f.label) + (f.required ? ' *' : '') + '</label>' +
                  '<select class="form-input" name="' + esc(f.name) + '" style="width:100%;">' + optsHtml + '</select></div>';
        } else {
          var sval = (v == null) ? '' : (typeof v === 'object' ? canonicalGet(f, record) : v);
          html += '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">' + esc(f.label) + (f.required ? ' *' : '') + '</label>' +
                  '<input class="form-input" name="' + esc(f.name) + '" value="' + esc(sval) + '" style="width:100%;"></div>';
        }
      });
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
    return U.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'orders', label: 'Orders' }, { key: 'notes', label: 'Notes' }], 'ov') +
      '<div class="mu-pane" data-pane="ov">' + U.tiles(d.tiles ? d.tiles(r) : []) + U.card('Contact', contactHtml) + U.card('Segments', chips(d.segments ? d.segments(r) : [])) + '</div>' +
      '<div class="mu-pane" data-pane="orders" hidden>' + U.cardTable('Orders (' + orders.length + ')', ordersTable) + '</div>' +
      '<div class="mu-pane" data-pane="notes" hidden>' + U.card('Notes', notes ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;">' + esc(notes) + '</div>' : '<span class="mu-sub">No notes</span>') + '</div>';
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
    if (_current) _panelStack.push({ key: _current.key, record: _current.record, label: _current.label });
    Promise.resolve(ts.fetch(id)).then(function (rec) {
      if (rec) openRecord(targetKey, rec, 'read', true);
      else { _panelStack.pop(); if (window.showToast) showToast('Not found', true); }
    }).catch(function (e) { _panelStack.pop(); console.error('[MastEntity.drill]', e); if (window.showToast) showToast('Could not open record', true); });
  }
  // Back one level in the panel-local drill chain — re-render the previous record
  // in place (no route nav, panel stays open).
  function back() {
    var prev = _panelStack.pop();
    if (prev) openRecord(prev.key, prev.record, 'read', true);
  }

  function openRecord(key, record, mode, _internal) {
    var s = _registry[key]; if (!s) return;
    mode = mode || 'read';
    // A fresh open (from a list) resets the drill chain; drill/back pass _internal.
    if (!_internal) _panelStack = [];
    var statusField = s.fields.filter(function (f) { return f.type === 'status'; })[0];
    var badges = (statusField && record) ? [{ label: record[statusField.name], tone: (statusField.tone ? statusField.tone(record[statusField.name]) : 'neutral') }] : [];
    var baseline = JSON.stringify(record || {});
    // Prefix the title with the object type ("Order: SGTE-0188") so it's always
    // clear which kind of record you're on — important when drilling across types.
    var _recName = (record && record[s.fields[0].name]) || '';
    // Fall back to a stable identifier when the lead field is empty, so the
    // title is never a bare "Customer" with no id (empty-value handling).
    if (!_recName && record) _recName = record.email || record.primaryEmail || record.orderNumber || s.recordId(record) || '';
    var titleText = (mode === 'create') ? ('New ' + (s.label || key))
      : (_recName ? ((s.label ? s.label + ': ' : '') + _recName) : (s.label || key));
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
      render: function (ctx) { return (ctx.mode === 'read' && s.detail) ? (crumbHtml() + renderDetail(s, record)) : _formHtml(key, record, ctx.mode); },
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
  }

  function exportRows(key, rows, view) {
    return window.MastIO.exportCsv({ rows: rows || [], columns: exportColumns(key), module: key, view: view || 'all' });
  }

  var api = {
    define: define, get: get, listColumns: listColumns, exportColumns: exportColumns,
    canonicalGet: canonicalGet, validate: validate,
    renderList: renderList, openRecord: openRecord, exportRows: exportRows,
    drill: drill, back: back
  };
  if (typeof window !== 'undefined') window.MastEntity = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { define: define, get: get, listColumns: listColumns, exportColumns: exportColumns, canonicalGet: canonicalGet, validate: validate };
  }
})();
