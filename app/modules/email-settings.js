// app/modules/email-settings.js  (T1 extraction)
//
// Email Settings sub-tab: the email inner-tab switcher (provider / triggers) and
// the Email Triggers surface — the EMAIL_TRIGGER_REGISTRY catalog, per-module
// collapse state, load/render of the trigger list, the toggle-all / per-module /
// per-trigger enable controls, the trigger-name lookup, and the lazy-load shims for
// the email preview drawer. Extracted byte-identical from the inline block in
// index.html (four hardcoded hex colors re-expressed as rgba() — one standalone +
// three var(--token,#fallback) fallbacks — to keep the module clean against
// lint-ux-standards; behavior unchanged). EMAIL_TRIGGER_REGISTRY, escAttrGlobal and
// emailTriggerPrefs are read at runtime by the email-log and email-preview-drawer
// modules; they (and the rest of this cluster) remain window globals — the inline
// block is not an IIFE — so those modules, the email inner-tab onclick handlers, and
// the Settings-route email-tab dispatch all resolve them post-load.

// ============================================================
// Email Inner Tab Switching
// ============================================================
function switchEmailInnerTab(tab) {
  var providerEl = document.getElementById('emailInnerProvider');
  var triggersEl = document.getElementById('emailInnerTriggers');
  if (providerEl) providerEl.style.display = tab === 'provider' ? '' : 'none';
  if (triggersEl) triggersEl.style.display = tab === 'triggers' ? '' : 'none';
  document.querySelectorAll('#emailInnerTabs .view-tab').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });
  if (tab === 'triggers') { loadEmailTriggers(); }
  if (typeof refreshEmailTabStatus === 'function') refreshEmailTabStatus();
}
window.switchEmailInnerTab = switchEmailInnerTab;

// ============================================================
// Email Triggers Settings
// ============================================================

var EMAIL_TRIGGER_REGISTRY = [
  // ---- Orders ----
  // emailType values match what writeEmailLog actually persists (full
  // 'order_*' names, not the historical short 'confirmed'/'shipped' aliases).
  { id: 'order_confirmed', module: 'Orders', name: 'Order Confirmation', description: 'Sent when an order is confirmed after payment.', auto: true, emailType: 'order_confirmed' },
  { id: 'order_shipped', module: 'Orders', name: 'Order Shipped', description: 'Sent automatically when order status changes to shipped.', auto: true, emailType: 'order_shipped' },
  { id: 'order_delivered', module: 'Orders', name: 'Order Delivered', description: 'Sent when order is marked as delivered.', auto: false, emailType: 'order_delivered' },
  { id: 'order_cancelled', module: 'Orders', name: 'Order Cancelled', description: 'Sent when an order is cancelled.', auto: true, emailType: 'order_cancelled' },
  // ---- Returns / RMA ----
  { id: 'rma_approved', module: 'Returns', name: 'Return Approved', description: 'Sent when a return request is approved with return instructions.', auto: true, emailType: 'rma_approved' },
  { id: 'rma_refund', module: 'Returns', name: 'Refund Issued', description: 'Sent when a refund is processed for a return.', auto: true, emailType: 'rma_refund' },
  // ---- Classes (formerly "Booking") ----
  { id: 'enrollment_confirmed', module: 'Classes', name: 'Enrollment Confirmation', description: 'Sent when a student enrolls in a class.', auto: true, emailType: 'enrollment_confirmed' },
  { id: 'session_cancelled', module: 'Classes', name: 'Session Cancelled', description: 'Sent to all enrolled students when a class session is cancelled.', auto: true, emailType: 'session_cancelled' },
  { id: 'enrollment_cancelled', module: 'Classes', name: 'Enrollment Cancelled', description: 'Sent when a student\'s enrollment is cancelled.', auto: true, emailType: 'enrollment_cancelled' },
  { id: 'enrollment_noshow', module: 'Classes', name: 'No-Show Notification', description: 'Sent when a student is marked as no-show for a class session.', auto: true, emailType: 'enrollment_noshow' },
  { id: 'waitlist_promoted', module: 'Classes', name: 'Waitlist Promoted', description: 'Sent when a waitlisted student gets a spot in a class.', auto: true, emailType: 'waitlist_promoted' },
  { id: 'session_rescheduled', module: 'Classes', name: 'Session Rescheduled', description: 'Sent to enrolled students when a class session date/time changes.', auto: true, emailType: 'session_rescheduled' },
  { id: 'walkin_confirmed', module: 'Classes', name: 'Walk-In Confirmation', description: 'Sent to walk-in students after being added to a class.', auto: true, emailType: 'walkin_confirmed' },
  { id: 'class_reminder', module: 'Classes', name: 'Class Reminder', description: 'Sent to enrolled students before a class session as a reminder.', auto: true, emailType: 'class_reminder' },
  // ---- Commissions ----
  { id: 'commission_inquiry', module: 'Commissions', name: 'Commission Inquiry', description: 'Sent to the shop owner when a customer submits a commission request.', auto: true, emailType: 'commission_inquiry' },
  { id: 'commission_proposal', module: 'Commissions', name: 'Commission Proposal', description: 'Sent to the customer with pricing and details for a commission piece.', auto: false, emailType: 'commission_proposal' },
  { id: 'commission_notify', module: 'Commissions', name: 'Commission Update', description: 'Sent to the customer when there is an update on their commission piece.', auto: true, emailType: 'commission_notify' },
  // ---- Reviews ----
  { id: 'review_submitted', module: 'Reviews', name: 'Review Submitted', description: 'Acknowledgement sent to the customer after they submit a product review.', auto: true, emailType: 'review_submitted' },
  // ---- Surveys ----
  { id: 'survey_invite', module: 'Surveys', name: 'Survey Invitation', description: 'Sent to invite a customer to complete a satisfaction or feedback survey.', auto: true, emailType: 'survey_invite' },
  // ---- Contacts ----
  { id: 'inquiry_response', module: 'Contacts', name: 'Inquiry Response', description: 'Manual reply sent to a customer who submitted a contact form inquiry.', auto: false, emailType: 'inquiry_response' },
  // ---- POS ----
  { id: 'pos_receipt', module: 'POS', name: 'POS Receipt', description: 'Email receipt sent from the point-of-sale system after a transaction.', auto: false, emailType: 'receipt' },
  // ---- Team ----
  { id: 'team_invite', module: 'Team', name: 'Team Invite', description: 'Sent when inviting a new team member to join the admin dashboard.', auto: false, emailType: 'team_invite' },
  // ---- Waivers ----
  { id: 'waiver_confirmation', module: 'Waivers', name: 'Waiver Confirmation', description: 'Sent to confirm a signed liability waiver for a class or event.', auto: true, emailType: 'waiver_confirmation' }
];

