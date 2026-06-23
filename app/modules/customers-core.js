/**
 * customers-core.js — shared customer write/bridge layer (T6 rip-and-replace, PR1 keystone).
 *
 * Background (docs/ux-audit/customers-rip-replace-plan.md §PR1): retiring
 * app/modules/customers.js (the 3,540-line V1 customer UI) is blocked because
 * surviving V2 modules consume its write layer as window globals. This is the
 * keystone slice of that core — the genuinely cross-module-shared, non-list-UI
 * customer WRITE surface, lifted VERBATIM out of customers.js's IIFE:
 *   - window.CustomersBridge (field/tags/notes/segments/marketing/recompute/
 *     merge/isWholesale) — consumed by the customers-v2 twin.
 *   - mergeCustomers (window.customersMerge) — consumed by duplicates-v2.
 *   - the wallet-adjust modal + adjustCustomerWallet CF call
 *     (window.customersOpenWalletAdjust / customersSubmitWalletAdjust, audits
 *     admin/walletAdjustments) — consumed by loyalty-v2 + the twin.
 *   - addContactToCustomer (window.customersAddContact / Bridge.addContact).
 *   - customersAppendLinkedContact — consumed by contacts.js.
 *   - customersOpenDetail — consumed by cart.js / customer-service.js /
 *     finance.js (now aliased to the V2 detail; previously threw in V2 mode
 *     because customers.js wasn't loaded — that latent bug is fixed here).
 *
 * LAZY (loadModule('customers-core')) on purpose: the V2 consumers load this
 * instead of the 3,540-line V1 UI module, so customers.js can be deleted in a
 * later cut-plan PR. customers.js's V1 UI keeps its own copies of the IIFE-local
 * helpers it still calls internally (saveCustomerField / isWholesaleCustomer /
 * getCache / toast) and loads this core in its route setup for the window
 * globals — it is doomed but must not break in legacy mode mid-sequence.
 *
 * Pure verbatim move — NO logic change. The ONE deliberate deviation (the
 * orders-core PR1c pattern): every call to a V1-UI render fn that stays in
 * customers.js — renderPreservingEdits() and loadCustomers() — is wrapped in
 * the shell's own `typeof <fn> === 'function'` guard. In default V2 mode this
 * module's customer caches are dormant/empty (loadCustomers never runs), so
 * those branches were already no-ops for every cross-module consumer; the guard
 * just makes a dormant call gracefully skip instead of throwing a ReferenceError
 * after a successful write. Nothing else changed from the originals.
 *
 * Certs (loadCerts + revokeCert) landed here in cut-plan PR2 alongside the V2
 * certifications facet — they are the pure cert read + revoke write cores
 * (rebuilt on the engine, not the V1 cert detail UI). GRANT is NOT here: it stays
 * single-sourced in book.js (window._bookGrantCert), which the twin delegates to.
 * Vanilla ES5-ish (var/IIFE).
 */
