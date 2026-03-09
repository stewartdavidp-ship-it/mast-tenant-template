/**
 * Shir Glassworks — Share Widget
 *
 * Floating share button for public-facing pages.
 * Uses navigator.share() on supported devices (mobile),
 * falls back to a simple copy-link dialog on desktop.
 *
 * Requirements:
 *   - No dependencies (pure vanilla JS)
 *
 * Usage:
 *   <script src="share-widget.js"></script>
 */
(function() {
  'use strict';

  var SHARE_TITLE = 'Shir Glassworks';
  var SHARE_TEXT = 'Check out Shir Glassworks — handmade glass art from Western Massachusetts.';

  function getShareUrl() {
    // Always share the homepage URL, not whatever page you're on
    var loc = window.location;
    return loc.protocol + '//' + loc.host + loc.pathname.replace(/\/blog\/.*|\/[^/]*\.html.*/, '/');
  }

  // Inject CSS
  var style = document.createElement('style');
  style.textContent = [
    '.sg-share-fab{position:fixed;bottom:80px;right:24px;z-index:9998;width:44px;height:44px;border-radius:50%;background:var(--amber,#C4853C);color:#fff;border:none;font-size:1.1rem;cursor:pointer;box-shadow:0 4px 12px rgba(0,0,0,0.25);display:flex;align-items:center;justify-content:center;transition:background 0.2s,transform 0.2s;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
    '.sg-share-fab:hover{background:#b37832;transform:scale(1.08);}',
    '.sg-share-fab svg{width:20px;height:20px;fill:currentColor;}',
    '.sg-share-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:10000;align-items:center;justify-content:center;padding:20px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;}',
    '.sg-share-overlay.open{display:flex;}',
    '.sg-share-dialog{background:#FAF6F0;border-radius:10px;width:100%;max-width:360px;box-shadow:0 8px 30px rgba(0,0,0,0.2);overflow:hidden;}',
    '.sg-share-header{padding:20px 24px 0;display:flex;align-items:center;justify-content:space-between;}',
    '.sg-share-header h3{font-size:1.1rem;font-weight:600;margin:0;color:#1A1A1A;}',
    '.sg-share-close{background:none;border:none;font-size:1.5rem;cursor:pointer;color:#6B6560;line-height:1;padding:4px;}',
    '.sg-share-body{padding:16px 24px 24px;}',
    '.sg-share-body p{font-size:0.9rem;color:#555;margin:0 0 14px;line-height:1.5;}',
    '.sg-share-url-row{display:flex;gap:8px;align-items:center;}',
    '.sg-share-url{flex:1;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-family:inherit;font-size:0.85rem;background:#fff;color:#1A1A1A;outline:none;min-width:0;}',
    '.sg-share-url:focus{border-color:#C4853C;}',
    '.sg-share-copy{padding:9px 16px;border:none;border-radius:6px;background:#C4853C;color:#fff;font-family:inherit;font-size:0.85rem;font-weight:500;cursor:pointer;white-space:nowrap;transition:background 0.2s;}',
    '.sg-share-copy:hover{background:#b37832;}',
    '.sg-share-toast{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#1A1A1A;color:#fff;padding:10px 20px;border-radius:6px;font-size:0.9rem;z-index:10001;box-shadow:0 4px 12px rgba(0,0,0,0.2);animation:sgShareIn 0.3s ease,sgShareOut 0.3s ease 2.7s forwards;}',
    '@keyframes sgShareIn{from{opacity:0;transform:translateX(-50%) translateY(10px);}to{opacity:1;transform:translateX(-50%) translateY(0);}}',
    '@keyframes sgShareOut{from{opacity:1;}to{opacity:0;}}'
  ].join('\n');
  document.head.appendChild(style);

  // Create FAB
  var fab = document.createElement('button');
  fab.className = 'sg-share-fab';
  fab.title = 'Share';
  fab.innerHTML = '<svg viewBox="0 0 24 24"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>';
  fab.onclick = handleShare;
  document.body.appendChild(fab);

  function handleShare() {
    var url = getShareUrl();

    // Try native share API first (mobile)
    if (navigator.share) {
      navigator.share({
        title: SHARE_TITLE,
        text: SHARE_TEXT,
        url: url
      }).catch(function() {
        // User cancelled — do nothing
      });
      return;
    }

    // Fallback: show copy-link dialog
    showShareDialog(url);
  }

  function showShareDialog(url) {
    // Remove existing overlay if any
    var existing = document.getElementById('sgShareOverlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.className = 'sg-share-overlay open';
    overlay.id = 'sgShareOverlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };

    overlay.innerHTML =
      '<div class="sg-share-dialog">' +
        '<div class="sg-share-header">' +
          '<h3>Share Shir Glassworks</h3>' +
          '<button class="sg-share-close" id="sgShareClose">&times;</button>' +
        '</div>' +
        '<div class="sg-share-body">' +
          '<p>' + SHARE_TEXT + '</p>' +
          '<div class="sg-share-url-row">' +
            '<input class="sg-share-url" id="sgShareUrl" type="text" value="' + url + '" readonly />' +
            '<button class="sg-share-copy" id="sgShareCopy">Copy</button>' +
          '</div>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('sgShareClose').onclick = function() { overlay.remove(); };
    document.getElementById('sgShareCopy').onclick = function() {
      var input = document.getElementById('sgShareUrl');
      input.select();
      if (navigator.clipboard) {
        navigator.clipboard.writeText(url).then(function() {
          showShareToast('Link copied!');
          overlay.remove();
        });
      } else {
        document.execCommand('copy');
        showShareToast('Link copied!');
        overlay.remove();
      }
    };
  }

  function showShareToast(msg) {
    var toast = document.createElement('div');
    toast.className = 'sg-share-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(function() {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3000);
  }
})();
