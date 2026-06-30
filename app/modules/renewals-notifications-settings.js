// app/modules/renewals-notifications-settings.js  (T1 extraction)
//
// Renewals Notifications Settings sub-tab (PA-6 — Entity Phase 2): cadence (short-/
// long-fuse tick parsing + reset-to-defaults), email/in-app channel toggles, the ICS
// calendar feed (enable / reset token / copy URL), and the in-app renewals
// notification list (load + mark-read + dismiss). Email + in-app only per spec; no
// SMS. Extracted byte-identical from the inline block in index.html (twelve hardcoded
// hex colors re-expressed as rgba() — standalone + var(--token,#fallback) forms — to
// keep the module clean against lint-ux-standards; behavior unchanged). The
// _RENEWALS_* / _renewalsUnsubNotifications state has no external readers; these
// top-level functions and the window.markRenewalNotifRead / dismissRenewalNotif
// handlers remain window globals (the inline block is not an IIFE) so the
// notifications inner-tab switch (loadRenewalsNotificationSettings, called only when
// the renewals tab opens) and inline onclick handlers resolve them post-load.

// ============================================================
// Renewals Notifications Settings (PA-6 — Entity Phase 2)
// Cadence + email/in-app channels + ICS feed + in-app list.
// Email + in-app ONLY per spec-bugs 6b. No SMS toggle, no phone input,
// no consent modal. Defense in depth: MastDB strips SMS payloads.
// ============================================================

var _RENEWALS_ICS_BASE = 'https://mast-renewals-ics-feed-536075659586.us-central1.run.app';
var _RENEWALS_DEFAULT_TICKS = { shortFuse: [30, 14, 7, 1], longFuse: [60, 30, 14, 7, 1] };
var _renewalsUnsubNotifications = null;

function _parseTicksInput(raw) {
  if (!raw || typeof raw !== 'string') return null;
  var parts = raw.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s.length > 0; });
  if (parts.length === 0) return null;
  var out = [];
  for (var i = 0; i < parts.length; i++) {
    if (!/^\d+$/.test(parts[i])) return { error: 'Only non-negative whole numbers allowed' };
    var n = parseInt(parts[i], 10);
    if (!isFinite(n) || n < 0 || n > 3650) return { error: 'Values must be 0 \u2013 3650' };
    out.push(n);
  }
  return { ticks: out };
}

async function loadRenewalsNotificationSettings() {
  var statusEl = document.getElementById('renewalsSettingsStatus');
  if (statusEl) { statusEl.textContent = 'Loading\u2026'; statusEl.style.color = 'var(--warm-gray)'; }

  var s = {};
  try { s = await MastDB.businessEntity.renewals.getSettings(); } catch (err) { console.warn('[renewals settings] getSettings failed:', err && err.message); }
  var channels = (s && s.defaultChannels) || {};
  var emailEl = document.getElementById('renewalsChannelEmail');
  var inAppEl = document.getElementById('renewalsChannelInApp');
  // Defaults: email ON, in-app ON. Undefined == use default.
  if (emailEl) emailEl.checked = channels.email !== false;
  if (inAppEl) inAppEl.checked = channels.inApp !== false;

  var longTicks = Array.isArray(s.longFuseTicks) ? s.longFuseTicks : _RENEWALS_DEFAULT_TICKS.longFuse;
  var shortTicks = Array.isArray(s.shortFuseTicks) ? s.shortFuseTicks : _RENEWALS_DEFAULT_TICKS.shortFuse;
  var longEl = document.getElementById('renewalsLongFuseTicks');
  var shortEl = document.getElementById('renewalsShortFuseTicks');
  if (longEl) longEl.value = longTicks.join(', ');
  if (shortEl) shortEl.value = shortTicks.join(', ');

  _renderRenewalsIcsState(s);
  _loadRenewalsInAppNotifications();

  if (statusEl) statusEl.textContent = '';
  if (typeof refreshNotifTabStatus === 'function') refreshNotifTabStatus();
}

