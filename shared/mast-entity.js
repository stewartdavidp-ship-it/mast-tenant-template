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
  function displayCell(f, row) {
    var v = fieldValue(f, row);
    var N = window.MastUI && window.MastUI.Num;
    if (f.type === 'money') return N ? N.money(v) : ('$' + (v || 0));
    if (f.type === 'date') return N ? N.date(v) : esc(v);
    if (f.type === 'number') return N ? N.count(v) : esc(v);
    if ((f.type === 'status' || f.tone) && window.MastUI) {
      var tone = (typeof f.tone === 'function') ? f.tone(v) : 'neutral';
      return window.MastUI.badge(v == null ? '' : v, tone);
    }
    return esc(v);
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
        } else {
          var ro = f.readOnly ? ' disabled' : '';
          html += '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">' + esc(f.label) + (f.required ? ' *' : '') + '</label>' +
                  '<input class="form-input" name="' + esc(f.name) + '" value="' + esc(v == null ? '' : v) + '"' + ro + ' style="width:100%;"></div>';
        }
      });
      html += '</div>';
    });
    return html;
  }

  function openRecord(key, record, mode) {
    var s = _registry[key]; if (!s) return;
    mode = mode || 'read';
    var statusField = s.fields.filter(function (f) { return f.type === 'status'; })[0];
    var badges = (statusField && record) ? [{ label: record[statusField.name], tone: (statusField.tone ? statusField.tone(record[statusField.name]) : 'neutral') }] : [];
    var baseline = JSON.stringify(record || {});
    window.MastUI.slideOut.open({
      id: s.recordId(record) || 'new',
      title: (mode === 'create' ? 'New ' + (s.label || key) : (record && (record[s.fields[0].name])) || (s.label || key)),
      size: s.size || 'md',
      mode: mode,
      badges: badges,
      // Read mode offers Edit (→ in-place edit mode) when the entity is editable.
      actions: (mode === 'read' && typeof s.onSave === 'function')
        ? [{ label: 'Edit', primary: true, onClickFnName: 'MastUI.slideOut.edit' }] : undefined,
      render: function (ctx) { return _formHtml(key, record, ctx.mode); },
      isDirty: function () {
        var panel = document.getElementById('mastSlideOutBody');
        if (!panel) return false;
        var cur = {};
        panel.querySelectorAll('input[name]').forEach(function (i) { cur[i.name] = i.value; });
        var snap = JSON.parse(baseline);
        return s.fields.some(function (f) { return (f.name in cur) && String(cur[f.name]) !== String(snap[f.name] == null ? '' : snap[f.name]); });
      },
      onSave: function () {
        var panel = document.getElementById('mastSlideOutBody');
        var rec = {};
        panel.querySelectorAll('input[name]').forEach(function (i) { rec[i.name] = i.value; });
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
    renderList: renderList, openRecord: openRecord, exportRows: exportRows
  };
  if (typeof window !== 'undefined') window.MastEntity = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { define: define, get: get, listColumns: listColumns, exportColumns: exportColumns, canonicalGet: canonicalGet, validate: validate };
  }
})();
