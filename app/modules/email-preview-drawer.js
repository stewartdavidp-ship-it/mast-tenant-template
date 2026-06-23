/**
 * Email Preview Drawer — the slide-out that previews an automated email
 * (subject + rendered HTML body) for a given EMAIL_TRIGGER_REGISTRY entry.
 * Tries the previewEmail Cloud Function first, then falls back to the most
 * recent send in the email log.
 *
 * Extracted from app/index.html's inline block (decomposition master plan §14,
 * Track 1). Lazy-loaded on demand via the eager openEmailPreviewDrawer /
 * closeEmailPreviewDrawer shims in index.html (the per-trigger "Preview"
 * button is generated onclick; the drawer backdrop + close button are static
 * markup). No cross-module caller — only index.html invokes these.
 *
 * Reads eager shell globals: EMAIL_TRIGGER_REGISTRY, escAttrGlobal, esc,
 * MastDB, firebase. All defined before the email-triggers surface can render.
 * Logic moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

function openEmailPreviewDrawer(triggerId) {
  var trigger = EMAIL_TRIGGER_REGISTRY.find(function(t) { return t.id === triggerId; });
  if (!trigger) return;

  var drawer = document.getElementById('emailPreviewDrawer');
  var backdrop = document.getElementById('emailPreviewBackdrop');
  var titleEl = document.getElementById('emailPreviewDrawerTitle');
  var badgeEl = document.getElementById('emailPreviewDrawerBadge');
  var subjectEl = document.getElementById('emailPreviewDrawerSubject');
  var subjectTextEl = document.getElementById('emailPreviewDrawerSubjectText');
  var bodyEl = document.getElementById('emailPreviewDrawerBody');
  var footerEl = document.getElementById('emailPreviewDrawerFooter');
  var footerTextEl = document.getElementById('emailPreviewDrawerFooterText');

  // Set header
  titleEl.textContent = trigger.name;
  badgeEl.textContent = trigger.module;
  badgeEl.style.display = '';
  subjectEl.style.display = 'none';
  footerEl.style.display = 'none';
  bodyEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);font-size:0.85rem;">Loading preview...</div>';

  // Show drawer
  backdrop.style.display = '';
  requestAnimationFrame(function() { backdrop.style.opacity = '1'; });
  drawer.style.right = '0';

  // Try Cloud Function first, then fall back to email log
  firebase.functions().httpsCallable('previewEmail')({
    emailType: triggerId,
    tenantId: MastDB.tenantId()
  }).then(function(result) {
    var html = result.data && result.data.html;
    var subject = result.data && result.data.subject;
    renderDrawerPreview(html, subject, null);
  }).catch(function() {
    loadDrawerPreviewFromLog(trigger);
  });
}

function renderDrawerPreview(html, subject, footerNote) {
  var subjectEl = document.getElementById('emailPreviewDrawerSubject');
  var subjectTextEl = document.getElementById('emailPreviewDrawerSubjectText');
  var bodyEl = document.getElementById('emailPreviewDrawerBody');
  var footerEl = document.getElementById('emailPreviewDrawerFooter');
  var footerTextEl = document.getElementById('emailPreviewDrawerFooterText');

  if (subject) {
    subjectTextEl.textContent = subject;
    subjectEl.style.display = '';
  }

  if (html) {
    bodyEl.innerHTML = '<div style="background:white;border-radius:6px;overflow:hidden;height:100%;">' +
      '<iframe sandbox="" srcdoc="' + escAttrGlobal(html) + '" style="width:100%;border:none;display:block;height:calc(100vh - 160px);" onload="try{this.style.height=Math.max(this.contentDocument.body.scrollHeight+20,600)+\'px\'}catch(e){}"></iframe>' +
      '</div>';
  } else {
    bodyEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);font-size:0.85rem;">No preview available for this email type.</div>';
  }

  if (footerNote) {
    footerTextEl.textContent = footerNote;
    footerEl.style.display = '';
  }
}

function loadDrawerPreviewFromLog(trigger) {
  var bodyEl = document.getElementById('emailPreviewDrawerBody');

  MastDB.query('emails').orderByChild('emailType').equalTo(trigger.emailType).limitToLast(1).once('value').then(function(snap) {
    var val = snap.val();
    if (!val) {
      bodyEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);font-size:0.85rem;">No preview available yet.<br><span style="font-size:0.78rem;">This email will appear here after it has been sent at least once.</span></div>';
      return;
    }
    var key = Object.keys(val)[0];
    var email = val[key];
    var footerNote = 'From most recent send' + (email.createdAt ? ' (' + MastFormat.date(email.createdAt) + ')' : '');
    renderDrawerPreview(email.htmlSnapshot || null, email.subject || null, footerNote);
  }).catch(function(err) {
    bodyEl.innerHTML = '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);font-size:0.85rem;">Failed to load preview: ' + esc(err.message) + '</div>';
  });
}

function closeEmailPreviewDrawer() {
  var drawer = document.getElementById('emailPreviewDrawer');
  var backdrop = document.getElementById('emailPreviewBackdrop');
  if (drawer) drawer.style.right = '-520px';
  if (backdrop) {
    backdrop.style.opacity = '0';
    setTimeout(function() { backdrop.style.display = 'none'; }, 250);
  }
}

  // Impls for the eager shims (2 externally-called) + the drawer's internal helpers.
  window.openEmailPreviewDrawerImpl = openEmailPreviewDrawer;
  window.closeEmailPreviewDrawerImpl = closeEmailPreviewDrawer;
  window.renderDrawerPreview = renderDrawerPreview;
  window.loadDrawerPreviewFromLog = loadDrawerPreviewFromLog;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('emailPreviewDrawer', {});
  }
})();