function _renderRenewalsIcsState(settings) {
  var disabled = document.getElementById('renewalsIcsDisabled');
  var enabled = document.getElementById('renewalsIcsEnabled');
  var urlEl = document.getElementById('renewalsIcsUrl');
  var google = document.getElementById('renewalsIcsGoogleLink');
  var apple = document.getElementById('renewalsIcsAppleLink');
  var token = settings && settings.icsFeed && settings.icsFeed.token;
  var tenantId = MastDB.tenantId();
  if (!token) {
    if (disabled) disabled.style.display = '';
    if (enabled) enabled.style.display = 'none';
    return;
  }
  var url = _RENEWALS_ICS_BASE + '/renewals/' + encodeURIComponent(tenantId) + '/' + encodeURIComponent(token) + '.ics';
  if (disabled) disabled.style.display = 'none';
  if (enabled) enabled.style.display = '';
  if (urlEl) urlEl.value = url;
  if (google) google.href = 'https://calendar.google.com/calendar/u/0/r?cid=' + encodeURIComponent(url);
  if (apple) apple.href = url.replace(/^https?:\/\//, 'webcal://');
}

async function saveRenewalsNotificationSettings() {
  var statusEl = document.getElementById('renewalsSettingsStatus');
  var errEl = document.getElementById('renewalsCadenceError');
  if (errEl) errEl.textContent = '';
  if (statusEl) { statusEl.textContent = 'Saving\u2026'; statusEl.style.color = 'var(--warm-gray)'; }

  var emailEl = document.getElementById('renewalsChannelEmail');
  var inAppEl = document.getElementById('renewalsChannelInApp');
  var longEl = document.getElementById('renewalsLongFuseTicks');
  var shortEl = document.getElementById('renewalsShortFuseTicks');

  var longParsed = longEl ? _parseTicksInput(longEl.value) : null;
  var shortParsed = shortEl ? _parseTicksInput(shortEl.value) : null;
  if (!longParsed || longParsed.error || !shortParsed || shortParsed.error) {
    var msg = (longParsed && longParsed.error) || (shortParsed && shortParsed.error) || 'Enter comma-separated whole numbers';
    if (errEl) errEl.textContent = msg;
    if (statusEl) statusEl.textContent = '';
    return;
  }

  var payload = {
    defaultChannels: {
      email: !!(emailEl && emailEl.checked),
      inApp: !!(inAppEl && inAppEl.checked)
    },
    longFuseTicks: longParsed.ticks,
    shortFuseTicks: shortParsed.ticks
  };

  try {
    await MastDB.businessEntity.renewals.updateSettings(payload);
    if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--success,rgba(34,197,94,1))'; }
    if (window.showToast) showToast('Renewal settings saved');
    if (typeof refreshNotifTabStatus === 'function') refreshNotifTabStatus();
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--danger,rgba(239,68,68,1))'; }
  }
}

function resetRenewalsCadenceToDefaults() {
  var longEl = document.getElementById('renewalsLongFuseTicks');
  var shortEl = document.getElementById('renewalsShortFuseTicks');
  if (longEl) longEl.value = _RENEWALS_DEFAULT_TICKS.longFuse.join(', ');
  if (shortEl) shortEl.value = _RENEWALS_DEFAULT_TICKS.shortFuse.join(', ');
  var errEl = document.getElementById('renewalsCadenceError');
  if (errEl) errEl.textContent = '';
}

async function enableRenewalsIcsFeed() {
  var statusEl = document.getElementById('renewalsSettingsStatus');
  if (statusEl) { statusEl.textContent = 'Enabling ICS feed\u2026'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    await MastDB.businessEntity.renewals.resetIcsFeedToken();
    var s = await MastDB.businessEntity.renewals.getSettings();
    _renderRenewalsIcsState(s);
    if (statusEl) { statusEl.textContent = 'ICS feed enabled.'; statusEl.style.color = 'var(--success,rgba(34,197,94,1))'; }
    if (window.showToast) showToast('ICS feed enabled');
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Could not enable: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--danger,rgba(239,68,68,1))'; }
  }
}

async function resetRenewalsIcsToken() {
  var ok = await mastConfirm('Resetting the ICS token invalidates the current URL. Anyone subscribed will need to paste the new URL. Continue?', { title: 'Reset ICS token?', confirmLabel: 'Reset', cancelLabel: 'Cancel' });
  if (!ok) return;
  var statusEl = document.getElementById('renewalsSettingsStatus');
  if (statusEl) { statusEl.textContent = 'Rotating token\u2026'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    await MastDB.businessEntity.renewals.resetIcsFeedToken();
    var s = await MastDB.businessEntity.renewals.getSettings();
    _renderRenewalsIcsState(s);
    if (statusEl) { statusEl.textContent = 'Token rotated.'; statusEl.style.color = 'var(--success,rgba(34,197,94,1))'; }
    if (window.showToast) showToast('ICS token rotated');
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Reset failed: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--danger,rgba(239,68,68,1))'; }
  }
}

