/**
 * mast-io.js — shared tabular data in/out (doc 13). Phase 0b.
 *
 * One export path + one parse path so every list exports/imports identically
 * and round-trips (export columns == import template). Canonical file values
 * (raw numbers, ISO dates) — display formatting lives in MastUI.Num.
 *
 * Dependency-free CSV serializer (RFC-4180 quoting + CSV-injection guard) so it's
 * unit-testable in node; SheetJS (window.XLSX) used only for .xlsx in the browser;
 * PapaParse (window.Papa) used for parsing uploads in the browser.
 *
 * window.MastIO = { toCsv, exportCsv, filename, download, parse }.
 */
(function () {
  'use strict';

  // RFC-4180 field quoting + CSV-injection neutralization.
  // A cell starting with = + - @ (or tab/CR) can execute as a formula in Excel/Sheets;
  // prefix it with a single quote so it's treated as text.
  function cell(v) {
    var s = (v == null) ? '' : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // columns: [{ key, label, get?(row)->value }]. get() should return the CANONICAL
  // value (e.g. MastUI.Num.moneyRaw(row.total), MastUI.Num.dateRaw(row.date)).
  function toCsv(rows, columns) {
    rows = rows || [];
    columns = columns || [];
    var header = columns.map(function (c) { return cell(c.label != null ? c.label : c.key); }).join(',');
    var lines = rows.map(function (r) {
      return columns.map(function (c) {
        var v = (typeof c.get === 'function') ? c.get(r) : (r ? r[c.key] : '');
        return cell(v);
      }).join(',');
    });
    return [header].concat(lines).join('\r\n');
  }

  // {tenant}-{module}-{view}-{YYYY-MM-DD}.{ext}  (date param for determinism/testing)
  function filename(module, view, ext, date) {
    var tenant = (typeof window !== 'undefined' && (window.TENANT_SLUG || window.MAST_TENANT_SLUG)) || 'mast';
    var d = date || (typeof window !== 'undefined' ? new Date() : new Date(0));
    var iso = d.toISOString().slice(0, 10);
    var slug = function (s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); };
    var parts = [slug(tenant), slug(module), slug(view)].filter(Boolean);
    return parts.join('-') + '-' + iso + '.' + (ext || 'csv');
  }

  function download(name, content, mime) {
    if (typeof document === 'undefined') return;
    var blob = new Blob(['﻿' + content], { type: (mime || 'text/csv') + ';charset=utf-8' }); // BOM for Excel
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
  }

  // exportCsv({ rows, columns, module, view, filename? }) — scope = what the
  // caller passes (filtered/selected rows). Audited by the caller where sensitive.
  function exportCsv(opts) {
    opts = opts || {};
    var name = opts.filename || filename(opts.module, opts.view, 'csv');
    download(name, toCsv(opts.rows, opts.columns), 'text/csv');
    return name;
  }

  // parse(file) -> Promise<{rows, fields}> using Papa (csv) / XLSX (xlsx) in the browser.
  function parse(file) {
    return new Promise(function (resolve, reject) {
      var name = (file && file.name || '').toLowerCase();
      if (/\.xlsx?$/.test(name) && typeof window !== 'undefined' && window.XLSX) {
        var r = new FileReader();
        r.onload = function (e) {
          try {
            var wb = window.XLSX.read(e.target.result, { type: 'array' });
            var ws = wb.Sheets[wb.SheetNames[0]];
            var rows = window.XLSX.utils.sheet_to_json(ws, { defval: '' });
            resolve({ rows: rows, fields: rows.length ? Object.keys(rows[0]) : [] });
          } catch (err) { reject(err); }
        };
        r.onerror = reject; r.readAsArrayBuffer(file);
      } else if (typeof window !== 'undefined' && window.Papa) {
        window.Papa.parse(file, {
          header: true, skipEmptyLines: true,
          complete: function (res) { resolve({ rows: res.data, fields: (res.meta && res.meta.fields) || [] }); },
          error: reject
        });
      } else {
        reject(new Error('No parser available (Papa/XLSX not loaded)'));
      }
    });
  }

  if (typeof window !== 'undefined') {
    window.MastIO = { toCsv: toCsv, exportCsv: exportCsv, filename: filename, download: download, parse: parse, _cell: cell };
  }
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { toCsv: toCsv, filename: filename, cell: cell };
  }
})();
