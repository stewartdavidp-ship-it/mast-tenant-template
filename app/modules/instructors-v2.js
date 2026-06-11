/**
 * instructors-v2.js — read-focused Faceted Record twin of the legacy Instructors
 * surface (doc 17 §11/§12; conversion playbook).
 *
 * Legacy book.js (#instructors, owned by the Book module) hosts the roster as a
 * stack of cards and swaps the pane in-place to a read-only instructor detail
 * (_renderInstructorDetailView: Profile / Skills / Classes sections) with its own
 * Edit button. This twin re-hosts that VIEW on the Entity Engine: a schema-driven
 * list + a read-focused Faceted Record slide-out (Overview / Classes facets).
 *
 * Variant (doc 17 §1a): an instructor is a person record (profile + skills they
 * teach + the classes assigned to them) with no governed lifecycle — its status
 * (active / inactive) is an assigned attribute → Faceted Record, NOT Process/
 * MastFlow.
 *
 * Create + edit are NATIVE here: a custom detail.editRender (the profile field
 * set, grouped like the legacy form) + an onSave that DELEGATES to
 * window.InstructorsBridge (exposed in book.js) so the instructor write (id
 * minting, slug derivation, payRateCents conversion, create-vs-update PATCH
 * semantics) stays single-sourced — this twin never reimplements that logic
 * (mirrors the contacts-v2 / ContactsBridge precedent). Skills editing stays
 * bespoke on legacy #instructors (the catalog-coupled skill picker has no V2
 * home) and keeps a "manage in classic view" link; the PATCH-style update
 * preserves an instructor's existing skills[]. Flag-gated (?ui=1) at
 * #instructors-v2, side-by-side.
 *
 * Data: instructors live at public/instructors (MastDB.instructors → that path);
 * classes-taught is derived from public/classes (class.instructorId); skill slugs
 * resolve to labels via admin/skillCatalog — all one-shot reads loaded together.
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

  var U = window.MastUI, N = U.Num, esc = U._esc;
  function can(route, axis) { return (typeof window.can === 'function') ? window.can(route, axis) : true; }

  var STATUS_LABEL = { active: 'Active', inactive: 'Inactive' };
  var STATUS_TONE = { active: 'success', inactive: 'neutral' };

  function instrName(i) { return (i && i.name) || '(unnamed)'; }
  function statusOf(i) { return (i && i.status) || 'active'; }
  // Prefer the structured skills[] (post-migration); fall back to legacy
  // specialties[] for instructors not yet migrated (mirrors book.js).
  function skillSlugs(i) { return (i && Array.isArray(i.skills)) ? i.skills.filter(Boolean) : []; }
  function skillLabel(slug) {
    var entry = V2.skillCatalog[slug];
    if (entry && entry.label) return entry.label;
    // Orphan slug not in catalog: title-case it (mirrors book.js _skillLabel).
    return slug ? String(slug).replace(/-/g, ' ').replace(/\b\w/g, function (c) { return c.toUpperCase(); }) : '';
  }
  function skillLabels(i) {
    var slugs = skillSlugs(i);
    if (slugs.length) return slugs.map(skillLabel);
    return (i && Array.isArray(i.specialties)) ? i.specialties.filter(Boolean) : [];
  }
  function skillsText(i) { return skillLabels(i).join(', '); }
  function skillsCount(i) { return skillLabels(i).length; }
  function payRate(i) {
    // payRateCents → "$X.XX/hr"; absent → em-dash handled by callers.
    var v = N.moneyVal(i, 'payRateCents', null);
    return v == null ? null : (N.money(v) + '/hr');
  }
  // Classes assigned to this instructor (cheap: one-shot public/classes read).
  function classesFor(i) {
    var id = i && (i._key || i.id);
    if (!id) return [];
    return V2.classes.filter(function (c) { return c && c.instructorId === id; });
  }

  // ── schema (read-only Faceted Record) ───────────────────────────────
  MastEntity.define('instructors-v2', {
    label: 'Instructor', labelPlural: 'Instructors', size: 'md',
    route: 'instructors-v2',
    recordId: function (i) { return i._key || i.id; },
    fields: [
      // fields[0] (the slide-out title source) materializes a real name string.
      // NOT required:true — custom editRender inputs have no name= attrs, so the
      // engine's pre-validate would collect an empty record and block CREATE
      // (the contacts-v2 gotcha); onSave validates the name itself.
      { name: 'name', label: 'Name', type: 'text', list: true, group: 'Profile', get: instrName },
      { name: 'email', label: 'Email', type: 'text', list: true, readOnly: true, get: function (i) { return i.email || '—'; } },
      { name: 'skills', label: 'Skills', type: 'text', list: true, readOnly: true, sortable: false, get: function (i) { return skillsText(i) || '—'; } },
      { name: 'classCount', label: 'Classes', type: 'number', list: true, readOnly: true, align: 'right', get: function (i) { return classesFor(i).length; } },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        options: ['active', 'inactive'],
        get: statusOf,
        tone: function (v) { return STATUS_TONE[v] || 'neutral'; } }
    ],
    fetch: function (id) {
      if (V2.byId[id]) return Promise.resolve(V2.byId[id]);
      return ensureLoaded().then(function () { return V2.byId[id] || null; });
    },
    detail: {
      render: function (UI, i) {
        var classes = classesFor(i);
        var tiles = UI.tiles([
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(i)] || 'Active', STATUS_TONE[statusOf(i)] || 'neutral'), hero: true },
          { k: 'Classes', v: N.count(classes.length) },
          { k: 'Skills', v: N.count(skillsCount(i)) },
          { k: 'Pay rate', v: esc(payRate(i) || '—') }
        ]);
        var tabsBar = UI.paneTabsBar([
          { key: 'ov', label: 'Overview' }, { key: 'classes', label: 'Classes' }
        ], 'ov');

        // Overview — contact + profile + skills + pay + notes.
        var contact = UI.kv([
          { k: 'Email', v: i.email ? esc(i.email) : '—' },
          { k: 'Phone', v: i.phone ? esc(i.phone) : '—' },
          { k: 'Status', v: UI.badge(STATUS_LABEL[statusOf(i)] || 'Active', STATUS_TONE[statusOf(i)] || 'neutral') },
          { k: 'Pay rate', v: esc(payRate(i) || '—') }
        ]);
        var bioBody = i.bio
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(i.bio) + '</div>'
          : '<span class="mu-sub">No bio.</span>';
        var labels = skillLabels(i);
        var skillsBody = labels.length
          ? '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + labels.map(function (l) {
              return '<span style="font-size:0.72rem;padding:3px 10px;border-radius:999px;background:color-mix(in srgb,var(--teal,teal) 12%,transparent);color:var(--teal,teal);">' + esc(l) + '</span>';
            }).join('') + '</div>'
          : '<span class="mu-sub">No skills listed.</span>';
        var notesBody = i.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(i.notes) + '</div>'
          : '<span class="mu-sub">No internal notes.</span>';
        // Profile editing is NATIVE now (the Edit button on this slide-out).
        // What still has NO V2 home: the skills picker (catalog-coupled) — that
        // stays bespoke on legacy #instructors. navigateToClassic so the V2 route
        // remap doesn't loop back here.
        var manage = '';

        // Classes — active first, then other (mirrors legacy detail grouping).
        var active = classes.filter(function (c) { return c.status === 'active'; });
        var other = classes.filter(function (c) { return c.status !== 'active'; });
        function classCols() {
          return [
            { label: 'Class', render: function (c) { return c.id ? '<button type="button" class="mu-link" onclick="MastEntity.drill(\'classes-v2\',\'' + esc(c.id) + '\')">' + esc(c.name || '—') + '</button>' : esc(c.name || '—'); } },
            { label: 'Type', render: function (c) { return c.type ? '<span class="mu-sub">' + esc(c.type) + '</span>' : '<span class="mu-sub">—</span>'; } },
            { label: 'Status', render: function (c) { return UI.badge(c.status || '—', c.status === 'active' ? 'success' : 'neutral'); } }
          ];
        }
        var classesBody;
        if (!classes.length) {
          classesBody = '<span class="mu-sub">No classes assigned to this instructor.</span>';
        } else {
          classesBody = '';
          if (active.length) classesBody += '<div class="mu-sub" style="margin:0 0 6px;">Active (' + active.length + ')</div>' + UI.relatedTable(classCols(), active);
          if (other.length) classesBody += '<div class="mu-sub" style="margin:' + (active.length ? '14px' : '0') + ' 0 6px;">Other (' + other.length + ')</div>' + UI.relatedTable(classCols(), other);
        }

        // Danger zone — hard delete via the bridge (RBAC + mastConfirm + FK
        // warn in the remove() handler; writeAudit in the bridge core).
        var dangerZone = can('instructors', 'delete')
          ? UI.card('Danger zone', '<button class="btn btn-danger btn-small" onclick="InstructorsV2.remove(\'' + esc(i._key || i.id) + '\')">Delete instructor</button>')
          : '';
        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="ov">' +
            UI.card('Contact', contact) +
            UI.card('Bio', bioBody) +
            UI.card('Skills', skillsBody + manage) +
            UI.card('Internal notes', notesBody) +
          '</div>' +
          '<div class="mu-pane" data-pane="classes" hidden>' + UI.cardTable('Classes (' + classes.length + ')', classesBody) + '</div>' + dangerZone;
      },
      // Native edit form — the legacy showInstructorForm profile field set,
      // grouped: name (required), status, bio, email, phone, pay rate, photo URL,
      // internal notes. Skills are NOT edited here (catalog-coupled picker stays
      // on legacy); a partial update preserves the existing skills[].
      editRender: function (i, mode) {
        i = i || {};
        var statusOpts = ['active', 'inactive'].map(function (s) {
          return '<option value="' + s + '"' + (statusOf(i) === s ? ' selected' : '') + '>' + (STATUS_LABEL[s] || s) + '</option>';
        }).join('');
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        function row2(a, b) { return '<div style="display:flex;gap:12px;flex-wrap:wrap;">' + a + b + '</div>'; }
        var payRateVal = N.moneyVal(i, 'payRateCents', null);
        return '<div class="mu-editbar"><span class="mu-editpill">' + (mode === 'create' ? 'NEW' : 'EDITING') + '</span>' + (mode === 'create' ? 'New instructor' : 'Edit this instructor') + '</div>' +
          row2(
            fg('Name *', '<input class="form-input" id="inV2Name" value="' + esc(i.name || '') + '" style="width:100%;" placeholder="Full name">', true),
            fg('Status', '<select class="form-input" id="inV2Status" style="width:100%;">' + statusOpts + '</select>', true)
          ) +
          fg('Bio', '<textarea class="form-input" id="inV2Bio" rows="3" style="width:100%;resize:vertical;" placeholder="Teaching background and experience...">' + esc(i.bio || '') + '</textarea>') +
          row2(
            fg('Email', '<input class="form-input" type="email" id="inV2Email" value="' + esc(i.email || '') + '" style="width:100%;" placeholder="instructor@email.com">', true),
            fg('Phone', '<input class="form-input" type="tel" id="inV2Phone" value="' + esc(i.phone || '') + '" style="width:100%;" placeholder="(555) 123-4567">', true)
          ) +
          row2(
            fg('Pay rate ($/hr)', '<input class="form-input" type="number" min="0" step="0.01" id="inV2PayRate" value="' + (payRateVal == null ? '' : (payRateVal / 100).toFixed(2)) + '" style="width:100%;">', true),
            fg('Photo URL', '<input class="form-input" type="url" id="inV2Photo" value="' + esc(i.photoUrl || '') + '" style="width:100%;" placeholder="https://...">', true)
          ) +
          fg('Internal notes', '<textarea class="form-input" id="inV2Notes" rows="2" style="width:100%;resize:vertical;" placeholder="Notes visible to admin only...">' + esc(i.notes || '') + '</textarea>') +
          // ── Skills (admin/skillCatalog; add-new via InstructorsBridge.ensureSkill) ──
          (function () {
            var have = {};
            (Array.isArray(i.skills) ? i.skills : []).forEach(function (sl) { have[sl] = true; });
            var slugs = Object.keys(V2.skillCatalog);
            Object.keys(have).forEach(function (sl) { if (slugs.indexOf(sl) < 0) slugs.push(sl); });
            var boxes = slugs.map(function (sl) {
              var label = (V2.skillCatalog[sl] && V2.skillCatalog[sl].label) || sl.replace(/-/g, ' ');
              return '<label style="display:inline-flex;align-items:center;gap:4px;margin:2px 10px 2px 0;font-size:0.85rem;"><input type="checkbox" class="inV2Skill" value="' + esc(sl) + '"' + (have[sl] ? ' checked' : '') + '>' + esc(label) + '</label>';
            }).join('') || '<span class="mu-sub">No skills in the catalog yet — add one below.</span>';
            return fg('Skills', '<div id="inV2SkillBoxes" style="padding:6px 0;">' + boxes + '</div>' +
              '<div style="display:flex;gap:8px;margin-top:4px;"><input class="form-input" id="inV2NewSkill" placeholder="Add a skill — e.g. Glass Fusing" style="flex:1;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();InstructorsV2._addSkill();}"><button type="button" class="btn btn-secondary btn-small" onclick="InstructorsV2._addSkill()">Add</button></div>');
          })();
      }
    },
    onSave: function (rec, mode) {
      if (!window.InstructorsBridge) { if (window.showToast) showToast('Instructors engine still loading — try again', true); return false; }
      var data = {
        name: (document.getElementById('inV2Name') || {}).value || '',
        status: (document.getElementById('inV2Status') || {}).value || 'active',
        bio: (document.getElementById('inV2Bio') || {}).value || '',
        email: (document.getElementById('inV2Email') || {}).value || '',
        phone: (document.getElementById('inV2Phone') || {}).value || '',
        payRate: (document.getElementById('inV2PayRate') || {}).value || '',
        photoUrl: (document.getElementById('inV2Photo') || {}).value || '',
        notes: (document.getElementById('inV2Notes') || {}).value || ''
      };
      if (!data.name.trim()) { if (window.showToast) showToast('Instructor name is required.', true); return false; }

      if (mode === 'create') {
        return Promise.resolve(window.InstructorsBridge.create(data)).then(function (newId) {
          return window.InstructorsBridge.setSkills(newId, readSkills());
        }).then(function () {
          if (window.showToast) showToast('Instructor created.'); reloadSoon(); return true;
        }).catch(function (e) { console.error('[instructors-v2] create', e); if (window.showToast) showToast('Error saving instructor.', true); return false; });
      }
      function readSkills() {
        var out = [];
        document.querySelectorAll('#mastSlideOutBody .inV2Skill:checked').forEach(function (el) { out.push(el.value); });
        return out;
      }
      var skills = readSkills();
      var id = rec._key || rec.id;
      return Promise.resolve(window.InstructorsBridge.update(id, data)).then(function () {
        return window.InstructorsBridge.setSkills(id, skills);
      }).then(function () {
        // Mutate the LIVE cached record (=== the slide-out's read closure, since
        // fetch returns V2.byId[id]); the engine passes a copy to onSave. Shows
        // the edited fields immediately on the post-save read re-render;
        // reloadSoon() then refreshes the cache for the next open. Mirror the
        // Bridge's payRateCents conversion so the post-save tiles read right.
        var pr = parseFloat(data.payRate);
        Object.assign(V2.byId[id] || rec, {
          name: data.name.trim(), status: data.status,
          bio: data.bio.trim() || null, email: data.email.trim() || null,
          phone: data.phone.trim() || null, photoUrl: data.photoUrl.trim() || null,
          notes: data.notes.trim() || null,
          payRateCents: isNaN(pr) ? null : Math.round(pr * 100),
          skills: skills
        });
        if (window.showToast) showToast('Instructor updated.'); reloadSoon(); return true;
      }).catch(function (e) { console.error('[instructors-v2] update', e); if (window.showToast) showToast('Error updating instructor.', true); return false; });
    }
  });

  // ── module state + data ─────────────────────────────────────────────
  var V2 = { rows: [], byId: {}, classes: [], skillCatalog: {}, sortKey: 'name', sortDir: 'asc', q: '', statusFilter: 'all', loaded: false };

  // Run-once data load shared by route setup and cold drills (fetch gate).
  var _loadPromise = null;
  function ensureLoaded() {
    if (V2.loaded) return Promise.resolve();
    if (!_loadPromise) _loadPromise = loadData();
    return _loadPromise;
  }
  function load() { _loadPromise = null; loadData().then(render); }
  function loadData() {
    // Ensure the legacy Book module is loaded so window.InstructorsBridge (the
    // delegated write path) exists — mirrors contacts-v2 / materials-v2.
    if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
    // Instructors + classes (for the Classes facet/count) + skill catalog (for
    // slug→label) load together; all one-shot keyed-object reads.
    return Promise.all([
      Promise.resolve(MastDB.get('public/instructors')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('public/classes')).catch(function () { return null; }),
      Promise.resolve(MastDB.get('admin/skillCatalog')).catch(function () { return null; })
    ]).then(function (res) {
      var iv = res[0] || {}, cv = res[1] || {}, sv = res[2] || {};
      var out = [];
      Object.keys(iv).forEach(function (k) {
        var i = iv[k];
        if (i && typeof i === 'object') { i = Object.assign({ _key: k }, i); i.status = i.status || 'active'; out.push(i); }
      });
      V2.rows = out; V2.byId = {}; out.forEach(function (r) { V2.byId[r._key] = r; });
      V2.classes = Object.keys(cv).map(function (k) { var c = cv[k] || {}; c.id = c.id || k; return c; });
      V2.skillCatalog = sv || {};
      V2.loaded = true;
    }).catch(function (e) { console.error('[instructors-v2] load', e); });
  }
  function reloadSoon() { V2.loaded = false; _loadPromise = null; setTimeout(load, 250); }   // let the legacy write settle, then refresh

  function visibleRows() {
    var rows = V2.rows;
    if (V2.statusFilter !== 'all') rows = rows.filter(function (i) { return statusOf(i) === V2.statusFilter; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (i) {
        return String(i.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(i.email || '').toLowerCase().indexOf(q) >= 0 ||
               skillsText(i).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('instructors-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('instructorsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'instructorsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    var filters = [['all', 'All'], ['active', 'Active'], ['inactive', 'Inactive']]
      .map(function (f) {
        var on = V2.statusFilter === f[0];
        return '<button class="btn btn-small ' + (on ? 'btn-primary' : 'btn-secondary') + '" onclick="InstructorsV2.filter(\'' + f[0] + '\')">' + f[1] + '</button>';
      }).join(' ');
    tab.innerHTML =
      U.pageHeader({
        title: 'Instructors',
        count: N.count(V2.rows.length) + ' instructor' + (V2.rows.length === 1 ? '' : 's'),
        actionsHtml: '<button class="btn btn-primary" onclick="InstructorsV2.create()">+ New instructor</button>' +
          '<button class="btn btn-secondary" onclick="InstructorsV2.exportCsv()">↓ Export</button>'
      }) +
      '<div style="display:flex;gap:6px;flex-wrap:wrap;margin:12px 0;">' + filters + '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="Search name, email or skill…" value="' + esc(V2.q) +
        '" oninput="InstructorsV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      MastEntity.renderList('instructors-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'InstructorsV2.sort', onRowClickFnName: 'InstructorsV2.open',
        empty: { title: 'No instructors', message: V2.loaded ? 'Add an instructor to get started.' : 'Loading…' }
      });
  }

  window.InstructorsV2 = {
    remove: function (id) {
      if (!can('instructors', 'delete')) { if (window.showToast) showToast('Instructors delete access required.', true); return; }
      if (!window.InstructorsBridge || !window.InstructorsBridge.remove) { if (window.showToast) showToast('Instructors engine still loading — try again', true); return; }
      var rec = V2.byId[id];
      var assigned = rec ? V2.classes.filter(function (c) { return c && c.instructorId === id; }).length : 0;
      var msg = 'Delete the instructor "' + ((rec && rec.name) || '') + '"?' +
        (assigned ? ' ' + assigned + ' class' + (assigned === 1 ? ' is' : 'es are') + ' assigned to them — those classes keep the name but lose the link.' : '') +
        ' This cannot be undone.';
      mastConfirm(msg, { title: 'Delete Instructor', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        Promise.resolve(window.InstructorsBridge.remove(id)).then(function () {
          delete V2.byId[id];
          V2.rows = V2.rows.filter(function (x) { return (x._key || x.id) !== id; });
          if (window.showToast) showToast('Instructor deleted');
          try { U.slideOut.requestClose(); } catch (_) {}
          render();
        }).catch(function (e) { if (window.showToast) showToast('Delete failed: ' + (e && e.message || e), true); });
      });
    },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'classCount' ? 'desc' : 'asc'); }
      render();
    },
    filter: function (f) { V2.statusFilter = f; render(); },
    search: function (v) { V2.q = v || ''; render(); },
    open: function (id) {
      MastEntity.get('instructors-v2').fetch(id).then(function (rec) {
        if (rec) MastEntity.openRecord('instructors-v2', rec, 'read');
      });
    },
    create: function () {
      // Ensure the legacy Book module (and thus window.InstructorsBridge) is
      // loaded before opening the create form — mirrors ContactsV2.create.
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') { try { MastAdmin.loadModule('book'); } catch (e) {} }
      MastEntity.openRecord('instructors-v2', {}, 'create');
    },
    // Skills editing (catalog-coupled picker) stays bespoke on legacy
    // #instructors (no V2 home). Profile create/edit is native. navigateToClassic
    // so the V2 route remap doesn't loop us back to this twin.
    _addSkill: function () {
      var input = document.getElementById('inV2NewSkill');
      var label = input && input.value.trim();
      if (!label) return;
      if (!window.InstructorsBridge || !window.InstructorsBridge.ensureSkill) { if (window.showToast) showToast('Instructors engine still loading — try again', true); return; }
      Promise.resolve(window.InstructorsBridge.ensureSkill(label)).then(function (slug) {
        if (!slug) return;
        V2.skillCatalog[slug] = V2.skillCatalog[slug] || { slug: slug, label: label };
        var boxes = document.getElementById('inV2SkillBoxes');
        var existing = boxes && boxes.querySelector('input[value="' + slug + '"]');
        if (boxes && !existing) {
          var lbl = document.createElement('label');
          lbl.style.cssText = 'display:inline-flex;align-items:center;gap:4px;margin:2px 10px 2px 0;font-size:0.85rem;';
          lbl.innerHTML = '<input type="checkbox" class="inV2Skill" value="' + esc(slug) + '" checked>' + esc(label);
          boxes.appendChild(lbl);
        } else if (existing) { existing.checked = true; }
        input.value = '';
      }).catch(function (e) { if (window.showToast) showToast('Could not add skill.', true); console.error('[instructors-v2] addSkill', e); });
    },
    exportCsv: function () { return MastEntity.exportRows('instructors-v2', visibleRows(), 'all'); }
  };

  MastAdmin.registerModule('instructors-v2', {
    routes: { 'instructors-v2': { tab: 'instructorsV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
