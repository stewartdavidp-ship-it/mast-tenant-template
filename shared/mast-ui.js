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
    // date display: ISO/Date -> "May 1, 2026"; dateRaw -> "2026-05-01"
    date: function (d) {
      var dt = (d instanceof Date) ? d : new Date(d);
      if (isNaN(dt.getTime())) return '';
      return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    },
    dateRaw: function (d) {
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
  function badge(label, tone) {
    var v = _toneVar[tone] || _toneVar.neutral;
    var c = 'var(' + v + ', var(--warm-gray))';
    var style =
      'display:inline-flex;align-items:center;gap:6px;font-size:0.72rem;font-weight:600;' +
      'padding:3px 10px;border-radius:999px;line-height:1.4;white-space:nowrap;' +
      'background:color-mix(in srgb,' + c + ' 16%,transparent);color:' + c + ';' +
      'border:1px solid color-mix(in srgb,' + c + ' 30%,transparent);';
    var dot = '<span style="width:6px;height:6px;border-radius:50%;background:' + c + ';flex:0 0 6px;"></span>';
    return '<span class="mast-badge" style="' + style + '">' + dot + esc(label) + '</span>';
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
        'color:' + (active ? 'var(--charcoal,var(--text))' : 'var(--warm-gray)') + ';' +
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
        '<div style="font-size:1.15rem;color:var(--charcoal,var(--text));margin-bottom:4px;">' + esc(e.title || 'Nothing here yet') + '</div>' +
        (e.message ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:16px;">' + esc(e.message) + '</div>' : '') +
        (e.ctaHtml || '') + '</div>';
    }
    var cols = cfg.columns || [];
    var rowId = cfg.rowId || function (r) { return r && r.id; };
    var th = '';
    cols.forEach(function (c) {
      var align = c.align === 'right' ? 'text-align:right;' : (c.align === 'center' ? 'text-align:center;' : '');
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
      var click = cfg.onRowClickFnName ? ' onclick="' + cfg.onRowClickFnName + '(\'' + esc(id) + '\')" style="cursor:pointer;"' : '';
      body += '<tr class="mast-row"' + click + '>';
      cols.forEach(function (c) {
        var align = c.align === 'right' ? 'text-align:right;font-variant-numeric:tabular-nums;' :
                    (c.align === 'center' ? 'text-align:center;' : '');
        var val = c.render ? c.render(r) : esc(r[c.key]);
        body += '<td style="padding:14px 12px;font-size:0.9rem;color:var(--charcoal,var(--text));' +
                'border-bottom:1px solid var(--border,rgba(255,255,255,0.06));' + align + '">' + val + '</td>';
      });
      if (cfg.rowActions) {
        body += '<td style="padding:14px 4px;text-align:center;border-bottom:1px solid var(--border,rgba(255,255,255,0.06));">' +
                '<span style="color:var(--warm-gray);cursor:pointer;">⋯</span></td>';
      }
      body += '</tr>';
    });

    return '<div class="mast-table-wrap" style="border:1px solid var(--border,rgba(255,255,255,0.08));' +
           'border-radius:12px;overflow:hidden;background:var(--surface-card,var(--card-bg));">' +
           '<table class="mast-table" style="width:100%;border-collapse:collapse;">' +
           '<thead><tr>' + th + '</tr></thead><tbody>' + body + '</tbody></table></div>';
  }

  // ── Deep-link helper (?id= in the hash) ─────────────────────────────
  var deepLink = {
    set: function (id) {
      try {
        var h = location.hash.replace(/^#/, '').split('?')[0];
        location.hash = h + '?id=' + encodeURIComponent(id);
      } catch (e) {}
    },
    clear: function () {
      try { location.hash = location.hash.replace(/^#/, '').split('?')[0]; } catch (e) {}
    },
    get: function () {
      var m = /[?&]id=([^&]+)/.exec(location.hash);
      return m ? decodeURIComponent(m[1]) : null;
    }
  };

  // ── slideOut v2 — the one record surface (05/08/12) ─────────────────
  // Wraps window.mastSlideOut (v1) adding: width tiers + expand, modes
  // (read/edit/create), Cancel/Save footer, MastDirty guard on every exit,
  // and ?id= deep-link. Dirty-guard works by routing the underlying close
  // through MastDirty.checkAndExit for the panel's lifetime.
  var _SIZE = { sm: '420px', md: '640px', lg: '900px' };
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
    open: function (opts) {
      opts = opts || {};
      slideOut._opts = opts;
      _v2.expanded = false;
      var mode = opts.mode || 'read';
      var badgesHtml = (opts.badges || []).map(function (b) { return badge(b.label, b.tone); }).join(' ');
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
          if (typeof opts.onClose === 'function') opts.onClose();
        }
      });
      _applySize(opts.size || 'md', opts.expandable !== false && (opts.size === 'lg'));

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

  if (typeof window !== 'undefined') {
    window.MastUI = { Num: Num, badge: badge, tabs: tabs, list: list, slideOut: slideOut, deepLink: deepLink, _esc: esc };
  }

  // CommonJS export for node-based unit tests of the pure helpers.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Num: Num, badge: badge, tabs: tabs, list: list, esc: esc };
  }
})();
