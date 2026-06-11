/**
 * finance-openitems-v2.js — ONE open-items ledger queue (Finance Wave 2,
 * docs/ux-audit/finance-v2-build-plan.md — consolidation hub 2 of 3).
 *
 * AR and AP were two sidebar routes with identical aging math over two
 * collections. This module serves BOTH routes (#finance-ar-v2, #finance-ap-v2)
 * with one queue page; the route picks the entry lens (Receivables /
 * Payables — fulfillment-v2 precedent). A third Vendors lens hosts the vendor
 * master records that bills reference.
 *
 * Queue archetype (standard-record-ui §10): rows are work ("what do I chase
 * next"), bucket pills count the aging bands, row click opens the underlying
 * record SO — AR rows drill to the standard orders-v2 record, AP rows open a
 * native bill SO (entity ap-bills-v2). Every write delegates to the
 * state-free FinanceBridge cores in finance.js (mark paid, record payment,
 * save bill/vendor, queue reminder, audited deletes) — nothing re-implemented.
 *
 * Reminders lens (classic burn-down 2026-06-10): dunning settings form +
 * read-only reminder audit log, native — via FinanceBridge.arDunningConfig /
 * arSaveDunningSettings / arReminderLog. No classic links remain.
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

  var U = window.MastUI, N = U.Num, esc = U._esc || function (s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  function m(cents) { return N.money(cents, { cents: true }); }
  function bridge() { return window.FinanceBridge; }
  function can(route, axis) { return (typeof window.can === 'function') ? window.can(route, axis) : true; }

  var BUCKETS = [['all', 'All'], ['current', 'Current'], ['1_to_30', '1–30d'], ['31_to_60', '31–60d'], ['61_to_90', '61–90d'], ['90_plus', '90d+']];
  var V2 = { lens: 'ar', bucket: 'all', ar: [], ap: [], vendors: {}, busy: {}, reminded: {}, dunning: null, reminderLog: null };

  function ensureTab() {
    var el = document.getElementById('financeOpenItemsV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'financeOpenItemsV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  // ── Entities ──────────────────────────────────────────────────────────────
  var VENDOR_TYPES = [{ value: '', label: '— Select —' }, { value: 'supplier', label: 'Supplier' }, { value: 'contractor', label: 'Contractor' }, { value: 'utility', label: 'Utility' }, { value: 'other', label: 'Other' }];
  var BILL_STATUS = [{ value: 'unpaid', label: 'Unpaid' }, { value: 'partial', label: 'Partially paid' }, { value: 'paid', label: 'Paid' }];

  function defineEntities() {
    if (MastEntity.get('ap-bills-v2')) return;

    MastEntity.define('ap-bills-v2', {
      label: 'Bill',
      recordId: function (r) { return r.receiptId || r.id; },
      fetch: function (id) {
        return ensureLoaded().then(function () {
          var hit = V2.ap.filter(function (r) { return (r.receiptId || r.id) === id; })[0];
          if (hit) return prepBill(hit);
          return MastDB.get('admin/purchaseReceipts/' + id).then(function (raw) { return raw ? prepBill(toBillRow(id, raw)) : null; });
        });
      },
      fields: [
        // NB: no get() on editable fields — the engine treats get()-bearing
        // fields as read-only context. prepBill() pre-maps these onto the
        // record before openRecord instead.
        { name: 'vendorName', label: 'Vendor', readOnly: true, group: 'Bill' },
        { name: 'vendorId', label: 'Vendor', type: 'select', required: true, group: 'Bill', options: [] /* filled per-render */ },
        { name: 'vendorInvoiceRef', label: 'Invoice ref / PO #', group: 'Bill' },
        { name: 'amountDollars', label: 'Amount (USD)', required: true, group: 'Bill' },
        { name: 'receivedDate', label: 'Received (YYYY-MM-DD)', required: true, group: 'Dates' },
        { name: 'dueDate', label: 'Due (YYYY-MM-DD)', group: 'Dates' },
        { name: 'paymentStatus', label: 'Status', type: 'status', options: BILL_STATUS, group: 'Bill' },
        { name: 'notes', label: 'Notes', group: 'Bill' }
      ],
      detail: {
        // Engine convention: custom read interior is render(MastUI, record).
        render: function (_U, r) {
          var bal = (r.totalCents || 0) - (r.paidCents || 0);
          var canEdit = can('finance-ap', 'edit');
          var canDel = can('finance-ap', 'delete');
          var h = U.tiles([
            { k: 'Amount', v: m(r.totalCents), hero: true },
            { k: 'Paid', v: m(r.paidCents || 0) },
            { k: 'Balance due', v: m(bal) },
            { k: 'Due', v: r.dueDate ? esc(r.dueDate) + (r.daysOverdue > 0 ? ' <span style="color:var(--danger);font-size:0.72rem;">' + r.daysOverdue + 'd over</span>' : '') : '—' }
          ]);
          h += U.card('Vendor', '<div style="font-size:0.9rem;">' +
            '<a href="javascript:void(0)" onclick="OpenItemsV2.openVendor(\'' + esc(r.vendorId || '') + '\')" style="color:var(--teal);">' + esc(r.vendorName || '(no vendor)') + '</a>' +
            (r.vendorInvoiceRef ? ' <span style="color:var(--warm-gray);">· ' + esc(r.vendorInvoiceRef) + '</span>' : '') + '</div>' +
            (r.notes ? '<div style="font-size:0.85rem;color:var(--warm-gray);margin-top:8px;">' + esc(r.notes) + '</div>' : ''));
          if (bal > 0 && canEdit) {
            h += U.card('Record a payment',
              '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">' +
              '<span style="font-size:0.85rem;">$</span>' +
              '<input type="number" id="oiPayAmt" min="0.01" step="0.01" max="' + (bal / 100).toFixed(2) + '" placeholder="Amount" class="form-input" style="width:130px;">' +
              '<button class="btn btn-primary" style="font-size:0.78rem;" onclick="OpenItemsV2.recordPayment(\'' + esc(r.receiptId) + '\')">Apply</button>' +
              '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="OpenItemsV2.markBillPaid(\'' + esc(r.receiptId) + '\')">Mark fully paid</button>' +
              '</div>');
          }
          if (r.paymentStatus === 'unpaid' && !r.poId && canDel) {
            h += '<div style="margin-top:14px;"><button class="btn btn-secondary" style="color:var(--danger);font-size:0.78rem;" onclick="OpenItemsV2.deleteBill(\'' + esc(r.receiptId) + '\')">Delete bill</button></div>';
          } else if (r.poId) {
            h += '<div style="margin-top:14px;font-size:0.72rem;color:var(--warm-gray);">Linked to a purchase order — manage via Procurement; delete disabled.</div>';
          }
          return h;
        }
      },
      onSave: can('finance-ap', 'edit') ? function (rec, mode) {
        var amount = parseFloat(rec.amountDollars);
        if (isNaN(amount) || amount <= 0) { showToast('Amount must be > 0', true); return false; }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rec.receivedDate || '')) { showToast('Received date must be YYYY-MM-DD', true); return false; }
        if (rec.dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(rec.dueDate)) { showToast('Due date must be YYYY-MM-DD', true); return false; }
        var amountCents = Math.round(amount * 100);
        var status = rec.paymentStatus || 'unpaid';
        var payload = {
          vendorId: rec.vendorId,
          vendorInvoiceRef: (rec.vendorInvoiceRef || '').trim() || null,
          amountCents: amountCents,
          receivedAt: rec.receivedDate + 'T00:00:00Z',
          dueDate: (rec.dueDate || '').trim() || null,
          paymentStatus: status,
          notes: (rec.notes || '').trim() || null
        };
        if (status === 'paid') payload.paidAmount = amountCents;
        else if (status !== 'partial') payload.paidAmount = 0;
        var billId = mode === 'create' ? null : (rec.receiptId || rec.id);
        return bridge().apSaveBill(billId, payload).then(function () {
          showToast(billId ? 'Bill updated' : 'Bill created');
          load(); return true;
        }).catch(function (err) { showToast('Save failed: ' + (err.message || err), true); return false; });
      } : undefined
    });

    MastEntity.define('ap-vendors-v2', {
      label: 'Vendor',
      recordId: function (r) { return r._vid || r.id; },
      fetch: function (id) {
        return MastDB.get('admin/vendors/' + id).then(function (v) { return v ? Object.assign({ _vid: id }, v) : null; });
      },
      fields: [
        { name: 'name', label: 'Name', required: true, group: 'Vendor' },
        { name: 'contactName', label: 'Contact', group: 'Vendor' },
        { name: 'email', label: 'Email', group: 'Vendor' },
        { name: 'phone', label: 'Phone', group: 'Vendor' },
        { name: 'vendorType', label: 'Type', type: 'select', options: VENDOR_TYPES, group: 'Vendor' },
        { name: 'defaultPaymentTerms', label: 'Payment terms', group: 'Vendor' },
        { name: 'taxId', label: 'Tax ID (EIN/SSN)', group: 'Vendor' }
      ],
      onSave: can('finance-ap', 'edit') ? function (rec, mode) {
        if (!rec.name || !rec.name.trim()) { showToast('Name is required', true); return false; }
        var payload = {
          name: rec.name.trim(),
          contactName: (rec.contactName || '').trim() || null,
          email: (rec.email || '').trim() || null,
          phone: (rec.phone || '').trim() || null,
          vendorType: rec.vendorType || null,
          defaultPaymentTerms: (rec.defaultPaymentTerms || '').trim() || null,
          taxId: (rec.taxId || '').trim() || null
        };
        var vid = mode === 'create' ? null : rec._vid;
        return bridge().apSaveVendor(vid, payload).then(function () {
          showToast(vid ? 'Vendor updated' : 'Vendor created');
          load(); return true;
        }).catch(function (err) { showToast('Save failed: ' + (err.message || err), true); return false; });
      } : undefined
    });
  }

  // Pre-map the edit-form virtual fields onto the bill row (see fields NB).
  function prepBill(bill) {
    bill.amountDollars = bill.totalCents != null ? (bill.totalCents / 100).toFixed(2) : '';
    bill.receivedDate = bill.receivedAt ? String(bill.receivedAt).slice(0, 10) : '';
    return bill;
  }

  function toBillRow(id, raw) {
    return {
      receiptId: id, vendorId: raw.vendorId || null,
      vendorName: (V2.vendors[raw.vendorId] && V2.vendors[raw.vendorId].name) || '(no vendor)',
      vendorInvoiceRef: raw.vendorInvoiceRef || null,
      totalCents: raw.amountCents || 0, paidCents: raw.paidAmount || 0,
      amtDue: (raw.amountCents || 0) - (raw.paidAmount || 0),
      dueDate: raw.dueDate || null, receivedAt: raw.receivedAt || null,
      daysOverdue: 0, bucket: 'current', paymentStatus: raw.paymentStatus,
      notes: raw.notes || null, poId: raw.poId || null
    };
  }

  // ── Load (run-once gate so cold drills get module state) ─────────────────
  var _loaded = null;
  function ensureLoaded() {
    if (_loaded) return _loaded;
    _loaded = MastAdmin.loadModule('finance').then(function () {
      return Promise.all([bridge().arOpenItems(), bridge().apOpenItems()]);
    }).then(function (r) {
      V2.ar = r[0]; V2.ap = r[1].rows; V2.vendors = r[1].vendors;
      return true;
    });
    return _loaded;
  }
  function load() {
    _loaded = null;
    return ensureLoaded().then(render).catch(function (e) { console.error('[finance-openitems-v2] load', e); });
  }

  // ── Render ────────────────────────────────────────────────────────────────
  function rowsFor(lens) {
    var rows = lens === 'ar' ? V2.ar : V2.ap;
    if (V2.bucket !== 'all') rows = rows.filter(function (r) { return r.bucket === V2.bucket; });
    return rows;
  }
  function counts(rows) {
    var c = { all: rows.length, current: 0, '1_to_30': 0, '31_to_60': 0, '61_to_90': 0, '90_plus': 0 };
    rows.forEach(function (r) { c[r.bucket] = (c[r.bucket] || 0) + 1; });
    return c;
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

  function arColumns() {
    var canEdit = can('finance-ar', 'edit');
    return [
      { key: 'invoiceNumber', label: 'Invoice', render: function (r) { return esc(r.invoiceNumber || r.orderId.slice(-8)) + (r.wholesale ? ' ' + U.badge('wholesale', 'info') : ''); } },
      { key: 'customerName', label: 'Customer', render: function (r) { return esc(r.customerName || r.customerEmail || '—'); } },
      { key: 'dueDate', label: 'Due', render: function (r) { return esc(r.dueDate || '—'); } },
      { key: 'daysOverdue', label: 'Days over', align: 'right', render: function (r) { return r.daysOverdue > 0 ? '<span style="color:var(--danger);">' + r.daysOverdue + '</span>' : '—'; } },
      { key: 'amtDue', label: 'Amount due', align: 'right', render: function (r) { return m(r.amtDue); } },
      { key: '_act', label: '', sortable: false, align: 'right', render: function (r) {
          if (!canEdit) return '';
          var sent = V2.reminded[r.orderId];
          return '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 9px;" ' + (sent ? 'disabled' : '') +
            ' onclick="event.stopPropagation();OpenItemsV2.remind(\'' + esc(r.orderId) + '\')">' + (sent ? 'Queued ✓' : 'Remind') + '</button> ' +
            '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 9px;" onclick="event.stopPropagation();OpenItemsV2.markArPaid(\'' + esc(r.orderId) + '\')">Paid ✓</button>';
        } }
    ];
  }
  function apColumns() {
    var canEdit = can('finance-ap', 'edit');
    return [
      { key: 'vendorName', label: 'Vendor', render: function (r) { return esc(r.vendorName); } },
      { key: 'vendorInvoiceRef', label: 'Ref', render: function (r) { return esc(r.vendorInvoiceRef || '—'); } },
      { key: 'dueDate', label: 'Due', render: function (r) { return esc(r.dueDate || '—'); } },
      { key: 'daysOverdue', label: 'Days over', align: 'right', render: function (r) { return r.daysOverdue > 0 ? '<span style="color:var(--danger);">' + r.daysOverdue + '</span>' : '—'; } },
      { key: 'paymentStatus', label: 'Status', render: function (r) { return U.badge(r.paymentStatus, r.paymentStatus === 'partial' ? 'amber' : 'neutral'); } },
      { key: 'amtDue', label: 'Amount due', align: 'right', render: function (r) { return m(r.amtDue); } },
      { key: '_act', label: '', sortable: false, align: 'right', render: function (r) {
          if (!canEdit) return '';
          return '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 9px;" onclick="event.stopPropagation();OpenItemsV2.markBillPaid(\'' + esc(r.receiptId) + '\')">Paid ✓</button>';
        } }
    ];
  }
  function vendorColumns() {
    return [
      { key: 'name', label: 'Vendor', render: function (r) { return esc(r.name || '(no name)'); } },
      { key: 'contactName', label: 'Contact', render: function (r) { return esc(r.contactName || '—'); } },
      { key: 'email', label: 'Email', render: function (r) { return esc(r.email || '—'); } },
      { key: 'defaultPaymentTerms', label: 'Terms', render: function (r) { return esc(r.defaultPaymentTerms || '—'); } },
      { key: '_open', label: 'Open bills', align: 'right', render: function (r) {
          var n = V2.ap.filter(function (b) { return b.vendorId === r._vid; }).length;
          return n ? String(n) : '—';
        } }
    ];
  }

  function render() {
    var tab = ensureTab();
    var lens = V2.lens;
    var isVendors = lens === 'vendors';
    var rows = isVendors ? Object.entries(V2.vendors).map(function (kv) { return Object.assign({ _vid: kv[0] }, kv[1]); }) : rowsFor(lens);
    var allRows = isVendors ? rows : (lens === 'ar' ? V2.ar : V2.ap);
    var c = isVendors ? null : counts(allRows);
    var totalDue = isVendors ? 0 : allRows.reduce(function (s, r) { return s + r.amtDue; }, 0);

    var lensPills = pills([
      ['ar', 'Invoices', V2.ar.length],
      ['ap', 'Bills', V2.ap.length],
      ['vendors', 'Vendors', Object.keys(V2.vendors).length],
      ['reminders', 'Reminders', (V2.reminderLog || []).length || null]
    ], lens, 'OpenItemsV2.setLens');
    var bucketPills = isVendors ? '' : pills(BUCKETS.map(function (b) { return [b[0], b[1], c[b[0]] || 0]; }), V2.bucket, 'OpenItemsV2.setBucket');

    var actions = '<button class="btn btn-secondary" onclick="OpenItemsV2.exportCsv()">↓ Export</button>';
    if (can('finance-ap', 'edit')) {
      actions = '<button class="btn btn-primary" onclick="OpenItemsV2.newBill()">+ New bill</button>' +
        '<button class="btn btn-secondary" onclick="OpenItemsV2.newVendor()">+ New vendor</button>' + actions;
    }
    var sub = isVendors
      ? N.count(rows.length) + ' vendor(s)'
      : m(totalDue) + ' open · ' + N.count(allRows.length) + ' item(s)';
    if (lens === 'ar') {
      actions = '<button class="btn btn-secondary" onclick="OpenItemsV2.setLens(\'reminders\')">Reminders &amp; dunning</button>' + actions;
    }

    if (lens === 'reminders') {
      tab.innerHTML =
        U.pageHeader({ title: 'Invoices & Bills', count: 'Automated reminders — settings & history', actionsHtml: '<button class="btn btn-secondary" onclick="OpenItemsV2.refreshReminders()">Refresh</button>' }) +
        '<div style="margin:14px 0 6px;">' + lensPills + '</div><div style="margin:0 0 14px;"></div>' +
        '<div id="oiV2Reminders">' + remindersHtml() + '</div>';
      if (!V2.dunning || !V2.reminderLog) loadReminders();
      return;
    }

    var entityKey = lens === 'ar' ? 'orders-v2' : (isVendors ? 'ap-vendors-v2' : 'ap-bills-v2');
    var columnsFn = lens === 'ar' ? arColumns : (isVendors ? vendorColumns : apColumns);
    tab.innerHTML =
      U.pageHeader({ title: 'Invoices & Bills', count: sub, actionsHtml: actions }) +
      '<div style="margin:14px 0 6px;">' + lensPills + '</div>' +
      (bucketPills ? '<div style="margin:0 0 14px;">' + bucketPills + '</div>' : '<div style="margin:0 0 14px;"></div>') +
      MastEntity.renderList(entityKey, {
        columns: columnsFn(),
        rows: rows,
        rowId: lens === 'ar' ? function (r) { return r.orderId; }
          : (isVendors ? function (r) { return r._vid; } : function (r) { return r.receiptId; }),
        onRowClickFnName: 'OpenItemsV2.open',
        empty: isVendors
          ? { title: 'No vendors yet', message: 'Add the suppliers you buy from.' }
          : { title: 'Nothing outstanding', message: lens === 'ar' ? 'No open invoices — everyone has paid up.' : 'No open bills — nothing owed right now.' }
      });
  }

  // ── Reminders lens (dunning settings + audit log) ─────────────────────────
  function remindersHtml() {
    var d = V2.dunning, log = V2.reminderLog;
    if (!d || !log) return '<div style="color:var(--warm-gray);font-size:0.85rem;padding:20px 0;">Loading…</div>';
    var canEdit = can('finance-ar', 'edit');
    function ck(id, checked, label, body) {
      return '<label style="display:flex;align-items:flex-start;gap:10px;padding:5px 0;cursor:pointer;">' +
        '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + (canEdit ? '' : ' disabled') + ' style="margin-top:3px;">' +
        '<span><span style="font-size:0.85rem;font-weight:600;">' + label + '</span>' +
        (body ? '<br><span style="font-size:0.78rem;color:var(--warm-gray);">' + body + '</span>' : '') + '</span></label>';
    }
    var settings = U.card('Dunning settings',
      ck('oiDunEnabled', d.enabled, 'Enable automated reminders', 'The daily reminder job queues an email for every overdue invoice matching the cadence below (subject to per-customer opt-out on the customer record).') +
      '<div style="font-weight:600;font-size:0.85rem;margin:12px 0 4px;">Reminder cadence (days past due)</div>' +
      ck('oiDun1d', d.cadence['1d'], '1 day overdue', null) +
      ck('oiDun7d', d.cadence['7d'], '7 days overdue', null) +
      ck('oiDun30d', d.cadence['30d'], '30 days overdue', null) +
      (canEdit
        ? '<div style="display:flex;justify-content:flex-end;margin-top:12px;"><button class="btn btn-primary" onclick="OpenItemsV2.saveDunning()">Save settings</button></div>'
        : '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:12px;">Finance write access required to change settings.</div>'),
      { fill: true });
    var logHtml = log.length
      ? U.relatedTable([
          { label: 'Sent', render: function (r) { return esc((r.sentAt || '').replace('T', ' ').slice(0, 16)); } },
          { label: 'Invoice #', render: function (r) { return esc(r.invoiceNumber || (r.invoiceId ? r.invoiceId.slice(-8) : '—')); } },
          { label: 'Customer email', render: function (r) { return esc(r.customerEmail || '—'); } },
          { label: 'Amount due', align: 'right', render: function (r) { return m(r.amtDueCents || 0); } },
          { label: 'Status', render: function (r) { return U.badge(r.status || 'queued', r.status === 'sent' ? 'teal' : 'neutral'); } },
          { label: 'Sent by', render: function (r) { return esc(r.sentBy || '—'); } }
        ], log)
      : '<div style="color:var(--warm-gray);font-size:0.85rem;">No reminders sent yet. Use Send reminder on an overdue invoice, or enable the cadence above.</div>';
    return '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:14px;align-items:start;">' +
      settings + U.card('Reminder history (' + log.length + ')', logHtml, { fill: true }) + '</div>';
  }

  function loadReminders() {
    return MastAdmin.loadModule('finance').then(function () {
      return Promise.all([bridge().arDunningConfig(), bridge().arReminderLog()]);
    }).then(function (r) {
      V2.dunning = r[0]; V2.reminderLog = r[1];
      var el = document.getElementById('oiV2Reminders');
      if (el) el.innerHTML = remindersHtml();
    }).catch(function (e) {
      console.error('[finance-openitems-v2] reminders load', e);
      var el = document.getElementById('oiV2Reminders');
      if (el) el.innerHTML = '<div style="color:var(--danger);padding:12px;">' + esc(e.message || String(e)) + '</div>';
    });
  }

  // ── Handlers ──────────────────────────────────────────────────────────────
  function findAr(orderId) { return V2.ar.filter(function (r) { return r.orderId === orderId; })[0]; }
  function findAp(receiptId) { return V2.ap.filter(function (r) { return r.receiptId === receiptId; })[0]; }

  window.OpenItemsV2 = {
    setLens: function (l) { V2.lens = l; V2.bucket = 'all'; render(); },
    setBucket: function (b) { V2.bucket = b; render(); },

    open: function (id) {
      if (V2.lens === 'ar') {
        var row = findAr(id); if (!row) return;
        MastAdmin.loadModule('orders-v2').then(function () {
          return MastDB.get('orders/' + id);
        }).then(function (o) {
          if (!o) { showToast('Order not found', true); return; }
          o.id = o.id || id;
          MastEntity.openRecord('orders-v2', o, 'read');
        }).catch(function (e) { console.error('[finance-openitems-v2] open ar', e); });
      } else if (V2.lens === 'vendors') {
        var v = Object.assign({ _vid: id }, V2.vendors[id] || {});
        MastEntity.openRecord('ap-vendors-v2', v, 'read');
      } else {
        var bill = findAp(id); if (!bill) return;
        billVendorOptions();
        MastEntity.openRecord('ap-bills-v2', prepBill(bill), 'read');
      }
    },
    openVendor: function (vid) {
      if (!vid || !V2.vendors[vid]) return;
      MastEntity.drill('ap-vendors-v2', vid);
    },

    remind: function (orderId) {
      if (!can('finance-ar', 'edit')) { showToast('Finance write access required.', true); return; }
      var row = findAr(orderId); if (!row) return;
      if (!row.customerEmail || row.customerEmail.indexOf('@') < 1) { showToast('No customer email on file for this invoice', true); return; }
      if (V2.busy[orderId]) return;
      V2.busy[orderId] = true;
      bridge().arQueueReminder(orderId, row).then(function (q) {
        V2.reminded[orderId] = true; delete V2.busy[orderId];
        showToast('Reminder queued for ' + q.to);
        render();
      }).catch(function (err) {
        delete V2.busy[orderId];
        showToast('Reminder failed: ' + (err.message || err), true);
      });
    },
    markArPaid: function (orderId) {
      if (!can('finance-ar', 'edit')) { showToast('Finance write access required.', true); return; }
      var row = findAr(orderId); if (!row) return;
      mastConfirm('Mark ' + (row.invoiceNumber || 'this invoice') + ' (' + m(row.amtDue) + ' due) as paid in full?', { title: 'Mark invoice paid', confirmLabel: 'Mark paid' }).then(function (ok) {
        if (!ok) return;
        bridge().arMarkPaid(orderId, row.totalCents).then(function () { showToast('Invoice marked as paid'); load(); })
          .catch(function (err) { showToast('Error: ' + (err.message || err), true); });
      });
    },

    markBillPaid: function (receiptId) {
      if (!can('finance-ap', 'edit')) { showToast('Finance write access required.', true); return; }
      var bill = findAp(receiptId); if (!bill) return;
      mastConfirm('Mark the ' + bill.vendorName + ' bill (' + m(bill.amtDue) + ' due) as paid in full?', { title: 'Mark bill paid', confirmLabel: 'Mark paid' }).then(function (ok) {
        if (!ok) return;
        bridge().apMarkPaid(receiptId, bill.totalCents).then(function () {
          showToast('Bill marked as paid');
          try { MastUI.slideOut.requestClose(); } catch (_) {}
          load();
        }).catch(function (err) { showToast('Error: ' + (err.message || err), true); });
      });
    },
    recordPayment: function (receiptId) {
      if (!can('finance-ap', 'edit')) { showToast('Finance write access required.', true); return; }
      var bill = findAp(receiptId); if (!bill) return;
      var inp = document.getElementById('oiPayAmt');
      var amount = inp ? parseFloat(inp.value) : NaN;
      if (isNaN(amount) || amount <= 0) { showToast('Enter a valid payment amount', true); return; }
      bridge().apRecordPayment(receiptId, bill.paidCents, bill.totalCents, Math.round(amount * 100)).then(function (st) {
        showToast(st === 'paid' ? 'Bill fully paid' : 'Partial payment recorded');
        try { MastUI.slideOut.requestClose(); } catch (_) {}
        load();
      }).catch(function (err) { showToast('Error: ' + (err.message || err), true); });
    },
    deleteBill: function (receiptId) {
      if (!can('finance-ap', 'delete')) { showToast('Finance delete access required.', true); return; }
      var bill = findAp(receiptId); if (!bill) return;
      if (bill.poId) { showToast('This bill is linked to a purchase order — manage it via Procurement.', true); return; }
      if (bill.paymentStatus !== 'unpaid') { showToast('Only unpaid bills can be deleted (paid bills are the audit trail).', true); return; }
      mastConfirm('Delete the ' + bill.vendorName + ' bill (' + m(bill.totalCents) + ')? This cannot be undone.', { title: 'Delete bill', confirmLabel: 'Delete', danger: true }).then(function (ok) {
        if (!ok) return;
        bridge().apDeleteBill(receiptId).then(function () {
          showToast('Bill deleted');
          try { MastUI.slideOut.requestClose(); } catch (_) {}
          load();
        }).catch(function (err) { showToast('Delete failed: ' + (err.message || err), true); });
      });
    },

    newBill: function () {
      if (!can('finance-ap', 'edit')) { showToast('Finance write access required.', true); return; }
      billVendorOptions();
      MastEntity.openRecord('ap-bills-v2', { paymentStatus: 'unpaid' }, 'create');
    },
    newVendor: function () {
      if (!can('finance-ap', 'edit')) { showToast('Finance write access required.', true); return; }
      MastEntity.openRecord('ap-vendors-v2', {}, 'create');
    },

    exportCsv: function () {
      var lens = V2.lens;
      var rows, name;
      if (lens === 'vendors') {
        rows = [['Vendor', 'Contact', 'Email', 'Terms']].concat(Object.values(V2.vendors).map(function (v) { return [v.name || '', v.contactName || '', v.email || '', v.defaultPaymentTerms || '']; }));
        name = 'vendors';
      } else if (lens === 'ar') {
        rows = [['Invoice', 'Customer', 'Due', 'DaysOver', 'AmountDueCents']].concat(rowsFor('ar').map(function (r) { return [r.invoiceNumber || r.orderId, r.customerName, r.dueDate || '', r.daysOverdue, r.amtDue]; }));
        name = 'ar-aging';
      } else {
        rows = [['Vendor', 'Ref', 'Due', 'DaysOver', 'Status', 'AmountDueCents']].concat(rowsFor('ap').map(function (r) { return [r.vendorName, r.vendorInvoiceRef || '', r.dueDate || '', r.daysOverdue, r.paymentStatus, r.amtDue]; }));
        name = 'ap-aging';
      }
      bridge().downloadCsv('openitems-' + name, rows, 'As of today');
    },
    refreshReminders: function () { V2.dunning = null; V2.reminderLog = null; render(); },
    saveDunning: function () {
      if (!can('finance-ar', 'edit')) { showToast('Finance write access required.', true); return; }
      function on(id) { var n = document.getElementById(id); return !!(n && n.checked); }
      bridge().arSaveDunningSettings({
        enabled: on('oiDunEnabled'),
        cadence: { '1d': on('oiDun1d'), '7d': on('oiDun7d'), '30d': on('oiDun30d') }
      }).then(function () {
        showToast('Dunning settings saved');
        return loadReminders();
      }).catch(function (e) { showToast('Save failed: ' + (e.message || e), true); });
    }
  };

  // Vendor select options refresh (per render — vendors can change).
  function billVendorOptions() {
    var s = MastEntity.get('ap-bills-v2'); if (!s) return;
    var f = s.fields.filter(function (x) { return x.name === 'vendorId'; })[0]; if (!f) return;
    f.options = [{ value: '', label: '— Choose vendor —' }].concat(
      Object.entries(V2.vendors).map(function (kv) { return { value: kv[0], label: (kv[1] && kv[1].name) || '(no name)' }; })
        .sort(function (a, b) { return a.label < b.label ? -1 : 1; }));
  }

  // Both routes land in the SAME queue; the route picks the entry lens.
  function setupFor(lens) {
    return function () {
      ensureTab();
      V2.lens = lens; V2.bucket = 'all';
      MastAdmin.loadModule('finance')
        .then(function () { return MastAdmin.loadModule('orders-v2'); })
        .then(function () { defineEntities(); return load(); })
        .catch(function (e) { console.error('[finance-openitems-v2] setup', e); });
    };
  }
  MastAdmin.registerModule('finance-openitems-v2', {
    routes: {
      'finance-ar-v2': { tab: 'financeOpenItemsV2Tab', setup: setupFor('ar') },
      'finance-ap-v2': { tab: 'financeOpenItemsV2Tab', setup: setupFor('ap') }
    }
  });
})();
