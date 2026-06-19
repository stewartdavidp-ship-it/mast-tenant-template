/**
 * Send-Feedback dialog — the in-app "💬 Send Feedback" overlay (type/severity
 * chips, description, optional screenshot, bug-only debug panel) and its submit
 * handler that pushes a feedback report to MastDB.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1, recipe B). Lazy-loaded on demand via the eager openFeedbackDialog
 * shim in index.html (the feedback FAB + the avatar-menu "Send Feedback" item
 * are static/generated markup). All other handlers (closeFeedbackDialog,
 * selectFbChip, updateFbSubmitState, toggleFbDebugPanel, submitFeedback) are
 * referenced only by this dialog's own generated onclick/oninput markup, so
 * they are exported as window.* for those inline handlers.
 *
 * Reads eager shell globals: getScreenLabel, captureFeedbackScreenshot (shared
 * with the Ask-AI modal — stays eager in the shell), showToast, currentUser,
 * currentRoute, MastDB, window._consoleBuffer / window._toastBuffer /
 * window._networkErrors, window.MAST_VERSION / window.MAST_TENANT_PLAN. All
 * defined before the feedback surface can open. Logic moved VERBATIM
 * (behavior-preserving). The eager #feedbackOverlay backdrop-click listener
 * stays in the shell and calls the closeFeedbackDialog shim.
 */
