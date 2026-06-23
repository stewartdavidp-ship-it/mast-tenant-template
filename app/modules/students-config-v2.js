/**
 * students-config-v2.js — the tenant-level Student SETTINGS surfaces, ported off
 * legacy #students (students.js) as native v2 editors. Doc 17 conversion; finishes
 * retiring the bespoke legacy #students view-tabs.
 *
 * students.js hosts a multi-view admin. Its roster + per-student detail/sub-editors
 * are already native on the Faceted-Record twin (students-v2.js, #students-v2). What
 * remained legacy-only were THREE tenant-level CONFIG surfaces (the legacy
 * "view-tabs" Clearance Types / Documents / Waivers) — config/roster data, not
 * per-student records, so they do not belong as students-v2 record facets. This
 * module re-homes them in one flag-gated hub:
 *
 *   #students-config-v2  →  "Student settings" hub with three sub-tabs:
 *     • Waivers           settings/waiverTemplates (+ mirrored public/waivers/{id})
 *                         rich-text template editor + per-template public Copy-link
 *                         + a read-side Signatures viewer (admin/waiverSignatures).
 *     • Clearance Types   settings/clearanceTypes (label / description / requiresExpiry).
 *     • Business Documents admin/documents (tenant-wide docs shared with employees;
 *                         same doc shape + Google-Drive linking as per-student docs).
 *
 * Each surface is a MastEntity (schema-driven list + slide-out read/edit/create),
 * mirroring the coupons-v2 / galleries-v2 precedent. Writes are NATIVE here (direct
 * MastDB, like coupons-v2 — NOT delegated to a legacy bridge) and RBAC-gated via
 * can('students','edit'|'delete'); the legacy #students writes stay intact so the
 * two surfaces (flag-gated, side-by-side) keep the same Firestore shapes.
 *
 * OUT OF SCOPE (gated, lives in mast-architecture/public): the waiver SIGNING
 * pipeline — generateWaiverLink CF + waiver.html. Only the admin-side template CRUD
 * + the signatures viewer are here. The per-student SIGNED waiver link
 * (generateWaiverLink) is already native on students-v2 (copyWaiverLink); the
 * per-template PUBLIC link below is just a waiver.html?t=<id> URL (no CF).
 *
 * SECURITY NOTE — `waiverTextSnapshot` provenance (audited 2026-06-14): the
 * Signatures viewer renders each signature's `waiverTextSnapshot` as HTML. That
 * field is NOT signer-controlled: the out-of-repo submitWaiverSignature CF
 * (mast-architecture tenant-functions.js) sets it to `template.bodyHtml`, where
 * `template` is read SERVER-SIDE from settings/waiverTemplates/<id>. The signer
 * supplies only a templateId (lookup key) + free-text fields the CF clip()s of
 * angle brackets — none reach the snapshot. It is therefore admin-authored
 * template HTML, parity-safe vs. signer-stored-XSS. It is still sanitized at
 * render (see sanitizeWaiverHtml) as defense-in-depth against an intra-tenant
 * RBAC staff→owner payload, matching the public waiver.html signing page.
 *
 * Reached from the students-v2 roster header ("⚙ Settings"). Flag-gated (?ui=1),
 * side-by-side with legacy #students.
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

  // Waiver bodies (settings/waiverTemplates[].bodyHtml) are admin-authored rich
  // text — INTENTIONALLY HTML (the editor below is a contenteditable rich-text
  // surface), so they're rendered as markup, not esc()'d (escaping would show raw
  // tags and break the agreement formatting). The same bodyHtml is snapshotted
  // verbatim into each signature as `waiverTextSnapshot` by the out-of-repo
  // submitWaiverSignature CF (server-side copy of template.bodyHtml — NO signer
  // input reaches it; see the Signatures-viewer note below). It is therefore NOT
  // attacker/signer-controlled. But "admin-authored" spans RBAC roles: a staff
  // member with can('students','edit') could plant script that runs in an owner's
  // session when they open the template preview or the signatures viewer. So we
  // sanitize at render — matching what the PUBLIC waiver.html signing page already
  // does to this exact content — keeping formatting tags while stripping
  // scripts/handlers.
  //
  // Sanitizer (canonical): MastUI.sanitizeHtml — the platform's allow-list HTML
  // sanitizer (shared engine, PR 509), already the standard for admin-rendered rich
  // HTML (NewsletterBridge composer, PR 512). MastUI is a core module loaded
  // app-wide and is already a HARD dependency of this route (module bails at top if
  // absent), so it is reachable here at render time. window.DOMPurify is kept only as
  // a secondary path if some surface still loads it. If NEITHER is available we FAIL
  // CLOSED — escape the HTML so it renders as inert text, never raw. (The previous
  // raw `: html` fallback was the regression that re-opened this hole when the
  // DOMPurify CDN tag was dropped from index.html; raw render must never happen.)
  //
  // NOTE: MastUI.sanitizeHtml owns its own allow-list internally and takes no config
  // arg. WAIVER_SANITIZE_CFG is retained for the DOMPurify secondary path, which
  // mirrors the public waiver.html signing page's ALLOWED_TAGS/ATTR.
  var WAIVER_SANITIZE_CFG = {
    ALLOWED_TAGS: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'a', 'br', 'hr', 'div', 'span', 'table', 'tr', 'td', 'th', 'blockquote', 'sub', 'sup'],
    ALLOWED_ATTR: ['href', 'target', 'style']
  };
  function sanitizeWaiverHtml(html) {
    if (!html) return '';
    // Prefer the standalone MastSanitize core (Track 7): identical allow-list +
    // URL/on*/scheme stripping to MastUI.sanitizeHtml, plus a safe-src <img> arm
    // (admin-authored waiver text may embed a logo; safe-src-guarded → no XSS
    // delta). MastUI is the fallback; DOMPurify/escape stay below as last resorts.
    if (window.MastSanitize && typeof window.MastSanitize.sanitizeHtml === 'function') {
      return window.MastSanitize.sanitizeHtml(html);
    }
    if (window.MastUI && typeof window.MastUI.sanitizeHtml === 'function') {
      return window.MastUI.sanitizeHtml(html);
    }
    if (window.DOMPurify) {
      return window.DOMPurify.sanitize(html, WAIVER_SANITIZE_CFG);
    }
    // Fail closed: no sanitizer available → render as inert escaped text, never raw.
    return esc(html);
  }

  // Vocabularies mirror students.js.
  var DOC_TYPES = ['waiver', 'medical', 'guardian-consent', 'photo-release', 'certification', 'other'];
  var DOC_STATUSES = ['current', 'pending', 'expired', 'not-applicable'];
  var WAIVER_STATUSES = ['draft', 'active', 'archived'];
  var STORAGE_OPTIONS = [
    { value: '', label: '— None —' },
    { value: 'physical', label: 'Physical' },
    { value: 'google-drive', label: 'Google Drive' },
    { value: 'dropbox', label: 'Dropbox' },
    { value: 'other', label: 'Other' }
  ];

  // ── helpers ─────────────────────────────────────────────────────────
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/-/g, ' ') : ''; }
  function nowIso() { return new Date().toISOString(); }
  function val(id) { var el = document.getElementById(id); return el ? (el.value || '') : ''; }
  function checked(id) { var el = document.getElementById(id); return !!(el && el.checked); }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function opts(list, sel) {
    return list.map(function (o) {
      var v = (o && typeof o === 'object') ? o.value : o;
      var l = (o && typeof o === 'object') ? o.label : cap(o);
      return '<option value="' + esc(v) + '"' + (String(sel) === String(v) ? ' selected' : '') + '>' + esc(l) + '</option>';
    }).join('');
  }
  function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:160px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
  function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
  function grp(label) { return '<div style="font-size:0.9rem;font-weight:600;color:var(--teal);margin:14px 0 4px;">' + esc(label) + '</div>'; }
  function checkRow(id, label, on) {
    return '<label class="form-group" style="display:flex;align-items:center;gap:8px;cursor:pointer;">' +
      '<input type="checkbox" id="' + id + '"' + (on ? ' checked' : '') + '>' +
      '<span style="font-size:0.85rem;font-weight:600;">' + esc(label) + '</span></label>';
  }
  function editbar(mode, label) {
    return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + esc(label) + '</div>';
  }
  // A subtle "Delete" affordance for the edit form footer (read mode offers only
  // Edit; hard-delete lives in the edit body, mirroring the legacy forms). Gated:
  // hidden for roles without delete on the students module.
  function deleteRow(fnCall, label) {
    if (typeof window.can === 'function' && !window.can('students', 'delete')) return '';
    return '<div style="margin-top:18px;border-top:1px solid var(--border);padding-top:12px;">' +
      '<button type="button" class="btn btn-small" style="color:var(--danger);" onclick="' + fnCall + '">🗑 ' + esc(label) + '</button></div>';
  }
  function requireEdit() {
    if (typeof window.can === 'function' && !window.can('students', 'edit')) {
      if (window.showToast) showToast('You do not have permission to manage student settings.', true);
      return false;
    }
    return true;
  }
  function canEdit() { return typeof window.can !== 'function' || window.can('students', 'edit'); }

  function isDriveUrl(url) { return url && /drive\.google\.com|docs\.google\.com/.test(url); }
  function drivePreviewHtml(d) {
    d = d || {};
    var meta = d.driveLastModified ? ' · Modified ' + String(d.driveLastModified).split('T')[0] : '';
    return '<div style="background:color-mix(in srgb,var(--success) 14%,transparent);border:1px solid color-mix(in srgb,var(--success) 32%,transparent);border-radius:6px;padding:8px 12px;display:flex;justify-content:space-between;align-items:center;gap:10px;">' +
      '<div style="font-size:0.85rem;color:var(--text-primary);">📄 <strong>' + esc(d.driveFileName || '') + '</strong><span class="mu-sub">' + esc(meta) + '</span></div>' +
      '<button type="button" class="btn btn-small btn-secondary" onclick="StudentsConfigV2.docDriveUnlink()">Unlink</button></div>';
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Entity 1 — Clearance Types (settings/clearanceTypes)
  // ═══════════════════════════════════════════════════════════════════
  MastEntity.define('clearance-types-v2', {
    label: 'Clearance Type', labelPlural: 'Clearance Types', size: 'md', route: 'students-config-v2',
    recordId: function (c) { return c._key || c.id; },
    fields: [
      { name: 'label', label: 'Label', type: 'text', list: true, readOnly: true, sortable: false, get: function (c) { return c.label || 'Unnamed'; } },
      { name: 'description', label: 'Description', type: 'text', list: true, readOnly: true, sortable: false, get: function (c) { return truncate(c.description, 80) || '—'; } },
      { name: 'requiresExpiry', label: 'Expiry', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (c) { return c.requiresExpiry ? 'Expires' : 'No expiry'; },
        tone: function (v) { return v === 'Expires' ? 'amber' : 'neutral'; } }
    ],
    fetch: function (id) { return Promise.resolve(S.ct.byId[id] || null); },
    detail: {
      render: function (UI, c) {
        return UI.card('Clearance type', UI.kv([
          { k: 'Label', v: esc(c.label || 'Unnamed') },
          { k: 'Description', v: c.description ? esc(c.description) : '—' },
          { k: 'Requires expiry', v: UI.badge(c.requiresExpiry ? 'Expires' : 'No expiry', c.requiresExpiry ? 'amber' : 'neutral') }
        ])) +
        '<p class="mu-sub" style="margin-top:10px;">Clearances students need for specific classes (e.g., Torch Safety, Kiln Independent Use). Assigned per-student from the student record.</p>';
      },
      editRender: function (c, mode) {
        c = c || {};
        return editbar(mode, mode === 'create' ? 'New clearance type' : 'Edit clearance type') +
          fg('Label *', '<input class="form-input" id="ctcLabel" value="' + esc(c.label || '') + '" style="width:100%;" placeholder="e.g., Torch Safety Orientation">') +
          fg('Requires expiry', '<select class="form-input" id="ctcExpiry" style="width:100%;">' + opts([{ value: 'false', label: 'No' }, { value: 'true', label: 'Yes' }], c.requiresExpiry ? 'true' : 'false') + '</select>') +
          fg('Description', '<textarea class="form-input" id="ctcDesc" rows="2" style="width:100%;resize:vertical;" placeholder="What this clearance covers">' + esc(c.description || '') + '</textarea>') +
          (mode === 'create' ? '' : deleteRow("StudentsConfigV2.deleteClearance('" + esc(c._key) + "')", 'Delete clearance type'));
      }
    },
    onSave: function (rec, mode) {
      if (!requireEdit()) return false;
      var label = val('ctcLabel').trim();
      if (!label) { if (window.showToast) showToast('Label is required.', true); return false; }
      var fields = { label: label, description: val('ctcDesc').trim() || null, requiresExpiry: val('ctcExpiry') === 'true' };
      if (mode === 'create') {
        var key = MastDB.newKey('settings/clearanceTypes');
        fields.createdAt = nowIso();
        return Promise.resolve(MastDB.set('settings/clearanceTypes/' + key, fields)).then(function () {
          S.ct.byId[key] = Object.assign({ _key: key }, fields);
          if (window.writeAudit) writeAudit('create', 'clearance-type', key);
          if (window.showToast) showToast('Clearance type created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[students-config-v2] ct create', e); if (window.showToast) showToast('Error saving clearance type.', true); return false; });
      }
      var id = rec._key || rec.id;
      return Promise.resolve(MastDB.update('settings/clearanceTypes/' + id, fields)).then(function () {
        Object.assign(S.ct.byId[id] || rec, fields);
        if (window.writeAudit) writeAudit('update', 'clearance-type', id);
        if (window.showToast) showToast('Clearance type saved.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[students-config-v2] ct update', e); if (window.showToast) showToast('Error saving clearance type.', true); return false; });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Entity 2 — Business Documents (admin/documents)
  // ═══════════════════════════════════════════════════════════════════
  function docStatusTone(st) { return st === 'current' ? 'success' : st === 'expired' ? 'danger' : st === 'not-applicable' ? 'neutral' : 'amber'; }
  MastEntity.define('business-docs-v2', {
    label: 'Business Document', labelPlural: 'Business Documents', size: 'md', route: 'students-config-v2',
    recordId: function (d) { return d._key || d.documentId || d.id; },
    fields: [
      { name: 'title', label: 'Document', type: 'text', list: true, readOnly: true, sortable: false, get: function (d) { return d.title || 'Untitled'; } },
      { name: 'type', label: 'Type', type: 'text', list: true, readOnly: true, sortable: false, get: function (d) { return cap(d.type || 'other'); } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true, sortable: false,
        options: DOC_STATUSES, get: function (d) { return d.status || 'pending'; }, tone: docStatusTone },
      { name: 'expiry', label: 'Expiry', type: 'text', list: true, readOnly: true, sortable: false, get: function (d) { return d.expiryDate || '—'; } },
      { name: 'drive', label: 'File', type: 'text', list: true, readOnly: true, sortable: false, get: function (d) { return d.driveFileName ? '📄 ' + truncate(d.driveFileName, 28) : '—'; } }
    ],
    fetch: function (id) { return Promise.resolve(S.docs.byId[id] || null); },
    detail: {
      render: function (UI, d) {
        var fileVal = '—';
        if (d.documentUrl) fileVal = '<a href="' + esc(d.documentUrl) + '" target="_blank" rel="noopener">' + esc(d.driveFileName || 'Open link') + '</a>';
        else if (d.driveFileName) fileVal = '📄 ' + esc(d.driveFileName);
        return UI.card('Document', UI.kv([
          { k: 'Title', v: esc(d.title || 'Untitled') },
          { k: 'Type', v: esc(cap(d.type || 'other')) },
          { k: 'Status', v: UI.badge(cap(d.status || 'pending'), docStatusTone(d.status || 'pending')) },
          { k: 'Storage', v: d.storageLocation ? esc(cap(d.storageLocation)) : '—' },
          { k: 'On-file date', v: d.onFileDate ? esc(d.onFileDate) : '—' },
          { k: 'Expiry date', v: d.expiryDate ? esc(d.expiryDate) : '—' },
          { k: 'File', v: fileVal }
        ])) +
        ((d.description || d.notes) ? UI.card('Details', UI.kv([
          { k: 'Description', v: d.description ? esc(d.description) : '—' },
          { k: 'Notes', v: d.notes ? esc(d.notes) : '—' }
        ])) : '') +
        '<p class="mu-sub" style="margin-top:10px;">Business-wide documents shared across employees and students (licenses, insurance certificates, etc.).</p>';
      },
      editRender: function (d, mode) {
        d = d || {};
        var preview = d.driveFileName
          ? drivePreviewHtml(d)
          : '';
        return editbar(mode, mode === 'create' ? 'New business document' : 'Edit business document') +
          fg('Title *', '<input class="form-input" id="doccTitle" value="' + esc(d.title || '') + '" style="width:100%;" placeholder="Document title">') +
          row2(
            fg('Type', '<select class="form-input" id="doccType" style="width:100%;">' + opts(DOC_TYPES, d.type || 'other') + '</select>', true),
            fg('Status', '<select class="form-input" id="doccStatus" style="width:100%;">' + opts(DOC_STATUSES, d.status || 'current') + '</select>', true)
          ) +
          row2(
            fg('Storage location', '<select class="form-input" id="doccStorage" style="width:100%;">' + opts(STORAGE_OPTIONS, d.storageLocation || '') + '</select>', true),
            fg('On-file date', '<input class="form-input" type="date" id="doccOnFile" value="' + esc(d.onFileDate || '') + '" style="width:100%;">', true)
          ) +
          fg('Expiry date', '<input class="form-input" type="date" id="doccExpiry" value="' + esc(d.expiryDate || '') + '" style="width:100%;">') +
          // Drive link: blur auto-links a Google-Drive share URL (fetches the file
          // name via the in-repo global fetchDriveFileMetadata). dataset on the
          // preview node carries the resolved fields collected at save.
          fg('URL or Google Drive link',
            '<input class="form-input" id="doccUrl" value="' + esc(d.documentUrl || '') + '" style="width:100%;" placeholder="https://drive.google.com/file/d/..." onblur="StudentsConfigV2.docDriveBlur()">' +
            '<div id="doccDrivePreview" data-file-id="' + esc(d.driveFileId || '') + '" data-file-name="' + esc(d.driveFileName || '') + '" data-modified="' + esc(d.driveLastModified || '') + '" style="margin-top:8px;' + (d.driveFileName ? '' : 'display:none;') + '">' + preview + '</div>' +
            '<div class="mu-sub" style="margin-top:6px;">🔗 Paste a Google Drive share link to auto-link the file. Set linked files to <strong>restricted access</strong> in Drive (not "anyone with the link").</div>') +
          fg('Description', '<textarea class="form-input" id="doccDesc" rows="2" style="width:100%;resize:vertical;">' + esc(d.description || '') + '</textarea>') +
          fg('Notes', '<textarea class="form-input" id="doccNotes" rows="2" style="width:100%;resize:vertical;">' + esc(d.notes || '') + '</textarea>') +
          (mode === 'create' ? '' : deleteRow("StudentsConfigV2.deleteDoc('" + esc(d._key) + "')", 'Delete document'));
      }
    },
    onSave: function (rec, mode) {
      if (!requireEdit()) return false;
      var title = val('doccTitle').trim();
      if (!title) { if (window.showToast) showToast('Title is required.', true); return false; }
      var prev = document.getElementById('doccDrivePreview');
      var drive = (prev && prev.dataset.fileName)
        ? { driveFileId: prev.dataset.fileId || null, driveFileName: prev.dataset.fileName || null, driveLastModified: prev.dataset.modified || null }
        : { driveFileId: null, driveFileName: null, driveLastModified: null };
      var record = {
        title: title,
        type: val('doccType') || 'other',
        status: val('doccStatus') || 'current',
        storageLocation: val('doccStorage') || null,
        documentUrl: val('doccUrl').trim() || null,
        onFileDate: val('doccOnFile') || null,
        expiryDate: val('doccExpiry') || null,
        description: val('doccDesc').trim() || null,
        notes: val('doccNotes').trim() || null,
        updatedAt: nowIso()
      };
      Object.assign(record, drive);
      if (mode === 'create') {
        var key = MastDB.newKey('admin/documents');
        record.documentId = key;
        record.createdAt = nowIso();
        return Promise.resolve(MastDB.set('admin/documents/' + key, record)).then(function () {
          S.docs.byId[key] = Object.assign({ _key: key }, record);
          if (window.writeAudit) writeAudit('create', 'business-document', key);
          if (window.showToast) showToast('Document created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[students-config-v2] doc create', e); if (window.showToast) showToast('Error saving document.', true); return false; });
      }
      var id = rec._key || rec.documentId;
      return Promise.resolve(MastDB.update('admin/documents/' + id, record)).then(function () {
        Object.assign(S.docs.byId[id] || rec, record);
        if (window.writeAudit) writeAudit('update', 'business-document', id);
        if (window.showToast) showToast('Document saved.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[students-config-v2] doc update', e); if (window.showToast) showToast('Error saving document.', true); return false; });
    }
  });

  // ═══════════════════════════════════════════════════════════════════
  //  Entity 3 — Waiver Templates (settings/waiverTemplates + public/waivers/{id})
  // ═══════════════════════════════════════════════════════════════════
  function waiverStatusTone(st) { return st === 'active' ? 'teal' : st === 'archived' ? 'neutral' : 'amber'; }
  MastEntity.define('waiver-templates-v2', {
    label: 'Waiver Template', labelPlural: 'Waiver Templates', size: 'lg', route: 'students-config-v2',
    recordId: function (w) { return w._key || w.id; },
    fields: [
      { name: 'title', label: 'Title', type: 'text', list: true, readOnly: true, sortable: false, get: function (w) { return w.title || 'Untitled'; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true, sortable: false,
        options: WAIVER_STATUSES, get: function (w) { return w.status || 'draft'; }, tone: waiverStatusTone },
      { name: 'isDefault', label: 'Default', type: 'text', list: true, readOnly: true, sortable: false,
        get: function (w) { return w.isDefault ? 'Default' : '—'; },
        tone: function (v) { return v === 'Default' ? 'teal' : 'neutral'; } },
      { name: 'version', label: 'Version', type: 'number', list: true, readOnly: true, sortable: false, get: function (w) { return w.version || 1; } },
      { name: 'expiryDays', label: 'Expiry', type: 'text', list: true, readOnly: true, sortable: false, get: function (w) { return w.expiryDays ? (w.expiryDays + ' days') : 'Never'; } }
    ],
    fetch: function (id) { return Promise.resolve(S.wt.byId[id] || null); },
    detail: {
      render: function (UI, w) {
        // Lazy-load this template's signatures into the (initially hidden) pane
        // once the slide-out body is in the DOM. A side-effect schedule (not an
        // innerHTML <script>, which never executes) — fires after open() sets the
        // body synchronously; runs on first open + each edit→read re-render.
        setTimeout(function () { if (window.StudentsConfigV2) StudentsConfigV2.loadSignatures(w._key); }, 0);
        var active = (w.status === 'active');
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(cap(w.status || 'draft'), waiverStatusTone(w.status || 'draft')), hero: true },
          { k: 'Version', v: 'v' + (w.version || 1) },
          { k: 'Default', v: w.isDefault ? 'Yes' : 'No' },
          { k: 'Expiry', v: w.expiryDays ? (w.expiryDays + ' days') : 'Never' }
        ]);
        var tabsBar = UI.paneTabsBar([{ key: 'ov', label: 'Overview' }, { key: 'sigs', label: 'Signatures' }], 'ov');
        var meta = UI.kv([
          { k: 'Status', v: UI.badge(cap(w.status || 'draft'), waiverStatusTone(w.status || 'draft')) },
          { k: 'Version', v: 'v' + (w.version || 1) },
          { k: 'Default waiver', v: w.isDefault ? 'Yes' : 'No' },
          { k: 'Require guardian for minors', v: w.requireMinorGuardian ? 'Yes' : 'No' },
          { k: 'Expires after', v: w.expiryDays ? (w.expiryDays + ' days') : 'Never' }
        ]);
        var linkBtn = active
          ? '<div style="margin-top:12px;"><button class="btn btn-secondary btn-small" onclick="StudentsConfigV2.copyTemplateLink(\'' + esc(w._key) + '\')">🔗 Copy public link</button> <span class="mu-sub">Send this link to students to sign (waiver.html).</span></div>'
          : '<p class="mu-sub" style="margin-top:12px;">Set status to <strong>Active</strong> to share a public signing link.</p>';
        // bodyHtml is admin-authored rich text (intentionally HTML) — rendered as
        // markup, but sanitized (see sanitizeWaiverHtml) to match the public
        // waiver.html signing page's hardening of this same content.
        var body = w.bodyHtml
          ? '<div style="border:1px solid var(--border);border-radius:8px;padding:14px;background:var(--surface-card);font-size:0.85rem;line-height:1.6;max-height:340px;overflow-y:auto;">' + sanitizeWaiverHtml(w.bodyHtml) + '</div>'
          : '<p class="mu-sub">No waiver body yet — edit to add the agreement text.</p>';
        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' + UI.card('Template', meta + linkBtn) + UI.card('Waiver body', body) + '</div>' +
          '<div class="mu-pane" data-pane="sigs" hidden>' + UI.cardTable('Signatures', '<div id="wtcSigs"><div class="mu-sub">Loading signatures…</div></div>') + '</div>';
      },
      editRender: function (w, mode) {
        w = w || {};
        var toolBtn = function (cmd, arg, label, style) {
          return '<button type="button" class="btn btn-small btn-secondary" style="' + (style || '') + '" onclick="StudentsConfigV2.waiverExec(\'' + cmd + '\'' + (arg ? ",'" + arg + "'" : '') + ')">' + label + '</button>';
        };
        var toolbar = '<div id="wtcToolbar" style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;padding:8px;background:var(--cream-dark);border:1px solid var(--border);border-bottom:none;border-radius:6px 6px 0 0;">' +
          toolBtn('bold', '', 'B', 'font-weight:700;') + toolBtn('italic', '', 'I', 'font-style:italic;') + toolBtn('underline', '', 'U', 'text-decoration:underline;') +
          '<span style="width:1px;height:18px;background:var(--border);margin:0 2px;"></span>' +
          toolBtn('formatBlock', 'H2', 'H2') + toolBtn('formatBlock', 'H3', 'H3') +
          '<span style="width:1px;height:18px;background:var(--border);margin:0 2px;"></span>' +
          toolBtn('insertUnorderedList', '', 'List') + toolBtn('insertOrderedList', '', '1. List') +
          '<span style="flex:1;"></span>' +
          '<button type="button" id="wtcPreviewBtn" class="btn btn-small btn-secondary" onclick="StudentsConfigV2.waiverPreview()">Preview</button></div>';
        var editor = '<div id="wtcEditor" contenteditable="true" style="min-height:200px;max-height:400px;overflow-y:auto;padding:12px;border:1px solid var(--border);border-top:none;border-radius:0 0 6px 6px;background:var(--surface-card);font-size:0.9rem;line-height:1.6;outline:none;">' + (w.bodyHtml || '') + '</div>' +
          '<div id="wtcPreview" style="display:none;min-height:200px;max-height:400px;overflow-y:auto;padding:12px;border:1px solid var(--border);border-top:none;border-radius:0 0 6px 6px;background:var(--surface-card);font-size:0.9rem;line-height:1.6;"></div>';
        return editbar(mode, mode === 'create' ? 'New waiver template' : 'Edit waiver template') +
          fg('Title *', '<input class="form-input" id="wtcTitle" value="' + esc(w.title || '') + '" style="width:100%;" placeholder="e.g., Studio Liability Waiver">') +
          row2(
            fg('Status', '<select class="form-input" id="wtcStatus" style="width:100%;">' + opts(WAIVER_STATUSES, w.status || 'draft') + '</select>', true),
            fg('Expiry days', '<input class="form-input" type="number" min="0" id="wtcExpiryDays" value="' + esc(w.expiryDays != null ? w.expiryDays : '') + '" style="width:100%;" placeholder="Empty = never expires">', true)
          ) +
          checkRow('wtcIsDefault', 'Default waiver', w.isDefault) +
          checkRow('wtcRequireGuardian', 'Require guardian for minors', w.requireMinorGuardian) +
          grp('Waiver body') +
          toolbar + editor +
          (mode === 'create' ? '' : deleteRow("StudentsConfigV2.deleteWaiver('" + esc(w._key) + "')", 'Delete waiver template'));
      }
    },
    onSave: function (rec, mode) {
      if (!requireEdit()) return false;
      var title = val('wtcTitle').trim();
      if (!title) { if (window.showToast) showToast('Title is required.', true); return false; }
      var expiryRaw = val('wtcExpiryDays').trim();
      var expiryDays = expiryRaw ? parseInt(expiryRaw, 10) : null;
      if (expiryDays !== null && (isNaN(expiryDays) || expiryDays < 0)) { if (window.showToast) showToast('Expiry days must be a positive number.', true); return false; }
      var editorEl = document.getElementById('wtcEditor');
      var existing = (mode !== 'create') ? S.wt.byId[rec._key || rec.id] : null;
      var version = existing ? ((existing.version || 1) + 1) : 1;
      var isDefault = checked('wtcIsDefault');
      var fields = {
        title: title, status: val('wtcStatus') || 'draft',
        bodyHtml: editorEl ? editorEl.innerHTML : (existing ? existing.bodyHtml : ''),
        expiryDays: expiryDays, isDefault: isDefault, requireMinorGuardian: checked('wtcRequireGuardian'),
        version: version, updatedAt: nowIso()
      };
      var key = (mode === 'create') ? MastDB.newKey('settings/waiverTemplates') : (rec._key || rec.id);
      if (mode === 'create') fields.createdAt = nowIso();

      // isDefault is single-valued: unset every OTHER template's flag first.
      var unset = isDefault
        ? S.wt.rows.filter(function (w) { return w.isDefault && w._key !== key; })
            .map(function (w) { return Promise.resolve(MastDB.set('settings/waiverTemplates/' + w._key + '/isDefault', false)); })
        : [];
      return Promise.all(unset).then(function () {
        var write = (mode === 'create')
          ? MastDB.set('settings/waiverTemplates/' + key, fields)
          : MastDB.update('settings/waiverTemplates/' + key, fields);
        return Promise.resolve(write);
      }).then(function () {
        // Mirror the published projection to public/waivers/{id} (the public
        // waiver.html reads this; mirrors saveWaiverTemplate).
        return Promise.resolve(MastDB.set('public/waivers/' + key, {
          title: fields.title, bodyHtml: fields.bodyHtml, version: fields.version,
          requireMinorGuardian: fields.requireMinorGuardian, expiryDays: fields.expiryDays, status: fields.status
        }));
      }).then(function () {
        if (mode === 'create') { S.wt.byId[key] = Object.assign({ _key: key }, fields); }
        else { Object.assign(S.wt.byId[key] || rec, fields); }
        if (window.writeAudit) writeAudit(mode === 'create' ? 'create' : 'update', 'waiver-template', key);
        if (window.showToast) showToast(mode === 'create' ? 'Waiver template created.' : 'Waiver template saved.');
        reloadSoon(); return true;
      }).catch(function (e) { console.error('[students-config-v2] waiver save', e); if (window.showToast) showToast('Error saving waiver template.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var TABS = [
    { key: 'waivers', label: 'Waivers', entity: 'waiver-templates-v2', coll: 'settings/waiverTemplates', store: 'wt',
      newLabel: '+ New waiver template', open: 'StudentsConfigV2.openWaiver', create: 'StudentsConfigV2.createWaiver',
      empty: { title: 'No waiver templates', message: 'Create a waiver template to start collecting signed waivers.' } },
    { key: 'clearance', label: 'Clearance Types', entity: 'clearance-types-v2', coll: 'settings/clearanceTypes', store: 'ct',
      newLabel: '+ New clearance type', open: 'StudentsConfigV2.openClearance', create: 'StudentsConfigV2.createClearance',
      empty: { title: 'No clearance types', message: 'Create clearance types to track student qualifications.' } },
    { key: 'docs', label: 'Business Documents', entity: 'business-docs-v2', coll: 'admin/documents', store: 'docs',
      newLabel: '+ New document', open: 'StudentsConfigV2.openDoc', create: 'StudentsConfigV2.createDoc',
      empty: { title: 'No business documents', message: 'Track licenses, insurance certificates, and other shared documents.' } }
  ];
  function tabByKey(k) { return TABS.filter(function (t) { return t.key === k; })[0] || TABS[0]; }

  var S = {
    tab: 'waivers', loaded: false,
    ct: { rows: [], byId: {} }, docs: { rows: [], byId: {} }, wt: { rows: [], byId: {} }
  };

  function ingest(store, val) {
    var rows = [], byId = {};
    Object.keys(val || {}).forEach(function (k) {
      var r = val[k];
      if (r && typeof r === 'object') { r = Object.assign({ _key: k }, r); rows.push(r); byId[k] = r; }
    });
    S[store].rows = rows; S[store].byId = byId;
  }

  function load() {
    Promise.all([
      MastDB.get('settings/waiverTemplates'),
      MastDB.get('settings/clearanceTypes'),
      MastDB.get('admin/documents')
    ]).then(function (res) {
      ingest('wt', res[0]); ingest('ct', res[1]); ingest('docs', res[2]);
      // Waivers: default first, then title; others alpha by label/title.
      S.wt.rows.sort(function (a, b) {
        if (!!a.isDefault !== !!b.isDefault) return a.isDefault ? -1 : 1;
        return String(a.title || '').localeCompare(String(b.title || ''));
      });
      S.ct.rows.sort(function (a, b) { return String(a.label || '').localeCompare(String(b.label || '')); });
      S.docs.rows.sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || '')); });
      S.loaded = true; render();
    }).catch(function (e) { console.error('[students-config-v2] load', e); S.loaded = true; render(); });
  }
  function reloadSoon() { S.loaded = false; setTimeout(load, 250); }

  function ensureTab() {
    var el = document.getElementById('studentsConfigV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'studentsConfigV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var active = tabByKey(S.tab);
    var store = S[active.store];
    var actions = '<button class="btn btn-secondary" onclick="StudentsConfigV2.backToRoster()">← Students</button>' +
      (canEdit() ? '<button class="btn btn-primary" onclick="' + active.create + '()">' + esc(active.newLabel) + '</button>' : '');
    var subBar = '<div style="margin:6px 0 14px;">' + U.tabs(TABS.map(function (t) {
      return { key: t.key, label: t.label, count: S[t.store].rows.length };
    }), S.tab, 'StudentsConfigV2.switchTab') + '</div>';
    var listHtml = S.loaded
      ? MastEntity.renderList(active.entity, {
          rows: store.rows, onRowClickFnName: active.open,
          empty: { title: active.empty.title, message: active.empty.message }
        })
      : MastEntity.renderList(active.entity, { rows: [], loading: true });
    tab.innerHTML =
      U.pageHeader({ title: 'Student settings', subtitle: 'Waivers, clearance types & business documents', actionsHtml: actions }) +
      subBar + listHtml;
  }

  // ── public API ──────────────────────────────────────────────────────
  window.StudentsConfigV2 = {
    switchTab: function (k) { S.tab = k; render(); },
    backToRoster: function () { if (typeof window.navigateTo === 'function') navigateTo('students-v2'); else location.hash = '#students-v2'; },

    openWaiver: function (id) { var r = S.wt.byId[id]; if (r) MastEntity.openRecord('waiver-templates-v2', r, 'read'); },
    createWaiver: function () { if (!requireEdit()) return; MastEntity.openRecord('waiver-templates-v2', {}, 'create'); },
    deleteWaiver: function (id) { confirmDelete('waiver', id); },

    openClearance: function (id) { var r = S.ct.byId[id]; if (r) MastEntity.openRecord('clearance-types-v2', r, 'read'); },
    createClearance: function () { if (!requireEdit()) return; MastEntity.openRecord('clearance-types-v2', {}, 'create'); },
    deleteClearance: function (id) { confirmDelete('clearance', id); },

    openDoc: function (id) { var r = S.docs.byId[id]; if (r) MastEntity.openRecord('business-docs-v2', r, 'read'); },
    createDoc: function () { if (!requireEdit()) return; MastEntity.openRecord('business-docs-v2', {}, 'create'); },
    deleteDoc: function (id) { confirmDelete('doc', id); },

    // Rich-text editor (waiver body)
    waiverExec: function (cmd, arg) { document.execCommand(cmd, false, arg || null); var e = document.getElementById('wtcEditor'); if (e) e.focus(); },
    waiverPreview: function () {
      var ed = document.getElementById('wtcEditor'), pv = document.getElementById('wtcPreview'),
          tb = document.getElementById('wtcToolbar'), btn = document.getElementById('wtcPreviewBtn');
      if (!ed || !pv) return;
      var showing = pv.style.display === 'none';
      if (showing) {
        pv.innerHTML = ed.innerHTML; pv.style.display = ''; ed.style.display = 'none';
        if (tb) tb.querySelectorAll('button:not(#wtcPreviewBtn)').forEach(function (b) { b.disabled = true; b.style.opacity = '0.4'; });
        if (btn) btn.textContent = 'Edit';
      } else {
        pv.style.display = 'none'; ed.style.display = '';
        if (tb) tb.querySelectorAll('button:not(#wtcPreviewBtn)').forEach(function (b) { b.disabled = false; b.style.opacity = ''; });
        if (btn) btn.textContent = 'Preview';
      }
    },

    // Drive linking (business documents)
    docDriveBlur: function () {
      var urlEl = document.getElementById('doccUrl');
      var url = urlEl ? urlEl.value.trim() : '';
      if (!isDriveUrl(url)) return;
      var storageEl = document.getElementById('doccStorage');
      if (storageEl && storageEl.value !== 'google-drive') storageEl.value = 'google-drive';
      var prev = document.getElementById('doccDrivePreview');
      if (!prev) return;
      prev.style.display = ''; prev.innerHTML = '<div class="mu-sub">Fetching file info…</div>';
      Promise.resolve(typeof fetchDriveFileMetadata === 'function' ? fetchDriveFileMetadata(url) : null).then(function (meta) {
        if (!meta) { prev.innerHTML = '<div class="mu-sub" style="color:var(--danger);">Could not fetch file metadata.</div>'; return; }
        var idMatch = url.match(/\/d\/([a-zA-Z0-9_-]+)/);
        prev.dataset.fileId = (idMatch && idMatch[1]) || '';
        prev.dataset.fileName = meta.name || '';
        prev.dataset.modified = meta.modifiedTime || '';
        prev.innerHTML = drivePreviewHtml({ driveFileName: meta.name, driveLastModified: meta.modifiedTime });
      }).catch(function () { prev.innerHTML = '<div class="mu-sub" style="color:var(--danger);">Could not fetch file metadata.</div>'; });
    },
    docDriveUnlink: function () {
      var prev = document.getElementById('doccDrivePreview');
      if (prev) { prev.innerHTML = ''; prev.style.display = 'none'; delete prev.dataset.fileId; delete prev.dataset.fileName; delete prev.dataset.modified; }
      var urlEl = document.getElementById('doccUrl'); if (urlEl) urlEl.value = '';
    },

    // Per-template PUBLIC signing link (waiver.html?t=<id>; no CF — the gated
    // per-STUDENT generateWaiverLink lives on students-v2).
    copyTemplateLink: function (id) {
      var domain = (window.TENANT_CONFIG && window.TENANT_CONFIG.domain) || window.location.hostname;
      var url = 'https://' + domain + '/waiver.html?t=' + encodeURIComponent(id);
      window.MastUI.copy(url, { okMsg: 'Waiver link copied', errMsg: false }).then(function (ok) {
        if (!ok && typeof mastCopyFallback === 'function') mastCopyFallback('Copy this link', url);
      });
    },

    // Signatures viewer — read-only. Bounded by templateId. Renders each signature
    // as a native <details> disclosure (no overlay), incl. the signed waiver-text
    // snapshot. Fixes the legacy showSignatureDetailModal `snap` bug by construction.
    loadSignatures: function (templateId) {
      var box = document.getElementById('wtcSigs');
      if (!box) return;
      Promise.resolve(MastDB.query('admin/waiverSignatures').orderByChild('templateId').equalTo(templateId).once('value')).then(function (snap) {
        var val = (snap && snap.val && snap.val()) || {};
        var sigs = Object.keys(val).map(function (k) { return Object.assign({ _key: k }, val[k]); });
        if (!sigs.length) { box.innerHTML = '<div class="mu-sub">✍️ No signatures yet — they appear here once students sign this waiver.</div>'; return; }
        sigs.sort(function (a, b) { return String(b.signedAt || '').localeCompare(String(a.signedAt || '')); });
        box.innerHTML = sigs.map(renderSignature).join('');
      }).catch(function (e) { console.error('[students-config-v2] signatures', e); box.innerHTML = '<div class="mu-sub" style="color:var(--danger);">Error loading signatures.</div>'; });
    }
  };

  function renderSignature(sig) {
    var signed = sig.signedAt ? String(sig.signedAt).split('T')[0] : '—';
    var expired = sig.expiresAt && new Date(sig.expiresAt) < new Date();
    var expiry = sig.expiresAt ? (String(sig.expiresAt).split('T')[0] + (expired ? ' (expired)' : '')) : 'Never';
    var rows = U.kv([
      { k: 'Name', v: esc(sig.signerName || '—') },
      { k: 'Email', v: esc(sig.signerEmail || '—') },
      { k: 'Signed at', v: esc(sig.signedAt || '—') },
      { k: 'Expires', v: (expired ? '<span style="color:var(--danger);">' + esc(expiry) + '</span>' : esc(expiry)) },
      { k: 'IP address', v: esc(sig.signerIp || '—') },
      { k: 'Waiver version', v: 'v' + (sig.templateVersion || '—') },
      { k: 'User agent', v: '<span class="mu-sub" style="word-break:break-all;">' + esc(sig.signerUserAgent || '—') + '</span>' }
    ].concat(sig.guardianName ? [
      { k: 'Guardian', v: esc(sig.guardianName) },
      { k: 'Relationship', v: esc(sig.guardianRelationship || '—') }
    ] : []));
    // waiverTextSnapshot is a SERVER-SIDE copy of the admin-authored template
    // bodyHtml, captured at sign time by the out-of-repo submitWaiverSignature CF
    // (mast-architecture tenant-functions.js: `waiverTextSnapshot: template.bodyHtml`,
    // where `template` is read server-side from settings/waiverTemplates/<id>). NO
    // signer-supplied content reaches it — the signer only supplies a templateId
    // (lookup key) plus free-text fields that the CF clip()s of angle brackets. So
    // it is admin-authored, not signer-controlled. Sanitized at render (not esc()'d:
    // it is intentionally formatted HTML) as defense-in-depth against an RBAC
    // staff→owner payload, mirroring the public waiver.html signing page.
    var snapshot = sig.waiverTextSnapshot
      ? '<div style="margin-top:8px;border:1px solid var(--border);border-radius:6px;padding:10px;background:var(--surface-card);font-size:0.85rem;line-height:1.6;max-height:260px;overflow-y:auto;">' + sanitizeWaiverHtml(sig.waiverTextSnapshot) + '</div>'
      : '';
    return '<details style="border:1px solid var(--border);border-radius:8px;padding:10px 14px;margin-bottom:8px;background:var(--surface-card);">' +
      '<summary style="cursor:pointer;font-size:0.85rem;font-weight:600;color:var(--text-primary);">' +
        esc(sig.signerName || 'Unknown') + ' <span class="mu-sub">· signed ' + esc(signed) + ' · expires ' + esc(expiry) + '</span></summary>' +
      '<div style="margin-top:10px;">' + rows + snapshot + '</div></details>';
  }

  // ── delete (shared) ─────────────────────────────────────────────────
  function confirmDelete(kind, id) {
    if (typeof window.can === 'function' && !window.can('students', 'delete')) {
      if (window.showToast) showToast('You do not have permission to delete student settings.', true); return;
    }
    var spec = {
      waiver: { title: 'Delete waiver template', msg: 'Delete this waiver template? This cannot be undone.', auditEntity: 'waiver-template', run: function () {
        return Promise.all([MastDB.remove('settings/waiverTemplates/' + id), MastDB.remove('public/waivers/' + id)]); } },
      clearance: { title: 'Delete clearance type', msg: 'Delete this clearance type? This cannot be undone.', auditEntity: 'clearance-type', run: function () {
        return Promise.resolve(MastDB.remove('settings/clearanceTypes/' + id)); } },
      doc: { title: 'Delete document', msg: 'Delete this document? This cannot be undone.', auditEntity: 'business-document', run: function () {
        return Promise.resolve(MastDB.remove('admin/documents/' + id)); } }
    }[kind];
    if (!spec) return;
    Promise.resolve(mastConfirm(spec.msg, { title: spec.title, danger: true })).then(function (ok) {
      if (!ok) return;
      return Promise.resolve(spec.run()).then(function () {
        if (window.writeAudit) writeAudit('delete', spec.auditEntity, id);
        if (window.MastUI && window.MastUI.slideOut && window.MastUI.slideOut.requestCloseForce) window.MastUI.slideOut.requestCloseForce();
        if (window.showToast) showToast('Deleted.'); reloadSoon();
      });
    }).catch(function (e) { console.error('[students-config-v2] delete', e); if (window.showToast) showToast('Error deleting.', true); });
  }

  MastAdmin.registerModule('students-config-v2', {
    routes: { 'students-config-v2': { tab: 'studentsConfigV2Tab', setup: function () {
      // Optional ?tab= deep-link (waivers | clearance | docs).
      var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
      if (rp && rp.tab && tabByKey(rp.tab).key === rp.tab) S.tab = rp.tab;
      ensureTab(); render(); load();
    } } }
  });
})();
