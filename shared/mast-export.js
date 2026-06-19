/**
 * mast-export.js — the centralized CSV-export core (Track 5).
 *
 * Background (decomposition-master-plan.md §5 / §1.5): ~50 modules hand-roll their
 * own CSV string-building (join(',') with ad-hoc — or absent — quoting/escaping),
 * and only ONE place uses the already-loaded PapaParse. That duplication is both a
 * correctness hazard (broken RFC-4180 quoting on cells with commas/quotes/newlines)
 * and a SECURITY hazard (no CSV formula-injection defense). This module is a small,
 * pure home for "rows → CSV string" + "browser download" so every list exports
 * identically and safely.
 *
 * PapaParse is already loaded eagerly in app/index.html (window.Papa). This module
 * does NOT import it — it PREFERS window.Papa.unparse when present (battle-tested
 * quoting/escaping) and falls back to a tiny built-in RFC-4180 serializer when it
 * isn't (so node unit tests run without Papa). Either path applies the SAME
 * formula-injection guard, mirrored verbatim from shared/mast-io.js so behavior is
 * consistent across the two export cores.
 *
 * Adoption (repointing the ~50 hand-rolled exporters onto MastExport) is a separate
 * later step — this module just lands the standalone core + tests.
 *
 * Exposes window.MastExport (browser) + module.exports (node tests), exactly like
 * the other shared/*.js cores. Vanilla ES5-ish (var/IIFE), no hard dependency.
 */
(function () {
  'use strict';

  // ── CSV-injection neutralization — MIRRORED VERBATIM from shared/mast-io.js. ──
  // A cell whose stringified value starts with = + - @ (or tab/CR) can execute as
  // a formula in Excel/Sheets; prefix it with a single quote so it's treated as
  // text. Kept byte-identical to mast-io.js's guard so both export cores agree.
  function neutralize(s) {
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return s;
  }

  // Stringify a raw cell value the canonical way: null/undefined → '' (empty),
  // everything else → String(v). Then apply the injection guard.
  function cellString(v) {
    var s = (v == null) ? '' : String(v);
    return neutralize(s);
  }

  // RFC-4180 field quoting for the built-in (no-Papa) serializer: a field that
  // contains a comma, double-quote, CR or LF is wrapped in double quotes, and any
  // embedded double-quote is doubled.
  function quoteField(s) {
    if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  // Resolve the column order + the row objects from the flexible `rows`/`opts`
  // shapes this core accepts:
  //   - toCsv([{a,b}, ...])                     → header from union-ish first row keys
  //   - toCsv(rows, { columns: ['a','c'] })     → explicit order/subset
  //   - toCsv({ columns: [...], data: [...] })  → packaged shape
  // Returns { columns: string[], data: object[] }.
  function resolve(rows, opts) {
    opts = opts || {};
    var data, columns;
    // Packaged { columns, data } shape.
    if (rows && !Array.isArray(rows) && (rows.columns || rows.data)) {
      data = rows.data || [];
      columns = rows.columns || opts.columns || null;
    } else {
      data = rows || [];
      columns = opts.columns || null;
    }
    if (!columns) {
      // Derive header from the keys of the first row (the common case). Falls back
      // to an empty header when there are no rows.
      columns = (data.length && data[0] && typeof data[0] === 'object')
        ? Object.keys(data[0])
        : [];
    }
    return { columns: columns, data: data };
  }

  // Built-in RFC-4180 serializer (used when window.Papa is absent — e.g. node).
  function builtinUnparse(columns, data) {
    var header = columns.map(function (c) {
      return quoteField(cellString(c));
    }).join(',');
    var lines = data.map(function (row) {
      return columns.map(function (col) {
        var v = (row == null) ? '' : row[col];
        return quoteField(cellString(v));
      }).join(',');
    });
    return [header].concat(lines).join('\r\n');
  }

  // Build a 2D array (header row + value rows) for Papa.unparse, applying the
  // injection guard to every cell BEFORE handing it to Papa (Papa handles RFC-4180
  // quoting; it does NOT defend against formula injection — that's on us).
  function toMatrix(columns, data) {
    var matrix = [columns.map(function (c) { return cellString(c); })];
    data.forEach(function (row) {
      matrix.push(columns.map(function (col) {
        var v = (row == null) ? '' : row[col];
        return cellString(v);
      }));
    });
    return matrix;
  }

  // toCsv(rows, opts) → CSV string.
  //   rows : array of plain objects, OR a { columns, data } package.
  //   opts : { columns?: string[] }  — explicit column order/subset.
  // Prefers window.Papa.unparse (correct quoting/escaping) when available; falls
  // back to the built-in serializer otherwise. Both paths apply the same
  // null/undefined → '' coercion and the same formula-injection guard.
  function toCsv(rows, opts) {
    var r = resolve(rows, opts);
    var Papa = (typeof window !== 'undefined') ? window.Papa : (typeof Papa !== 'undefined' ? Papa : null); // eslint-disable-line no-use-before-define
    if (Papa && typeof Papa.unparse === 'function') {
      // Hand Papa a guarded matrix so quoting is Papa's job and injection-defense
      // is ours — identical cell values to the built-in path.
      return Papa.unparse(toMatrix(r.columns, r.data));
    }
    return builtinUnparse(r.columns, r.data);
  }

  // download(filename, rows, opts) — build the CSV, then trigger a browser
  // download (Blob + object URL + a temporary <a>). In node (no document) this is
  // a graceful no-op that just returns the CSV string, so callers/tests can run
  // headless. Returns the CSV string in both cases.
  function download(filename, rows, opts) {
    var csv = toCsv(rows, opts);
    if (typeof document === 'undefined') return csv;
    var blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }); // BOM for Excel
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename || 'export.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 0);
    return csv;
  }

  var api = {
    toCsv: toCsv,
    download: download
  };

  if (typeof window !== 'undefined') {
    window.MastExport = api;
  }
  // CommonJS export for node-based unit tests.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})();
