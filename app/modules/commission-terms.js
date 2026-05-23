/**
 * Commission Terms Admin Module — W2.3
 * Lazy-loaded via MastAdmin module registry.
 *
 * Manages the versioned commission terms documents that customers accept
 * via the storefront flow (token minted by the mintCommissionTermsToken CF).
 *
 * Firebase path: tenants/{tid}/admin/commissionTerms/{versionId}
 *
 * Each version document carries:
 *   {
 *     version: number,          // monotonic, 1-indexed
 *     status: 'draft' | 'published',
 *     content: string,          // plain-text body (canonical for V1)
 *     content_html: string|null,// optional rich version (rendered if present)
 *     publishedAt: ISO|null,
 *     createdBy: uid|email,
 *     createdAt: ISO,
 *     updatedAt: ISO
 *   }
 *
 * Publish rule: cannot publish a draft whose version number collides with
 * another version (draft OR published) — version numbers are unique.
 */
(function() {
  'use strict';

  var versionsData = {}; // id -> version row
  var versionsLoaded = false;
  var selectedVersionId = null;
  var saveStatus = '';

  function esc(s) {
    if (s == null) return '';
    var div = document.createElement('div');
    div.textContent = String(s);
    return div.innerHTML;
  }
  // Reach for the shared JS-in-attr helper (added by W2 helpers commit).
  function jsAttr(s) {
    if (typeof window._jsAttr === 'function') return window._jsAttr(s);
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/</g, '\\u003C');
  }

  function tabEl() { return document.getElementById('commissionTermsTab'); }

  async function loadVersions() {
    try {
      var snap = await MastDB.get('admin/commissionTerms');
      versionsData = snap || {};
    } catch (err) {
      console.warn('[commission-terms] load failed:', err && err.message);
      versionsData = {};
    }
    versionsLoaded = true;
    render();
  }

  function _sortedVersions() {
    var rows = Object.keys(versionsData).map(function(k) {
      var v = versionsData[k] || {};
      v.id = k;
      return v;
    });
    rows.sort(function(a, b) { return (b.version || 0) - (a.version || 0); });
    return rows;
  }

  function _latestPublished(rows) {
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].status === 'published') return rows[i];
    }
    return null;
  }

  function _nextVersionNumber(rows) {
    var max = 0;
    rows.forEach(function(r) { if ((r.version || 0) > max) max = r.version || 0; });
    return max + 1;
  }

  function render() {
    var el = tabEl();
    if (!el) return;

    if (!versionsLoaded) {
      el.innerHTML = '<div class="section-header"><h2>Commission Terms</h2></div>' +
        '<div style="padding:24px;color:var(--warm-gray);">Loading…</div>';
      return;
    }

    var rows = _sortedVersions();
    var latest = _latestPublished(rows);

    var banner = '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
    if (latest) {
      banner += '<div style="font-size:0.85rem;color:var(--warm-gray);">Currently published</div>' +
        '<div style="font-size:1rem;font-weight:600;">v' + esc(latest.version) +
        (latest.publishedAt ? ' — published ' + esc(new Date(latest.publishedAt).toLocaleDateString()) : '') + '</div>';
    } else {
      banner += '<div style="font-size:0.9rem;color:#a67c00;">No published terms yet — create + publish a draft below.</div>';
    }
    banner += '</div>';

    // Versions list (table).
    var rowsHtml = '';
    if (!rows.length) {
      rowsHtml = '<tr><td colspan="5" style="padding:16px;text-align:center;color:var(--warm-gray);font-size:0.9rem;">No versions yet.</td></tr>';
    } else {
      rows.forEach(function(r) {
        var statusChip = r.status === 'published'
          ? '<span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:600;">PUBLISHED</span>'
          : '<span style="background:#fff3e0;color:#a67c00;padding:2px 8px;border-radius:10px;font-size:0.72rem;font-weight:600;">DRAFT</span>';
        var pubCell = r.publishedAt ? esc(new Date(r.publishedAt).toLocaleDateString()) : '—';
        var actions = '<button class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" ' +
            'onclick="ctSelect(\'' + jsAttr(r.id) + '\')">Edit</button>';
        if (r.status === 'draft') {
          actions += ' <button class="btn btn-primary" style="font-size:0.78rem;padding:4px 10px;margin-left:4px;" ' +
            'onclick="ctPublish(\'' + jsAttr(r.id) + '\')">Publish</button>';
        }
        rowsHtml += '<tr ' + (selectedVersionId === r.id ? 'style="background:rgba(0,128,128,0.08);"' : '') + '>' +
          '<td style="font-size:0.9rem;font-weight:600;">v' + esc(r.version) + '</td>' +
          '<td>' + statusChip + '</td>' +
          '<td style="font-size:0.85rem;">' + pubCell + '</td>' +
          '<td style="font-size:0.85rem;color:var(--warm-gray);">' + esc(r.createdBy || '—') + '</td>' +
          '<td>' + actions + '</td>' +
        '</tr>';
      });
    }

    // Editor pane for selected version (or empty state).
    var editorHtml = '';
    if (selectedVersionId && versionsData[selectedVersionId]) {
      var sel = versionsData[selectedVersionId];
      var readonly = sel.status === 'published';
      editorHtml =
        '<div style="background:var(--cream,#f5f0e8);border-radius:8px;padding:20px;margin-top:16px;">' +
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;">' +
            '<h3 style="margin:0;font-size:1rem;">Editing v' + esc(sel.version) + (readonly ? ' (published — read-only)' : ' (draft)') + '</h3>' +
            '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="ctClose()">Close</button>' +
          '</div>' +
          '<div class="form-group">' +
            '<label>Terms content</label>' +
            '<textarea id="ctContentEditor" rows="20" ' + (readonly ? 'readonly ' : '') +
              'style="width:100%;padding:10px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.9rem;font-family:ui-monospace,monospace;resize:vertical;box-sizing:border-box;">' +
              esc(sel.content || '') +
            '</textarea>' +
          '</div>' +
          (readonly ? '' :
            '<div style="display:flex;gap:8px;margin-top:12px;">' +
              '<button class="btn btn-primary" style="font-size:0.85rem;" onclick="ctSave(\'' + jsAttr(sel.id) + '\')">Save Draft</button>' +
              '<button class="btn btn-secondary" style="font-size:0.85rem;" onclick="ctPublish(\'' + jsAttr(sel.id) + '\')">Save &amp; Publish</button>' +
            '</div>'
          ) +
          '<div id="ctSaveStatus" style="margin-top:8px;font-size:0.85rem;">' + esc(saveStatus) + '</div>' +
        '</div>';
    }

    el.innerHTML =
      '<div class="section-header"><h2>Commission Terms</h2>' +
        '<button class="btn btn-primary" style="font-size:0.85rem;" onclick="ctNewDraft()">+ New Draft</button>' +
      '</div>' +
      banner +
      '<div style="background:var(--surface-card,#fff);border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.05);">' +
        '<table class="data-table" style="width:100%;">' +
          '<thead><tr>' +
            '<th>Version</th><th>Status</th><th>Published</th><th>Created By</th><th>Actions</th>' +
          '</tr></thead>' +
          '<tbody>' + rowsHtml + '</tbody>' +
        '</table>' +
      '</div>' +
      editorHtml;
  }

  // ─── Actions ───

  async function newDraft() {
    saveStatus = '';
    var rows = _sortedVersions();
    var nextV = _nextVersionNumber(rows);
    var id = 'ctv_' + Date.now().toString(36);
    var user = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
    var now = new Date().toISOString();
    var draft = {
      version: nextV,
      status: 'draft',
      content: '',
      content_html: null,
      publishedAt: null,
      createdBy: (user && (user.email || user.uid)) || null,
      createdAt: now,
      updatedAt: now
    };
    try {
      await MastDB.set('admin/commissionTerms/' + id, draft);
      versionsData[id] = draft;
      selectedVersionId = id;
      if (typeof writeAudit === 'function') writeAudit('create', 'commissionTermsVersion', id);
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Failed to create draft: ' + err.message, true);
    }
  }
  window.ctNewDraft = newDraft;

  function selectVersion(id) {
    selectedVersionId = id;
    saveStatus = '';
    render();
  }
  window.ctSelect = selectVersion;

  function closeEditor() {
    selectedVersionId = null;
    saveStatus = '';
    render();
  }
  window.ctClose = closeEditor;

  async function saveDraft(id) {
    var v = versionsData[id];
    if (!v) return;
    if (v.status === 'published') return; // Defensive — UI hides save buttons.
    var editor = document.getElementById('ctContentEditor');
    if (!editor) return;
    var content = editor.value;
    var now = new Date().toISOString();
    try {
      await MastDB.update('admin/commissionTerms/' + id, { content: content, updatedAt: now });
      v.content = content;
      v.updatedAt = now;
      saveStatus = 'Saved at ' + new Date().toLocaleTimeString();
      var statusEl = document.getElementById('ctSaveStatus');
      if (statusEl) { statusEl.textContent = saveStatus; statusEl.style.color = 'var(--teal)'; }
      if (typeof writeAudit === 'function') writeAudit('update', 'commissionTermsVersion', id);
    } catch (err) {
      saveStatus = 'Save failed: ' + err.message;
      var statusEl2 = document.getElementById('ctSaveStatus');
      if (statusEl2) { statusEl2.textContent = saveStatus; statusEl2.style.color = '#ef5350'; }
    }
  }
  window.ctSave = saveDraft;

  async function publishVersion(id) {
    var v = versionsData[id];
    if (!v) return;
    if (v.status === 'published') {
      if (typeof showToast === 'function') showToast('Already published.', true);
      return;
    }
    // Persist any pending edits first if the editor is open.
    if (selectedVersionId === id) {
      var editor = document.getElementById('ctContentEditor');
      if (editor) v.content = editor.value;
    }
    // Uniqueness check: refuse to publish if another version has the same
    // version#. Shouldn't happen with monotonic newDraft() but guards against
    // concurrent edits.
    var sameVer = Object.keys(versionsData).filter(function(k) {
      return k !== id && (versionsData[k].version || 0) === (v.version || 0);
    });
    if (sameVer.length) {
      if (typeof showToast === 'function') showToast('Another version already uses v' + v.version + ' — bump version number first.', true);
      return;
    }
    if (typeof mastConfirm === 'function') {
      var ok = await mastConfirm('Publish v' + v.version + '? Customers sent terms-acceptance links after this point will see this version.', { title: 'Publish Commission Terms' });
      if (!ok) return;
    }
    var now = new Date().toISOString();
    try {
      await MastDB.update('admin/commissionTerms/' + id, {
        content: v.content || '',
        status: 'published',
        publishedAt: now,
        updatedAt: now
      });
      v.status = 'published';
      v.publishedAt = now;
      v.updatedAt = now;
      if (typeof writeAudit === 'function') writeAudit('publish', 'commissionTermsVersion', id);
      if (typeof showToast === 'function') showToast('v' + v.version + ' published.');
      render();
    } catch (err) {
      if (typeof showToast === 'function') showToast('Publish failed: ' + err.message, true);
    }
  }
  window.ctPublish = publishVersion;

  // ─── Module Registration ───

  MastAdmin.registerModule('commissionTerms', {
    routes: {
      'commission-terms': {
        tab: 'commissionTermsTab',
        setup: function() {
          // Reset transient state on route entry.
          if (!versionsLoaded) {
            loadVersions();
          } else {
            render();
          }
        }
      }
    },
    detachListeners: function() {
      // No live listeners; clear in-memory state on unmount.
      versionsData = {};
      versionsLoaded = false;
      selectedVersionId = null;
      saveStatus = '';
      var el = tabEl();
      if (el) { el.innerHTML = ''; el.style.display = 'none'; }
    }
  });

})();