(function () {
  'use strict';

  // Dormant module state — fresh copies of the V1 caches the moved write fns
  // reference. In default V2 mode these stay at their defaults (the customer
  // list is never loaded into this module), so every cache-mirror / render
  // branch below is a no-op — byte-identical to today, where the V1 module was
  // loaded only as a library and its caches were likewise empty.
  var customersData = [];
  var segmentsData = [];
  var wholesaleEmailMap = {};
  var detailCache = {};
  var currentView = 'list';
  var selectedCustomerId = null;
  var detailTab = 'overview';
  var customersLoaded = false;

  // Non-blocking feedback — reuse the global showToast helper from index.html.
  function toast(msg, isErr) {
    if (typeof window.showToast === 'function') window.showToast(msg, !!isErr);
  }

  function getCache(customerId) {
    if (!detailCache[customerId]) {
      detailCache[customerId] = { orders: [], enrollments: [], interactions: [], wallets: [], loaded: {} };
    }
    return detailCache[customerId];
  }

  function uniq(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function(v) { if (v != null && !seen[v]) { seen[v] = 1; out.push(v); } });
    return out;
  }

  // W2d — true if any of the customer's emails appears in the authorized-users
  // map with a non-null wholesaleAccountId. Customers without a primary email
  // can never match wholesale.
  function isWholesaleCustomer(c) {
    if (!c) return false;
    var candidates = [];
    if (c.primaryEmail) candidates.push(c.primaryEmail);
    if (Array.isArray(c.emails)) candidates = candidates.concat(c.emails);
    for (var i = 0; i < candidates.length; i++) {
      var e = (candidates[i] || '').toLowerCase().trim();
      if (e && wholesaleEmailMap[e]) return true;
    }
    return false;
  }

  // Writer — updates customer field and refreshes the in-memory copy + UI.
  function saveCustomerField(customerId, fieldPath, value) {
    var updates = {};
    updates[fieldPath] = value;
    updates['updatedAt'] = new Date().toISOString();
    return MastDB.update('admin/customers/' + customerId, updates).then(function() {
      // Mirror into in-memory copy
      var c = customersData.find(function(x) { return x && x.id === customerId; });
      if (c) {
        // Apply field path (only top-level or marketing.x for now)
        if (fieldPath.indexOf('.') !== -1) {
          var parts = fieldPath.split('.');
          if (!c[parts[0]]) c[parts[0]] = {};
          c[parts[0]][parts[1]] = value;
        } else {
          c[fieldPath] = value;
        }
        c.updatedAt = updates['updatedAt'];
      }
      if (currentView === 'detail' && selectedCustomerId === customerId && detailTab === 'overview') {
        if (typeof renderPreservingEdits === 'function') renderPreservingEdits();
      }
      toast('Saved');
    }).catch(function(e) {
      console.error('[customers] save failed', fieldPath, e);
      toast('Save failed: ' + (e && e.message), true);
    });
  }

  async function mergeCustomers(flagId, winnerId, loserId) {
    if (!winnerId || !loserId || winnerId === loserId) return;
    var winnerCust = customersData.find(function(x) { return x && x.id === winnerId; });
    var loserCust = customersData.find(function(x) { return x && x.id === loserId; });
    var winnerLabel = (winnerCust && (winnerCust.displayName || winnerCust.primaryEmail)) || 'this customer';
    var loserLabel = (loserCust && (loserCust.displayName || loserCust.primaryEmail)) || 'the other customer';
    var ok = await window.mastConfirm(
      'Merge "' + loserLabel + '" into "' + winnerLabel + '"?\n\nThis rewrites all linked orders, enrollments and contacts. This cannot be undone.',
      { title: 'Merge customers', confirmLabel: 'Merge', danger: true }
    );
    if (!ok) return;

    try {
      var refs = await Promise.all([
        MastDB.get('admin/customers/' + winnerId),
        MastDB.get('admin/customers/' + loserId),
        MastDB.query('orders').orderByChild('customerId').equalTo(loserId).once('value'),
        MastDB.query('admin/enrollments').orderByChild('customerId').equalTo(loserId).once('value')
      ]);
      var winner = refs[0].val();
      var loser = refs[1].val();
      if (!winner || !loser) { await window.mastAlert('One of the customers no longer exists.'); return; }

      var loserOrders = refs[2].val() || {};
      var loserEnrollments = refs[3].val() || {};

      var winnerLinked = winner.linkedIds || { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };
      var loserLinked = loser.linkedIds || { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };

      var mergedEmails = uniq([].concat(winner.emails || [], loser.emails || []));
      var mergedPhones = uniq([].concat(winner.phones || [], loser.phones || []));
      var mergedUids = uniq([].concat(winnerLinked.uids || [], loserLinked.uids || []));
      var mergedContactIds = uniq([].concat(winnerLinked.contactIds || [], loserLinked.contactIds || []));
      var mergedStudentIds = uniq([].concat(winnerLinked.studentIds || [], loserLinked.studentIds || []));
      var mergedTags = uniq([].concat(winner.tags || [], loser.tags || []));
      var mergedFromList = uniq([].concat(winner.mergedFrom || [], [loserId], loser.mergedFrom || []));
      var now = new Date().toISOString();

      var notes = winner.notes || '';
      if (loser.notes) {
        notes = (notes ? notes + '\n\n' : '') + '— merged from ' + loserId + ' —\n' + loser.notes;
      }

      var updates = {};
      // Winner record overwrites
      updates['admin/customers/' + winnerId + '/emails'] = mergedEmails;
      updates['admin/customers/' + winnerId + '/phones'] = mergedPhones;
      updates['admin/customers/' + winnerId + '/linkedIds'] = {
        uids: mergedUids,
        contactIds: mergedContactIds,
        studentIds: mergedStudentIds,
        squareCustomerId: winnerLinked.squareCustomerId || loserLinked.squareCustomerId || null
      };
      updates['admin/customers/' + winnerId + '/tags'] = mergedTags;
      updates['admin/customers/' + winnerId + '/notes'] = notes;
      updates['admin/customers/' + winnerId + '/marketing/newsletterOptIn'] =
        !!((winner.marketing && winner.marketing.newsletterOptIn) || (loser.marketing && loser.marketing.newsletterOptIn));
      updates['admin/customers/' + winnerId + '/mergedFrom'] = mergedFromList;
      updates['admin/customers/' + winnerId + '/updatedAt'] = now;

      // Loser archive
      updates['admin/customers/' + loserId + '/status'] = 'merged';
      updates['admin/customers/' + loserId + '/mergedInto'] = winnerId;
      updates['admin/customers/' + loserId + '/updatedAt'] = now;

      // Reindex byEmail/byUid/byContactId for loser → winner. Use the shared
      // canonical key (gmail dot/+tag aware) so merged keys match the resolver.
      function emailKey(e) {
        if (window.MastCustomerResolver) return window.MastCustomerResolver.emailKey(e);
        return e ? String(e).trim().toLowerCase().replace(/[.#$\[\]\/]/g, ',') : null;
      }
      (loser.emails || []).forEach(function(e) {
        var k = emailKey(e);
        if (k) updates['admin/customerIndexes/byEmail/' + k] = winnerId; // lint-customer-writes-ok: merge re-points loser's byEmail key to winner
      });
      (loserLinked.uids || []).forEach(function(u) {
        updates['admin/customerIndexes/byUid/' + u] = winnerId;
      });
      (loserLinked.contactIds || []).forEach(function(cid) {
        updates['admin/customerIndexes/byContactId/' + cid] = winnerId;
      });

      // Rewrite customerId on linked orders + enrollments
      Object.keys(loserOrders).forEach(function(orderId) {
        updates['orders/' + orderId + '/customerId'] = winnerId;
      });
      Object.keys(loserEnrollments).forEach(function(enId) {
        updates['admin/enrollments/' + enId + '/customerId'] = winnerId;
      });

      // Rewrite customerId on linked contacts (so contact records still point at winner)
      (loserLinked.contactIds || []).forEach(function(cid) {
        updates['admin/contacts/' + cid + '/customerId'] = winnerId;
      });

      // Mark duplicate flag merged
      if (flagId) {
        updates['admin/customerDuplicates/' + flagId + '/status'] = 'merged';
        updates['admin/customerDuplicates/' + flagId + '/mergedAt'] = now;
        updates['admin/customerDuplicates/' + flagId + '/winnerId'] = winnerId;
        updates['admin/customerDuplicates/' + flagId + '/loserId'] = loserId;
      }

      await MastDB.multiUpdate(updates);

      // Reload
      customersLoaded = false;
      detailCache = {};
      if (typeof loadCustomers === 'function') await loadCustomers();
    } catch (e) {
      console.error('[customers] merge failed', e);
      window.mastAlert('Merge failed: ' + (e && e.message));
    }
  }

  function addContactToCustomer(customerId) {
    if (!customerId) customerId = selectedCustomerId;
    var c = customersData.find(function(x) { return x && x.id === customerId; });
    if (!c) return;
    var label = c.displayName || c.primaryEmail || 'customer';

    if (window.MastNavStack && customerId) {
      MastNavStack.push({
        route: 'customers',
        view: 'detail',
        state: { customerId: customerId, detailTab: 'contacts', scrollTop: window.scrollY || 0 },
        label: label
      });
    }

    window._pendingContactCustomerLink = {
      customerId: customerId,
      prefillName: c.displayName || '',
      prefillEmail: c.primaryEmail || ''
    };

    var doNav = function() {
      window._mastNavInternal = true;
      try {
        if (typeof navigateTo === 'function') navigateTo('contacts');
      } finally {
        window._mastNavInternal = false;
      }
      var openIt = function() {
        // T6: contacts.js retired. The V2 create slide-out reads
        // _pendingContactCustomerLink (set above) for prefill + the customer link.
        if (window.ContactsV2 && typeof window.ContactsV2.create === 'function') {
          window.ContactsV2.create();
        } else {
          console.error('[customers] ContactsV2.create not available after contacts-v2 load');
          toast('Failed to open add-contact form', true);
        }
      };
      if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
        MastAdmin.loadModule('contacts-v2').then(openIt).catch(function(err) {
          console.error('[customers] contacts-v2 module load failed', err);
          toast('Failed to load contacts module: ' + (err && err.message || err), true);
        });
      } else {
        setTimeout(openIt, 50);
      }
    };
    if (window.MastDirty) MastDirty.checkAndExit(doNav); else doNav();
  }

  // D4 — open the wallet-adjustment modal for a (kind, customerId, walletUid).
  // Routes to the right form per kind. Each form collects payload + reason
  // and submits to the adjustCustomerWallet CF.
  function openWalletAdjustModal(kind, customerId, walletUid) {
    var titleByKind = {
      credit: 'Adjust store credit', pass: 'Grant a pass',
      membership: 'Change membership tier', loyalty: 'Adjust loyalty points'
    };
    var bodyHtml;
    if (kind === 'credit') {
      bodyHtml =
        '<div class="form-group"><label>Action</label>' +
          '<select id="walletAdjAction" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;">' +
            '<option value="grant">Grant new credit</option>' +
            '<option value="adjust">Adjust existing credit</option>' +
            '<option value="revoke">Revoke existing credit</option>' +
          '</select></div>' +
        '<div class="form-group" id="walletAdjCreditIdRow" style="display:none;"><label>Credit ID</label>' +
          '<input type="text" id="walletAdjCreditId" placeholder="Credit record ID" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjAmountRow"><label>Amount ($)</label>' +
          '<input type="number" id="walletAdjAmount" min="0" step="0.01" placeholder="e.g. 25.00" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjExpiryRow"><label>Expires (optional)</label>' +
          '<input type="date" id="walletAdjExpiry" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>';
    } else if (kind === 'pass') {
      bodyHtml =
        '<div class="form-group"><label>Action</label>' +
          '<select id="walletAdjAction" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;">' +
            '<option value="grant">Grant a pass</option>' +
            '<option value="revoke">Revoke an existing pass</option>' +
          '</select></div>' +
        '<div class="form-group" id="walletAdjPassDefRow"><label>Pass definition ID</label>' +
          '<input type="text" id="walletAdjPassDefId" placeholder="passDefId (Book → Passes)" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjSessionsRow"><label>Sessions total (optional)</label>' +
          '<input type="number" id="walletAdjSessions" min="1" step="1" placeholder="e.g. 10" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjExpiryRow"><label>Expires (optional)</label>' +
          '<input type="date" id="walletAdjExpiry" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<div class="form-group" id="walletAdjPassIdRow" style="display:none;"><label>Pass ID (to revoke)</label>' +
          '<input type="text" id="walletAdjPassId" placeholder="Pass record ID" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>';
    } else if (kind === 'membership') {
      bodyHtml =
        '<div class="form-group"><label>New tier</label>' +
          '<input type="text" id="walletAdjTier" placeholder="e.g. gold, silver, founder" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 12px;">No proration — billing settles on the next cycle.</p>';
    } else if (kind === 'loyalty') {
      bodyHtml =
        '<div class="form-group"><label>Point delta (use negative to deduct)</label>' +
          '<input type="number" id="walletAdjDelta" step="1" placeholder="e.g. 100 or -50" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></div>';
    }
    var html =
      '<div class="modal-header"><h3>' + esc(titleByKind[kind] || 'Wallet adjustment') + '</h3></div>' +
      '<div class="modal-body">' +
        '<input type="hidden" id="walletAdjKind" value="' + esc(kind) + '">' +
        '<input type="hidden" id="walletAdjCustomerId" value="' + esc(customerId) + '">' +
        '<input type="hidden" id="walletAdjUid" value="' + esc(walletUid) + '">' +
        bodyHtml +
        '<div class="form-group"><label>Reason <span style="color:var(--danger);">*</span></label>' +
          '<textarea id="walletAdjReason" rows="2" placeholder="Required. Shown in the audit trail." style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;font-size:0.9rem;"></textarea></div>' +
        '<div id="walletAdjStatus" style="font-size:0.85rem;margin-top:8px;"></div>' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" id="walletAdjSaveBtn" onclick="customersSubmitWalletAdjust()">Save</button>' +
      '</div>';
    if (typeof openModal === 'function') openModal(html);

    // Wire up action-switch for credit + pass (changes visible field rows)
    var actionEl = document.getElementById('walletAdjAction');
    if (actionEl) {
      var updateFields = function() {
        var act = actionEl.value;
        if (kind === 'credit') {
          var cidRow = document.getElementById('walletAdjCreditIdRow');
          var expRow = document.getElementById('walletAdjExpiryRow');
          if (cidRow) cidRow.style.display = (act === 'grant') ? 'none' : '';
          if (expRow) expRow.style.display = (act === 'grant') ? '' : 'none';
        } else if (kind === 'pass') {
          var defRow = document.getElementById('walletAdjPassDefRow');
          var sesRow = document.getElementById('walletAdjSessionsRow');
          var pexRow = document.getElementById('walletAdjExpiryRow');
          var pidRow = document.getElementById('walletAdjPassIdRow');
          if (defRow) defRow.style.display = (act === 'grant') ? '' : 'none';
          if (sesRow) sesRow.style.display = (act === 'grant') ? '' : 'none';
          if (pexRow) pexRow.style.display = (act === 'grant') ? '' : 'none';
          if (pidRow) pidRow.style.display = (act === 'revoke') ? '' : 'none';
        }
      };
      actionEl.addEventListener('change', updateFields);
      updateFields();
    }
  }

  // D4 — submit handler reads modal fields, validates, calls CF.
  async function submitWalletAdjust() {
    var kind = (document.getElementById('walletAdjKind') || {}).value;
    var customerId = (document.getElementById('walletAdjCustomerId') || {}).value;
    var walletUid = (document.getElementById('walletAdjUid') || {}).value;
    var action = (document.getElementById('walletAdjAction') || {}).value || 'adjust';
    var reason = ((document.getElementById('walletAdjReason') || {}).value || '').trim();
    var statusEl = document.getElementById('walletAdjStatus');
    var btn = document.getElementById('walletAdjSaveBtn');
    var setStatus = function(msg, color) {
      if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || 'var(--warm-gray)'; }
    };
    if (!reason || reason.length < 3) { setStatus('Reason is required.', 'var(--danger)'); return; }

    var payload = {};
    if (kind === 'credit') {
      if (!hasPermission('wallet', 'grantCredit')) { setStatus('You do not have permission to grant store credit.', 'var(--danger)'); return; }
      if (action === 'grant') {
        var amt = parseFloat((document.getElementById('walletAdjAmount') || {}).value || '0');
        if (!(amt > 0)) { setStatus('Enter an amount.', 'var(--danger)'); return; }
        payload.amountCents = Math.round(amt * 100);
        var exp = (document.getElementById('walletAdjExpiry') || {}).value;
        if (exp) payload.expiresAt = exp;
      } else {
        payload.creditId = ((document.getElementById('walletAdjCreditId') || {}).value || '').trim();
        if (!payload.creditId) { setStatus('Credit ID required.', 'var(--danger)'); return; }
        if (action === 'adjust') {
          var amt2 = parseFloat((document.getElementById('walletAdjAmount') || {}).value || '');
          if (!Number.isFinite(amt2) || amt2 < 0) { setStatus('Enter a valid amount.', 'var(--danger)'); return; }
          payload.amountCents = Math.round(amt2 * 100);
        }
      }
    } else if (kind === 'pass') {
      if (action === 'grant') {
        payload.passDefId = ((document.getElementById('walletAdjPassDefId') || {}).value || '').trim();
        if (!payload.passDefId) { setStatus('Pass definition ID required.', 'var(--danger)'); return; }
        var sess = parseInt((document.getElementById('walletAdjSessions') || {}).value || '0', 10);
        if (sess > 0) payload.sessionsTotal = sess;
        var pexp = (document.getElementById('walletAdjExpiry') || {}).value;
        if (pexp) payload.expiresAt = pexp;
      } else {
        payload.passId = ((document.getElementById('walletAdjPassId') || {}).value || '').trim();
        if (!payload.passId) { setStatus('Pass ID required.', 'var(--danger)'); return; }
      }
    } else if (kind === 'membership') {
      payload.tier = ((document.getElementById('walletAdjTier') || {}).value || '').trim();
      if (!payload.tier) { setStatus('Tier required.', 'var(--danger)'); return; }
      action = 'adjust';
    } else if (kind === 'loyalty') {
      var delta = parseInt((document.getElementById('walletAdjDelta') || {}).value || '0', 10);
      if (!Number.isFinite(delta) || delta === 0) { setStatus('Enter a non-zero delta.', 'var(--danger)'); return; }
      payload.delta = delta;
      action = 'adjust';
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
    setStatus('');
    try {
      var fn = firebase.functions().httpsCallable('adjustCustomerWallet');
      var result = await fn({
        tenantId: MastDB.tenantId(),
        customerId: customerId,
        walletUid: walletUid,
        kind: kind,
        action: action,
        payload: payload,
        reason: reason
      });
      if (!result || !result.data || result.data.ok !== true) {
        throw new Error((result && result.data && result.data.message) || 'CF returned non-ok');
      }
      // Invalidate caches and re-render so the new state + audit row show.
      var cache = getCache(customerId);
      cache.loaded.wallets = false;
      cache.loaded.walletAudit = false;
      if (typeof closeModal === 'function') closeModal();
      if (typeof showToast === 'function') showToast('Wallet adjustment recorded.');
      if (typeof renderPreservingEdits === 'function') renderPreservingEdits();
    } catch (e) {
      console.error('[customers] wallet adjust failed', e);
      setStatus('Save failed: ' + (e && e.message), 'var(--danger)');
      if (btn) { btn.disabled = false; btn.textContent = 'Save'; }
    }
  }

  // ── Certifications (cut-plan PR2; deferred from PR1) ──────────────────────
  // The customer-cert read + revoke write, lifted out of V1 customers.js for the
  // V2 certifications facet. Grant is NOT here — it is owned by book.js
  // (window._bookGrantCert, the single source of grant logic the twin delegates
  // to). RBAC is enforced at the V2 affordance + handler (CustomersV2.grantCert /
  // revokeCert key on can('customers','edit')); these are the pure data cores.

  // Read a customer's certifications + the cert-type registry. Returns the V1
  // loadCustomerCerts shape: { certs:[…with .id=key], certTypes:{…} }. Read-only;
  // called LAZILY from customers-v2.fetch (on record open), never the list load().
  function loadCustomerCerts(customerId) {
    return Promise.all([
      MastDB.get('admin/customers/' + customerId + '/certifications'),
      MastDB.get('admin/certTypes')
    ]).then(function (results) {
      var data = results[0] || {};
      var types = results[1] || {};
      var certs = Object.keys(data).map(function (k) {
        var c = data[k] || {};
        c.id = k;
        return c;
      });
      return { certs: certs, certTypes: types };
    });
  }

  // Revoke a certification — byte-faithful to V1's customersRevokeCertConfirm
  // write (customers.js): a field-scoped MastDB.update that sets revokedAt/By/
  // Reason/Note. The cert STAYS on the record as revoked (history preserved), it
  // is never deleted. note is trimmed → null when empty (matches legacy).
  function revokeCert(customerId, certId, opts) {
    opts = opts || {};
    var note = (opts.note || '').trim();
    return MastDB.update('admin/customers/' + customerId + '/certifications/' + certId, {
      revokedAt: new Date().toISOString(),
      revokedBy: (window.MastAdmin && MastAdmin.currentUser && MastAdmin.currentUser.uid) || 'admin',
      revokeReason: opts.reason || 'other',
      revokeNote: note || null
    });
  }

  // ── V2 bridge (classic burn-down Wave E) — state-free cores shared with
  // customers-v2; the twin never re-implements a write. Merge stays
  // single-sourced on mergeCustomers (already consumed by duplicates-v2).
  window.CustomersBridge = {
    saveField: saveCustomerField,
    setTags: function (customerId, tags) { return saveCustomerField(customerId, 'tags', Array.isArray(tags) ? tags : []); },
    saveNotes: function (customerId, value) { return saveCustomerField(customerId, 'notes', value || ''); },
    listSegments: async function () {
      var raw = await MastDB.get('admin/customerSegments') || {};
      return Object.keys(raw).map(function (k) { return Object.assign({ _key: k }, raw[k]); })
        .filter(function (x) { return x && x.name; });
    },
    saveSegment: async function (name, filters) {
      name = (name || '').trim();
      if (!name) throw new Error('Segment name required');
      var id = MastUtil.genId('seg_');
      var now = new Date().toISOString();
      var record = {
        id: id, name: name, filters: filters || {},
        createdBy: (window.currentUser && window.currentUser.uid) || null,
        createdAt: now, updatedAt: now
      };
      await MastDB.set('admin/customerSegments/' + id, record);
      segmentsData.push(record);
      return record;
    },
    deleteSegment: async function (segId) {
      await MastDB.remove('admin/customerSegments/' + segId);
      segmentsData = segmentsData.filter(function (x) { return x.id !== segId; });
      return true;
    },
    renameSegment: async function (segId, name) {
      name = (name || '').trim();
      if (!name) throw new Error('Segment name required');
      var now = new Date().toISOString();
      await MastDB.update('admin/customerSegments/' + segId, { name: name, updatedAt: now });
      var seg = segmentsData.find(function (x) { return x.id === segId; });
      if (seg) { seg.name = name; seg.updatedAt = now; }
      return true;
    },
    // Marketing opt-in (newsletter + SMS) — a deep set on the nested marketing
    // object so a single-channel write never clobbers the other channel. Same
    // write legacy's toggleNewsletter performs; SMS reuses the identical path.
    // This is the SINGLE source for both the legacy toggle and the V2 twin.
    setMarketingOptIn: async function (customerId, channel, value) {
      var key = (channel === 'sms') ? 'smsOptIn' : 'newsletterOptIn';
      var val = !!value;
      var now = new Date().toISOString();
      await MastDB.set('admin/customers/' + customerId + '/marketing/' + key, val);
      await MastDB.set('admin/customers/' + customerId + '/updatedAt', now);
      var c = customersData.find(function (x) { return x && x.id === customerId; });
      if (c) { if (!c.marketing) c.marketing = {}; c.marketing[key] = val; c.updatedAt = now; }
      return val;
    },
    // Add/link a contact to this customer — opens the contacts add-contact flow
    // with the customer pre-linked (legacy addContactToCustomer). Navigation +
    // modal only; the atomic contact write lives in contacts.js.
    addContact: function (customerId) { return addContactToCustomer(customerId); },
    recomputeStats: async function () {
      var fn = firebase.functions().httpsCallable('recomputeAllCustomerStats');
      var res = await fn({ tenantId: MastDB.tenantId() });
      var data = (res && res.data) || {};
      if (data.ok !== true) throw new Error(data.message || 'Recompute failed');
      return data;
    },
    merge: mergeCustomers,
    isWholesale: isWholesaleCustomer,
    // Certifications (PR2): read the cert list + types (lazy on record open) and
    // revoke a cert. Grant is delegated to book.js _bookGrantCert (single source).
    loadCerts: loadCustomerCerts,
    revokeCert: revokeCert
  };
  window.customersMerge = mergeCustomers;
  window.customersOpenWalletAdjust = openWalletAdjustModal;
  window.customersSubmitWalletAdjust = submitWalletAdjust;
  window.customersAddContact = addContactToCustomer;
  // Called by contacts.js after atomically creating a contact that's linked
  // to a customer. Keeps the customers module's in-memory copy in sync so
  // MastNavStack.popAndReturn → restorer → render shows the new entry.
  window.customersAppendLinkedContact = function(customerId, contactId) {
    var cust = customersData.find(function(x) { return x && x.id === customerId; });
    if (!cust) return;
    if (!cust.linkedIds) cust.linkedIds = {};
    var ids = (cust.linkedIds.contactIds || []).slice();
    if (ids.indexOf(contactId) === -1) ids.push(contactId);
    cust.linkedIds.contactIds = ids;
    cust.updatedAt = new Date().toISOString();
    // Invalidate the per-customer contacts cache so loadCustomerContacts
    // refetches fresh and picks up the new contact record.
    var cache = detailCache[customerId];
    if (cache) {
      cache.loaded.contacts = false;
      cache._contactsLoading = false;
    }
  };

  // Cross-module "open this customer" entry (cart.js / customer-service.js /
  // finance.js). Default-mode customers route resolves to the V2 twin, so route
  // it there; in legacy mode (CustomersV2 not registered) fall back to the
  // customers route deep-link, which opens the V1 detail. Previously this was
  // `= openDetail` (a V1 fn) and threw for cart's onclick in V2 mode because
  // customers.js wasn't loaded — the ensure-load at the call sites + this alias
  // fix that.
  window.customersOpenDetail = function (id) {
    if (window.CustomersV2 && typeof CustomersV2.open === 'function') return CustomersV2.open(id);
    if (typeof navigateTo === 'function') navigateTo('customers', { id: id });
  };

  MastAdmin.registerModule('customers-core', {});
})();