(function () {
  'use strict';

function openFeedbackDialog() {
  var screenLabel = getScreenLabel();
  var html = '<div class="feedback-dialog-header">' +
    '<h3>Send Feedback</h3>' +
    '<button class="modal-close" onclick="closeFeedbackDialog()">&times;</button>' +
  '</div>' +
  '<div class="feedback-dialog-body">' +
    '<div class="feedback-screen-badge">\uD83D\uDCCD You\'re on: ' + screenLabel + '</div>' +
    '<div class="feedback-form-group">' +
      '<label class="feedback-label">Type</label>' +
      '<input type="hidden" name="fbType" id="fbTypeVal" value="bug">' +
      '<div class="feedback-chips">' +
        '<button type="button" class="feedback-chip selected" data-group="fbType" data-value="bug" data-color="#dc2626" style="background:#dc2626;border-color:transparent;color:#fff;" onclick="selectFbChip(this)">Bug</button>' +
        '<button type="button" class="feedback-chip" data-group="fbType" data-value="enhancement" data-color="#2563eb" onclick="selectFbChip(this)">Enhancement</button>' +
        '<button type="button" class="feedback-chip" data-group="fbType" data-value="question" data-color="#0d9488" onclick="selectFbChip(this)">Question</button>' +
        '<button type="button" class="feedback-chip" data-group="fbType" data-value="suggestion" data-color="#7c3aed" onclick="selectFbChip(this)">Suggestion</button>' +
      '</div>' +
    '</div>' +
    '<div class="feedback-form-group">' +
      '<label class="feedback-label">Severity</label>' +
      '<input type="hidden" name="fbSeverity" id="fbSeverityVal" value="medium">' +
      '<div class="feedback-chips">' +
        '<button type="button" class="feedback-chip" data-group="fbSeverity" data-value="low" data-color="#16a34a" onclick="selectFbChip(this)">Low</button>' +
        '<button type="button" class="feedback-chip selected" data-group="fbSeverity" data-value="medium" data-color="#d97706" style="background:#d97706;border-color:transparent;color:#fff;" onclick="selectFbChip(this)">Medium</button>' +
        '<button type="button" class="feedback-chip" data-group="fbSeverity" data-value="high" data-color="#dc2626" onclick="selectFbChip(this)">High</button>' +
      '</div>' +
    '</div>' +
    '<div class="feedback-form-group">' +
      '<label class="feedback-label">Description</label>' +
      '<textarea id="fbDescription" placeholder="What\'s wrong or what do you need?" oninput="updateFbSubmitState()"></textarea>' +
    '</div>' +
    '<div class="feedback-form-group">' +
      '<label class="feedback-screenshot-label">' +
        '<input type="checkbox" id="fbScreenshot">' +
        'Attach a screenshot of this screen' +
      '</label>' +
    '</div>' +
    '<div id="fbDebugPanel" style="display:none;">' +
      '<div class="feedback-debug-panel">' +
        '<button type="button" class="feedback-debug-toggle" id="fbDebugToggle" onclick="toggleFbDebugPanel()">' +
          '<span>Debug info will be attached</span><span id="fbDebugArrow">▾</span>' +
        '</button>' +
        '<div id="fbDebugRows" style="display:none;" class="feedback-debug-rows">' +
          '<div class="feedback-debug-row">' +
            '<label class="feedback-debug-row-left"><input type="checkbox" id="fbDbgConsole" checked> Console errors (last 60s)</label>' +
            '<span class="feedback-debug-row-right" id="fbDbgConsoleCount"></span>' +
          '</div>' +
          '<div class="feedback-debug-row">' +
            '<label class="feedback-debug-row-left"><input type="checkbox" id="fbDbgToasts" checked> Recent toasts</label>' +
            '<span class="feedback-debug-row-right" id="fbDbgToastsCount"></span>' +
          '</div>' +
          '<div class="feedback-debug-row">' +
            '<label class="feedback-debug-row-left"><input type="checkbox" id="fbDbgNetwork" checked> Network errors</label>' +
            '<span class="feedback-debug-row-right" id="fbDbgNetworkCount"></span>' +
          '</div>' +
          '<div class="feedback-debug-row">' +
            '<label class="feedback-debug-row-left"><input type="checkbox" id="fbDbgDevice" checked> Device info</label>' +
            '<span class="feedback-debug-row-right" id="fbDbgDeviceVal"></span>' +
          '</div>' +
          '<div class="feedback-debug-row">' +
            '<label class="feedback-debug-row-left"><input type="checkbox" id="fbDbgVersion" checked> App version</label>' +
            '<span class="feedback-debug-row-right" id="fbDbgVersionVal"></span>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>' +
  '<div class="feedback-dialog-footer">' +
    '<button class="btn btn-secondary" onclick="closeFeedbackDialog()">Cancel</button>' +
    '<button class="btn btn-primary" id="fbSubmitBtn" onclick="submitFeedback()" disabled>Submit</button>' +
  '</div>';
  document.getElementById('feedbackDialog').innerHTML = html;
  document.getElementById('feedbackOverlay').classList.add('open');
  var panel = document.getElementById('fbDebugPanel');
  if (panel) { panel.style.display = ''; refreshFbDebugCounts(); }
  setTimeout(function() {
    var ta = document.getElementById('fbDescription');
    if (ta) ta.focus();
  }, 100);
}

function closeFeedbackDialog() {
  document.getElementById('feedbackOverlay').classList.remove('open');
  document.getElementById('feedbackDialog').innerHTML = '';
}

function updateFbSubmitState() {
  var desc = document.getElementById('fbDescription');
  var btn = document.getElementById('fbSubmitBtn');
  if (btn) btn.disabled = !(desc && desc.value.trim());
}

function selectFbChip(chip) {
  var group = chip.dataset.group;
  var color = chip.dataset.color;
  document.querySelectorAll('.feedback-chip[data-group="' + group + '"]').forEach(function(c) {
    c.classList.remove('selected');
    c.style.background = '';
    c.style.borderColor = '';
    c.style.color = '';
  });
  chip.classList.add('selected');
  chip.style.background = color;
  chip.style.borderColor = 'transparent';
  chip.style.color = '#fff';
  var hidden = document.getElementById(group + 'Val');
  if (hidden) hidden.value = chip.dataset.value;
  if (group === 'fbType') {
    var panel = document.getElementById('fbDebugPanel');
    if (panel) {
      if (chip.dataset.value === 'bug') {
        panel.style.display = '';
        refreshFbDebugCounts();
      } else {
        panel.style.display = 'none';
      }
    }
  }
}

function refreshFbDebugCounts() {
  var now = Date.now();
  var cutoff = now - 60000;
  var consoleCount = (window._consoleBuffer || []).filter(function(e) { return e.t >= cutoff; }).length;
  var toastCount = (window._toastBuffer || []).length;
  var netCount = (window._networkErrors || []).length;
  var browser = (navigator.userAgent.match(/(Chrome|Safari|Firefox|Edge)\/[\d.]+/) || ['Browser'])[0];
  var deviceStr = browser + ' · ' + window.innerWidth + '×' + window.innerHeight;
  var version = window.MAST_VERSION || 'unknown';
  var c = document.getElementById('fbDbgConsoleCount'); if (c) c.textContent = consoleCount + ' entries';
  var t = document.getElementById('fbDbgToastsCount'); if (t) t.textContent = toastCount + ' entries';
  var n = document.getElementById('fbDbgNetworkCount'); if (n) n.textContent = netCount + ' entries';
  var d = document.getElementById('fbDbgDeviceVal'); if (d) d.textContent = deviceStr;
  var v = document.getElementById('fbDbgVersionVal'); if (v) v.textContent = version;
}

function toggleFbDebugPanel() {
  var rows = document.getElementById('fbDebugRows');
  var arrow = document.getElementById('fbDebugArrow');
  if (!rows) return;
  var open = rows.style.display !== 'none';
  rows.style.display = open ? 'none' : '';
  if (arrow) arrow.textContent = open ? '▾' : '▴';
}

async function submitFeedback() {
  var desc = document.getElementById('fbDescription');
  if (!desc || !desc.value.trim()) return;

  var type = document.getElementById('fbTypeVal');
  var severity = document.getElementById('fbSeverityVal');
  var wantScreenshot = !!(document.getElementById('fbScreenshot') && document.getElementById('fbScreenshot').checked);

  var btn = document.getElementById('fbSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Sending...'; }

  // Collect all form values before closing the dialog
  var descValue = desc.value.trim();
  var fbType = type ? type.value : 'bug';
  var fbSeverity = severity ? severity.value : 'medium';
  var now = Date.now();
  var cutoff = now - 60000;

  // Debug panel toggle state \u2014 read before dialog closes
  var dbgConsole = document.getElementById('fbDbgConsole');
  var dbgToasts = document.getElementById('fbDbgToasts');
  var dbgNetwork = document.getElementById('fbDbgNetwork');
  var dbgDevice = document.getElementById('fbDbgDevice');
  var dbgVersion = document.getElementById('fbDbgVersion');
  var inclConsole = !dbgConsole || dbgConsole.checked;
  var inclToasts = !dbgToasts || dbgToasts.checked;
  var inclNetwork = !dbgNetwork || dbgNetwork.checked;
  var inclDevice = !dbgDevice || dbgDevice.checked;
  var inclVersion = !dbgVersion || dbgVersion.checked;

  // Close dialog first so the full UI is visible for any screenshot capture
  closeFeedbackDialog();

  var report = {
    appId: MastDB.tenantId(),
    source: 'internal',
    screen: currentRoute || 'unknown',
    screenLabel: getScreenLabel(),
    type: fbType,
    severity: fbSeverity,
    description: descValue,
    email: null,
    userId: currentUser ? currentUser.uid : null,
    userName: currentUser ? (currentUser.displayName || currentUser.email || '') : null,
    tenantPlan: window.MAST_TENANT_PLAN || null,
    consoleBuffer: inclConsole && window._consoleBuffer ? window._consoleBuffer.filter(function(e) { return e.t >= cutoff; }) : null,
    toastBuffer: inclToasts && window._toastBuffer ? window._toastBuffer.filter(function(e) { return e.t >= cutoff; }) : null,
    deviceInfo: inclDevice ? { userAgent: navigator.userAgent, viewport: { width: window.innerWidth, height: window.innerHeight } } : null,
    appVersion: inclVersion ? (window.MAST_VERSION || null) : null,
    screenshotUrl: null,
    screenshotStoragePath: null,
    timestamp: new Date().toISOString(),
    status: 'open',
    jobId: null,
    createdAt: MastDB.serverTimestamp()
  };
  if (fbType === 'bug' && inclNetwork) {
    report.networkErrors = window._networkErrors ? window._networkErrors.filter(function(e) { return e.t >= cutoff; }) : [];
  }

  try {
    var pushResult = await MastDB.feedback.ref().push(report);
    showToast('Feedback submitted \u2014 thanks!');

    // Capture screenshot in background after submission confirmed (non-blocking)
    if (wantScreenshot && pushResult && pushResult.key) {
      var reportId = pushResult.key;
      setTimeout(function() {
        (async function() {
          try {
            var captureTimeout = new Promise(function(_, reject) {
              setTimeout(function() { reject(new Error('screenshot timeout')); }, 8000);
            });
            var result = await Promise.race([captureFeedbackScreenshot(), captureTimeout]);
            await MastDB.feedback.ref(reportId).update({
              screenshotUrl: result.url,
              screenshotStoragePath: result.storagePath
            });
          } catch (e) {
            console.warn('[feedback] Screenshot attach failed:', e);
          }
        })();
      }, 350);
    }
  } catch (err) {
    showToast('Error submitting feedback: ' + err.message, true);
    if (btn) { btn.disabled = false; btn.textContent = 'Submit'; }
  }
}


  // Impl for the eager shim (externally called: FAB onclick + avatar menu) +
  // the dialog's own onclick/oninput targets.
  window.openFeedbackDialogImpl = openFeedbackDialog;
  window.closeFeedbackDialog = closeFeedbackDialog;
  window.updateFbSubmitState = updateFbSubmitState;
  window.selectFbChip = selectFbChip;
  window.refreshFbDebugCounts = refreshFbDebugCounts;
  window.toggleFbDebugPanel = toggleFbDebugPanel;
  window.submitFeedback = submitFeedback;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('feedbackDialog', {});
  }
})();
