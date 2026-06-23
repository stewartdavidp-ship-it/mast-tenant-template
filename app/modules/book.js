/**
 * Book Module — Class Scheduling, Session Management & Enrollment
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var classesData = [];
  var classesLoaded = false;
  var selectedClassId = null;
  var sessionsData = [];
  var enrollmentsData = [];
  // CQ1Urw — enrollment detail-view state. When set, renderEnrollments swaps
  // the table for the detail panel.
  var _enrollViewId = null;
  var enrollmentsLoaded = false;
  var _classListSortKey = 'name';
  var _classListSortDir = 'asc';
  var _enrollSortKey = 'createdAt';
  var _enrollSortDir = 'desc';
  var allClassesMap = {}; // id → class for enrollment lookups
  var allSessionsMap = {}; // id → session for enrollment display
  var instructorsData = [];
  // B8 — instructor read-view state. When set, renderInstructorList renders
  // the read-only detail for that instructor instead of the list.
  var _instrViewId = null;
  var instructorsLoaded = false;
  var instructorsMap = {}; // id → instructor
  var resourcesData = [];
  var resourcesLoaded = false;
  var resourcesMap = {}; // id → resource
  var currentSubTab = 'classes';

  // ── Skill catalog (admin/skillCatalog) ──
  // Slugs are the doc IDs so duplicate prevention happens at the path layer.
  // skillCatalogMap[slug] → { slug, label, status, createdAt, ... }. Loaded
  // alongside instructors. Migration is one-shot per instructor via the
  // instructor.migration.skillsFromSpecialties flag.
  var skillCatalogMap = {};
  var skillCatalogLoaded = false;

  function _skillSlug(raw) {
    if (!raw) return '';
    return String(raw)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function _skillLabel(slug) {
    var entry = skillCatalogMap[slug];
    if (entry && entry.label) return entry.label;
    // Orphan: slug not in catalog. Title-case the slug as a fallback so the
    // operator can still see something meaningful and recover via the
    // instructor-detail "Add to catalog" affordance.
    return slug ? slug.replace(/-/g, ' ').replace(/\b\w/g, function(c){ return c.toUpperCase(); }) : '';
  }

  // Ensure a catalog entry exists for the given label. Returns the slug.
  // Idempotent — safe to call repeatedly. Writes only when missing.
  async function ensureSkillInCatalog(label, firstUsedBy) {
    var slug = _skillSlug(label);
    if (!slug) return null;
    if (skillCatalogMap[slug]) return slug;
    var now = new Date().toISOString();
    var entry = {
      slug: slug,
      label: String(label).trim(),
      status: 'active',
      firstUsedBy: firstUsedBy || 'unknown',
      createdAt: now,
      updatedAt: now
    };
    try {
      await MastDB.skillCatalog.set(slug, entry);
      skillCatalogMap[slug] = entry;
    } catch (err) {
      console.error('[Book] ensureSkillInCatalog failed:', err);
    }
    return slug;
  }

  async function loadSkillCatalog() {
    try {
      var data = (await MastDB.skillCatalog.list(200)) || {};
      skillCatalogMap = {};
      Object.keys(data).forEach(function(slug) {
        var entry = data[slug] || {};
        entry.slug = slug;
        skillCatalogMap[slug] = entry;
      });
      skillCatalogLoaded = true;
    } catch (err) {
      console.error('[Book] Failed to load skill catalog:', err);
      skillCatalogMap = {};
      skillCatalogLoaded = true; // soft-fail so dependent UI still renders
    }
  }

  // One-shot migration: for any instructor with specialties[] populated and
  // no skills[] AND no migration.skillsFromSpecialties flag, slugify each
  // specialty, ensure catalog entry, write skills[] + flag.
  async function _migrateInstructorSkillsIfNeeded(instructors) {
    var toMigrate = (instructors || []).filter(function(i) {
      if (!i) return false;
      if (i.migration && i.migration.skillsFromSpecialties) return false;
      if (Array.isArray(i.skills) && i.skills.length) return false;
      if (!Array.isArray(i.specialties) || i.specialties.length === 0) return false;
      return true;
    });
    if (toMigrate.length === 0) return;
    for (var n = 0; n < toMigrate.length; n++) {
      var instr = toMigrate[n];
      var slugs = [];
      for (var s = 0; s < instr.specialties.length; s++) {
        var raw = instr.specialties[s];
        if (!raw) continue;
        var slug = await ensureSkillInCatalog(raw, 'instructor');
        if (slug && slugs.indexOf(slug) === -1) slugs.push(slug);
      }
      try {
        await MastDB.instructors.update(instr.id, {
          skills: slugs,
          migration: Object.assign({}, instr.migration || {}, { skillsFromSpecialties: true }),
          updatedAt: new Date().toISOString()
        });
        instr.skills = slugs;
        instr.migration = Object.assign({}, instr.migration || {}, { skillsFromSpecialties: true });
      } catch (err) {
        console.error('[Book] Instructor skills migration failed for', instr.id, err);
      }
    }
  }

  // Returns array of missing skill slugs for the given instructor against
  // the given required slugs. Empty array = qualified.
  function _missingSkills(instructor, requiredSlugs) {
    if (!requiredSlugs || requiredSlugs.length === 0) return [];
    var have = (instructor && Array.isArray(instructor.skills)) ? instructor.skills : [];
    var haveSet = Object.create(null);
    have.forEach(function(s) { haveSet[s] = true; });
    return requiredSlugs.filter(function(s) { return !haveSet[s]; });
  }

  function _isQualified(instructor, requiredSlugs) {
    return _missingSkills(instructor, requiredSlugs).length === 0;
  }

  // ── Skill checkbox picker (matches the pass-definition class-scope pattern) ──
  // Renders a list of `book-check` checkboxes, one per active catalog entry,
  // plus an inline "Add new skill" text input. Read selected slugs via
  // getSkillPickerSlugs(pickerId). No custom widget chrome — pure existing
  // form primitives (labels, checkboxes, inputs).
  window._skillPickers = window._skillPickers || {};

  function _esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function renderSkillPickerHtml(pickerId, initialSlugs, placeholder) {
    var safeId = pickerId.replace(/[^a-zA-Z0-9_-]/g, '');
    return '<div id="' + safeId + '-wrap" data-picker-id="' + safeId + '">' +
      '<div id="' + safeId + '-list"></div>' +
      '<div style="display:flex;gap:6px;margin-top:6px;align-items:center;">' +
        '<input type="text" id="' + safeId + '-new" class="form-input" placeholder="' + (placeholder || 'Add new skill — e.g. Wheel Throwing') + '"' +
          ' style="flex:1;font-size:0.85rem;" onkeydown="if(event.key===\'Enter\'){event.preventDefault();window._skillPickerAddNew(\'' + safeId + '\')}">' +
        '<button type="button" class="btn btn-secondary" style="font-size:0.78rem;padding:6px 12px;" onclick="window._skillPickerAddNew(\'' + safeId + '\')">Add</button>' +
      '</div>' +
    '</div>';
  }

  function initSkillPicker(pickerId, opts) {
    opts = opts || {};
    window._skillPickers[pickerId] = {
      slugs: (opts.initialSlugs || []).filter(Boolean),
      onChange: typeof opts.onChange === 'function' ? opts.onChange : null,
      firstUsedBy: opts.firstUsedBy || 'unknown'
    };
    _renderSkillCheckboxes(pickerId);
  }

  function getSkillPickerSlugs(pickerId) {
    var state = window._skillPickers[pickerId];
    return state ? state.slugs.slice() : [];
  }

  function _renderSkillCheckboxes(pickerId) {
    var state = window._skillPickers[pickerId];
    var list = document.getElementById(pickerId + '-list');
    if (!state || !list) return;
    var selected = Object.create(null);
    state.slugs.forEach(function(s) { selected[s] = true; });

    // Union of catalog + any selected slugs not in catalog (orphans). Orphan
    // entries still render so the operator can see + uncheck them.
    var entries = [];
    Object.keys(skillCatalogMap).forEach(function(slug) {
      var e = skillCatalogMap[slug];
      if (e && e.status !== 'archived') entries.push({ slug: slug, label: e.label || _skillLabel(slug) });
    });
    state.slugs.forEach(function(slug) {
      if (!skillCatalogMap[slug]) entries.push({ slug: slug, label: _skillLabel(slug) });
    });
    entries.sort(function(a, b) { return (a.label || '').localeCompare(b.label || ''); });

    if (entries.length === 0) {
      list.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:4px 0;">No skills yet. Add one below.</div>';
      return;
    }
    list.innerHTML = entries.map(function(e) {
      var checked = selected[e.slug] ? ' checked' : '';
      return '<label class="book-check" style="margin-bottom:6px;display:block;">' +
        '<input type="checkbox" value="' + _esc(e.slug) + '"' + checked +
          ' onchange="window._skillPickerToggle(\'' + pickerId + '\', \'' + _esc(e.slug) + '\', this.checked)"> ' +
        _esc(e.label) +
      '</label>';
    }).join('');
  }

  window._skillPickerToggle = function(pickerId, slug, on) {
    var state = window._skillPickers[pickerId];
    if (!state) return;
    if (on) {
      if (state.slugs.indexOf(slug) === -1) state.slugs.push(slug);
    } else {
      state.slugs = state.slugs.filter(function(s) { return s !== slug; });
    }
    if (state.onChange) state.onChange(state.slugs);
  };

  window._skillPickerAddNew = async function(pickerId) {
    var state = window._skillPickers[pickerId];
    var input = document.getElementById(pickerId + '-new');
    if (!state || !input) return;
    var raw = (input.value || '').trim();
    if (!raw) return;
    // If an existing catalog entry matches by label, reuse rather than re-create.
    var existing = Object.keys(skillCatalogMap).find(function(k) {
      var e = skillCatalogMap[k];
      return e && (e.label || '').toLowerCase() === raw.toLowerCase();
    });
    var slug = existing || await ensureSkillInCatalog(raw, state.firstUsedBy);
    if (!slug) return;
    if (state.slugs.indexOf(slug) === -1) state.slugs.push(slug);
    input.value = '';
    _renderSkillCheckboxes(pickerId);
    if (state.onChange) state.onChange(state.slugs);
  };

  // Renders an instructor <select> grouped by qualified/unqualified against
  // requiredSlugs. When requiredSlugs is empty, falls back to the original
  // flat list. Unqualified options show a marker + tooltip naming missing skills.
  function _renderClassInstructorSelect(selectedId, requiredSlugs) {
    var active = instructorsData.filter(function(i) { return i.status === 'active'; });
    function _opt(i, marker, title) {
      var sel = i.id === selectedId ? ' selected' : '';
      var t = title ? ' title="' + _esc(title) + '"' : '';
      return '<option value="' + _esc(i.id) + '"' + sel + t + '>' + _esc((marker || '') + (i.name || '')) + '</option>';
    }
    var selectAttrs = ' onchange="window._bookRefreshClassFormAssignment && window._bookRefreshClassFormAssignment()"';
    if (!requiredSlugs || requiredSlugs.length === 0) {
      return '<select id="bcfInstructor" class="form-input"' + selectAttrs + '><option value="">None</option>' +
        active.map(function(i) { return _opt(i); }).join('') +
      '</select>';
    }
    var qualified = [];
    var unqualified = [];
    active.forEach(function(i) {
      var missing = _missingSkills(i, requiredSlugs);
      if (missing.length === 0) qualified.push(i);
      else unqualified.push({ instr: i, missing: missing });
    });
    var html = '<select id="bcfInstructor" class="form-input"' + selectAttrs + '><option value="">None</option>';
    if (qualified.length > 0) {
      html += '<optgroup label="Qualified (' + qualified.length + ')">' +
        qualified.map(function(i) { return _opt(i); }).join('') +
      '</optgroup>';
    }
    if (unqualified.length > 0) {
      html += '<optgroup label="Missing required skills (' + unqualified.length + ')">' +
        unqualified.map(function(u) {
          var labels = u.missing.map(_skillLabel).join(', ');
          return _opt(u.instr, '', 'Missing: ' + labels);
        }).join('') +
      '</optgroup>';
    }
    html += '</select>';
    return html;
  }

  // Renders coverage warning HTML for a class against requiredSlugs. Empty
  // when no skills required or when at least one active instructor qualifies.
  // Visual style matches the existing URL-filter banner convention in this
  // file (e.g. bookInstructorsUrlFilterBanner) so the amber alert is a single
  // shared look across the module.
  function _renderCoverageWarning(requiredSlugs) {
    if (!requiredSlugs || requiredSlugs.length === 0) return '';
    var active = instructorsData.filter(function(i) { return i.status === 'active'; });
    var anyQualified = active.some(function(i) { return _isQualified(i, requiredSlugs); });
    if (anyQualified) return '';
    var labels = requiredSlugs.map(_skillLabel).join(', ');
    return '<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);' +
      'color:#F59E0B;padding:8px 12px;border-radius:6px;font-size:0.85rem;display:flex;align-items:center;gap:12px;">' +
      '<span>No active instructor has all of: ' + _esc(labels) + '. ' +
      'Add these skills to an existing instructor or revise the requirements.</span>' +
      '</div>';
  }

  // Class detail: renders the read-only required-skills chip row. Reuses the
  // existing teal chip styling from _renderInstructorDetailView so the look
  // matches across the module (instructor specialty chips ↔ class required-
  // skill chips). Orphan slugs render identically — recovery happens via the
  // catalog as it gets repopulated; no novel chip variants.
  function _classDetailReqSkillsBlock(cls) {
    var arr = (cls && Array.isArray(cls.requiredSkills)) ? cls.requiredSkills : [];
    var chips = arr.length === 0
      ? '<span style="color:var(--warm-gray);font-size:0.85rem;">None</span>'
      : arr.map(function(slug) {
          return '<span style="display:inline-block;background:rgba(42,124,111,0.12);color:var(--teal,#2a7c6f);' +
            'padding:3px 10px;border-radius:14px;font-size:0.78rem;margin:2px 4px 2px 0;">' +
            _esc(_skillLabel(slug)) + '</span>';
        }).join('');
    return '<div style="margin-top:0.75rem;">' +
      '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:4px;">Required skills</div>' +
      '<div>' + chips + '</div>' +
    '</div>';
  }

  // Class detail: persistent coverage banner. Same styling as the existing
  // URL-filter banner convention in this file.
  function _classDetailCoverageBanner(cls) {
    var arr = (cls && Array.isArray(cls.requiredSkills)) ? cls.requiredSkills : [];
    if (arr.length === 0) return '';
    var anyQual = instructorsData.some(function(i) {
      return i.status === 'active' && _isQualified(i, arr);
    });
    if (anyQual) return '';
    return '<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);' +
      'color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
      '<span>No active instructor has all required skills (' +
      _esc(arr.map(_skillLabel).join(', ')) + '). ' +
      'Add the missing skills to an existing instructor or revise the requirements.</span>' +
      '</div>';
  }

  // Selection-specific warning. Distinct from the system-level coverage
  // warning (which says "no instructor at all qualifies"). This one fires
  // when the SELECTED instructor specifically is missing required skills —
  // catches the silent case where the operator picks (or has carried over)
  // an unqualified instructor and the closed <select> doesn't visually flag
  // the mismatch.
  function _renderInstructorSelectionWarning(selectedId, requiredSlugs) {
    if (!selectedId || !requiredSlugs || requiredSlugs.length === 0) return '';
    var instr = instructorsData.find(function(i) { return i.id === selectedId; });
    if (!instr) return '';
    var missing = _missingSkills(instr, requiredSlugs);
    if (missing.length === 0) return '';
    return '<div style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);' +
      'color:#F59E0B;padding:6px 10px;border-radius:6px;font-size:0.78rem;">' +
      'Selected instructor is missing: ' + _esc(missing.map(_skillLabel).join(', ')) +
    '</div>';
  }

  // Re-render class-form instructor select + coverage warning when the
  // requiredSkills picker OR the selected instructor changes. Preserves
  // selection across re-render. Also exposes a window handle so the
  // <select> onchange can call it without leaking module internals.
  function _refreshClassFormAssignment() {
    var slugs = getSkillPickerSlugs('clsReqSkillPicker');
    var wrap = document.getElementById('bcfInstructorWrap');
    var warnEl = document.getElementById('clsCoverageWarning');
    var selWarnEl = document.getElementById('bcfInstructorSelectionWarning');
    var current = (document.getElementById('bcfInstructor') || {}).value || '';
    if (wrap) wrap.innerHTML = _renderClassInstructorSelect(current, slugs);
    if (warnEl) warnEl.innerHTML = _renderCoverageWarning(slugs);
    // Selection warning reads the (just-re-rendered) select value.
    var currentAfter = (document.getElementById('bcfInstructor') || {}).value || '';
    if (selWarnEl) selWarnEl.innerHTML = _renderInstructorSelectionWarning(currentAfter, slugs);
  }
  window._bookRefreshClassFormAssignment = _refreshClassFormAssignment;

  var CLASS_TYPES = ['series', 'single', 'dropin', 'private'];
  var CLASS_STATUSES = ['draft', 'active', 'published', 'completed', 'archived'];
  var ENROLLMENT_STATUSES = ['confirmed', 'waitlisted', 'cancelled', 'no-show', 'completed', 'late'];
  var DAYS_OF_WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
  var DAY_LABELS = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' };
  var RESOURCE_TYPES = ['room', 'equipment'];
  var PASS_TYPES = ['drop-in', 'pack', 'unlimited', 'limited', 'series', 'intro'];
  var PASS_PRIORITIES = ['high', 'medium', 'low'];
  var passDefsData = [];
  var passDefsLoaded = false;
  // B9 — passes read-view state. When set, renderPassDefList renders the
  // read-only detail view for that pass def instead of the list.
  var _passViewPid = null;
  // Aggregate doc cache (admin/passDefinitionAggregates/{id}), keyed by passDefId.
  var _passAggregateByDef = {};
  // Per-instance index cache (admin/passInstances filtered by passDefId), keyed
  // by passDefId. Loaded once per detail-view open. Cohort filters are
  // computed client-side from this list so time-dependent cohorts
  // (expiringIn7d, lapsedNd) always reflect "right now."
  var _passInstancesByDef = {};
  var _passLoadingFor = null;
  // Selected cohort key for the drill-down section.
  var _passSelectedCohort = 'active';
  var _passInstanceSortKey = 'customerName';
  var _passInstanceSortDir = 'asc';

  // Calendar state
  var calendarYear = new Date().getFullYear();
  var calendarMonth = new Date().getMonth();
  var calendarSessions = [];
  var calendarClassesMap = {};
  var calendarLoaded = false;
  // IcrLjht — calendar multi-select filters. Each set holds the IDs the
  // operator has TOGGLED IN; empty set = no filter on that dimension. A
  // session must match all 3 dimensions to show (intersection).
  var _calFilterClasses = Object.create(null);
  var _calFilterInstructors = Object.create(null);
  var _calFilterResources = Object.create(null);
  var _calInstructorsMap = {};
  var _calResourcesMap = {};
  var selectedCalendarDay = null;

  // Class form image state (single image)
  var editingClassImageUrl = null;

  // Reports state
  var reportsLoaded = false;

  // ============================================================
  // Shared Style Constants
  // ============================================================

  var SUCCESS_COLOR = '#4DB6AC';
  var DANGER_COLOR = '#EF9A9A';
  var WARNING_COLOR = '#FFD54F';
  var CARD_STYLE = 'background:var(--surface-dark);border-radius:8px;padding:12px 16px;';
  var FORM_SELECT_STYLE = 'padding:6px 8px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.85rem;';
  var FILTER_SELECT_STYLE = 'padding:6px 10px;border-radius:6px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:0.85rem;';
  var SECTION_H3 = 'margin:1.5rem 0 0.75rem;';
  var EMPTY_STATE_STYLE = 'color:var(--warm-gray);padding:2rem;text-align:center;';
  var LOADING_HTML = '<div style="padding:2rem;text-align:center;"><div style="display:inline-block;width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--text);border-radius:50%;animation:bookSpin 0.8s linear infinite;"></div><p style="color:var(--warm-gray);margin-top:8px;font-size:0.85rem;">Loading...</p></div>';

  // ============================================================
  // Badge Styles
  // ============================================================

  var TYPE_BADGE_COLORS = {
    series:  { bg: 'rgba(91,33,182,0.2)',  color: '#B39DDB', border: 'rgba(91,33,182,0.35)' },
    single:  { bg: 'rgba(30,64,175,0.2)',  color: '#64B5F6', border: 'rgba(30,64,175,0.35)' },
    dropin:  { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    'private': { bg: 'rgba(146,64,14,0.2)', color: '#FFD54F', border: 'rgba(146,64,14,0.35)' }
  };

  var STATUS_BADGE_COLORS = {
    active:    { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    draft:     { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' },
    archived:  { bg: 'rgba(146,64,14,0.2)',  color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    scheduled: { bg: 'rgba(30,64,175,0.2)',  color: '#64B5F6', border: 'rgba(30,64,175,0.35)' },
    cancelled: { bg: 'rgba(183,28,28,0.2)',  color: '#EF9A9A', border: 'rgba(183,28,28,0.35)' },
    completed: { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    confirmed: { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    waitlisted: { bg: 'rgba(146,64,14,0.2)', color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    'no-show':  { bg: 'rgba(183,28,28,0.2)', color: '#EF9A9A', border: 'rgba(183,28,28,0.35)' },
    'checked-in': { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    'attended-pending-waiver': { bg: 'rgba(146,64,14,0.2)', color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    'incomplete': { bg: 'rgba(230,81,0,0.2)',   color: '#FF8A65', border: 'rgba(230,81,0,0.35)' },
    'late':       { bg: 'rgba(146,64,14,0.2)',  color: '#FFD54F', border: 'rgba(146,64,14,0.35)' }
  };

  var SEVERITY_BADGE_COLORS = {
    low:      { bg: 'rgba(6,95,70,0.25)',   color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    medium:   { bg: 'rgba(146,64,14,0.2)',  color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    high:     { bg: 'rgba(230,81,0,0.2)',   color: '#FF8A65', border: 'rgba(230,81,0,0.35)' },
    critical: { bg: 'rgba(183,28,28,0.2)',  color: '#EF9A9A', border: 'rgba(183,28,28,0.35)' }
  };

  var PASS_TYPE_BADGE_COLORS = {
    'drop-in':  TYPE_BADGE_COLORS.single,
    'pack':     TYPE_BADGE_COLORS.series,
    'unlimited': TYPE_BADGE_COLORS.dropin,
    'limited':  TYPE_BADGE_COLORS['private'],
    'series':   TYPE_BADGE_COLORS.series,
    'intro':    { bg: 'rgba(146,64,14,0.2)', color: '#FFD54F', border: 'rgba(146,64,14,0.35)' }
  };

  var RESOURCE_TYPE_BADGE_COLORS = {
    'room':      TYPE_BADGE_COLORS.series,
    'equipment': TYPE_BADGE_COLORS.single
  };

  function badgeStyle(map, key) {
    var c = map[(key || '').toLowerCase()] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'display:inline-block;padding:2px 8px;border-radius:4px;font-size:0.78rem;font-weight:600;background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  // Inject book-specific CSS
  (function() {
    if (!document.getElementById('bookModuleStyles')) {
      var style = document.createElement('style');
      style.id = 'bookModuleStyles';
      style.textContent =
        '@keyframes bookSpin{to{transform:rotate(360deg)}}' +

        /* Responsive utilities */
        '@media(max-width:600px){.book-hide-narrow{display:none!important;}}' +
        '.book-responsive-grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));}' +

        /* .form-label and .form-input are now defined globally in index.html */

        /* Form section cards — theme-adaptive */
        '.book-form-section{background:var(--cream,var(--cream));border:1px solid var(--cream-dark,#ddd);' +
          'border-radius:12px;padding:1.25rem 1.5rem;margin-bottom:1.25rem;}' +
        'body.dark-mode .book-form-section{background:var(--surface-card,#2a2a2a);border-color:var(--border,#444);}' +
        '.book-form-section-title{font-size:0.78rem;font-weight:700;text-transform:uppercase;' +
          'letter-spacing:0.06em;color:var(--primary,var(--amber));margin:0 0 1rem;padding-bottom:0.6rem;' +
          'border-bottom:1px solid var(--cream-dark,#ddd);display:flex;align-items:center;gap:8px;}' +
        'body.dark-mode .book-form-section-title{border-bottom-color:var(--border,#444);}' +

        /* Card list items — theme-adaptive */
        '.book-card{background:var(--cream,var(--cream));border:1px solid var(--cream-dark,#ddd);' +
          'border-radius:8px;padding:12px 16px;margin-bottom:8px;cursor:pointer;transition:border-color 0.15s;}' +
        '.book-card:hover{border-color:var(--amber,var(--amber));}' +
        'body.dark-mode .book-card{background:var(--surface-card,#2a2a2a);border-color:var(--border,#444);}' +
        'body.dark-mode .book-card:hover{border-color:var(--amber,var(--amber));}' +

        /* Collapsible sections — detail views */
        '.book-collapse{background:var(--cream,var(--cream));border:1px solid var(--cream-dark,#ddd);' +
          'border-radius:12px;margin-bottom:1.25rem;overflow:hidden;}' +
        'body.dark-mode .book-collapse{background:var(--surface-card,#2a2a2a);border-color:var(--border,#444);}' +
        '.book-collapse-header{display:flex;justify-content:space-between;align-items:center;' +
          'padding:1rem 1.5rem;cursor:pointer;user-select:none;}' +
        '.book-collapse-header:hover{opacity:0.85;}' +
        '.book-collapse-title{display:flex;align-items:center;gap:8px;font-size:0.78rem;font-weight:700;' +
          'text-transform:uppercase;letter-spacing:0.06em;color:var(--primary,var(--amber));margin:0;}' +
        '.book-collapse-arrow{font-size:0.72rem;color:var(--warm-gray,#888);transition:transform 0.15s;}' +
        '.book-collapse-right{display:flex;align-items:center;gap:8px;}' +
        '.book-collapse-body{padding:0 1.5rem 1.25rem;}' +
        '.book-collapse.collapsed .book-collapse-body{display:none;}' +
        '.book-collapse.collapsed .book-collapse-arrow{transform:rotate(-90deg);}' +

        /* Session lifecycle stepper */
        '.book-stepper{display:flex;align-items:center;gap:0;margin-bottom:1.5rem;overflow-x:auto;}' +
        '.book-step{display:flex;align-items:center;gap:8px;padding:8px 16px;font-size:0.78rem;font-weight:600;' +
          'color:var(--warm-gray,#888);cursor:default;white-space:nowrap;position:relative;}' +
        '.book-step.active{color:var(--primary,var(--amber));}' +
        '.book-step.done{color:var(--teal,var(--teal));}' +
        '.book-step-dot{width:24px;height:24px;border-radius:50%;border:2px solid var(--warm-gray,#888);' +
          'display:flex;align-items:center;justify-content:center;font-size:0.72rem;flex-shrink:0;}' +
        '.book-step.active .book-step-dot{border-color:var(--primary,var(--amber));background:var(--primary,var(--amber));color:#fff;}' +
        '.book-step.done .book-step-dot{border-color:var(--teal,var(--teal));background:var(--teal,var(--teal));color:#fff;}' +
        '.book-step-line{width:32px;height:2px;background:var(--warm-gray,#888);flex-shrink:0;}' +
        '.book-step-line.done{background:var(--teal,var(--teal));}' +

        /* Field hint text */
        '.book-field-hint{font-size:0.72rem;color:var(--warm-gray,#888);margin-top:4px;line-height:1.4;}' +

        /* Required marker */
        '.book-required{color:' + DANGER_COLOR + ';margin-left:2px;}' +

        /* Form field group — consistent spacing */
        '.book-field{margin-bottom:1rem;}' +
        '.book-field:last-child{margin-bottom:0;}' +

        /* Checkbox / radio styling */
        '.book-check{display:inline-flex;align-items:center;gap:6px;cursor:pointer;font-size:0.9rem;color:var(--text,#e0e0e0);}' +
        '.book-check input[type="checkbox"],.book-check input[type="radio"]{' +
          'width:18px;height:18px;accent-color:var(--primary,var(--amber));cursor:pointer;}' +

        /* Form action buttons area */
        '.book-form-actions{display:flex;gap:10px;margin-top:1.5rem;padding-top:1.25rem;border-top:1px solid var(--cream-dark,#ddd);}' +
        'body.dark-mode .book-form-actions{border-top-color:var(--border,#444);}' +

        /* Day-of-week pill selector */
        '.book-day-pills{display:flex;flex-wrap:wrap;gap:6px;}' +
        '.book-day-pill{display:inline-flex;align-items:center;gap:4px;padding:6px 12px;border-radius:20px;' +
          'border:1px solid var(--border,#444);background:transparent;color:var(--text,#e0e0e0);' +
          'font-size:0.78rem;cursor:pointer;transition:all 0.2s;}' +
        '.book-day-pill:has(input:checked){background:var(--primary,var(--amber));color:#fff;border-color:var(--primary,var(--amber));}' +
        '.book-day-pill input{display:none;}' +

        /* Override for schedule radio */
        '.book-sched-toggle{display:flex;gap:0;border:1px solid var(--border,#444);border-radius:8px;overflow:hidden;}' +
        '.book-sched-toggle label{padding:8px 20px;cursor:pointer;font-size:0.85rem;color:var(--text,#e0e0e0);' +
          'transition:all 0.2s;border-right:1px solid var(--border,#444);}' +
        '.book-sched-toggle label:last-child{border-right:none;}' +
        '.book-sched-toggle label:has(input:checked){background:var(--primary,var(--amber));color:#fff;}' +
        '.book-sched-toggle input{display:none;}' +

        '';
      document.head.appendChild(style);
    }
  })();

  function esc(s) { return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

  function formatDate(d) {
    if (!d) return '';
    var parts = d.split('-');
    return parts[1] + '/' + parts[2] + '/' + parts[0];
  }

  function formatTime(t) {
    if (!t) return '';
    var parts = t.split(':');
    var h = parseInt(parts[0], 10);
    var m = parts[1];
    var ampm = h >= 12 ? 'PM' : 'AM';
    if (h > 12) h -= 12;
    if (h === 0) h = 12;
    return h + ':' + m + ' ' + ampm;
  }

  function formatPrice(cents) {
    if (typeof cents !== 'number') return '$0.00';
    return '$' + MastFormat.moneyRaw(cents, { cents: true });
  }

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  // ── Collapsible section builder (detail views) ──
  function bookCollapsibleSection(id, title, contentHtml, opts) {
    opts = opts || {};
    var open = opts.open !== false;
    var badge = opts.badge || '';
    var rightHtml = opts.rightHtml || '';
    var cls = 'book-collapse' + (open ? '' : ' collapsed');
    var h = '<div class="' + cls + '" id="bookSec_' + id + '">';
    h += '<div class="book-collapse-header" onclick="window._bookToggleSection(\'' + id + '\')">';
    h += '<div class="book-collapse-title">';
    h += '<span class="book-collapse-arrow">\u25bc</span>';
    h += '<span>' + esc(title) + '</span>';
    if (badge) h += ' ' + badge;
    h += '</div>';
    if (rightHtml) h += '<div class="book-collapse-right" onclick="event.stopPropagation();">' + rightHtml + '</div>';
    h += '</div>';
    h += '<div class="book-collapse-body">' + contentHtml + '</div>';
    h += '</div>';
    return h;
  }

  function bookEmptyState(emoji, title, subtitle) {
    return '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
      '<div style="font-size:1.6rem;margin-bottom:12px;">' + emoji + '</div>' +
      '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">' + esc(title) + '</p>' +
      '<p style="font-size:0.85rem;color:var(--warm-gray-light,var(--warm-gray-light));">' + esc(subtitle) + '</p>' +
      '</div>';
  }

  window._bookToggleSection = function(id) {
    var el = document.getElementById('bookSec_' + id);
    if (el) el.classList.toggle('collapsed');
  };

  // ============================================================
  // Classes — Load & Render
  // ============================================================

  async function loadClasses() {
    try {
      // Ensure skill catalog is available for requiredSkills chips, coverage
      // warnings, and instructor-picker grouping on class form/detail.
      if (!skillCatalogLoaded) await loadSkillCatalog();
      var data = (await MastDB.classes.list(200)) || {};
      classesData = Object.keys(data).map(function(id) {
        var c = data[id];
        c.id = id;
        return c;
      });
      allClassesMap = {};
      classesData.forEach(function(c) { allClassesMap[c.id] = c; });
      classesLoaded = true;
      renderClassList();
    } catch (err) {
      console.error('[Book] Failed to load classes:', err);
      document.getElementById('bookClassesTable').innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">Failed to load classes.</p>';
    }
  }

  function renderClassList() {
    var container = document.getElementById('bookClassesTable');
    if (!container) return;

    // URL-driven filters from MCP admin links: status, category, type, classIds.
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlCategory = (rp && typeof rp.category === 'string') ? rp.category : '';
    var urlType = (rp && typeof rp.type === 'string') ? rp.type : '';
    var urlIdsParam = (rp && typeof rp.classIds === 'string') ? rp.classIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id){urlIdLookup[id]=true;});
    var hasUrlFilter = !!(urlStatus || urlCategory || urlType || urlIds.length);

    var typeFilter = (document.getElementById('bookFilterType') || {}).value || 'all';
    var statusFilter = (document.getElementById('bookFilterStatus') || {}).value || 'active';

    var filtered = classesData.filter(function(c) {
      if (hasUrlFilter) {
        if (urlStatus && c.status !== urlStatus) return false;
        if (urlType && c.type !== urlType) return false;
        if (urlCategory && (c.category || '').toLowerCase() !== urlCategory.toLowerCase()) return false;
        if (urlIdLookup && !urlIdLookup[c.id]) return false;
        return true;
      }
      if (typeFilter !== 'all' && c.type !== typeFilter) return false;
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      return true;
    });

    // URL-filter banner.
    var bannerEl = document.getElementById('classesUrlFilterBanner');
    if (!bannerEl && hasUrlFilter && container.parentNode) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'classesUrlFilterBanner';
      bannerEl.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;';
      container.parentNode.insertBefore(bannerEl, container);
    }
    if (bannerEl) {
      if (hasUrlFilter) {
        var parts = [];
        if (urlIds.length) parts.push(urlIds.length + ' selected class' + (urlIds.length === 1 ? '' : 'es'));
        if (urlStatus) parts.push('status: ' + urlStatus);
        if (urlType) parts.push('type: ' + urlType);
        if (urlCategory) parts.push('category: ' + urlCategory);
        bannerEl.innerHTML = '<span>📚 Showing ' + parts.join(', ') + '</span>' +
          '<button type="button" onclick="clearClassesFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>';
        bannerEl.style.display = 'flex';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    filtered.sort(function(a, b) {
      return (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || '');
    });

    if (filtered.length === 0) {
      container.innerHTML = bookEmptyState('\ud83d\udcda', 'No classes yet', 'Click + New Class to create one.');
      return;
    }

    if (typeof window.mastSortRows === 'function') {
      filtered = window.mastSortRows(filtered, _classListSortKey, _classListSortDir, function(row, key) {
        if (!row) return null;
        if (key === 'price') return Number((row.seriesInfo && row.seriesInfo.seriesPriceCents) || row.priceCents) || 0;
        if (key === 'capacity') return Number(row.capacity) || 0;
        return row[key];
      });
    }

    var html = '<table class="data-table"><thead><tr>';
    // D9 — drop the pencil-icon Actions column. Row click → detail view; the
    // detail view's Edit button is the only edit affordance now. Matches the
    // passes/instructors pattern.
    if (typeof window.mastSortableTh === 'function') {
      html +=
        window.mastSortableTh('Name',     'name',     _classListSortKey, _classListSortDir, 'window._classListSort') +
        window.mastSortableTh('Type',     'type',     _classListSortKey, _classListSortDir, 'window._classListSort') +
        '<th>Schedule</th>' +
        window.mastSortableTh('Capacity', 'capacity', _classListSortKey, _classListSortDir, 'window._classListSort') +
        window.mastSortableTh('Price',    'price',    _classListSortKey, _classListSortDir, 'window._classListSort') +
        window.mastSortableTh('Status',   'status',   _classListSortKey, _classListSortDir, 'window._classListSort');
    } else {
      html += '<th>Name</th><th>Type</th><th>Schedule</th><th>Capacity</th><th>Price</th><th>Status</th>';
    }
    html += '</tr></thead><tbody>';

    filtered.forEach(function(c) {
      var schedSummary = '';
      if (c.schedule) {
        if (c.schedule.type === 'recurring' && c.schedule.days) {
          schedSummary = c.schedule.days.map(function(d) { return DAY_LABELS[d] || d; }).join(', ');
          if (c.schedule.startTime) schedSummary += ' ' + formatTime(c.schedule.startTime);
        } else if (c.schedule.type === 'once') {
          schedSummary = formatDate(c.schedule.date || c.schedule.startDate);
          if (c.schedule.startTime) schedSummary += ' ' + formatTime(c.schedule.startTime);
        }
      }

      var priceStr = formatPrice(c.priceCents);
      if (c.type === 'series' && c.seriesInfo && c.seriesInfo.seriesPriceCents) {
        priceStr = formatPrice(c.seriesInfo.seriesPriceCents) + ' (series)';
      }

      html += '<tr style="cursor:pointer;" onclick="window._bookViewClass(\'' + esc(c.id) + '\')">' +
        '<td><strong>' + esc(c.name) + '</strong></td>' +
        '<td><span style="' + badgeStyle(TYPE_BADGE_COLORS, c.type) + '">' + esc(c.type) + '</span></td>' +
        '<td>' + esc(schedSummary) + '</td>' +
        '<td>' + (c.capacity || '—') + '</td>' +
        '<td>' + priceStr + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, c.status) + '">' + esc(c.status) + '</span></td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ============================================================
  // Class Detail View
  // ============================================================

  async function loadClassDetail(classId) {
    selectedClassId = classId;
    hideAllViews();
    document.getElementById('bookDetailView').style.display = '';

    var content = document.getElementById('bookDetailContent');
    content.innerHTML = LOADING_HTML;

    try {
      var cls = await MastDB.classes.get(classId);
      if (!cls) { content.innerHTML = '<p>Class not found.</p>'; return; }
      cls.id = classId;

      // Load sessions for this class
      var sessData = (await MastDB.classSessions.byClass(classId)) || {};
      sessionsData = Object.keys(sessData).map(function(id) {
        var s = sessData[id];
        s.id = id;
        return s;
      }).sort(function(a, b) { return (a.date + a.startTime).localeCompare(b.date + b.startTime); });

      renderClassDetail(cls);
    } catch (err) {
      console.error('[Book] Failed to load class detail:', err);
      content.innerHTML = '<p style="color:' + DANGER_COLOR + ';padding:2rem;">Failed to load class details.</p>';
    }
  }

  function renderClassDetail(cls) {
    var content = document.getElementById('bookDetailContent');
    var schedDesc = '';
    if (cls.schedule) {
      if (cls.schedule.type === 'recurring' && cls.schedule.days) {
        schedDesc = cls.schedule.days.map(function(d) { return DAY_LABELS[d] || d; }).join(', ');
        if (cls.schedule.startTime) schedDesc += ' at ' + formatTime(cls.schedule.startTime);
        if (cls.schedule.startDate) schedDesc += ' from ' + formatDate(cls.schedule.startDate);
        if (cls.schedule.endDate) schedDesc += ' to ' + formatDate(cls.schedule.endDate);
      } else if (cls.schedule.type === 'once') {
        schedDesc = formatDate(cls.schedule.date || cls.schedule.startDate);
        if (cls.schedule.startTime) schedDesc += ' at ' + formatTime(cls.schedule.startTime);
      }
    }

    var html = '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;">' +
      '<div>' +
      '<h2 style="margin:0 0 6px;font-size:1.6rem;">' + esc(cls.name) + '</h2>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
      '<span style="' + badgeStyle(TYPE_BADGE_COLORS, cls.type) + '">' + esc(cls.type) + '</span>' +
      '<span style="' + badgeStyle(STATUS_BADGE_COLORS, cls.status) + '">' + esc(cls.status) + '</span>' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button class="btn btn-primary" onclick="window._bookEditClass(\'' + esc(cls.id) + '\')">Edit</button>' +
      '<button class="btn" onclick="window._bookGenerateSessions(\'' + esc(cls.id) + '\')">Generate Sessions</button>' +
      (cls.status === 'draft' || cls.status === 'active' ? '<button class="btn" style="background:' + SUCCESS_COLOR + ';color:#fff;" onclick="window._bookPublishClass(\'' + esc(cls.id) + '\')">Publish</button>' : '') +
      (cls.status === 'published' ? '<button class="btn" onclick="window._bookUnpublishClass(\'' + esc(cls.id) + '\')">Unpublish</button>' : '') +
      '</div>' +
      '</div>';

    // ── Class Details ──
    var detailsHtml = '<div class="book-responsive-grid">' +
      _detailField('Category', cls.category || '—') +
      _detailField('Duration', (cls.duration || 0) + ' min') +
      _detailField('Capacity', (cls.capacity || '—') + (cls.minEnrollment ? ' (min ' + cls.minEnrollment + ')' : '')) +
      _detailField('Price', formatPrice(cls.priceCents));
    if (cls.type === 'series' && cls.seriesInfo) {
      detailsHtml += _detailField('Series Price', formatPrice(cls.seriesInfo.seriesPriceCents)) +
      _detailField('Sessions', cls.seriesInfo.totalSessions || '—') +
      _detailField('Drop-in OK', cls.seriesInfo.allowDropIn ? 'Yes' : 'No');
    }
    detailsHtml += '</div>';
    html += bookCollapsibleSection('classDetails', 'Class Details', detailsHtml);

    // ── Schedule & Assignment ──
    var schedHtml = '<div class="book-responsive-grid">' +
      _detailField('Schedule', schedDesc || '—') +
      _detailField('Materials', cls.materialsIncluded ? (cls.materialsNote || 'Included') : (cls.materialsCostCents ? formatPrice(cls.materialsCostCents) + ' fee' + (cls.materialsNote ? ' \u2014 ' + esc(cls.materialsNote) : '') : 'Not included')) +
      _detailField('Instructor', cls.instructorName || '—') +
      _detailField('Resource', cls.resourceName || '—') +
      '</div>' + _classDetailReqSkillsBlock(cls);
    schedHtml = _classDetailCoverageBanner(cls) + schedHtml;
    html += bookCollapsibleSection('classSchedule', 'Schedule & Assignment', schedHtml);

    // ── Description ──
    if (cls.description) {
      var descHtml = '<p style="color:var(--warm-gray);line-height:1.6;margin:0;">' + esc(cls.description) + '</p>';
      html += bookCollapsibleSection('classDesc', 'Description', descHtml);
    }

    // ── Sessions table ──
    var sessHtml = '';
    if (sessionsData.length === 0) {
      sessHtml = '<p style="color:var(--warm-gray);">No sessions generated yet. Click <strong>Generate Sessions</strong> above.</p>';
    } else {
      var today = todayStr();
      sessHtml += '<table class="data-table"><thead><tr><th>Date</th><th>Time</th><th class="book-hide-narrow">Instructor</th><th class="book-hide-narrow">Resource</th><th>Enrolled</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
      sessionsData.forEach(function(s) {
        var isPast = s.date < today;
        var rowStyle = isPast ? 'opacity:0.5;' : '';
        sessHtml += '<tr style="' + rowStyle + '">' +
          '<td>' + formatDate(s.date) + '</td>' +
          '<td>' + formatTime(s.startTime) + ' - ' + formatTime(s.endTime) + '</td>' +
          '<td class="book-hide-narrow">' + esc(s.instructorName || '—') + '</td>' +
          '<td class="book-hide-narrow">' + esc(s.resourceName || '—') + '</td>' +
          '<td>' + (s.enrolled || 0) + ' / ' + (s.capacity || cls.capacity || '—') + (s.waitlisted ? ' (+' + s.waitlisted + ' waitlisted)' : '') + '</td>' +
          '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, s.status) + '">' + esc(s.status) + '</span></td>' +
          '<td><div class="event-actions">' +
          '<button class="btn-icon" onclick="window._bookAssignSession(\'' + esc(s.id) + '\',\'' + esc(cls.id) + '\')" title="Assign Instructor/Resource">&#128100;</button>' +
          '<button class="btn-icon" onclick="window._bookManageSession(\'' + esc(s.id) + '\',\'' + esc(cls.id) + '\')" title="Manage Session">&#128203;</button>';
        if (s.status === 'scheduled' && !isPast) {
          sessHtml += '<button class="btn-icon danger" onclick="window._bookCancelSession(\'' + esc(s.id) + '\')" title="Cancel Session">&#10006;</button>';
        }
        sessHtml += '</div></td></tr>';
      });
      sessHtml += '</tbody></table>';
    }
    var sessBadge = '<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:rgba(196,133,60,0.15);color:var(--amber);">' + sessionsData.length + '</span>';
    html += bookCollapsibleSection('classSessions', 'Sessions', sessHtml, { badge: sessBadge });

    content.innerHTML = html;
  }

  function _detailField(label, value) {
    return '<div style="margin-bottom:0.75rem;">' +
      '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:4px;">' + esc(label) + '</div>' +
      '<div style="font-size:0.9rem;color:var(--text);">' + esc(String(value)) + '</div></div>';
  }

  function _infoCard(label, value) {
    return '<div style="background:var(--surface-dark);border-radius:8px;padding:12px 16px;">' +
      '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:4px;">' + esc(label) + '</div>' +
      '<div style="font-size:0.9rem;color:var(--on-dark);">' + esc(String(value)) + '</div></div>';
  }

  // ============================================================
  // Class Create / Edit
  // ============================================================

  async function showClassForm(classId) {
    var cls = classId ? classesData.find(function(c) { return c.id === classId; }) : null;
    var isNew = !cls;

    // Ensure instructors/resources loaded for dropdowns
    if (!instructorsLoaded) await loadInstructors();
    if (!resourcesLoaded) await loadResources();
    // Cert types for the "Required certifications" multi-select.
    var _certTypesForClassForm = {};
    try { _certTypesForClassForm = (await MastDB.get('admin/certTypes')) || {}; }
    catch (_e) { _certTypesForClassForm = {}; }

    // Check if sessions exist (locks Type field on edit)
    var hasSessions = false;
    if (classId) {
      var sessVal = await MastDB.classSessions.byClass(classId);
      hasSessions = sessVal && Object.keys(sessVal).length > 0;
    }

    hideAllViews();
    document.getElementById('bookDetailView').style.display = '';

    var content = document.getElementById('bookDetailContent');
    var sched = (cls && cls.schedule) || {};
    var series = (cls && cls.seriesInfo) || {};

    var daysHtml = '<div class="book-day-pills">' + DAYS_OF_WEEK.map(function(d) {
      var checked = sched.days && sched.days.indexOf(d) !== -1 ? ' checked' : '';
      return '<label class="book-day-pill"><input type="checkbox" name="schedDays" value="' + d + '"' + checked + '>' + DAY_LABELS[d] + '</label>';
    }).join('') + '</div>';

    var typeLocked = !isNew && hasSessions;
    var typeOptions = CLASS_TYPES.map(function(t) {
      return '<option value="' + t + '"' + (cls && cls.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    }).join('');

    var statusOptions = CLASS_STATUSES.map(function(s) {
      return '<option value="' + s + '"' + (cls && cls.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    var schedTypeOnce = sched.type === 'once' ? ' checked' : '';
    var schedTypeRecurring = sched.type === 'recurring' || !sched.type ? ' checked' : '';

    // Initialize image state from existing class (single image — first imageIds entry)
    editingClassImageUrl = (cls && Array.isArray(cls.imageIds) && cls.imageIds.length > 0) ? cls.imageIds[0] : null;

    var html = '<h2 style="margin:0 0 1.5rem;font-size:1.6rem;">' + (isNew ? 'New Class' : 'Edit: ' + esc(cls.name)) + '</h2>' +
      '<form id="bookClassForm" onsubmit="return false;" style="max-width:720px;">' +

      // ── Basic Info ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Basic Info</div>' +
      '<div class="book-field"><label class="form-label">Name <span class="book-required">*</span></label>' +
      '<input type="text" id="bcfName" class="form-input" value="' + esc(cls ? cls.name : '') + '" required placeholder="e.g. Wheel Throwing Basics"></div>' +
      '<div class="book-field"><label class="form-label">Description</label>' +
      '<textarea id="bcfDesc" class="form-input" rows="3" placeholder="Class description for students...">' + esc(cls ? cls.description : '') + '</textarea></div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Type <span class="book-required">*</span></label><select id="bcfType" class="form-input"' + (typeLocked ? ' disabled' : '') + ' onchange="window._bookToggleSeriesFields()">' + typeOptions + '</select>' +
      (typeLocked ? '<div class="book-field-hint">Type cannot be changed after sessions are generated</div>' : '') + '</div>' +
      '<div class="book-field"><label class="form-label">Category</label><input type="text" id="bcfCategory" class="form-input" value="' + esc(cls ? cls.category : '') + '" placeholder="e.g. Pottery, Glass"></div>' +
      '<div class="book-field"><label class="form-label">Status</label><select id="bcfStatus" class="form-input">' + statusOptions + '</select></div>' +
      '</div></div>' +

      // ── Pricing & Capacity ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Pricing &amp; Capacity</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Capacity <span class="book-required">*</span></label><input type="number" id="bcfCapacity" class="form-input" min="1" value="' + (cls ? cls.capacity || '' : '') + '" required></div>' +
      '<div class="book-field"><label class="form-label">Drop-in Price ($) <span class="book-required">*</span></label><input type="number" id="bcfPrice" class="form-input" min="0" step="0.01" value="' + (cls ? MastFormat.moneyRaw(cls.priceCents, { cents: true }) : '') + '" required></div>' +
      '<div class="book-field"><label class="form-label">Duration (min) <span class="book-required">*</span></label><input type="number" id="bcfDuration" class="form-input" min="1" value="' + (cls ? cls.duration || '' : '') + '" required></div>' +
      '</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Min Enrollment</label><input type="number" id="bcfMinEnroll" class="form-input" min="0" value="' + (cls && cls.minEnrollment ? cls.minEnrollment : '') + '" placeholder="Optional">' +
      '<div class="book-field-hint">Minimum students needed to run the session</div></div>' +
      '<div class="book-field"><label class="form-label">Cancel Lead Days</label><input type="number" id="bcfCancelLead" class="form-input" min="0" max="30" value="' + (cls && cls.cancellationLeadDays ? cls.cancellationLeadDays : '2') + '">' +
      '<div class="book-field-hint">Days before session to check minimum enrollment</div></div>' +
      '</div></div>' +

      // ── Schedule ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Schedule</div>' +
      '<div class="book-field" style="margin-bottom:1.25rem;">' +
      '<div class="book-sched-toggle">' +
      '<label><input type="radio" name="schedType" value="recurring"' + schedTypeRecurring + ' onchange="window._bookToggleSchedType()">Recurring</label>' +
      '<label><input type="radio" name="schedType" value="once"' + schedTypeOnce + ' onchange="window._bookToggleSchedType()">One-time</label>' +
      '</div></div>' +
      '<div id="bcfSchedRecurring">' +
      '<div class="book-field"><label class="form-label">Days of Week</label>' + daysHtml + '</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Start Time</label><input type="time" id="bcfStartTime" class="form-input" value="' + esc(sched.startTime || '') + '"></div>' +
      '<div class="book-field"><label class="form-label">Start Date</label><input type="date" id="bcfStartDate" class="form-input" value="' + esc(sched.startDate || '') + '"></div>' +
      '<div class="book-field"><label class="form-label">End Date</label><input type="date" id="bcfEndDate" class="form-input" value="' + esc(sched.endDate || '') + '">' +
      '<div class="book-field-hint">Leave blank to auto-generate 8 weeks</div></div>' +
      '</div></div>' +
      '<div id="bcfSchedOnce" style="display:none;">' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Date</label><input type="date" id="bcfOnceDate" class="form-input" value="' + esc(sched.date || sched.startDate || '') + '"></div>' +
      '<div class="book-field"><label class="form-label">Time</label><input type="time" id="bcfOnceTime" class="form-input" value="' + esc(sched.startTime || '') + '"></div>' +
      '</div></div>' +
      '</div>' +

      // ── Series Details (conditional) ──
      '<div id="bcfSeriesFields" class="book-form-section" style="' + (cls && cls.type === 'series' ? '' : 'display:none;') + '">' +
      '<div class="book-form-section-title">Series Details</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Total Sessions</label><input type="number" id="bcfSeriesTotal" class="form-input" min="1" value="' + (series.totalSessions || '') + '"></div>' +
      '<div class="book-field"><label class="form-label">Series Price ($)</label><input type="number" id="bcfSeriesPrice" class="form-input" min="0" step="0.01" value="' + (series.seriesPriceCents ? MastFormat.moneyRaw(series.seriesPriceCents, { cents: true }) : '') + '"></div>' +
      '<div class="book-field"><label class="form-label">Allow Drop-in</label><select id="bcfSeriesDropin" class="form-input"><option value="true"' + (series.allowDropIn !== false ? ' selected' : '') + '>Yes</option><option value="false"' + (series.allowDropIn === false ? ' selected' : '') + '>No</option></select></div>' +
      '<div class="book-field"><label class="form-label">Allow Late Enroll</label><select id="bcfSeriesLateEnroll" class="form-input"><option value="false"' + (series.allowLateEnroll !== true ? ' selected' : '') + '>No</option><option value="true"' + (series.allowLateEnroll === true ? ' selected' : '') + '>Yes</option></select></div>' +
      '</div></div>' +

      // ── Materials ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Materials</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Materials Included</label><select id="bcfMaterials" class="form-input" onchange="window._bookToggleMaterialsCost()"><option value="false"' + (cls && cls.materialsIncluded ? '' : ' selected') + '>No</option><option value="true"' + (cls && cls.materialsIncluded ? ' selected' : '') + '>Yes</option></select></div>' +
      '<div class="book-field" id="bcfMaterialsCostWrap" style="' + (cls && cls.materialsIncluded ? 'display:none;' : '') + '"><label class="form-label">Materials Cost ($)</label><input type="number" id="bcfMaterialsCost" class="form-input" min="0" step="0.01" value="' + (cls && cls.materialsCostCents ? MastFormat.moneyRaw(cls.materialsCostCents, { cents: true }) : '') + '" placeholder="0.00">' +
      '<div class="book-field-hint">Added as separate line item at checkout</div></div>' +
      '<div class="book-field"><label class="form-label">Materials Note</label><input type="text" id="bcfMaterialsNote" class="form-input" value="' + esc(cls ? cls.materialsNote : '') + '" placeholder="e.g. 25lbs of clay + glazes"></div>' +
      '</div></div>' +

      // ── Policies ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Policies</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Requires Waiver</label><select id="bcfRequiresWaiver" class="form-input" onchange="window._bookToggleWaiverTemplate()"><option value="false"' + (cls && cls.requiresWaiver ? '' : ' selected') + '>No</option><option value="true"' + (cls && cls.requiresWaiver ? ' selected' : '') + '>Yes</option></select>' +
      '<div class="book-field-hint">Students must sign a waiver before class</div></div>' +
      '<div class="book-field" id="bcfWaiverTemplateWrap" style="' + (cls && cls.requiresWaiver ? '' : 'display:none;') + '"><label class="form-label">Waiver Template</label><select id="bcfWaiverTemplate" class="form-input" data-current="' + esc(cls && cls.waiverTemplateId ? cls.waiverTemplateId : '') + '"><option value="">Loading...</option></select>' +
      '<div class="book-field-hint">Which waiver students must sign</div></div>' +
      '<div class="book-field"><label class="form-label">Enrollment Opens</label><input type="date" id="bcfEnrollOpen" class="form-input" value="' + esc(cls && cls.enrollmentOpenDate ? cls.enrollmentOpenDate : '') + '">' +
      '<div class="book-field-hint">Leave blank for immediately open</div></div>' +
      '<div class="book-field"><label class="form-label">Enrollment Closes</label><input type="date" id="bcfEnrollClose" class="form-input" value="' + esc(cls && cls.enrollmentCloseDate ? cls.enrollmentCloseDate : '') + '">' +
      '<div class="book-field-hint">Leave blank for no cutoff</div></div>' +
      '</div>' +
      // ── Required certifications (Phase 2B gating) ──
      '<div class="book-field" style="margin-top:12px;">' +
        '<label class="form-label">Required certifications</label>' +
        '<div id="bcfRequiredCertsWrap" style="border:1px solid var(--cream-dark);border-radius:6px;padding:8px;max-height:160px;overflow-y:auto;">' +
          (function() {
            var existing = {};
            if (cls && Array.isArray(cls.requiredCertTypeIds)) cls.requiredCertTypeIds.forEach(function(tid) { existing[tid] = true; });
            var typeIds = Object.keys(_certTypesForClassForm).filter(function(tid) { return !_certTypesForClassForm[tid].archivedAt; });
            if (!typeIds.length) return '<div style="color:var(--warm-gray);font-size:0.85rem;">No cert types defined. Add one at Book → Settings → Certification Types.</div>';
            return typeIds.map(function(tid) {
              var t = _certTypesForClassForm[tid];
              return '<label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.85rem;">' +
                '<input type="checkbox" name="bcfRequiredCert" value="' + esc(tid) + '"' + (existing[tid] ? ' checked' : '') + '> ' + esc(t.name || tid) +
              '</label>';
            }).join('');
          })() +
        '</div>' +
        '<div class="book-field-hint">Students must hold all checked certifications to enroll. Leave empty to allow any student.</div>' +
      '</div>' +
      '</div>' +

      // ── Assignment ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Assignment</div>' +
      '<div class="book-field"><label class="form-label">Required skills</label>' +
      renderSkillPickerHtml('clsReqSkillPicker', (cls && Array.isArray(cls.requiredSkills)) ? cls.requiredSkills : [], 'Add new skill — e.g. Wheel Throwing') +
      '<div id="clsCoverageWarning" style="margin-top:6px;"></div>' +
      '<div class="book-field-hint">Instructors that have all of these checked are grouped first in the Instructor list below. Leave empty if no specific skill is required.</div></div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Instructor</label>' +
      '<div id="bcfInstructorWrap">' + _renderClassInstructorSelect(cls && cls.instructorId ? cls.instructorId : '', (cls && Array.isArray(cls.requiredSkills)) ? cls.requiredSkills : []) + '</div>' +
      '<div id="bcfInstructorSelectionWarning" style="margin-top:6px;"></div>' +
      '</div>' +
      '<div class="book-field"><label class="form-label">Resource</label><select id="bcfResource" class="form-input">' +
      '<option value="">None</option>' +
      resourcesData.filter(function(r) { return r.status === 'active'; }).map(function(r) {
        return '<option value="' + esc(r.id) + '"' + (cls && cls.resourceId === r.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.type) + ')</option>';
      }).join('') +
      '</select></div>' +
      '</div></div>' +

      // ── Class Image ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Class Image</div>' +
      '<div id="bcfImagePreviewWrap">' + _renderClassImagePreview() + '</div>' +
      '<div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button type="button" class="btn btn-secondary" style="font-size:0.78rem;" onclick="window._bookSelectClassImage()">Select from Library</button>' +
        '<label class="btn btn-secondary" style="font-size:0.78rem;cursor:pointer;">' +
          '<input type="file" accept="image/*" style="display:none;" onchange="window._bookUploadClassImage(this)">' +
          'Upload New' +
        '</label>' +
      '</div>' +
      '</div>' +

      // ── Actions ──
      '<div class="book-form-actions">' +
      '<button class="btn btn-primary" onclick="window._bookSaveClass(\'' + (classId || '') + '\')">Save Class</button>' +
      // When editing an existing class, Cancel returns to that class's detail
      // (so the user lands where they came from). Creating a new class still
      // returns to the list since there is no detail to go back to.
      (classId
        ? '<button class="btn" onclick="window._bookViewClass(\'' + classId + '\')">Cancel</button>'
        : '<button class="btn" onclick="window._bookBackToList()">Cancel</button>') +
      '</div>' +
      '</form>';

    content.innerHTML = html;

    // Toggle schedule type visibility
    window._bookToggleSchedType();
    // Load waiver templates if waiver is required
    if (cls && cls.requiresWaiver) _bookLoadWaiverTemplateOptions();

    // Initialize the requiredSkills picker. onChange re-renders the instructor
    // <select> grouping + the coverage warning so the operator sees impact live.
    initSkillPicker('clsReqSkillPicker', {
      initialSlugs: (cls && Array.isArray(cls.requiredSkills)) ? cls.requiredSkills : [],
      firstUsedBy: 'class',
      onChange: _refreshClassFormAssignment
    });
    _refreshClassFormAssignment();
  }

  // ============================================================
  // Save Class + Session Materialization
  // ============================================================

  async function saveClass(classId) {
    var name = document.getElementById('bcfName').value.trim();
    if (!name) { MastAdmin.showToast('Name is required', true); return; }

    var priceDollars = parseFloat(document.getElementById('bcfPrice').value);
    if (isNaN(priceDollars)) { MastAdmin.showToast('Price is required', true); return; }

    var type = document.getElementById('bcfType').value;
    var schedType = document.querySelector('input[name="schedType"]:checked').value;

    var schedule = { type: schedType };
    if (schedType === 'recurring') {
      var dayCheckboxes = document.querySelectorAll('input[name="schedDays"]:checked');
      schedule.days = Array.from(dayCheckboxes).map(function(cb) { return cb.value; });
      schedule.startTime = document.getElementById('bcfStartTime').value;
      schedule.startDate = document.getElementById('bcfStartDate').value;
      schedule.endDate = document.getElementById('bcfEndDate').value || null;
    } else {
      schedule.date = document.getElementById('bcfOnceDate').value;
      schedule.startTime = document.getElementById('bcfOnceTime').value;
      schedule.startDate = document.getElementById('bcfOnceDate').value;
    }

    // If Type field is disabled (sessions exist), preserve existing type
    var typeEl = document.getElementById('bcfType');
    if (typeEl.disabled && classId) {
      var existing = classesData.find(function(c) { return c.id === classId; });
      if (existing) type = existing.type;
    }

    var data = {
      name: name,
      description: document.getElementById('bcfDesc').value.trim(),
      type: type,
      category: document.getElementById('bcfCategory').value.trim().toLowerCase(),
      status: document.getElementById('bcfStatus').value,
      capacity: parseInt(document.getElementById('bcfCapacity').value, 10) || 8,
      minEnrollment: parseInt(document.getElementById('bcfMinEnroll').value, 10) || null,
      cancellationLeadDays: parseInt(document.getElementById('bcfCancelLead').value, 10) || 2,
      priceCents: Math.round(priceDollars * 100),
      duration: parseInt(document.getElementById('bcfDuration').value, 10) || 60,
      schedule: schedule,
      materialsIncluded: document.getElementById('bcfMaterials').value === 'true',
      materialsCostCents: document.getElementById('bcfMaterials').value === 'true' ? null : (function() { var v = parseFloat(document.getElementById('bcfMaterialsCost').value); return isNaN(v) || v <= 0 ? null : Math.round(v * 100); })(),
      materialsNote: document.getElementById('bcfMaterialsNote').value.trim() || null,
      requiresWaiver: document.getElementById('bcfRequiresWaiver').value === 'true',
      waiverTemplateId: document.getElementById('bcfRequiresWaiver').value === 'true' ? (document.getElementById('bcfWaiverTemplate') || {}).value || null : null,
      enrollmentOpenDate: document.getElementById('bcfEnrollOpen').value || null,
      enrollmentCloseDate: document.getElementById('bcfEnrollClose').value || null,
      imageIds: editingClassImageUrl ? [editingClassImageUrl] : [],
      updatedAt: new Date().toISOString()
    };

    // Assignment fields
    var instrId = document.getElementById('bcfInstructor').value || null;
    var resId = document.getElementById('bcfResource').value || null;
    data.instructorId = instrId;
    data.instructorName = instrId && instructorsMap[instrId] ? instructorsMap[instrId].name : null;
    data.resourceId = resId;
    data.resourceName = resId && resourcesMap[resId] ? resourcesMap[resId].name : null;
    data.requiredSkills = getSkillPickerSlugs('clsReqSkillPicker');

    // Phase 2B — required certifications for booking eligibility.
    var requiredCertTypeIds = [];
    document.querySelectorAll('input[name="bcfRequiredCert"]:checked').forEach(function(el) {
      requiredCertTypeIds.push(el.value);
    });
    data.requiredCertTypeIds = requiredCertTypeIds;

    // Series info
    if (type === 'series') {
      var seriesPrice = parseFloat(document.getElementById('bcfSeriesPrice').value);
      data.seriesInfo = {
        totalSessions: parseInt(document.getElementById('bcfSeriesTotal').value, 10) || null,
        seriesPriceCents: isNaN(seriesPrice) ? null : Math.round(seriesPrice * 100),
        allowDropIn: document.getElementById('bcfSeriesDropin').value === 'true',
        allowLateEnroll: document.getElementById('bcfSeriesLateEnroll').value === 'true'
      };
    } else {
      data.seriesInfo = null;
    }

    try {
      var isNew = !classId;
      if (isNew) {
        classId = MastDB.classes.newKey();
        data.createdAt = data.updatedAt;
        await MastDB.classes.set(classId, data);
      } else {
        // PATCH-style write: only fields the form owns. Preserves server-only
        // fields (createdAt, publishedAt, etc.) that this form does not render.
        await MastDB.classes.update(classId, data);
      }
      MastAdmin.showToast(isNew ? 'Class created!' : 'Class updated!');

      // Auto-generate sessions
      await materializeSessions(classId, data);

      classesLoaded = false;
      await loadClasses();
      switchSubTab('classes');
    } catch (err) {
      console.error('[Book] Save failed:', err);
      MastAdmin.showToast('Save failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Session Materialization
  // ============================================================

  async function materializeSessions(classId, cls) {
    if (!cls.schedule) return;

    // Fetch existing sessions to avoid duplicates
    var existing = (await MastDB.classSessions.byClass(classId)) || {};
    var existingDates = {};
    Object.values(existing).forEach(function(s) {
      existingDates[s.date + '_' + s.startTime] = true;
    });

    var sessionsToCreate = [];
    var duration = cls.duration || 60;
    var capacity = cls.capacity || 8;

    if (cls.schedule.type === 'once') {
      var date = cls.schedule.date || cls.schedule.startDate;
      var time = cls.schedule.startTime;
      if (date && time && !existingDates[date + '_' + time]) {
        sessionsToCreate.push({ date: date, startTime: time });
      }
    } else if (cls.schedule.type === 'recurring' && cls.schedule.days && cls.schedule.days.length > 0) {
      var startDate = cls.schedule.startDate ? new Date(cls.schedule.startDate + 'T00:00:00') : new Date();
      var endDate;
      if (cls.schedule.endDate) {
        endDate = new Date(cls.schedule.endDate + 'T23:59:59');
      } else {
        // Generate 8 weeks out from start
        endDate = new Date(startDate.getTime());
        endDate.setDate(endDate.getDate() + 56);
      }

      var dayMap = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
      var targetDays = cls.schedule.days.map(function(d) { return dayMap[d]; }).filter(function(d) { return d !== undefined; });

      var cursor = new Date(startDate.getTime());
      while (cursor <= endDate) {
        if (targetDays.indexOf(cursor.getDay()) !== -1) {
          var dateStr = cursor.getFullYear() + '-' +
            String(cursor.getMonth() + 1).padStart(2, '0') + '-' +
            String(cursor.getDate()).padStart(2, '0');
          var timeStr = cls.schedule.startTime || '09:00';
          if (!existingDates[dateStr + '_' + timeStr]) {
            sessionsToCreate.push({ date: dateStr, startTime: timeStr });
          }
        }
        cursor.setDate(cursor.getDate() + 1);
      }
    }

    if (sessionsToCreate.length === 0) return;

    // Calculate end time
    function calcEndTime(startTime, durationMin) {
      var parts = startTime.split(':');
      var totalMin = parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10) + durationMin;
      var h = Math.floor(totalMin / 60) % 24;
      var m = totalMin % 60;
      return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
    }

    // Batch write
    var updates = {};
    sessionsToCreate.forEach(function(s) {
      var sessionId = MastDB.classSessions.newKey();
      updates[sessionId] = {
        classId: classId,
        date: s.date,
        startTime: s.startTime,
        endTime: calcEndTime(s.startTime, duration),
        capacity: capacity,
        enrolled: 0,
        waitlisted: 0,
        status: 'scheduled',
        instructorId: cls.instructorId || null,
        instructorName: cls.instructorName || null,
        resourceId: cls.resourceId || null,
        resourceName: cls.resourceName || null,
        materialsCostCents: cls.materialsCostCents || null,
        materialsIncluded: cls.materialsIncluded || false,
        materialsNote: cls.materialsNote || null,
        cancelReason: null,
        notes: null,
        createdAt: new Date().toISOString()
      };
    });

    // Write each session under public/classSessions. Per-doc writes — the old
    // RTDB-style root multi-path update ({path/id: data} via MastDB.update(''))
    // throws "path requires doc ID: _root" on Firestore MastDB, so generation
    // had been silently dead since the migration (caught by the classes-v2
    // walk, 2026-06-10).
    var newIds = Object.keys(updates);
    for (var wi = 0; wi < newIds.length; wi++) {
      await MastDB.classSessions.set(newIds[wi], updates[newIds[wi]]);
    }
    MastAdmin.showToast(sessionsToCreate.length + ' session(s) generated');
  }

  // ============================================================
  // Session Actions
  // ============================================================

  // State-free session-op cores — shared by the legacy buttons and
  // window.SessionsBridge (the sessions-v2 / calendar-v2 schedule surface).
  // NO confirm dialog, NO toast, NO view refresh (callers own their UI).
  async function _sessionCancelCore(sessionId, reason) {
    await MastDB.classSessions.update(sessionId, { status: 'cancelled', cancelReason: reason || 'Admin cancelled' });
  }
  async function _sessionCompleteCore(sessionId) {
    await MastDB.classSessions.update(sessionId, { status: 'completed' });
  }

  async function cancelSession(sessionId) {
    if (!await mastConfirm('Cancel this session? Students will need to be notified.', { title: 'Cancel Session', danger: true })) return;
    try {
      await _sessionCancelCore(sessionId);
      MastAdmin.showToast('Session cancelled');
      if (selectedClassId) loadClassDetail(selectedClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  }

  async function completeSession(sessionId) {
    try {
      await _sessionCompleteCore(sessionId);
      MastAdmin.showToast('Session marked complete');
      if (selectedClassId) loadClassDetail(selectedClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  }

  // ── SessionsBridge — additive shim for the sessions-v2 / calendar-v2
  // schedule surface. Same contract as EnrollmentsBridge: state-free cores,
  // caller owns confirm/toast/refresh.
  window.SessionsBridge = {
    cancel: function (id, reason) { return _sessionCancelCore(id, reason); },
    complete: function (id) { return _sessionCompleteCore(id); }
  };

  // ============================================================
  // Enrollments
  // ============================================================

  async function loadEnrollments(sessionFilter, classFilter) {
    hideAllViews();
    document.getElementById('bookEnrollmentsView').style.display = '';

    var table = document.getElementById('bookEnrollmentsTable');
    table.innerHTML = LOADING_HTML;

    // Populate class filter dropdown and sessions map
    if (!classesLoaded) await loadClasses();
    if (!Object.keys(allSessionsMap).length) {
      try {
        var sessObj = (await MastDB.classSessions.list(1000)) || {};
        Object.keys(sessObj).forEach(function(id) { allSessionsMap[id] = sessObj[id]; });
      } catch (e) { console.warn('[Book] Could not load sessions map:', e); }
    }
    var classSelect = document.getElementById('enrollFilterClass');
    if (classSelect) {
      var opts = '<option value="all">All Classes</option>';
      classesData.forEach(function(c) {
        opts += '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
      });
      classSelect.innerHTML = opts;
      if (classFilter) classSelect.value = classFilter;
    }

    try {
      var snap;
      if (sessionFilter) {
        snap = await MastDB.enrollments.bySession(sessionFilter);
      } else if (classFilter && classFilter !== 'all') {
        snap = await MastDB.enrollments.byClass(classFilter);
      } else {
        snap = await MastDB.enrollments.list(500);
      }

      var data = snap.val() || {};
      enrollmentsData = Object.keys(data).map(function(id) {
        var e = data[id];
        e.id = id;
        return e;
      });
      enrollmentsLoaded = true;
      renderEnrollmentList();
    } catch (err) {
      console.error('[Book] Failed to load enrollments:', err);
      table.innerHTML = '<p style="color:' + DANGER_COLOR + ';">Failed to load enrollments.</p>';
    }
  }

  function renderEnrollmentList() {
    var table = document.getElementById('bookEnrollmentsTable');
    if (!table) return;

    // CQ1Urw — when an enrollment is selected, render the read-only detail
    // view in the same container instead of the list table.
    if (_enrollViewId) {
      var enr = enrollmentsData.find(function(x) { return x.id === _enrollViewId; });
      if (!enr) { _enrollViewId = null; /* fall through */ }
      else { table.innerHTML = _renderEnrollmentDetailView(enr); return; }
    }

    // URL-driven filters from MCP admin links: status, classId, sessionId, dateFrom, dateTo, enrollmentIds.
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlClassId = (rp && typeof rp.classId === 'string') ? rp.classId : '';
    var urlSessionId = (rp && typeof rp.sessionId === 'string') ? rp.sessionId : '';
    var urlDateFrom = (rp && typeof rp.dateFrom === 'string') ? rp.dateFrom.slice(0, 10) : '';
    var urlDateTo = (rp && typeof rp.dateTo === 'string') ? rp.dateTo.slice(0, 10) : '';
    var urlIdsParam = (rp && typeof rp.enrollmentIds === 'string') ? rp.enrollmentIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s){return s.trim();}).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id){urlIdLookup[id]=true;});
    var hasUrlFilter = !!(urlStatus || urlClassId || urlSessionId || urlDateFrom || urlDateTo || urlIds.length);

    var statusFilter = (document.getElementById('enrollFilterStatus') || {}).value || 'all';
    var classFilter = (document.getElementById('enrollFilterClass') || {}).value || 'all';

    var filtered = enrollmentsData.filter(function(e) {
      if (hasUrlFilter) {
        if (urlStatus && e.status !== urlStatus) return false;
        if (urlClassId && e.classId !== urlClassId) return false;
        if (urlSessionId && e.sessionId !== urlSessionId) return false;
        if (urlIdLookup && !urlIdLookup[e.id]) return false;
        if (urlDateFrom || urlDateTo) {
          var iso = e.enrolledAt || '';
          if (!iso) return false;
          var d = iso.slice(0, 10);
          if (urlDateFrom && d < urlDateFrom) return false;
          if (urlDateTo && d > urlDateTo) return false;
        }
        return true;
      }
      if (statusFilter !== 'all' && e.status !== statusFilter) return false;
      if (classFilter !== 'all' && e.classId !== classFilter) return false;
      return true;
    });

    // URL-filter banner.
    var bannerEl = document.getElementById('enrollmentsUrlFilterBanner');
    if (!bannerEl && hasUrlFilter && table.parentNode) {
      bannerEl = document.createElement('div');
      bannerEl.id = 'enrollmentsUrlFilterBanner';
      bannerEl.style.cssText = 'background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;';
      table.parentNode.insertBefore(bannerEl, table);
    }
    if (bannerEl) {
      if (hasUrlFilter) {
        var parts = [];
        if (urlIds.length) parts.push(urlIds.length + ' selected enrollment' + (urlIds.length === 1 ? '' : 's'));
        if (urlStatus) parts.push('status: ' + urlStatus);
        if (urlClassId) parts.push('class: ' + urlClassId);
        if (urlSessionId) parts.push('session: ' + urlSessionId);
        if (urlDateFrom && urlDateTo) parts.push('from ' + urlDateFrom + ' to ' + urlDateTo);
        else if (urlDateFrom) parts.push('from ' + urlDateFrom + ' onward');
        else if (urlDateTo) parts.push('through ' + urlDateTo);
        bannerEl.innerHTML = '<span>🎓 Showing ' + parts.join(', ') + '</span>' +
          '<button type="button" onclick="clearEnrollmentsFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>';
        bannerEl.style.display = 'flex';
      } else {
        bannerEl.style.display = 'none';
      }
    }

    if (typeof window.mastSortRows === 'function') {
      filtered = window.mastSortRows(filtered, _enrollSortKey, _enrollSortDir, function(row, key) {
        if (!row) return null;
        if (key === 'student') return row.studentName || row.studentEmail || '';
        if (key === 'className') return (allClassesMap[row.classId] && allClassesMap[row.classId].name) || row.classId || '';
        if (key === 'session') {
          var s = allSessionsMap[row.sessionId];
          return s ? (s.date || '') + ' ' + (s.startTime || '') : '';
        }
        if (key === 'paid') return row.paid ? 1 : 0;
        if (key === 'status') return row.status || '';
        if (key === 'createdAt') return row.enrolledAt || row.createdAt || '';
        return row[key];
      });
    } else {
      filtered.sort(function(a, b) {
        if (a.status === 'waitlisted' && b.status === 'waitlisted') {
          return (a.waitlistPosition || 999) - (b.waitlistPosition || 999);
        }
        return (b.enrolledAt || '').localeCompare(a.enrolledAt || '');
      });
    }

    if (filtered.length === 0) {
      table.innerHTML = bookEmptyState('\ud83d\udccb', 'No enrollments yet', 'Enrollments appear here when students book classes.');
      return;
    }

    var html = '<table class="data-table"><thead><tr>';
    if (typeof window.mastSortableTh === 'function') {
      html +=
        window.mastSortableTh('Student',  'student',   _enrollSortKey, _enrollSortDir, 'window._enrollSort') +
        window.mastSortableTh('Class',    'className', _enrollSortKey, _enrollSortDir, 'window._enrollSort') +
        window.mastSortableTh('Session',  'session',   _enrollSortKey, _enrollSortDir, 'window._enrollSort') +
        window.mastSortableTh('Paid',     'paid',      _enrollSortKey, _enrollSortDir, 'window._enrollSort') +
        window.mastSortableTh('Status',   'status',    _enrollSortKey, _enrollSortDir, 'window._enrollSort') +
        '<th>Actions</th>';
    } else {
      html += '<th>Student</th><th>Class</th><th>Session</th><th>Paid</th><th>Status</th><th>Actions</th>';
    }
    html += '</tr></thead><tbody>';

    filtered.forEach(function(e) {
      var className = allClassesMap[e.classId] ? allClassesMap[e.classId].name : e.classId;
      var statusLabel = e.status === 'waitlisted' && e.waitlistPosition
        ? e.status + ' #' + e.waitlistPosition : e.status;

      // CQ1Urw — student name is the click affordance into the detail view.
      // Row-level quick-action buttons stay live; the link only opens detail.
      html += '<tr>' +
        '<td><a href="#" onclick="event.preventDefault();window._enrollView(\'' + esc(e.id) + '\')" style="color:var(--teal,#2a7c6f);font-weight:600;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:2px;">' + esc(e.studentName || e.customerName || '—') + '</a><br><span style="font-size:0.78rem;color:var(--warm-gray);">' + esc(e.studentEmail || e.customerEmail || '') + '</span></td>' +
        '<td>' + esc(className) + '</td>' +
        '<td>' + (function() {
          if (!e.sessionId) return '—';
          var sess = allSessionsMap[e.sessionId];
          if (!sess) return esc(e.sessionId);
          return formatDate(sess.date) + (sess.startTime ? ' ' + formatTime(sess.startTime) : '');
        })() + '</td>' +
        '<td>' + formatPrice(e.pricePaidCents || e.pricePaid) + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, e.status) + '">' + esc(statusLabel) + '</span></td>' +
        '<td><div class="event-actions">';

      if (e.status === 'confirmed') {
        html += '<button class="btn-icon" onclick="window._bookMarkAttended(\'' + esc(e.id) + '\')" title="Mark Attended">&#10003;</button>';
        html += '<button class="btn-icon" onclick="window._bookMarkLate(\'' + esc(e.id) + '\')" title="Mark Late" style="color:#FFD54F;">&#128336;</button>';
        html += '<button class="btn-icon" onclick="window._bookMarkNoShow(\'' + esc(e.id) + '\')" title="Mark No-Show">&#128683;</button>';
        html += '<button class="btn-icon danger" onclick="window._bookCancelEnrollment(\'' + esc(e.id) + '\')" title="Cancel Enrollment">&#10006;</button>';
      }
      if (e.status === 'waitlisted') {
        html += '<button class="btn-icon" onclick="window._bookPromoteWaitlist(\'' + esc(e.id) + '\')" title="Promote to Confirmed">&#9650;</button>';
        html += '<button class="btn-icon danger" onclick="window._bookCancelEnrollment(\'' + esc(e.id) + '\')" title="Cancel Enrollment">&#10006;</button>';
      }

      html += '</div></td></tr>';
    });

    html += '</tbody></table>';
    table.innerHTML = html;
  }

  // ============================================================
  // CQ1Urw — Enrollment Read-Only Detail View
  // ============================================================
  function _renderEnrollmentDetailView(e) {
    var cls = e.classId ? allClassesMap[e.classId] : null;
    var sess = e.sessionId ? allSessionsMap[e.sessionId] : null;
    var className = cls ? cls.name : (e.classId || '—');
    var sessionLabel = sess ? (formatDate(sess.date) + (sess.startTime ? ' ' + formatTime(sess.startTime) : '')) : '—';
    var statusLabel = e.status === 'waitlisted' && e.waitlistPosition
      ? e.status + ' #' + e.waitlistPosition
      : (e.status || '—');
    function _row(label, val) {
      return '<div style="display:grid;grid-template-columns:140px 1fr;gap:8px 16px;padding:6px 0;border-bottom:1px solid var(--cream-dark);">' +
        '<span style="font-size:0.72rem;color:var(--warm-gray);font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">' + label + '</span>' +
        '<span style="font-size:0.9rem;">' + val + '</span>' +
      '</div>';
    }

    var actionsHtml = '';
    if (e.status === 'confirmed') {
      actionsHtml +=
        '<button class="btn btn-secondary btn-small" onclick="window._bookMarkAttended(\'' + esc(e.id) + '\')">✓ Mark attended</button>' +
        '<button class="btn btn-secondary btn-small" onclick="window._bookMarkLate(\'' + esc(e.id) + '\')">⏰ Mark late</button>' +
        '<button class="btn btn-secondary btn-small" onclick="window._bookMarkNoShow(\'' + esc(e.id) + '\')">🚫 Mark no-show</button>' +
        '<button class="btn btn-danger btn-small" onclick="window._bookCancelEnrollment(\'' + esc(e.id) + '\')">Cancel enrollment</button>';
    } else if (e.status === 'waitlisted') {
      actionsHtml +=
        '<button class="btn btn-primary btn-small" onclick="window._bookPromoteWaitlist(\'' + esc(e.id) + '\')">▲ Promote</button>' +
        '<button class="btn btn-danger btn-small" onclick="window._bookCancelEnrollment(\'' + esc(e.id) + '\')">Cancel enrollment</button>';
    } else {
      actionsHtml = '<span style="color:var(--warm-gray);font-size:0.85rem;">No actions available for status <strong>' + esc(e.status || '—') + '</strong>.</span>';
    }

    return '<div style="padding:8px 0 24px;">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary btn-small" onclick="window._enrollViewBack()" title="Back to list">← Back</button>' +
        '<h3 style="margin:0;flex:1;min-width:200px;">' + esc(e.studentName || e.customerName || 'Enrollment') + '</h3>' +
        '<span style="' + badgeStyle(STATUS_BADGE_COLORS, e.status) + '">' + esc(statusLabel) + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">' +
        '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card,#fff);">' +
          '<h4 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Student</h4>' +
          _row('Name', esc(e.studentName || e.customerName || '—')) +
          _row('Email', esc(e.studentEmail || e.customerEmail || '—')) +
          (e.studentPhone || e.phone ? _row('Phone', esc(e.studentPhone || e.phone)) : '') +
          (e.customerId ? _row('Customer', '<a href="#customers?id=' + esc(e.customerId) + '" style="color:var(--teal,#2a7c6f);text-decoration:underline;">' + esc(e.customerId) + ' →</a>') : '') +
          (e.studentUid ? _row('UID', '<span style="font-family:monospace;font-size:0.78rem;">' + esc(e.studentUid) + '</span>') : '') +
        '</div>' +
        '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card,#fff);">' +
          '<h4 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Class &amp; session</h4>' +
          _row('Class', cls
            ? '<a href="#" onclick="event.preventDefault();window._bookViewClass(\'' + esc(e.classId) + '\')" style="color:var(--teal,#2a7c6f);text-decoration:underline;">' + esc(className) + ' →</a>'
            : esc(className)) +
          _row('Session', esc(sessionLabel)) +
          (sess && sess.capacity ? _row('Capacity', esc(String(sess.capacity))) : '') +
          (e.passId ? _row('Pass used', '<span style="font-family:monospace;font-size:0.78rem;">' + esc(e.passId) + '</span>') : '') +
        '</div>' +
        '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card,#fff);">' +
          '<h4 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Payment</h4>' +
          _row('Amount', formatPrice(e.pricePaidCents || e.pricePaid)) +
          (e.paymentMethod ? _row('Method', esc(e.paymentMethod)) : '') +
          (e.paymentRef ? _row('Reference', '<span style="font-family:monospace;font-size:0.78rem;">' + esc(e.paymentRef) + '</span>') : '') +
          (e.notes ? _row('Notes', '<span style="white-space:pre-wrap;">' + esc(e.notes) + '</span>') : '') +
        '</div>' +
        '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card,#fff);">' +
          '<h4 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Lifecycle</h4>' +
          _row('Enrolled', e.enrolledAt ? esc(new Date(e.enrolledAt).toLocaleString()) : '—') +
          (e.attendedAt ? _row('Attended', esc(new Date(e.attendedAt).toLocaleString())) : '') +
          (e.cancelledAt ? _row('Cancelled', esc(new Date(e.cancelledAt).toLocaleString())) : '') +
          (e.waitlistPosition ? _row('Waitlist #', esc(String(e.waitlistPosition))) : '') +
        '</div>' +
      '</div>' +
      '<div style="margin-top:18px;padding:14px 16px;background:var(--cream,#fbf6ee);border-radius:10px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;margin-right:4px;">Actions</span>' +
        actionsHtml +
      '</div>' +
      // 1GpeRGn — student signals card. Compact chip row across five surfaces
      // (classes / surveys / reviews / passes / certifications) + a recent
      // enrollments strip + drill-out link to the full customer detail page.
      _renderEnrollmentStudentSignals(e) +
    '</div>';
  }

  // Compact "signals" card: dense chip row + 3 most-recent enrollments + a
  // drill-out link to the canonical customer detail page. Classes count and
  // recent strip are computed synchronously from in-memory enrollmentsData;
  // surveys / reviews / passes counts populate asynchronously and replace
  // their placeholder chips when the reads return.
  function _renderEnrollmentStudentSignals(current) {
    var emailKey = (current.studentEmail || current.customerEmail || '').toLowerCase().trim();
    var uid = current.studentUid || null;
    var customerId = current.customerId || null;
    if (!emailKey && !uid && !customerId) {
      return '<div style="margin-top:18px;padding:14px 16px;border:1px dashed var(--cream-dark);border-radius:10px;color:var(--warm-gray);font-size:0.85rem;">No student email, UID, or customer link on this enrollment — cannot build student signals.</div>';
    }

    var others = (enrollmentsData || []).filter(function(r) {
      if (!r || r.id === current.id) return false;
      var rEmail = (r.studentEmail || r.customerEmail || '').toLowerCase().trim();
      var rUid = r.studentUid || null;
      return (emailKey && rEmail === emailKey) || (uid && rUid === uid);
    });
    others.sort(function(a, b) {
      return (b.enrolledAt || '').localeCompare(a.enrolledAt || '');
    });

    var slotId = 'enrollSignals_' + Math.random().toString(36).slice(2, 10);

    function _chip(label, valHtml, color, onclick, title) {
      var attrs = onclick ? ' style="cursor:pointer;" onclick="' + onclick + '"' : '';
      var titleAttr = title ? ' title="' + esc(title) + '"' : '';
      var c = color || 'var(--teal,#2a7c6f)';
      return '<span' + attrs + titleAttr + ' data-chip="' + esc(label.toLowerCase()) + '" style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:14px;background:rgba(42,124,111,0.10);color:' + c + ';font-size:0.78rem;font-weight:600;' + (onclick ? '' : '') + '">' +
        esc(label) + ' <span style="font-family:monospace;">' + valHtml + '</span></span>';
    }
    function _disabledChip(label, valHtml, title) {
      return '<span title="' + esc(title || '') + '" data-chip="' + esc(label.toLowerCase()) + '" style="display:inline-flex;align-items:center;gap:4px;padding:4px 12px;border-radius:14px;background:var(--cream-dark);color:var(--warm-gray);font-size:0.78rem;font-weight:600;">' +
        esc(label) + ' <span style="font-family:monospace;">' + valHtml + '</span></span>';
    }

    var openCust = customerId ? "window.location.hash='#customers?id=" + esc(customerId) + "'" : null;
    var classesChip = _chip('Classes', String(others.length), null, openCust, 'Open full student profile');
    var surveysChip = openCust
      ? _chip('Surveys', '<span id="' + slotId + '_surveys">··</span>', null, openCust, 'Open full student profile')
      : _disabledChip('Surveys', '<span id="' + slotId + '_surveys">··</span>', 'No linked customer record');
    var reviewsChip = openCust
      ? _chip('Reviews', '<span id="' + slotId + '_reviews">··</span>', null, openCust, 'Open full student profile')
      : _disabledChip('Reviews', '<span id="' + slotId + '_reviews">··</span>', 'No linked customer record');
    var activePassesChip = openCust
      ? _chip('Active passes', '<span id="' + slotId + '_passesActive">··</span>', null, openCust, 'Open full student profile')
      : _disabledChip('Active passes', '<span id="' + slotId + '_passesActive">··</span>', 'No linked customer record');
    var usedPassesChip = openCust
      ? _chip('Used passes', '<span id="' + slotId + '_passesUsed">··</span>', null, openCust, 'Open full student profile')
      : _disabledChip('Used passes', '<span id="' + slotId + '_passesUsed">··</span>', 'No linked customer record');
    var certChip = openCust
      ? _chip('Certifications', '<span id="' + slotId + '_certifications">··</span>', null, openCust, 'Open full student profile')
      : _disabledChip('Certifications', '<span id="' + slotId + '_certifications">··</span>', 'No linked customer record');

    var chipsHtml = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px;">' +
      classesChip + surveysChip + reviewsChip + activePassesChip + usedPassesChip + certChip +
    '</div>';

    var recentStrip;
    if (others.length === 0) {
      recentStrip = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:6px 0;">No other enrollments yet.</div>';
    } else {
      var rows = others.slice(0, 3).map(function(r) {
        var className = (allClassesMap[r.classId] && allClassesMap[r.classId].name) || r.classId || '—';
        var sess = r.sessionId ? allSessionsMap[r.sessionId] : null;
        var when = sess
          ? (formatDate(sess.date) + (sess.startTime ? ' ' + formatTime(sess.startTime) : ''))
          : (r.enrolledAt ? MastFormat.date(r.enrolledAt) : '—');
        var statusLabel = r.status === 'waitlisted' && r.waitlistPosition
          ? r.status + ' #' + r.waitlistPosition
          : (r.status || '—');
        return '<tr style="cursor:pointer;" onclick="window._enrollView(\'' + esc(r.id) + '\')">' +
          '<td><strong>' + esc(className) + '</strong></td>' +
          '<td>' + esc(when) + '</td>' +
          '<td>' + formatPrice(r.pricePaidCents || r.pricePaid) + '</td>' +
          '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, r.status) + '">' + esc(statusLabel) + '</span></td>' +
        '</tr>';
      }).join('');
      var moreNote = others.length > 3
        ? '<div style="font-size:0.72rem;color:var(--warm-gray);margin-top:4px;">' + (others.length - 3) + ' more — see full student profile for the rest.</div>'
        : '';
      recentStrip = '<div style="font-weight:600;font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;margin-top:4px;margin-bottom:6px;">Recent enrollments</div>' +
        '<table class="data-table" style="margin-top:0;">' +
        '<thead><tr><th>Class</th><th>When</th><th>Paid</th><th>Status</th></tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
        '</table>' + moreNote;
    }

    var drillLinkHtml = customerId
      ? '<a href="#customers?id=' + esc(customerId) + '" style="color:var(--teal,#2a7c6f);font-weight:600;font-size:0.85rem;text-decoration:none;">View full student profile →</a>'
      : '<span id="' + slotId + '_drillLink" style="color:var(--warm-gray);font-size:0.78rem;">Looking up customer record…</span>';

    // Schedule async load to populate surveys/reviews/passes counts.
    setTimeout(function() { _loadEnrollSignals(slotId, customerId, emailKey, uid); }, 0);

    return '<div id="' + slotId + '" style="margin-top:18px;border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card,#fff);">' +
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;flex-wrap:wrap;justify-content:space-between;">' +
        '<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">' +
          '<h4 style="margin:0;font-size:0.9rem;font-weight:600;">Student signals</h4>' +
          '<span style="color:var(--warm-gray);font-size:0.78rem;">click any chip or the link to drill into the full profile</span>' +
        '</div>' +
        drillLinkHtml +
      '</div>' +
      chipsHtml +
      recentStrip +
    '</div>';
  }

  // Async chip populator. Reads cs_survey_responses + cs_reviews + the customer
  // doc (for linkedIds.uids) + each linked account's wallet.passes, matches by
  // customerId / email / contactId / uid (mirrors the customer-detail Activity
  // matcher), and replaces the placeholder spans in the signals card.
  function _loadEnrollSignals(slotId, customerId, emailKey, studentUid) {
    function setText(id, text) {
      var el = document.getElementById(id);
      if (el) el.textContent = text;
    }

    // Build the match-key set up front.
    var linkedEmails = {};
    if (emailKey) linkedEmails[emailKey] = true;
    var linkedUidSet = {};
    if (studentUid) linkedUidSet[studentUid] = true;
    var linkedContactSet = {};

    function csMatches(rec, uidField) {
      if (!rec) return false;
      if (customerId && rec.customerId === customerId) return true;
      var em = String(rec.contactEmail || rec.authorEmail || rec.email || '').toLowerCase();
      if (em && linkedEmails[em]) return true;
      if (rec.contactId && linkedContactSet[rec.contactId]) return true;
      if (uidField && rec[uidField] && linkedUidSet[rec[uidField]]) return true;
      return false;
    }

    // If the enrollment has no customerId, try to resolve one via the
    // email→customerId index so the drill link still routes to the canonical
    // customer detail page for legacy enrollments.
    var custPromise;
    if (customerId) {
      custPromise = MastDB.get('admin/customers/' + customerId).then(function(c) { return { id: customerId, cust: c || null }; }).catch(function() { return { id: customerId, cust: null }; });
    } else if (emailKey) {
      // Canonical key (gmail dot/+tag aware) so lookups match the resolver's index.
      var indexKey = (window.MastCustomerResolver && window.MastCustomerResolver.emailKey(emailKey)) || emailKey.replace(/[.#$[\]/]/g, ',');
      custPromise = MastDB.get('admin/customerIndexes/byEmail/' + indexKey).then(function(resolvedId) {
        if (!resolvedId) return { id: null, cust: null };
        return MastDB.get('admin/customers/' + resolvedId).then(function(c) { return { id: resolvedId, cust: c || null }; });
      }).catch(function() { return { id: null, cust: null }; });
    } else {
      custPromise = Promise.resolve({ id: null, cust: null });
    }

    custPromise.then(function(resolved) {
      var cust = resolved.cust;
      var resolvedId = resolved.id;
      // Replace the drill-link placeholder once we have a customer id.
      if (!customerId && resolvedId) {
        var ph = document.getElementById(slotId + '_drillLink');
        if (ph) {
          ph.outerHTML = '<a href="#customers?id=' + resolvedId.replace(/[<>&"']/g, function(ch) { return { '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' }[ch]; }) + '" style="color:var(--teal,#2a7c6f);font-weight:600;font-size:0.85rem;text-decoration:none;">View full student profile →</a>';
        }
      } else if (!customerId && !resolvedId) {
        var ph2 = document.getElementById(slotId + '_drillLink');
        if (ph2) ph2.textContent = 'No linked customer record — only enrollment-derived data is available.';
      }
      if (cust) {
        ((cust.emails) || []).forEach(function(e) { if (e) linkedEmails[String(e).toLowerCase()] = true; });
        if (cust.primaryEmail) linkedEmails[String(cust.primaryEmail).toLowerCase()] = true;
        var linkedC = cust.linkedIds || {};
        (linkedC.contactIds || []).forEach(function(id) { linkedContactSet[id] = true; });
        (linkedC.uids || []).forEach(function(u) { linkedUidSet[u] = true; });
      }
      var uids = Object.keys(linkedUidSet);

      var certCustomerId = customerId || resolvedId;
      var certPromise = certCustomerId
        ? MastDB.get('admin/customers/' + certCustomerId + '/certifications')
            .then(function(c) { return c || {}; })
            .catch(function() { return {}; })
        : Promise.resolve({});

      var promises = [
        MastDB.query('cs_survey_responses').limitToLast(500).once()
          .then(function(s) { return (s && s.val && s.val()) || (s && typeof s === 'object' ? s : {}); })
          .catch(function() { return {}; }),
        MastDB.query('cs_reviews').limitToLast(500).once()
          .then(function(s) { return (s && s.val && s.val()) || (s && typeof s === 'object' ? s : {}); })
          .catch(function() { return {}; }),
        certPromise
      ];
      uids.forEach(function(u) {
        promises.push(MastDB.get('public/accounts/' + u + '/wallet/passes').then(function(p) { return p || {}; }).catch(function() { return {}; }));
      });

      Promise.all(promises).then(function(results) {
        var responses = results[0] || {};
        var reviews = results[1] || {};
        var certs = results[2] || {};
        var surveyCount = 0, reviewCount = 0;
        Object.keys(responses).forEach(function(k) { if (csMatches(responses[k])) surveyCount++; });
        Object.keys(reviews).forEach(function(k) { if (csMatches(reviews[k], 'authorUid')) reviewCount++; });

        var nowIso = new Date().toISOString();
        var certCount = 0;
        Object.keys(certs).forEach(function(cid) {
          var c = certs[cid];
          if (!c || c.revokedAt) return;
          if (c.expiresAt && c.expiresAt < nowIso) return;
          certCount++;
        });

        var activePasses = 0, usedPasses = 0;
        for (var i = 3; i < results.length; i++) {
          var passes = results[i] || {};
          Object.keys(passes).forEach(function(pid) {
            var p = passes[pid];
            if (!p || p.status === 'revoked') return;
            if (p.visitsUsed && p.visitsUsed > 0) usedPasses++;
            else if (p.status === 'active') activePasses++;
          });
        }

        setText(slotId + '_surveys', String(surveyCount));
        setText(slotId + '_reviews', String(reviewCount));
        setText(slotId + '_certifications', String(certCount));
        setText(slotId + '_passesActive', String(activePasses));
        setText(slotId + '_passesUsed', String(usedPasses));
      }).catch(function() {
        setText(slotId + '_surveys', '?');
        setText(slotId + '_reviews', '?');
        setText(slotId + '_certifications', '?');
        setText(slotId + '_passesActive', '?');
        setText(slotId + '_passesUsed', '?');
      });
    });
  }

  // State-free core of the roster status write — shared by the legacy roster
  // buttons and window.EnrollmentsBridge (the enrollments-v2 twin). Status
  // update + attended/cancelled stamps + survey/cert side effects + session
  // seat-count bookkeeping; NO toast, NO view refresh (callers own their UI).
  // Returns the pre-update enrollment record. Throws on failure.
  async function _enrollSetStatusCore(enrollmentId, newStatus) {
    var updateData = { status: newStatus };
    if (newStatus === 'cancelled') updateData.cancelledAt = new Date().toISOString();
    if (newStatus === 'completed') updateData.attendedAt = new Date().toISOString();
    if (newStatus === 'no-show') updateData.attendedAt = null;

    // Get enrollment to update session count
    var enrollment = await MastDB.enrollments.get(enrollmentId);
    if (!enrollment) throw new Error('Enrollment not found');

    await MastDB.enrollments.update(enrollmentId, updateData);

    if (newStatus === 'completed' && enrollment) {
      var contactEmail = enrollment.studentEmail || enrollment.customerEmail;
      if (contactEmail) {
        firebase.functions().httpsCallable('triggerSurveyOnClassAttended')({
          tenantId: TENANT_ID,
          classId: enrollment.classId || '',
          className: (allClassesMap[enrollment.classId] || {}).name || enrollment.classId || '',
          contactEmail: contactEmail,
          contactName: enrollment.studentName || enrollment.customerName || null
        }).catch(function(_e) { console.warn('[book] triggerSurveyOnClassAttended failed:', _e); });
      }
      // Cert auto-grant prompt — fires if any cert type lists this class
      // in autoGrantOnClassIds. Instructor confirms (not silent) per Decision 11.
      _maybePromptGrantCertForEnrollment(enrollment)
        .catch(function(e) { console.warn('[book] cert grant prompt failed:', e); });
    }

    // Update session enrolled count
    if (enrollment && enrollment.sessionId) {
      if (newStatus === 'cancelled' && enrollment.status === 'confirmed') {
        await adjustSessionCount(enrollment.sessionId, 'enrolled', -1);
      } else if (newStatus === 'confirmed' && enrollment.status === 'waitlisted') {
        await adjustSessionCount(enrollment.sessionId, 'enrolled', 1);
        await adjustSessionCount(enrollment.sessionId, 'waitlisted', -1);
      }
    }
    return enrollment;
  }

  async function updateEnrollmentStatus(enrollmentId, newStatus) {
    try {
      await _enrollSetStatusCore(enrollmentId, newStatus);
      MastAdmin.showToast('Enrollment updated');
      // Refresh current view
      var classFilter = (document.getElementById('enrollFilterClass') || {}).value;
      loadEnrollments(null, classFilter);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  }

  async function adjustSessionCount(sessionId, field, delta) {
    var session = await MastDB.classSessions.get(sessionId);
    if (!session) return;
    var current = session[field] || 0;
    var update = {};
    update[field] = Math.max(0, current + delta);
    await MastDB.classSessions.update(sessionId, update);
  }

  // ============================================================
  // Sub-Tab Navigation
  // ============================================================

  var BOOK_VIEWS = ['bookListView', 'bookDetailView', 'bookEnrollmentsView', 'bookInstructorsView', 'bookInstructorDetailView', 'bookResourcesView', 'bookResourceDetailView', 'bookPassesView', 'bookPassDetailView', 'bookSessionOpsView', 'bookCalendarView', 'bookReportsView', 'bookSettingsView'];

  function hideAllViews() {
    BOOK_VIEWS.forEach(function(id) {
      var el = document.getElementById(id);
      if (el) el.style.display = 'none';
    });
  }

  function switchSubTab(tab) {
    currentSubTab = tab;
    // Update tab bar active state
    var tabs = document.querySelectorAll('#bookSubNav .view-tab');
    tabs.forEach(function(t) { t.classList.remove('active'); });
    var tabMap = { classes: 0, instructors: 1, resources: 2, passes: 3, enrollments: 4, calendar: 5, 'book-reports': 6, 'book-settings': 7 };
    if (tabs[tabMap[tab]]) tabs[tabMap[tab]].classList.add('active');

    hideAllViews();
    if (tab === 'classes') { document.getElementById('bookListView').style.display = ''; renderClassList(); }
    else if (tab === 'instructors') { document.getElementById('bookInstructorsView').style.display = ''; loadInstructors(); }
    else if (tab === 'resources') { document.getElementById('bookResourcesView').style.display = ''; loadResources(); }
    else if (tab === 'passes') { document.getElementById('bookPassesView').style.display = ''; loadPassDefinitions(); }
    else if (tab === 'enrollments') { document.getElementById('bookEnrollmentsView').style.display = ''; loadEnrollments(); }
    else if (tab === 'calendar') { document.getElementById('bookCalendarView').style.display = ''; loadCalendar(); }
    else if (tab === 'book-reports') { document.getElementById('bookReportsView').style.display = ''; loadReports(); }
    else if (tab === 'book-settings') { document.getElementById('bookSettingsView').style.display = ''; loadBookSettings(); }
  }

  // ============================================================
  // Instructors — Load & Render
  // ============================================================

  async function loadInstructors() {
    try {
      // Load catalog first so migration can ensure entries without a second pass.
      if (!skillCatalogLoaded) await loadSkillCatalog();
      var data = (await MastDB.instructors.list(100)) || {};
      instructorsData = Object.keys(data).map(function(id) {
        var i = data[id];
        i.id = id;
        return i;
      });
      // One-shot, idempotent. Per-instructor migration.skillsFromSpecialties
      // flag prevents re-runs. Safe on cold reload.
      await _migrateInstructorSkillsIfNeeded(instructorsData);
      instructorsMap = {};
      instructorsData.forEach(function(i) { instructorsMap[i.id] = i; });
      instructorsLoaded = true;
      renderInstructorList();
    } catch (err) {
      console.error('[Book] Failed to load instructors:', err);
      document.getElementById('bookInstructorsTable').innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">Failed to load instructors.</p>';
    }
  }

  function renderInstructorList() {
    var container = document.getElementById('bookInstructorsTable');
    if (!container) return;

    // B8 — when an instructor is selected, render the read-only detail view.
    if (_instrViewId) {
      var instr = instructorsData.find(function(x) { return x.id === _instrViewId; });
      if (!instr) { _instrViewId = null; /* fall through to list */ }
      else { container.innerHTML = _renderInstructorDetailView(instr); return; }
    }

    // URL-driven filters from MCP admin links (#instructors?...)
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlIdsParam = (rp && typeof rp.instructorIds === 'string') ? rp.instructorIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id) { urlIdLookup[id] = true; });
    var hasUrlFilter = !!(urlStatus || urlIds.length);

    var filtered;
    if (hasUrlFilter) {
      filtered = instructorsData.filter(function(i) {
        if (urlStatus && i.status !== urlStatus) return false;
        if (urlIdLookup && !urlIdLookup[i.id]) return false;
        return true;
      });
    } else {
      var statusFilter = (document.getElementById('instrFilterStatus') || {}).value || 'active';
      filtered = instructorsData.filter(function(i) {
        if (statusFilter !== 'all' && i.status !== statusFilter) return false;
        return true;
      });
    }

    filtered.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var html = '';
    if (hasUrlFilter) {
      var bparts = [];
      if (urlIds.length) bparts.push(urlIds.length + ' selected instructor' + (urlIds.length === 1 ? '' : 's'));
      if (urlStatus) bparts.push('status: ' + urlStatus);
      html += '<div id="bookInstructorsUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>\ud83d\udc69\u200d\ud83c\udfeb Showing ' + bparts.join(', ') + ' (' + filtered.length + ')</span>' +
        '<button type="button" onclick="clearInstructorsFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    if (filtered.length === 0) {
      container.innerHTML = html + (hasUrlFilter
        ? '<div style="text-align:center;padding:30px;color:#999;font-size:0.85rem;">No instructors match the filter.</div>'
        : bookEmptyState('\ud83d\udc69\u200d\ud83c\udfeb', 'No instructors yet', 'Click + New Instructor to add one.'));
      return;
    }

    // B8 — card click now opens the read-only detail view. Pencil shortcut
    // removed; detail view has its own Edit button (matches D9 / B9 pattern).
    filtered.forEach(function(i) {
      // Prefer the structured skills[] (post-migration); fall back to legacy
      // specialties[] only for instructors not yet migrated (defensive — load-time
      // migration should always have run by this point).
      var skillSlugs = Array.isArray(i.skills) ? i.skills : [];
      var skillsText = skillSlugs.length
        ? skillSlugs.map(_skillLabel).join(', ')
        : ((i.specialties || []).join(', ') || '');
      html += '<div class="book-card" onclick="window._instrView(\'' + esc(i.id) + '\')" style="cursor:pointer;">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<div>' +
        '<div style="font-weight:600;">' + esc(i.name) + '</div>' +
        (skillsText ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">' + esc(skillsText) + '</div>' : '') +
        (i.email ? '<div style="font-size:0.78rem;color:var(--warm-gray-light,var(--warm-gray-light));margin-top:2px;">' + esc(i.email) + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span style="' + badgeStyle(STATUS_BADGE_COLORS, i.status) + '">' + esc(i.status) + '</span>' +
        '</div>' +
        '</div></div>';
    });

    container.innerHTML = html;
  }

  // ============================================================
  // Instructor Read-Only Detail View
  // Mirrors the loadClassDetail pattern: header row (back + name + badge +
  // Edit) followed by a stack of bookCollapsibleSection blocks built from
  // _detailField + book-responsive-grid + data-table primitives. No bordered
  // card grids — matches the established detail-surface look for this module.
  // ============================================================
  function _renderInstructorDetailView(instr) {
    var skillSlugs = Array.isArray(instr.skills) ? instr.skills.filter(Boolean) : [];
    var skillChips = skillSlugs.length
      ? skillSlugs.map(function(slug) {
          return '<span style="display:inline-block;background:rgba(42,124,111,0.12);color:var(--teal,#2a7c6f);padding:3px 10px;border-radius:14px;font-size:0.78rem;margin:2px 4px 2px 0;">' + _esc(_skillLabel(slug)) + '</span>';
        }).join('')
      : '<span style="color:var(--warm-gray);font-size:0.85rem;">No skills listed.</span>';

    // Classes currently taught/assigned to this instructor. Active + non-active
    // separated so the operator sees teaching today vs historical assignments.
    var assignedClasses = (classesData || []).filter(function(c) { return c && c.instructorId === instr.id; });
    var activeClasses = assignedClasses.filter(function(c) { return c.status === 'active'; });
    var inactiveClasses = assignedClasses.filter(function(c) { return c.status !== 'active'; });

    function _classRow(c) {
      var schedSummary = '';
      if (c.schedule) {
        if (c.schedule.type === 'recurring' && c.schedule.days) {
          schedSummary = c.schedule.days.map(function(d) { return (typeof DAY_LABELS !== 'undefined' && DAY_LABELS[d]) || d; }).join(', ');
          if (c.schedule.startTime) schedSummary += ' ' + (typeof formatTime === 'function' ? formatTime(c.schedule.startTime) : c.schedule.startTime);
        } else if (c.schedule.type === 'once') {
          schedSummary = (typeof formatDate === 'function' ? formatDate(c.schedule.date || c.schedule.startDate) : (c.schedule.date || c.schedule.startDate || ''));
          if (c.schedule.startTime) schedSummary += ' ' + (typeof formatTime === 'function' ? formatTime(c.schedule.startTime) : c.schedule.startTime);
        }
      }
      return '<tr style="cursor:pointer;" onclick="window._bookViewClass(\'' + esc(c.id) + '\')">' +
        '<td><strong>' + esc(c.name || '') + '</strong></td>' +
        '<td><span style="' + badgeStyle(TYPE_BADGE_COLORS, c.type) + '">' + esc(c.type || '') + '</span></td>' +
        '<td>' + esc(schedSummary || '—') + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, c.status) + '">' + esc(c.status || '') + '</span></td>' +
      '</tr>';
    }

    // Standard back link — matches the `.detail-back` button that sits above
    // class detail (#bookDetailView) and the instructor edit form
    // (#bookInstructorDetailView). The read-only view renders into the list
    // table container, so the back link gets prepended here rather than
    // hardcoded in app/index.html like the other views.
    var html = '<button class="detail-back" onclick="window._instrViewBack()">&#8592; Back to Instructors</button>';

    // ── Header row (matches loadClassDetail header — no inline back) ──
    html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1.5rem;">' +
      '<div>' +
      '<h2 style="margin:0 0 6px;font-size:1.6rem;">' + esc(instr.name || 'Instructor') + '</h2>' +
      '<div style="display:flex;gap:8px;align-items:center;">' +
        '<span style="' + badgeStyle(STATUS_BADGE_COLORS, instr.status) + '">' + esc(instr.status || '') + '</span>' +
      '</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn btn-primary" onclick="window._instrEdit(\'' + esc(instr.id) + '\')">Edit</button>' +
      '</div>' +
    '</div>';

    // ── Profile section ──
    var profileHtml = '<div class="book-responsive-grid">' +
      _detailField('Email', instr.email || '—') +
      _detailField('Phone', instr.phone || '—') +
      '</div>' +
      (instr.bio
        ? '<div style="margin-top:0.75rem;">' +
            '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:4px;">Bio</div>' +
            '<div style="font-size:0.9rem;color:var(--text);white-space:pre-wrap;">' + esc(instr.bio) + '</div>' +
          '</div>'
        : '');
    html += bookCollapsibleSection('instrProfile', 'Profile', profileHtml);

    // ── Skills section ──
    var skillsHtml = '<div>' + skillChips + '</div>';
    html += bookCollapsibleSection('instrSkills', 'Skills', skillsHtml);

    // ── Classes section (active + other tables, matches Sessions in class detail) ──
    var classesHtml = '';
    if (activeClasses.length > 0) {
      classesHtml += '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin-bottom:4px;">Active (' + activeClasses.length + ')</div>' +
        '<table class="data-table">' +
          '<thead><tr><th>Name</th><th>Type</th><th>Schedule</th><th>Status</th></tr></thead>' +
          '<tbody>' + activeClasses.map(_classRow).join('') + '</tbody>' +
        '</table>';
    }
    if (inactiveClasses.length > 0) {
      classesHtml += '<div style="font-size:0.72rem;text-transform:uppercase;letter-spacing:0.05em;color:var(--warm-gray);margin:14px 0 4px;">Other (' + inactiveClasses.length + ')</div>' +
        '<table class="data-table">' +
          '<thead><tr><th>Name</th><th>Type</th><th>Schedule</th><th>Status</th></tr></thead>' +
          '<tbody>' + inactiveClasses.map(_classRow).join('') + '</tbody>' +
        '</table>';
    }
    if (!activeClasses.length && !inactiveClasses.length) {
      classesHtml = '<p style="color:var(--warm-gray);margin:0;">No classes assigned to this instructor.</p>';
    }
    var classesBadge = '<span style="font-size:0.72rem;padding:1px 6px;border-radius:4px;background:rgba(196,133,60,0.15);color:var(--amber);">' + assignedClasses.length + '</span>';
    html += bookCollapsibleSection('instrClasses', 'Classes', classesHtml, { badge: classesBadge });

    return html;
  }

  // ============================================================
  // Instructor Create / Edit
  // ============================================================

  function showInstructorForm(instrId) {
    var instr = instrId ? instructorsData.find(function(i) { return i.id === instrId; }) : null;
    var isNew = !instr;

    hideAllViews();
    document.getElementById('bookInstructorDetailView').style.display = '';

    var content = document.getElementById('bookInstructorDetailContent');

    var statusOpts = ['active', 'inactive'].map(function(s) {
      return '<option value="' + s + '"' + (instr && instr.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    var html = '<h2 style="margin:0 0 1.5rem;font-size:1.6rem;">' + (isNew ? 'New Instructor' : 'Edit: ' + esc(instr.name)) + '</h2>' +
      '<form id="instrForm" onsubmit="return false;" style="max-width:720px;">' +

      // ── Basic Info ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Basic Info</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field" style="grid-column:span 2;"><label class="form-label">Name <span class="book-required">*</span></label><input type="text" id="ifName" class="form-input" value="' + esc(instr ? instr.name : '') + '" required placeholder="Full name"></div>' +
      '<div class="book-field"><label class="form-label">Status</label><select id="ifStatus" class="form-input">' + statusOpts + '</select></div>' +
      '</div></div>' +

      // ── Details ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Details</div>' +
      '<div class="book-field"><label class="form-label">Bio</label>' +
      '<textarea id="ifBio" class="form-input" rows="3" placeholder="Teaching background and experience...">' + esc(instr ? instr.bio : '') + '</textarea></div>' +
      '<div class="book-field"><label class="form-label">Skills</label>' +
      renderSkillPickerHtml('instrSkillPicker', (instr && Array.isArray(instr.skills)) ? instr.skills : [], 'Add new skill — e.g. Wheel Throwing') +
      '<div class="book-field-hint">Check the skills this instructor is qualified to teach. Used to match instructors to classes with required skills.</div></div>' +
      '</div>' +

      // ── Contact ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Contact &amp; Pay</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Email</label><input type="email" id="ifEmail" class="form-input" value="' + esc(instr ? instr.email : '') + '" placeholder="instructor@email.com"></div>' +
      '<div class="book-field"><label class="form-label">Phone</label><input type="text" id="ifPhone" class="form-input" value="' + esc(instr ? instr.phone : '') + '" placeholder="(555) 123-4567"></div>' +
      '<div class="book-field"><label class="form-label">Pay Rate ($/hr)</label><input type="number" id="ifPayRate" class="form-input" min="0" step="0.01" value="' + (instr && instr.payRateCents ? MastFormat.moneyRaw(instr.payRateCents, { cents: true }) : '') + '"></div>' +
      '</div></div>' +

      // ── Media & Notes ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Media &amp; Notes</div>' +
      '<div class="book-field"><label class="form-label">Photo URL</label>' +
      '<input type="text" id="ifPhoto" class="form-input" value="' + esc(instr ? instr.photoUrl : '') + '" placeholder="https://..."></div>' +
      '<div class="book-field"><label class="form-label">Internal Notes</label>' +
      '<textarea id="ifNotes" class="form-input" rows="2" placeholder="Notes visible to admin only...">' + esc(instr ? instr.notes : '') + '</textarea></div>' +
      '</div>' +

      // ── Actions ──
      '<div class="book-form-actions">' +
      '<button class="btn btn-primary" onclick="window._instrSave(\'' + (instrId || '') + '\')">Save Instructor</button>' +
      '<button class="btn" onclick="window._instrBackToList()">Cancel</button>' +
      '</div></form>';

    content.innerHTML = html;
    initSkillPicker('instrSkillPicker', {
      initialSlugs: (instr && Array.isArray(instr.skills)) ? instr.skills : [],
      firstUsedBy: 'instructor'
    });
  }

  async function saveInstructor(instrId) {
    var name = document.getElementById('ifName').value.trim();
    if (!name) { MastAdmin.showToast('Name is required', true); return; }

    var skills = getSkillPickerSlugs('instrSkillPicker');

    var payRate = parseFloat(document.getElementById('ifPayRate').value);

    var data = {
      name: name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      bio: document.getElementById('ifBio').value.trim() || null,
      skills: skills,
      email: document.getElementById('ifEmail').value.trim() || null,
      phone: document.getElementById('ifPhone').value.trim() || null,
      payRateCents: isNaN(payRate) ? null : Math.round(payRate * 100),
      photoUrl: document.getElementById('ifPhoto').value.trim() || null,
      notes: document.getElementById('ifNotes').value.trim() || null,
      status: document.getElementById('ifStatus').value,
      updatedAt: new Date().toISOString()
    };

    try {
      var isNew = !instrId;
      if (isNew) {
        instrId = MastDB.instructors.newKey();
        data.createdAt = data.updatedAt;
        await MastDB.instructors.set(instrId, data);
      } else {
        // PATCH-style write (matches saveClass at saveClass) so server-owned
        // fields the form doesn't render — createdAt, migration flag, frozen
        // legacy specialties — survive edits.
        await MastDB.instructors.update(instrId, data);
      }
      MastAdmin.showToast(isNew ? 'Instructor created!' : 'Instructor updated!');
      instructorsLoaded = false;
      await loadInstructors();
      switchSubTab('instructors');
    } catch (err) {
      console.error('[Book] Instructor save failed:', err);
      MastAdmin.showToast('Save failed: ' + err.message, true);
    }
  }

  // Bridge for the instructors-v2 redesign twin (flag-gated #instructors-v2).
  // It delegates create/update here so the instructor write (id minting, slug
  // derivation, payRateCents conversion, create-vs-update PATCH semantics) stays
  // single-sourced — the twin never reimplements that logic. Additive; no
  // behavior change to the legacy surface. These mirror the EXACT client writes
  // saveInstructor() makes, parameterized by data (the legacy handler reads the
  // form DOM + the bespoke skill picker, so it can't be called with an object).
  // Skills stay on the legacy skill-picker (catalog-coupled) — the twin omits
  // them so the PATCH-style update preserves an instructor's existing skills[]
  // and migration flag, exactly like saveInstructor's update branch. Mirrors
  // window.ContactsBridge.
  function _instrBridgeData(data) {
    var name = (data.name || '').trim();
    var payRate = parseFloat(data.payRate);
    return {
      name: name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
      bio: (data.bio || '').trim() || null,
      email: (data.email || '').trim() || null,
      phone: (data.phone || '').trim() || null,
      payRateCents: isNaN(payRate) ? null : Math.round(payRate * 100),
      photoUrl: (data.photoUrl || '').trim() || null,
      notes: (data.notes || '').trim() || null,
      status: data.status || 'active',
      updatedAt: new Date().toISOString()
    };
  }
  window.InstructorsBridge = {
    create: async function (data) {
      var rec = _instrBridgeData(data);
      var id = MastDB.instructors.newKey();
      rec.createdAt = rec.updatedAt;
      // Create-time skills default empty (added via the classic skill picker).
      rec.skills = [];
      await MastDB.instructors.set(id, rec);
      instructorsLoaded = false;
      return id;
    },
    update: async function (id, data) {
      // PATCH-style write (matches saveInstructor's update branch) so server-
      // owned fields the twin doesn't render — createdAt, skills[], migration
      // flag, frozen legacy specialties — survive edits.
      var rec = _instrBridgeData(data);
      await MastDB.instructors.update(id, rec);
      instructorsLoaded = false;
      return id;
    },
    // Native V2 skills picker writes (V1-removal directive).
    ensureSkill: function (label) { return ensureSkillInCatalog(label, 'instructor'); },
    setSkills: async function (id, slugs) {
      await MastDB.instructors.update(id, { skills: Array.isArray(slugs) ? slugs : [], updatedAt: new Date().toISOString() });
      instructorsLoaded = false;
    },
    // Hard delete (the twin confirms + checks class assignments first).
    remove: async function (id) {
      await MastDB.instructors.remove(id);
      instructorsLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'instructor', id);
      return true;
    }
  };

  // ── ClassesBridge — additive shim for the classes-v2 twin ─────────────
  // The Faceted Record twin (classes-v2.js) delegates its NATIVE create/edit of
  // the class RECORD here so the class write stays single-sourced on legacy
  // #book — the twin never reimplements it. These mirror the EXACT client write
  // saveClass() makes (same MastDB.classes accessor + object shape + money in
  // CENTS), parameterized by data (the legacy saveClass reads a multi-section
  // form DOM + the skill/cert pickers + the image library, so it can't be called
  // with an object). Additive; no behavior change to the legacy surface. Mirrors
  // window.ResourcesBridge / window.InstructorsBridge / window.PassesBridge.
  //
  // SCOPE: the RECORD basic fields only (name / description / type / category /
  // status / capacity / minEnrollment / cancellationLeadDays / priceCents /
  // duration / materials*). Session GENERATION (schedule → materializeSessions),
  // series pricing, required skills, required certs, and the image library are
  // wizard-like sub-flows with no V2 home — they stay on legacy saveClass. So
  // the bridge does NOT call materializeSessions and update() is PATCH-style:
  // it writes only the basic fields, leaving schedule / seriesInfo /
  // requiredSkills / requiredCertTypeIds / imageIds / publishedAt / createdAt
  // (and the generated classSessions) untouched, exactly like saveClass's
  // .update() branch preserves server-owned fields.
  function _classBridgeData(data) {
    var price = parseFloat(data.priceCents != null ? data.priceCents : data.price);
    var minEnroll = parseInt(data.minEnrollment, 10);
    var cancelLead = parseInt(data.cancellationLeadDays, 10);
    var matIncluded = data.materialsIncluded === true || data.materialsIncluded === 'true';
    var matCost = parseFloat(data.materialsCostCents);
    return {
      name: (data.name || '').trim(),
      description: (data.description || '').trim(),
      type: data.type || CLASS_TYPES[0],
      category: (data.category || '').trim().toLowerCase(),
      status: data.status || 'draft',
      capacity: parseInt(data.capacity, 10) || 8,
      minEnrollment: isNaN(minEnroll) ? null : minEnroll,
      cancellationLeadDays: isNaN(cancelLead) ? 2 : cancelLead,
      // Money in CENTS — match saveClass (priceCents = Math.round($ * 100)).
      // The twin passes dollars in `price`; accept either and normalize.
      priceCents: Math.round((isNaN(price) ? 0 : price) * 100),
      duration: parseInt(data.duration, 10) || 60,
      materialsIncluded: matIncluded,
      materialsCostCents: matIncluded ? null : (isNaN(matCost) || matCost <= 0 ? null : Math.round(matCost * 100)),
      materialsNote: (data.materialsNote || '').trim() || null,
      updatedAt: new Date().toISOString()
    };
  }
  window.ClassesBridge = {
    create: async function (data) {
      var rec = _classBridgeData(data);
      var id = MastDB.classes.newKey();
      rec.createdAt = rec.updatedAt;
      // A class created from the twin has no schedule yet (session generation is
      // a classic-only sub-flow); seed the record-shaped defaults saveClass would
      // otherwise materialize so the legacy surface opens it cleanly. No
      // materializeSessions — the operator adds a schedule + generates in classic.
      rec.schedule = { type: 'recurring', days: [], startTime: '', startDate: '' };
      rec.seriesInfo = null;
      rec.requiredSkills = [];
      rec.requiredCertTypeIds = [];
      rec.imageIds = [];
      await MastDB.classes.set(id, rec);
      classesLoaded = false;
      return id;
    },
    update: async function (id, data) {
      // PATCH-style write (matches saveClass's .update() branch) so the fields
      // this twin does NOT render — schedule, seriesInfo, requiredSkills,
      // requiredCertTypeIds, imageIds, publishedAt, createdAt, generated
      // sessions — survive a basic-record edit.
      var rec = _classBridgeData(data);
      await MastDB.classes.update(id, rec);
      classesLoaded = false;
      return id;
    },
    // Schedule + assignment + session generation — the classes-v2 schedule
    // section delegates here so the write shape and the materializer stay
    // single-sourced with legacy saveClass. All PATCH-style.
    setSchedule: async function (id, schedule) {
      var sc = schedule || {};
      var clean = (sc.type === 'once')
        ? { type: 'once', date: sc.date || null, startDate: sc.date || null, startTime: sc.startTime || '' }
        : { type: 'recurring', days: Array.isArray(sc.days) ? sc.days : [],
            startTime: sc.startTime || '', startDate: sc.startDate || '', endDate: sc.endDate || '' };
      await MastDB.classes.update(id, { schedule: clean, updatedAt: new Date().toISOString() });
      classesLoaded = false;
    },
    assign: async function (id, a) {
      await MastDB.classes.update(id, {
        instructorId: (a && a.instructorId) || null,
        instructorName: (a && a.instructorName) || null,
        resourceId: (a && a.resourceId) || null,
        resourceName: (a && a.resourceName) || null,
        updatedAt: new Date().toISOString()
      });
      classesLoaded = false;
    },
    // The remaining editor fields the V2 form now owns natively (V1-removal
    // directive: no classic escape hatches). PATCH-style; shapes mirror
    // saveClass exactly (seriesInfo null for non-series, imageIds single-entry).
    setExtras: async function (id, x) {
      var requiresWaiver = !!x.requiresWaiver;
      var patch = {
        requiresWaiver: requiresWaiver,
        waiverTemplateId: requiresWaiver ? (x.waiverTemplateId || null) : null,
        enrollmentOpenDate: x.enrollmentOpenDate || null,
        enrollmentCloseDate: x.enrollmentCloseDate || null,
        requiredCertTypeIds: Array.isArray(x.requiredCertTypeIds) ? x.requiredCertTypeIds : [],
        requiredSkills: Array.isArray(x.requiredSkills) ? x.requiredSkills : [],
        imageIds: x.imageUrl ? [x.imageUrl] : [],
        updatedAt: new Date().toISOString()
      };
      if (x.type === 'series') {
        var sp = parseFloat(x.seriesPrice);
        patch.seriesInfo = {
          totalSessions: parseInt(x.seriesTotal, 10) || null,
          seriesPriceCents: isNaN(sp) ? null : Math.round(sp * 100),
          allowDropIn: x.seriesDropIn !== false && x.seriesDropIn !== 'false',
          allowLateEnroll: x.seriesLateEnroll === true || x.seriesLateEnroll === 'true'
        };
      } else {
        patch.seriesInfo = null;
      }
      await MastDB.classes.update(id, patch);
      classesLoaded = false;
    },
    publish: function (id) { return _classPublishCore(id); },
    unpublish: function (id) { return _classUnpublishCore(id); },
    // Skill catalog (admin/skillCatalog) — shared with InstructorsBridge users.
    ensureSkill: function (label) { return ensureSkillInCatalog(label, 'class'); },
    // Fresh-reads the class, then runs the SAME materializer legacy saveClass
    // uses (duplicate-date-safe; no-op without a schedule). Returns the class.
    generateSessions: async function (id) {
      var cls = await MastDB.classes.get(id);
      if (!cls) throw new Error('Class not found');
      if (!cls.schedule || (!cls.schedule.startDate && !cls.schedule.date)) throw new Error('Set a schedule first.');
      await materializeSessions(id, cls);
      return cls;
    },
    // Hard delete — DRAFT classes with no enrollments only (anything that has
    // been sellable archives instead; enrollment FKs must never strand).
    // Cascades the class's generated sessions.
    remove: async function (id) {
      var cls = await MastDB.classes.get(id);
      if (!cls) throw new Error('Class not found');
      if (cls.status !== 'draft') throw new Error('Only draft classes can be deleted — archive it instead.');
      var enrolls = (await MastDB.enrollments.byClass(id)) || {};
      var ev = (enrolls && typeof enrolls.val === 'function') ? (enrolls.val() || {}) : enrolls;
      if (Object.keys(ev).length) throw new Error('This class has enrollments — archive it instead.');
      var sess = (await MastDB.classSessions.byClass(id)) || {};
      var ids = Object.keys(sess);
      for (var i = 0; i < ids.length; i++) await MastDB.classSessions.remove(ids[i]);
      await MastDB.classes.remove(id);
      classesLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'class', id);
      return true;
    }
  };

  // ============================================================
  // Resources — Load & Render
  // ============================================================

  async function loadResources() {
    try {
      var data = (await MastDB.resources.list(100)) || {};
      resourcesData = Object.keys(data).map(function(id) {
        var r = data[id];
        r.id = id;
        return r;
      });
      resourcesMap = {};
      resourcesData.forEach(function(r) { resourcesMap[r.id] = r; });
      resourcesLoaded = true;
      renderResourceList();
    } catch (err) {
      console.error('[Book] Failed to load resources:', err);
      document.getElementById('bookResourcesTable').innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">Failed to load resources.</p>';
    }
  }

  function renderResourceList() {
    var container = document.getElementById('bookResourcesTable');
    if (!container) return;

    // URL-driven filters from MCP admin links (#resources?...)
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlType = (rp && typeof rp.type === 'string') ? rp.type : '';
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlIdsParam = (rp && typeof rp.resourceIds === 'string') ? rp.resourceIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id) { urlIdLookup[id] = true; });
    var hasUrlFilter = !!(urlType || urlStatus || urlIds.length);

    var filtered;
    if (hasUrlFilter) {
      filtered = resourcesData.filter(function(r) {
        if (urlType && r.type !== urlType) return false;
        if (urlStatus && r.status !== urlStatus) return false;
        if (urlIdLookup && !urlIdLookup[r.id]) return false;
        return true;
      });
    } else {
      var typeFilter = (document.getElementById('resFilterType') || {}).value || 'all';
      var statusFilter = (document.getElementById('resFilterStatus') || {}).value || 'active';
      filtered = resourcesData.filter(function(r) {
        if (typeFilter !== 'all' && r.type !== typeFilter) return false;
        if (statusFilter !== 'all' && r.status !== statusFilter) return false;
        return true;
      });
    }

    filtered.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    var html = '';
    if (hasUrlFilter) {
      var bparts = [];
      if (urlIds.length) bparts.push(urlIds.length + ' selected resource' + (urlIds.length === 1 ? '' : 's'));
      if (urlType) bparts.push('type: ' + urlType);
      if (urlStatus) bparts.push('status: ' + urlStatus);
      html += '<div id="bookResourcesUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>\ud83c\udfe0 Showing ' + bparts.join(', ') + ' (' + filtered.length + ')</span>' +
        '<button type="button" onclick="clearResourcesFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    if (filtered.length === 0) {
      container.innerHTML = html + (hasUrlFilter
        ? '<div style="text-align:center;padding:30px;color:#999;font-size:0.85rem;">No resources match the filter.</div>'
        : bookEmptyState('\ud83c\udfe0', 'No resources yet', 'Click + New Resource to add one.'));
      return;
    }

    filtered.forEach(function(r) {
      html += '<div class="book-card" onclick="window._resEdit(\'' + esc(r.id) + '\')">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;">' +
        '<div>' +
        '<div style="font-weight:600;">' + esc(r.name) +
        ' <span style="' + badgeStyle(RESOURCE_TYPE_BADGE_COLORS, r.type) + '">' + esc(r.type) + '</span></div>' +
        (r.subType ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:2px;">' + esc(r.subType) + '</div>' : '') +
        (r.capacity ? '<div style="font-size:0.78rem;color:var(--warm-gray-light,var(--warm-gray-light));margin-top:2px;">Capacity: ' + r.capacity + '</div>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:8px;">' +
        '<span style="' + badgeStyle(STATUS_BADGE_COLORS, r.status) + '">' + esc(r.status) + '</span>' +
        '<button class="btn-icon" onclick="event.stopPropagation();window._resEdit(\'' + esc(r.id) + '\')" title="Edit">&#9998;</button>' +
        '</div>' +
        '</div></div>';
    });

    container.innerHTML = html;
  }

  // ============================================================
  // Resource Create / Edit
  // ============================================================

  function showResourceForm(resId) {
    var res = resId ? resourcesData.find(function(r) { return r.id === resId; }) : null;
    var isNew = !res;

    hideAllViews();
    document.getElementById('bookResourceDetailView').style.display = '';

    var content = document.getElementById('bookResourceDetailContent');

    var typeOpts = RESOURCE_TYPES.map(function(t) {
      return '<option value="' + t + '"' + (res && res.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    }).join('');

    var statusOpts = ['active', 'inactive'].map(function(s) {
      return '<option value="' + s + '"' + (res && res.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    var html = '<h2 style="margin:0 0 1.5rem;font-size:1.6rem;">' + (isNew ? 'New Resource' : 'Edit: ' + esc(res.name)) + '</h2>' +
      '<form id="resForm" onsubmit="return false;" style="max-width:720px;">' +

      // ── Basic Info ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Basic Info</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field" style="grid-column:span 2;"><label class="form-label">Name <span class="book-required">*</span></label><input type="text" id="rfName" class="form-input" value="' + esc(res ? res.name : '') + '" required placeholder="e.g. Main Studio, Kiln #1"></div>' +
      '<div class="book-field"><label class="form-label">Type <span class="book-required">*</span></label><select id="rfType" class="form-input">' + typeOpts + '</select></div>' +
      '<div class="book-field"><label class="form-label">Status</label><select id="rfStatus" class="form-input">' + statusOpts + '</select></div>' +
      '</div></div>' +

      // ── Details ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Details</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Sub-type</label><input type="text" id="rfSubType" class="form-input" value="' + esc(res ? res.subType : '') + '" placeholder="e.g. Kiln, Pottery Wheel"></div>' +
      '<div class="book-field"><label class="form-label">Capacity</label><input type="number" id="rfCapacity" class="form-input" min="0" value="' + (res ? res.capacity || '' : '') + '" placeholder="Max students"></div>' +
      '</div>' +
      '<div class="book-field"><label class="form-label">Description</label>' +
      '<textarea id="rfDesc" class="form-input" rows="2" placeholder="What is this resource used for?">' + esc(res ? res.description : '') + '</textarea></div>' +
      '</div>' +

      // ── Internal ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Internal Notes</div>' +
      '<div class="book-field"><label class="form-label">Notes</label>' +
      '<textarea id="rfNotes" class="form-input" rows="2" placeholder="Admin-only notes...">' + esc(res ? res.notes : '') + '</textarea></div>' +
      '</div>' +

      // ── Actions ──
      '<div class="book-form-actions">' +
      '<button class="btn btn-primary" onclick="window._resSave(\'' + (resId || '') + '\')">Save Resource</button>' +
      '<button class="btn" onclick="window._resBackToList()">Cancel</button>' +
      '</div></form>';

    content.innerHTML = html;
  }

  async function saveResource(resId) {
    var name = document.getElementById('rfName').value.trim();
    if (!name) { MastAdmin.showToast('Name is required', true); return; }

    var data = {
      name: name,
      type: document.getElementById('rfType').value,
      subType: document.getElementById('rfSubType').value.trim() || null,
      capacity: parseInt(document.getElementById('rfCapacity').value, 10) || null,
      description: document.getElementById('rfDesc').value.trim() || null,
      notes: document.getElementById('rfNotes').value.trim() || null,
      status: document.getElementById('rfStatus').value,
      updatedAt: new Date().toISOString()
    };

    try {
      var isNew = !resId;
      if (isNew) {
        resId = MastDB.resources.newKey();
        data.createdAt = data.updatedAt;
      }
      await MastDB.resources.set(resId, data);
      MastAdmin.showToast(isNew ? 'Resource created!' : 'Resource updated!');
      resourcesLoaded = false;
      await loadResources();
      switchSubTab('resources');
    } catch (err) {
      console.error('[Book] Resource save failed:', err);
      MastAdmin.showToast('Save failed: ' + err.message, true);
    }
  }

  // ── ResourcesBridge — additive shim for the resources-v2 twin ──────────
  // The Faceted Record twin (resources-v2.js) delegates its native create/edit
  // here so the resource write stays single-sourced on legacy #resources — the
  // twin never reimplements it. These mirror the EXACT client write saveResource()
  // makes, parameterized by data (the legacy handler reads the multi-section form
  // DOM, so it can't be called with an object). Additive; no behavior change to
  // the legacy surface. Mirrors window.InstructorsBridge / window.PassesBridge.
  function _resBridgeData(data) {
    var cap = (data.capacity === '' || data.capacity == null) ? null : (parseInt(data.capacity, 10) || null);
    return {
      name: (data.name || '').trim(),
      type: data.type || RESOURCE_TYPES[0],
      subType: (data.subType || '').trim() || null,
      capacity: cap,
      description: (data.description || '').trim() || null,
      notes: (data.notes || '').trim() || null,
      status: data.status || 'active',
      updatedAt: new Date().toISOString()
    };
  }
  window.ResourcesBridge = {
    create: async function (data) {
      var rec = _resBridgeData(data);
      var id = MastDB.resources.newKey();
      rec.createdAt = rec.updatedAt;
      await MastDB.resources.set(id, rec);
      resourcesLoaded = false;
      return id;
    },
    update: async function (id, data) {
      var rec = _resBridgeData(data);
      // saveResource does a full .set() overwrite; preserve the server-owned
      // createdAt so the edit doesn't drop it (the twin doesn't render it).
      var existing = await MastDB.resources.get(id);
      if (existing && existing.createdAt) rec.createdAt = existing.createdAt;
      await MastDB.resources.set(id, rec);
      resourcesLoaded = false;
      return id;
    },
    // Hard delete (the twin confirms + checks class references first —
    // classes point at resources by NAME string).
    remove: async function (id) {
      await MastDB.resources.remove(id);
      resourcesLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'resource', id);
      return true;
    }
  };

  // ── EnrollmentsBridge — additive shim for the enrollments-v2 twin ──────
  // The twin delegates ALL its writes here so the roster status semantics
  // (attended/cancelled stamps, survey + cert side effects, session seat and
  // waitlist counters, renumbering, waitlist CS ticket) stay single-sourced
  // with the legacy roster buttons — the twin never reimplements them. All
  // methods are state-free cores: no toasts, no view refreshes, no confirm
  // dialogs (the caller owns its UI and its confirm). Per-record actions
  // fetch the doc fresh inside the core (no load-once cache → no miss no-op).
  window.EnrollmentsBridge = {
    // 'completed' | 'late' | 'no-show' | 'confirmed' — the roster verbs.
    setStatus: function (id, status) { return _enrollSetStatusCore(id, status); },
    promote: function (id) { return _enrollPromoteCore(id); },
    cancel: function (id) { return _enrollCancelCore(id); },
    // Admin-side enrollment intake (phone/walk-in). Mirrors the legacy walk-in
    // write shape (_bookWalkinManual) + the seat-count bookkeeping the roster
    // transitions maintain: confirmed seats bump session.enrolled; if the
    // session is full the enrollment lands waitlisted with the next position.
    create: async function (data) {
      var classId = data.classId, sessionId = data.sessionId || null;
      if (!classId) throw new Error('Class is required');
      var name = (data.name || '').trim();
      if (!name) throw new Error('Student name is required');
      var email = (data.email || '').trim();
      var session = sessionId ? ((await MastDB.classSessions.get(sessionId)) || {}) : {};
      var status = 'confirmed', waitlistPosition = null;
      if (sessionId && session.capacity && (session.enrolled || 0) >= session.capacity) {
        status = 'waitlisted';
        waitlistPosition = (session.waitlisted || 0) + 1;
      }
      var enrollId = MastDB.enrollments.newKey();
      var now = new Date().toISOString();
      var rec = {
        classId: classId,
        sessionId: sessionId,
        studentId: data.studentId || null,
        studentName: name,
        studentEmail: email,
        customerName: name,
        customerEmail: email,
        status: status,
        enrollmentType: 'dropin',
        pricePaidCents: parseInt(data.pricePaidCents, 10) || 0,
        waiverStatus: 'na',
        waitlistPosition: waitlistPosition,
        notes: (data.notes || '').trim() || null,
        enrolledAt: now,
        createdAt: now
      };
      await MastDB.enrollments.set(enrollId, rec);
      if (sessionId) {
        await adjustSessionCount(sessionId, status === 'waitlisted' ? 'waitlisted' : 'enrolled', 1);
      }
      return { id: enrollId, status: status };
    }
  };

  // ============================================================
  // Pass Definitions — Load & Render
  // ============================================================

  async function loadPassDefinitions() {
    try {
      var data = (await MastDB.passDefinitions.list(100)) || {};
      passDefsData = Object.keys(data).map(function(id) {
        var p = data[id];
        p.id = id;
        return p;
      });
      passDefsLoaded = true;
      renderPassDefList();
    } catch (err) {
      console.error('[Book] Failed to load pass definitions:', err);
      document.getElementById('bookPassesTable').innerHTML = '<p style="color:var(--warm-gray);padding:2rem;">Failed to load pass definitions.</p>';
    }
  }

  function renderPassDefList() {
    var container = document.getElementById('bookPassesTable');
    if (!container) return;

    // B9 — when a pass is selected, render the read-only detail view instead.
    if (_passViewPid) {
      var p = passDefsData.find(function(pd) { return pd.id === _passViewPid; });
      if (!p) { _passViewPid = null; /* fall through to list */ }
      else { container.innerHTML = _renderPassDetailView(p); _kickPassDetailLoad(p.id); return; }
    }

    // URL-driven filters from MCP admin links (#passes?...)
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlType = (rp && typeof rp.type === 'string') ? rp.type : '';
    var urlIdsParam = (rp && typeof rp.passDefinitionIds === 'string') ? rp.passDefinitionIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id) { urlIdLookup[id] = true; });
    var hasUrlFilter = !!(urlStatus || urlType || urlIds.length);

    var filtered;
    if (hasUrlFilter) {
      filtered = passDefsData.filter(function(p) {
        if (urlType && p.type !== urlType) return false;
        if (urlStatus && p.status !== urlStatus) return false;
        if (urlIdLookup && !urlIdLookup[p.id]) return false;
        return true;
      });
    } else {
      var typeFilter = (document.getElementById('passFilterType') || {}).value || 'all';
      var statusFilter = (document.getElementById('passFilterStatus') || {}).value || 'active';
      filtered = passDefsData.filter(function(p) {
        if (typeFilter !== 'all' && p.type !== typeFilter) return false;
        if (statusFilter !== 'all' && p.status !== statusFilter) return false;
        return true;
      });
    }

    filtered.sort(function(a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0) || (a.name || '').localeCompare(b.name || ''); });

    var html = '';
    if (hasUrlFilter) {
      var bparts = [];
      if (urlIds.length) bparts.push(urlIds.length + ' selected definition' + (urlIds.length === 1 ? '' : 's'));
      if (urlType) bparts.push('type: ' + urlType);
      if (urlStatus) bparts.push('status: ' + urlStatus);
      html += '<div id="bookPassesUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>\ud83c\udf9f\ufe0f Showing ' + bparts.join(', ') + ' (' + filtered.length + ')</span>' +
        '<button type="button" onclick="clearPassesFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    if (filtered.length === 0) {
      container.innerHTML = html + (hasUrlFilter
        ? '<div style="text-align:center;padding:30px;color:#999;font-size:0.85rem;">No definitions match the filter.</div>'
        : bookEmptyState('\ud83c\udf9f\ufe0f', 'No passes yet', 'Click + New Pass to create one.'));
      return;
    }

    // B9 — list now: row click → read-only detail view. Pencil/Actions
    // column dropped (matches D9 Book classes pattern). Detail view has its
    // own Edit button.
    html += '<table class="data-table"><thead><tr>' +
      '<th>Name</th><th>Type</th><th>Price</th><th>Visits</th><th>Validity</th><th>Priority</th><th>Status</th>' +
      '</tr></thead><tbody>';

    filtered.forEach(function(p) {
      var visits = p.visitCount ? p.visitCount + ' visits' : 'Unlimited';
      var validity = p.validityDays ? p.validityDays + ' days' : 'No limit';
      html += '<tr style="cursor:pointer;" onclick="window._passView(\'' + esc(p.id) + '\')">' +
        '<td><strong>' + esc(p.name) + '</strong>' + (p.introOnly ? '<br><span style="font-size:0.78rem;color:var(--amber);">Intro only</span>' : '') + '</td>' +
        '<td><span style="' + badgeStyle(PASS_TYPE_BADGE_COLORS, p.type) + '">' + esc(p.type) + '</span></td>' +
        '<td>' + formatPrice(p.priceCents) + (p.autoRenew ? '<br><span style="font-size:0.78rem;color:var(--warm-gray);">/' + (p.renewFrequency || 'month') + '</span>' : '') + '</td>' +
        '<td>' + esc(visits) + '</td>' +
        '<td>' + esc(validity) + '</td>' +
        '<td><span style="font-size:0.78rem;">' + esc(p.priority || 'medium') + '</span></td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, p.status) + '">' + esc(p.status) + '</span></td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  }

  // ============================================================
  // B9 — Pass Definition Read-Only Detail View
  // ============================================================
  function _renderPassDetailView(p) {
    var visits = p.visitCount ? (p.visitCount + ' visits') : 'Unlimited';
    var validity = p.validityDays ? (p.validityDays + ' days') : 'No limit';
    var price = formatPrice(p.priceCents) + (p.autoRenew ? ' /' + (p.renewFrequency || 'month') : '');
    function _row(label, val) {
      return '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;padding:8px 0;border-bottom:1px solid var(--cream-dark);">' +
        '<span style="font-size:0.78rem;color:var(--warm-gray);font-weight:600;letter-spacing:0.04em;text-transform:uppercase;">' + label + '</span>' +
        '<span style="font-size:0.9rem;">' + val + '</span>' +
      '</div>';
    }
    // Tiles read aggregate doc (admin/passDefinitionAggregates/{id}) maintained
    // by the indexPassAggregate CF trigger. No full-accounts scan.
    var agg = _passAggregateByDef[p.id];
    var loading = _passLoadingFor === p.id;
    var historyBlock;
    if (agg) {
      var sold = agg.sold || 0, active = agg.active || 0, used = agg.used || 0;
      var expired = agg.expired || 0, revoked = agg.revoked || 0;
      historyBlock = '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
        _kpiBox('Sold', sold, 'instances purchased') +
        _kpiBox('Active', active, 'currently usable') +
        _kpiBox('Used', used, 'fully consumed') +
        (expired > 0 ? _kpiBox('Expired', expired, 'timed out') : '') +
        (revoked > 0 ? _kpiBox('Revoked', revoked, 'admin-revoked') : '') +
      '</div>';
    } else if (loading) {
      historyBlock = '<div style="color:var(--warm-gray);font-size:0.9rem;">Loading…</div>';
    } else {
      historyBlock = '<div style="color:var(--warm-gray);font-size:0.9rem;">Aggregate not yet computed. (Run backfill if this is a fresh tenant.)</div>';
    }
    var cohortBlock = _renderPassCohortBlock(p.id);
    return '<div style="padding:8px 0 24px;">' +
      '<div style="display:flex;align-items:center;gap:12px;margin-bottom:16px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary btn-small" onclick="window._passViewBack()" title="Back to list">← Back</button>' +
        '<h3 style="margin:0;flex:1;min-width:200px;">' + esc(p.name) + '</h3>' +
        '<span style="' + badgeStyle(PASS_TYPE_BADGE_COLORS, p.type) + '">' + esc(p.type) + '</span>' +
        '<span style="' + badgeStyle(STATUS_BADGE_COLORS, p.status) + '">' + esc(p.status) + '</span>' +
        '<button class="btn btn-primary btn-small" onclick="window._passEdit(\'' + esc(p.id) + '\')">Edit</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;align-items:start;">' +
        '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card,#fff);">' +
          '<h4 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Definition</h4>' +
          _row('Price', price) +
          _row('Visits', esc(visits)) +
          _row('Validity', esc(validity)) +
          _row('Priority', esc(p.priority || 'medium')) +
          (p.introOnly ? _row('Intro only', '<span style="color:var(--amber);">Yes</span>') : '') +
          (p.autoRenew ? _row('Auto-renew', 'Yes · ' + esc(p.renewFrequency || 'month')) : '') +
          (p.description ? _row('Description', '<span style="white-space:pre-wrap;">' + esc(p.description) + '</span>') : '') +
        '</div>' +
        '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card,#fff);">' +
          '<h4 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Instance counts</h4>' +
          historyBlock +
        '</div>' +
      '</div>' +
      cohortBlock +
    '</div>';
  }

  // ── Cohort drill-down ──
  // Time-dependent cohorts (expiring/lapsed) are computed client-side from the
  // per-instance index, so they always reflect "right now" regardless of when
  // the index doc was last written.

  var PASS_COHORTS = [
    { key: 'active',      label: 'Active' },
    { key: 'expiring7d',  label: 'Expiring ≤7d' },
    { key: 'expiring30d', label: 'Expiring ≤30d' },
    { key: 'lapsed30d',   label: 'Lapsed 30d' },
    { key: 'lapsed60d',   label: 'Lapsed 60d' },
    { key: 'unused',      label: 'Unused' },
    { key: 'used',        label: 'Used' },
    { key: 'revoked',     label: 'Revoked' }
  ];

  function _passInstanceMatches(inst, cohortKey) {
    if (!inst) return false;
    var now = Date.now();
    var s = inst.status;
    var isActive = s === 'active';
    var toMs = function(v) { if (v == null) return null; if (typeof v === 'number') return v; var n = Date.parse(v); return isNaN(n) ? null : n; };
    var expiresAt = toMs(inst.expiresAt);
    var lastUsedAt = toMs(inst.lastUsedAt);
    var activatedAt = toMs(inst.activatedAt);
    var sinceLastEngagement = lastUsedAt || activatedAt;
    var hasRemaining = inst.visitsRemaining == null || inst.visitsRemaining > 0;
    switch (cohortKey) {
      case 'active':      return isActive;
      case 'expiring7d':  return isActive && expiresAt && expiresAt > now && expiresAt <= now + 7 * 86400000;
      case 'expiring30d': return isActive && expiresAt && expiresAt > now && expiresAt <= now + 30 * 86400000;
      case 'lapsed30d':   return isActive && !!sinceLastEngagement && (now - sinceLastEngagement) >= 30 * 86400000 && hasRemaining;
      case 'lapsed60d':   return isActive && !!sinceLastEngagement && (now - sinceLastEngagement) >= 60 * 86400000 && hasRemaining;
      case 'unused':      return isActive && !lastUsedAt && (!inst.visitsUsed || inst.visitsUsed === 0);
      case 'used':        return s === 'used' || s === 'exhausted' || s === 'expired';
      case 'revoked':     return s === 'revoked';
      default: return false;
    }
  }

  function _passInstanceSortGetter(row, key) {
    if (key === 'visitsRemaining') return row.visitsRemaining != null ? row.visitsRemaining : -1;
    return row[key];
  }

  function _renderPassCohortBlock(passDefId) {
    var instances = _passInstancesByDef[passDefId];
    if (!instances) {
      return '<div style="margin-top:24px;border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card,#fff);">' +
        '<h4 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Cohorts</h4>' +
        (_passLoadingFor === passDefId
          ? '<div style="color:var(--warm-gray);font-size:0.9rem;">Loading instances…</div>'
          : '<div style="color:var(--warm-gray);font-size:0.9rem;">No instances loaded.</div>') +
      '</div>';
    }
    var chips = PASS_COHORTS.map(function(c) {
      var count = instances.filter(function(inst) { return _passInstanceMatches(inst, c.key); }).length;
      var isSel = c.key === _passSelectedCohort;
      var bg = isSel ? 'var(--accent, var(--primary))' : 'transparent';
      var fg = isSel ? '#fff' : 'var(--text)';
      var border = isSel ? 'var(--accent, var(--primary))' : 'var(--cream-dark)';
      return '<button type="button" onclick="window._passCohortPick(\'' + esc(c.key) + '\')" ' +
        'style="background:' + bg + ';color:' + fg + ';border:1px solid ' + border + ';padding:6px 12px;border-radius:999px;font-size:0.85rem;cursor:pointer;display:inline-flex;align-items:center;gap:6px;">' +
        esc(c.label) + ' <span style="background:rgba(0,0,0,0.12);padding:1px 6px;border-radius:999px;font-size:0.72rem;font-weight:600;">' + count + '</span>' +
      '</button>';
    }).join(' ');
    var matched = instances.filter(function(inst) { return _passInstanceMatches(inst, _passSelectedCohort); });
    if (window.mastSortRows) matched = window.mastSortRows(matched, _passInstanceSortKey, _passInstanceSortDir, _passInstanceSortGetter);
    var tableBlock;
    if (matched.length === 0) {
      tableBlock = '<div style="padding:24px;color:var(--warm-gray);font-size:0.85rem;text-align:center;">No instances match this cohort.</div>';
    } else {
      var th = function(label, key) {
        return window.mastSortableTh
          ? window.mastSortableTh(label, key, _passInstanceSortKey, _passInstanceSortDir, 'window._passInstanceSort')
          : '<th>' + esc(label) + '</th>';
      };
      var rowsHtml = matched.map(function(inst) {
        var total = (typeof inst.visitsUsed === 'number' && typeof inst.visitsRemaining === 'number') ? (inst.visitsUsed + inst.visitsRemaining) : null;
        var visits = (inst.visitsRemaining != null ? inst.visitsRemaining : '—') + ' / ' + (total != null ? total : '—');
        var exp = inst.expiresAt ? MastFormat.date(inst.expiresAt) : '—';
        var lastUse = inst.lastUsedAt ? MastFormat.date(inst.lastUsedAt) : '—';
        var act = inst.activatedAt ? MastFormat.date(inst.activatedAt) : '—';
        var openCust = inst.customerId
          ? 'onclick="window._passOpenCustomer(\'' + esc(inst.customerId) + '\')" style="cursor:pointer;"'
          : '';
        return '<tr ' + openCust + '>' +
          '<td><strong>' + esc(inst.customerName || '—') + '</strong></td>' +
          '<td>' + esc(inst.customerEmail || '—') + '</td>' +
          '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, inst.status || 'unknown') + '">' + esc(inst.status || '—') + '</span></td>' +
          '<td style="font-family:monospace;font-size:0.85rem;">' + esc(visits) + '</td>' +
          '<td>' + esc(act) + '</td>' +
          '<td>' + esc(exp) + '</td>' +
          '<td>' + esc(lastUse) + '</td>' +
        '</tr>';
      }).join('');
      tableBlock = '<table class="data-table" style="margin-top:12px;"><thead><tr>' +
        th('Customer', 'customerName') +
        th('Email', 'customerEmail') +
        th('Status', 'status') +
        th('Visits (rem/total)', 'visitsRemaining') +
        th('Activated', 'activatedAt') +
        th('Expires', 'expiresAt') +
        th('Last used', 'lastUsedAt') +
      '</tr></thead><tbody>' + rowsHtml + '</tbody></table>';
    }
    var emails = matched.map(function(i) { return i.customerEmail; }).filter(Boolean);
    var exportBar = '<div style="display:flex;gap:8px;align-items:center;margin-top:12px;">' +
      '<button class="btn btn-secondary btn-small" onclick="window._passCohortCopyEmails()"' + (emails.length ? '' : ' disabled') + '>Copy emails (' + emails.length + ')</button>' +
      '<button class="btn btn-secondary btn-small" onclick="window._passCohortDownloadCsv()"' + (matched.length ? '' : ' disabled') + '>Download CSV</button>' +
      '<span style="font-size:0.78rem;color:var(--warm-gray);margin-left:auto;">' + matched.length + ' instance' + (matched.length === 1 ? '' : 's') + '</span>' +
    '</div>';
    return '<div style="margin-top:24px;border:1px solid var(--cream-dark);border-radius:10px;padding:16px;background:var(--surface-card,#fff);">' +
      '<h4 style="margin:0 0 12px;font-size:0.9rem;font-weight:600;">Cohorts</h4>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px;">' + chips + '</div>' +
      tableBlock +
      exportBar +
    '</div>';
  }

  function _kpiBox(label, val, sub) {
    return '<div style="flex:1;min-width:90px;padding:10px 12px;border:1px solid var(--cream-dark);border-radius:8px;background:var(--cream,#fbf6ee);">' +
      '<div style="font-size:0.72rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.04em;font-weight:600;">' + esc(label) + '</div>' +
      '<div style="font-size:1.6rem;font-weight:700;font-family:monospace;">' + (val == null ? '—' : String(val)) + '</div>' +
      (sub ? '<div style="font-size:0.72rem;color:var(--warm-gray);">' + esc(sub) + '</div>' : '') +
    '</div>';
  }

  // Loads aggregate doc + per-instance index for the given pass def from
  // derived-data collections maintained by indexPassAggregate CF. Cached for
  // the session; opening the same detail view is a no-op. Re-renders on data.
  function _kickPassDetailLoad(passDefId) {
    if (_passAggregateByDef[passDefId] && _passInstancesByDef[passDefId]) return;
    if (_passLoadingFor === passDefId) return;
    _passLoadingFor = passDefId;
    var aggP = MastDB.get('admin/passDefinitionAggregates/' + passDefId).catch(function() { return null; });
    var instP = MastDB.query('admin/passInstances').orderByChild('passDefId').equalTo(passDefId).once()
      .then(function(map) {
        return Object.keys(map || {}).map(function(k) { var v = map[k] || {}; v.__indexId = k; return v; });
      })
      .catch(function(err) { console.warn('[passes] instance load failed:', err && err.message); return []; });
    Promise.all([aggP, instP]).then(function(out) {
      _passAggregateByDef[passDefId] = out[0] || { passDefId: passDefId, sold: 0, active: 0, used: 0, expired: 0, revoked: 0 };
      _passInstancesByDef[passDefId] = out[1] || [];
    }).then(function() {
      _passLoadingFor = null;
      if (_passViewPid === passDefId) renderPassDefList();
    });
  }

  // ============================================================
  // Pass Definition Create / Edit
  // ============================================================

  async function showPassDefForm(passDefId) {
    var pd = passDefId ? passDefsData.find(function(p) { return p.id === passDefId; }) : null;
    var isNew = !pd;

    // Load classes for scope selector
    if (!classesLoaded) await loadClasses();

    hideAllViews();
    document.getElementById('bookPassDetailView').style.display = '';

    var content = document.getElementById('bookPassDetailContent');

    var typeOpts = PASS_TYPES.map(function(t) {
      return '<option value="' + t + '"' + (pd && pd.type === t ? ' selected' : '') + '>' + t.charAt(0).toUpperCase() + t.slice(1) + '</option>';
    }).join('');

    var statusOpts = CLASS_STATUSES.map(function(s) {
      return '<option value="' + s + '"' + (pd && pd.status === s ? ' selected' : '') + '>' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>';
    }).join('');

    var priorityOpts = PASS_PRIORITIES.map(function(p) {
      return '<option value="' + p + '"' + (pd && pd.priority === p ? ' selected' : '') + '>' + p.charAt(0).toUpperCase() + p.slice(1) + '</option>';
    }).join('');

    var activationOpts = ['purchase', 'first_use'].map(function(a) {
      return '<option value="' + a + '"' + (pd && pd.activationTrigger === a ? ' selected' : '') + '>' + (a === 'purchase' ? 'On Purchase' : 'On First Use') + '</option>';
    }).join('');

    var renewOpts = ['monthly', 'quarterly', 'yearly'].map(function(r) {
      return '<option value="' + r + '"' + (pd && pd.renewFrequency === r ? ' selected' : '') + '>' + r.charAt(0).toUpperCase() + r.slice(1) + '</option>';
    }).join('');

    // Class scope checkboxes
    var allowedIds = (pd && pd.allowedClassIds) || [];
    var classScopeHtml = classesData.filter(function(c) { return c.status === 'active'; }).map(function(c) {
      var checked = allowedIds.indexOf(c.id) !== -1 ? ' checked' : '';
      return '<label class="book-check" style="margin-bottom:6px;">' +
        '<input type="checkbox" name="passClassScope" value="' + esc(c.id) + '"' + checked + '> ' + esc(c.name) + '</label>';
    }).join('<br>');

    var html = '<h2 style="margin:0 0 1.5rem;font-size:1.6rem;">' + (isNew ? 'New Pass Definition' : 'Edit: ' + esc(pd.name)) + '</h2>' +
      '<form id="passDefForm" onsubmit="return false;" style="max-width:720px;">' +

      // ── Basic Info ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Basic Info</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field" style="grid-column:span 2;"><label class="form-label">Name <span class="book-required">*</span></label><input type="text" id="pdfName" class="form-input" value="' + esc(pd ? pd.name : '') + '" required placeholder="e.g. 10-Class Pack"></div>' +
      '<div class="book-field"><label class="form-label">Type <span class="book-required">*</span></label><select id="pdfType" class="form-input" onchange="window._passToggleFields()">' + typeOpts + '</select></div>' +
      '<div class="book-field"><label class="form-label">Status</label><select id="pdfStatus" class="form-input">' + statusOpts + '</select></div>' +
      '</div>' +
      '<div class="book-field"><label class="form-label">Description</label>' +
      '<textarea id="pdfDesc" class="form-input" rows="2" placeholder="What does this pass include?">' + esc(pd ? pd.description : '') + '</textarea></div>' +
      '</div>' +

      // ── Pricing & Terms ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Pricing &amp; Terms</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Price ($) <span class="book-required">*</span></label><input type="number" id="pdfPrice" class="form-input" min="0" step="0.01" value="' + (pd ? MastFormat.moneyRaw(pd.priceCents, { cents: true }) : '') + '" required></div>' +
      '<div class="book-field" id="pdfVisitCountWrap"><label class="form-label">Visit Count</label><input type="number" id="pdfVisitCount" class="form-input" min="1" value="' + (pd && pd.visitCount ? pd.visitCount : '') + '" placeholder="Unlimited">' +
      '<div class="book-field-hint">Leave blank for unlimited visits</div></div>' +
      '<div class="book-field"><label class="form-label">Validity (days)</label><input type="number" id="pdfValidityDays" class="form-input" min="1" value="' + (pd && pd.validityDays ? pd.validityDays : '') + '" placeholder="No limit">' +
      '<div class="book-field-hint">Days from activation until expiry</div></div>' +
      '<div class="book-field"><label class="form-label">Activation</label><select id="pdfActivation" class="form-input">' + activationOpts + '</select></div>' +
      '</div></div>' +

      // ── Options ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Options</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Priority</label><select id="pdfPriority" class="form-input">' + priorityOpts + '</select>' +
      '<div class="book-field-hint">Higher priority passes are auto-applied first</div></div>' +
      '<div class="book-field"><label class="form-label">Sort Order</label><input type="number" id="pdfSortOrder" class="form-input" min="0" value="' + (pd ? pd.sortOrder || 0 : 0) + '"></div>' +
      '<div class="book-field"><label class="form-label">Online Purchase</label><select id="pdfOnline" class="form-input"><option value="true"' + (pd && pd.onlinePurchasable === false ? '' : ' selected') + '>Yes</option><option value="false"' + (pd && pd.onlinePurchasable === false ? ' selected' : '') + '>No</option></select></div>' +
      '<div class="book-field"><label class="form-label">Intro Only</label><select id="pdfIntroOnly" class="form-input"><option value="false"' + (pd && pd.introOnly ? '' : ' selected') + '>No</option><option value="true"' + (pd && pd.introOnly ? ' selected' : '') + '>Yes</option></select></div>' +
      '</div></div>' +

      // ── Auto-Renew ──
      '<div class="book-form-section" id="pdfRenewFields">' +
      '<div class="book-form-section-title">Auto-Renew</div>' +
      '<div class="book-responsive-grid">' +
      '<div class="book-field"><label class="form-label">Auto-Renew</label><select id="pdfAutoRenew" class="form-input" onchange="window._passToggleFields()"><option value="false"' + (pd && pd.autoRenew ? '' : ' selected') + '>No</option><option value="true"' + (pd && pd.autoRenew ? ' selected' : '') + '>Yes</option></select></div>' +
      '<div class="book-field" id="pdfRenewFreqWrap"' + (pd && pd.autoRenew ? '' : ' style="display:none;"') + '><label class="form-label">Frequency</label><select id="pdfRenewFreq" class="form-input">' + renewOpts + '</select></div>' +
      '</div></div>' +

      // ── Class Scope ──
      '<div class="book-form-section">' +
      '<div class="book-form-section-title">Class Scope</div>' +
      '<div class="book-field-hint" style="margin-bottom:0.75rem;">Leave all unchecked to allow this pass for any class.</div>' +
      '<div style="max-height:200px;overflow-y:auto;padding:4px 0;">' +
      (classScopeHtml || '<p style="color:var(--warm-gray);text-align:center;">No active classes.</p>') +
      '</div></div>' +

      // ── Actions ──
      '<div class="book-form-actions">' +
      '<button class="btn btn-primary" onclick="window._passSave(\'' + (passDefId || '') + '\')">Save Pass Definition</button>' +
      '<button class="btn" onclick="window._passBackToList()">Cancel</button>' +
      '</div></form>';

    content.innerHTML = html;
    window._passToggleFields();
  }

  // Sync pass definition to public path for storefront access.
  // Only active + onlinePurchasable defs are published; others are removed.
  async function syncPassDefToPublic(passDefId, data) {
    var pubRef = MastDB.query('public/passDefinitions/' + passDefId);
    if (data.status === 'active' && data.onlinePurchasable) {
      await pubRef.set({
        name: data.name,
        description: data.description || null,
        type: data.type,
        priceCents: data.priceCents,
        visitCount: data.visitCount || null,
        validityDays: data.validityDays || null,
        allowedClassIds: data.allowedClassIds || null,
        allowedCategories: data.allowedCategories || null,
        introOnly: data.introOnly || false,
        sortOrder: data.sortOrder || 0,
        updatedAt: data.updatedAt
      });
    } else {
      await pubRef.remove();
    }
  }

  async function savePassDefinition(passDefId) {
    var name = document.getElementById('pdfName').value.trim();
    if (!name) { MastAdmin.showToast('Name is required', true); return; }

    var priceDollars = parseFloat(document.getElementById('pdfPrice').value);
    if (isNaN(priceDollars) || priceDollars < 0) { MastAdmin.showToast('Valid price is required', true); return; }

    var type = document.getElementById('pdfType').value;
    var visitCount = parseInt(document.getElementById('pdfVisitCount').value, 10) || null;
    var validityDays = parseInt(document.getElementById('pdfValidityDays').value, 10) || null;

    // For unlimited type, visitCount must be null
    if (type === 'unlimited') visitCount = null;

    // Collect class scope
    var scopeCheckboxes = document.querySelectorAll('input[name="passClassScope"]:checked');
    var allowedClassIds = scopeCheckboxes.length > 0 ? Array.from(scopeCheckboxes).map(function(cb) { return cb.value; }) : null;

    var data = {
      name: name,
      description: document.getElementById('pdfDesc').value.trim() || null,
      type: type,
      priceCents: Math.round(priceDollars * 100),
      visitCount: visitCount,
      validityDays: validityDays,
      activationTrigger: document.getElementById('pdfActivation').value,
      allowedClassIds: allowedClassIds,
      allowedCategories: null,
      autoRenew: document.getElementById('pdfAutoRenew').value === 'true',
      renewFrequency: document.getElementById('pdfAutoRenew').value === 'true' ? document.getElementById('pdfRenewFreq').value : null,
      onlinePurchasable: document.getElementById('pdfOnline').value === 'true',
      introOnly: document.getElementById('pdfIntroOnly').value === 'true',
      priority: document.getElementById('pdfPriority').value,
      sortOrder: parseInt(document.getElementById('pdfSortOrder').value, 10) || 0,
      status: document.getElementById('pdfStatus').value,
      updatedAt: new Date().toISOString()
    };

    try {
      var isNew = !passDefId;
      if (isNew) {
        passDefId = MastDB.passDefinitions.newKey();
        data.createdAt = data.updatedAt;
      }
      await MastDB.passDefinitions.set(passDefId, data);
      // Dual-write to public path for storefront access
      await syncPassDefToPublic(passDefId, data);
      MastAdmin.showToast(isNew ? 'Pass definition created!' : 'Pass definition updated!');
      passDefsLoaded = false;
      await loadPassDefinitions();
      switchSubTab('passes');
    } catch (err) {
      console.error('[Book] Pass definition save failed:', err);
      MastAdmin.showToast('Save failed: ' + err.message, true);
    }
  }

  // Bridge for the passes-v2 redesign twin (flag-gated #passes-v2). It delegates
  // create/update here so the pass-definition write (priceCents conversion, the
  // unlimited-type visitCount rule, the public dual-write via syncPassDefToPublic)
  // stays single-sourced — the twin never reimplements that logic. Additive; no
  // behavior change to the legacy surface. These mirror the EXACT client write
  // savePassDefinition() makes, parameterized by data (the legacy handler reads
  // the multi-section form DOM + the class-scope checkbox picker, so it can't be
  // called with an object). Per-instance issuing/redeeming + cohort tooling stay
  // on legacy. Mirrors window.InstructorsBridge / window.ContactsBridge.
  function _passBridgeData(data) {
    var type = data.type || 'pack';
    var visitCount = (data.visitCount === '' || data.visitCount == null) ? null : (parseInt(data.visitCount, 10) || null);
    // For unlimited type, visitCount must be null (mirrors savePassDefinition).
    if (type === 'unlimited') visitCount = null;
    var validityDays = (data.validityDays === '' || data.validityDays == null) ? null : (parseInt(data.validityDays, 10) || null);
    var autoRenew = data.autoRenew === true || data.autoRenew === 'true';
    var allowedClassIds = (data.allowedClassIds && data.allowedClassIds.length) ? data.allowedClassIds : null;
    return {
      name: (data.name || '').trim(),
      description: (data.description || '').trim() || null,
      type: type,
      priceCents: Math.round(parseFloat(data.priceDollars) * 100),
      visitCount: visitCount,
      validityDays: validityDays,
      activationTrigger: data.activationTrigger || 'purchase',
      allowedClassIds: allowedClassIds,
      allowedCategories: null,
      autoRenew: autoRenew,
      renewFrequency: autoRenew ? (data.renewFrequency || 'monthly') : null,
      onlinePurchasable: !(data.onlinePurchasable === false || data.onlinePurchasable === 'false'),
      introOnly: data.introOnly === true || data.introOnly === 'true',
      priority: data.priority || 'medium',
      sortOrder: parseInt(data.sortOrder, 10) || 0,
      status: data.status || 'draft',
      updatedAt: new Date().toISOString()
    };
  }
  window.PassesBridge = {
    // Per-holder cohorts for the passes-v2 Holders facet (V1-removal): the
    // SAME defs/matcher/query the legacy cohort block uses.
    cohortDefs: function () { return PASS_COHORTS.slice(); },
    instanceMatches: function (inst, key) { return _passInstanceMatches(inst, key); },
    loadInstances: async function (passDefId) {
      var snap = await MastDB.query('admin/passInstances').orderByChild('passDefId').equalTo(passDefId).once();
      var val = (snap && typeof snap.val === 'function') ? (snap.val() || {}) : (snap || {});
      return Object.keys(val).map(function (k) { return Object.assign({ _key: k }, val[k]); });
    },
    create: async function (data) {
      var rec = _passBridgeData(data);
      var id = MastDB.passDefinitions.newKey();
      rec.createdAt = rec.updatedAt;
      await MastDB.passDefinitions.set(id, rec);
      await syncPassDefToPublic(id, rec);
      passDefsLoaded = false;
      return id;
    },
    update: async function (id, data) {
      var rec = _passBridgeData(data);
      // savePassDefinition does a full .set() overwrite; preserve the server-owned
      // createdAt so the edit doesn't drop it (the twin doesn't render it).
      var existing = await MastDB.passDefinitions.get(id);
      if (existing && existing.createdAt) rec.createdAt = existing.createdAt;
      await MastDB.passDefinitions.set(id, rec);
      await syncPassDefToPublic(id, rec);
      passDefsLoaded = false;
      return id;
    },
    // Hard delete — ARCHIVED definitions only (sold pass instances reference
    // definition ids from user wallets; archive ends sales, delete is for
    // never-sold/retired defs). Cascades the public dual-write mirror.
    remove: async function (id) {
      var existing = await MastDB.passDefinitions.get(id);
      if (existing && existing.status === 'active') throw new Error('Archive the pass first (set status to archived), then delete.');
      await MastDB.passDefinitions.remove(id);
      await MastDB.remove('public/passDefinitions/' + id);
      passDefsLoaded = false;
      if (window.writeAudit) writeAudit('delete', 'passDefinition', id);
      return true;
    }
  };

  // ============================================================
  // Conflict Detection
  // ============================================================

  async function checkConflicts(date, startTime, endTime, instructorId, resourceId, excludeSessionId, additionalStaff) {
    additionalStaff = Array.isArray(additionalStaff) ? additionalStaff : [];
    // Collect every instructor id we need to check for overlap on this date —
    // the primary plus any additional-staff entries that link to an instructor
    // record. Freeform names have no schedule so they don't conflict.
    var extraStaffIds = additionalStaff
      .map(function(e) { return e && e.instructorId; })
      .filter(Boolean);
    if (!instructorId && !resourceId && extraStaffIds.length === 0) return [];
    var conflicts = [];

    try {
      // Query all sessions on the same date
      var snap = await MastDB.classSessions.query().orderByChild('date').equalTo(date).once('value');
      var sessions = snap.val() || {};

      Object.keys(sessions).forEach(function(id) {
        if (id === excludeSessionId) return;
        var s = sessions[id];
        if (s.status !== 'scheduled') return;

        // Check time overlap
        if (s.startTime >= endTime || s.endTime <= startTime) return;

        if (instructorId && s.instructorId === instructorId) {
          var instrName = instructorsMap[instructorId] ? instructorsMap[instructorId].name : 'Instructor';
          conflicts.push(instrName + ' is already assigned to a session at ' + formatTime(s.startTime) + ' on ' + formatDate(date));
        }
        if (resourceId && s.resourceId === resourceId) {
          var resName = resourcesMap[resourceId] ? resourcesMap[resourceId].name : 'Resource';
          conflicts.push(resName + ' is already booked at ' + formatTime(s.startTime) + ' on ' + formatDate(date));
        }
        // Additional-staff conflicts: a given instructor can't be primary on
        // another session AND additional-staff here at the same time. Soft
        // warning — surfaced like resource/instructor conflicts above.
        extraStaffIds.forEach(function(sid) {
          if (s.instructorId === sid) {
            var n = instructorsMap[sid] ? instructorsMap[sid].name : 'Staff member';
            conflicts.push(n + ' (additional staff) is the primary instructor on another session at ' + formatTime(s.startTime) + ' on ' + formatDate(date));
          }
          // Also: same person listed as additional-staff on another overlapping session.
          if (Array.isArray(s.additionalStaff)) {
            var dup = s.additionalStaff.some(function(e) { return e && e.instructorId === sid; });
            if (dup) {
              var n2 = instructorsMap[sid] ? instructorsMap[sid].name : 'Staff member';
              conflicts.push(n2 + ' (additional staff) is already booked on another session at ' + formatTime(s.startTime) + ' on ' + formatDate(date));
            }
          }
        });
      });
    } catch (err) {
      console.warn('[Book] Conflict check failed:', err);
    }

    return conflicts;
  }

  // ============================================================
  // Session Assignment Override
  // ============================================================

  async function assignToSession(sessionId, classId) {
    // Load instructors/resources if not loaded
    if (!instructorsLoaded) await loadInstructors();
    if (!resourcesLoaded) await loadResources();

    var session = sessionsData.find(function(s) { return s.id === sessionId; });
    if (!session) return;

    // Group by qualified/unqualified against the parent class's requiredSkills.
    // Operator can still pick anyone — this is a guide, not a block. Substitute
    // teachers, trainees shadowing, and co-teaches all need the override path.
    var parentClass = session && session.classId ? allClassesMap[session.classId] : null;
    var sessReqSkills = (parentClass && Array.isArray(parentClass.requiredSkills)) ? parentClass.requiredSkills : [];
    var activeInstrs = instructorsData.filter(function(i) { return i.status === 'active'; });
    function _sessOpt(i, marker, title) {
      var sel = session.instructorId === i.id ? ' selected' : '';
      var t = title ? ' title="' + _esc(title) + '"' : '';
      return '<option value="' + _esc(i.id) + '"' + sel + t + '>' + _esc((marker || '') + (i.name || '')) + '</option>';
    }
    var instrOpts;
    if (sessReqSkills.length === 0) {
      instrOpts = '<option value="">None</option>' + activeInstrs.map(function(i) { return _sessOpt(i); }).join('');
    } else {
      var qual = [], unqual = [];
      activeInstrs.forEach(function(i) {
        var missing = _missingSkills(i, sessReqSkills);
        (missing.length === 0 ? qual : unqual).push({ instr: i, missing: missing });
      });
      instrOpts = '<option value="">None</option>';
      if (qual.length) {
        instrOpts += '<optgroup label="Qualified (' + qual.length + ')">' +
          qual.map(function(o) { return _sessOpt(o.instr); }).join('') + '</optgroup>';
      }
      if (unqual.length) {
        instrOpts += '<optgroup label="Missing required skills (' + unqual.length + ')">' +
          unqual.map(function(o) {
            return _sessOpt(o.instr, '', 'Missing: ' + o.missing.map(_skillLabel).join(', '));
          }).join('') + '</optgroup>';
      }
    }

    var resOpts = '<option value="">None</option>' +
      resourcesData.filter(function(r) { return r.status === 'active'; }).map(function(r) {
        return '<option value="' + esc(r.id) + '"' + (session.resourceId === r.id ? ' selected' : '') + '>' + esc(r.name) + ' (' + esc(r.type) + ')</option>';
      }).join('');

    // Seed module-level state for the additional-staff editor. Cloned so cancel
    // doesn't mutate the on-disk record.
    _assignStaffState = Array.isArray(session.additionalStaff)
      ? JSON.parse(JSON.stringify(session.additionalStaff))
      : [];

    var html = '<div style="position:fixed;inset:0;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;z-index:9999;" id="assignOverlay">' +
      '<div style="background:var(--surface-dark);border:1px solid var(--border);border-radius:12px;padding:1.5rem;max-width:560px;width:90%;max-height:90vh;overflow-y:auto;">' +
      '<h3 style="margin:0 0 1rem;">Assign Session — ' + formatDate(session.date) + '</h3>' +
      '<div style="margin-bottom:1rem;"><label class="form-label">Instructor</label><select id="assignInstr" class="form-input">' + instrOpts + '</select></div>' +
      '<div style="margin-bottom:1rem;"><label class="form-label">Resource</label><select id="assignRes" class="form-input">' + resOpts + '</select></div>' +
      '<div style="margin-bottom:1.5rem;">' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">' +
          '<label class="form-label" style="margin:0;">Additional staff</label>' +
          '<button type="button" class="btn btn-secondary" style="font-size:0.78rem;padding:4px 10px;" onclick="window._assignAddStaffRow()">+ Add staff</button>' +
        '</div>' +
        '<div id="assignStaffList"></div>' +
        '<div class="book-field-hint">Track shadows, assistants, co-teachers, and observers. Only the primary instructor above is checked against required skills.</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;">' +
      '<button class="btn btn-primary" onclick="window._assignSave(\'' + esc(sessionId) + '\',\'' + esc(classId) + '\')">Save</button>' +
      '<button class="btn" onclick="document.getElementById(\'assignOverlay\').remove()">Cancel</button>' +
      '</div></div></div>';

    document.body.insertAdjacentHTML('beforeend', html);
    _renderAssignStaffList();
  }

  // ── Session additionalStaff editor ──
  // Module-level scratch state for the open assign overlay. Cleared when the
  // modal is dismissed (save or cancel).
  var _assignStaffState = [];
  var STAFF_ROLES = ['shadow', 'assist', 'co-teach', 'observer'];

  function _renderAssignStaffList() {
    var list = document.getElementById('assignStaffList');
    if (!list) return;
    if (_assignStaffState.length === 0) {
      list.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:4px 0;">No additional staff.</div>';
      return;
    }
    var activeInstrs = instructorsData.filter(function(i) { return i.status === 'active'; });
    list.innerHTML = _assignStaffState.map(function(entry, idx) {
      var instrOpts = '<option value="">— Freeform name —</option>' +
        activeInstrs.map(function(i) {
          return '<option value="' + _esc(i.id) + '"' + (entry.instructorId === i.id ? ' selected' : '') + '>' + _esc(i.name) + '</option>';
        }).join('');
      var roleOpts = STAFF_ROLES.map(function(r) {
        return '<option value="' + r + '"' + (entry.role === r ? ' selected' : '') + '>' + r + '</option>';
      }).join('');
      // Pattern matches the rest of the modal: stacked book-field rows with
      // form-input, no custom borders or backgrounds.
      return '<div data-staff-idx="' + idx + '" class="book-field" style="margin-bottom:1rem;">' +
        '<div style="display:flex;gap:6px;align-items:center;margin-bottom:6px;">' +
          '<select class="form-input" style="flex:1;" onchange="window._assignStaffField(' + idx + ',\'instructorId\',this.value)">' + instrOpts + '</select>' +
          '<select class="form-input" style="flex:0 0 140px;" onchange="window._assignStaffField(' + idx + ',\'role\',this.value)">' + roleOpts + '</select>' +
          '<button type="button" class="btn" aria-label="Remove" onclick="window._assignStaffRemove(' + idx + ')" style="padding:4px 10px;">Remove</button>' +
        '</div>' +
        (entry.instructorId ? '' :
          '<input type="text" class="form-input" data-staff-freeform style="margin-bottom:6px;"' +
            ' placeholder="Name (for staff not in the instructor list)" value="' + _esc(entry.freeformName || '') + '"' +
            ' oninput="window._assignStaffField(' + idx + ',\'freeformName\',this.value)">') +
        '<input type="text" class="form-input"' +
          ' placeholder="Notes (optional)" value="' + _esc(entry.notes || '') + '"' +
          ' oninput="window._assignStaffField(' + idx + ',\'notes\',this.value)">' +
        '</div>';
    }).join('');
  }

  window._assignAddStaffRow = function() {
    _assignStaffState.push({ instructorId: null, freeformName: '', role: 'assist', notes: '' });
    _renderAssignStaffList();
  };
  window._assignStaffRemove = function(idx) {
    _assignStaffState.splice(idx, 1);
    _renderAssignStaffList();
  };
  window._assignStaffField = function(idx, field, value) {
    if (!_assignStaffState[idx]) return;
    if (field === 'instructorId') {
      _assignStaffState[idx].instructorId = value || null;
      if (value) _assignStaffState[idx].freeformName = '';
      // Switching between "linked instructor" and "freeform" changes which
      // inputs are rendered, so full re-render. Other fields update state
      // only — preserving focus while the operator types into notes / name.
      _renderAssignStaffList();
    } else {
      _assignStaffState[idx][field] = value;
    }
  };

  async function saveSessionAssignment(sessionId, classId) {
    var instrId = document.getElementById('assignInstr').value || null;
    var resId = document.getElementById('assignRes').value || null;

    var session = sessionsData.find(function(s) { return s.id === sessionId; });
    if (!session) return;

    // Normalize additional-staff editor state into a clean array.
    // Drop entries with neither an instructorId nor a freeform name.
    var cleanedStaff = (_assignStaffState || []).map(function(e) {
      var entry = {
        instructorId: e.instructorId || null,
        freeformName: e.instructorId ? null : (e.freeformName || '').trim() || null,
        role: STAFF_ROLES.indexOf(e.role) !== -1 ? e.role : 'assist',
        notes: (e.notes || '').trim() || null
      };
      return entry;
    }).filter(function(e) { return e.instructorId || e.freeformName; });

    // Conflict check — primary + additional staff with linked instructorIds.
    var conflicts = await checkConflicts(session.date, session.startTime, session.endTime, instrId, resId, sessionId, cleanedStaff);
    if (conflicts.length > 0) {
      MastAdmin.showToast('Warning: ' + conflicts[0], true);
      // Non-blocking — proceed anyway
    }

    var update = {
      instructorId: instrId,
      instructorName: instrId && instructorsMap[instrId] ? instructorsMap[instrId].name : null,
      resourceId: resId,
      resourceName: resId && resourcesMap[resId] ? resourcesMap[resId].name : null,
      additionalStaff: cleanedStaff
    };

    try {
      await MastDB.classSessions.update(sessionId, update);
      MastAdmin.showToast('Session assignment updated');
      var overlay = document.getElementById('assignOverlay');
      if (overlay) overlay.remove();
      if (classId) loadClassDetail(classId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  }

  // ============================================================
  // Navigation helpers
  // ============================================================

  function backToList() {
    // MastNavStack-aware: pop and return to original context if any.
    if (window.MastNavStack && MastNavStack.size() > 0) {
      selectedClassId = null;
      hideAllViews();
      MastNavStack.popAndReturn();
      return;
    }
    selectedClassId = null;
    hideAllViews();
    document.getElementById('bookListView').style.display = '';
    switchSubTab('classes');
  }

  // ============================================================
  // Window-scoped callbacks (for onclick handlers in HTML)
  // ============================================================

  window._bookFilterType = function() { renderClassList(); };
  window._bookFilterStatus = function() { renderClassList(); };
  window._classListSort = function(key) {
    if (_classListSortKey === key) _classListSortDir = (_classListSortDir === 'asc') ? 'desc' : 'asc';
    else { _classListSortKey = key; _classListSortDir = ({ price:1, capacity:1 })[key] ? 'desc' : 'asc'; }
    renderClassList();
  };
  window._enrollSort = function(key) {
    if (_enrollSortKey === key) _enrollSortDir = (_enrollSortDir === 'asc') ? 'desc' : 'asc';
    else { _enrollSortKey = key; _enrollSortDir = ({ createdAt:1, paid:1 })[key] ? 'desc' : 'asc'; }
    renderEnrollmentList();
  };
  window._bookCreateClass = function() { showClassForm(null); };
  window._bookEditClass = function(id) { showClassForm(id); };
  window._bookViewClass = function(id) { loadClassDetail(id); };
  window._bookBackToList = function() { backToList(); };
  window._bookSaveClass = function(id) { saveClass(id || null); };
  window._bookGenerateSessions = function(id) {
    var cls = classesData.find(function(c) { return c.id === id; });
    if (cls) materializeSessions(id, cls).then(function() { loadClassDetail(id); });
  };

  // State-free publish core — fresh-reads the class, runs the pre-publish
  // checklist (throws a user-presentable Error listing the gaps), then flips
  // status. Shared by the legacy button and ClassesBridge (classes-v2 twin).
  async function _classPublishCore(id) {
    var cls = await MastDB.classes.get(id);
    if (!cls) throw new Error('Class not found');

    // Pre-publish checklist
    var issues = [];
    if (!cls.instructorId) issues.push('No instructor assigned');
    if (!cls.capacity || cls.capacity < 1) issues.push('Capacity not set');
    if (!cls.priceCents && cls.priceCents !== 0) issues.push('Price not set');
    if (!cls.schedule || (!cls.schedule.startDate && !cls.schedule.date)) issues.push('Schedule not configured');

    // Check sessions exist
    var sessVal = await MastDB.classSessions.byClass(id);
    if (!sessVal || Object.keys(sessVal).length === 0) issues.push('No sessions generated');

    if (issues.length > 0) throw new Error('Cannot publish:\n• ' + issues.join('\n• '));

    await MastDB.classes.update(id, { status: 'published', publishedAt: new Date().toISOString() });
    classesLoaded = false;
  }
  async function _classUnpublishCore(id) {
    await MastDB.classes.update(id, { status: 'draft' });
    classesLoaded = false;
  }

  window._bookPublishClass = async function(id) {
    try {
      // Checklist runs FIRST so the confirm only appears for a publishable class
      // (mirrors the original early-return ordering).
      var cls = await MastDB.classes.get(id);
      if (!cls) return;
      if (!await mastConfirm('Publish this class? It will appear on the public storefront.', { title: 'Publish Class' })) return;
      await _classPublishCore(id);
      MastAdmin.showToast('Class published!');
      await loadClasses();
      loadClassDetail(id);
    } catch (err) {
      MastAdmin.showToast(err.message.indexOf('Cannot publish') === 0 ? err.message : ('Failed: ' + err.message), true);
    }
  };

  window._bookUnpublishClass = async function(id) {
    if (!await mastConfirm('Unpublish this class? It will be hidden from the storefront.', { title: 'Unpublish Class' })) return;
    try {
      await _classUnpublishCore(id);
      MastAdmin.showToast('Class unpublished — back to draft');
      await loadClasses();
      loadClassDetail(id);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };
  window._bookCancelSession = function(id) { cancelSession(id); };
  window._bookCompleteSession = function(id) { completeSession(id); };
  window._bookViewSessionEnrollments = function(sessionId, classId) { loadEnrollments(sessionId, classId); };
  window._enrollView = function(id) { _enrollViewId = id; renderEnrollmentList(); };
  window._enrollViewBack = function() { _enrollViewId = null; renderEnrollmentList(); };
  window._bookMarkAttended = function(id) { updateEnrollmentStatus(id, 'completed'); };
  window._bookMarkLate = function(id) { updateEnrollmentStatus(id, 'late'); };
  window._bookMarkNoShow = function(id) { updateEnrollmentStatus(id, 'no-show'); };
  // State-free cancel core — status write + waitlist counter decrement +
  // renumbering. NO confirm dialog, NO toast, NO view refresh (callers own UI).
  async function _enrollCancelCore(id) {
    var enrollment = await _enrollSetStatusCore(id, 'cancelled');
    if (enrollment && enrollment.status === 'waitlisted') {
      // Decrement waitlist counter
      var isSeries = enrollment.enrollmentType === 'series';
      if (isSeries) {
        await MastDB.transaction(MastDB.classes.PATH + '/' + enrollment.classId + '/seriesWaitlisted', function(c) { return Math.max(0, (c || 0) - 1); });
      } else if (enrollment.sessionId) {
        await adjustSessionCount(enrollment.sessionId, 'waitlisted', -1);
      }
      await renumberWaitlist(enrollment.classId, enrollment.sessionId, isSeries);
    }
  }

  window._bookCancelEnrollment = async function(id) {
    if (!await mastConfirm('Cancel this enrollment?', { title: 'Cancel Enrollment', danger: true })) return;
    try {
      await _enrollCancelCore(id);
      MastAdmin.showToast('Enrollment updated');
      var classFilter = (document.getElementById('enrollFilterClass') || {}).value;
      loadEnrollments(null, classFilter);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };
  window._bookConfirmEnrollment = function(id) { updateEnrollmentStatus(id, 'confirmed'); };

  // State-free promote core — capacity check, seat/waitlist counters, status
  // write, renumbering, waitlist CS-ticket side effect. NO toast, NO view
  // refresh. Throws Error with a user-presentable message on any blocker.
  async function _enrollPromoteCore(enrollmentId) {
      var enrollment = await MastDB.enrollments.get(enrollmentId);
      if (!enrollment || enrollment.status !== 'waitlisted') {
        throw new Error('Enrollment not found or not waitlisted');
      }

      // Check capacity
      var sessionId = enrollment.sessionId;
      var classId = enrollment.classId;
      var isSeries = enrollment.enrollmentType === 'series';

      if (isSeries) {
        var cls = await MastDB.classes.get(classId);
        if (cls && (cls.seriesEnrolled || 0) >= (cls.capacity || 0)) {
          throw new Error('No series spots available. Increase capacity first.');
        }
        // Increment series enrolled, decrement series waitlisted
        await MastDB.transaction(MastDB.classes.PATH + '/' + classId + '/seriesEnrolled', function(c) { return (c || 0) + 1; });
        await MastDB.transaction(MastDB.classes.PATH + '/' + classId + '/seriesWaitlisted', function(c) { return Math.max(0, (c || 0) - 1); });
      } else {
        if (sessionId) {
          var sess = await MastDB.classSessions.get(sessionId);
          if (sess && (sess.enrolled || 0) >= (sess.capacity || 0)) {
            throw new Error('No spots available in this session. Increase capacity first.');
          }
          await adjustSessionCount(sessionId, 'enrolled', 1);
          await adjustSessionCount(sessionId, 'waitlisted', -1);
        }
      }

      // Update enrollment to confirmed
      await MastDB.enrollments.update(enrollmentId, {
        status: 'confirmed',
        waitlistPosition: null,
        promotedAt: new Date().toISOString()
      });

      // Renumber remaining waitlisted enrollments
      await renumberWaitlist(classId, sessionId, isSeries);

      // Auto-create CS ticket so the offer is tracked and the student has a reply path
      bookCreateWaitlistTicket(enrollment, classId, isSeries, cls, sess)
        .catch(function(e) { console.warn('[book] waitlist ticket creation failed:', e); });
  }

  window._bookPromoteWaitlist = async function(enrollmentId) {
    try {
      await _enrollPromoteCore(enrollmentId);
      MastAdmin.showToast('Promoted to confirmed');
      var classFilter = (document.getElementById('enrollFilterClass') || {}).value;
      loadEnrollments(null, classFilter);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  async function renumberWaitlist(classId, sessionId, isSeries) {
    try {
      var snap;
      if (isSeries) {
        snap = await MastDB.enrollments.byClass(classId);
      } else if (sessionId) {
        snap = await MastDB.enrollments.bySession(sessionId);
      } else {
        return;
      }
      var data = snap.val() || {};
      var waitlisted = Object.keys(data).map(function(id) {
        var e = data[id]; e._id = id; return e;
      }).filter(function(e) {
        if (e.status !== 'waitlisted') return false;
        if (isSeries) return e.enrollmentType === 'series' && e.classId === classId;
        return true;
      }).sort(function(a, b) {
        return (a.waitlistPosition || 999) - (b.waitlistPosition || 999);
      });

      // Per-doc writes — the old multi-path update against 'admin/enrollments'
      // (wrong collection AND RTDB-style fan-out) threw "path requires doc ID"
      // on every renumber, so positions silently never compacted (caught by
      // the classes-v2 walk, 2026-06-10).
      for (var ri = 0; ri < waitlisted.length; ri++) {
        if (waitlisted[ri].waitlistPosition !== ri + 1) {
          await MastDB.enrollments.update(waitlisted[ri]._id, { waitlistPosition: ri + 1 });
        }
      }
    } catch (err) {
      console.warn('[Book] Waitlist renumbering failed:', err);
    }
  }

  async function bookCreateWaitlistTicket(enrollment, classId, isSeries, cls, sess) {
    var contactEmail = enrollment.studentEmail || enrollment.customerEmail;
    if (!contactEmail) return;

    var contactName = enrollment.studentName || enrollment.customerName || null;
    var className = (allClassesMap[classId] && allClassesMap[classId].name) ||
                    (cls && cls.name) || classId || 'class';

    var rawDate = isSeries
      ? (cls && cls.schedule && (cls.schedule.date || cls.schedule.startDate))
      : (sess && sess.date);
    var sessionDate = rawDate ? formatDate(rawDate) : null;

    var subject = 'Waitlist spot available: ' + className + (sessionDate ? ' — ' + sessionDate : '');
    var body = 'A waitlist spot has been offered in ' + className +
               (sessionDate ? ' on ' + sessionDate : '') + '. ' +
               'Contact: ' + contactEmail + '.';
    var msgBody = 'A spot has opened in ' + className +
                  (sessionDate ? ' on ' + sessionDate : '') +
                  '. Please reply to this message or re-book directly within 24 hours to claim your spot.';

    // Allocate the human-facing ticket number ATOMICALLY. The old
    // get→compute→write-back raced under concurrent ticket creation: two
    // simultaneous waitlist offers both read the same nextNumber and minted
    // the same T-#### number, then both wrote nextNumber+1 (advancing by one,
    // not two). A Firestore transaction read-modify-writes the counter in one
    // atomic step (server read, retried on contention), so each concurrent
    // ticket gets a distinct number and the counter advances once per ticket.
    // The closure replaces the whole doc, so copy existing fields forward;
    // read the allocated number back from the committed value.
    var prefix = 'T';
    var nextNum = 1;
    var txRes = await MastDB.transaction('cs_config/ticketing', function(cur) {
      var doc = (cur && typeof cur === 'object') ? cur : {};
      var next = {};
      for (var f in doc) next[f] = doc[f];
      next.prefix = doc.prefix || 'T';
      next.nextNumber = (typeof doc.nextNumber === 'number' ? doc.nextNumber : 1) + 1;
      return next;
    });
    if (txRes && txRes.value && typeof txRes.value.nextNumber === 'number') {
      prefix = txRes.value.prefix || 'T';
      nextNum = txRes.value.nextNumber - 1;
    }
    var ticketNumber = prefix + '-' + String(nextNum).padStart(4, '0');
    var ticketId = 'ticket_' + Date.now().toString(36);
    var msgId = 'msg_' + Date.now().toString(36);
    var now = new Date().toISOString();

    await MastDB.set('cs_tickets/' + ticketId, {
      id: ticketId,
      ticketNumber: ticketNumber,
      subject: subject,
      status: 'open',
      priority: 'normal',
      source: 'inquiry',
      contactEmail: contactEmail,
      contactName: contactName,
      body: body,
      createdAt: now,
      updatedAt: now
    });

    await MastDB.set('cs_tickets/' + ticketId + '/messages/' + msgId, {
      id: msgId,
      body: msgBody,
      direction: 'outbound',
      isInternal: false,
      authorName: 'System',
      authorEmail: null,
      createdAt: now
    });

    // Counter already advanced atomically above — no write-back needed here.

    console.log('[book] Waitlist ticket created:', ticketNumber, 'for', contactEmail);
  }

  window._enrollFilterStatus = function() { renderEnrollmentList(); };
  window._enrollFilterClass = function() {
    var classFilter = document.getElementById('enrollFilterClass').value;
    loadEnrollments(null, classFilter);
  };

  function _renderClassImagePreview() {
    if (editingClassImageUrl) {
      return '<div style="display:flex;align-items:center;gap:12px;">' +
        '<div style="width:120px;height:120px;border-radius:8px;overflow:hidden;background:var(--cream);">' +
          '<img src="' + esc(editingClassImageUrl) + '" style="width:100%;height:100%;object-fit:cover;" loading="lazy">' +
        '</div>' +
        '<button type="button" class="btn btn-secondary" style="font-size:0.78rem;" onclick="window._bookRemoveClassImage()">Remove</button>' +
      '</div>';
    }
    return '<div style="padding:16px;background:var(--cream);border-radius:8px;color:var(--warm-gray);font-size:0.85rem;text-align:center;">No image selected.</div>';
  }

  function _refreshClassImagePreview() {
    var wrap = document.getElementById('bcfImagePreviewWrap');
    if (wrap) wrap.innerHTML = _renderClassImagePreview();
  }

  window._bookSelectClassImage = function() {
    if (typeof window.openImagePicker !== 'function') {
      MastAdmin.showToast('Image picker unavailable', true);
      return;
    }
    window.openImagePicker(function(imgId, url) {
      editingClassImageUrl = url;
      _refreshClassImagePreview();
    });
  };

  window._bookRemoveClassImage = function() {
    editingClassImageUrl = null;
    _refreshClassImagePreview();
  };

  window._bookUploadClassImage = async function(fileInput) {
    if (!fileInput.files || !fileInput.files[0]) return;
    var file = fileInput.files[0];
    try {
      MastAdmin.showToast('Uploading image...');
      var reader = new FileReader();
      reader.onload = async function(e) {
        try {
          var base64 = e.target.result.split(',')[1];
          var token = await window.auth.currentUser.getIdToken();
          var resp = await window.callCF('/uploadImage', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
            body: JSON.stringify({ image: base64, tags: ['class'], source: 'admin-upload' })
          });
          var result = await resp.json();
          if (!result.success) throw new Error(result.error || 'Upload failed');
          editingClassImageUrl = result.url;
          _refreshClassImagePreview();
          MastAdmin.showToast('Image uploaded');
        } catch (err) {
          MastAdmin.showToast('Upload failed: ' + err.message, true);
        }
      };
      reader.readAsDataURL(file);
    } catch (err) {
      MastAdmin.showToast('Error: ' + err.message, true);
    }
  };

  window._bookToggleSeriesFields = function() {
    var type = (document.getElementById('bcfType') || {}).value;
    var fields = document.getElementById('bcfSeriesFields');
    if (fields) fields.style.display = type === 'series' ? '' : 'none';
  };

  window._bookToggleSchedType = function() {
    var schedType = document.querySelector('input[name="schedType"]:checked');
    if (!schedType) return;
    var recurring = document.getElementById('bcfSchedRecurring');
    var once = document.getElementById('bcfSchedOnce');
    if (recurring) recurring.style.display = schedType.value === 'recurring' ? '' : 'none';
    if (once) once.style.display = schedType.value === 'once' ? '' : 'none';
  };

  window._bookToggleMaterialsCost = function() {
    var included = (document.getElementById('bcfMaterials') || {}).value === 'true';
    var wrap = document.getElementById('bcfMaterialsCostWrap');
    if (wrap) wrap.style.display = included ? 'none' : '';
  };

  window._bookToggleWaiverTemplate = function() {
    var requiresWaiver = (document.getElementById('bcfRequiresWaiver') || {}).value === 'true';
    var wrap = document.getElementById('bcfWaiverTemplateWrap');
    if (wrap) wrap.style.display = requiresWaiver ? '' : 'none';
    if (requiresWaiver) _bookLoadWaiverTemplateOptions();
  };

  var _waiverTemplatesCache = null;
  async function _bookLoadWaiverTemplateOptions() {
    var select = document.getElementById('bcfWaiverTemplate');
    if (!select) return;
    if (_waiverTemplatesCache) {
      _bookPopulateWaiverSelect(select, _waiverTemplatesCache);
      return;
    }
    try {
      var val = (await MastDB.get('settings/waiverTemplates')) || {};
      _waiverTemplatesCache = Object.entries(val).map(function(e) { return { id: e[0], title: e[1].title || 'Untitled', status: e[1].status }; })
        .filter(function(w) { return w.status === 'active'; });
      _bookPopulateWaiverSelect(select, _waiverTemplatesCache);
    } catch (err) {
      select.innerHTML = '<option value="">Error loading templates</option>';
    }
  }

  function _bookPopulateWaiverSelect(select, templates) {
    // Get current class waiverTemplateId to pre-select
    var currentId = select.getAttribute('data-current') || '';
    var html = '<option value="">(Use default waiver)</option>';
    templates.forEach(function(w) {
      html += '<option value="' + esc(w.id) + '"' + (w.id === currentId ? ' selected' : '') + '>' + esc(w.title) + '</option>';
    });
    select.innerHTML = html;
  }

  // Sub-tab navigation
  window._bookSubTab = function(tab) { switchSubTab(tab); };

  // Instructor callbacks
  window._instrFilterStatus = function() { renderInstructorList(); };
  window._instrCreate = function() { showInstructorForm(null); };
  window._instrEdit = function(id) { showInstructorForm(id); };
  window._instrView = function(id) { _instrViewId = id; renderInstructorList(); };
  window._instrViewBack = function() { _instrViewId = null; renderInstructorList(); };
  window._instrSave = function(id) { saveInstructor(id || null); };
  window._instrBackToList = function() { switchSubTab('instructors'); };

  // Resource callbacks
  window._resFilterType = function() { renderResourceList(); };
  window._resFilterStatus = function() { renderResourceList(); };
  window._resCreate = function() { showResourceForm(null); };
  window._resEdit = function(id) { showResourceForm(id); };
  window._resSave = function(id) { saveResource(id || null); };
  window._resBackToList = function() { switchSubTab('resources'); };

  // Pass definition callbacks
  window._passFilterType = function() { renderPassDefList(); };
  window._passFilterStatus = function() { renderPassDefList(); };
  window._passCreate = function() { showPassDefForm(null); };
  window._passEdit = function(id) { showPassDefForm(id); };
  window._passView = function(id) { _passViewPid = id; renderPassDefList(); };
  // _passViewBack — distinct from _passBackToList (assigned below for the form
  // Cancel button) to avoid an assignment collision. Both effectively go
  // back to the list, but the read-view's path also clears the detail state
  // so the next renderPassDefList doesn't bounce back into detail.
  window._passViewBack = function() { _passViewPid = null; renderPassDefList(); };
  window._passSave = function(id) { savePassDefinition(id || null); };
  window._passBackToList = function() { _passViewPid = null; switchSubTab('passes'); };

  // Cohort drill-down callbacks (read aggregate + index docs maintained by
  // indexPassAggregate CF; cohort filters computed client-side from instances).
  window._passCohortPick = function(key) {
    _passSelectedCohort = key;
    renderPassDefList();
  };
  window._passInstanceSort = function(key) {
    if (_passInstanceSortKey === key) {
      _passInstanceSortDir = _passInstanceSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      _passInstanceSortKey = key;
      _passInstanceSortDir = (key === 'expiresAt' || key === 'activatedAt' || key === 'lastUsedAt') ? 'desc' : 'asc';
    }
    renderPassDefList();
  };
  window._passOpenCustomer = function(customerId) {
    if (!customerId) return;
    window.location.hash = '#customers?id=' + encodeURIComponent(customerId);
  };
  function _passCohortMatchedInstances() {
    var list = _passInstancesByDef[_passViewPid] || [];
    return list.filter(function(inst) { return _passInstanceMatches(inst, _passSelectedCohort); });
  }
  window._passCohortCopyEmails = function() {
    var emails = _passCohortMatchedInstances().map(function(i) { return i.customerEmail; }).filter(Boolean);
    var text = emails.join(', ');
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        if (window.mastToast) window.mastToast('Copied ' + emails.length + ' email' + (emails.length === 1 ? '' : 's'));
      });
    } else {
      window.prompt('Copy emails:', text);
    }
  };
  window._passCohortDownloadCsv = function() {
    var rows = _passCohortMatchedInstances();
    if (!rows.length) return;
    var header = ['customerName', 'customerEmail', 'status', 'visitsRemaining', 'visitsUsed', 'activatedAt', 'expiresAt', 'lastUsedAt'];
    // Cells run through the shared _csvCell guard (formula-injection-safe quoting:
    // prefixes "'" to =,+,-,@,tab,CR-leading cells + RFC-4180 quoting). Defensive
    // RFC-only fallback if the shell global is absent.
    var cell = (typeof window._csvCell === 'function')
      ? window._csvCell
      : function (s) { var v = String(s == null ? '' : s); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    var lines = [header.join(',')];
    rows.forEach(function(r) {
      lines.push(header.map(function(k) { return cell(r[k] == null ? '' : r[k]); }).join(','));
    });
    var blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'pass-cohort-' + _passViewPid + '-' + _passSelectedCohort + '.csv';
    a.click();
    setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
  };
  window._passToggleFields = function() {
    var type = document.getElementById('pdfType');
    var visitWrap = document.getElementById('pdfVisitCountWrap');
    var renewFreqWrap = document.getElementById('pdfRenewFreqWrap');
    var autoRenew = document.getElementById('pdfAutoRenew');
    if (type && visitWrap) visitWrap.style.display = type.value === 'unlimited' ? 'none' : '';
    if (autoRenew && renewFreqWrap) renewFreqWrap.style.display = autoRenew.value === 'true' ? '' : 'none';
  };

  // Session assignment
  window._bookAssignSession = function(sessionId, classId) { assignToSession(sessionId, classId); };
  window._assignSave = function(sessionId, classId) { saveSessionAssignment(sessionId, classId); };

  // ============================================================
  // Auto-Cancellation Logic
  // ============================================================

  async function checkAutoCancellation() {
    MastAdmin.showToast('Checking for under-enrolled classes...');
    var today = new Date();
    var flagged = [];

    // Filter classes with minEnrollment set
    var eligibleClasses = classesData.filter(function(c) {
      return c.status === 'active' && c.minEnrollment && c.minEnrollment > 0;
    });

    if (eligibleClasses.length === 0) {
      MastAdmin.showToast('No classes with minimum enrollment requirements found.');
      return;
    }

    for (var i = 0; i < eligibleClasses.length; i++) {
      var cls = eligibleClasses[i];
      var leadDays = cls.cancellationLeadDays || 2;

      try {
        var sessData = (await MastDB.classSessions.byClass(cls.id)) || {};
        var sessionIds = Object.keys(sessData);

        for (var j = 0; j < sessionIds.length; j++) {
          var sid = sessionIds[j];
          var session = sessData[sid];
          if (session.status !== 'scheduled') continue;

          // Parse session date
          var parts = session.date.split('-');
          var sessionDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
          var diffMs = sessionDate.getTime() - today.getTime();
          var daysUntil = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

          // Check if within cancellation lead window
          if (daysUntil >= 0 && daysUntil <= leadDays) {
            var totalEnrolled = (cls.seriesEnrolled || 0) + (session.enrolled || 0);
            if (totalEnrolled < cls.minEnrollment) {
              flagged.push({
                classId: cls.id,
                className: cls.name,
                sessionId: sid,
                sessionDate: session.date,
                sessionTime: session.startTime,
                enrolled: totalEnrolled,
                minRequired: cls.minEnrollment,
                daysUntil: daysUntil
              });
            }
          }
        }
      } catch (err) {
        console.error('[book] Error checking class ' + cls.id + ':', err);
      }
    }

    if (flagged.length === 0) {
      MastAdmin.showToast('All classes meet minimum enrollment requirements.');
      return;
    }

    // Show confirmation dialog
    var msg = 'The following sessions are under-enrolled and within the cancellation window:\n\n';
    flagged.forEach(function(f) {
      msg += '- ' + f.className + ' (' + f.sessionDate + '): ' + f.enrolled + '/' + f.minRequired + ' enrolled, ' + f.daysUntil + ' day(s) away\n';
    });
    msg += '\nCancel these sessions and notify enrolled students?';

    if (!await mastConfirm(msg, { title: 'Cancel Sessions', danger: true })) return;

    // Execute cancellation for each flagged session
    var totalAffected = 0;
    for (var k = 0; k < flagged.length; k++) {
      var f = flagged[k];
      try {
        var affected = await executeCancellation(f.sessionId, f.classId);
        totalAffected += affected.length;
      } catch (err) {
        console.error('[book] Failed to cancel session ' + f.sessionId + ':', err);
        MastAdmin.showToast('Failed to cancel ' + f.className + ' session: ' + err.message, true);
      }
    }

    MastAdmin.showToast('Cancelled ' + flagged.length + ' session(s), ' + totalAffected + ' enrollment(s) affected.');
    // Refresh class list
    loadClasses();
  }

  async function executeCancellation(sessionId, classId) {
    var cls = classesData.find(function(c) { return c.id === classId; }) || {};
    var affected = [];

    // 1. Cancel the session
    await MastDB.classSessions.update(sessionId, {
      status: 'cancelled',
      cancelReason: 'Insufficient enrollment (auto-check)',
      cancelledAt: new Date().toISOString()
    });

    // 2. Fetch all enrollments for this session from public/enrollments
    var enrollData = await MastDB.query('public/enrollments')
      .orderByChild('sessionId').equalTo(sessionId).once();
    var enrollIds = Object.keys(enrollData);

    // 3. Bulk-cancel confirmed/waitlisted enrollments
    var updates = {};
    var now = new Date().toISOString();
    enrollIds.forEach(function(eid) {
      var e = enrollData[eid];
      if (e.status === 'confirmed' || e.status === 'waitlisted') {
        updates['public/enrollments/' + eid + '/status'] = 'cancelled_insufficient_enrollment';
        updates['public/enrollments/' + eid + '/cancelledAt'] = now;
        updates['public/enrollments/' + eid + '/cancelReason'] = 'Class cancelled: minimum enrollment not met';
        affected.push({
          enrollmentId: eid,
          studentUid: e.studentUid,
          studentEmail: e.studentEmail,
          studentName: e.studentName,
          pricePaid: e.pricePaid || 0,
          enrollmentType: e.enrollmentType,
          orderId: e.orderId || null
        });
      }
    });

    if (Object.keys(updates).length > 0) {
      await MastDB.multiUpdate(updates);
    }

    // 4. Create wallet credits for affected students
    for (var i = 0; i < affected.length; i++) {
      var student = affected[i];
      if (!student.studentUid) continue;

      var creditAmount = 0;
      if (student.enrollmentType === 'series' && cls.seriesInfo && cls.seriesInfo.seriesPriceCents && cls.seriesInfo.totalSessions) {
        creditAmount = Math.round(cls.seriesInfo.seriesPriceCents / cls.seriesInfo.totalSessions);
      } else {
        creditAmount = student.pricePaid || 0;
      }

      if (creditAmount > 0) {
        await MastDB.push('public/accounts/' + student.studentUid + '/wallet/credits', {
          amountCents: creditAmount,
          source: 'cancellation',
          sourceId: student.enrollmentId,
          sourceDetail: 'Class cancelled: ' + (cls.name || 'Unknown') + ' (' + sessionId + ')',
          status: 'active',
          createdAt: now,
          usedAt: null,
          usedOrderId: null,
          expiresAt: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString() // 6 months
        });
      }
    }

    return affected;
  }

  window._bookCheckCancellations = function() { checkAutoCancellation(); };

  // ============================================================
  // Session Lifecycle — Check-In, Start, Close-Out
  // ============================================================

  var INCIDENT_TYPES = ['equipment_damage', 'safety', 'conduct', 'medical'];
  var INCIDENT_SEVERITIES = ['low', 'medium', 'high', 'critical'];
  var INCIDENT_TYPE_LABELS = { equipment_damage: 'Equipment Damage', safety: 'Safety', conduct: 'Conduct', medical: 'Medical' };
  var SEVERITY_COLORS = { low: '#4DB6AC', medium: '#FFD54F', high: '#FF8A65', critical: '#EF9A9A' };
  var WAIVER_STATUSES = ['na', 'signed', 'missing', 'expired'];
  var CLOSEOUT_STATUSES = ['completed', 'incomplete', 'no-show', 'late'];
  var opsSessionId = null;
  var opsClassId = null;

  window._bookBackFromOps = function() {
    if (opsClassId) loadClassDetail(opsClassId);
    else { loadClasses(); switchSubTab('classes'); }
  };

  // --- Manage Session (Enrollment Lifecycle) ---

  window._bookManageSession = async function(sessionId, classId) {
    opsSessionId = sessionId;
    opsClassId = classId;
    hideAllViews();
    document.getElementById('bookSessionOpsView').style.display = '';

    var content = document.getElementById('sessionOpsContent');
    content.innerHTML = LOADING_HTML;

    try {
      var [sessData, clsData_, enrollSnap] = await Promise.all([
        MastDB.classSessions.get(sessionId),
        MastDB.classes.get(classId),
        MastDB.enrollments.bySession(sessionId)
      ]);

      var session = sessData || {};
      var cls = clsData_ || {};
      var enrollments = enrollSnap.val() || {};

      var students = Object.keys(enrollments).map(function(id) {
        var e = enrollments[id]; e._id = id; return e;
      }).filter(function(e) { return e.status !== 'cancelled'; });

      students.sort(function(a, b) { return (a.customerName || '').localeCompare(b.customerName || ''); });

      // Determine session phase
      var isStarted = !!session.classStartedAt;
      var isClosed = session.status === 'completed';
      var checkedInCount = students.filter(function(s) { return s.status === 'checked-in'; }).length;
      var closedOutCount = students.filter(function(s) { return ['completed', 'incomplete', 'no-show', 'attended-pending-waiver', 'late'].indexOf(s.status) !== -1; }).length;
      var confirmedCount = students.filter(function(s) { return s.status === 'confirmed'; }).length;

      var phaseLabel = isClosed ? 'Completed' : isStarted ? 'In Progress' : 'Check-In';

      document.getElementById('sessionOpsTitle').textContent =
        esc(cls.name || 'Class') + ' \u2014 ' + formatDate(session.date) + ' ' + formatTime(session.startTime);

      var html = '';

      // ── Step indicator ──
      var steps = [
        { key: 'checkin', label: 'Check-In', num: '1' },
        { key: 'start', label: 'Start Class', num: '2' },
        { key: 'inprogress', label: 'In Progress', num: '3' },
        { key: 'closeout', label: 'Close Out', num: '4' },
        { key: 'completed', label: 'Completed', num: '\u2713' }
      ];
      // Determine current step index
      var currentStep = 0; // check-in
      if (isStarted && !isClosed && closedOutCount < students.length) currentStep = 2; // in progress
      else if (isStarted && !isClosed && closedOutCount >= students.length && students.length > 0) currentStep = 3; // close out ready
      else if (isStarted && !isClosed) currentStep = 2; // in progress
      else if (isClosed) currentStep = 4; // completed
      if (!isStarted && checkedInCount > 0) currentStep = 1; // ready to start

      html += '<div class="book-stepper">';
      steps.forEach(function(step, i) {
        var cls = i < currentStep ? 'done' : i === currentStep ? 'active' : '';
        var dot = i < currentStep ? '\u2713' : step.num;
        if (i > 0) html += '<div class="book-step-line' + (i <= currentStep ? ' done' : '') + '"></div>';
        html += '<div class="book-step ' + cls + '">';
        html += '<div class="book-step-dot">' + dot + '</div>';
        html += '<span>' + step.label + '</span>';
        html += '</div>';
      });
      html += '</div>';

      // ── Session info bar ──
      html += '<div style="display:flex;gap:12px;align-items:center;margin-bottom:1rem;font-size:0.85rem;color:var(--warm-gray);flex-wrap:wrap;">';
      if (session.instructorName) html += '<span>Instructor: ' + esc(session.instructorName) + '</span>';
      if (session.resourceName) html += '<span>Room: ' + esc(session.resourceName) + '</span>';
      if (Array.isArray(session.additionalStaff) && session.additionalStaff.length > 0) {
        var staffSummary = session.additionalStaff.map(function(e) {
          var nm = e.instructorId && instructorsMap[e.instructorId]
            ? instructorsMap[e.instructorId].name
            : (e.freeformName || 'Unnamed');
          return _esc(nm) + ' (' + _esc(e.role || 'assist') + ')';
        }).join(', ');
        html += '<span>Also: ' + staffSummary + '</span>';
      }
      html += '<span style="margin-left:auto;">' + students.length + ' student' + (students.length !== 1 ? 's' : '') + '</span>';
      html += '</div>';

      // ── Walk-in enrollment (check-in & in-progress phases) ──
      if (!isClosed) {
        html += '<div style="margin-bottom:1rem;">';
        html += '<div id="walkinSearchWrap" style="display:none;margin-bottom:12px;">';
        html += '<div class="book-form-section" style="margin:0;">';
        html += '<div class="book-form-section-title">Add Walk-in Student</div>';
        html += '<input type="text" id="walkinSearchInput" class="form-input" placeholder="Search by name or email..." oninput="window._bookWalkinSearch(this.value, \'' + esc(sessionId) + '\', \'' + esc(classId) + '\')" style="margin-bottom:8px;">';
        html += '<div id="walkinResults"></div>';
        html += '<div style="margin-top:8px;font-size:0.78rem;color:var(--warm-gray);">Or <a href="#" style="color:var(--teal);" onclick="event.preventDefault();window._bookWalkinManual(\'' + esc(sessionId) + '\', \'' + esc(classId) + '\')">add manually</a> if student not found</div>';
        html += '</div></div>';
        html += '<button class="btn btn-small" onclick="var w=document.getElementById(\'walkinSearchWrap\');w.style.display=w.style.display===\'none\'?\'block\':\'none\';if(w.style.display!==\'none\')document.getElementById(\'walkinSearchInput\').focus();">+ Walk-in</button>';
        html += '</div>';
      }

      // ── Enrollment cards ──
      if (students.length === 0) {
        html += bookEmptyState('\ud83d\udccb', 'No enrollments', 'No students are enrolled in this session.');
      } else {
        students.forEach(function(s) {
          var statusColor = { 'confirmed': '#64B5F6', 'checked-in': '#4DB6AC', 'completed': '#4DB6AC', 'incomplete': '#FFD54F', 'no-show': '#EF9A9A', 'attended-pending-waiver': '#FFD54F', 'late': '#FFD54F' };
          var waiverWarning = s.waiverStatus && (s.waiverStatus === 'missing' || s.waiverStatus === 'expired');

          html += '<div class="book-card" style="cursor:default;">';
          html += '<div style="display:flex;justify-content:space-between;align-items:flex-start;">';

          // Left: student info
          html += '<div>';
          html += '<div style="font-weight:600;">' + esc(s.customerName || s.studentName || '—') + '</div>';
          html += '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(s.customerEmail || s.studentEmail || '') + '</div>';
          if (waiverWarning) {
            html += '<div style="font-size:0.78rem;color:#d97706;margin-top:4px;">&#9888; Waiver ' + esc(s.waiverStatus) + '</div>';
          }
          if (s.checkInNotes) {
            html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;font-style:italic;">' + esc(s.checkInNotes) + '</div>';
          }
          if (s.closeOutNotes) {
            html += '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:2px;font-style:italic;">Close-out: ' + esc(s.closeOutNotes) + '</div>';
          }
          if (s.incidents && s.incidents.length > 0) {
            s.incidents.forEach(function(inc) {
              html += '<div style="font-size:0.78rem;margin-top:4px;padding:2px 6px;border-left:3px solid ' + (SEVERITY_COLORS[inc.severity] || '#BDBDBD') + ';">' +
                '<span style="' + badgeStyle(SEVERITY_BADGE_COLORS, inc.severity) + '">' + esc(inc.severity) + '</span> ' +
                esc(INCIDENT_TYPE_LABELS[inc.type] || inc.type) + ': ' + esc(inc.description) + '</div>';
            });
          }
          html += '</div>';

          // Right: status + actions
          html += '<div style="display:flex;align-items:center;gap:8px;flex-shrink:0;">';
          html += '<span style="' + badgeStyle(STATUS_BADGE_COLORS, s.status === 'checked-in' ? 'active' : s.status === 'attended-pending-waiver' ? 'waitlisted' : s.status) + '">' + esc(s.status) + '</span>';

          // Phase-appropriate actions
          if (!isClosed) {
            if (s.status === 'confirmed' && !isStarted) {
              // Check-in phase: show check-in controls
              html += '<div style="display:flex;gap:4px;align-items:center;">';
              html += '<select id="waiver_' + esc(s._id) + '" class="form-input" style="width:auto;padding:4px 8px;font-size:0.78rem;" title="Waiver status">';
              WAIVER_STATUSES.forEach(function(ws) {
                html += '<option value="' + ws + '"' + (ws === (s.waiverStatus || 'na') ? ' selected' : '') + '>' + (ws === 'na' ? 'N/A' : ws.charAt(0).toUpperCase() + ws.slice(1)) + '</option>';
              });
              html += '</select>';
              html += '<label class="book-check" style="font-size:0.78rem;" title="Materials confirmed"><input type="checkbox" id="mat_' + esc(s._id) + '"> Mat</label>';
              html += '<button class="btn btn-primary btn-small" onclick="window._bookCheckIn(\'' + esc(s._id) + '\')">Check In</button>';
              html += '</div>';
            } else if (s.status === 'confirmed' && isStarted) {
              // Session started but student not checked in — late arrival or no-show
              html += '<button class="btn btn-small" onclick="window._bookCheckIn(\'' + esc(s._id) + '\')">Late Check-In</button>';
              html += '<button class="btn-icon danger" onclick="window._bookCloseOut(\'' + esc(s._id) + '\', \'no-show\')" title="No-Show">&#10006;</button>';
            } else if (s.status === 'checked-in') {
              // Close-out phase: show close-out controls
              html += '<select id="closeout_' + esc(s._id) + '" class="form-input" style="width:auto;padding:4px 8px;font-size:0.78rem;">';
              CLOSEOUT_STATUSES.forEach(function(cs) {
                html += '<option value="' + cs + '">' + cs.charAt(0).toUpperCase() + cs.slice(1) + '</option>';
              });
              html += '</select>';
              html += '<button class="btn btn-primary btn-small" onclick="window._bookCloseOut(\'' + esc(s._id) + '\')">Close Out</button>';
              html += '<button class="btn-icon" onclick="window._bookAddIncident(\'' + esc(s._id) + '\')" title="Add Incident">&#9888;</button>';
            }
          }

          html += '</div>';
          html += '</div></div>';
        });
      }

      // ── Incident form (hidden by default) ──
      html += '<div id="incidentFormWrap" style="display:none;margin-top:12px;">';
      html += '<div class="book-form-section">';
      html += '<div class="book-form-section-title">Add Incident</div>';
      html += '<input type="hidden" id="incEnrollId">';
      html += '<div class="book-responsive-grid" style="margin-bottom:0.75rem;">';
      html += '<div class="book-field"><label class="form-label">Type</label><select id="incType" class="form-input">';
      INCIDENT_TYPES.forEach(function(t) { html += '<option value="' + t + '">' + esc(INCIDENT_TYPE_LABELS[t] || t) + '</option>'; });
      html += '</select></div>';
      html += '<div class="book-field"><label class="form-label">Severity</label><select id="incSeverity" class="form-input">';
      INCIDENT_SEVERITIES.forEach(function(s) { html += '<option value="' + s + '">' + s.charAt(0).toUpperCase() + s.slice(1) + '</option>'; });
      html += '</select></div>';
      html += '</div>';
      html += '<div class="book-field"><label class="form-label">Description</label>';
      html += '<textarea id="incDescription" class="form-input" rows="2" placeholder="Describe what happened..."></textarea></div>';
      html += '<div style="display:flex;gap:8px;margin-top:0.75rem;">';
      html += '<button class="btn btn-primary btn-small" onclick="window._bookSaveIncident()">Save Incident</button>';
      html += '<button class="btn btn-small" onclick="document.getElementById(\'incidentFormWrap\').style.display=\'none\'">Cancel</button>';
      html += '</div></div></div>';

      // ── Session notes (for close session) ──
      if (isStarted && !isClosed) {
        html += '<div class="book-form-section" style="margin-top:1rem;">';
        html += '<div class="book-form-section-title">Session Notes</div>';
        html += '<textarea id="sessionCloseNotes" class="form-input" rows="2" placeholder="Overall session notes...">' + esc(session.sessionNotes || '') + '</textarea>';
        html += '</div>';
      }

      // ── Action buttons ──
      html += '<div class="book-form-actions">';
      if (!isStarted && !isClosed) {
        html += '<button class="btn btn-primary" onclick="window._bookCheckInAll(\'' + esc(sessionId) + '\')"' + (confirmedCount === 0 ? ' disabled' : '') + '>Check In All (' + confirmedCount + ')</button>';
        html += '<button class="btn btn-primary" style="background:' + SUCCESS_COLOR + ';" onclick="window._bookStartSession(\'' + esc(sessionId) + '\')"' + (checkedInCount === 0 ? ' disabled' : '') + '>Start Class (' + checkedInCount + ' checked in)</button>';
      } else if (isStarted && !isClosed) {
        var unclosedCount = checkedInCount + confirmedCount;
        html += '<button class="btn btn-primary" style="background:' + SUCCESS_COLOR + ';" onclick="window._bookCloseSession(\'' + esc(sessionId) + '\')">Close Session' + (unclosedCount > 0 ? ' (' + unclosedCount + ' auto-completed)' : '') + '</button>';
      }
      if (isClosed && session.classClosedAt) {
        html += '<span style="color:' + SUCCESS_COLOR + ';font-size:0.85rem;">&#10003; Session completed ' + new Date(session.classClosedAt).toLocaleString() + '</span>';
      }
      html += '</div>';

      content.innerHTML = html;
    } catch (err) {
      console.error('[book] Failed to load session lifecycle:', err);
      content.innerHTML = '<p style="color:' + DANGER_COLOR + ';">Failed to load: ' + esc(err.message) + '</p>';
    }
  };

  // ── Check in a single student ──
  // ── Run-session state-free cores ─────────────────────────────────────
  // Shared by the legacy session-ops view and window.SessionsBridge (the
  // sessions-v2 Run-session pane). No toasts, no view refreshes, no DOM reads;
  // survey side effects resolve classId from the ENROLLMENT (not view state).
  async function _sessCheckInCore(enrollId, opts) {
    var uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
    await MastDB.enrollments.update(enrollId, {
      status: 'checked-in',
      checkedInAt: new Date().toISOString(),
      checkedInBy: uid,
      waiverStatus: (opts && opts.waiverStatus) || 'na',
      materialsConfirmed: !!(opts && opts.materialsConfirmed)
    });
  }
  async function _sessCheckInAllCore(sessionId) {
    var enrollments = (await MastDB.enrollments.bySession(sessionId)) || {};
    if (enrollments && typeof enrollments.val === 'function') enrollments = enrollments.val() || {};
    var uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
    var now = new Date().toISOString();
    var count = 0;
    for (var id in enrollments) {
      if (enrollments[id].status === 'confirmed') {
        await MastDB.enrollments.update(id, {
          status: 'checked-in', checkedInAt: now, checkedInBy: uid,
          waiverStatus: 'na', materialsConfirmed: false
        });
        count++;
      }
    }
    return count;
  }
  async function _sessStartCore(sessionId) {
    var uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
    await MastDB.classSessions.update(sessionId, {
      classStartedAt: new Date().toISOString(),
      classStartedBy: uid
    });
  }
  function _sessSurveyOnAttended(enrollment) {
    var contactEmail = enrollment.studentEmail || enrollment.customerEmail;
    if (!contactEmail) return;
    var cid = enrollment.classId || '';
    firebase.functions().httpsCallable('triggerSurveyOnClassAttended')({
      tenantId: TENANT_ID,
      classId: cid,
      className: (allClassesMap[cid] || {}).name || cid || '',
      contactEmail: contactEmail,
      contactName: enrollment.studentName || enrollment.customerName || null
    }).catch(function(_e) { console.warn('[book] triggerSurveyOnClassAttended failed:', _e); });
  }
  async function _sessCloseOutCore(enrollId, status) {
    var enrollment = (await MastDB.enrollments.get(enrollId)) || {};
    var finalStatus = status || 'completed';
    // Soft waiver enforcement (mirrors _bookCloseOut)
    if (finalStatus === 'completed' && enrollment.waiverStatus && enrollment.waiverStatus !== 'signed' && enrollment.waiverStatus !== 'na') {
      finalStatus = 'attended-pending-waiver';
    }
    await MastDB.enrollments.update(enrollId, { status: finalStatus, completedAt: new Date().toISOString() });
    if (finalStatus === 'completed' || finalStatus === 'attended-pending-waiver') _sessSurveyOnAttended(Object.assign({}, enrollment, { classId: enrollment.classId }));
    return finalStatus;
  }
  // Auto-complete every open seat (checked-in/confirmed) — shared by
  // close-out-all and the session close itself.
  async function _sessCloseOutAllCore(sessionId) {
    var enrollments = (await MastDB.enrollments.bySession(sessionId)) || {};
    if (enrollments && typeof enrollments.val === 'function') enrollments = enrollments.val() || {};
    var now = new Date().toISOString();
    var count = 0;
    for (var id in enrollments) {
      var e = enrollments[id];
      if (e.status === 'checked-in' || e.status === 'confirmed') {
        var finalStatus = 'completed';
        if (e.waiverStatus && e.waiverStatus !== 'signed' && e.waiverStatus !== 'na') finalStatus = 'attended-pending-waiver';
        await MastDB.enrollments.update(id, { status: finalStatus, completedAt: now });
        _sessSurveyOnAttended(e);
        count++;
      }
    }
    return count;
  }
  async function _sessCloseSessionCore(sessionId, notes) {
    var autoCount = await _sessCloseOutAllCore(sessionId);
    var now = new Date().toISOString();
    await MastDB.classSessions.update(sessionId, {
      status: 'completed',
      classClosedAt: now,
      sessionNotes: (notes || '').trim() || null,
      completedAt: now
    });
    return autoCount;
  }
  async function _sessAddIncidentCore(enrollId, inc) {
    if (!inc || !(inc.description || '').trim()) throw new Error('Description required');
    var enrollment = (await MastDB.enrollments.get(enrollId)) || {};
    var incidents = enrollment.incidents || [];
    incidents.push({
      type: inc.type || 'other',
      severity: inc.severity || 'low',
      description: inc.description.trim(),
      createdAt: new Date().toISOString()
    });
    await MastDB.enrollments.update(enrollId, { incidents: incidents });
  }
  // ── Per-session reschedule / reassign / ad-hoc create cores ──────────
  // Native V2 scheduling for a SINGLE materialized occurrence (sessions-v2
  // twin). These were classic-only: legacy reassignment lived in the
  // assignToSession overlay (saveSessionAssignment reads the DOM) and there
  // was no per-occurrence date/time/capacity/location edit nor a single-
  // session create at all (only the class materializer). State-free cores —
  // caller owns confirm/toast/refresh — that REUSE the legacy checkConflicts
  // (the conflict logic is not reimplemented) and mirror the EXACT write
  // saveSessionAssignment / materializeSessions make. Money-free surface.

  // Populate instructors/resources maps + data WITHOUT the legacy DOM render
  // (loadInstructors/loadResources write to #bookInstructorsTable etc. which
  // don't exist on the V2 surface). checkConflicts resolves friendly names
  // from instructorsMap/resourcesMap, and the assign skill-grouping reads
  // instructorsData + the skill catalog — so seed all of them here.
  async function _ensureSchedRefsCore() {
    if (!skillCatalogLoaded) { try { await loadSkillCatalog(); } catch (e) {} }
    if (!instructorsLoaded || !instructorsData.length) {
      try {
        var idata = (await MastDB.instructors.list(100)) || {};
        instructorsData = Object.keys(idata).map(function (id) { var i = idata[id]; i.id = id; return i; });
        instructorsMap = {}; instructorsData.forEach(function (i) { instructorsMap[i.id] = i; });
        instructorsLoaded = true;
      } catch (e) { console.warn('[Book] sched refs: instructors', e); }
    }
    if (!resourcesLoaded || !resourcesData.length) {
      try {
        var rdata = (await MastDB.resources.list(100)) || {};
        resourcesData = Object.keys(rdata).map(function (id) { var r = rdata[id]; r.id = id; return r; });
        resourcesMap = {}; resourcesData.forEach(function (r) { resourcesMap[r.id] = r; });
        resourcesLoaded = true;
      } catch (e) { console.warn('[Book] sched refs: resources', e); }
    }
  }

  // Active-only instructor / resource pick-lists for the V2 form. Instructors
  // carry their required-skill gaps vs the parent class so the form can group
  // qualified / missing-skills (mirrors assignToSession's optgroups) — a guide,
  // never a block (substitutes / shadows / co-teaches all allowed).
  async function _sessSchedRefsCore(classId) {
    await _ensureSchedRefsCore();
    var cls = classId ? (await MastDB.classes.get(classId).catch(function () { return null; })) : null;
    var reqSkills = (cls && Array.isArray(cls.requiredSkills)) ? cls.requiredSkills : [];
    var instructors = instructorsData
      .filter(function (i) { return i.status === 'active'; })
      .map(function (i) {
        var missing = reqSkills.length ? _missingSkills(i, reqSkills) : [];
        return { id: i.id, name: i.name || '', qualified: missing.length === 0, missing: missing.map(_skillLabel) };
      });
    var resources = resourcesData
      .filter(function (r) { return r.status === 'active'; })
      .map(function (r) { return { id: r.id, name: r.name || '', type: r.type || '' }; });
    return { instructors: instructors, resources: resources };
  }

  // Normalize the V2 additional-staff payload exactly like saveSessionAssignment:
  // linked instructorId XOR freeform name, role from the allow-list, optional notes;
  // drop entries with neither id nor name.
  function _normalizeStaff(arr) {
    return (Array.isArray(arr) ? arr : []).map(function (e) {
      e = e || {};
      return {
        instructorId: e.instructorId || null,
        freeformName: e.instructorId ? null : (e.freeformName || '').trim() || null,
        role: STAFF_ROLES.indexOf(e.role) !== -1 ? e.role : 'assist',
        notes: (e.notes || '').trim() || null
      };
    }).filter(function (e) { return e.instructorId || e.freeformName; });
  }

  // Reassign a single occurrence's instructor + resource + additionalStaff —
  // the exact write saveSessionAssignment makes, minus the DOM/overlay/toast.
  // Runs the legacy checkConflicts and RETURNS the conflict strings (warn, not
  // block — matches legacy: surfaced but proceeds). Returns { conflicts }.
  async function _sessReassignCore(sessionId, payload) {
    await _ensureSchedRefsCore();
    var session = (await MastDB.classSessions.get(sessionId)) || {};
    payload = payload || {};
    var instrId = payload.instructorId || null;
    var resId = payload.resourceId || null;
    var cleanedStaff = _normalizeStaff(payload.additionalStaff);
    var conflicts = await checkConflicts(session.date, session.startTime, session.endTime, instrId, resId, sessionId, cleanedStaff);
    await MastDB.classSessions.update(sessionId, {
      instructorId: instrId,
      instructorName: instrId && instructorsMap[instrId] ? instructorsMap[instrId].name : null,
      resourceId: resId,
      resourceName: resId && resourcesMap[resId] ? resourcesMap[resId].name : null,
      additionalStaff: cleanedStaff
    });
    if (window.writeAudit) writeAudit('update', 'classSession', sessionId, { action: 'reassign' });
    return { conflicts: conflicts };
  }

  // Reschedule a single occurrence — date / start-end time / capacity /
  // location. PATCH-style (preserves enrolled, status, instructor, etc.).
  // Conflict-checks the NEW slot against the session's own assignment and
  // RETURNS the conflicts (warn, not block). Returns { conflicts }.
  async function _sessRescheduleCore(sessionId, payload) {
    await _ensureSchedRefsCore();
    var session = (await MastDB.classSessions.get(sessionId)) || {};
    payload = payload || {};
    var patch = {};
    if (payload.date != null) patch.date = String(payload.date).slice(0, 10);
    if (payload.startTime != null) patch.startTime = payload.startTime || null;
    if (payload.endTime != null) patch.endTime = payload.endTime || null;
    if (payload.capacity != null && payload.capacity !== '') {
      var cap = parseInt(payload.capacity, 10);
      if (!isNaN(cap) && cap >= 0) patch.capacity = cap;
    }
    if (payload.location != null) patch.location = (payload.location || '').trim() || null;
    var date = patch.date != null ? patch.date : session.date;
    var startTime = patch.startTime != null ? patch.startTime : session.startTime;
    var endTime = patch.endTime != null ? patch.endTime : session.endTime;
    var conflicts = await checkConflicts(date, startTime, endTime, session.instructorId || null, session.resourceId || null, sessionId, session.additionalStaff);
    await MastDB.classSessions.update(sessionId, patch);
    if (window.writeAudit) writeAudit('update', 'classSession', sessionId, { action: 'reschedule' });
    return { conflicts: conflicts };
  }

  // Add an ad-hoc one-off session for a class — a single occurrence OUTSIDE
  // the class schedule (legacy only ever materialized from the schedule). The
  // record shape mirrors materializeSessions exactly (so it reads/runs/closes
  // identically downstream); end time is derived from the class duration when
  // not given. Conflict-checks the slot and RETURNS conflicts (warn, not
  // block). Returns { id, conflicts }.
  async function _sessCreateCore(classId, payload) {
    if (!classId) throw new Error('Pick a class for the session.');
    payload = payload || {};
    var date = payload.date ? String(payload.date).slice(0, 10) : '';
    var startTime = payload.startTime || '';
    if (!date || !startTime) throw new Error('Date and start time are required.');
    await _ensureSchedRefsCore();
    var cls = (await MastDB.classes.get(classId)) || {};
    var duration = parseInt(cls.duration, 10) || 60;
    var endTime = payload.endTime || _calcEndTime(startTime, duration);
    var cap = parseInt(payload.capacity, 10);
    if (isNaN(cap) || cap < 0) cap = parseInt(cls.capacity, 10) || 8;
    var instrId = payload.instructorId || cls.instructorId || null;
    var resId = payload.resourceId || cls.resourceId || null;
    var conflicts = await checkConflicts(date, startTime, endTime, instrId, resId, null, null);
    var sessionId = MastDB.classSessions.newKey();
    await MastDB.classSessions.set(sessionId, {
      classId: classId,
      date: date,
      startTime: startTime,
      endTime: endTime,
      capacity: cap,
      enrolled: 0,
      waitlisted: 0,
      status: 'scheduled',
      instructorId: instrId,
      instructorName: instrId && instructorsMap[instrId] ? instructorsMap[instrId].name : (cls.instructorName || null),
      resourceId: resId,
      resourceName: resId && resourcesMap[resId] ? resourcesMap[resId].name : (cls.resourceName || null),
      location: (payload.location || '').trim() || null,
      materialsCostCents: cls.materialsCostCents || null,
      materialsIncluded: cls.materialsIncluded || false,
      materialsNote: cls.materialsNote || null,
      cancelReason: null,
      notes: null,
      adHoc: true,
      createdAt: new Date().toISOString()
    });
    if (window.writeAudit) writeAudit('create', 'classSession', sessionId, { classId: classId, adHoc: true });
    return { id: sessionId, conflicts: conflicts };
  }

  // End-time-from-duration helper (mirrors the materializer's calcEndTime;
  // hoisted so _sessCreateCore can reuse it).
  function _calcEndTime(startTime, durationMin) {
    var parts = String(startTime).split(':');
    var totalMin = (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0) + (durationMin || 60);
    var h = Math.floor(totalMin / 60) % 24;
    var m = totalMin % 60;
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }

  // Run-session verbs for the sessions-v2 twin (extends the Wave-2 bridge).
  window.SessionsBridge = Object.assign(window.SessionsBridge || {}, {
    checkIn: function (id, opts) { return _sessCheckInCore(id, opts); },
    checkInAll: function (sessionId) { return _sessCheckInAllCore(sessionId); },
    start: function (sessionId) { return _sessStartCore(sessionId); },
    closeOut: function (id, status) { return _sessCloseOutCore(id, status); },
    closeOutAll: function (sessionId) { return _sessCloseOutAllCore(sessionId); },
    close: function (sessionId, notes) { return _sessCloseSessionCore(sessionId, notes); },
    addIncident: function (id, inc) { return _sessAddIncidentCore(id, inc); },
    // Per-session scheduling (reschedule / reassign / ad-hoc create). All
    // reuse the legacy checkConflicts and return { conflicts } (warn-not-block).
    schedRefs: function (classId) { return _sessSchedRefsCore(classId); },
    reassign: function (sessionId, payload) { return _sessReassignCore(sessionId, payload); },
    reschedule: function (sessionId, payload) { return _sessRescheduleCore(sessionId, payload); },
    createSession: function (classId, payload) { return _sessCreateCore(classId, payload); }
  });

  window._bookCheckIn = async function(enrollId) {
    var waiverEl = document.getElementById('waiver_' + enrollId);
    var matEl = document.getElementById('mat_' + enrollId);
    var waiver = waiverEl ? waiverEl.value : 'na';
    var materials = matEl ? matEl.checked : false;
    var uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;

    try {
      await MastDB.enrollments.update(enrollId, {
        status: 'checked-in',
        checkedInAt: new Date().toISOString(),
        checkedInBy: uid,
        waiverStatus: waiver,
        materialsConfirmed: materials
      });
      MastAdmin.showToast('Checked in');
      window._bookManageSession(opsSessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  // ── Check in all confirmed students ──
  window._bookCheckInAll = async function(sessionId) {
    try {
      var enrollments = (await MastDB.enrollments.bySession(sessionId)) || {};
      var uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
      var now = new Date().toISOString();
      var count = 0;

      for (var id in enrollments) {
        if (enrollments[id].status === 'confirmed') {
          await MastDB.enrollments.update(id, {
            status: 'checked-in',
            checkedInAt: now,
            checkedInBy: uid,
            waiverStatus: 'na',
            materialsConfirmed: false
          });
          count++;
        }
      }
      MastAdmin.showToast(count + ' student' + (count !== 1 ? 's' : '') + ' checked in');
      window._bookManageSession(sessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  // ── Start the session ──
  window._bookStartSession = async function(sessionId) {
    try {
      var uid = firebase.auth().currentUser ? firebase.auth().currentUser.uid : null;
      await MastDB.classSessions.update(sessionId, {
        classStartedAt: new Date().toISOString(),
        classStartedBy: uid
      });
      MastAdmin.showToast('Class started');
      window._bookManageSession(sessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  // ── Close out a single enrollment ──
  window._bookCloseOut = async function(enrollId, forceStatus) {
    var statusEl = document.getElementById('closeout_' + enrollId);
    var status = forceStatus || (statusEl ? statusEl.value : 'completed');

    try {
      // Check waiver enforcement
      var enrollment = (await MastDB.enrollments.get(enrollId)) || {};
      var finalStatus = status;
      if (status === 'completed' && enrollment.waiverStatus && enrollment.waiverStatus !== 'signed' && enrollment.waiverStatus !== 'na') {
        finalStatus = 'attended-pending-waiver';
      }

      await MastDB.enrollments.update(enrollId, {
        status: finalStatus,
        completedAt: new Date().toISOString()
      });

      if (finalStatus === 'completed' || finalStatus === 'attended-pending-waiver') {
        var contactEmail = enrollment.studentEmail || enrollment.customerEmail;
        if (contactEmail) {
          firebase.functions().httpsCallable('triggerSurveyOnClassAttended')({
            tenantId: TENANT_ID,
            classId: opsClassId || '',
            className: (allClassesMap[opsClassId] || {}).name || opsClassId || '',
            contactEmail: contactEmail,
            contactName: enrollment.studentName || enrollment.customerName || null
          }).catch(function(_e) { console.warn('[book] triggerSurveyOnClassAttended failed:', _e); });
        }
      }

      MastAdmin.showToast(finalStatus === 'attended-pending-waiver' ? 'Closed out (pending waiver)' : 'Closed out');
      window._bookManageSession(opsSessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  // ── Close the session ──
  // ── Close out all students as completed ──
  window._bookCloseOutAll = async function(sessionId) {
    try {
      var enrollments = (await MastDB.enrollments.bySession(sessionId)) || {};
      var now = new Date().toISOString();
      var count = 0;

      for (var id in enrollments) {
        var e = enrollments[id];
        if (e.status === 'checked-in' || e.status === 'confirmed') {
          var finalStatus = 'completed';
          // Soft waiver enforcement
          if (e.waiverStatus && e.waiverStatus !== 'signed' && e.waiverStatus !== 'na') {
            finalStatus = 'attended-pending-waiver';
          }
          await MastDB.enrollments.update(id, {
            status: finalStatus,
            completedAt: now
          });
          var _coEmail = e.studentEmail || e.customerEmail;
          if (_coEmail) {
            firebase.functions().httpsCallable('triggerSurveyOnClassAttended')({
              tenantId: TENANT_ID,
              classId: opsClassId || '',
              className: (allClassesMap[opsClassId] || {}).name || opsClassId || '',
              contactEmail: _coEmail,
              contactName: e.studentName || e.customerName || null
            }).catch(function(_e) { console.warn('[book] triggerSurveyOnClassAttended failed:', _e); });
          }
          count++;
        }
      }
      MastAdmin.showToast(count + ' student' + (count !== 1 ? 's' : '') + ' closed out');
      window._bookManageSession(sessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  window._bookCloseSession = async function(sessionId) {
    var notesEl = document.getElementById('sessionCloseNotes');
    var notes = notesEl ? notesEl.value.trim() : '';

    try {
      // Auto-complete any unclosed students
      var enrollments = (await MastDB.enrollments.bySession(sessionId)) || {};
      var now = new Date().toISOString();
      var autoCount = 0;

      for (var id in enrollments) {
        var e = enrollments[id];
        if (e.status === 'checked-in' || e.status === 'confirmed') {
          var finalStatus = 'completed';
          if (e.waiverStatus && e.waiverStatus !== 'signed' && e.waiverStatus !== 'na') {
            finalStatus = 'attended-pending-waiver';
          }
          await MastDB.enrollments.update(id, { status: finalStatus, completedAt: now });
          var _csEmail = e.studentEmail || e.customerEmail;
          if (_csEmail) {
            firebase.functions().httpsCallable('triggerSurveyOnClassAttended')({
              tenantId: TENANT_ID,
              classId: opsClassId || '',
              className: (allClassesMap[opsClassId] || {}).name || opsClassId || '',
              contactEmail: _csEmail,
              contactName: e.studentName || e.customerName || null
            }).catch(function(_e) { console.warn('[book] triggerSurveyOnClassAttended failed:', _e); });
          }
          autoCount++;
        }
      }

      // Close the session
      await MastDB.classSessions.update(sessionId, {
        status: 'completed',
        classClosedAt: now,
        sessionNotes: notes || null,
        completedAt: now
      });
      MastAdmin.showToast('Session completed' + (autoCount > 0 ? ' (' + autoCount + ' auto-completed)' : ''));
      window._bookManageSession(sessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  // ── Add incident to an enrollment ──
  window._bookAddIncident = function(enrollId) {
    document.getElementById('incEnrollId').value = enrollId;
    document.getElementById('incidentFormWrap').style.display = '';
    document.getElementById('incDescription').value = '';
  };

  window._bookSaveIncident = async function() {
    var enrollId = document.getElementById('incEnrollId').value;
    var type = document.getElementById('incType').value;
    var severity = document.getElementById('incSeverity').value;
    var description = document.getElementById('incDescription').value.trim();
    if (!description) { MastAdmin.showToast('Description required', true); return; }

    try {
      var enrollment = (await MastDB.enrollments.get(enrollId)) || {};
      var incidents = enrollment.incidents || [];
      incidents.push({
        type: type,
        severity: severity,
        description: description,
        createdAt: new Date().toISOString()
      });
      await MastDB.enrollments.update(enrollId, { incidents: incidents });
      MastAdmin.showToast('Incident saved');
      document.getElementById('incidentFormWrap').style.display = 'none';
      window._bookManageSession(opsSessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  // ============================================================
  // Walk-in Student Search & Enrollment
  // ============================================================

  var _walkinSearchTimer = null;
  window._bookWalkinSearch = function(query, sessionId, classId) {
    clearTimeout(_walkinSearchTimer);
    var results = document.getElementById('walkinResults');
    if (!results) return;
    query = (query || '').trim().toLowerCase();
    if (query.length < 2) { results.innerHTML = ''; return; }
    _walkinSearchTimer = setTimeout(async function() {
      try {
        var val = (await MastDB.get('students')) || {};
        var matches = Object.entries(val).filter(function(e) {
          var s = e[1];
          var name = (s.displayName || s.name || '').toLowerCase();
          var email = (s.email || '').toLowerCase();
          return name.indexOf(query) !== -1 || email.indexOf(query) !== -1;
        }).slice(0, 5);
        var html = '';
        if (matches.length === 0) {
          html = '<div style="font-size:0.78rem;color:var(--warm-gray);padding:4px 0;">No students found</div>';
        } else {
          matches.forEach(function(entry) {
            var id = entry[0], s = entry[1];
            html += '<div class="book-card" style="cursor:pointer;padding:8px 12px;margin-bottom:4px;" onclick="window._bookWalkinEnroll(\'' + esc(sessionId) + '\', \'' + esc(classId) + '\', \'' + esc(id) + '\')">';
            html += '<div style="font-weight:500;font-size:0.9rem;">' + esc(s.displayName || s.name || '—') + '</div>';
            html += '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(s.email || '') + '</div>';
            html += '</div>';
          });
        }
        results.innerHTML = html;
      } catch (err) {
        results.innerHTML = '<div style="color:' + DANGER_COLOR + ';font-size:0.78rem;">Search failed</div>';
      }
    }, 300);
  };

  // Auto-create a student record if none exists for this email
  async function ensureStudentByEmail(name, email) {
    if (!email) return;
    try {
      var snap = await MastDB.query('students').orderByChild('email').equalTo(email).limitToFirst(1).once('value');
      if (snap.exists()) return; // Already exists
      var studentId = 'stu_' + Date.now();
      await MastDB.set('students/' + studentId, {
        displayName: name || '',
        email: email,
        waiverStatus: 'pending',
        safetyOrientationCompleted: false,
        status: 'active',
        onboardingChecklist: {
          liabilityWaiver: 'pending',
          safetyOrientation: 'pending',
          photoRelease: 'pending'
        },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      console.log('[book] Auto-created student:', studentId, email);
    } catch (err) {
      console.error('[book] Student auto-create failed:', err);
    }
  }

  window._bookWalkinEnroll = async function(sessionId, classId, studentId) {
    try {
      var student = await MastDB.get('students/' + studentId);
      if (!student) { MastAdmin.showToast('Student not found', true); return; }

      var session = (await MastDB.classSessions.get(sessionId)) || {};

      var enrollId = MastDB.enrollments.newKey();
      var now = new Date().toISOString();
      await MastDB.enrollments.set(enrollId, {
        classId: classId,
        sessionId: sessionId,
        studentUid: student.uid || null,
        studentName: student.displayName || student.name || '',
        studentEmail: student.email || '',
        customerName: student.displayName || student.name || '',
        customerEmail: student.email || '',
        status: session.classStartedAt ? 'checked-in' : 'confirmed',
        checkedInAt: session.classStartedAt ? now : null,
        enrollmentType: 'dropin',
        pricePaidCents: 0,
        waiverStatus: 'na',
        enrolledAt: now,
        walkIn: true
      });
      MastAdmin.showToast('Walk-in enrolled: ' + (student.displayName || student.name));
      window._bookManageSession(sessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  window._bookWalkinManual = async function(sessionId, classId) {
    var name = await mastPrompt('Student name:', { title: 'Walk-in Student' });
    if (!name || !name.trim()) return;
    var email = await mastPrompt('Student email (optional):', { title: 'Walk-in Student' }) || '';

    // Auto-create student record
    if (email.trim()) ensureStudentByEmail(name.trim(), email.trim());

    try {
      var session = (await MastDB.classSessions.get(sessionId)) || {};

      var enrollId = MastDB.enrollments.newKey();
      var now = new Date().toISOString();
      await MastDB.enrollments.set(enrollId, {
        classId: classId,
        sessionId: sessionId,
        studentName: name.trim(),
        studentEmail: email.trim(),
        customerName: name.trim(),
        customerEmail: email.trim(),
        status: session.classStartedAt ? 'checked-in' : 'confirmed',
        checkedInAt: session.classStartedAt ? now : null,
        enrollmentType: 'dropin',
        pricePaidCents: 0,
        waiverStatus: 'na',
        enrolledAt: now,
        walkIn: true
      });
      MastAdmin.showToast('Walk-in enrolled: ' + name.trim());
      window._bookManageSession(sessionId, opsClassId);
    } catch (err) {
      MastAdmin.showToast('Failed: ' + err.message, true);
    }
  };

  // ============================================================
  // Calendar View
  // ============================================================

  var MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var DOW_HEADERS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  async function loadCalendar() {
    var grid = document.getElementById('bookCalendarGrid');
    if (!grid) return;
    if (!calendarLoaded) {
      grid.innerHTML = LOADING_HTML;
      try {
        // IcrLjht — also pull instructors + resources so the multi-select
        // filter chips can label each dimension by friendly name and so the
        // intersection filter has the data it needs without re-fetching.
        var [sessSnap, clsSnap, instrSnap, resSnap] = await Promise.all([
          MastDB.classSessions.list(2000),
          MastDB.classes.list(200),
          MastDB.instructors ? MastDB.instructors.list(200).catch(function(){ return {}; }) : Promise.resolve({}),
          MastDB.resources   ? MastDB.resources.list(200).catch(function(){ return {}; })   : Promise.resolve({})
        ]);
        var sessData = (sessSnap && typeof sessSnap.val === 'function') ? (sessSnap.val() || {}) : (sessSnap || {});
        calendarSessions = Object.keys(sessData).map(function(id) { var s = sessData[id]; s.id = id; return s; });
        var clsData = (clsSnap && typeof clsSnap.val === 'function') ? (clsSnap.val() || {}) : (clsSnap || {});
        calendarClassesMap = {};
        Object.keys(clsData).forEach(function(id) { calendarClassesMap[id] = clsData[id]; });
        var instrData = (instrSnap && typeof instrSnap.val === 'function') ? (instrSnap.val() || {}) : (instrSnap || {});
        _calInstructorsMap = {};
        Object.keys(instrData).forEach(function(id) { _calInstructorsMap[id] = instrData[id]; });
        var resData = (resSnap && typeof resSnap.val === 'function') ? (resSnap.val() || {}) : (resSnap || {});
        _calResourcesMap = {};
        Object.keys(resData).forEach(function(id) { _calResourcesMap[id] = resData[id]; });
        calendarLoaded = true;
      } catch (err) {
        grid.innerHTML = '<p style="color:' + DANGER_COLOR + ';padding:2rem;">Failed to load calendar data.</p>';
        return;
      }
    }
    renderCalendar();
  }

  function renderCalendar() {
    var grid = document.getElementById('bookCalendarGrid');
    var title = document.getElementById('calendarTitle');
    if (!grid) return;
    title.textContent = MONTH_NAMES[calendarMonth] + ' ' + calendarYear;

    var firstDay = new Date(calendarYear, calendarMonth, 1).getDay();
    var daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    var today = todayStr();

    // IcrLjht — paint the filter bar above the grid. Returns true if any
    // filter dimension is active so we can show a Clear-all action.
    var anyFilter = _renderCalendarFilterBar();

    // Group sessions by date, applying multi-select intersection filters.
    // A session shows iff ALL THREE of its dimensions either have no filter
    // active OR have the session's id in the filter set.
    function _sessionMatches(s) {
      var clsKeys = Object.keys(_calFilterClasses);
      var insKeys = Object.keys(_calFilterInstructors);
      var resKeys = Object.keys(_calFilterResources);
      // Pull the session's effective values. Sessions may not carry instructor
      // or resource themselves — fall back to the parent class's value.
      var cls = s.classId ? calendarClassesMap[s.classId] : null;
      var sInstr = s.instructorId || (cls && cls.instructorId) || null;
      var sRes = s.resourceId || (cls && cls.resourceId) || null;
      if (clsKeys.length && !_calFilterClasses[s.classId]) return false;
      if (insKeys.length && !(sInstr && _calFilterInstructors[sInstr])) return false;
      if (resKeys.length && !(sRes && _calFilterResources[sRes])) return false;
      return true;
    }

    var sessionsByDate = {};
    calendarSessions.forEach(function(s) {
      if (!s.date) return;
      if (!_sessionMatches(s)) return;
      var parts = s.date.split('-');
      if (parseInt(parts[0]) === calendarYear && parseInt(parts[1]) - 1 === calendarMonth) {
        if (!sessionsByDate[s.date]) sessionsByDate[s.date] = [];
        sessionsByDate[s.date].push(s);
      }
    });

    // Phase 10: status colors use design tokens (no literal hex)
    var STATUS_DOT = { scheduled: 'var(--teal)', completed: 'var(--success, ' + SUCCESS_COLOR + ')', cancelled: 'var(--danger, ' + DANGER_COLOR + ')' };

    var html = '<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:var(--border);border-radius:8px;overflow:hidden;">';

    // Day-of-week headers
    DOW_HEADERS.forEach(function(d) {
      html += '<div aria-hidden="true" style="background:var(--surface-dark);padding:8px 4px;text-align:center;font-size:0.78rem;font-weight:600;color:var(--warm-gray);text-transform:uppercase;">' + d + '</div>';
    });

    // Leading blank cells
    for (var b = 0; b < firstDay; b++) {
      html += '<div style="background:var(--surface-card);min-height:80px;padding:6px;"></div>';
    }

    // Day cells
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = calendarYear + '-' + String(calendarMonth + 1).padStart(2, '0') + '-' + String(d).padStart(2, '0');
      var isToday = dateStr === today;
      var isSelected = dateStr === selectedCalendarDay;
      var daySessions = sessionsByDate[dateStr] || [];

      // Phase 10: selected-day bg uses amber-glow token (was literal rgba(196,133,60,0.15))
      var cellBg = isSelected ? 'rgba(245,213,168,0.15)' : 'var(--surface-card)';
      var borderStyle = isToday ? 'box-shadow:inset 0 0 0 2px var(--primary);' : '';
      var ariaLabel = formatDate(dateStr) + (daySessions.length ? ', ' + daySessions.length + ' session' + (daySessions.length === 1 ? '' : 's') : ', no sessions');

      html += '<div style="background:' + cellBg + ';min-height:80px;padding:6px;cursor:pointer;' + borderStyle + '" ' +
        'onclick="window._calSelectDay(\'' + dateStr + '\')" role="button" tabindex="0" ' +
        'aria-label="' + esc(ariaLabel) + '"' + (isSelected ? ' aria-pressed="true"' : '') +
        ' onkeydown="if(event.key===\'Enter\')window._calSelectDay(\'' + dateStr + '\')">';

      html += '<div style="font-size:0.85rem;font-weight:' + (isToday ? '700' : '400') + ';color:' + (isToday ? 'var(--primary)' : 'var(--text)') + ';margin-bottom:4px;">' + d + '</div>';

      // Session dots (max 3 + overflow)
      var maxShow = 3;
      daySessions.sort(function(a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });
      for (var si = 0; si < Math.min(daySessions.length, maxShow); si++) {
        var sess = daySessions[si];
        var clsName = calendarClassesMap[sess.classId] ? calendarClassesMap[sess.classId].name : '';
        var abbr = clsName.length > 10 ? clsName.substring(0, 10) + '…' : clsName;
        var dotColor = STATUS_DOT[sess.status] || 'var(--warm-gray-light)';
        html += '<div style="font-size:0.72rem;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:1px;">' +
          '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:' + dotColor + ';margin-right:3px;vertical-align:middle;"></span>' +
          '<span style="color:var(--warm-gray);">' + formatTime(sess.startTime) + '</span> ' +
          '<span style="color:var(--text);">' + esc(abbr) + '</span></div>';
      }
      if (daySessions.length > maxShow) {
        html += '<div style="font-size:0.72rem;color:var(--primary);">+' + (daySessions.length - maxShow) + ' more</div>';
      }

      html += '</div>';
    }

    // Trailing blank cells to fill last row
    var totalCells = firstDay + daysInMonth;
    var remaining = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    for (var t = 0; t < remaining; t++) {
      html += '<div style="background:var(--surface-card);min-height:80px;padding:6px;"></div>';
    }

    html += '</div>';
    grid.innerHTML = html;

    // Render day detail if selected
    if (selectedCalendarDay) {
      renderCalendarDayDetail(selectedCalendarDay);
    } else {
      document.getElementById('bookCalendarDayDetail').style.display = 'none';
    }
  }

  // IcrLjht — render the multi-select filter bar above the calendar grid.
  // Derives the option set for each dimension from the IDs actually present
  // on calendarSessions (so the operator only sees options that have data).
  function _renderCalendarFilterBar() {
    var host = document.getElementById('bookCalendarFilters');
    if (!host) return false;
    // Derive distinct IDs for each dimension from the session set.
    var clsIds = Object.create(null);
    var insIds = Object.create(null);
    var resIds = Object.create(null);
    calendarSessions.forEach(function(s) {
      if (s.classId) clsIds[s.classId] = true;
      var cls = s.classId ? calendarClassesMap[s.classId] : null;
      var sInstr = s.instructorId || (cls && cls.instructorId);
      var sRes = s.resourceId || (cls && cls.resourceId);
      if (sInstr) insIds[sInstr] = true;
      if (sRes) resIds[sRes] = true;
    });

    function _chipRow(label, dim, options, labelLookup, activeSet) {
      var entries = Object.keys(options).map(function(id) {
        return { id: id, label: labelLookup(id) || id };
      }).sort(function(a, b) {
        return String(a.label).toLowerCase().localeCompare(String(b.label).toLowerCase());
      });
      if (entries.length === 0) return '';
      var activeCount = Object.keys(activeSet).length;
      var hdr = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;flex-wrap:wrap;">' +
        '<span style="font-size:0.72rem;color:var(--warm-gray);font-weight:600;text-transform:uppercase;letter-spacing:0.05em;">' + esc(label) + '</span>' +
        (activeCount > 0
          ? '<button type="button" onclick="window._calClearFilter(\'' + dim + '\')" style="font-size:0.72rem;background:transparent;border:1px solid var(--cream-dark);color:var(--warm-gray);padding:1px 8px;border-radius:10px;cursor:pointer;">Clear (' + activeCount + ')</button>'
          : '') +
      '</div>';
      var chips = entries.map(function(e) {
        var active = !!activeSet[e.id];
        return '<button type="button" onclick="window._calToggleFilter(\'' + dim + '\',\'' + esc(e.id) + '\')" ' +
          'style="font-size:0.78rem;padding:3px 10px;border-radius:14px;cursor:pointer;margin:2px;' +
          (active
            ? 'background:var(--teal,#2a7c6f);color:#fff;border:1px solid var(--teal,#2a7c6f);font-weight:600;'
            : 'background:transparent;color:var(--text);border:1px solid var(--cream-dark);font-weight:500;') +
          '">' + esc(String(e.label)) + '</button>';
      }).join('');
      return '<div style="margin-bottom:8px;">' + hdr + '<div style="display:flex;flex-wrap:wrap;gap:0;">' + chips + '</div></div>';
    }

    var anyActive = (Object.keys(_calFilterClasses).length + Object.keys(_calFilterInstructors).length + Object.keys(_calFilterResources).length) > 0;

    // Fallback lookups: if the instructor / resource doc is missing (deleted
    // or seeded ad-hoc), walk classes referencing this id and pull the
    // denormalized instructorName / resourceName off the class. Keeps the
    // chip label readable when sgtest15-style legacy IDs orphan-reference a
    // since-deleted instructor.
    function _lookupClassName(id) {
      return (calendarClassesMap[id] && calendarClassesMap[id].name) || null;
    }
    function _lookupInstructorName(id) {
      if (_calInstructorsMap[id] && _calInstructorsMap[id].name) return _calInstructorsMap[id].name;
      var cids = Object.keys(calendarClassesMap);
      for (var i = 0; i < cids.length; i++) {
        var c = calendarClassesMap[cids[i]];
        if (c && c.instructorId === id && c.instructorName) return c.instructorName;
      }
      return null;
    }
    function _lookupResourceName(id) {
      if (_calResourcesMap[id] && _calResourcesMap[id].name) return _calResourcesMap[id].name;
      var cids = Object.keys(calendarClassesMap);
      for (var i = 0; i < cids.length; i++) {
        var c = calendarClassesMap[cids[i]];
        if (c && c.resourceId === id && c.resourceName) return c.resourceName;
      }
      return null;
    }

    host.innerHTML =
      '<div style="border:1px solid var(--cream-dark);border-radius:10px;padding:10px 12px;background:var(--cream,#fbf6ee);">' +
        _chipRow('Class', 'class', clsIds, _lookupClassName, _calFilterClasses) +
        _chipRow('Instructor', 'instructor', insIds, _lookupInstructorName, _calFilterInstructors) +
        _chipRow('Resource', 'resource', resIds, _lookupResourceName, _calFilterResources) +
        (anyActive
          ? '<div style="display:flex;justify-content:flex-end;margin-top:4px;"><button type="button" onclick="window._calClearAllFilters()" style="font-size:0.78rem;background:transparent;border:1px solid var(--warm-gray);color:var(--warm-gray);padding:2px 10px;border-radius:10px;cursor:pointer;">Clear all filters</button></div>'
          : '') +
      '</div>';
    return anyActive;
  }

  function renderCalendarDayDetail(dateStr) {
    var panel = document.getElementById('bookCalendarDayDetail');
    if (!panel) return;

    var daySessions = calendarSessions.filter(function(s) { return s.date === dateStr; })
      .sort(function(a, b) { return (a.startTime || '').localeCompare(b.startTime || ''); });

    if (daySessions.length === 0) {
      panel.innerHTML = '<p style="' + EMPTY_STATE_STYLE + '">No sessions on ' + formatDate(dateStr) + '.</p>';
      panel.style.display = '';
      return;
    }

    var html = '<h3 style="margin:0 0 0.75rem;">Sessions — ' + formatDate(dateStr) + ' (' + daySessions.length + ')</h3>';
    html += '<table class="data-table"><thead><tr><th>Time</th><th>Class</th><th class="book-hide-narrow">Instructor</th><th>Status</th><th>Enrolled</th></tr></thead><tbody>';

    daySessions.forEach(function(s) {
      var clsName = calendarClassesMap[s.classId] ? calendarClassesMap[s.classId].name : s.classId;
      var cls = calendarClassesMap[s.classId] || {};
      // Phase 10: push MastNavStack entry so back button returns to the calendar
      var calLabel = MONTH_NAMES[calendarMonth] + ' ' + calendarYear + ' calendar';
      html += '<tr style="cursor:pointer;" onclick="window._calOpenClass(\'' + esc(s.classId) + '\', \'' + esc(calLabel) + '\')">' +
        '<td>' + formatTime(s.startTime) + ' - ' + formatTime(s.endTime) + '</td>' +
        '<td><strong>' + esc(clsName) + '</strong></td>' +
        '<td class="book-hide-narrow">' + esc(s.instructorName || '—') + '</td>' +
        '<td><span style="' + badgeStyle(STATUS_BADGE_COLORS, s.status) + '">' + esc(s.status) + '</span></td>' +
        '<td>' + (s.enrolled || 0) + ' / ' + (s.capacity || cls.capacity || '—') + '</td>' +
        '</tr>';
    });

    html += '</tbody></table>';
    panel.innerHTML = html;
    panel.style.display = '';
  }

  window._calPrev = function() { calendarMonth--; if (calendarMonth < 0) { calendarMonth = 11; calendarYear--; } selectedCalendarDay = null; renderCalendar(); };
  window._calNext = function() { calendarMonth++; if (calendarMonth > 11) { calendarMonth = 0; calendarYear++; } selectedCalendarDay = null; renderCalendar(); };
  window._calToday = function() { var d = new Date(); calendarYear = d.getFullYear(); calendarMonth = d.getMonth(); selectedCalendarDay = todayStr(); renderCalendar(); };
  window._calSelectDay = function(dateStr) { selectedCalendarDay = dateStr; renderCalendar(); };
  // IcrLjht — multi-select filter handlers
  window._calToggleFilter = function(dim, id) {
    var set = dim === 'class' ? _calFilterClasses
            : dim === 'instructor' ? _calFilterInstructors
            : dim === 'resource' ? _calFilterResources
            : null;
    if (!set) return;
    if (set[id]) delete set[id]; else set[id] = true;
    renderCalendar();
  };
  window._calClearFilter = function(dim) {
    if (dim === 'class') _calFilterClasses = Object.create(null);
    else if (dim === 'instructor') _calFilterInstructors = Object.create(null);
    else if (dim === 'resource') _calFilterResources = Object.create(null);
    renderCalendar();
  };
  window._calClearAllFilters = function() {
    _calFilterClasses = Object.create(null);
    _calFilterInstructors = Object.create(null);
    _calFilterResources = Object.create(null);
    renderCalendar();
  };
  // Phase 10: cross-screen nav from calendar → class detail with stack push so back returns to the calendar
  window._calOpenClass = function(classId, label) {
    if (window.MastNavStack && typeof MastNavStack.push === 'function') {
      MastNavStack.push({
        route: 'book',
        view: 'calendar',
        state: { calendarYear: calendarYear, calendarMonth: calendarMonth, selectedCalendarDay: selectedCalendarDay },
        label: label || 'calendar'
      });
    }
    loadClassDetail(classId);
  };

  // ============================================================
  // Reports Dashboard
  // ============================================================

  async function loadReports() {
    var content = document.getElementById('bookReportsContent');
    if (!content) return;
    content.innerHTML = LOADING_HTML;

    try {
      var [sessSnap, clsSnap, enrollSnap, ordersSnap] = await Promise.all([
        MastDB.classSessions.list(2000),
        MastDB.classes.list(200),
        MastDB.enrollments.list(2000),
        MastDB.orders.list(500)
      ]);

      var sessions = [];
      var sessData = (sessSnap && typeof sessSnap.val === 'function') ? (sessSnap.val() || {}) : (sessSnap || {});
      Object.keys(sessData).forEach(function(id) { var s = sessData[id]; s.id = id; sessions.push(s); });

      var classes = {};
      var clsData = (clsSnap && typeof clsSnap.val === 'function') ? (clsSnap.val() || {}) : (clsSnap || {});
      Object.keys(clsData).forEach(function(id) { classes[id] = clsData[id]; classes[id].id = id; });

      var enrollments = [];
      var enrollData = (enrollSnap && typeof enrollSnap.val === 'function') ? (enrollSnap.val() || {}) : (enrollSnap || {});
      Object.keys(enrollData).forEach(function(id) { var e = enrollData[id]; e.id = id; enrollments.push(e); });

      var orders = [];
      var ordData = (ordersSnap && typeof ordersSnap.val === 'function') ? (ordersSnap.val() || {}) : (ordersSnap || {});
      Object.keys(ordData).forEach(function(id) { var o = ordData[id]; o.id = id; orders.push(o); });

      // Load session logs for completed sessions (attendance data)
      var completedSessionIds = sessions.filter(function(s) { return s.status === 'completed'; }).map(function(s) { return s.id; });
      var sessionLogs = {};
      // Load up to 50 most recent logs to avoid huge reads
      var logIds = completedSessionIds.slice(0, 50);
      for (var li = 0; li < logIds.length; li++) {
        try {
          var logSnap = await MastDB.sessionLogs.completion(logIds[li]).once('value');
          if (logSnap.val()) sessionLogs[logIds[li]] = logSnap.val();
        } catch (e) { /* skip */ }
      }

      // Load incidents
      var allIncidents = [];
      for (var ii = 0; ii < logIds.length; ii++) {
        try {
          var incSnap = await MastDB.sessionLogs.incidents(logIds[ii]).once('value');
          var incData = incSnap.val() || {};
          Object.keys(incData).forEach(function(incId) {
            var inc = incData[incId];
            inc._sessionId = logIds[ii];
            allIncidents.push(inc);
          });
        } catch (e) { /* skip */ }
      }

      renderReports(sessions, classes, enrollments, orders, sessionLogs, allIncidents);
      reportsLoaded = true;
    } catch (err) {
      console.error('[Book] Failed to load reports:', err);
      content.innerHTML = '<p style="color:' + DANGER_COLOR + ';padding:2rem;">Failed to load report data.</p>';
    }
  }

  // H4kGZi6 — Class workflow explainer. Operator asked "need to better
  // understand the workflow for a class, and what screens an instructor /
  // admin / student goes to. Also, do we have an online location for
  // student to fill in information". Rendered as a collapsible panel at the
  // top of Class Reports so the answer lives next to where they asked.
  function _renderClassWorkflowExplainer() {
    return '<details style="margin-bottom:18px;background:var(--cream,#fbf6ee);border:1px solid var(--cream-dark);border-radius:8px;padding:10px 14px;">' +
      '<summary style="cursor:pointer;font-size:0.9rem;font-weight:600;color:var(--text);">📋 Class workflow — who does what, and where</summary>' +
      '<div style="margin-top:12px;font-size:0.85rem;line-height:1.55;color:var(--text);">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:14px;">' +
          // Admin column
          '<div style="border-radius:6px;padding:10px 12px;background:var(--surface-card,#fff);border:1px solid var(--cream-dark);">' +
            '<div style="font-weight:600;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--teal,#2a7c6f);margin-bottom:6px;">Admin / Studio</div>' +
            '<ol style="margin:0 0 0 18px;padding:0;font-size:0.85rem;">' +
              '<li>Create class definition (<a href="#classes" style="color:var(--teal,#2a7c6f);text-decoration:underline;">Bookings → Classes</a>)</li>' +
              '<li>Add sessions (single or recurring) on the class detail surface</li>' +
              '<li>Assign instructor &amp; resource per session</li>' +
              '<li>Day-of: monitor enrollments via <a href="#enrollments" style="color:var(--teal,#2a7c6f);text-decoration:underline;">Bookings → Enrollments</a></li>' +
              '<li>Mark attendance per enrollment row (✓ attended / ⏰ late / 🚫 no-show)</li>' +
              '<li>Review outcomes here on <strong>Class Reports</strong></li>' +
            '</ol>' +
          '</div>' +
          // Instructor column
          '<div style="border-radius:6px;padding:10px 12px;background:var(--surface-card,#fff);border:1px solid var(--cream-dark);">' +
            '<div style="font-weight:600;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.04em;color:var(--amber,#b45309);margin-bottom:6px;">Instructor</div>' +
            '<ol style="margin:0 0 0 18px;padding:0;font-size:0.85rem;">' +
              '<li>See assigned classes on <a href="#instructors" style="color:var(--teal,#2a7c6f);text-decoration:underline;">Bookings → Instructors</a> (click name → read view)</li>' +
              '<li>Use the day-of session ops panel for the roster &amp; attendance entry (admin can also mark)</li>' +
              '<li>Capability/specialty list lives on the instructor read view</li>' +
            '</ol>' +
            '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">Instructor-self-service screens (instructor logs in, marks attendance themselves) are not yet built — admin marks attendance for now.</div>' +
          '</div>' +
          // Student column
          '<div style="border-radius:6px;padding:10px 12px;background:var(--surface-card,#fff);border:1px solid var(--cream-dark);">' +
            '<div style="font-weight:600;font-size:0.78rem;text-transform:uppercase;letter-spacing:0.04em;color:#9a3412;margin-bottom:6px;">Student (public)</div>' +
            '<ol style="margin:0 0 0 18px;padding:0;font-size:0.85rem;">' +
              '<li><code>/classes</code> — browse class catalog on the storefront</li>' +
              '<li><code>/class-detail?id=…</code> — view class details &amp; pick a session</li>' +
              '<li>Enroll → checkout (Stripe or pass redemption)</li>' +
              '<li><code>/waiver</code> — sign waiver (linked from confirmation email if required)</li>' +
              '<li><code>/my-classes</code> — student\'s own enrollments (cancel, manage)</li>' +
              '<li><code>/cancel-booking</code> &amp; <code>/manage-seats</code> — flow surfaces invoked via email link</li>' +
            '</ol>' +
          '</div>' +
        '</div>' +
        '<div style="font-size:0.85rem;background:rgba(42,124,111,0.08);border-left:3px solid var(--teal,#2a7c6f);padding:8px 12px;border-radius:0 6px 6px 0;">' +
          '<strong>Yes</strong> &mdash; students have an online location to fill in their info. ' +
          'The storefront flow at <code>/class-detail?id=…</code> captures name + email + phone at enrollment, the optional <code>/waiver</code> page captures emergency contact / medical / signature, and the post-purchase <code>/my-classes</code> dashboard lets them manage their own enrollments. ' +
          'Custom intake forms beyond waiver fields would need a build.' +
        '</div>' +
      '</div>' +
    '</details>';
  }

  // Order/incident timestamps (completedAt / createdAt) may arrive as an ISO
  // string, epoch millis, or a Firestore Timestamp (a {seconds,nanoseconds}
  // plain object, or a real Timestamp with .toDate()). Coerce to a comparable
  // date string so the window `.substring(0,10)` filters and the incident
  // `.localeCompare` sort never throw on a Timestamp object (which has no
  // .substring/.localeCompare). Mirrors classes-v2.js renderReports.
  function dateStr(v) {
    if (!v) return '';
    if (typeof v === 'string') return v;
    if (typeof v === 'number') { var dn = new Date(v); return isNaN(dn.getTime()) ? '' : dn.toISOString(); }
    if (typeof v.toDate === 'function') { try { return v.toDate().toISOString(); } catch (e) { return ''; } }
    if (typeof v.seconds === 'number') { var ds = new Date(v.seconds * 1000); return isNaN(ds.getTime()) ? '' : ds.toISOString(); }
    return '';
  }

  function renderReports(sessions, classes, enrollments, orders, sessionLogs, allIncidents) {
    var content = document.getElementById('bookReportsContent');
    if (!content) return;

    // Date range filter
    var rangeVal = (document.getElementById('reportDateRange') || {}).value || '30';
    var cutoffDate = null;
    if (rangeVal !== 'all') {
      var d = new Date();
      d.setDate(d.getDate() - parseInt(rangeVal, 10));
      cutoffDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    var filteredSessions = cutoffDate ? sessions.filter(function(s) { return s.date >= cutoffDate; }) : sessions;
    var completedSessions = filteredSessions.filter(function(s) { return s.status === 'completed'; });
    var scheduledSessions = filteredSessions.filter(function(s) { return s.status === 'scheduled'; });

    // Attendance stats from session logs
    var attCompleted = 0, attAbsent = 0, attNoShow = 0;
    Object.keys(sessionLogs).forEach(function(sid) {
      var log = sessionLogs[sid];
      if (!log.attendance) return;
      // Check if session is in filtered range
      var sess = sessions.find(function(s) { return s.id === sid; });
      if (cutoffDate && sess && sess.date < cutoffDate) return;
      Object.keys(log.attendance).forEach(function(eid) {
        var st = log.attendance[eid].status;
        if (st === 'completed') attCompleted++;
        else if (st === 'absent') attAbsent++;
        else if (st === 'no-show') attNoShow++;
      });
    });
    var attTotal = attCompleted + attAbsent + attNoShow;
    var attRate = attTotal > 0 ? Math.round((attCompleted / attTotal) * 100) : 0;

    // Active enrollments
    var activeEnrollments = enrollments.filter(function(e) { return e.status === 'confirmed'; }).length;

    // Revenue from orders with class/pass items
    var revenue = 0;
    var filteredOrders = orders.filter(function(o) {
      if (!o.completedAt && !o.createdAt) return false;
      if (cutoffDate) {
        var orderDate = dateStr(o.completedAt || o.createdAt).substring(0, 10);
        return orderDate >= cutoffDate;
      }
      return true;
    });
    filteredOrders.forEach(function(o) {
      if (!o.items) return;
      (Array.isArray(o.items) ? o.items : Object.values(o.items)).forEach(function(item) {
        if (item.bookingType === 'class' || item.bookingType === 'pass') {
          // item.price (dollars) tail-fallback: storefront class/pass checkout
          // lines may carry only `price`, not the canonical `priceCents`/`total`.
          revenue += (item.total || ((item.priceCents || 0) / 100) || item.price || 0);
        }
      });
    });

    // Overdue sessions: scheduled sessions whose date is past today and
    // haven't been marked completed yet. Surfaces missed completion reports.
    // NOTE: we walk the unfiltered `sessions` list so a past-date session
    // outside the date-range filter still surfaces as overdue.
    var todayStr = (function() {
      var d = new Date();
      return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    })();
    var overdueSessions = sessions.filter(function(s) {
      return s.status === 'scheduled' && s.date && s.date < todayStr;
    }).sort(function(a, b) { return (a.date || '').localeCompare(b.date || ''); });

    var html = '';

    // Summary cards
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:2rem;">';
    html += _reportCard('Sessions Completed', completedSessions.length, SUCCESS_COLOR);
    html += _reportCard('Attendance Rate', attRate + '%', attRate >= 80 ? SUCCESS_COLOR : attRate >= 60 ? WARNING_COLOR : DANGER_COLOR);
    html += _reportCard('Active Enrollments', activeEnrollments, '#64B5F6');
    html += _reportCard('Class Revenue', formatPrice(revenue), 'var(--primary)');
    html += _reportCard('Overdue Reports', overdueSessions.length, overdueSessions.length > 0 ? DANGER_COLOR : SUCCESS_COLOR);
    html += '</div>';

    // Overdue sessions panel (always visible when count > 0)
    if (overdueSessions.length > 0) {
      html += '<div style="background:rgba(239,154,154,0.08);border:1px solid ' + DANGER_COLOR + ';border-left-width:4px;border-radius:6px;padding:14px 16px;margin-bottom:1.5rem;">';
      html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">';
      html += '<div>';
      html += '<h3 style="margin:0;font-size:1rem;color:' + DANGER_COLOR + ';">&#9888; ' + overdueSessions.length + ' Session' + (overdueSessions.length === 1 ? '' : 's') + ' Awaiting Completion Report</h3>';
      html += '<p style="margin:4px 0 0;font-size:0.78rem;color:var(--warm-gray);">Past-date sessions still marked &ldquo;scheduled&rdquo;. Submit a completion report or cancel the session to clear.</p>';
      html += '</div>';
      html += '</div>';
      // Show up to 10 oldest first
      var overdueDisplay = overdueSessions.slice(0, 10);
      html += '<div style="display:flex;flex-direction:column;gap:6px;">';
      overdueDisplay.forEach(function(s) {
        var cls = classes[s.classId] || {};
        var className = cls.name || s.classId || '(unknown class)';
        var daysLate = Math.round((new Date(todayStr) - new Date(s.date)) / 86400000);
        html += '<div style="display:flex;justify-content:space-between;align-items:center;background:var(--surface-card,#fff);border:1px solid var(--border,#E8E0D4);border-radius:6px;padding:10px 12px;color:var(--text);">';
        html += '<div style="min-width:0;">';
        html += '<div style="font-weight:600;font-size:0.9rem;">' + esc(className) + '</div>';
        html += '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(s.date) + (s.startTime ? ' &middot; ' + esc(s.startTime) : '') + ' &middot; ' + daysLate + ' day' + (daysLate === 1 ? '' : 's') + ' overdue</div>';
        html += '</div>';
        html += '<div style="display:flex;gap:6px;flex-shrink:0;">';
        html += '<button class="btn btn-small btn-primary" onclick="window._bookManageSession(\'' + esc(s.id) + '\', \'' + esc(s.classId) + '\')">Open Session</button>';
        html += '</div>';
        html += '</div>';
      });
      if (overdueSessions.length > overdueDisplay.length) {
        html += '<div style="font-size:0.78rem;color:var(--warm-gray);text-align:center;padding:4px;">+ ' + (overdueSessions.length - overdueDisplay.length) + ' more not shown</div>';
      }
      html += '</div>';
      html += '</div>';
    }

    // Attendance breakdown bar
    if (attTotal > 0) {
      html += '<h3 style="' + SECTION_H3 + '">Attendance Breakdown</h3>';
      var pctCompleted = Math.round((attCompleted / attTotal) * 100);
      var pctAbsent = Math.round((attAbsent / attTotal) * 100);
      var pctNoShow = 100 - pctCompleted - pctAbsent;
      html += '<div style="display:flex;height:24px;border-radius:6px;overflow:hidden;margin-bottom:8px;">';
      if (pctCompleted > 0) html += '<div style="width:' + pctCompleted + '%;background:' + SUCCESS_COLOR + ';"></div>';
      if (pctAbsent > 0) html += '<div style="width:' + pctAbsent + '%;background:' + WARNING_COLOR + ';"></div>';
      if (pctNoShow > 0) html += '<div style="width:' + pctNoShow + '%;background:' + DANGER_COLOR + ';"></div>';
      html += '</div>';
      html += '<div style="display:flex;gap:1.5rem;font-size:0.78rem;color:var(--warm-gray);margin-bottom:2rem;">';
      html += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + SUCCESS_COLOR + ';margin-right:4px;vertical-align:middle;"></span>Completed (' + attCompleted + ')</span>';
      html += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + WARNING_COLOR + ';margin-right:4px;vertical-align:middle;"></span>Absent (' + attAbsent + ')</span>';
      html += '<span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + DANGER_COLOR + ';margin-right:4px;vertical-align:middle;"></span>No-Show (' + attNoShow + ')</span>';
      html += '</div>';
    }

    // Incident summary
    var filteredIncidents = allIncidents;
    if (cutoffDate) {
      filteredIncidents = allIncidents.filter(function(inc) {
        return dateStr(inc.createdAt).substring(0, 10) >= cutoffDate;
      });
    }
    if (filteredIncidents.length > 0) {
      html += '<h3 style="' + SECTION_H3 + '">Incidents (' + filteredIncidents.length + ')</h3>';
      // Severity counts
      var sevCounts = { low: 0, medium: 0, high: 0, critical: 0 };
      filteredIncidents.forEach(function(inc) { sevCounts[inc.severity] = (sevCounts[inc.severity] || 0) + 1; });
      html += '<div style="display:flex;gap:8px;margin-bottom:12px;">';
      ['critical', 'high', 'medium', 'low'].forEach(function(sev) {
        if (sevCounts[sev] > 0) {
          html += '<span style="' + badgeStyle(SEVERITY_BADGE_COLORS, sev) + '">' + sev + ': ' + sevCounts[sev] + '</span>';
        }
      });
      html += '</div>';

      // Recent incidents list (max 5)
      var recentInc = filteredIncidents.sort(function(a, b) { return dateStr(b.createdAt).localeCompare(dateStr(a.createdAt)); }).slice(0, 5);
      recentInc.forEach(function(inc) {
        var sevColor = SEVERITY_COLORS[inc.severity] || '#BDBDBD';
        html += '<div style="' + CARD_STYLE + 'margin-bottom:8px;border-left:3px solid ' + sevColor + ';">' +
          '<div style="display:flex;gap:8px;align-items:center;">' +
          '<span style="' + badgeStyle(SEVERITY_BADGE_COLORS, inc.severity) + '">' + esc(inc.severity) + '</span>' +
          '<span style="font-weight:500;font-size:0.9rem;">' + esc(INCIDENT_TYPE_LABELS[inc.type] || inc.type) + '</span>' +
          '<span style="color:var(--warm-gray);font-size:0.78rem;margin-left:auto;">' + esc(inc.followUpStatus || 'open') + '</span>' +
          '</div>' +
          '<p style="margin:6px 0 0;color:var(--warm-gray);font-size:0.85rem;">' + esc(inc.description) + '</p>' +
          '</div>';
      });
    }

    // Class performance table
    var classIds = Object.keys(classes);
    if (classIds.length > 0) {
      html += '<h3 style="' + SECTION_H3 + '">Class Performance</h3>';
      html += '<div style="overflow-x:auto;"><table class="data-table"><thead><tr><th>Class</th><th>Sessions</th><th>Attendance</th><th>Avg Enrolled</th><th>Revenue</th></tr></thead><tbody>';

      var classPerf = classIds.map(function(cid) {
        var cls = classes[cid];
        var clsSessions = filteredSessions.filter(function(s) { return s.classId === cid; });
        var clsCompleted = clsSessions.filter(function(s) { return s.status === 'completed'; });

        // Attendance for this class
        var clsAttTotal = 0, clsAttPresent = 0;
        clsCompleted.forEach(function(s) {
          var log = sessionLogs[s.id];
          if (!log || !log.attendance) return;
          Object.keys(log.attendance).forEach(function(eid) {
            clsAttTotal++;
            if (log.attendance[eid].status === 'completed') clsAttPresent++;
          });
        });
        var clsAttRate = clsAttTotal > 0 ? Math.round((clsAttPresent / clsAttTotal) * 100) : 0;

        // Avg enrollment
        var totalEnrolled = 0;
        clsSessions.forEach(function(s) { totalEnrolled += (s.enrolled || 0); });
        var avgEnrolled = clsSessions.length > 0 ? (totalEnrolled / clsSessions.length).toFixed(1) : '0';

        // Revenue for this class
        var clsRevenue = 0;
        filteredOrders.forEach(function(o) {
          if (!o.items) return;
          (Array.isArray(o.items) ? o.items : Object.values(o.items)).forEach(function(item) {
            if (item.bookingType === 'class' && item.classId === cid) {
              clsRevenue += (item.total || ((item.priceCents || 0) / 100) || item.price || 0);
            }
          });
        });

        return {
          name: cls.name || cid,
          sessions: clsCompleted.length + ' / ' + clsSessions.length,
          attRate: clsAttRate,
          avgEnrolled: avgEnrolled,
          revenue: clsRevenue,
          totalSessions: clsSessions.length
        };
      }).filter(function(p) { return p.totalSessions > 0; })
        .sort(function(a, b) { return b.totalSessions - a.totalSessions; });

      classPerf.forEach(function(p) {
        html += '<tr>' +
          '<td><strong>' + esc(p.name) + '</strong></td>' +
          '<td>' + p.sessions + '</td>' +
          '<td>' + p.attRate + '%</td>' +
          '<td>' + p.avgEnrolled + '</td>' +
          '<td>' + formatPrice(p.revenue) + '</td>' +
          '</tr>';
      });

      html += '</tbody></table></div>';
    }

    // Empty state
    if (filteredSessions.length === 0) {
      html = '<p style="' + EMPTY_STATE_STYLE + '">No session data for the selected time period.</p>';
    }

    // H4kGZi6 — prepend the workflow explainer so operators landing on
    // Class Reports get the full who-does-what-where map up front.
    content.innerHTML = _renderClassWorkflowExplainer() + html;
  }

  function _reportCard(label, value, color) {
    return '<div style="' + CARD_STYLE + 'text-align:center;">' +
      '<div style="font-size:1.6rem;font-weight:700;color:' + color + ';line-height:1.2;">' + value + '</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);text-transform:uppercase;letter-spacing:0.05em;margin-top:4px;">' + esc(label) + '</div>' +
      '</div>';
  }

  window._reportRangeChange = function() { loadReports(); };

  // ============================================================
  // Booking Settings
  // ============================================================

  async function loadBookSettings() {
    var container = document.getElementById('bookSettingsContent');
    if (!container) return;

    container.innerHTML = '<p style="color:var(--warm-gray);padding:1rem;">Loading settings...</p>';

    try {
      var config = (await MastDB.get('admin/config/booking')) || {};
      var cancelHours = config.cancellationWindowHours != null ? config.cancellationWindowHours : 48;

      container.innerHTML =
        '<div style="max-width:720px;">' +
          '<div class="book-form-section">' +
            '<h3 style="margin:0 0 16px;font-size:1rem;">Cancellation Policy</h3>' +
            '<div class="book-field">' +
              '<label class="form-label">Cancellation Review Window (hours)</label>' +
              '<input type="number" id="bsCancelWindow" class="form-input" min="0" max="720" step="1" value="' + cancelHours + '" style="max-width:120px;">' +
              '<div class="book-field-hint">Cancellations within this window before class start require admin review. Outside this window, refunds are issued automatically (store credit for paid bookings, pass restore for pass bookings).</div>' +
            '</div>' +
            '<div style="margin-top:12px;">' +
              '<button class="btn btn-primary" onclick="window._saveBookSettings()">Save Settings</button>' +
            '</div>' +
          '</div>' +
          '<div class="book-form-section" style="margin-top:24px;">' +
            '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">' +
              '<h3 style="margin:0;font-size:1rem;">Certification Types</h3>' +
              '<button class="btn btn-secondary" onclick="window._certTypeNew()">+ New Type</button>' +
            '</div>' +
            '<div class="book-field-hint" style="margin-bottom:12px;">Define the credentials your studio grants — instructor-attested or auto-granted on class completion. Archived types stay valid on existing student records.</div>' +
            '<div id="bsCertTypesList">Loading…</div>' +
          '</div>' +
        '</div>';

      _loadCertTypesIntoSettings();
    } catch (err) {
      console.error('[Book] Failed to load settings:', err);
      container.innerHTML = '<p style="color:var(--warm-gray);padding:1rem;">Failed to load settings.</p>';
    }
  }

  // ============================================================
  // Certification Types — catalog UI inside Book Settings
  // ============================================================

  var _certTypesCache = null;

  async function _loadCertTypesIntoSettings() {
    var list = document.getElementById('bsCertTypesList');
    if (!list) return;
    try {
      var data = (await MastDB.get('admin/certTypes')) || {};
      _certTypesCache = data;
      var ids = Object.keys(data);
      if (!ids.length) {
        list.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;padding:12px;background:var(--cream-light);border-radius:6px;">No certification types defined yet. Click <strong>+ New Type</strong> to add one.</div>';
        return;
      }
      var rows = ids.map(function(id) {
        var t = data[id] || {};
        var classCount = (t.autoGrantOnClassIds || []).length;
        var validity = t.validityDays ? (t.validityDays + 'd') : 'Lifetime';
        var status = t.archivedAt
          ? '<span style="color:var(--warm-gray);font-size:0.72rem;">Archived</span>'
          : '<span style="color:var(--teal,#2a7c6f);font-size:0.72rem;">Active</span>';
        return '<tr>' +
          '<td><strong>' + esc(t.name || id) + '</strong>' + (t.description ? '<div style="color:var(--warm-gray);font-size:0.78rem;">' + esc(t.description) + '</div>' : '') + '</td>' +
          '<td>' + esc(validity) + '</td>' +
          '<td>' + classCount + ' class' + (classCount === 1 ? '' : 'es') + '</td>' +
          '<td>' + status + '</td>' +
          '<td style="text-align:right;"><button class="btn btn-link" onclick="window._certTypeEdit(\'' + esc(id) + '\')">Edit</button>' +
            (t.archivedAt
              ? '<button class="btn btn-link" onclick="window._certTypeUnarchive(\'' + esc(id) + '\')">Unarchive</button>'
              : '<button class="btn btn-link" onclick="window._certTypeArchive(\'' + esc(id) + '\')">Archive</button>') +
          '</td>' +
        '</tr>';
      }).join('');
      list.innerHTML = '<table class="data-table"><thead><tr><th>Name</th><th>Validity</th><th>Auto-grant on</th><th>Status</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
    } catch (err) {
      console.error('[Book] Failed to load cert types:', err);
      list.innerHTML = '<div style="color:var(--warm-gray);">Failed to load cert types.</div>';
    }
  }

  function _renderCertTypeForm(existing) {
    var t = existing || {};
    var name = t.name || '';
    var desc = t.description || '';
    var validity = t.validityDays != null ? t.validityDays : '';
    var selected = {};
    (t.autoGrantOnClassIds || []).forEach(function(cid) { selected[cid] = true; });
    var classOptions = (classesData || []).map(function(c) {
      var checked = selected[c.id] ? ' checked' : '';
      return '<label style="display:flex;align-items:center;gap:6px;padding:4px 0;font-size:0.85rem;">' +
        '<input type="checkbox" name="ctAutoGrant" value="' + esc(c.id) + '"' + checked + '> ' + esc(c.name || c.id) +
      '</label>';
    }).join('') || '<div style="color:var(--warm-gray);font-size:0.85rem;">No classes loaded.</div>';

    return '<div style="display:flex;flex-direction:column;gap:14px;">' +
      '<div class="book-field"><label class="form-label">Name</label>' +
        '<input type="text" id="ctName" class="form-input" value="' + esc(name) + '" placeholder="e.g. Solo Torch Access"></div>' +
      '<div class="book-field"><label class="form-label">Description (optional)</label>' +
        '<textarea id="ctDesc" class="form-input" rows="2" placeholder="What does earning this cert mean?">' + esc(desc) + '</textarea></div>' +
      '<div class="book-field"><label class="form-label">Validity (days, blank = lifetime)</label>' +
        '<input type="number" id="ctValidity" class="form-input" min="1" step="1" value="' + esc(String(validity)) + '" style="max-width:140px;">' +
        '<div class="book-field-hint">If set, the cert expires this many days after grant. Lifetime certs never expire.</div></div>' +
      '<div class="book-field"><label class="form-label">Auto-grant on completion of these classes</label>' +
        '<div style="max-height:200px;overflow-y:auto;border:1px solid var(--cream-dark);border-radius:6px;padding:8px;">' + classOptions + '</div>' +
        '<div class="book-field-hint">When a student completes one of these classes, you\'ll be prompted to grant this cert.</div></div>' +
    '</div>';
  }

  window._certTypeNew = function() {
    if (!window.mastSlideOut || !window.mastSlideOut.open) {
      window.MastAdmin && MastAdmin.showToast('Slide-out unavailable', true);
      return;
    }
    window.mastSlideOut.open({
      title: 'New Certification Type',
      subtitle: null,
      bodyHtml: _renderCertTypeForm(null),
      footerHtml: '<button class="btn btn-primary" onclick="window._certTypeSave(null)">Create</button>',
      onClose: function() {}
    });
  };

  window._certTypeEdit = function(typeId) {
    if (!_certTypesCache || !_certTypesCache[typeId]) return;
    var t = _certTypesCache[typeId];
    if (!window.mastSlideOut || !window.mastSlideOut.open) return;
    window.mastSlideOut.open({
      title: 'Edit ' + (t.name || typeId),
      subtitle: null,
      bodyHtml: _renderCertTypeForm(t),
      footerHtml: '<button class="btn btn-primary" onclick="window._certTypeSave(\'' + typeId.replace(/'/g, "\\'") + '\')">Save</button>',
      onClose: function() {}
    });
  };

  // ── ClassSettingsBridge — the legacy Book→Settings tab's writes, state-free
  // (V1-removal: the V2 home is the classes hub's Settings lens). Shapes mirror
  // _saveBookSettings / _certTypeSave / _certTypeArchive exactly.
  window.ClassSettingsBridge = {
    getConfig: function () { return MastDB.get('admin/config/booking'); },
    setCancellationWindow: async function (hours) {
      var h = parseInt(hours, 10);
      if (isNaN(h) || h < 0 || h > 720) throw new Error('Enter a valid number of hours (0-720).');
      await MastDB.update('admin/config/booking', { cancellationWindowHours: h });
    },
    listCertTypes: function () { return MastDB.get('admin/certTypes'); },
    saveCertType: async function (typeId, data) {
      var name = (data.name || '').trim();
      if (!name) throw new Error('Name is required');
      var validity = null;
      if (data.validityDays !== '' && data.validityDays != null && !isNaN(parseInt(data.validityDays, 10))) {
        validity = Math.max(1, parseInt(data.validityDays, 10));
      }
      var autoGrantIds = Array.isArray(data.autoGrantOnClassIds) ? data.autoGrantOnClassIds : [];
      var now = new Date().toISOString();
      if (typeId) {
        await MastDB.update('admin/certTypes/' + typeId, {
          name: name, description: (data.description || '').trim() || null,
          validityDays: validity, autoGrantOnClassIds: autoGrantIds, updatedAt: now
        });
        return typeId;
      }
      var newId = 'cert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      await MastDB.set('admin/certTypes/' + newId, {
        id: newId, name: name, description: (data.description || '').trim() || null,
        validityDays: validity, autoGrantOnClassIds: autoGrantIds,
        expiryNoticeDays: [30, 7, 0], archivedAt: null, createdAt: now, updatedAt: now
      });
      return newId;
    },
    archiveCertType: async function (typeId) {
      await MastDB.update('admin/certTypes/' + typeId, { archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    },
    unarchiveCertType: async function (typeId) {
      await MastDB.update('admin/certTypes/' + typeId, { archivedAt: null, updatedAt: new Date().toISOString() });
    }
  };

  window._certTypeSave = async function(typeId) {
    var name = (document.getElementById('ctName') || {}).value;
    if (!name || !name.trim()) {
      MastAdmin && MastAdmin.showToast('Name is required', true);
      return;
    }
    var desc = (document.getElementById('ctDesc') || {}).value || '';
    var validityRaw = (document.getElementById('ctValidity') || {}).value || '';
    var validity = null;
    if (validityRaw !== '' && !isNaN(parseInt(validityRaw, 10))) {
      validity = Math.max(1, parseInt(validityRaw, 10));
    }
    var autoGrantIds = [];
    document.querySelectorAll('input[name="ctAutoGrant"]:checked').forEach(function(el) {
      autoGrantIds.push(el.value);
    });
    var now = new Date().toISOString();
    try {
      if (typeId) {
        await MastDB.update('admin/certTypes/' + typeId, {
          name: name.trim(),
          description: desc.trim() || null,
          validityDays: validity,
          autoGrantOnClassIds: autoGrantIds,
          updatedAt: now
        });
        MastAdmin && MastAdmin.showToast('Cert type updated');
      } else {
        var newId = 'cert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        await MastDB.set('admin/certTypes/' + newId, {
          id: newId,
          name: name.trim(),
          description: desc.trim() || null,
          validityDays: validity,
          autoGrantOnClassIds: autoGrantIds,
          expiryNoticeDays: [30, 7, 0],
          archivedAt: null,
          createdAt: now,
          updatedAt: now
        });
        MastAdmin && MastAdmin.showToast('Cert type created');
      }
      window.mastSlideOut && window.mastSlideOut.close && window.mastSlideOut.close();
      _loadCertTypesIntoSettings();
    } catch (err) {
      console.error('[Book] Failed to save cert type:', err);
      MastAdmin && MastAdmin.showToast('Save failed: ' + (err.message || err), true);
    }
  };

  window._certTypeArchive = async function(typeId) {
    if (!confirm('Archive this cert type? Existing student certs remain valid; the type just hides from new grants.')) return;
    try {
      await MastDB.update('admin/certTypes/' + typeId, { archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      MastAdmin && MastAdmin.showToast('Archived');
      _loadCertTypesIntoSettings();
    } catch (err) {
      MastAdmin && MastAdmin.showToast('Archive failed', true);
    }
  };

  window._certTypeUnarchive = async function(typeId) {
    try {
      await MastDB.update('admin/certTypes/' + typeId, { archivedAt: null, updatedAt: new Date().toISOString() });
      MastAdmin && MastAdmin.showToast('Restored');
      _loadCertTypesIntoSettings();
    } catch (err) {
      MastAdmin && MastAdmin.showToast('Restore failed', true);
    }
  };

  // ============================================================
  // Cert Grant Prompt (fires on enrollment-complete)
  // ============================================================

  async function _maybePromptGrantCertForEnrollment(enrollment) {
    var classId = enrollment.classId;
    if (!classId) return;
    var allTypes = (await MastDB.get('admin/certTypes')) || {};
    var matchedTypeId = null;
    var matchedType = null;
    Object.keys(allTypes).forEach(function(tid) {
      var t = allTypes[tid];
      if (!t || t.archivedAt) return;
      if (Array.isArray(t.autoGrantOnClassIds) && t.autoGrantOnClassIds.indexOf(classId) !== -1) {
        matchedTypeId = tid;
        matchedType = t;
      }
    });
    if (!matchedTypeId) return;
    return _promptGrantCertOnComplete(enrollment, matchedTypeId, matchedType);
  }

  async function _promptGrantCertOnComplete(enrollment, typeId, certType) {
    if (!certType || certType.archivedAt) {
      console.warn('[book] cert type missing or archived:', typeId);
      return;
    }

    // Resolve customerId — required for the cert path. Try direct field, then
    // email-index resolver (same pattern as commit 8426f70).
    var customerId = enrollment.customerId || null;
    var email = (enrollment.studentEmail || enrollment.customerEmail || '').toLowerCase().trim();
    if (!customerId && email) {
      // Canonical key (gmail dot/+tag aware) so lookups match the resolver's index.
      var indexKey = (window.MastCustomerResolver && window.MastCustomerResolver.emailKey(email)) || email.replace(/[.#$[\]/]/g, ',');
      customerId = await MastDB.get('admin/customerIndexes/byEmail/' + indexKey).catch(function() { return null; });
    }
    if (!customerId) {
      MastAdmin && MastAdmin.showToast('Cert grant skipped: no customer record linked to enrollment', true);
      return;
    }

    var studentName = enrollment.studentName || enrollment.customerName || email || 'this student';

    var ok = confirm('Class completed. Grant "' + certType.name + '" certification to ' + studentName + '?');
    if (!ok) return;

    await _grantCert({
      typeId: typeId,
      customerId: customerId,
      sourceClassId: enrollment.classId || null,
      sourceEnrollmentId: enrollment.id || enrollment._id || null,
      certType: certType
    });
  }

  async function _grantCert(input) {
    var customerId = input.customerId;
    var typeId = input.typeId;
    var certType = input.certType || (await MastDB.get('admin/certTypes/' + typeId));
    if (!certType || certType.archivedAt) {
      MastAdmin && MastAdmin.showToast('Cannot grant: cert type missing or archived', true);
      return null;
    }

    var now = new Date().toISOString();
    var expiresAt = (typeof certType.validityDays === 'number' && certType.validityDays > 0)
      ? MastFormat.addDays(new Date(), certType.validityDays).toISOString()
      : null;

    var grantedByEmpId = (window.MastAdmin && MastAdmin.currentUser && MastAdmin.currentUser.uid) || 'system';
    var grantedByName = (window.MastAdmin && MastAdmin.currentUser && (MastAdmin.currentUser.displayName || MastAdmin.currentUser.email)) || 'system';

    // Idempotent re-grant: find existing non-revoked instance with same typeId.
    var existing = (await MastDB.get('admin/customers/' + customerId + '/certifications')) || {};
    var existingId = null;
    var existingRec = null;
    Object.keys(existing).forEach(function(cid) {
      var c = existing[cid];
      if (c && c.typeId === typeId && !c.revokedAt) {
        existingId = cid;
        existingRec = c;
      }
    });

    var instructorSnap = { empId: grantedByEmpId, displayName: grantedByName };

    if (existingId && existingRec) {
      var history = Array.isArray(existingRec.history) ? existingRec.history.slice() : [];
      history.push({
        grantedAt: existingRec.grantedAt,
        grantedBy: existingRec.grantedBy,
        sourceClassId: existingRec.sourceClassId,
        sourceEnrollmentId: existingRec.sourceEnrollmentId,
        instructorOfRecord: existingRec.instructorOfRecord,
        expiresAt: existingRec.expiresAt
      });
      await MastDB.update('admin/customers/' + customerId + '/certifications/' + existingId, {
        grantedAt: now,
        grantedBy: grantedByEmpId,
        sourceClassId: input.sourceClassId || null,
        sourceEnrollmentId: input.sourceEnrollmentId || null,
        instructorOfRecord: instructorSnap,
        expiresAt: expiresAt,
        expiryNoticesSent: [],
        history: history
      });
      MastAdmin && MastAdmin.showToast('Certification re-granted');
      return { certId: existingId, regranted: true };
    }

    var newId = 'cert_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    await MastDB.set('admin/customers/' + customerId + '/certifications/' + newId, {
      id: newId,
      typeId: typeId,
      grantedAt: now,
      grantedBy: grantedByEmpId,
      sourceClassId: input.sourceClassId || null,
      sourceEnrollmentId: input.sourceEnrollmentId || null,
      instructorOfRecord: instructorSnap,
      expiresAt: expiresAt,
      expiryNoticesSent: [],
      revokedAt: null,
      revokedBy: null,
      revokeReason: null,
      history: []
    });
    MastAdmin && MastAdmin.showToast('Certification granted');
    return { certId: newId, regranted: false };
  }

  // Exposed for customers module (manual grant from customer detail).
  window._bookGrantCert = _grantCert;

  window._saveBookSettings = async function() {
    var cancelInput = document.getElementById('bsCancelWindow');
    if (!cancelInput) return;

    var hours = parseInt(cancelInput.value, 10);
    if (isNaN(hours) || hours < 0 || hours > 720) {
      if (typeof MastAdmin !== 'undefined' && MastAdmin.showToast) MastAdmin.showToast('Please enter a valid number of hours (0-720)');
      return;
    }

    try {
      await MastDB.update('admin/config/booking', {
        cancellationWindowHours: hours
      });
      if (typeof MastAdmin !== 'undefined' && MastAdmin.showToast) MastAdmin.showToast('Settings saved');
    } catch (err) {
      console.error('[Book] Failed to save settings:', err);
      if (typeof MastAdmin !== 'undefined' && MastAdmin.showToast) MastAdmin.showToast('Failed to save settings');
    }
  };

  // ============================================================
  // Module Registration
  // ============================================================

  // Register MastNavStack restorer for the book route — re-opens
  // a class detail when popping back from a cross-module navigation.
  if (window.MastNavStack) {
    window.MastNavStack.registerRestorer('book', function(view, state) {
      // Phase 10: calendar restore — return to the same month + selected day
      if (view === 'calendar' && state) {
        switchSubTab('calendar');
        if (typeof state.calendarYear === 'number')  calendarYear  = state.calendarYear;
        if (typeof state.calendarMonth === 'number') calendarMonth = state.calendarMonth;
        if (state.selectedCalendarDay) selectedCalendarDay = state.selectedCalendarDay;
        loadCalendar();
        return;
      }
      if (view !== 'detail' || !state || !state.classId) return;
      var openIt = function() {
        loadClassDetail(state.classId);
        if (state.scrollTop != null) {
          setTimeout(function() { window.scrollTo(0, state.scrollTop); }, 50);
        }
      };
      // classesData may not be loaded yet if cross-module hop
      if (!classesData || !classesData.length) {
        var tries = 0;
        var iv = setInterval(function() {
          if ((classesData && classesData.length) || tries++ > 25) {
            clearInterval(iv); openIt();
          }
        }, 100);
      } else openIt();
    });
  }

  // ============================================================
  // Ask AI registration — Enrollments
  // ============================================================

  function paintEnrollmentsAskAiSlot() {
    var slot = document.getElementById('enrollmentsAskAiSlot');
    if (!slot) return;
    if (window.MastAskAi && window.MastAskAi.isEnabled()) {
      slot.innerHTML = '<button class="btn btn-secondary btn-small" onclick="MastAskAi.open(\'enrollments\')" title="Ask Claude about your enrollments">✨ Ask AI</button>';
    } else {
      slot.innerHTML = '';
    }
  }

  window.addEventListener('mastaskai:ready', paintEnrollmentsAskAiSlot);
  window.addEventListener('mastaskai:configchanged', paintEnrollmentsAskAiSlot);
  // Paint immediately in case mastaskai:ready already fired before this lazy module loaded.
  paintEnrollmentsAskAiSlot();

  if (window.MastAskAi) {
    window.MastAskAi.register('enrollments', {
      title: 'Ask AI about your enrollments',
      placeholder: 'e.g. What\'s my fill rate by class? Which classes are waitlisted? Who are my repeat students?',
      notes: [
        'Statuses: confirmed (paid + holding seat), waitlisted (queued for cancellation seat), cancelled, completed (attended), no-show (registered but did not attend), late.',
        'pricePaidCents is in cents; pricePaid (without suffix) may also exist — prefer pricePaidCents when both are present.',
        'byClass aggregates by classId — match against classMap for human-readable names where available.',
        'topClassesByRevenue ranks by total dollars collected from enrollments in the current view.',
        'topStudents counts enrollments per student email — repeat customers for the class business.',
        'no-show rate (noShowCount / completedCount + noShowCount) is a useful health metric for class confirmations.',
        'If filters.status or filters.class is set, all aggregates reflect that filtered view.'
      ],
      buildContext: function() {
        var statusFilter = (document.getElementById('enrollFilterStatus') || {}).value || 'all';
        var classFilter = (document.getElementById('enrollFilterClass') || {}).value || 'all';
        var filtered = enrollmentsData.filter(function(e) {
          if (statusFilter !== 'all' && e.status !== statusFilter) return false;
          if (classFilter !== 'all' && e.classId !== classFilter) return false;
          return true;
        });

        var byStatus = {}, byClass = {}, byMonth = {}, byStudent = {};
        var totalPaidCents = 0;
        filtered.forEach(function(e) {
          var status = e.status || 'confirmed';
          if (!byStatus[status]) byStatus[status] = { count: 0, totalCents: 0 };
          byStatus[status].count++;
          var paid = e.pricePaidCents || (e.pricePaid ? Math.round(e.pricePaid * 100) : 0);
          byStatus[status].totalCents += paid;
          totalPaidCents += paid;

          var classId = e.classId || '(unknown)';
          var className = (typeof allClassesMap !== 'undefined' && allClassesMap[classId]) ? allClassesMap[classId].name : classId;
          if (!byClass[classId]) byClass[classId] = { name: className, count: 0, totalCents: 0, byStatus: {} };
          byClass[classId].count++;
          byClass[classId].totalCents += paid;
          byClass[classId].byStatus[status] = (byClass[classId].byStatus[status] || 0) + 1;

          var month = (e.enrolledAt || '').substring(0, 7) || 'unknown';
          if (!byMonth[month]) byMonth[month] = { count: 0, totalCents: 0 };
          byMonth[month].count++; byMonth[month].totalCents += paid;

          var student = e.studentEmail || e.customerEmail || '(no email)';
          if (!byStudent[student]) byStudent[student] = { count: 0, totalCents: 0, name: e.studentName || e.customerName || '' };
          byStudent[student].count++; byStudent[student].totalCents += paid;
        });

        var topClassesByRevenue = Object.keys(byClass)
          .map(function(id) {
            return {
              classId: id,
              name: byClass[id].name,
              enrollmentCount: byClass[id].count,
              revenueUSD: +(byClass[id].totalCents / 100).toFixed(2),
              byStatus: byClass[id].byStatus
            };
          })
          .sort(function(a, b) { return b.revenueUSD - a.revenueUSD; })
          .slice(0, 10);

        var topStudents = Object.keys(byStudent)
          .map(function(email) {
            return {
              email: email,
              name: byStudent[email].name,
              enrollmentCount: byStudent[email].count,
              totalSpentUSD: +(byStudent[email].totalCents / 100).toFixed(2)
            };
          })
          .sort(function(a, b) { return b.enrollmentCount - a.enrollmentCount; })
          .slice(0, 10);

        var completedCount = (byStatus['completed'] || { count: 0 }).count;
        var noShowCount = (byStatus['no-show'] || { count: 0 }).count;
        var noShowRate = (completedCount + noShowCount) > 0
          ? +(noShowCount / (completedCount + noShowCount)).toFixed(3)
          : null;

        return {
          route: '/app#enrollments',
          pageTitle: 'Classes → Enrollments',
          filters: {
            status: statusFilter,
            classId: classFilter !== 'all' ? classFilter : null
          },
          aggregates: {
            rowCount: filtered.length,
            totalPaidCents: totalPaidCents,
            totalPaidUSD: +(totalPaidCents / 100).toFixed(2),
            noShowRate: noShowRate,
            byStatus: byStatus,
            byMonth: byMonth
          },
          topClassesByRevenue: topClassesByRevenue,
          topStudents: topStudents
        };
      }
    });
  }

  // URL-filter clear handlers — drop filter params + re-navigate.
  window.clearClassesFilter = function() {
    var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var next = {};
    var DROP = { status: 1, category: 1, type: 1, classIds: 1 };
    Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
    if (typeof navigateTo === 'function') navigateTo('book', next);
  };
  window.clearEnrollmentsFilter = function() {
    var p = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var next = {};
    var DROP = { status: 1, classId: 1, sessionId: 1, dateFrom: 1, dateTo: 1, enrollmentIds: 1 };
    Object.keys(p).forEach(function(k) { if (!DROP[k]) next[k] = p[k]; });
    if (typeof navigateTo === 'function') navigateTo('enrollments', next);
  };

  // URL-filter clears for MCP admin-link landings (book sub-tabs)
  window.clearInstructorsFilter = function() {
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var clean = {};
    Object.keys(rp || {}).forEach(function(k) {
      if (k !== 'status' && k !== 'instructorIds') clean[k] = rp[k];
    });
    if (typeof window.navigateTo === 'function') window.navigateTo('instructors', clean);
    else location.hash = '#instructors';
    setTimeout(function() { if (typeof renderInstructorList === 'function') renderInstructorList(); }, 0);
  };
  window.clearResourcesFilter = function() {
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var clean = {};
    Object.keys(rp || {}).forEach(function(k) {
      if (k !== 'type' && k !== 'status' && k !== 'resourceIds') clean[k] = rp[k];
    });
    if (typeof window.navigateTo === 'function') window.navigateTo('resources', clean);
    else location.hash = '#resources';
    setTimeout(function() { if (typeof renderResourceList === 'function') renderResourceList(); }, 0);
  };
  window.clearPassesFilter = function() {
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var clean = {};
    Object.keys(rp || {}).forEach(function(k) {
      if (k !== 'status' && k !== 'type' && k !== 'passDefinitionIds') clean[k] = rp[k];
    });
    if (typeof window.navigateTo === 'function') window.navigateTo('passes', clean);
    else location.hash = '#passes';
    setTimeout(function() { if (typeof renderPassDefList === 'function') renderPassDefList(); }, 0);
  };

  MastAdmin.registerModule('book', {
    routes: {
      'book': { tab: 'bookTab', setup: function() { loadClasses(); switchSubTab('classes'); } },
      'book-detail': { tab: 'bookTab', setup: function() {
        // The framework calls setup() without args. Read the classId from the
        // hash params so deep-links like #book-detail?id=abc work — this is
        // also the entrypoint customersOpenActivityDrillIn('classes', id) uses.
        var id = (typeof window.getRouteParams === 'function') ? (window.getRouteParams().id || null) : null;
        if (id) { loadClassDetail(id); } else { loadClasses(); switchSubTab('classes'); }
      } },
      'enrollments': { tab: 'bookTab', setup: function() { switchSubTab('enrollments'); } },
      'instructors': { tab: 'bookTab', setup: function() { switchSubTab('instructors'); } },
      'instructor-detail': { tab: 'bookTab', setup: function(id) { if (id) { showInstructorForm(id); } else { switchSubTab('instructors'); } } },
      'resources': { tab: 'bookTab', setup: function() { switchSubTab('resources'); } },
      'resource-detail': { tab: 'bookTab', setup: function(id) { if (id) { showResourceForm(id); } else { switchSubTab('resources'); } } },
      'passes': { tab: 'bookTab', setup: function() { switchSubTab('passes'); } },
      'pass-detail': { tab: 'bookTab', setup: function(id) { if (id) { showPassDefForm(id); } else { switchSubTab('passes'); } } },
      'calendar': { tab: 'bookTab', setup: function() { switchSubTab('calendar'); } },
      'book-reports': { tab: 'bookTab', setup: function() { switchSubTab('book-reports'); } },
      'book-settings': { tab: 'bookTab', setup: function() { switchSubTab('book-settings'); } }
    },
    detachListeners: function() {
      classesData = [];
      classesLoaded = false;
      selectedClassId = null;
      sessionsData = [];
      enrollmentsData = [];
      enrollmentsLoaded = false;
      allClassesMap = {};
      instructorsData = [];
      instructorsLoaded = false;
      instructorsMap = {};
      resourcesData = [];
      resourcesLoaded = false;
      resourcesMap = {};
      passDefsData = [];
      passDefsLoaded = false;
      calendarYear = new Date().getFullYear();
      calendarMonth = new Date().getMonth();
      calendarSessions = [];
      calendarClassesMap = {};
      calendarLoaded = false;
      selectedCalendarDay = null;
      reportsLoaded = false;
      currentSubTab = 'classes';
    }
  });

})();
