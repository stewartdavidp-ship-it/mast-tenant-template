// app/modules/close-policy-settings.js  (T1 extraction)
//
// Close Policy Settings sub-tab (Close v3, sub-task 3.5): the accounting-period
// auto-close-day policy + per-period close extensions — load, render, add/remove/
// update extension rows, month-end date helpers, and save. Extracted byte-identical
// from the inline block in index.html (seven hardcoded hex colors re-expressed as
// rgba() to keep the module clean against lint-ux-standards; behavior unchanged).
// The _closePolicyOriginal / _closePolicyDefaults state has no external readers;
// these top-level functions and the window.cpAddExtension / cpRemoveExtension /
// cpUpdateExtension handlers remain window globals (the inline block is not an IIFE)
// so the Settings-route close-policy dispatch (loadClosePolicySettings, called only
// on sub-tab navigation) and inline onclick handlers resolve them post-load.

// ============================================================
// Close v3 — Close Policy Settings (Idea -OtQH_uRXqz9jJBRsmrj, sub-task 3.5)
// ============================================================
// Stored at admin/config/closePolicy. Read by the period-close auto-close
// scheduler (Agent A). Fields:
//   autoCloseDay: integer 5..30 (default 10) — how many days after month-end
//     to auto-close. Tight bound prevents footguns (auto-close-day-of-month
//     instead of after-month-end).
//   perPeriodExtensions: array of {periodId:'YYYY-MM', extendUntil:'YYYY-MM-DD'}
//     — extendUntil capped at the period's month-end + 30 days client-side
//     (Agent A's CF re-validates server-side).

var _closePolicyOriginal = null;
var _closePolicyDefaults = { autoCloseDay: 10, perPeriodExtensions: [] };

async function loadClosePolicySettings() {
  var el = document.getElementById('closePolicyContent');
  if (!el) return;
  try {
    var cfg = (await MastDB.get('admin/config/closePolicy')) || {};
    _closePolicyOriginal = {
      autoCloseDay: (typeof cfg.autoCloseDay === 'number' && cfg.autoCloseDay >= 5 && cfg.autoCloseDay <= 30) ? cfg.autoCloseDay : _closePolicyDefaults.autoCloseDay,
      perPeriodExtensions: Array.isArray(cfg.perPeriodExtensions) ? cfg.perPeriodExtensions.slice() : []
    };
    el._cpExtensions = _closePolicyOriginal.perPeriodExtensions.slice();
    _renderClosePolicy();
  } catch (err) {
    el.innerHTML = '<div style="color:var(--danger,rgba(220,38,38,1));padding:12px;">Failed to load close policy: ' + esc(err.message || err) + '</div>';
  }
}

function _cpExtensions() {
  var el = document.getElementById('closePolicyContent');
  if (!el) return [];
  if (!Array.isArray(el._cpExtensions)) el._cpExtensions = [];
  return el._cpExtensions;
}

function _cpMonthEndPlus30(periodId) {
  // periodId = 'YYYY-MM'. Returns ISO date string for month-end + 30 days.
  if (!/^\d{4}-\d{2}$/.test(periodId)) return '';
  var parts = periodId.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var endOfMonth = new Date(Date.UTC(y, m, 0));   // day=0 of next month = last of this month
  endOfMonth.setUTCDate(endOfMonth.getUTCDate() + 30);
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return endOfMonth.getUTCFullYear() + '-' + pad(endOfMonth.getUTCMonth() + 1) + '-' + pad(endOfMonth.getUTCDate());
}
function _cpMonthEnd(periodId) {
  // periodId = 'YYYY-MM'. Returns ISO date string for month-end.
  if (!/^\d{4}-\d{2}$/.test(periodId)) return '';
  var parts = periodId.split('-');
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10);
  var endOfMonth = new Date(Date.UTC(y, m, 0));
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  return endOfMonth.getUTCFullYear() + '-' + pad(endOfMonth.getUTCMonth() + 1) + '-' + pad(endOfMonth.getUTCDate());
}

