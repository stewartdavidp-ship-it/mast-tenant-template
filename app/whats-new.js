// ============================================================
// What's New — release feed viewer
// ============================================================
// Reads the curated window.MAST_WHATS_NEW feed (app/data/whats-new.js) and
// shows the 5 most recent releases in the shared modal. The list rolls up to
// a title + date + weekly/push-now badge; selecting one expands its full list
// of capabilities in place. Reachable from the Avatar menu and the About
// screen. No backend — the feed ships with each deploy.
//
// Kept OUT of app/index.html on purpose: the admin shell may not accrete inline
// JavaScript (scripts/lint-shell-size.js). Entry points: openWhatsNew() from the
// Avatar menu, and whatsNewAboutCard() rendered into the About screen. Depends on
// the shell globals esc()/openModal()/closeModal()/closeAvatarMenu(), all defined
// before any click can fire.
(function () {
  var WHATS_NEW_MAX = 5;

  function entries() {
    var feed = window.MAST_WHATS_NEW;
    if (!Array.isArray(feed)) return [];
    return feed.slice(0, WHATS_NEW_MAX);
  }

  function badge(release) {
    var isPush = release === 'push-now';
    var label = isPush ? 'Push-now' : 'Weekly';
    var bg = isPush ? 'rgba(196,133,60,0.18)' : 'rgba(42,124,111,0.12)';
    var fg = isPush ? 'var(--gold)' : 'var(--teal)';
    return '<span style="flex:none;font-size:0.72rem;font-weight:700;text-transform:uppercase;letter-spacing:0.04em;'
      + 'padding:2px 8px;border-radius:999px;background:' + bg + ';color:' + fg + ';">' + label + '</span>';
  }

  function fmtDate(iso) {
    // iso is 'YYYY-MM-DD' — render via MastFormat if present, else a safe fallback.
    try {
      if (window.MastFormat && typeof window.MastFormat.date === 'function') return window.MastFormat.date(iso);
    } catch (e) {}
    if (!iso) return '';
    var parts = String(iso).split('-');
    if (parts.length !== 3) return esc(iso);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    var mi = parseInt(parts[1], 10) - 1;
    var m = (mi >= 0 && mi < 12) ? months[mi] : parts[1];
    return m + ' ' + parseInt(parts[2], 10) + ', ' + parts[0];
  }

  // selectedIdx === null → the rolled-up list. Otherwise the expanded entry.
  function viewHtml(selectedIdx) {
    var list = entries();
    var h = '';
    h += '<div class="modal-header"><h3>What’s New</h3>'
      + '<button class="modal-close" onclick="closeModal()" aria-label="Close">&times;</button></div>';
    h += '<div class="modal-body" style="max-height:72vh;overflow-y:auto;">';

    if (!list.length) {
      h += '<p style="color:var(--warm-gray);font-size:0.9rem;">No release notes yet — check back soon.</p>';
      h += '</div>';
      return h;
    }

    if (selectedIdx == null) {
      h += '<p style="margin:0 0 14px;color:var(--warm-gray);font-size:0.85rem;">The last ' + list.length
        + ' updates to Mast. Select one to see what was added.</p>';
      for (var i = 0; i < list.length; i++) {
        var e = list[i];
        h += '<button type="button" onclick="whatsNewSelect(' + i + ')" '
          + 'style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;margin-bottom:10px;'
          + 'background:var(--cream);border:1px solid var(--cream-dark);border-radius:12px;padding:14px 16px;cursor:pointer;font-family:inherit;">'
          + '<span style="flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;">'
          +   '<span style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">'
          +     badge(e.release)
          +     '<span style="color:var(--warm-gray);font-size:0.78rem;">' + esc(fmtDate(e.date)) + '</span>'
          +   '</span>'
          +   '<span style="font-weight:600;color:var(--text-primary);font-size:0.9rem;">' + esc(e.title || '') + '</span>'
          +   (e.summary ? '<span style="color:var(--warm-gray);font-size:0.85rem;">' + esc(e.summary) + '</span>' : '')
          + '</span>'
          + '<span aria-hidden="true" style="flex:none;color:var(--warm-gray);font-size:1.15rem;">&rarr;</span>'
          + '</button>';
      }
    } else {
      var sel = list[selectedIdx];
      if (!sel) { return viewHtml(null); }
      h += '<button type="button" onclick="whatsNewSelect(null)" '
        + 'style="display:inline-flex;align-items:center;gap:6px;background:none;border:none;cursor:pointer;'
        + 'color:var(--teal);font-family:inherit;font-size:0.85rem;font-weight:600;padding:0;margin-bottom:14px;">'
        + '<span aria-hidden="true">&larr;</span> All updates</button>';
      h += '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px;">'
        + badge(sel.release)
        + '<span style="color:var(--warm-gray);font-size:0.78rem;">' + esc(fmtDate(sel.date)) + '</span></div>';
      h += '<h4 style="margin:0 0 4px;font-size:1.15rem;color:var(--text-primary);">' + esc(sel.title || '') + '</h4>';
      if (sel.summary) h += '<p style="margin:0 0 14px;color:var(--warm-gray);font-size:0.9rem;">' + esc(sel.summary) + '</p>';
      var caps = Array.isArray(sel.capabilities) ? sel.capabilities : [];
      h += '<ul style="margin:0;padding-left:0;list-style:none;display:flex;flex-direction:column;gap:10px;">';
      for (var c = 0; c < caps.length; c++) {
        h += '<li style="display:flex;gap:10px;align-items:flex-start;font-size:0.9rem;color:var(--text-primary);line-height:1.4;">'
          + '<span aria-hidden="true" style="flex:none;color:var(--teal);font-weight:700;margin-top:1px;">&#10003;</span>'
          + '<span>' + esc(caps[c]) + '</span></li>';
      }
      h += '</ul>';
    }

    h += '</div>';
    return h;
  }

  function openWhatsNew() {
    if (typeof closeAvatarMenu === 'function') closeAvatarMenu();
    openModal(viewHtml(null));
  }

  function whatsNewSelect(idx) {
    openModal(viewHtml(idx));
  }

  // Card rendered into the About screen (renderAboutSettings) — returns HTML.
  function whatsNewAboutCard() {
    return '<button type="button" onclick="openWhatsNew()" style="margin-top:16px;display:flex;align-items:center;gap:8px;width:100%;justify-content:space-between;background:var(--cream);border:1px solid var(--cream-dark);border-radius:12px;padding:14px 18px;cursor:pointer;font-family:inherit;font-size:0.9rem;color:var(--text-primary);text-align:left;">'
      + '<span style="display:flex;flex-direction:column;gap:2px;"><span style="font-weight:600;">What’s New</span><span style="color:var(--warm-gray);font-size:0.78rem;">Recent updates &amp; new capabilities</span></span>'
      + '<span aria-hidden="true" style="color:var(--warm-gray);font-size:1.15rem;">&rarr;</span>'
      + '</button>';
  }

  window.openWhatsNew = openWhatsNew;
  window.whatsNewSelect = whatsNewSelect;
  window.whatsNewAboutCard = whatsNewAboutCard;
})();
