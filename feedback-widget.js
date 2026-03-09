/**
 * Shir Glassworks — Public Feedback Widget
 *
 * Drop-in floating feedback button for public-facing pages.
 * Reads `feedbackSettings/publicEnabled` from Firebase to determine visibility.
 * Submits reports to `shirglassworks/feedbackReports`.
 *
 * Requirements:
 *   - Firebase must be initialized before this script runs
 *   - firebase.database() must be available
 *
 * Usage:
 *   <script src="feedback-widget.js"></script>
 */
(function() {
  'use strict';

  var FEEDBACK_PATH = 'shirglassworks/feedbackReports';
  var SETTINGS_PATH = 'shirglassworks/admin/feedbackSettings/publicEnabled';
  var APP_ID = 'shirglassworks';
  var db = firebase.database();

  // Rate limiting — one submission per 30 seconds
  function canSubmit() {
    try {
      var last = sessionStorage.getItem('sg_fb_last');
      if (!last) return true;
      return (Date.now() - parseInt(last, 10)) > 30000;
    } catch (e) { return true; }
  }
  function markSubmitted() {
    try { sessionStorage.setItem('sg_fb_last', String(Date.now())); } catch (e) {}
  }

  // Check if public feedback is enabled
  db.ref(SETTINGS_PATH).once('value', function(snap) {
    if (snap.val() !== true) return;
    injectWidget();
  });

  function injectWidget() {
    // Inject CSS
    var style = document.createElement('style');
    style.textContent = [
      '.sg-fb-fab{position:fixed;bottom:24px;right:24px;z-index:9999;width:44px;height:44px;border-radius:50%;background:#2A7C6F;color:#fff;border:none;font-size:1.2rem;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;transition:background 0.2s,transform 0.2s;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
      '.sg-fb-fab:hover{background:#1B5C52;transform:scale(1.08);}',
      '.sg-fb-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
      '.sg-fb-overlay.open{display:flex;}',
      '.sg-fb-dialog{background:#FAF6F0;border-radius:10px;width:100%;max-width:400px;max-height:90vh;overflow-y:auto;box-shadow:0 8px 30px rgba(0,0,0,0.2);}',
      '.sg-fb-header{padding:20px 24px 0;display:flex;align-items:center;justify-content:space-between;}',
      '.sg-fb-header h3{font-size:1.15rem;font-weight:600;margin:0;color:#1A1A1A;}',
      '.sg-fb-close{background:none;border:none;font-size:1.5rem;cursor:pointer;color:#6B6560;line-height:1;padding:4px;}',
      '.sg-fb-body{padding:16px 24px 20px;}',
      '.sg-fb-seg{display:flex;gap:0;border:1px solid #ddd;border-radius:6px;overflow:hidden;margin-bottom:14px;}',
      '.sg-fb-seg label{flex:1;text-align:center;padding:7px 4px;font-size:0.82rem;font-weight:500;cursor:pointer;background:#fff;transition:background 0.15s;border-right:1px solid #ddd;margin:0;}',
      '.sg-fb-seg label:last-child{border-right:none;}',
      '.sg-fb-seg input{display:none;}',
      '.sg-fb-seg label:has(input:checked){background:#2A7C6F;color:#fff;}',
      '.sg-fb-body textarea{width:100%;min-height:90px;padding:10px 12px;border:1px solid #ddd;border-radius:6px;font-family:inherit;font-size:0.9rem;resize:vertical;box-sizing:border-box;}',
      '.sg-fb-body input[type=email]{width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:inherit;font-size:0.9rem;box-sizing:border-box;}',
      '.sg-fb-footer{padding:0 24px 20px;display:flex;justify-content:flex-end;gap:10px;}',
      '.sg-fb-btn{font-family:inherit;font-size:0.88rem;font-weight:500;padding:8px 18px;border-radius:6px;cursor:pointer;border:none;transition:background 0.2s,opacity 0.2s;}',
      '.sg-fb-btn:disabled{opacity:0.5;cursor:not-allowed;}',
      '.sg-fb-btn-cancel{background:#FAF6F0;color:#1A1A1A;border:1px solid #ccc;}',
      '.sg-fb-btn-submit{background:#C4853C;color:#fff;}',
      '.sg-fb-btn-submit:hover:not(:disabled){background:#b37832;}',
      '.sg-fb-lbl{display:block;font-size:0.82rem;font-weight:600;margin-bottom:5px;color:#1A1A1A;}',
      '.sg-fb-grp{margin-bottom:14px;}',
      '.sg-fb-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1A1A1A;color:#fff;padding:10px 20px;border-radius:6px;font-size:0.9rem;z-index:10001;box-shadow:0 4px 12px rgba(0,0,0,0.2);animation:sgfbIn 0.3s ease,sgfbOut 0.3s ease 2.7s forwards;}',
      '@keyframes sgfbIn{from{opacity:0;transform:translateX(-50%) translateY(10px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}',
      '@keyframes sgfbOut{from{opacity:1;}to{opacity:0;}}'
    ].join('\n');
    document.head.appendChild(style);

    // Inject FAB
    var fab = document.createElement('button');
    fab.className = 'sg-fb-fab';
    fab.title = 'Send feedback';
    fab.textContent = '\uD83D\uDCAC'; // 💬
    fab.onclick = openDialog;
    document.body.appendChild(fab);

    // Inject overlay
    var overlay = document.createElement('div');
    overlay.className = 'sg-fb-overlay';
    overlay.id = 'sgFbOverlay';
    overlay.onclick = function(e) { if (e.target === overlay) closeDialog(); };
    var dialog = document.createElement('div');
    dialog.className = 'sg-fb-dialog';
    dialog.id = 'sgFbDialog';
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function openDialog() {
    var dialog = document.getElementById('sgFbDialog');
    if (!dialog) return;

    var screen = location.pathname.replace(/\/$/, '').split('/').pop() || 'home';
    dialog.setAttribute('data-screen', screen);

    dialog.innerHTML =
      '<div class="sg-fb-header">' +
        '<h3>Send Feedback</h3>' +
        '<button class="sg-fb-close" onclick="document.getElementById(\'sgFbOverlay\').classList.remove(\'open\')">&times;</button>' +
      '</div>' +
      '<div class="sg-fb-body">' +
        '<div class="sg-fb-grp">' +
          '<label class="sg-fb-lbl">Type</label>' +
          '<div class="sg-fb-seg">' +
            '<label><input type="radio" name="sgFbType" value="bug" checked><span>Bug</span></label>' +
            '<label><input type="radio" name="sgFbType" value="suggestion"><span>Suggestion</span></label>' +
            '<label><input type="radio" name="sgFbType" value="question"><span>Question</span></label>' +
          '</div>' +
        '</div>' +
        '<div class="sg-fb-grp">' +
          '<label class="sg-fb-lbl">What\'s on your mind?</label>' +
          '<textarea id="sgFbDesc" placeholder="Tell us what\'s on your mind"></textarea>' +
        '</div>' +
        '<div class="sg-fb-grp">' +
          '<label class="sg-fb-lbl">Email <span style="font-weight:400;color:#9B958E;">(optional)</span></label>' +
          '<input type="email" id="sgFbEmail" placeholder="Your email, if you\'d like a response">' +
        '</div>' +
        '<!-- Honeypot -->' +
        '<div style="position:absolute;left:-9999px;"><input type="text" id="sgFbHp" tabindex="-1" autocomplete="off"></div>' +
      '</div>' +
      '<div class="sg-fb-footer">' +
        '<button class="sg-fb-btn sg-fb-btn-cancel" onclick="document.getElementById(\'sgFbOverlay\').classList.remove(\'open\')">Cancel</button>' +
        '<button class="sg-fb-btn sg-fb-btn-submit" id="sgFbSubmit" disabled>Submit</button>' +
      '</div>';

    // Enable/disable submit based on description
    var desc = document.getElementById('sgFbDesc');
    var submitBtn = document.getElementById('sgFbSubmit');
    desc.addEventListener('input', function() {
      submitBtn.disabled = !desc.value.trim();
    });
    submitBtn.addEventListener('click', handleSubmit);

    document.getElementById('sgFbOverlay').classList.add('open');
    setTimeout(function() { desc.focus(); }, 100);
  }

  function closeDialog() {
    var overlay = document.getElementById('sgFbOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  function handleSubmit() {
    var desc = document.getElementById('sgFbDesc');
    var email = document.getElementById('sgFbEmail');
    var hp = document.getElementById('sgFbHp');
    var dialog = document.getElementById('sgFbDialog');
    var submitBtn = document.getElementById('sgFbSubmit');

    if (!desc || !desc.value.trim()) return;

    // Honeypot check
    if (hp && hp.value) {
      closeDialog();
      showFbToast('Thanks for your feedback!');
      return;
    }

    // Rate limit check
    if (!canSubmit()) {
      showFbToast('Please wait before submitting again.');
      return;
    }

    var type = document.querySelector('input[name="sgFbType"]:checked');
    var screen = dialog ? dialog.getAttribute('data-screen') : 'unknown';

    var report = {
      appId: APP_ID,
      source: 'public',
      screen: screen,
      screenLabel: null,
      type: type ? type.value : 'bug',
      severity: null,
      description: desc.value.trim(),
      email: (email && email.value.trim()) || null,
      userId: null,
      userName: null,
      timestamp: new Date().toISOString(),
      status: 'open',
      jobId: null,
      createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Sending...'; }

    db.ref(FEEDBACK_PATH).push(report)
      .then(function() {
        markSubmitted();
        closeDialog();
        showFbToast('Thanks for your feedback!');
      })
      .catch(function(err) {
        showFbToast('Error — please try again.');
        if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Submit'; }
      });
  }

  function showFbToast(msg) {
    var toast = document.createElement('div');
    toast.className = 'sg-fb-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }
})();