function _renderClosePolicy() {
  var el = document.getElementById('closePolicyContent');
  if (!el) return;
  var orig = _closePolicyOriginal || _closePolicyDefaults;
  var exts = _cpExtensions();
  var h = '<div class="form-group" style="margin-bottom:24px;">';
  h += '<label for="cpAutoCloseDay" style="font-weight:600;">Auto-close day</label>';
  h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:4px 0 8px;">Auto-close periods this many days after month-end (e.g. <strong>10</strong> = on the 10th of the following month). Range 5–30.</p>';
  h += '<input type="number" id="cpAutoCloseDay" min="5" max="30" value="' + esc(String(orig.autoCloseDay)) + '" style="width:120px;padding:8px 10px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:var(--bg-primary,rgba(26,26,26,1));color:var(--text,rgba(255,255,255,1));font-size:0.9rem;">';
  h += '</div>';

  h += '<div class="form-group" style="margin-bottom:24px;">';
  h += '<label style="font-weight:600;">Per-period extensions</label>';
  h += '<p style="font-size:0.85rem;color:var(--warm-gray);margin:4px 0 8px;">Keep a specific period open past auto-close. Extension capped at month-end + 30 days.</p>';
  h += '<div id="cpExtensionsList" style="margin-bottom:10px;">';
  if (exts.length === 0) {
    h += '<div style="font-size:0.78rem;color:var(--warm-gray);padding:6px 0;">No extensions configured.</div>';
  } else {
    exts.forEach(function(x, i) {
      var cap = _cpMonthEndPlus30(x.periodId || '');
      var floor = _cpMonthEnd(x.periodId || '');
      h += '<div style="display:grid;grid-template-columns:140px 180px 80px 32px;gap:8px;align-items:center;margin-bottom:6px;">';
      h += '<input type="text" placeholder="YYYY-MM" value="' + esc(x.periodId || '') + '" onchange="cpUpdateExtension(' + i + ',\'periodId\',this.value)" style="padding:6px 8px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:var(--bg-primary,rgba(26,26,26,1));color:var(--text,rgba(255,255,255,1));font-size:0.85rem;">';
      h += '<input type="date" value="' + esc(x.extendUntil || '') + '"' + (floor ? ' min="' + esc(floor) + '"' : '') + (cap ? ' max="' + esc(cap) + '"' : '') + ' onchange="cpUpdateExtension(' + i + ',\'extendUntil\',this.value)" style="padding:6px 8px;border:1px solid rgba(255,255,255,0.15);border-radius:6px;background:var(--bg-primary,rgba(26,26,26,1));color:var(--text,rgba(255,255,255,1));font-size:0.85rem;">';
      h += '<span style="font-size:0.72rem;color:var(--warm-gray);">' + (cap ? 'cap ' + esc(cap.slice(5)) : '') + '</span>';
      h += '<button class="btn btn-secondary btn-small" onclick="cpRemoveExtension(' + i + ')" title="Remove">&times;</button>';
      h += '</div>';
    });
  }
  h += '</div>';
  h += '<button class="btn btn-secondary btn-small" onclick="cpAddExtension()">+ Add extension</button>';
  h += '</div>';

  h += '<button class="btn btn-primary" onclick="saveClosePolicy()" style="font-size:0.9rem;">Save close policy</button>';
  el.innerHTML = h;
}

window.cpAddExtension = function() {
  var arr = _cpExtensions();
  arr.push({ periodId: '', extendUntil: '' });
  _renderClosePolicy();
};
window.cpRemoveExtension = function(idx) {
  var arr = _cpExtensions();
  arr.splice(idx, 1);
  _renderClosePolicy();
};
window.cpUpdateExtension = function(idx, field, val) {
  var arr = _cpExtensions();
  if (!arr[idx]) return;
  arr[idx][field] = val;
  // If user typed an extendUntil past the cap, snap to cap.
  if (field === 'extendUntil' && arr[idx].periodId) {
    var cap = _cpMonthEndPlus30(arr[idx].periodId);
    if (cap && val > cap) {
      arr[idx].extendUntil = cap;
      showToast('Extension capped at ' + cap + ' (month-end + 30 days).');
      _renderClosePolicy();
    }
  }
};

async function saveClosePolicy() {
  if (!can('finance-period-close', 'edit')) { showToast('Finance write access required.', true); return; }
  var dayEl = document.getElementById('cpAutoCloseDay');
  if (!dayEl) return;
  var autoCloseDay = parseInt(dayEl.value, 10);
  if (!isFinite(autoCloseDay) || autoCloseDay < 5 || autoCloseDay > 30) {
    showToast('Auto-close day must be between 5 and 30.', true);
    dayEl.focus();
    return;
  }
  // Validate + normalize extensions: skip blank rows, validate periodId shape,
  // re-clamp extendUntil to month-end + 30.
  var arr = _cpExtensions();
  var cleaned = [];
  for (var i = 0; i < arr.length; i++) {
    var x = arr[i];
    if (!x.periodId && !x.extendUntil) continue;
    if (!/^\d{4}-\d{2}$/.test(x.periodId || '')) {
      showToast('Period ID must be YYYY-MM (row ' + (i + 1) + ').', true);
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(x.extendUntil || '')) {
      showToast('Extend-until must be a valid date (row ' + (i + 1) + ').', true);
      return;
    }
    var cap = _cpMonthEndPlus30(x.periodId);
    var finalUntil = (cap && x.extendUntil > cap) ? cap : x.extendUntil;
    cleaned.push({ periodId: x.periodId, extendUntil: finalUntil });
  }
  var payload = { autoCloseDay: autoCloseDay, perPeriodExtensions: cleaned };
  try {
    await MastDB.set('admin/config/closePolicy', payload);
    // Audit every save — Close v3 RULE.
    await writeAudit(_closePolicyOriginal ? 'update' : 'create', 'settings', 'closePolicy');
    _closePolicyOriginal = payload;
    showToast('Close policy saved.');
    _renderClosePolicy();
  } catch (err) {
    showToast('Save failed: ' + (err.message || err), true);
  }
}

