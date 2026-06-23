/**
 * commission-terms-v2.js — Commission Terms, V2 (record archetype,
 * standard-record-ui §10).
 *
 * Versioned terms documents customers accept via the storefront commission
 * flow (admin/commissionTerms/{versionId}; see commission-terms.js for the
 * doc contract). V2 model:
 *   • the PAGE is the read view — published banner + version list;
 *   • row click opens the version in the slide-out: drafts open in EDIT
 *     (the page already is the read view), published versions open READ
 *     (published terms are immutable — customers accepted that exact text);
 *   • Publish is a row action with the same uniqueness guard + confirm as V1.
 *
 * Flag-gated (`uiRedesign`), side-by-side route `#commission-terms-v2`.
 */
(function () {
  'use strict';
  function flagOn() {
    try {
      if (/[?&#]ui=1\b/.test(location.href)) { localStorage.setItem('mastUiRedesign', '1'); return true; }
      if (localStorage.getItem('mastUiRedesign') === '1') return true;
    } catch (e) {}
    return !!(window.MAST_FEATURE_FLAGS && window.MAST_FEATURE_FLAGS.uiRedesign);
  }
  if (!window.MastAdmin || !window.MastEntity || !window.MastUI) return;
  if (!flagOn()) return;

  var U = window.MastUI, esc = U._esc;
  var PATH = 'admin/commissionTerms';

  var V2 = { rows: [], byId: {}, loaded: false, sortKey: 'version', sortDir: 'desc' };

  function canEdit() {
    return typeof window.can !== 'function' || window.can('commission-terms', 'edit');
  }

  MastEntity.define('commission-terms-v2', {
    label: 'Terms version', labelPlural: 'Commission Terms', size: 'lg', route: 'commission-terms-v2',
    recordId: function (r) { return r._key || r.id; },
    fields: [
      { name: 'version', label: 'Version', type: 'number', list: true, readOnly: true,
        get: function (r) { return r.version || 0; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        get: function (r) { return r.status === 'published' ? 'Published' : 'Draft'; },
        tone: function (v) { return String(v).toLowerCase() === 'published' ? 'success' : 'amber'; } },
      { name: 'publishedAt', label: 'Published', type: 'date', list: true, readOnly: true },
      { name: 'createdBy', label: 'Created by', type: 'text', list: true, readOnly: true },
      { name: 'updatedAt', label: 'Updated', type: 'date', list: true, readOnly: true }
    ],
    fetch: function (id) {
      return Promise.resolve(MastDB.get(PATH + '/' + id)).then(function (r) {
        return r ? Object.assign({ _key: id }, r) : null;
      });
    },
    detail: {
      render: function (UI, r) {
        var head = UI.kv([
          { k: 'Status', v: UI.badge(r.status === 'published' ? 'Published' : 'Draft', r.status === 'published' ? 'success' : 'amber') },
          { k: 'Published', v: r.publishedAt ? UI.Num.date(r.publishedAt) : '—' },
          { k: 'Created by', v: esc(r.createdBy || '—') }
        ]);
        var body = (r.content && String(r.content).trim())
          ? '<div style="font-size:0.9rem;white-space:pre-wrap;color:var(--text-primary);line-height:1.55;">' + esc(r.content) + '</div>'
          : '<span class="mu-sub">No content yet.</span>';
        var note = (r.status === 'published')
          ? '<div class="mu-sub" style="margin-top:10px;">Published versions are immutable — customers accepted this exact text. Create a new draft to change the terms.</div>'
          : '';
        return UI.card('Version v' + esc(r.version || '?'), head) + UI.card('Terms content', body) + note;
      },
      editRender: function (r) {
        r = r || {};
        if (r.status === 'published') {
          return '<div class="mu-editbar"><span class="mu-editpill">READ-ONLY</span>Published version</div>' +
            '<div class="mu-sub">v' + esc(r.version) + ' is published and immutable. Create a new draft from the list page instead.</div>';
        }
        return '<div class="mu-editbar"><span class="mu-editpill">EDITING</span>Draft v' + esc(r.version) + '</div>' +
          '<div class="form-group"><label class="form-label">Terms content</label>' +
          '<textarea class="form-input" id="ctv2Content" rows="20" placeholder="The terms customers accept when commissioning work…" ' +
          'style="width:100%;resize:vertical;font-family:ui-monospace,monospace;">' + esc(r.content || '') + '</textarea></div>' +
          '<div class="mu-sub">Saving keeps this a draft. Publish from the version list when it\'s ready.</div>';
      }
    },
    onSave: function (rec) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to edit commission terms.', true); return false; }
      var id = rec._key || rec.id;
      var row = id && V2.byId[id];
      if (!id || !row) return false;
      if (row.status === 'published') {
        if (window.showToast) showToast('Published versions are immutable.', true);
        return false;
      }
      var ed = document.getElementById('ctv2Content');
      if (!ed) return false;
      var now = new Date().toISOString();
      return Promise.resolve(MastDB.update(PATH + '/' + id, { content: ed.value, updatedAt: now }))
        .then(function () {
          row.content = ed.value; row.updatedAt = now;
          if (window.writeAudit) writeAudit('update', 'commissionTermsVersion', id);
          render();
          return true;
        })
        .catch(function (e) { console.error('[commission-terms-v2] save', e); if (window.showToast) showToast('Save failed', true); return false; });
    }
  });

  function toRows(tree) {
    return Object.keys(tree || {}).map(function (k) {
      return Object.assign({ _key: k }, tree[k] || {});
    });
  }

  function load() {
    Promise.resolve(MastDB.get(PATH)).then(function (tree) {
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[commission-terms-v2] load', e); V2.loaded = true; render(); });
  }

  function latestPublished() {
    var pub = V2.rows.filter(function (r) { return r.status === 'published'; });
    pub.sort(function (a, b) { return (b.version || 0) - (a.version || 0); });
    return pub[0] || null;
  }

  function visibleRows() {
    return window.mastSortRows(V2.rows.slice(), V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('commission-terms-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function columns() {
    var s = MastEntity.get('commission-terms-v2');
    // Engine-derived columns + a publish action for drafts.
    var cols = s.fields.filter(function (f) { return f.list; }).map(function (f) {
      return { key: f.name, label: f.label,
        render: function (r) {
          var v = f.get ? f.get(r) : r[f.name];
          if (f.type === 'status') return U.badge(v, f.tone ? f.tone(v) : 'neutral');
          if (f.type === 'date') return v ? U.Num.date(v) : '—';
          if (f.name === 'version') return 'v' + esc(v);
          return esc(v == null ? '—' : v);
        } };
    });
    cols.push({ key: '_publish', label: '', sortable: false, align: 'right', render: function (r) {
      if (r.status === 'published') return '';
      return '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 10px;" ' +
        'onclick="event.stopPropagation();CommissionTermsV2.publish(\'' + r._key + '\')">Publish</button>' +
        ' <a href="#" onclick="event.preventDefault();event.stopPropagation();CommissionTermsV2.remove(\'' + r._key + '\')" ' +
        'style="color:var(--warm-gray);font-size:0.78rem;text-decoration:underline;margin-left:6px;">delete</a>';
    } });
    return cols;
  }

  function ensureTab() {
    var el = document.getElementById('commissionTermsV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'commissionTermsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Commission Terms', subtitle: 'Versioned terms for custom-order work' }) +
        '<div class="loading" style="margin-top:14px;">Loading…</div>';
      return;
    }
    var latest = latestPublished();
    var banner = latest
      ? U.card('Currently published', '<div style="font-size:1rem;font-weight:600;color:var(--text-primary);">v' + esc(latest.version) +
          (latest.publishedAt ? ' <span class="mu-sub" style="font-weight:400;">— published ' + U.Num.date(latest.publishedAt) + '</span>' : '') + '</div>' +
          '<div class="mu-sub" style="margin-top:6px;">Customers accepting commission terms see this version.</div>', { fill: true })
      : U.card('Currently published', '<div style="font-size:0.9rem;color:var(--warning,var(--amber));">No published terms yet — create and publish a draft.</div>', { fill: true });

    tab.innerHTML =
      U.pageHeader({ title: 'Commission Terms', count: U.Num.count(V2.rows.length) + ' versions',
        actionsHtml: (canEdit() ? '<button class="btn btn-primary" onclick="CommissionTermsV2.newDraft()">+ New draft</button>' : '') }) +
      '<div style="margin:12px 0;">' + banner + '</div>' +
      window.MastEntity.renderList('commission-terms-v2', {
        columns: columns(),
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CommissionTermsV2.sort', onRowClickFnName: 'CommissionTermsV2.open',
        empty: { title: 'No versions yet', message: 'Create a draft to write your commission terms.' }
      });
  }

  window.CommissionTermsV2 = {
    sort: function (key) {
      if (key === '_publish') return;
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = 'desc'; }
      render();
    },
    // Drafts open straight in EDIT (the page is the read view); published open READ.
    open: function (id) {
      var rec = V2.byId[id]; if (!rec) return;
      window.MastEntity.openRecord('commission-terms-v2', rec, (rec.status === 'draft' && canEdit()) ? 'edit' : 'read');
    },
    newDraft: function () {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to edit commission terms.', true); return; }
      var max = 0;
      V2.rows.forEach(function (r) { if ((r.version || 0) > max) max = r.version || 0; });
      var id = MastUtil.genId('ctv_');
      var user = (typeof firebase !== 'undefined' && firebase.auth) ? firebase.auth().currentUser : null;
      var now = new Date().toISOString();
      var draft = { version: max + 1, status: 'draft', content: '', content_html: null,
        publishedAt: null, createdBy: (user && (user.email || user.uid)) || null, createdAt: now, updatedAt: now };
      Promise.resolve(MastDB.set(PATH + '/' + id, draft)).then(function () {
        var row = Object.assign({ _key: id }, draft);
        V2.rows.push(row); V2.byId[id] = row;
        if (window.writeAudit) writeAudit('create', 'commissionTermsVersion', id);
        render();
        window.MastEntity.openRecord('commission-terms-v2', row, 'edit');
      }).catch(function (e) { console.error('[commission-terms-v2] newDraft', e); if (window.showToast) showToast('Failed to create draft: ' + (e && e.message || e), true); });
    },
    publish: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to publish commission terms.', true); return; }
      var v = V2.byId[id]; if (!v) return;
      if (v.status === 'published') { if (window.showToast) showToast('Already published.', true); return; }
      // Same uniqueness guard as V1 — version numbers are unique across drafts + published.
      var clash = V2.rows.some(function (r) { return r._key !== id && (r.version || 0) === (v.version || 0); });
      if (clash) { if (window.showToast) showToast('Another version already uses v' + v.version + ' — bump the version first.', true); return; }
      var msg = 'Publish v' + v.version + '? Customers sent terms-acceptance links after this point will see this version.';
      Promise.resolve(typeof mastConfirm === 'function' ? mastConfirm(msg, { title: 'Publish Commission Terms' }) : true).then(function (ok) {
        if (!ok) return;
        var now = new Date().toISOString();
        return Promise.resolve(MastDB.update(PATH + '/' + id, {
          content: v.content || '', status: 'published', publishedAt: now, updatedAt: now
        })).then(function () {
          v.status = 'published'; v.publishedAt = now; v.updatedAt = now;
          if (window.writeAudit) writeAudit('publish', 'commissionTermsVersion', id);
          if (window.showToast) showToast('v' + v.version + ' published.');
          render();
        });
      }).catch(function (e) { console.error('[commission-terms-v2] publish', e); if (window.showToast) showToast('Publish failed: ' + (e && e.message || e), true); });
    },
    // Drafts are deletable; published versions are immutable history (customers
    // accepted that exact text) and can never be removed.
    remove: function (id) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to edit commission terms.', true); return; }
      var v = V2.byId[id]; if (!v) return;
      if (v.status === 'published') { if (window.showToast) showToast('Published versions are permanent.', true); return; }
      Promise.resolve(typeof mastConfirm === 'function' ? mastConfirm('Delete draft v' + v.version + '? This cannot be undone.', { title: 'Delete draft', danger: true, confirmLabel: 'Delete' }) : true).then(function (ok) {
        if (!ok) return;
        Promise.resolve(MastDB.remove(PATH + '/' + id)).then(function () {
          if (window.writeAudit) writeAudit('delete', 'commissionTermsVersion', id);
          if (window.showToast) showToast('Draft deleted.');
          V2.rows = V2.rows.filter(function (r) { return r._key !== id; });
          delete V2.byId[id];
          render();
        }).catch(function (e) {
          console.error('[commission-terms-v2] delete', e);
          if (window.showToast) showToast('Delete failed: ' + (e && e.message || e), true);
        });
      });
    },
    refresh: render
  };

  var _ctV2Route = { tab: 'commissionTermsV2Tab', setup: function () { ensureTab(); render(); load(); } };
  // The legacy 'commission-terms' route resolves here too: commission-terms.js
  // (V1) was retired (T6, Legacy-UI sunset); this is now the only Commission Terms
  // admin UI for ALL users, regardless of the redesign flag.
  MastAdmin.registerModule('commission-terms-v2', {
    routes: { 'commission-terms-v2': _ctV2Route, 'commission-terms': _ctV2Route }
  });
})();
