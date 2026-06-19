/**
 * Match-confirm modal — the shared operator-confirm dialog for channel
 * listing <-> product (and customer/vendor) match candidates. Presents fuzzy
 * candidates with score badges; the operator accepts a selection or creates a
 * new record in the target system.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1, recipe B). Lazy-loaded on demand via the eager openMatchConfirmModal
 * shim in index.html. The sole cross-module caller is accounting.js (QBO Item /
 * customer / vendor bridges), which calls window.openMatchConfirmModal(...).
 *
 * Reads eager shell globals: esc, window._jsAttr. Both defined before any
 * surface that opens this modal can render. Logic moved VERBATIM
 * (behavior-preserving).
 */
(function () {
  'use strict';

// ────────────────────────────────────────────────────────────────
// openMatchConfirmModal — W2a.1 shared operator-confirm modal
// Contract: W2a-CONTRACTS.md C4.
// Used by:
//   - W2a.1 Product → QBO Item bridge (fuzzy candidates)
//   - retrofit: W1.4 customer/vendor match candidates (latent gap)
// Args: { title, description, candidates:[{id,label,sublabel?,score}],
//         onAccept(selectedId)→Promise, onCreateNew()→Promise, onCancel() }
// Candidates ordered ascending score (0=best). Esc / backdrop click → onCancel.
// ────────────────────────────────────────────────────────────────
function openMatchConfirmModal(opts) {
  opts = opts || {};
  var candidates = Array.isArray(opts.candidates) ? opts.candidates.slice() : [];
  var selectedId = candidates.length ? candidates[0].id : null;
  var closed = false;

  var overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:10500;display:flex;align-items:center;justify-content:center;padding:16px;';
  overlay.setAttribute('tabindex', '-1');

  function scoreBadge(score) {
    var s = Number(score);
    if (!isFinite(s)) return '';
    var pct = Math.max(0, Math.min(100, Math.round((1 - s) * 100)));
    var bg = '#94a3b8', fg = '#fff';
    if (s <= 0.10) { bg = '#22c55e'; }
    else if (s <= 0.30) { bg = '#eab308'; }
    else if (s <= 0.50) { bg = '#f59e0b'; }
    else { bg = '#94a3b8'; }
    return '<span style="display:inline-block;padding:2px 8px;border-radius:10px;background:' + bg + ';color:' + fg + ';font-size:0.72rem;font-weight:600;">' + pct + '%</span>';
  }

  var rowsHtml = '';
  if (candidates.length === 0) {
    rowsHtml = '<div style="padding:16px;color:var(--warm-gray);font-size:0.85rem;text-align:center;">No candidates returned.</div>';
  } else {
    candidates.forEach(function(c, idx) {
      var checked = (String(c.id) === String(selectedId)) ? ' checked' : '';
      var idAttr = window._jsAttr ? window._jsAttr(c.id) : esc(c.id);
      rowsHtml +=
        '<label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(0,0,0,0.08);border-radius:8px;margin-bottom:6px;cursor:pointer;background:var(--bg-secondary,#f5f5f5);">' +
          '<input type="radio" name="matchConfirmCandidate" value="' + idAttr + '"' + checked + ' style="margin:0;">' +
          '<div style="flex:1;min-width:0;">' +
            '<div style="font-size:0.9rem;font-weight:600;color:var(--text,#1f2937);">' + esc(c.label || '') + '</div>' +
            (c.sublabel ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(c.sublabel) + '</div>' : '') +
          '</div>' +
          '<div>' + scoreBadge(c.score) + '</div>' +
        '</label>';
    });
  }

  var html =
    '<div style="background:var(--cream,#fff);border-radius:10px;max-width:540px;width:96%;max-height:88vh;display:flex;flex-direction:column;box-shadow:0 8px 30px rgba(0,0,0,0.2);">' +
      '<div style="padding:20px 24px 12px;border-bottom:1px solid rgba(0,0,0,0.08);">' +
        '<div style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;font-weight:600;color:var(--text-primary);">' + esc(opts.title || 'Confirm match') + '</div>' +
        (opts.description ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:6px;line-height:1.4;">' + esc(opts.description) + '</div>' : '') +
      '</div>' +
      '<div style="padding:16px 24px;overflow-y:auto;flex:1;">' + rowsHtml + '</div>' +
      '<div style="padding:14px 24px;border-top:1px solid rgba(0,0,0,0.08);display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" id="matchConfirmCreateNew" style="font-size:0.85rem;">Create new in QBO</button>' +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-secondary" id="matchConfirmCancel">Cancel</button>' +
          '<button class="btn btn-primary" id="matchConfirmAccept"' + (candidates.length === 0 ? ' disabled' : '') + '>Accept selected</button>' +
        '</div>' +
      '</div>' +
    '</div>';

  overlay.innerHTML = html;
  document.body.appendChild(overlay);
  setTimeout(function() { try { overlay.focus(); } catch (e) {} }, 0);

  function close(cb) {
    if (closed) return;
    closed = true;
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (typeof cb === 'function') {
      try { cb(); } catch (e) { console.error('[openMatchConfirmModal]', e); }
    }
  }

  overlay.addEventListener('change', function(ev) {
    if (ev.target && ev.target.name === 'matchConfirmCandidate') {
      selectedId = ev.target.value;
    }
  });
  overlay.addEventListener('click', function(ev) {
    if (ev.target === overlay) close(opts.onCancel);
  });
  overlay.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape') {
      ev.stopImmediatePropagation();
      close(opts.onCancel);
    }
  });
  overlay.querySelector('#matchConfirmCancel').addEventListener('click', function() { close(opts.onCancel); });
  overlay.querySelector('#matchConfirmCreateNew').addEventListener('click', function() {
    var fn = opts.onCreateNew;
    close(function() {
      if (typeof fn === 'function') {
        var p = fn();
        if (p && typeof p.catch === 'function') p.catch(function(e) { console.error('[openMatchConfirmModal] onCreateNew', e); });
      }
    });
  });
  overlay.querySelector('#matchConfirmAccept').addEventListener('click', function() {
    var selId = selectedId;
    var fn = opts.onAccept;
    close(function() {
      if (typeof fn === 'function') {
        var p = fn(selId);
        if (p && typeof p.catch === 'function') p.catch(function(e) { console.error('[openMatchConfirmModal] onAccept', e); });
      }
    });
  });
}
window.openMatchConfirmModalImpl = openMatchConfirmModal;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('matchConfirmModal', {});
  }
})();