var emailTriggersLoaded = false;
var emailTriggerPrefs = {};

function escAttrGlobal(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function loadEmailTriggers() {
  var container = document.getElementById('emailTriggersContent');
  if (!container) return;

  // Load saved preferences from Firebase
  MastDB.get('config/emailTriggers').then(function(val) {
    emailTriggerPrefs = val || {};
    emailTriggersLoaded = true;
    renderEmailTriggers();
    if (typeof refreshEmailTabStatus === 'function') refreshEmailTabStatus();
  }).catch(function(err) {
    console.error('Failed to load email trigger prefs:', err);
    emailTriggersLoaded = true;
    renderEmailTriggers();
    if (typeof refreshEmailTabStatus === 'function') refreshEmailTabStatus();
  });
}

var emailModuleCollapsed = {};

function renderEmailTriggers() {
  var container = document.getElementById('emailTriggersContent');
  if (!container) return;

  // Group triggers by module
  var modules = {};
  EMAIL_TRIGGER_REGISTRY.forEach(function(t) {
    if (!modules[t.module]) modules[t.module] = [];
    modules[t.module].push(t);
  });

  var moduleOrder = ['Orders', 'Returns', 'Booking', 'Commissions', 'Contacts', 'POS', 'Team', 'Waivers'];
  var moduleIcons = { Orders: '\uD83D\uDCE6', Returns: '\u21A9\uFE0F', Booking: '\uD83D\uDCC5', Commissions: '\uD83C\uDFA8', Contacts: '\uD83D\uDCEC', POS: '\uD83D\uDCF1', Team: '\uD83D\uDC65', Waivers: '\uD83D\uDCDD' };

  // Global pill
  var totalTriggers = EMAIL_TRIGGER_REGISTRY.length;
  var totalEnabled = EMAIL_TRIGGER_REGISTRY.filter(function(t) { return emailTriggerPrefs[t.id] !== false; }).length;
  var allOn = totalEnabled === totalTriggers;
  var pillEl = document.getElementById('emailTriggersGlobalPill');
  if (pillEl) {
    var pillColor = totalEnabled === 0 ? 'rgba(120,120,120,0.7)' : allOn ? 'var(--teal)' : 'rgba(42,124,111,0.5)';
    pillEl.innerHTML = '<span onclick="toggleAllEmailTriggers()" style="font-size:0.78rem;color:rgba(255,255,255,1);background:' + pillColor + ';padding:5px 14px;border-radius:12px;font-weight:600;cursor:pointer;transition:background 0.15s ease;user-select:none;" title="Toggle all email triggers">' + totalEnabled + '/' + totalTriggers + ' on</span>';
  }

  var h = '';

  moduleOrder.forEach(function(mod) {
    var triggers = modules[mod];
    if (!triggers || triggers.length === 0) return;
    var collapsed = !!emailModuleCollapsed[mod];
    var chevron = collapsed ? '\u25B8' : '\u25BE';
    var enabledCount = triggers.filter(function(t) { return emailTriggerPrefs[t.id] !== false; }).length;

    h += '<div style="margin-bottom:16px;border:1px solid var(--cream-dark);border-radius:12px;overflow:hidden;">';

    // Collapsible header
    h += '<div onclick="toggleEmailModule(\'' + mod + '\')" style="display:flex;align-items:center;gap:8px;padding:12px 16px;cursor:pointer;background:var(--cream);user-select:none;transition:background 0.15s ease;" onmouseover="this.style.background=\'var(--cream-dark)\'" onmouseout="this.style.background=\'var(--cream)\'">';
    h += '<span style="font-size:0.85rem;color:var(--warm-gray);width:12px;text-align:center;">' + chevron + '</span>';
    h += '<span style="font-size:1.0rem;">' + moduleIcons[mod] + '</span>';
    h += '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.15rem;color:var(--text,rgba(42,42,42,1));margin:0;flex:1;">' + mod + '</h3>';
    h += '<span onclick="event.stopPropagation();toggleEmailModuleTriggers(\'' + mod + '\')" style="font-size:0.72rem;color:var(--text,rgba(42,42,42,1));background:rgba(42,124,111,0.3);padding:3px 10px;border-radius:10px;font-weight:600;cursor:pointer;transition:background 0.15s ease;" onmouseover="this.style.background=\'rgba(42,124,111,0.5)\'" onmouseout="this.style.background=\'rgba(42,124,111,0.3)\'" title="Toggle all ' + mod + ' emails">' + enabledCount + '/' + triggers.length + ' on</span>';
    h += '</div>';

    // Collapsible body
    h += '<div id="emailTriggerModule_' + mod + '" style="' + (collapsed ? 'display:none;' : '') + '">';

    triggers.forEach(function(t) {
      var enabled = emailTriggerPrefs[t.id] !== false;
      var isAuto = t.auto;

      h += '<div style="padding:12px 16px;border-top:1px solid var(--cream-dark);transition:background 0.1s ease;" onmouseover="this.style.background=\'rgba(255,255,255,0.03)\'" onmouseout="this.style.background=\'none\'">';
      h += '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;">';

      // Left side: info + preview button
      h += '<div style="flex:1;min-width:0;">';
      h += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:3px;">';
      h += '<span style="font-weight:600;font-size:0.9rem;color:var(--text,rgba(42,42,42,1));">' + t.name + '</span>';
      if (isAuto) {
        h += '<span style="font-size:0.72rem;background:rgba(42,124,111,0.12);color:var(--teal);padding:1px 5px;border-radius:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;">Auto</span>';
      } else {
        h += '<span style="font-size:0.72rem;background:rgba(156,163,175,0.15);color:var(--warm-gray);padding:1px 5px;border-radius:3px;font-weight:600;text-transform:uppercase;letter-spacing:0.3px;">Manual</span>';
      }
      h += '</div>';
      h += '<p style="font-size:0.78rem;color:var(--warm-gray);margin:0 0 6px;line-height:1.35;">' + t.description + '</p>';
      h += '<button onclick="event.stopPropagation();openEmailPreviewDrawer(\'' + t.id + '\')" style="background:none;border:1px solid var(--cream-dark);color:var(--warm-gray);padding:3px 9px;border-radius:5px;font-size:0.72rem;cursor:pointer;font-family:\'DM Sans\',sans-serif;transition:all 0.15s ease;" onmouseover="this.style.borderColor=\'var(--teal)\';this.style.color=\'var(--teal)\'" onmouseout="this.style.borderColor=\'var(--cream-dark)\';this.style.color=\'var(--warm-gray)\'">';
      h += '\uD83D\uDC41 Preview</button>';
      h += '</div>';

      // Right side: toggle
      h += '<div style="flex-shrink:0;padding-top:2px;">';
      h += '<label style="position:relative;display:inline-block;width:42px;height:22px;cursor:pointer;">';
      h += '<input type="checkbox" ' + (enabled ? 'checked' : '') + ' onchange="toggleEmailTrigger(\'' + t.id + '\', this.checked)" style="opacity:0;width:0;height:0;position:absolute;">';
      // Off-state track: bump opacity to 0.7 so the toggle reads as a toggle
      // even when off (was 0.3 — the white thumb appeared to float on bare bg).
      h += '<span style="position:absolute;top:0;left:0;right:0;bottom:0;background:' + (enabled ? 'var(--teal)' : 'rgba(120,120,120,0.7)') + ';border-radius:22px;transition:background 0.2s ease;"></span>';
      h += '<span style="position:absolute;top:2px;left:' + (enabled ? '21px' : '2px') + ';width:18px;height:18px;background:white;border-radius:50%;transition:left 0.2s ease;box-shadow:0 1px 3px rgba(0,0,0,0.15);"></span>';
      h += '</label>';
      h += '</div>';

      h += '</div>'; // end flex row
      h += '</div>'; // end trigger row
    });

    h += '</div>'; // end collapsible body
    h += '</div>'; // end module card
  });

  container.innerHTML = h;
}

function toggleEmailModule(mod) {
  emailModuleCollapsed[mod] = !emailModuleCollapsed[mod];
  var el = document.getElementById('emailTriggerModule_' + mod);
  if (el) el.style.display = emailModuleCollapsed[mod] ? 'none' : '';
  // Update chevron in the header
  renderEmailTriggers();
}

function toggleAllEmailTriggers() {
  var anyOn = EMAIL_TRIGGER_REGISTRY.some(function(t) { return emailTriggerPrefs[t.id] !== false; });
  var newState = !anyOn;

  var updates = {};
  EMAIL_TRIGGER_REGISTRY.forEach(function(t) {
    updates['config/emailTriggers/' + t.id] = newState;
    emailTriggerPrefs[t.id] = newState;
  });

  MastDB.multiUpdate(updates).then(function() {
    showToast((newState ? 'Enabled' : 'Disabled') + ' all email triggers (' + EMAIL_TRIGGER_REGISTRY.length + ')');
    renderEmailTriggers();
  }).catch(function(err) {
    showToast('Failed to update: ' + err.message, true);
  });
}

function toggleEmailModuleTriggers(mod) {
  var triggers = EMAIL_TRIGGER_REGISTRY.filter(function(t) { return t.module === mod; });
  if (!triggers.length) return;

  // If any are on, turn all off. If all are off, turn all on.
  var anyOn = triggers.some(function(t) { return emailTriggerPrefs[t.id] !== false; });
  var newState = !anyOn;

  var updates = {};
  triggers.forEach(function(t) {
    updates['config/emailTriggers/' + t.id] = newState;
    emailTriggerPrefs[t.id] = newState;
  });

  MastDB.multiUpdate(updates).then(function() {
    showToast((newState ? 'Enabled' : 'Disabled') + ' all ' + mod + ' emails (' + triggers.length + ')');
    renderEmailTriggers();
  }).catch(function(err) {
    showToast('Failed to update: ' + err.message, true);
  });
}

function toggleEmailTrigger(triggerId, enabled) {
  // Save to Firebase
  var updates = {};
  updates['config/emailTriggers/' + triggerId] = enabled;
  MastDB.multiUpdate(updates).then(function() {
    emailTriggerPrefs[triggerId] = enabled;
    showToast((enabled ? 'Enabled' : 'Disabled') + ': ' + getTriggerName(triggerId));
    renderEmailTriggers();
  }).catch(function(err) {
    showToast('Failed to update: ' + err.message, true);
  });
}

function getTriggerName(triggerId) {
  var t = EMAIL_TRIGGER_REGISTRY.find(function(t) { return t.id === triggerId; });
  return t ? t.name : triggerId;
}

// ---- Email Preview Drawer ----

// Email preview drawer (openEmailPreviewDrawer / renderDrawerPreview /
// loadDrawerPreviewFromLog / closeEmailPreviewDrawer) extracted to
// app/modules/email-preview-drawer.js — lazy-loaded via these eager shims
// (the per-trigger "Preview" button is generated onclick; the drawer backdrop
// + close button are static markup). (Track 1.)
function openEmailPreviewDrawer(triggerId) {
  MastAdmin.loadModule('emailPreviewDrawer').then(function() {
    if (typeof window.openEmailPreviewDrawerImpl === 'function') window.openEmailPreviewDrawerImpl(triggerId);
  }).catch(function() {});
}
function closeEmailPreviewDrawer() {
  MastAdmin.loadModule('emailPreviewDrawer').then(function() {
    if (typeof window.closeEmailPreviewDrawerImpl === 'function') window.closeEmailPreviewDrawerImpl();
  }).catch(function() {});
}
