/**
 * commissions-v2.js — the Commissions Process surface (doc 17 §1a/§2/§3).
 *
 * Commissions are a genuine governed lifecycle (the MastFlow `commissions` spec is
 * the proof): inquiry → quoted → accepted → in-progress → invoiced → shipped →
 * delivered, each with hard/soft exit-checklists. Mirrors orders-v2's Process
 * wiring exactly: detail.flow composes the MastFlow lifecycle, so the Process pane
 * hosts the stepper + checklist + ONE guarded Advance (NOT a status dropdown);
 * status is read-only (workflow-governed).
 *
 * Captures are NATIVE (classic-escape-hatch burn-down): the side-effect-bearing
 * text/doc/comms actions — save/send proposal, link/upload documents, create
 * production job, post milestone, send terms link — render as native V2
 * affordances on the detail (a custom detail.render with its own panes +
 * action buttons + secondary capture slide-outs). Every write is single-sourced
 * through window.CommissionsBridge (orders.js), which wraps the legacy write
 * cores + EXISTING CFs (/commissionProposal, mintCommissionTermsToken) — the
 * twin reimplements NO write logic. Each checklist "Go →" requirement routes to
 * the relevant NATIVE pane (no navigateToClassic). Advancing stays governed by
 * MastFlow (the hard-gate checklist is untouched).
 *
 * Money is READ-ONLY here: deposit/balance settlement timestamps are written
 * server-side (storefront + Square webhook + CFs), so the Money pane renders the
 * record's money fields natively and offers NO payment/invoice button.
 *
 * Flag-gated (?ui=1) at #commissions-v2, side-by-side with legacy #commissions;
 * legacy orders.js capture handlers stay intact (the bridge is additive).
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

  var N = window.MastUI.Num, esc = window.MastUI._esc;

  // Commission status → badge tone (status is workflow-governed, shown read-only).
  var STATUS_TONE = {
    'new': 'neutral', 'in-discussion': 'neutral', 'quoted': 'info',
    'accepted': 'info', 'deposit-paid': 'info',
    'design-locked': 'amber', 'in-fabrication': 'amber', 'cold-shop': 'amber', 'built': 'amber',
    'balance-invoiced': 'amber', 'shipped': 'teal',
    'followed-up': 'success', 'completed': 'success', 'delivered': 'success',
    'cancelled': 'danger', 'closed-no-completion': 'danger'
  };
  function quote(c) { return N.moneyVal(c, 'proposalPriceCents', 'proposalPrice'); }
  function stamp(c) {
    // Materialise a real title string (fields[0] / slide-out title is read directly).
    c._title = c.sourcePieceName || (c.customerName ? ('Commission — ' + c.customerName) : ('Commission ' + (c._key || c.id || '')));
    return c;
  }

  MastEntity.define('commissions-v2', {
    label: 'Commission', labelPlural: 'Commissions', size: 'xl', route: 'commissions-v2',
    recordId: function (c) { return c._key || c.id; },
    fields: [
      { name: '_title', label: 'Commission', type: 'text', list: true, group: 'Commission', readOnly: true },
      { name: 'customerName', label: 'Customer', type: 'text', list: true, group: 'Commission', readOnly: true },
      // Status is GOVERNED BY THE WORKFLOW (detail.flow), not edited as a field (doc 17 §2).
      { name: 'status', label: 'Status', type: 'status', list: true, group: 'Lifecycle', readOnly: true,
        tone: function (v) { return STATUS_TONE[String(v || '').toLowerCase()] || 'neutral'; } },
      { name: 'quote', label: 'Quote', type: 'money', list: true, group: 'Money', readOnly: true, align: 'right', get: function (c) { return quote(c); } },
      { name: 'createdAt', label: 'Created', type: 'date', list: true, group: 'Commission', readOnly: true }
    ],
    fetch: function (id) { return Promise.resolve(MastDB.commissions.get(id)).then(function (c) { return c ? stamp(Object.assign({ _key: id }, c)) : null; }); },

    // Process variant: detail.flow composes the MastFlow `commissions` lifecycle.
    // Custom detail.render (like procurement-v2) emits #muFlowHost (the engine
    // fills it after render) + native panes + native capture action buttons. No
    // status dropdown (workflow-governed); no onSave (no Edit pencil) — the
    // captures are explicit buttons, not a generic field edit.
    detail: {
      flow: 'commissions',
      flowModule: 'commissionsWorkflow',
      guidedHeader: true,   // clickable step rail; click a step to review/advance (engine §guided)
      guidedExpandCurrent: true,  // open with the current phase's checklist visible
      // Checklist "Go →" → focus the relevant NATIVE pane (no classic bounce).
      onFlowTarget: function (targetId, rec) {
        var t = String(targetId || '');
        var pane = /money/.test(t) ? 'money'
          : (/milestone/.test(t) ? 'milestones'
          : (/create-job|production/.test(t) ? 'spec'
          : (/proposal|spec|tracking|header/.test(t) ? 'spec'
          : (/thread/.test(t) ? 'overview' : 'overview'))));
        var body = document.getElementById('mastSlideOutBody'); if (!body) return true;
        var btn = body.querySelector('.mu-ptabs button[onclick*="\'' + pane + '\'"]');
        if (btn) btn.click();
        if (pane === 'milestones') fillMilestones((rec && (rec._key || rec.id)) || '');
        return true;   // handled — never deep-link to legacy
      },
      render: function (UI, c) {
        var id = c._key || c.id;
        var editable = canEdit();
        var hasEmail = c.customerContact && String(c.customerContact).indexOf('@') !== -1;

        var tiles = UI.tiles([
          { k: 'Quote', v: N.money(quote(c)) || '—', hero: true },
          { k: 'Deposit', v: c.depositPaidAt ? 'Paid' : (N.money(N.moneyVal(c, 'depositAmountCents', 'depositAmount')) || '—') },
          { k: 'Balance', v: c.balancePaidAt ? 'Paid' : (c.balanceInvoicedAt ? 'Invoiced' : '—') },
          { k: 'Created', v: N.date(c.createdAt) || '—' }
        ]);
        // Engine fills #muFlowHost after render (detail.flow set). Custom render
        // must emit it (the stock transaction/party templates emit it for you).
        var flowHost = '<div id="muFlowHost" style="margin:10px 0 4px;font-size:0.85rem;color:var(--warm-gray);">Loading workflow…</div>';
        var tabsBar = UI.paneTabsBar([
          { key: 'overview', label: 'Overview' },
          { key: 'spec', label: 'Spec & proposal' },
          { key: 'documents', label: 'Documents' },
          { key: 'milestones', label: 'Milestones' },
          { key: 'money', label: 'Money' },
          { key: 'terms', label: 'Terms' }
        ], 'overview');

        // ── Overview pane (read) ──
        var overview = UI.kv([
          { k: 'Customer', v: esc(c.customerName || '—') },
          { k: 'Contact', v: esc(c.customerContact || '—') },
          { k: 'Channel', v: c.channel ? esc(String(c.channel).toUpperCase()) : '—' },
          { k: 'Piece', v: esc(c.sourcePieceName || c.pieceTitle || c._title || '—') },
          { k: 'Target deadline', v: c.targetDeadline ? N.date(c.targetDeadline) : '—' },
          { k: 'Created', v: N.date(c.createdAt) || '—' }
        ]);
        var notesBlock = c.notes
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;white-space:pre-wrap;">' + esc(c.notes) + '</div>'
          : '<span class="mu-sub">No notes.</span>';
        var prodInner = c.productionJobId
          ? 'Linked to a production job. <button type="button" class="mu-link" onclick="if(typeof navigateTo===\'function\')navigateTo(\'production\')">View in Production →</button>'
          : (editable
            ? '<span class="mu-sub">No production job linked yet.</span><div style="margin-top:8px;"><button class="btn btn-secondary btn-small" onclick="CommissionsV2.createJob(\'' + esc(id) + '\')">Create production job</button></div>'
            : '<span class="mu-sub">No production job linked yet.</span>');

        // ── Spec & proposal pane (native inline edit via the Proposal slide-out) ──
        var hasProposal = c.proposalPrice || c.proposalTimeline || c.proposalSpec;
        var proposalRows = UI.kv([
          { k: 'Price', v: c.proposalPrice ? esc(c.proposalPrice) : '—' },
          { k: 'Timeline', v: c.proposalTimeline ? esc(c.proposalTimeline) : '—' },
          { k: 'Spec / design notes', v: c.proposalSpec ? '<div style="white-space:pre-wrap;">' + esc(c.proposalSpec) + '</div>' : '—' },
          { k: 'Proposal sent', v: c.proposalSentAt ? N.date(c.proposalSentAt) : '—' }
        ]);
        var proposalActions = '';
        if (editable) {
          proposalActions = '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
            '<button class="btn btn-secondary btn-small" onclick="CommissionsV2.editProposal(\'' + esc(id) + '\')">' + (hasProposal ? 'Edit proposal' : 'Add proposal') + '</button>' +
            (hasProposal && hasEmail ? '<button class="btn btn-primary btn-small" onclick="CommissionsV2.sendProposal(\'' + esc(id) + '\')">Send proposal to customer</button>' : '') +
          '</div>' +
          (hasProposal && !hasEmail ? '<div class="mu-sub" style="margin-top:6px;">No customer email on file — copy the proposal and send manually.</div>' : '');
        }

        // ── Documents pane (native link/upload/remove) ──
        var docs = c.documents ? Object.keys(c.documents).map(function (k) { var d = c.documents[k]; d.id = k; return d; }) : [];
        docs.sort(function (a, b) { return (b.addedAt || '').localeCompare(a.addedAt || ''); });
        var docRows = docs.length ? docs.map(function (doc) {
          var icon = doc.type === 'drive' ? '🗎' : '📎';
          var rm = editable ? ' <button type="button" class="mu-link" style="color:var(--danger);" onclick="CommissionsV2.removeDoc(\'' + esc(id) + '\',\'' + esc(doc.id) + '\')">remove</button>' : '';
          return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid var(--cream-dark,rgba(127,127,127,.18));font-size:0.85rem;">' +
            '<span>' + icon + '</span>' +
            '<a href="' + esc(doc.url || doc.webViewLink || '#') + '" target="_blank" rel="noopener" style="flex:1;min-width:0;color:var(--teal);text-decoration:none;">' + esc(doc.name || 'Untitled') + '</a>' +
            '<span class="mu-sub" style="white-space:nowrap;">' + (doc.addedAt ? N.date(doc.addedAt) : '') + '</span>' + rm +
          '</div>';
        }).join('') : '<span class="mu-sub">No documents attached yet.</span>';
        var docActions = editable
          ? '<div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;">' +
              '<button class="btn btn-secondary btn-small" onclick="CommissionsV2.linkDoc(\'' + esc(id) + '\')">+ Link Google Doc</button>' +
              '<button class="btn btn-secondary btn-small" onclick="CommissionsV2.uploadDoc(\'' + esc(id) + '\')">+ Upload file</button>' +
            '</div>'
          : '';

        // ── Milestones pane (lazy-loaded; native Post Milestone) ──
        var msActions = editable
          ? '<button class="btn btn-primary btn-small" onclick="CommissionsV2.postMilestone(\'' + esc(id) + '\')">+ Post milestone</button>'
          : '';
        var milestonesPane =
          '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;"><span></span>' + msActions + '</div>' +
          '<div id="cmV2Milestones" data-comm="' + esc(id) + '"><span class="mu-sub">Loading milestones…</span></div>';

        // ── Money pane (READ-ONLY — settlement is server-side; NO write button) ──
        var quoteCents = c.quoteAmountCents, depositCents = c.depositAmountCents;
        var balanceCents = (quoteCents != null && depositCents != null) ? (quoteCents - depositCents) : null;
        function moneyC(cents) { return (cents == null || isNaN(cents)) ? '—' : N.money(cents / 100); }
        var money = UI.kv([
          { k: 'Quote (total)', v: moneyC(quoteCents) },
          { k: 'Deposit', v: moneyC(depositCents) + (c.depositPaidAt ? ' <span style="color:var(--teal);font-size:0.78rem;">paid ' + N.date(c.depositPaidAt) + '</span>' : '') },
          { k: 'Balance remaining', v: moneyC(balanceCents) },
          { k: 'Balance invoiced', v: c.balanceInvoicedAt ? N.date(c.balanceInvoicedAt) : '—' },
          { k: 'Balance paid', v: c.balancePaidAt ? N.date(c.balancePaidAt) : '—' }
        ]);
        var moneyNote = '<div class="mu-sub" style="margin-top:10px;">Deposit and balance payments are recorded automatically (storefront checkout + payment provider). There is nothing to enter here.</div>';

        // ── Terms pane (native send-terms; the link is minted by an EXISTING CF) ──
        var termsInner;
        if (c.acceptedTermsVersionId) {
          termsInner = '<div style="font-size:0.9rem;">' + UI.badge('Accepted', 'success') +
            ' version <strong>' + esc(c.acceptedTermsVersionId) + '</strong>' +
            (c.acceptedAt ? ' on ' + N.date(c.acceptedAt) : '') + '</div>';
        } else {
          termsInner = '<div class="mu-sub" style="margin-bottom:10px;">Customer has not yet accepted the commission terms.</div>' +
            (editable && hasEmail ? '<button class="btn btn-primary btn-small" onclick="CommissionsV2.sendTerms(\'' + esc(id) + '\')">Send terms link</button>' : '') +
            (editable && !hasEmail ? '<span class="mu-sub">No customer email on file.</span>' : '') +
            '<div id="cmV2TermsStatus" class="mu-sub" style="margin-top:8px;"></div>';
        }

        return tiles + flowHost + tabsBar +
          '<div class="mu-pane" data-pane="overview">' +
            UI.card('Commission', overview) + UI.card('Notes', notesBlock) + UI.card('Production', prodInner) + '</div>' +
          '<div class="mu-pane" data-pane="spec" hidden>' + UI.card('Proposal', proposalRows + proposalActions) + '</div>' +
          '<div class="mu-pane" data-pane="documents" hidden>' + UI.card('Documents', docRows + docActions) + '</div>' +
          '<div class="mu-pane" data-pane="milestones" hidden>' + UI.card('Milestones', milestonesPane) + '</div>' +
          '<div class="mu-pane" data-pane="money" hidden>' + UI.card('Money', money + moneyNote) + '</div>' +
          '<div class="mu-pane" data-pane="terms" hidden>' + UI.card('Commission terms', termsInner) + '</div>';
      }
    }
    // No onSave: status is workflow-governed (Process pane advances it); captures
    // are explicit native action buttons (above) single-sourced via CommissionsBridge.
  });

  // ── Operator intake (create-only) ────────────────────────────────────
  // Commissions primarily arrive via the storefront flow, but a phone call or
  // a trade-show conversation needs operator entry. A SEPARATE create-only
  // entity keeps the main commission record read-only (adding onSave to
  // commissions-v2 would surface an Edit button on every record — engine rule).
  // Record shape mirrors the legacy New Commission modal (orders.js): the new
  // record starts at status 'new' (workflow phase: inquiry) and flows through
  // the same lifecycle as a storefront commission. Attachments + inspiration
  // pieces remain on the legacy modal (classic link below).
  function canEdit() {
    return typeof window.can !== 'function' || window.can('commissions', 'edit');
  }
  var INTAKE_CHANNELS = [
    ['phone', 'Phone Call'], ['email', 'Email'], ['in-person', 'In Person'],
    ['show', 'Trade / Art Show'], ['social', 'Social Media'], ['other', 'Other']
  ];
  MastEntity.define('commission-intake-v2', {
    label: 'Commission', labelPlural: 'Commissions', size: 'lg', route: 'commissions-v2',
    recordId: function (c) { return c._key || c.id || 'new'; },
    fields: [{ name: 'customerName', label: 'Customer', type: 'text', readOnly: true }],
    fetch: function () { return Promise.resolve(null); },
    detail: {
      editRender: function (c, mode) {
        c = c || {};
        function fg(label, inner, flex) { return '<div class="form-group"' + (flex ? ' style="flex:1;min-width:150px;"' : '') + '><label class="form-label">' + label + '</label>' + inner + '</div>'; }
        var chOpts = INTAKE_CHANNELS.map(function (o) {
          return '<option value="' + o[0] + '"' + ((c.channel || 'phone') === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
        }).join('');
        return '<div class="mu-editbar"><span class="mu-editpill">NEW</span>New commission</div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Customer name *', '<input class="form-input" id="cmNewName" value="' + esc(c.customerName || '') + '" placeholder="Who is commissioning the piece" style="width:100%;">', true) +
            fg('Contact (email or phone) *', '<input class="form-input" id="cmNewContact" value="' + esc(c.customerContact || '') + '" placeholder="how to reach them" style="width:100%;">', true) +
          '</div>' +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('How did this come in?', '<select class="form-input" id="cmNewChannel" style="width:100%;">' + chOpts + '</select>', true) +
            fg('Target deadline', '<input class="form-input" type="date" id="cmNewDeadline" value="' + esc(c.targetDeadline || '') + '" style="width:100%;">', true) +
          '</div>' +
          fg('Piece *', '<input class="form-input" id="cmNewPiece" value="' + esc(c.pieceTitle || '') + '" placeholder="What they want made — e.g. Memorial glass sculpture" style="width:100%;">') +
          '<div style="display:flex;gap:12px;flex-wrap:wrap;">' +
            fg('Quote estimate ($)', '<input class="form-input" type="number" min="0" step="0.01" id="cmNewQuote" placeholder="optional" style="width:100%;">', true) +
            fg('Deposit ($)', '<input class="form-input" type="number" min="0" step="0.01" id="cmNewDeposit" placeholder="optional" style="width:100%;">', true) +
          '</div>' +
          fg('Notes', '<textarea class="form-input" id="cmNewNotes" rows="4" placeholder="What was discussed — size, colors, references, budget…" style="width:100%;resize:vertical;"></textarea>') +
          '<div class="mu-sub">Reference images and documents can be attached on the Documents tab after you create the commission.</div>';
      }
    },
    onSave: function (rec, mode) {
      if (mode !== 'create') return false;
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to create commissions.', true); return false; }
      function val(id) { return ((document.getElementById(id) || {}).value || '').trim(); }
      var name = val('cmNewName'), contact = val('cmNewContact'), piece = val('cmNewPiece');
      if (!name || !contact) { if (window.showToast) showToast('Customer name and contact are required.', true); return false; }
      if (!piece) { if (window.showToast) showToast('Piece title is required.', true); return false; }
      var quoteRaw = val('cmNewQuote'), depositRaw = val('cmNewDeposit');
      var record = {
        customerName: name,
        customerContact: contact,
        channel: val('cmNewChannel') || 'phone',
        notes: val('cmNewNotes') || null,
        pieceTitle: piece,
        targetDeadline: val('cmNewDeadline') || null,
        quoteAmountCents: quoteRaw ? MastFormat.parseCents(quoteRaw) : null,
        depositAmountCents: depositRaw ? MastFormat.parseCents(depositRaw) : null,
        inspirationPieces: null,
        referenceImageUrl: null,
        status: 'new',
        createdAt: new Date().toISOString()
      };
      var id = MastDB.commissions.newKey();
      return Promise.resolve(MastDB.commissions.set(id, record)).then(function () {
        if (window.writeAudit) writeAudit('create', 'commission', id);
        if (window.showToast) showToast('Commission created.');
        var row = stamp(Object.assign({ _key: id }, record));
        V2.rows.push(row); V2.byId[id] = row;
        render();
        // Land the operator in the new record's Process view (phase: inquiry).
        setTimeout(function () { window.MastEntity.openRecord('commissions-v2', row, 'read'); }, 60);
        return true;
      }).catch(function (e) {
        console.error('[commissions-v2] create', e);
        if (window.showToast) showToast('Failed to create commission: ' + (e && e.message || e), true);
        return false;
      });
    }
  });

  // ── State + data (same source as legacy: admin/commissions) ─────────
  var V2 = { rows: [], byId: {}, sortKey: 'createdAt', sortDir: 'desc' };

  function toRows(tree) {
    var out = [];
    tree = tree || {};
    Object.keys(tree).forEach(function (k) {
      var c = tree[k]; if (!c || typeof c !== 'object') return;
      out.push(stamp(Object.assign({ _key: k }, c)));
    });
    return out;
  }
  function load() {
    if (!window.MastDB || !MastDB.commissions) return;
    MastDB.commissions.query().limitToLast(200).once().then(function (snap) {
      var tree = (snap && snap.val && snap.val()) || (snap || {});
      V2.rows = toRows(tree);
      V2.byId = {}; V2.rows.forEach(function (r) { V2.byId[r._key] = r; });
      render();
    }).catch(function (e) { console.error('[commissions-v2] load', e); render(); });
  }

  function visibleRows() {
    return window.mastSortRows(V2.rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('commissions-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }

  function ensureTab() {
    var el = document.getElementById('commissionsV2Tab');
    if (el) return el;
    el = document.createElement('div'); el.id = 'commissionsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function render() {
    var tab = ensureTab();
    tab.innerHTML =
      window.MastUI.pageHeader({ title: 'Commissions', count: N.count(V2.rows.length) + ' commissions',
        actionsHtml:
          (canEdit() ? '<button class="btn btn-primary" onclick="CommissionsV2.newCommission()">+ New commission</button> ' : '') +
          '<button class="btn btn-secondary" onclick="CommissionsV2.exportCsv()">↓ Export</button>' }) +
      '<div style="margin-top:14px;">' +
      window.MastEntity.renderList('commissions-v2', {
        rows: visibleRows(), sortKey: V2.sortKey, sortDir: V2.sortDir,
        onSortFnName: 'CommissionsV2.sort', onRowClickFnName: 'CommissionsV2.open',
        empty: { title: 'No commissions yet', message: 'Custom orders will appear here.' }
      }) + '</div>';
  }

  // ── Native capture plumbing ─────────────────────────────────────────
  // Every write delegates to window.CommissionsBridge (orders.js), which wraps
  // the legacy write cores + EXISTING CFs. The twin reimplements no write logic
  // and performs NO money-write (settlement is server-side).
  function bridge() { return window.CommissionsBridge; }
  function bridgeReady() {
    // CommissionsBridge + its write cores are ABSORBED into this file (T6 PR2,
    // the 2nd IIFE below) — always present, no orders.js load needed.
    return Promise.resolve(bridge());
  }
  // Re-open the record from fresh data so all panes reflect the write (mirrors
  // procurement-v2.reloadThenOpen). The flow header re-inits via openRecord.
  function reloadThenOpen(id) {
    return Promise.resolve(MastEntity.get('commissions-v2').fetch(id)).then(function (rec) {
      if (!rec) return;
      V2.byId[id] = rec;
      for (var i = 0; i < V2.rows.length; i++) { if (V2.rows[i]._key === id) { V2.rows[i] = rec; break; } }
      window.MastEntity.openRecord('commissions-v2', rec, 'read');
      setTimeout(function () { fillMilestones(id); }, 60);
    });
  }
  function guard() {
    if (!canEdit()) { if (window.showToast) showToast('You do not have permission to edit commissions.', true); return false; }
    return true;
  }
  function esca(v) { return esc(String(v == null ? '' : v)); }

  // Lazily fill the Milestones pane (read via the bridge — no duplicate read).
  function fillMilestones(id) {
    var host = document.getElementById('cmV2Milestones');
    if (!host || host.getAttribute('data-comm') !== id) return;
    bridgeReady().then(function (b) {
      if (!b) { host.innerHTML = '<span class="mu-sub">Milestones unavailable.</span>'; return; }
      return b.listMilestones(id).then(function (ms) {
        var h2 = document.getElementById('cmV2Milestones');
        if (!h2 || h2.getAttribute('data-comm') !== id) return;
        if (!ms.length) { h2.innerHTML = '<span class="mu-sub">No milestones posted yet.</span>'; return; }
        h2.innerHTML = ms.map(function (m) {
          var photo = m.photoUrl ? '<img src="' + esca(m.photoUrl) + '" style="max-width:180px;max-height:180px;border-radius:6px;object-fit:cover;margin-top:8px;" />' : '';
          var emailed = m.emailQueuedAt ? ' <span style="color:var(--teal);font-size:0.72rem;">emailed</span>' : '';
          var stageLabel = String(m.stage || '').replace(/-/g, ' ');
          return '<div style="border-bottom:1px solid var(--cream-dark,rgba(127,127,127,.18));padding:10px 0;">' +
            '<div style="display:flex;gap:8px;align-items:center;font-size:0.85rem;"><strong>' + esca(stageLabel) + '</strong>' + emailed +
              '<span style="margin-left:auto;" class="mu-sub">' + (m.postedAt ? N.date(m.postedAt) : '') + '</span></div>' +
            (m.copyHtml ? '<div style="font-size:0.9rem;white-space:pre-wrap;margin-top:4px;">' + esca(m.copyHtml) + '</div>' : '') + photo +
          '</div>';
        }).join('');
      });
    }).catch(function (e) {
      console.error('[commissions-v2] milestones', e);
      var h3 = document.getElementById('cmV2Milestones');
      if (h3) h3.innerHTML = '<span class="mu-sub">Could not load milestones.</span>';
    });
  }

  window.CommissionsV2 = {
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'createdAt' || key === 'quote') ? 'desc' : 'asc'; }
      render();
    },
    open: function (id) {
      var rec = V2.byId[id]; if (!rec) return;
      window.MastEntity.openRecord('commissions-v2', rec, 'read');
      // Eagerly hydrate the Milestones pane (no pane-shown event in the engine).
      setTimeout(function () { fillMilestones(id); }, 60);
    },
    // Operator intake: phone call / trade-show conversation → new commission
    // at status 'new' (workflow phase: inquiry), same lifecycle as storefront.
    newCommission: function () {
      if (!guard()) return;
      window.MastEntity.openRecord('commission-intake-v2', {}, 'create');
    },

    // ── Proposal (save / send) — native; price is FREE-TEXT (legacy parity) ──
    editProposal: function (id) {
      if (!guard()) return;
      var c = V2.byId[id] || {};
      var body = MastUI.card('Proposal',
        '<div class="form-group"><label class="form-label">Price (free text — e.g. "$250")</label>' +
          '<input class="form-input" id="cmV2PropPrice" value="' + esca(c.proposalPrice || '') + '" placeholder="e.g. $250" style="width:100%;"></div>' +
        '<div class="form-group"><label class="form-label">Timeline</label>' +
          '<input class="form-input" id="cmV2PropTimeline" value="' + esca(c.proposalTimeline || '') + '" placeholder="e.g. 3–4 weeks" style="width:100%;"></div>' +
        '<div class="form-group"><label class="form-label">Spec / design notes</label>' +
          '<textarea class="form-input" id="cmV2PropSpec" rows="5" placeholder="Describe the piece, materials, design details…" style="width:100%;resize:vertical;">' + esca(c.proposalSpec || '') + '</textarea></div>');
      MastUI.slideOut.open({
        id: 'cm-proposal-' + id, title: 'Proposal', subtitle: esc(c.customerName || ''),
        size: 'md', mode: 'create', deepLink: false, createLabel: 'Save proposal',
        render: function () { return body; }, isDirty: function () { return true; },
        // Drive the exit ourselves (write → force-close → reload + re-open) and
        // return false so the engine's create-mode _save does nothing further
        // (no duplicate toast/close, no race with reloadThenOpen).
        onSave: function () {
          function v(eid) { return ((document.getElementById(eid) || {}).value || '').trim(); }
          var fields = { price: v('cmV2PropPrice'), timeline: v('cmV2PropTimeline'), spec: v('cmV2PropSpec') };
          bridgeReady().then(function (b) {
            if (!b) { if (window.showToast) showToast('Capture unavailable — try again.', true); return; }
            return b.saveProposal(id, fields, V2.byId[id]).then(function () {
              MastUI.slideOut.requestCloseForce();
              if (window.showToast) showToast('Proposal saved.');
              return reloadThenOpen(id);
            });
          }).catch(function (e) { if (window.showToast) showToast('Save failed: ' + (e && e.message || e), true); });
          return false;
        }
      });
    },
    sendProposal: function (id) {
      if (!guard()) return;
      bridgeReady().then(function (b) {
        if (!b) { if (window.showToast) showToast('Capture unavailable — try again.', true); return; }
        return b.sendProposal(id, null, V2.byId[id]).then(function (res) {
          if (res && res.sent) { if (window.showToast) showToast('Proposal sent to ' + res.to); reloadThenOpen(id); }
          else if (window.showToast) showToast((res && res.reason) || 'Could not send proposal', true);
        });
      }).catch(function (e) { if (window.showToast) showToast('Error sending proposal: ' + (e && e.message || e), true); });
    },

    // ── Production job ──
    createJob: function (id) {
      if (!guard()) return;
      bridgeReady().then(function (b) {
        if (!b) { if (window.showToast) showToast('Capture unavailable — try again.', true); return; }
        return b.createJob(id, V2.byId[id]).then(function () {
          if (window.showToast) showToast('Production job created');
          reloadThenOpen(id);
        });
      }).catch(function (e) { if (window.showToast) showToast('Error creating job: ' + (e && e.message || e), true); });
    },

    // ── Documents (link / upload / remove) ──
    linkDoc: function (id) {
      if (!guard()) return;
      var body = MastUI.card('Link Google Doc',
        '<div class="form-group"><label class="form-label">Google Drive URL</label>' +
          '<input class="form-input" id="cmV2DocUrl" placeholder="https://docs.google.com/document/d/…" style="width:100%;">' +
          '<div class="mu-sub" style="margin-top:4px;">Paste a link to a Google Doc, Sheet, or Drive file.</div></div>');
      MastUI.slideOut.open({
        id: 'cm-doclink-' + id, title: 'Link document', size: 'md', mode: 'create', deepLink: false, createLabel: 'Add link',
        render: function () { return body; }, isDirty: function () { return true; },
        onSave: function () {
          var url = ((document.getElementById('cmV2DocUrl') || {}).value || '').trim();
          if (!url) { if (window.showToast) showToast('Paste a Google Drive URL', true); return false; }
          bridgeReady().then(function (b) {
            if (!b) { if (window.showToast) showToast('Capture unavailable — try again.', true); return; }
            return b.linkDoc(id, url, V2.byId[id]).then(function () {
              MastUI.slideOut.requestCloseForce();
              if (window.showToast) showToast('Document linked');
              return reloadThenOpen(id);
            });
          }).catch(function (e) { if (window.showToast) showToast('Error linking document: ' + (e && e.message || e), true); });
          return false;
        }
      });
    },
    uploadDoc: function (id) {
      if (!guard()) return;
      var body = MastUI.card('Upload file',
        '<div class="form-group"><label class="form-label">Select file</label>' +
          '<input type="file" id="cmV2DocFile" style="font-size:0.85rem;">' +
          '<div class="mu-sub" style="margin-top:4px;">Max 10 MB. PDFs, images, and documents accepted.</div></div>' +
        '<div id="cmV2DocUpStatus" class="mu-sub" style="margin-top:8px;"></div>');
      MastUI.slideOut.open({
        id: 'cm-docup-' + id, title: 'Upload file', size: 'md', mode: 'create', deepLink: false, createLabel: 'Upload',
        render: function () { return body; }, isDirty: function () { return true; },
        onSave: function () {
          var fi = document.getElementById('cmV2DocFile');
          var f = fi && fi.files && fi.files[0];
          if (!f) { if (window.showToast) showToast('Select a file first', true); return false; }
          var st = document.getElementById('cmV2DocUpStatus');
          bridgeReady().then(function (b) {
            if (!b) { if (window.showToast) showToast('Capture unavailable — try again.', true); return; }
            return b.uploadDoc(id, f, function (pct) { if (st) st.textContent = 'Uploading… ' + pct + '%'; }, V2.byId[id]).then(function () {
              MastUI.slideOut.requestCloseForce();
              if (window.showToast) showToast('File uploaded');
              return reloadThenOpen(id);
            });
          }).catch(function (e) { if (st) st.textContent = 'Error: ' + (e && e.message || e); });
          return false;
        }
      });
    },
    removeDoc: function (id, docId) {
      if (!guard()) return;
      Promise.resolve(window.mastConfirm ? mastConfirm('Remove this document?', { title: 'Remove document', danger: true }) : true).then(function (ok) {
        if (!ok) return;
        return bridgeReady().then(function (b) {
          if (!b) { if (window.showToast) showToast('Capture unavailable — try again.', true); return; }
          return b.removeDoc(id, docId, V2.byId[id]).then(function () {
            if (window.showToast) showToast('Document removed'); reloadThenOpen(id);
          });
        });
      }).catch(function (e) { if (window.showToast) showToast('Error removing document: ' + (e && e.message || e), true); });
    },

    // ── Milestone (post + optional customer email + status bump) ──
    postMilestone: function (id) {
      if (!guard()) return;
      var c = V2.byId[id] || {};
      var hasEmail = c.customerContact && String(c.customerContact).indexOf('@') !== -1;
      bridgeReady().then(function (b) {
        var stages = (b && b.milestoneStages) ? b.milestoneStages() : [];
        var stageOpts = stages.map(function (s) { return '<option value="' + esca(s.key) + '">' + esca(s.label) + '</option>'; }).join('');
        var defaultTmpl = stages.length ? String(stages[0].tmpl || '').replace('{customerName}', c.customerName || 'there') : '';
        var body = MastUI.card('Post milestone',
          '<div class="form-group"><label class="form-label">Stage</label>' +
            '<select class="form-input" id="cmV2MsStage" style="width:100%;">' + stageOpts + '</select></div>' +
          '<div class="form-group"><label class="form-label">Photo (optional)</label>' +
            '<input type="file" id="cmV2MsPhoto" accept="image/*"></div>' +
          '<div class="form-group"><label class="form-label">Copy</label>' +
            '<textarea class="form-input" id="cmV2MsCopy" rows="4" style="width:100%;resize:vertical;">' + esca(defaultTmpl) + '</textarea></div>' +
          '<div class="form-group"><label style="display:flex;gap:8px;align-items:center;font-size:0.9rem;">' +
            '<input type="checkbox" id="cmV2MsEmail" ' + (hasEmail ? 'checked' : 'disabled') + '> Send to client' +
            (hasEmail ? ' <span class="mu-sub">(' + esca(c.customerContact) + ')</span>' : ' <span style="color:var(--amber);font-size:0.78rem;">(no email on file)</span>') +
          '</label></div>' +
          '<div id="cmV2MsStatus" class="mu-sub" style="margin-top:6px;"></div>');
        MastUI.slideOut.open({
          id: 'cm-milestone-' + id, title: 'Post milestone', subtitle: esc(c.customerName || ''),
          size: 'md', mode: 'create', deepLink: false, createLabel: 'Post',
          render: function () {
            return body;
          },
          isDirty: function () { return true; },
          onSave: function () {
            var stageEl = document.getElementById('cmV2MsStage');
            var stage = stageEl ? stageEl.value : (stages[0] && stages[0].key);
            var copyHtml = ((document.getElementById('cmV2MsCopy') || {}).value || '').trim();
            var emailEl = document.getElementById('cmV2MsEmail');
            var sendEmail = emailEl && emailEl.checked && !emailEl.disabled;
            var photoEl = document.getElementById('cmV2MsPhoto');
            var file = photoEl && photoEl.files && photoEl.files[0];
            var st = document.getElementById('cmV2MsStatus');
            b.postMilestone(id, { stage: stage, copyHtml: copyHtml, file: file, sendEmail: sendEmail },
              function (label) { if (st) st.textContent = label; }, V2.byId[id]).then(function (res) {
                MastUI.slideOut.requestCloseForce();
                if (window.showToast) showToast('Milestone posted' + (res && res.emailQueued ? ' — email queued' : ''));
                return reloadThenOpen(id);
              }).catch(function (e) { if (st) st.textContent = 'Error: ' + (e && e.message || e); });
            return false;
          }
        });
      });
    },

    // ── Terms link (minted by the EXISTING mintCommissionTermsToken CF) ──
    sendTerms: function (id) {
      if (!guard()) return;
      var st = document.getElementById('cmV2TermsStatus');
      if (st) st.textContent = 'Sending…';
      bridgeReady().then(function (b) {
        if (!b) { if (st) st.textContent = 'Capture unavailable — try again.'; return; }
        return b.sendTermsToken(id, V2.byId[id]).then(function (res) {
          if (res && res.sent) { if (st) st.textContent = 'Terms link sent to ' + res.to + '.'; if (window.showToast) showToast('Terms link sent'); }
          else if (st) st.textContent = (res && res.reason) || 'Could not send terms link.';
        });
      }).catch(function (e) { if (st) st.textContent = 'Error: ' + (e && e.message || e); });
    },

    exportCsv: function () { return window.MastEntity.exportRows('commissions-v2', visibleRows(), 'all'); }
  };

  function commissionsSetup() {
    // CommissionsBridge lives in this file now (T6 PR2 — the absorbed 2nd IIFE
    // below), so there is nothing to preload.
    ensureTab(); render(); load();
  }
  MastAdmin.registerModule('commissions-v2', {
    routes: {
      'commissions-v2': { tab: 'commissionsV2Tab', setup: commissionsSetup },
      // Legacy #commissions route ABSORBED (T6 PR2): the orders.js commission UI
      // is deleted, so the twin owns the bare route directly (no
      // MAST_V2_ROUTE_MAP remap). Shared tab + setup keep it flag-consistent.
      'commissions': { tab: 'commissionsV2Tab', setup: commissionsSetup }
    }
  });
})();

// ════════════════════════════════════════════════════════════════════════
// CommissionsBridge + commission write cores — ABSORBED VERBATIM from the
// retired orders.js commission slice (T6 PR2). These are DOM-free write
// cores + the data-object bridge that commissions-v2 (above) delegates every
// capture to. Moved here so the twin owns its writes and orders.js sheds its
// ~1.6K-line commission UI. References only eager shell globals (MastDB /
// firebase / storage / callCF / fetchDriveFileMetadata / esc / writeAudit /
// emitTestingEvent / commissionsData [shell global, index.html]) + each
// other. Settlement (deposit/balance paid) is server-side — NO money-write.
// This IIFE is NOT flag-gated: the bridge must exist whenever commissions-v2
// (flag-gated) renders, and the cores are pure data writers.
// ════════════════════════════════════════════════════════════════════════
(function () {
  'use strict';
  if (!window.MastDB) return;

  // milestones-by-commission-id cache (write-through invalidation only; the
  // bridge's listMilestones re-reads Firestore). Local to this absorbed bundle.
  var commMilestonesCache = Object.create(null);

  var COMMISSION_MILESTONE_STAGES = [
    { key: 'kickoff',          label: 'Kickoff',          tmpl: 'Hi {customerName}, we\'re kicking off your custom piece. Expect updates as the work progresses.' },
    { key: 'design-locked',    label: 'Design locked',    tmpl: 'Quick update — the design is now locked and we\'re moving to fabrication.' },
    { key: 'in-fabrication',   label: 'In fabrication',   tmpl: 'Fabrication is underway. We\'ll share a WIP photo soon.' },
    { key: 'wip-photo',        label: 'WIP photo',        tmpl: 'Here\'s a work-in-progress photo of your piece.' },
    { key: 'cold-shop',        label: 'Cold-shop',        tmpl: 'The piece is out of the hot shop and in cold-shop finishing.' },
    { key: 'balance-invoiced', label: 'Balance invoiced', tmpl: 'Your balance invoice is on its way separately. Once paid, we\'ll ship.' },
    { key: 'ready-to-ship',    label: 'Ready to ship',    tmpl: 'Your piece is finished and ready to ship.' },
    { key: 'shipped',          label: 'Shipped',          tmpl: 'Your piece has shipped! Tracking details to follow.' },
    { key: 'delivered',        label: 'Delivered',        tmpl: 'Tracking shows your piece has arrived. We hope you love it.' }
  ];

  function _milestoneStageLabel(key) {
    for (var i = 0; i < COMMISSION_MILESTONE_STAGES.length; i++) {
      if (COMMISSION_MILESTONE_STAGES[i].key === key) return COMMISSION_MILESTONE_STAGES[i].label;
    }
    return key;
  }
  function _commSha1Hex(s) {
    var enc = new TextEncoder().encode(s);
    return crypto.subtle.digest('SHA-1', enc).then(function(buf) {
      var bytes = new Uint8Array(buf);
      var hex = '';
      for (var i = 0; i < bytes.length; i++) {
        var h = bytes[i].toString(16);
        if (h.length < 2) h = '0' + h;
        hex += h;
      }
      return hex;
    });
  }

  // Data-parameterized milestone-post core (single source for the legacy modal +
  // the V2 native "Post Milestone" action). Uploads optional photo, writes the
  // milestone child record, bumps commission status if the stage implies one,
  // optionally queues a customer email, audits. onPhase(label) is an optional
  // progress callback. Returns { milestoneId, emailQueued, statusUpdate }.
  async function _commPostMilestoneCore(commId, opts, onPhase) {
    var c = commissionsData[commId];
    if (!c) throw new Error('Commission not found');
    opts = opts || {};
    var stage = opts.stage;
    var copyHtml = (opts.copyHtml || '').trim();
    var file = opts.file || null;
    // Only honor sendEmail when there's a real email on file.
    var hasEmail = !!(c.customerContact && c.customerContact.indexOf('@') !== -1);
    var sendEmail = !!opts.sendEmail && hasEmail;

    var milestoneId = 'mst_' + Date.now().toString(36);
    var photoUrl = null;
    if (file) {
      if (typeof onPhase === 'function') onPhase('Uploading photo…');
      var ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      var path = MastDB.storagePath('commissions/' + commId + '/milestones/' + milestoneId + '.' + ext);
      var ref = firebase.storage().ref(path);
      var task = ref.put(file);
      await new Promise(function(res, rej) { task.on('state_changed', null, rej, res); });
      photoUrl = await task.snapshot.ref.getDownloadURL();
    }

    var now = new Date().toISOString();
    var user = firebase.auth().currentUser;
    var postedBy = (user && (user.email || user.uid)) || null;

    var milestone = {
      stage: stage,
      postedAt: now,
      photoUrl: photoUrl,
      copyHtml: copyHtml,
      postedBy: postedBy
    };
    await MastDB.set('admin/commissions/' + commId + '/milestones/' + milestoneId, milestone);

    // Bump commission status if the stage implies one.
    var statusEnum = ['design-locked', 'in-fabrication', 'cold-shop', 'balance-invoiced', 'shipped', 'delivered'];
    var statusUpdate = (statusEnum.indexOf(stage) !== -1 && c.status !== stage) ? stage : null;
    if (statusUpdate) {
      await MastDB.commissions.update(commId, { status: statusUpdate, updatedAt: now });
      if (commissionsData[commId]) commissionsData[commId].status = statusUpdate;
    }

    var emailQueued = false;
    if (sendEmail) {
      if (typeof onPhase === 'function') onPhase('Queuing email…');
      var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID || '';
      var brandName = (window.TENANT_CONFIG && window.TENANT_CONFIG.brand && window.TENANT_CONFIG.brand.name) || 'The Team';
      var idemSeed = tenantId + '|' + commId + '|' + stage + '|' + Date.now();
      var idempotencyKey = await _commSha1Hex(idemSeed);
      var subject = brandName + ' — ' + _milestoneStageLabel(stage) + ' update on your commission';
      var photoBlock = photoUrl ? '<p><img src="' + esc(photoUrl) + '" style="max-width:400px;border-radius:6px;"></p>' : '';
      var htmlBody =
        '<p>Hi ' + esc(c.customerName || 'there') + ',</p>' +
        '<p>' + esc(copyHtml).replace(/\n/g, '<br>') + '</p>' +
        photoBlock +
        '<p>— ' + esc(brandName) + '</p>';
      await MastDB.set('emailQueue/' + idempotencyKey, {
        id: idempotencyKey,
        emailType: 'commission_milestone',
        to: c.customerContact,
        toName: c.customerName || null,
        subject: subject,
        htmlBody: htmlBody,
        fromName: brandName,
        idempotencyKey: idempotencyKey,
        queuedAt: now,
        queuedBy: postedBy,
        status: 'queued',
        attemptCount: 0,
        meta: { commissionId: commId, milestoneId: milestoneId, stage: stage, photoUrl: photoUrl }
      });
      await MastDB.update('admin/commissions/' + commId + '/milestones/' + milestoneId, { emailQueuedAt: now, emailIdempotencyKey: idempotencyKey });
      emailQueued = true;
    }

    await writeAudit('create', 'commissionMilestone', milestoneId);
    // Invalidate the legacy milestone cache so both surfaces re-read fresh.
    delete commMilestonesCache[commId];
    return { milestoneId: milestoneId, emailQueued: emailQueued, statusUpdate: statusUpdate };
  }

  async function _commSendTermsTokenCore(commId) {
    var c = commissionsData[commId];
    if (!c) throw new Error('Commission not found');
    if (!c.customerContact || c.customerContact.indexOf('@') === -1) {
      return { sent: false, reason: 'No customer email on file.' };
    }
    var snap = await MastDB.get('admin/commissionTerms');
    var versions = snap ? Object.keys(snap).map(function(k) { var v = snap[k]; v.id = k; return v; }) : [];
    var published = versions.filter(function(v) { return v.status === 'published'; });
    published.sort(function(a, b) { return (b.publishedAt || '').localeCompare(a.publishedAt || ''); });
    if (!published.length) {
      return { sent: false, reason: 'No published terms version yet. Create one in Commission Terms.' };
    }
    var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID;
    var res = await firebase.functions().httpsCallable('mintCommissionTermsToken')({
      tenantId: tenantId,
      commissionId: commId,
      customerEmail: c.customerContact,
      termsVersionId: published[0].id
    });
    var data = (res && res.data) || {};
    if (data.success === false) throw new Error(data.error || 'mint failed');
    return { sent: true, to: c.customerContact };
  }

  // Data-parameterized write core (single source for both the legacy DOM form
  // and the V2 native Proposal editor via CommissionsBridge). Writes the same
  // three free-text fields + audits exactly as the legacy path did.
  async function _commSaveProposalCore(commId, fields) {
    fields = fields || {};
    var updates = {
      proposalPrice: (fields.price || '').trim() || null,
      proposalTimeline: (fields.timeline || '').trim() || null,
      proposalSpec: (fields.spec || '').trim() || null
    };
    await MastDB.commissions.update(commId, updates);
    if (commissionsData[commId]) Object.assign(commissionsData[commId], updates);
    await writeAudit('update', 'commission', commId);
    return updates;
  }

  // Data-parameterized send core (single source for the legacy "Send Proposal"
  // button + the V2 native action). Optionally persists the supplied proposal
  // fields first (so an unsaved edit is captured), then calls the EXISTING
  // /commissionProposal CF and stamps proposalSentAt. Returns { sent, reason }.
  // Throws on transport/CF error so callers can surface it.
  async function _commSendProposalCore(commId, fields) {
    if (fields) await _commSaveProposalCore(commId, fields);
    var c = commissionsData[commId];
    if (!c) throw new Error('Commission not found');

    if (!c.proposalPrice && !c.proposalSpec) {
      return { sent: false, reason: 'Add price or spec details before sending' };
    }
    var contact = c.customerContact || '';
    if (contact.indexOf('@') === -1) {
      return { sent: false, reason: 'Customer contact is not an email — copy the proposal and send manually' };
    }

    var user = firebase.auth().currentUser;
    if (!user) return { sent: false, reason: 'Sign in required' };
    var token = await user.getIdToken();
    var resp = await callCF('/commissionProposal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({
        commissionId: commId,
        customerEmail: contact,
        customerName: c.customerName,
        pieceName: c.sourcePieceName || 'Custom Piece',
        price: c.proposalPrice,
        timeline: c.proposalTimeline,
        spec: c.proposalSpec
      })
    });
    var result = await resp.json();
    if (!result.success) return { sent: false, reason: 'Failed to send: ' + (result.error || 'Unknown error') };
    var sentAt = new Date().toISOString();
    await MastDB.commissions.update(commId, { proposalSentAt: sentAt });
    if (commissionsData[commId]) commissionsData[commId].proposalSentAt = sentAt;
    emitTestingEvent('sendProposal', {});
    return { sent: true, to: contact };
  }

  // Data-parameterized create-job core (single source for the legacy "Create
  // Production Job" button + the V2 native action). Creates the production job,
  // links it onto the commission, audits. Returns the new jobId.
  async function _commCreateJobCore(commId) {
    var c = commissionsData[commId];
    if (!c) throw new Error('Commission not found');
    var jobId = MastDB.productionJobs.newKey();
    var jobData = {
      name: 'Commission: ' + (c.sourcePieceName || 'Custom Piece') + ' for ' + (c.customerName || 'Customer'),
      status: 'active',
      type: 'commission',
      commissionId: commId,
      items: [],
      createdAt: new Date().toISOString()
    };
    await MastDB.productionJobs.set(jobId, jobData);
    await MastDB.commissions.update(commId, { productionJobId: jobId });
    if (commissionsData[commId]) commissionsData[commId].productionJobId = jobId;
    emitTestingEvent('createCommissionJob', {});
    await writeAudit('create', 'productionJob', jobId);
    return jobId;
  }

  // Data-parameterized doc-link core (single source for the legacy modal + the
  // V2 native "Link Google Doc" action). Resolves Drive metadata, pushes the
  // doc record, audits. Returns the new doc key.
  async function _commLinkDocCore(commId, url) {
    url = (url || '').trim();
    if (!url) throw new Error('Paste a Google Drive URL');
    var meta = await fetchDriveFileMetadata(url);
    var docData = {
      type: 'drive',
      name: meta ? meta.name : url.split('/').pop() || 'Google Doc',
      url: url,
      webViewLink: meta ? meta.webViewLink : url,
      mimeType: meta ? meta.mimeType : null,
      addedAt: new Date().toISOString()
    };
    var docRef = MastDB.commissions.documents(commId).push();
    await docRef.set(docData);
    if (commissionsData[commId]) {
      if (!commissionsData[commId].documents) commissionsData[commId].documents = {};
      commissionsData[commId].documents[docRef.key] = docData;
    }
    await writeAudit('update', 'commission', commId);
    return docRef.key;
  }

  // Data-parameterized upload core (single source for the legacy modal + the V2
  // native "Upload File" action). Uploads to Storage, pushes the doc record,
  // audits. onProgress(pct) is optional. Returns the new doc key. Throws on
  // oversize / transport error so callers can surface it.
  async function _commUploadDocCore(commId, file, onProgress) {
    if (!file) throw new Error('Select a file first');
    if (file.size > 10 * 1024 * 1024) throw new Error('File must be under 10 MB');
    var fileName = Date.now() + '_' + file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    var storageRef = storage.ref(MastDB.storagePath('commission-docs/' + commId + '/' + fileName));
    var uploadTask = storageRef.put(file);
    await new Promise(function(resolve, reject) {
      uploadTask.on('state_changed',
        function(snapshot) {
          if (typeof onProgress === 'function') onProgress(Math.round((snapshot.bytesTransferred / snapshot.totalBytes) * 100));
        },
        reject,
        resolve
      );
    });
    var downloadUrl = await uploadTask.snapshot.ref.getDownloadURL();
    var docData = {
      type: 'upload',
      name: file.name,
      url: downloadUrl,
      mimeType: file.type || null,
      size: file.size,
      addedAt: new Date().toISOString()
    };
    var docRef = MastDB.commissions.documents(commId).push();
    await docRef.set(docData);
    if (commissionsData[commId]) {
      if (!commissionsData[commId].documents) commissionsData[commId].documents = {};
      commissionsData[commId].documents[docRef.key] = docData;
    }
    await writeAudit('update', 'commission', commId);
    return docRef.key;
  }

  // Data-parameterized remove-doc core (single source for the legacy + V2
  // actions; the confirm prompt stays with each caller).
  async function _commRemoveDocCore(commId, docId) {
    await MastDB.commissions.documents(commId, docId).remove();
    if (commissionsData[commId] && commissionsData[commId].documents) {
      delete commissionsData[commId].documents[docId];
    }
    await writeAudit('update', 'commission', commId);
  }

  // ============================================================
  // CommissionsBridge — data-object entry to the SAME write cores
  // ============================================================
  //
  // The commissions-v2 redesign twin (flag-gated #commissions-v2) is a Process
  // surface and must NOT reimplement the proposal / docs / job / milestone /
  // proposal-email / terms-token capture logic. This bridge exposes those write
  // actions parameterized by data (the legacy handlers read the form DOM, so
  // they can't be called with an object). It mirrors window.ProcurementBridge /
  // window.FinanceBridge: thin, additive, delegates to the shared cores above.
  // It changes NO behavior on the legacy surface.
  //
  // The cores read commissionsData[commId] for the live record (status, contact,
  // existing proposal). When the twin drives the flow, legacy loadCommissions()
  // may not have run, so each bridge method seeds that cache from the supplied
  // record (or a fresh single-record fetch) before calling the core. Settlement
  // (deposit/balance paid timestamps) is server-side and has NO bridge method —
  // there is intentionally no money-write here.
  function _bridgeSeed(commId, record) {
    if (record && typeof record === 'object') {
      var prev = commissionsData[commId] || {};
      commissionsData[commId] = Object.assign({}, prev, record, { id: commId });
      return Promise.resolve(commissionsData[commId]);
    }
    if (commissionsData[commId]) return Promise.resolve(commissionsData[commId]);
    return Promise.resolve(MastDB.commissions.get(commId)).then(function (c) {
      commissionsData[commId] = Object.assign({ id: commId }, c || {});
      return commissionsData[commId];
    });
  }

  window.CommissionsBridge = {
    // saveProposal(commId, {price,timeline,spec}, record?) → resolves to the
    // persisted updates. proposalPrice is FREE-TEXT (matches legacy).
    saveProposal: function (commId, fields, record) {
      return _bridgeSeed(commId, record).then(function () { return _commSaveProposalCore(commId, fields); });
    },
    // sendProposal(commId, fields?, record?) → { sent, to } | { sent:false, reason }.
    // Persists fields first (if given) then calls the EXISTING /commissionProposal CF.
    sendProposal: function (commId, fields, record) {
      return _bridgeSeed(commId, record).then(function () { return _commSendProposalCore(commId, fields || null); });
    },
    // createJob(commId, record?) → new production jobId.
    createJob: function (commId, record) {
      return _bridgeSeed(commId, record).then(function () { return _commCreateJobCore(commId); });
    },
    // linkDoc(commId, url, record?) → new doc key.
    linkDoc: function (commId, url, record) {
      return _bridgeSeed(commId, record).then(function () { return _commLinkDocCore(commId, url); });
    },
    // uploadDoc(commId, file, onProgress?, record?) → new doc key.
    uploadDoc: function (commId, file, onProgress, record) {
      return _bridgeSeed(commId, record).then(function () { return _commUploadDocCore(commId, file, onProgress); });
    },
    // removeDoc(commId, docId, record?) → void. (Confirm prompt stays on the caller.)
    removeDoc: function (commId, docId, record) {
      return _bridgeSeed(commId, record).then(function () { return _commRemoveDocCore(commId, docId); });
    },
    // postMilestone(commId, {stage,copyHtml,file,sendEmail}, onPhase?, record?) →
    // { milestoneId, emailQueued, statusUpdate }.
    postMilestone: function (commId, opts, onPhase, record) {
      return _bridgeSeed(commId, record).then(function () { return _commPostMilestoneCore(commId, opts, onPhase); });
    },
    // sendTermsToken(commId, record?) → { sent, to } | { sent:false, reason }.
    // Calls the EXISTING mintCommissionTermsToken callable.
    sendTermsToken: function (commId, record) {
      return _bridgeSeed(commId, record).then(function () { return _commSendTermsTokenCore(commId); });
    },
    // listMilestones(commId) → [milestone] sorted newest-first (read-only).
    listMilestones: function (commId) {
      return Promise.resolve(MastDB.get('admin/commissions/' + commId + '/milestones')).then(function (snap) {
        var ms = snap ? Object.keys(snap).map(function (k) { var m = snap[k]; m.id = k; return m; }) : [];
        ms.sort(function (a, b) { return (b.postedAt || '').localeCompare(a.postedAt || ''); });
        return ms;
      });
    },
    // milestoneStages() → the canonical stage list (key/label/template) so the
    // twin's Post-Milestone form matches the legacy modal exactly.
    milestoneStages: function () { return COMMISSION_MILESTONE_STAGES.slice(); }
  };
})();