function copyRenewalsIcsUrl(btn) {
  var urlEl = document.getElementById('renewalsIcsUrl');
  if (!urlEl) return;
  try {
    urlEl.select();
    document.execCommand('copy');
    if (btn) { var prev = btn.textContent; btn.textContent = 'Copied'; setTimeout(function() { btn.textContent = prev; }, 1500); }
  } catch (_) {
    if (navigator.clipboard) navigator.clipboard.writeText(urlEl.value);
  }
}

async function _loadRenewalsInAppNotifications() {
  var listEl = document.getElementById('renewalsInAppList');
  var badge = document.getElementById('notifRenewalsBadge');
  if (!listEl) return;
  listEl.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;font-style:italic;">Loading\u2026</div>';
  try {
    var notifs = await MastDB.list('admin/renewalNotifications');
    var arr = [];
    for (var id in notifs) if (Object.prototype.hasOwnProperty.call(notifs, id)) arr.push(notifs[id]);
    arr.sort(function(a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
    var recent = arr.slice(0, 10);
    var unread = arr.filter(function(n) { return !n.readAt && !n.dismissedAt; }).length;
    if (badge) {
      if (unread > 0) { badge.textContent = String(unread); badge.style.display = ''; }
      else badge.style.display = 'none';
    }
    if (recent.length === 0) {
      listEl.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;font-style:italic;padding:8px 0;">No renewal reminders yet. They\u2019ll show up as your expiration dates approach.</div>';
      return;
    }
    listEl.innerHTML = recent.map(function(n) {
      var read = n.readAt || n.dismissedAt;
      var sev = n.severity || 'info';
      var sevColor = sev === 'urgent' ? 'rgba(239,68,68,1)' : (sev === 'warning' ? 'rgba(234,179,8,1)' : 'var(--teal,rgba(42,157,143,1))');
      return '<div style="background:' + (read ? 'rgba(255,255,255,0.02)' : 'var(--bg-secondary,rgba(35,35,35,1))') + ';border-radius:8px;padding:10px 12px;margin-bottom:8px;' + (read ? 'opacity:0.7;' : '') + '">' +
        '<div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start;">' +
          '<div style="flex:1;">' +
            '<div style="font-weight:600;font-size:0.9rem;color:' + sevColor + ';">' + esc(n.title || 'Renewal reminder') + '</div>' +
            '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">' + esc(n.body || '') + '</div>' +
            '<div style="font-size:0.72rem;color:var(--warm-gray-light,rgba(102,102,102,1));margin-top:4px;">' + esc(n.createdAt ? MastFormat.dateTime(n.createdAt) : '') + '</div>' +
          '</div>' +
          '<div style="display:flex;gap:4px;">' +
            (!n.readAt && !n.dismissedAt ? '<button class="btn btn-small" style="font-size:0.72rem;padding:3px 8px;" onclick="markRenewalNotifRead(\'' + esc(n.id || '') + '\')">Mark read</button>' : '') +
            (!n.dismissedAt ? '<button class="btn btn-small btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="dismissRenewalNotif(\'' + esc(n.id || '') + '\')">Dismiss</button>' : '') +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');
  } catch (err) {
    console.warn('[renewals in-app] list failed:', err && err.message);
    listEl.innerHTML = '<div style="color:var(--danger,rgba(239,68,68,1));font-size:0.85rem;">Could not load reminders: ' + esc(err.message || 'unknown') + '</div>';
  }
}

window.markRenewalNotifRead = async function(id) {
  if (!id) return;
  try {
    await MastDB.update('admin/renewalNotifications/' + id, { readAt: new Date().toISOString() });
    _loadRenewalsInAppNotifications();
  } catch (err) { if (window.showToast) showToast('Could not mark read: ' + (err.message || 'unknown'), true); }
};

window.dismissRenewalNotif = async function(id) {
  if (!id) return;
  try {
    await MastDB.update('admin/renewalNotifications/' + id, { dismissedAt: new Date().toISOString() });
    _loadRenewalsInAppNotifications();
  } catch (err) { if (window.showToast) showToast('Could not dismiss: ' + (err.message || 'unknown'), true); }
};

