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

  // ── Detail-template render components (slot vocabulary; docs 17 + templates-mock) ──
  // Pure string builders the Entity Engine composes into a record panel.
  function tiles(items) { // [{k, v, hero}]
    return '<div class="mu-tiles">' + (items || []).map(function (t) {
      return '<div class="mu-tile' + (t.hero ? ' hero' : '') + '"><div class="mu-tk">' + esc(t.k) + '</div><div class="mu-tv">' + (t.v == null ? '' : t.v) + '</div></div>';
    }).join('') + '</div>';
  }
  function card(title, inner) { return '<div class="mu-card"><h3>' + esc(title) + '</h3><div class="mu-cc">' + (inner || '') + '</div></div>'; }
  function cardTable(title, inner) { return '<div class="mu-card"><h3>' + esc(title) + '</h3>' + (inner || '') + '</div>'; }
  function kv(rows) { // [{k, v}] v is html
    return '<div class="mu-kv">' + (rows || []).map(function (r) {
      return '<span class="mu-k">' + esc(r.k) + '</span><span class="mu-v">' + (r.v == null || r.v === '' ? '—' : r.v) + '</span>';
    }).join('') + '</div>';
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
    return '<button class="mu-thumb" data-img="' + esc(name) + '"' + (src ? ' style="background-image:url(' + esc(src) + ');background-size:cover;"' : '') + '><span class="mu-zoom">⤢</span></button>';
  }
  // image lightbox (singleton)
  function openImg(name) {
    var lb = document.getElementById('mu-lightbox');
    if (!lb) {
      lb = document.createElement('div'); lb.id = 'mu-lightbox'; lb.className = 'mu-lightbox';
      lb.innerHTML = '<div><div class="mu-lb-img"></div><div class="mu-lb-cap"></div><div class="mu-lb-hint">click anywhere or press Esc to close</div></div>';
      lb.addEventListener('click', function () { lb.classList.remove('open'); });
      document.body.appendChild(lb);
      document.addEventListener('keydown', function (e) { if (e.key === 'Escape') lb.classList.remove('open'); });
    }
    lb.querySelector('.mu-lb-cap').textContent = name || '';
    lb.classList.add('open');
  }
  // delegated handlers for thumbs (attach once)
  function wireDelegates() {
    if (window.__muWired) return; window.__muWired = true;
    document.addEventListener('click', function (e) {
      var t = e.target.closest && e.target.closest('.mu-thumb');
      if (t) { openImg(t.getAttribute('data-img')); }
    });
  }
  // panel tabs: switch panes inside the slide-out body
  function panelTab(btn, pane) {
    var bar = btn.parentNode; var body = document.getElementById('mastSlideOutBody');
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

  // ── One injected, tokenized stylesheet (both-mode safe) ──
  function injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('mast-ui-styles')) return;
    var css = [
      '.mu-tiles{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:18px;}',
      '.mu-tile{background:var(--bg-secondary,rgba(127,127,127,.06));border:1px solid var(--border,rgba(127,127,127,.2));border-radius:10px;padding:12px 14px;}',
      '.mu-tk{font-size:0.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-gray);}',
      '.mu-tv{font-size:1.0rem;font-weight:600;margin-top:5px;font-variant-numeric:tabular-nums;color:var(--charcoal,var(--text));}',
      '.mu-tile.hero .mu-tv{font-size:1.15rem;}',
      '.mu-card{border:1px solid var(--border,rgba(127,127,127,.2));border-radius:12px;overflow:hidden;margin-bottom:16px;}',
      '.mu-card>h3{font-size:0.72rem;letter-spacing:.05em;text-transform:uppercase;color:var(--warm-gray);margin:0;padding:13px 16px;border-bottom:1px solid var(--border,rgba(127,127,127,.2));background:var(--bg-secondary,rgba(127,127,127,.05));font-weight:600;}',
      '.mu-cc{padding:14px 16px;}',
      '.mu-kv{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;font-size:0.9rem;}',
      '.mu-kv .mu-k{color:var(--warm-gray);} .mu-kv .mu-v{text-align:right;}',
      '.mu-rel{width:100%;border-collapse:collapse;} .mu-rel thead th{text-align:left;font-size:0.72rem;letter-spacing:.04em;text-transform:uppercase;color:var(--warm-gray);font-weight:600;padding:0 16px 8px;} .mu-rel th.r,.mu-rel td.r{text-align:right;}',
      '.mu-rel tbody td{padding:11px 16px;border-top:1px solid var(--border,rgba(127,127,127,.15));font-size:0.9rem;font-variant-numeric:tabular-nums;}',
      '.mu-rel-click{cursor:pointer;} .mu-rel-click:hover td{background:color-mix(in srgb,var(--amber,#C4853C) 8%,transparent);}',
      '.mu-tl{list-style:none;margin:0;padding:0;} .mu-tl li{position:relative;padding:0 0 16px 22px;}',
      '.mu-tl li::before{content:"";position:absolute;left:3px;top:3px;width:9px;height:9px;border-radius:50%;background:var(--amber,#C4853C);}',
      '.mu-tl li.future::before{background:transparent;border:2px solid var(--border,#999);} .mu-tl li::after{content:"";position:absolute;left:7px;top:12px;bottom:-2px;width:2px;background:var(--border,rgba(127,127,127,.3));} .mu-tl li:last-child::after{display:none;}',
      '.mu-tt{font-size:0.85rem;font-weight:500;color:var(--charcoal,var(--text));} .mu-td{font-size:0.78rem;color:var(--warm-gray);}',
      '.mu-thumb{width:40px;height:40px;border-radius:8px;background:linear-gradient(135deg,var(--amber-light,#E8B679),var(--teal,#2A7C6F));border:0;padding:0;position:relative;cursor:zoom-in;flex:0 0 40px;} .mu-thumb:hover{box-shadow:0 0 0 2px var(--amber,#C4853C);}',
      '.mu-zoom{position:absolute;right:2px;bottom:2px;width:14px;height:14px;border-radius:4px;background:rgba(0,0,0,.55);color:#fff;font-size:0.72rem;display:flex;align-items:center;justify-content:center;opacity:0;} .mu-thumb:hover .mu-zoom{opacity:1;}',
      '.mu-lightbox{position:fixed;inset:0;background:rgba(0,0,0,.8);display:none;align-items:center;justify-content:center;z-index:12000;cursor:zoom-out;text-align:center;} .mu-lightbox.open{display:flex;}',
      '.mu-lb-img{width:min(70vmin,520px);height:min(70vmin,520px);border-radius:14px;background:linear-gradient(135deg,var(--amber-light,#E8B679),var(--teal,#2A7C6F));box-shadow:0 20px 60px rgba(0,0,0,.5);} .mu-lb-cap{color:#fff;margin-top:14px;font-size:0.9rem;} .mu-lb-hint{color:rgba(255,255,255,.6);font-size:0.78rem;margin-top:4px;}',
      '.mu-ptabs{display:flex;gap:4px;border-bottom:1px solid var(--border,rgba(127,127,127,.2));margin:-4px -4px 16px;position:sticky;top:0;background:var(--surface-card,var(--card-bg,#1e1e1e));z-index:2;}',
      '.mu-ptabs button{background:transparent;border:0;border-bottom:2px solid transparent;color:var(--warm-gray);font:inherit;font-size:0.9rem;padding:11px 14px;cursor:pointer;white-space:nowrap;} .mu-ptabs button.on{border-bottom-color:var(--amber,#C4853C);color:var(--charcoal,var(--text));font-weight:600;}',
      '.mu-pane[hidden]{display:none;} .mu-grid2{display:grid;grid-template-columns:1.4fr 1fr;gap:18px;} @media(max-width:720px){.mu-grid2{grid-template-columns:1fr;}}',
      '.mu-crumb{margin:-4px -4px 14px;padding:9px 4px;border-bottom:1px solid var(--border,rgba(127,127,127,.2));} .mu-crumb button{background:transparent;border:0;color:var(--teal,#2A7C6F);font:inherit;font-size:0.85rem;cursor:pointer;font-weight:500;}',
      '.mu-link{color:var(--teal,#2A7C6F);cursor:pointer;font-weight:500;} .mu-link:hover{text-decoration:underline;}',
      '.mu-li{display:flex;align-items:center;gap:11px;} .mu-sub{color:var(--warm-gray);font-size:0.78rem;} .mu-totrow{display:flex;justify-content:space-between;padding:6px 0;color:var(--warm-gray);font-size:0.9rem;} .mu-totrow.grand{border-top:1px solid var(--border,rgba(127,127,127,.2));margin-top:6px;padding-top:10px;color:var(--charcoal,var(--text));font-weight:700;font-size:1.0rem;}'
    ].join('\n');
    var s = document.createElement('style'); s.id = 'mast-ui-styles'; s.textContent = css; document.head.appendChild(s);
  }

  if (typeof window !== 'undefined') {
    injectStyles(); wireDelegates();
    window.MastUI = {
      Num: Num, badge: badge, tabs: tabs, list: list, slideOut: slideOut, deepLink: deepLink, _esc: esc,
      tiles: tiles, card: card, cardTable: cardTable, kv: kv, timeline: timeline, relatedTable: relatedTable,
      imageThumb: imageThumb, openImg: openImg, panelTab: panelTab, paneTabsBar: paneTabsBar
    };
  }

  // CommonJS export for node-based unit tests of the pure helpers.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { Num: Num, badge: badge, tabs: tabs, list: list, esc: esc, tiles: tiles, kv: kv, timeline: timeline, relatedTable: relatedTable };
  }
})();
