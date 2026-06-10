/**
 * cs-surveys-v2.js — surveys hub (CS Wave 3,
 * docs/ux-audit/customer-service-v2-build-plan.md — the greenfield build).
 *
 * The legacy #cs-surveys tab is a 5-sub-tab composite (surveys / questions /
 * question sets / triggers / responses) rendered as hand-rolled card stacks.
 * This hub re-hosts it on the Entity Engine as ONE page with lens pills
 * (Surveys · Responses · Question sets · Question library) + an Automation
 * card (the automated-sends toggle + the sending rules with on/off switches).
 *
 * Record archetype per lens: each lens is a schema-driven list whose row click
 * opens a record SO; Surveys / Question sets / Question library have full
 * create/edit/delete; Responses are READ-ONLY (customer answers are facts).
 * Every write delegates to the state-free CsSurveysBridge cores on
 * customer-service.js (which the legacy handlers also call) — write shapes,
 * incl. the survey tokenSecret mint, stay single-sourced.
 *
 * Stays classic (linked): bulk send-to-segment, VoC digest, response theme
 * tags, ask-for-photo. Send-to-one-customer and Preview live here natively
 * (generateSurveyLink CF via the bridge).
 * Flag-gated (?ui=1) at #cs-surveys-v2; legacy #cs-surveys untouched.
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
  function can(axis) { return (typeof window.can === 'function') ? window.can('cs-surveys', axis) : true; }
  function bridge() { return window.CsSurveysBridge; }

  var Q_TYPES = [
    { value: 'rating_1_5', label: 'Rating (1–5 stars)' },
    { value: 'rating_1_10', label: 'Rating (1–10)' },
    { value: 'nps', label: 'Recommend score (NPS)' },
    { value: 'yes_no', label: 'Yes / No' },
    { value: 'multiple_choice', label: 'Multiple choice' },
    { value: 'open_text', label: 'Open text' }
  ];
  var Q_TYPE_LABEL = {}; Q_TYPES.forEach(function (t) { Q_TYPE_LABEL[t.value] = t.label; });
  var EVENT_LABELS = {
    order_placed: 'After an order', class_attended: 'After a class',
    rma_completed: 'After a return', cart_abandoned: 'Abandoned cart', manual: 'Sent by hand'
  };
  // Stored survey status vocab (draft/active/inactive) + computed 'closed'.
  var SV_STATUS_LABEL = { draft: 'Draft', active: 'Live', inactive: 'Paused', closed: 'Closed' };
  var SV_STATUS_TONE = { draft: 'neutral', active: 'success', inactive: 'amber', closed: 'neutral' };
  var RESP_STATUS_LABEL = { pending: 'Invited', completed: 'Completed', expired: 'Expired', preview: 'Preview' };
  var RESP_STATUS_TONE = { pending: 'info', completed: 'success', expired: 'neutral', preview: 'neutral' };

  var V2 = {
    lens: 'surveys', loaded: false, busy: false,
    questions: {}, groups: {}, surveys: {}, triggers: {}, responses: {},
    automationEnabled: false,
    sortKey: null, sortDir: 'desc'
  };

  function surveyStatusOf(s) {
    if (s.closesAt && Date.now() > new Date(s.closesAt).getTime()) return 'closed';
    return s.status || 'draft';
  }
  function groupName(gid) { var g = V2.groups[gid]; return (g && g.name) || '—'; }
  function responseCountFor(surveyId) {
    return Object.values(V2.responses).filter(function (r) { return r && r.surveyId === surveyId && r.status !== 'preview'; }).length;
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  function defineEntities() {
    if (MastEntity.get('cs-surveys-v2')) return;

    MastEntity.define('cs-surveys-v2', {
      label: 'Survey', labelPlural: 'Surveys', size: 'lg',
      route: 'cs-surveys-v2',
      recordId: function (s) { return s.id; },
      fields: [
        { name: 'name', label: 'Survey', type: 'text', list: true, required: true, group: 'Survey' },
        { name: 'groupId', label: 'Question set', type: 'select', required: true, group: 'Survey', options: [] /* filled per-open */ },
        { name: 'status', label: 'Status', type: 'status', list: true,
          options: [{ value: 'draft', label: 'Draft' }, { value: 'active', label: 'Live' }, { value: 'inactive', label: 'Paused' }],
          format: function (v) { return SV_STATUS_LABEL[v] || v; },
          tone: function (v) { return SV_STATUS_TONE[v] || 'neutral'; } },
        { name: 'closesDate', label: 'Closes on (YYYY-MM-DD, optional)', group: 'Survey' },
        { name: '_set', label: 'Question set', type: 'text', list: true, readOnly: true, get: function (s) { return groupName(s.groupId); } },
        { name: '_resp', label: 'Responses', type: 'number', list: true, readOnly: true, align: 'right', get: function (s) { return responseCountFor(s.id); } },
        { name: 'createdAt', label: 'Created', type: 'date', list: true, readOnly: true, get: function (s) { return s.createdAt || null; } }
      ],
      fetch: function (id) { return ensureLoaded().then(function () { return prepSurvey(V2.surveys[id]) || null; }); },
      detail: {
        render: function (_U, s) {
          var st = surveyStatusOf(s);
          var grp = V2.groups[s.groupId];
          var qCount = grp ? (grp.questionIds || []).length : 0;
          var h = U.tiles([
            { k: 'Status', v: U.badge(SV_STATUS_LABEL[st] || st, SV_STATUS_TONE[st] || 'neutral'), hero: true },
            { k: 'Question set', v: esc(groupName(s.groupId)) + ' <span class="mu-sub">(' + qCount + ' question' + (qCount === 1 ? '' : 's') + ')</span>' },
            { k: 'Responses', v: String(responseCountFor(s.id)) },
            { k: 'Closes', v: s.closesAt ? N.date(s.closesAt) : 'Open-ended' }
          ]);
          var qList = grp && (grp.questionIds || []).length
            ? (grp.questionIds || []).map(function (qid, i) {
                var q = V2.questions[qid];
                return '<div style="font-size:0.85rem;padding:4px 0;">' + (i + 1) + '. ' + esc(q ? q.text : '(question removed)') +
                  (q ? ' <span class="mu-sub">' + esc(Q_TYPE_LABEL[q.type] || q.type) + '</span>' : '') + '</div>';
              }).join('')
            : '<span class="mu-sub">No questions in this set yet.</span>';
          h += U.card('Questions asked', qList);

          if (can('edit')) {
            h += U.card('Send to a customer',
              '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
                '<input id="csSvV2Email" class="form-input" placeholder="customer@email.com" style="width:220px;font-size:0.85rem;">' +
                '<input id="csSvV2Name" class="form-input" placeholder="Name (optional)" style="width:160px;font-size:0.85rem;">' +
                '<button class="btn btn-primary btn-small" onclick="CsSurveysV2.sendOne(\'' + esc(s.id) + '\')">Send invite</button>' +
                '<button class="btn btn-secondary btn-small" onclick="CsSurveysV2.preview(\'' + esc(s.id) + '\')" title="Open the survey as a customer would see it">Preview ↗</button>' +
              '</div>' +
              '<div class="mu-sub" style="margin-top:8px;">Sending to a whole segment (and the VoC digest) lives in the <a href="javascript:void(0)" onclick="CsSurveysV2.classic()" style="color:var(--teal);">classic view</a> for now.</div>');
          }
          if (can('delete')) {
            h += '<div style="margin-top:14px;"><button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="CsSurveysV2.removeSurvey(\'' + esc(s.id) + '\')">Delete survey</button></div>';
          }
          return h;
        }
      },
      onSave: function (rec, mode) {
        if (!can('edit')) { showToast('Surveys write access required.', true); return false; }
        var closesAt = null;
        var cd = (rec.closesDate || '').trim();
        if (cd) {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(cd)) { showToast('Closes date must be YYYY-MM-DD', true); return false; }
          closesAt = cd + 'T23:59:59.000Z';
        }
        var id = mode === 'create' ? null : rec.id;
        return bridge().saveSurvey(id, { name: rec.name, groupId: rec.groupId, status: rec.status || 'draft', closesAt: closesAt }).then(function () {
          showToast(id ? 'Survey updated' : 'Survey created');
          return load().then(function () { return true; });
        }).catch(function (e) { showToast('Save failed: ' + (e.message || e), true); return false; });
      }
    });

    // Responses — read-only record (customer answers are facts, not drafts).
    MastEntity.define('cs-survey-responses-v2', {
      label: 'Response', labelPlural: 'Responses', size: 'lg',
      recordId: function (r) { return r.id || r.responseId; },
      fields: [
        { name: 'who', label: 'Customer', type: 'text', list: true, readOnly: true, get: function (r) { return r.contactName || r.contactEmail || 'Anonymous'; } },
        { name: '_survey', label: 'Survey', type: 'text', list: true, readOnly: true, get: function (r) { var s = V2.surveys[r.surveyId]; return (s && s.name) || '—'; } },
        { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
          options: Object.keys(RESP_STATUS_LABEL), get: function (r) { return r.status || 'pending'; },
          format: function (v) { return RESP_STATUS_LABEL[v] || v; },
          tone: function (v) { return RESP_STATUS_TONE[v] || 'neutral'; } },
        { name: '_answers', label: 'Answers', type: 'number', list: true, readOnly: true, align: 'right', get: function (r) { return (r.answers || []).length; } },
        { name: 'completedAt', label: 'Completed', type: 'date', list: true, readOnly: true, get: function (r) { return r.completedAt || null; } }
      ],
      fetch: function (id) { return ensureLoaded().then(function () { return V2.responses[id] || null; }); },
      detail: {
        render: function (_U, r) {
          var s = V2.surveys[r.surveyId];
          var h = U.kv([
            { k: 'Customer', v: esc(r.contactName || '—') + (r.contactEmail ? ' (' + esc(r.contactEmail) + ')' : '') },
            { k: 'Survey', v: esc((s && s.name) || '—') },
            { k: 'Status', v: U.badge(RESP_STATUS_LABEL[r.status || 'pending'] || r.status, RESP_STATUS_TONE[r.status || 'pending'] || 'neutral') },
            { k: 'Invited', v: r.createdAt ? N.date(r.createdAt) : '—' },
            { k: 'Completed', v: r.completedAt ? N.date(r.completedAt) : '—' },
            { k: 'Asked for follow-up', v: r.wantsFollowup ? 'Yes' + (r.followupTicketId ? ' — <a href="javascript:void(0)" onclick="CsSurveysV2.openTicket(\'' + esc(r.followupTicketId) + '\')" style="color:var(--teal);">open the conversation</a>' : '') : 'No' }
          ]);
          var answers = (r.answers || []).map(function (a) {
            var q = V2.questions[a.questionId];
            var label = (q && q.text) || a.questionText || a.questionId || '(question)';
            var val = (a.answer != null ? a.answer : a.value);
            return '<div style="margin-bottom:10px;"><div class="mu-sub" style="font-size:0.78rem;">' + esc(label) + '</div>' +
              '<div style="font-size:0.9rem;">' + esc(val == null ? '—' : String(val)) + '</div></div>';
          }).join('') || '<span class="mu-sub">No answers yet — the customer hasn\'t opened the survey.</span>';
          return U.card('Response', h) + U.card('Answers', answers);
        }
      }
    });

    // Question sets — custom editRender (checkbox question picker).
    MastEntity.define('cs-survey-sets-v2', {
      label: 'Question set', labelPlural: 'Question sets', size: 'lg',
      recordId: function (g) { return g.id; },
      fields: [
        { name: 'name', label: 'Question set', type: 'text', list: true, required: true, group: 'Set' },
        { name: '_event', label: 'Used for', type: 'text', list: true, readOnly: true, get: function (g) { return g.eventType ? (EVENT_LABELS[g.eventType] || g.eventType) : '—'; } },
        { name: '_count', label: 'Questions', type: 'number', list: true, readOnly: true, align: 'right', get: function (g) { return (g.questionIds || []).length; } },
        { name: '_used', label: 'Used by surveys', type: 'number', list: true, readOnly: true, align: 'right', get: function (g) { return surveysUsingGroup(g.id).length; } }
      ],
      fetch: function (id) { return ensureLoaded().then(function () { return V2.groups[id] || null; }); },
      detail: {
        render: function (_U, g) {
          var qs = (g.questionIds || []).map(function (qid, i) {
            var q = V2.questions[qid];
            return '<div style="font-size:0.85rem;padding:4px 0;">' + (i + 1) + '. ' + esc(q ? q.text : '(question removed)') +
              (q ? ' <span class="mu-sub">' + esc(Q_TYPE_LABEL[q.type] || q.type) + '</span>' : '') + '</div>';
          }).join('') || '<span class="mu-sub">No questions yet — edit the set to add some.</span>';
          var used = surveysUsingGroup(g.id);
          var h = U.kv([
            { k: 'Used for', v: g.eventType ? esc(EVENT_LABELS[g.eventType] || g.eventType) : '—' },
            { k: 'Used by', v: used.length ? used.map(function (s) { return esc(s.name); }).join(', ') : 'No surveys yet' }
          ]);
          h = U.card('Question set', h) + U.card('Questions (in order)', qs);
          if (can('delete')) {
            h += '<div style="margin-top:14px;"><button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="CsSurveysV2.removeGroup(\'' + esc(g.id) + '\')">Delete set</button></div>';
          }
          return h;
        },
        editRender: function (g, mode) {
          var qItems = Object.values(V2.questions);
          var sel = (g && g.questionIds) || [];
          var evOpts = [{ value: '', label: '— None / manual —' }].concat(Object.keys(EVENT_LABELS).map(function (k) { return { value: k, label: EVENT_LABELS[k] }; }));
          var h = '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">Name *</label>' +
            '<input class="form-input" name="name" value="' + esc((g && g.name) || '') + '" style="width:100%;"></div>';
          h += '<div class="form-group" style="margin-bottom:12px;"><label class="form-label">Used for</label>' +
            '<select class="form-input" name="eventType" style="width:100%;">' +
            evOpts.map(function (o) { return '<option value="' + esc(o.value) + '"' + (((g && g.eventType) || '') === o.value ? ' selected' : '') + '>' + esc(o.label) + '</option>'; }).join('') +
            '</select></div>';
          h += '<div class="form-group"><label class="form-label">Questions</label>' +
            '<div style="max-height:220px;overflow-y:auto;border:1px solid var(--border,rgba(127,127,127,.2));border-radius:6px;padding:8px;">' +
            (qItems.length
              ? qItems.map(function (q) {
                  return '<label style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:0.9rem;cursor:pointer;">' +
                    '<input type="checkbox" data-csv2-qid="' + esc(q.id) + '"' + (sel.indexOf(q.id) >= 0 ? ' checked' : '') + '>' +
                    esc(q.text) + ' <span class="mu-sub">' + esc(Q_TYPE_LABEL[q.type] || q.type) + '</span></label>';
                }).join('')
              : '<span class="mu-sub">No questions in the library yet — add some first.</span>') +
            '</div></div>';
          return h;
        }
      },
      onSave: function (rec, mode) {
        if (!can('edit')) { showToast('Surveys write access required.', true); return false; }
        var qIds = [];
        document.querySelectorAll('input[data-csv2-qid]').forEach(function (cb) { if (cb.checked) qIds.push(cb.getAttribute('data-csv2-qid')); });
        var id = mode === 'create' ? null : rec.id;
        return bridge().saveGroup(id, { name: rec.name, eventType: rec.eventType, questionIds: qIds }).then(function () {
          showToast(id ? 'Question set updated' : 'Question set created');
          return load().then(function () { return true; });
        }).catch(function (e) { showToast('Save failed: ' + (e.message || e), true); return false; });
      }
    });

    // Question library — generic engine form (textarea + selects).
    MastEntity.define('cs-survey-questions-v2', {
      label: 'Question', labelPlural: 'Questions', size: 'md',
      recordId: function (q) { return q.id; },
      fields: [
        { name: 'text', label: 'Question', type: 'textarea', rows: 3, list: true, required: true, group: 'Question' },
        { name: 'type', label: 'Answer type', type: 'select', options: Q_TYPES, group: 'Question' },
        { name: 'optionsText', label: 'Choices (comma-separated, multiple choice only)', group: 'Question' },
        { name: 'requiredSel', label: 'Answer required?', type: 'select', options: [{ value: 'yes', label: 'Required' }, { value: 'no', label: 'Optional' }], group: 'Question' },
        { name: '_type', label: 'Answer type', type: 'text', list: true, readOnly: true, get: function (q) { return Q_TYPE_LABEL[q.type] || q.type; } },
        { name: '_inSets', label: 'In sets', type: 'number', list: true, readOnly: true, align: 'right', get: function (q) { return setsUsingQuestion(q.id).length; } }
      ],
      fetch: function (id) { return ensureLoaded().then(function () { return prepQuestion(V2.questions[id]) || null; }); },
      detail: {
        render: function (_U, q) {
          var inSets = setsUsingQuestion(q.id);
          var h = U.kv([
            { k: 'Question', v: esc(q.text || '') },
            { k: 'Answer type', v: esc(Q_TYPE_LABEL[q.type] || q.type) },
            { k: 'Choices', v: (q.options && q.options.length) ? esc(q.options.join(', ')) : '—' },
            { k: 'Required', v: q.required !== false ? 'Yes' : 'Optional' },
            { k: 'In question sets', v: inSets.length ? inSets.map(function (g) { return esc(g.name); }).join(', ') : 'Not used yet' }
          ]);
          h = U.card('Question', h);
          if (can('delete')) {
            h += '<div style="margin-top:14px;"><button class="btn btn-secondary btn-small" style="color:var(--danger);" onclick="CsSurveysV2.removeQuestion(\'' + esc(q.id) + '\')">Delete question</button></div>';
          }
          return h;
        }
      },
      onSave: function (rec, mode) {
        if (!can('edit')) { showToast('Surveys write access required.', true); return false; }
        var id = mode === 'create' ? null : rec.id;
        return bridge().saveQuestion(id, {
          text: rec.text, type: rec.type || 'open_text',
          options: rec.optionsText || '', required: rec.requiredSel !== 'no'
        }).then(function () {
          showToast(id ? 'Question updated' : 'Question added');
          return load().then(function () { return true; });
        }).catch(function (e) { showToast('Save failed: ' + (e.message || e), true); return false; });
      }
    });
  }

  // Pre-map virtual edit fields (get()-bearing fields are read-only context).
  function prepSurvey(s) {
    if (!s) return s;
    s.closesDate = s.closesAt ? String(s.closesAt).slice(0, 10) : '';
    return s;
  }
  function prepQuestion(q) {
    if (!q) return q;
    q.optionsText = (q.options || []).join(', ');
    q.requiredSel = q.required !== false ? 'yes' : 'no';
    return q;
  }
  function surveysUsingGroup(gid) { return Object.values(V2.surveys).filter(function (s) { return s.groupId === gid; }); }
  function setsUsingQuestion(qid) { return Object.values(V2.groups).filter(function (g) { return (g.questionIds || []).indexOf(qid) >= 0; }); }

  // ── Load ──────────────────────────────────────────────────────────────────
  var _loaded = null;
  function ensureLoaded() {
    if (_loaded) return _loaded;
    _loaded = MastAdmin.loadModule('customer-service').then(function () {
      return bridge().loadAll();
    }).then(function (d) {
      ['questions', 'groups', 'surveys', 'triggers', 'responses'].forEach(function (k) {
        var out = {};
        Object.keys(d[k] || {}).forEach(function (kk) {
          var v = d[k][kk];
          if (v && typeof v === 'object') out[kk] = Object.assign({ id: kk }, v);
        });
        V2[k] = out;
      });
      V2.automationEnabled = d.automationEnabled;
      V2.loaded = true;
      return true;
    });
    return _loaded;
  }
  function load() {
    _loaded = null;
    return ensureLoaded().then(render).catch(function (e) { console.error('[cs-surveys-v2] load', e); render(); });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function ensureTab() {
    var el = document.getElementById('csSurveysV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'csSurveysV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }
  function pills(items, activeKey, fnName) {
    return items.map(function (p) {
      var on = activeKey === p[0];
      return '<button onclick="' + fnName + '(\'' + p[0] + '\')" style="border:1px solid var(--border);' +
        'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
        'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
        'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
        p[1] + (p[2] != null ? ' <span style="color:var(--warm-gray);">' + p[2] + '</span>' : '') + '</button>';
    }).join('');
  }

  function automationCard() {
    var canEdit = can('edit');
    var rules = Object.values(V2.triggers);
    var rows = rules.length ? rules.map(function (t) {
      var sv = V2.surveys[t.surveyId];
      var on = t.isActive !== false && t.enabled !== false;
      return '<div style="display:flex;align-items:center;gap:10px;padding:6px 0;font-size:0.85rem;border-bottom:1px solid var(--border,rgba(127,127,127,.12));">' +
        '<span style="flex:1;">' + esc(EVENT_LABELS[t.eventType] || t.eventType || '—') +
          ' <span class="mu-sub">→ ' + esc((sv && sv.name) || t.surveyId || '—') + (t.delayHours ? ' · after ' + t.delayHours + 'h' : '') + '</span></span>' +
        U.badge(on ? 'On' : 'Off', on ? 'success' : 'neutral') +
        (canEdit ? '<button class="btn btn-secondary btn-small" style="font-size:0.72rem;" onclick="CsSurveysV2.toggleTrigger(\'' + esc(t.id) + '\',' + (on ? 'false' : 'true') + ')">' + (on ? 'Turn off' : 'Turn on') + '</button>' : '') +
        '</div>';
    }).join('') : '<span class="mu-sub">No sending rules yet — set them up in the classic view.</span>';
    var master = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px;font-size:0.9rem;">' +
      '<span style="flex:1;">Send surveys automatically after orders, classes and returns</span>' +
      U.badge(V2.automationEnabled ? 'On' : 'Off', V2.automationEnabled ? 'success' : 'neutral') +
      (canEdit ? '<button class="btn btn-secondary btn-small" onclick="CsSurveysV2.toggleAutomation(' + (V2.automationEnabled ? 'false' : 'true') + ')">' + (V2.automationEnabled ? 'Turn off' : 'Turn on') + '</button>' : '') +
      '</div>';
    return U.card('Automatic sending', master + rows);
  }

  function render() {
    var tab = ensureTab();
    var lens = V2.lens;
    var completed = Object.values(V2.responses).filter(function (r) { return r.status === 'completed'; }).length;
    var realResponses = Object.values(V2.responses).filter(function (r) { return r.status !== 'preview'; });

    var lensPills = pills([
      ['surveys', 'Surveys', Object.keys(V2.surveys).length],
      ['responses', 'Responses', realResponses.length],
      ['sets', 'Question sets', Object.keys(V2.groups).length],
      ['library', 'Question library', Object.keys(V2.questions).length]
    ], lens, 'CsSurveysV2.setLens');

    var actions = '<button class="btn btn-secondary" onclick="CsSurveysV2.classic()" title="Bulk send to a segment, VoC digest, response themes">Classic view ↗</button>';
    if (can('edit')) {
      if (lens === 'surveys') actions = '<button class="btn btn-primary" onclick="CsSurveysV2.newSurvey()">+ New survey</button>' + actions;
      if (lens === 'sets') actions = '<button class="btn btn-primary" onclick="CsSurveysV2.newGroup()">+ New question set</button>' + actions;
      if (lens === 'library') actions = '<button class="btn btn-primary" onclick="CsSurveysV2.newQuestion()">+ New question</button>' + actions;
    }

    var entityKey, rows, onRowClick, empty;
    if (lens === 'responses') {
      entityKey = 'cs-survey-responses-v2';
      rows = realResponses.sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
      onRowClick = 'CsSurveysV2.openResponse';
      empty = { title: 'No responses yet', message: 'Responses appear here when customers answer a survey.' };
    } else if (lens === 'sets') {
      entityKey = 'cs-survey-sets-v2';
      rows = Object.values(V2.groups);
      onRowClick = 'CsSurveysV2.openGroup';
      empty = { title: 'No question sets', message: 'A question set is the list of questions one survey asks.' };
    } else if (lens === 'library') {
      entityKey = 'cs-survey-questions-v2';
      rows = Object.values(V2.questions);
      onRowClick = 'CsSurveysV2.openQuestion';
      empty = { title: 'No questions yet', message: 'Build a library of questions to reuse across surveys.' };
    } else {
      entityKey = 'cs-surveys-v2';
      rows = Object.values(V2.surveys).sort(function (a, b) { return String(b.createdAt || '').localeCompare(String(a.createdAt || '')); });
      onRowClick = 'CsSurveysV2.openSurvey';
      empty = { title: 'No surveys yet', message: 'Create a survey to start collecting customer feedback.' };
    }

    tab.innerHTML =
      U.pageHeader({
        title: 'Surveys',
        count: N.count(realResponses.length) + ' response' + (realResponses.length === 1 ? '' : 's') + ' · ' + N.count(completed) + ' completed',
        actionsHtml: actions
      }) +
      '<div style="margin:14px 0;">' + lensPills + '</div>' +
      (lens === 'surveys' ? '<div style="margin:0 0 14px;">' + automationCard() + '</div>' : '') +
      MastEntity.renderList(entityKey, {
        rows: rows,
        onRowClickFnName: onRowClick,
        empty: V2.loaded ? empty : { title: 'Loading…', message: '' }
      });
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  function fillGroupOptions() {
    var s = MastEntity.get('cs-surveys-v2'); if (!s) return;
    var f = s.fields.filter(function (x) { return x.name === 'groupId'; })[0]; if (!f) return;
    f.options = [{ value: '', label: '— Choose a question set —' }].concat(
      Object.values(V2.groups).map(function (g) { return { value: g.id, label: g.name || '(unnamed)' }; }));
  }

  window.CsSurveysV2 = {
    setLens: function (l) { V2.lens = l; render(); },
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('cs-surveys');
      else if (typeof navigateTo === 'function') navigateTo('cs-surveys');
    },

    openSurvey: function (id) { fillGroupOptions(); var s = prepSurvey(V2.surveys[id]); if (s) MastEntity.openRecord('cs-surveys-v2', s, 'read'); },
    openResponse: function (id) { var r = V2.responses[id]; if (r) MastEntity.openRecord('cs-survey-responses-v2', r, 'read'); },
    openGroup: function (id) { var g = V2.groups[id]; if (g) MastEntity.openRecord('cs-survey-sets-v2', g, 'read'); },
    openQuestion: function (id) { var q = prepQuestion(V2.questions[id]); if (q) MastEntity.openRecord('cs-survey-questions-v2', q, 'read'); },
    openTicket: function (tid) {
      MastAdmin.loadModule('cs-support-v2').then(function () {
        return MastEntity.drill('cs-support-v2', tid);
      }).catch(function (e) { console.error('[cs-surveys-v2] openTicket', e); });
    },

    newSurvey: function () {
      if (!can('edit')) { showToast('Surveys write access required.', true); return; }
      if (!Object.keys(V2.groups).length) { showToast('Create a question set first — a survey needs questions to ask.', true); V2.lens = 'sets'; render(); return; }
      fillGroupOptions();
      MastEntity.openRecord('cs-surveys-v2', { status: 'draft' }, 'create');
    },
    newGroup: function () {
      if (!can('edit')) { showToast('Surveys write access required.', true); return; }
      MastEntity.openRecord('cs-survey-sets-v2', {}, 'create');
    },
    newQuestion: function () {
      if (!can('edit')) { showToast('Surveys write access required.', true); return; }
      MastEntity.openRecord('cs-survey-questions-v2', { type: 'open_text', requiredSel: 'yes' }, 'create');
    },

    removeSurvey: function (id) {
      if (!can('delete')) { showToast('Surveys delete access required.', true); return; }
      var s = V2.surveys[id]; if (!s) return;
      mastConfirm('Delete "' + (s.name || 'this survey') + '"? Collected responses will remain.', { title: 'Delete survey', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        bridge().deleteSurvey(id).then(function () {
          showToast('Survey deleted');
          try { MastUI.slideOut.requestClose(); } catch (_) {}
          load();
        }).catch(function (e) { showToast('Delete failed: ' + (e.message || e), true); });
      });
    },
    removeGroup: function (id) {
      if (!can('delete')) { showToast('Surveys delete access required.', true); return; }
      var g = V2.groups[id]; if (!g) return;
      var used = surveysUsingGroup(id);
      var msg = used.length
        ? '"' + (g.name || 'This set') + '" is used by ' + used.length + ' survey' + (used.length === 1 ? '' : 's') + ' (' + used.map(function (s) { return s.name; }).join(', ') + ') — those surveys will stop working until they get a new set. Delete anyway?'
        : 'Delete the question set "' + (g.name || '') + '"?';
      mastConfirm(msg, { title: 'Delete question set', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        bridge().deleteGroup(id).then(function () {
          showToast('Question set deleted');
          try { MastUI.slideOut.requestClose(); } catch (_) {}
          load();
        }).catch(function (e) { showToast('Delete failed: ' + (e.message || e), true); });
      });
    },
    removeQuestion: function (id) {
      if (!can('delete')) { showToast('Surveys delete access required.', true); return; }
      var q = V2.questions[id]; if (!q) return;
      var inSets = setsUsingQuestion(id);
      var msg = inSets.length
        ? 'This question is in ' + inSets.length + ' question set' + (inSets.length === 1 ? '' : 's') + ' (' + inSets.map(function (g) { return g.name; }).join(', ') + ') — it will disappear from them. Delete anyway?'
        : 'Delete this question?';
      mastConfirm(msg, { title: 'Delete question', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        bridge().deleteQuestion(id).then(function () {
          showToast('Question deleted');
          try { MastUI.slideOut.requestClose(); } catch (_) {}
          load();
        }).catch(function (e) { showToast('Delete failed: ' + (e.message || e), true); });
      });
    },

    sendOne: function (surveyId) {
      if (!can('edit')) { showToast('Surveys write access required.', true); return; }
      if (V2.busy) return;
      var email = ((document.getElementById('csSvV2Email') || {}).value || '').trim();
      var name = ((document.getElementById('csSvV2Name') || {}).value || '').trim();
      if (!email || email.indexOf('@') < 1) { showToast('Enter a valid customer email', true); return; }
      V2.busy = true;
      bridge().sendOne(surveyId, email, name || null).then(function () {
        V2.busy = false;
        showToast('Survey invite sent to ' + email);
        var el = document.getElementById('csSvV2Email'); if (el) el.value = '';
      }).catch(function (e) { V2.busy = false; showToast('Send failed: ' + (e.message || e), true); });
    },
    preview: function (surveyId) {
      showToast('Generating preview…');
      bridge().previewUrl(surveyId).then(function (url) {
        if (!url) { showToast('Preview failed: no URL returned', true); return; }
        window.open(url, '_blank');
      }).catch(function (e) { showToast('Preview failed: ' + (e.message || e), true); });
    },

    toggleAutomation: function (on) {
      if (!can('edit')) { showToast('Surveys write access required.', true); return; }
      bridge().setAutomationEnabled(on).then(function () {
        V2.automationEnabled = !!on;
        showToast(on ? 'Automatic surveys turned on' : 'Automatic surveys turned off');
        render();
      }).catch(function (e) { showToast('Failed: ' + (e.message || e), true); });
    },
    toggleTrigger: function (id, on) {
      if (!can('edit')) { showToast('Surveys write access required.', true); return; }
      bridge().setTriggerActive(id, on).then(function () {
        if (V2.triggers[id]) { V2.triggers[id].isActive = !!on; V2.triggers[id].enabled = !!on; }
        showToast(on ? 'Sending rule turned on' : 'Sending rule turned off');
        render();
      }).catch(function (e) { showToast('Failed: ' + (e.message || e), true); });
    }
  };

  MastAdmin.registerModule('cs-surveys-v2', {
    routes: { 'cs-surveys-v2': { tab: 'csSurveysV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
