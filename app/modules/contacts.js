/**
 * Contacts Module — Contact Management & Google Contacts Integration
 * Lazy-loaded via MastAdmin module registry.
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var contactsData = [];
  var contactsLoaded = false;
  var selectedContactId = null;
  var contactInteractions = [];
  var contactInteractionsLoaded = false;
  var contactEditMode = false;     // Paradigm A — read-only until user clicks Edit
  var contactEditBaseline = null;  // snapshot for Cancel / dirty tracking

  var CONTACT_CATEGORIES = ['Supplier', 'Facilities', 'Gallery', 'Marketplace', 'Event Organizer', 'Partner', 'Student', 'Press', 'Other'];
  var INTERACTION_TYPES = ['Call', 'Email', 'Meeting', 'Site Visit', 'Payment', 'Signed Doc', 'Other'];

  // ============================================================
  // Badge Style Helpers (inline colors per style guide)
  // ============================================================

  var CONTACT_CAT_BADGE_COLORS = {
    supplier:         { bg: 'rgba(30,64,175,0.2)', color: '#64B5F6', border: 'rgba(30,64,175,0.35)' },
    facilities:       { bg: 'rgba(146,64,14,0.2)', color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    gallery:          { bg: 'rgba(91,33,182,0.2)', color: '#B39DDB', border: 'rgba(91,33,182,0.35)' },
    marketplace:      { bg: 'rgba(6,95,70,0.25)', color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    'event-organizer': { bg: 'rgba(157,23,77,0.2)', color: '#F48FB1', border: 'rgba(157,23,77,0.35)' },
    partner:          { bg: 'rgba(55,48,163,0.2)', color: '#7986CB', border: 'rgba(55,48,163,0.35)' },
    student:          { bg: 'rgba(15,118,110,0.2)', color: '#4DB6AC', border: 'rgba(15,118,110,0.35)' },
    press:            { bg: 'rgba(133,77,14,0.2)', color: '#FFD54F', border: 'rgba(133,77,14,0.35)' }
  };

  function contactCatBadgeStyle(category) {
    var key = (category || 'other').toLowerCase().replace(/\s+/g, '-');
    var c = CONTACT_CAT_BADGE_COLORS[key] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

  var INTERACTION_TYPE_BADGE_COLORS = {
    call:        { bg: 'rgba(30,64,175,0.2)', color: '#64B5F6', border: 'rgba(30,64,175,0.35)' },
    email:       { bg: 'rgba(6,95,70,0.25)', color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    meeting:     { bg: 'rgba(91,33,182,0.2)', color: '#B39DDB', border: 'rgba(91,33,182,0.35)' },
    'site-visit': { bg: 'rgba(146,64,14,0.2)', color: '#FFD54F', border: 'rgba(146,64,14,0.35)' },
    payment:     { bg: 'rgba(6,95,70,0.25)', color: '#4DB6AC', border: 'rgba(6,95,70,0.4)' },
    'signed-doc': { bg: 'rgba(157,23,77,0.2)', color: '#F48FB1', border: 'rgba(157,23,77,0.35)' },
    'web-inquiry': { bg: 'rgba(0,150,136,0.2)', color: '#80CBC4', border: 'rgba(0,150,136,0.35)' }
  };

  function interactionTypeBadgeStyle(type) {
    var key = (type || 'other').toLowerCase().replace(/\s+/g, '-');
    var c = INTERACTION_TYPE_BADGE_COLORS[key] || { bg: 'rgba(158,158,158,0.15)', color: '#BDBDBD', border: 'rgba(158,158,158,0.25)' };
    return 'background:' + c.bg + ';color:' + c.color + ';border:1px solid ' + c.border + ';';
  }

async function loadContacts() {
  var loading = document.getElementById('contactsLoading');
  loading.style.display = '';
  document.getElementById('contactsTableWrap').style.display = 'none';
  document.getElementById('contactsEmpty').style.display = 'none';
  try {
    var val = await MastDB.contacts.get();
    contactsData = val ? Object.values(val) : [];
    contactsData.sort(function(a, b) { return (a.name || '').localeCompare(b.name || ''); });

    // Pre-fetch last interaction for each contact
    for (var i = 0; i < contactsData.length; i++) {
      var c = contactsData[i];
      try {
        var iSnap = await MastDB.contacts.interactions(c.id)
          .orderByChild('date').limitToLast(1).once('value');
        var iVal = iSnap.val();
        c._lastInteraction = iVal ? Object.values(iVal)[0] : null;
      } catch (e) {
        c._lastInteraction = null;
      }
    }

    contactsLoaded = true;
    renderContacts();
  } catch (err) {
    console.error('Error loading contacts:', err);
    document.getElementById('contactsTableBody').innerHTML = '<tr><td colspan="4" style="color:var(--danger);padding:20px;">Error loading contacts.</td></tr>';
    document.getElementById('contactsTableWrap').style.display = '';
  } finally {
    loading.style.display = 'none';
  }
}

function renderContacts() {
  var searchText = (document.getElementById('contactsSearch').value || '').trim().toLowerCase();
  var catFilter = document.getElementById('contactsCategoryFilter').value;

  var filtered = contactsData.filter(function(c) {
    if (searchText && (c.name || '').toLowerCase().indexOf(searchText) === -1) return false;
    if (catFilter !== 'all' && c.category !== catFilter) return false;
    return true;
  });

  document.getElementById('contactsCount').textContent = filtered.length + ' of ' + contactsData.length + ' contacts';

  if (filtered.length === 0 && contactsData.length === 0) {
    document.getElementById('contactsEmpty').style.display = '';
    document.getElementById('contactsTableWrap').style.display = 'none';
    return;
  }

  document.getElementById('contactsEmpty').style.display = 'none';
  document.getElementById('contactsTableWrap').style.display = '';

  var tbody = document.getElementById('contactsTableBody');
  tbody.innerHTML = '';

  filtered.forEach(function(c) {
    var tr = document.createElement('tr');
    tr.onclick = function() { viewContact(c.id); };

    var lastInt = c._lastInteraction;
    var lastIntHtml = lastInt
      ? '<span class="contact-last-interaction"><span class="status-badge" style="' + interactionTypeBadgeStyle(lastInt.type) + '">' + esc(lastInt.type || '') + '</span> &mdash; ' + esc(lastInt.date || '') + '</span>'
      : '<span style="color:var(--warm-gray-light);font-size:0.85rem;">None</span>';

    var driveHtml = c.driveFolderLink
      ? '<a href="' + esc(c.driveFolderLink) + '" target="_blank" rel="noopener" onclick="event.stopPropagation();" title="Open Drive folder" style="font-size:1.15rem;">&#128193;</a>'
      : '';

    tr.innerHTML =
      '<td><strong>' + esc(c.name || '') + '</strong>' + (c.company ? '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(c.company) + '</div>' : '') + '</td>' +
      '<td style="font-size:0.85rem;">' + (c.email ? '<a href="mailto:' + esc(c.email) + '" onclick="event.stopPropagation();" style="color:var(--teal);">' + esc(c.email) + '</a>' : '<span style="color:var(--warm-gray-light);">—</span>') + '</td>' +
      '<td style="font-size:0.85rem;">' + (c.phone ? esc(c.phone) : '<span style="color:var(--warm-gray-light);">—</span>') + '</td>' +
      '<td><span class="status-badge" style="' + contactCatBadgeStyle(c.category) + '">' + esc(c.category || 'Other') + '</span></td>' +
      '<td>' + lastIntHtml + '</td>';
    tbody.appendChild(tr);
  });
}

function openAddContactModal() {
  var catOptions = CONTACT_CATEGORIES.map(function(c) {
    return '<option value="' + esc(c) + '">' + esc(c) + '</option>';
  }).join('');

  // If the caller (e.g., customers module) stashed a pending customer link,
  // pre-fill the name/email fields and default the category to 'customer'.
  var pending = window._pendingContactCustomerLink || null;
  var prefillName = (pending && pending.prefillName) || '';
  var prefillEmail = (pending && pending.prefillEmail) || '';
  var defaultCategory = pending ? 'customer' : '';

  var html = '' +
    '<div class="modal-header"><h3>Add Contact</h3></div>' +
    '<div class="modal-body">' +
      '<div class="form-group"><label class="field-required">Name</label><input type="text" id="contactNameInput" value="' + esc(prefillName) + '" placeholder="Company or person name"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div class="form-group"><label>Email</label><input type="email" id="contactEmailInput" value="' + esc(prefillEmail) + '" placeholder="email@example.com"></div>' +
        '<div class="form-group"><label>Phone</label><input type="tel" id="contactPhoneInput" placeholder="(555) 123-4567"></div>' +
      '</div>' +
      '<div class="form-group"><label>Company / Organization</label><input type="text" id="contactCompanyInput" placeholder="Company name"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div class="form-group"><label class="field-required">Category</label><select id="contactCategoryInput">' + catOptions + '</select></div>' +
        '<div class="form-group"><label>Website</label><input type="url" id="contactWebsiteInput" placeholder="https://..."></div>' +
      '</div>' +
      '<div class="form-group"><label>Address</label><input type="text" id="contactAddressInput" placeholder="Street, City, State ZIP"></div>' +
      '<div class="form-group"><label>Notes</label><textarea id="contactNotesInput" rows="2" placeholder="Optional notes about this contact"></textarea></div>' +
      '<div class="form-group"><label>Drive Folder Link</label><input type="text" id="contactDriveFolderInput" placeholder="https://drive.google.com/drive/folders/...">' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Paste an existing Google Drive folder link.</p></div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="cancelAddContactModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveNewContact()">Create Contact</button>' +
    '</div>';
  openModal(html);
  if (defaultCategory) {
    var sel = document.getElementById('contactCategoryInput');
    if (sel) {
      for (var i = 0; i < sel.options.length; i++) {
        if ((sel.options[i].value || '').toLowerCase() === defaultCategory) { sel.selectedIndex = i; break; }
      }
    }
  }
}

// Cancel handler — clears any pending customer-link hint so the next
// add-contact call doesn't accidentally reuse it. Does NOT popAndReturn —
// the user stays on the contacts list view; they can use the back button
// to return to the originating customer if they want.
function cancelAddContactModal() {
  window._pendingContactCustomerLink = null;
  closeModal();
}

async function saveNewContact() {
  var name = document.getElementById('contactNameInput').value.trim();
  var email = document.getElementById('contactEmailInput').value.trim();
  var phone = document.getElementById('contactPhoneInput').value.trim();
  var company = document.getElementById('contactCompanyInput').value.trim();
  var category = document.getElementById('contactCategoryInput').value;
  var website = document.getElementById('contactWebsiteInput').value.trim();
  var address = document.getElementById('contactAddressInput').value.trim();
  var notes = document.getElementById('contactNotesInput').value.trim();
  var driveFolderLink = document.getElementById('contactDriveFolderInput').value.trim();

  if (!name) { showToast('Contact name is required.', true); return; }

  var id = 'contact_' + Date.now().toString(36);
  var now = new Date().toISOString();
  var contactData = {
    id: id,
    name: name,
    email: email || null,
    phone: phone || null,
    company: company || null,
    category: category,
    website: website || null,
    address: address || null,
    notes: notes || null,
    googleContactId: null,
    driveFolderLink: driveFolderLink || null,
    createdAt: now,
    createdBy: currentUser ? currentUser.uid : 'unknown',
    updatedAt: now
  };

  try {
    // Check for a pending customer link BEFORE writing, so we can atomically
    // write the contact + customer.linkedIds + byContactId index in one go
    // (matches the legacy customers-module create path).
    var pending = window._pendingContactCustomerLink || null;

    if (pending && pending.customerId) {
      // Fetch current linkedIds.contactIds so we can append the new id.
      var custRef = MastDB.query('admin/customers/' + pending.customerId + '/linkedIds');
      var linkedSnap = await custRef.once('value');
      var linked = linkedSnap.val() || { uids: [], contactIds: [], studentIds: [], squareCustomerId: null };
      var contactIds = (linked.contactIds || []).slice();
      if (contactIds.indexOf(id) === -1) contactIds.push(id);

      var now2 = new Date().toISOString();
      var updates = {};
      updates['admin/contacts/' + id] = contactData;
      updates['admin/customers/' + pending.customerId + '/linkedIds/contactIds'] = contactIds;
      updates['admin/customers/' + pending.customerId + '/updatedAt'] = now2;
      updates['admin/customerIndexes/byContactId/' + id] = pending.customerId;
      await MastDB.multiUpdate(updates);
      await writeAudit('create', 'contacts', id);
      showToast('Contact created.');
      emitTestingEvent('createContact', {});
      closeModal();
      contactsLoaded = false;

      // Patch the customers module's in-memory linkedIds so the return
      // render immediately shows the new contact in the Contacts tab.
      // Also invalidates the per-customer contacts cache so the next render
      // refetches and picks up the new record.
      try {
        if (typeof window.customersAppendLinkedContact === 'function') {
          window.customersAppendLinkedContact(pending.customerId, id);
        }
      } catch (e) { /* non-fatal */ }

      // Clear the hint and pop the MastNavStack back to the originating
      // customer's Contacts tab.
      window._pendingContactCustomerLink = null;
      createGoogleContact(contactData);
      if (window.MastNavStack && MastNavStack.size() > 0) {
        MastNavStack.popAndReturn();
      } else {
        loadContacts();
      }
      return;
    }

    await MastDB.contacts.set(id, contactData);
    await writeAudit('create', 'contacts', id);
    showToast('Contact created.');
    emitTestingEvent('createContact', {});
    closeModal();
    contactsLoaded = false;
    loadContacts();

    // Try to create Google Contact in background
    createGoogleContact(contactData);
  } catch (err) {
    showToast('Error saving contact: ' + err.message, true);
  }
}

// ============================================================
// Edit Contact — Paradigm A (read-only detail with Edit toggle)
// ============================================================

function _contactEditIsDirty() {
  if (!contactEditMode || !contactEditBaseline) return false;
  var ids = ['contactDetailName','contactDetailEmail','contactDetailPhone','contactDetailCompany','contactDetailCategory','contactDetailWebsite','contactDetailAddress','contactDetailNotes','contactDetailDriveFolder'];
  for (var i = 0; i < ids.length; i++) {
    var el = document.getElementById(ids[i]);
    if (!el) continue;
    var key = ids[i].replace('contactDetail','');
    key = key.charAt(0).toLowerCase() + key.slice(1);
    if (key === 'driveFolder') key = 'driveFolderLink';
    var baseline = contactEditBaseline[key] || '';
    if ((el.value || '') !== baseline) return true;
  }
  return false;
}

async function enterContactEditMode() {
  if (!selectedContactId) return;
  try {
    var c = await MastDB.contacts.get(selectedContactId);
    if (!c) { showToast('Contact not found.', true); return; }
    contactEditBaseline = {
      name: c.name || '',
      email: c.email || '',
      phone: c.phone || '',
      company: c.company || '',
      category: c.category || 'Other',
      website: c.website || '',
      address: c.address || '',
      notes: c.notes || '',
      driveFolderLink: c.driveFolderLink || ''
    };
    contactEditMode = true;
    if (window.MastDirty) {
      MastDirty.register('contactEdit', _contactEditIsDirty, { label: 'Contact detail' });
    }
    renderContactDetail(c);
  } catch (err) {
    showToast('Error entering edit mode: ' + err.message, true);
  }
}

function cancelContactEditMode() {
  var doCancel = function() {
    contactEditMode = false;
    contactEditBaseline = null;
    if (window.MastDirty) MastDirty.unregister('contactEdit');
    loadContactDetail(selectedContactId);
  };
  if (window.MastDirty && MastDirty.getDirtyKeys && MastDirty.getDirtyKeys().indexOf('contactEdit') !== -1) {
    MastDirty.checkAndExit(doCancel);
  } else {
    doCancel();
  }
}

async function saveContactEditMode() {
  if (!selectedContactId) return;
  var name = (document.getElementById('contactDetailName') || {}).value;
  name = (name || '').trim();
  if (!name) { showToast('Contact name is required.', true); return; }

  var updates = {
    name: name,
    email: document.getElementById('contactDetailEmail').value.trim() || null,
    phone: document.getElementById('contactDetailPhone').value.trim() || null,
    company: document.getElementById('contactDetailCompany').value.trim() || null,
    category: document.getElementById('contactDetailCategory').value,
    website: document.getElementById('contactDetailWebsite').value.trim() || null,
    address: document.getElementById('contactDetailAddress').value.trim() || null,
    notes: document.getElementById('contactDetailNotes').value.trim() || null,
    driveFolderLink: document.getElementById('contactDetailDriveFolder').value.trim() || null,
    updatedAt: new Date().toISOString()
  };

  try {
    await MastDB.contacts.update(selectedContactId, updates);
    await writeAudit('update', 'contacts', selectedContactId);
    showToast('Contact updated.');
    contactsLoaded = false; // refresh list on back

    // Refresh baseline so dirty tracking clears, stay in edit mode (Paradigm A).
    contactEditBaseline = {
      name: updates.name,
      email: updates.email || '',
      phone: updates.phone || '',
      company: updates.company || '',
      category: updates.category,
      website: updates.website || '',
      address: updates.address || '',
      notes: updates.notes || '',
      driveFolderLink: updates.driveFolderLink || ''
    };
    loadContactDetail(selectedContactId);

    // Push changes to Google Contact in background
    var contact = await MastDB.contacts.get(selectedContactId);
    if (contact && contact.googleContactId) {
      pushContactToGoogle(contact);
    }
  } catch (err) {
    showToast('Error updating contact: ' + err.message, true);
  }
}

async function pushContactToGoogle(contact) {
  try {
    var connected = await isGoogleContactsConnected();
    if (!connected || !contact.googleContactId) return;

    var idToken = await currentUser.getIdToken();
    var tenantId = window.TENANT_ID || 'dev';

    var response = await fetch(GOOGLE_CONTACTS_FUNCTIONS_BASE + '/googleContactsUpdate', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId
      },
      body: JSON.stringify({
        resourceName: contact.googleContactId,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        company: contact.company,
        category: contact.category
      })
    });

    if (!response.ok) {
      console.error('Google contact update failed:', await response.text());
    }
  } catch (err) {
    console.error('Push to Google failed:', err);
  }
}

// ============================================================
// Contact Detail View
// ============================================================

var _viewContactReturnRoute = null;

function viewContact(contactId) {
  // Track where the user came from so back button returns there.
  // Prefer an explicit pending return route stashed by the caller (e.g.,
  // customers module) since by the time we get here currentRoute === 'contacts'.
  try {
    if (window._pendingContactReturnRoute) {
      _viewContactReturnRoute = window._pendingContactReturnRoute;
      window._pendingContactReturnRoute = null;
    } else {
      _viewContactReturnRoute = (typeof currentRoute === 'string' && currentRoute !== 'contacts') ? currentRoute : null;
    }
  } catch (e) { _viewContactReturnRoute = null; }
  selectedContactId = contactId;
  // Update back button label to reflect actual return destination.
  var backBtn = document.querySelector('#contactDetailView .detail-back');
  if (backBtn) {
    var label = _viewContactReturnRoute
      ? _viewContactReturnRoute.charAt(0).toUpperCase() + _viewContactReturnRoute.slice(1)
      : 'Contacts';
    backBtn.innerHTML = '\u2190 Back to ' + label;
  }
  document.getElementById('contactsListView').style.display = 'none';
  document.getElementById('contactDetailView').style.display = '';
  loadContactDetail(contactId);
}

function backToContactsList() {
  if (window.MastNavStack && MastNavStack.size() > 0) {
    selectedContactId = null;
    document.getElementById('contactDetailView').style.display = 'none';
    document.getElementById('contactsListView').style.display = '';
    MastNavStack.popAndReturn();
    return;
  }
  selectedContactId = null;
  if (_viewContactReturnRoute) {
    var route = _viewContactReturnRoute;
    _viewContactReturnRoute = null;
    document.getElementById('contactDetailView').style.display = 'none';
    document.getElementById('contactsListView').style.display = '';
    // Reset label for next visit
    var backBtn = document.querySelector('#contactDetailView .detail-back');
    if (backBtn) backBtn.innerHTML = '\u2190 Back to Contacts';
    if (typeof navigateTo === 'function') navigateTo(route);
    return;
  }
  document.getElementById('contactDetailView').style.display = 'none';
  document.getElementById('contactsListView').style.display = '';
  if (contactsLoaded) {
    contactsLoaded = false;
    loadContacts();
  }
}

async function loadContactDetail(contactId) {
  var container = document.getElementById('contactDetailContent');
  container.innerHTML = '<div class="loading" style="padding:40px;text-align:center;">Loading contact...</div>';

  try {
    // Load contact record
    var contact = await MastDB.contacts.get(contactId);
    if (!contact) {
      container.innerHTML = '<p style="color:var(--danger);">Contact not found.</p>';
      return;
    }

    // Load interactions
    var iSnap = await MastDB.contacts.interactions(contactId)
      .orderByChild('date').once('value');
    var iVal = iSnap.val();
    contactInteractions = iVal ? Object.values(iVal) : [];
    // Sort newest first
    contactInteractions.sort(function(a, b) { return (b.date || '').localeCompare(a.date || ''); });
    contactInteractionsLoaded = true;

    renderContactDetail(contact);
  } catch (err) {
    console.error('Error loading contact detail:', err);
    container.innerHTML = '<p style="color:var(--danger);">Error loading contact: ' + esc(err.message) + '</p>';
  }
}

function _contactDetailCardOpen(title) {
  var h = '<div style="background:var(--cream);border:1px solid var(--cream-dark);border-radius:8px;padding:16px 20px;margin-bottom:16px;">';
  if (title) h += '<div style="font-size:0.85rem;font-weight:600;margin-bottom:12px;">' + esc(title) + '</div>';
  return h;
}
function _contactDetailCardClose() { return '</div>'; }
function _contactDetailRow(label, valueHtml) {
  return '<div style="color:var(--warm-gray-light);">' + esc(label) + '</div>' +
         '<div>' + valueHtml + '</div>';
}

function renderContactDetail(contact) {
  var container = document.getElementById('contactDetailContent');
  var editing = !!contactEditMode;
  var inlineInputStyle = 'width:100%;padding:6px 10px;border:1px solid var(--cream-dark);border-radius:4px;background:var(--cream);font-family:DM Sans,sans-serif;font-size:0.85rem;';

  // ---- Header ----
  var headerActions = '';
  if (!editing) {
    headerActions += '<button class="btn btn-secondary btn-small" onclick="enterContactEditMode()">Edit</button>';
    if (contact.email) {
      headerActions += '<button class="btn btn-primary btn-small" onclick="openInquiryResponseModal(\'' + esc(contact.id) + '\')">Respond</button>';
    }
    headerActions += '<button class="btn btn-primary btn-small" onclick="openLogInteractionModal(\'' + esc(contact.id) + '\')">+ Log Interaction</button>';
  } else {
    headerActions += '<span style="font-size:0.72rem;color:var(--amber);font-weight:600;text-transform:uppercase;letter-spacing:0.04em;">Editing</span>';
  }

  var headerHtml = '' +
    '<div class="contact-detail-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;flex-wrap:wrap;margin-bottom:16px;">' +
      '<div>' +
        '<h2 class="contact-detail-name" style="margin:0;">' + esc(contact.name || '') + '</h2>' +
        '<div style="margin-top:6px;"><span class="status-badge" style="' + contactCatBadgeStyle(contact.category) + '">' + esc(contact.category || 'Other') + '</span></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;">' + headerActions + '</div>' +
    '</div>';

  // ---- Identity card ----
  function readField(val, linkPrefix) {
    if (!val) return '<span style="color:var(--warm-gray-light);">—</span>';
    if (linkPrefix === 'mailto:' || linkPrefix === 'tel:') {
      return '<a href="' + linkPrefix + esc(val) + '" style="color:var(--teal);">' + esc(val) + '</a>';
    }
    if (linkPrefix === 'http') {
      return '<a href="' + esc(val) + '" target="_blank" rel="noopener" style="color:var(--teal);">' + esc(val) + '</a>';
    }
    return esc(val);
  }

  var nameField, emailField, phoneField, companyField, categoryField, websiteField, addressField, notesField, driveField;
  if (editing) {
    nameField = '<input type="text" id="contactDetailName" value="' + esc(contact.name || '') + '" style="' + inlineInputStyle + '">';
    emailField = '<input type="email" id="contactDetailEmail" value="' + esc(contact.email || '') + '" style="' + inlineInputStyle + '">';
    phoneField = '<input type="tel" id="contactDetailPhone" value="' + esc(contact.phone || '') + '" style="' + inlineInputStyle + '">';
    companyField = '<input type="text" id="contactDetailCompany" value="' + esc(contact.company || '') + '" style="' + inlineInputStyle + '">';
    var catOptions = CONTACT_CATEGORIES.map(function(cat) {
      var sel = (cat === contact.category) ? ' selected' : '';
      return '<option value="' + esc(cat) + '"' + sel + '>' + esc(cat) + '</option>';
    }).join('');
    categoryField = '<select id="contactDetailCategory" style="' + inlineInputStyle + '">' + catOptions + '</select>';
    websiteField = '<input type="url" id="contactDetailWebsite" value="' + esc(contact.website || '') + '" style="' + inlineInputStyle + '">';
    addressField = '<input type="text" id="contactDetailAddress" value="' + esc(contact.address || '') + '" style="' + inlineInputStyle + '">';
    notesField = '<textarea id="contactDetailNotes" rows="3" style="' + inlineInputStyle + 'resize:vertical;">' + esc(contact.notes || '') + '</textarea>';
    driveField = '<input type="text" id="contactDetailDriveFolder" value="' + esc(contact.driveFolderLink || '') + '" placeholder="https://drive.google.com/..." style="' + inlineInputStyle + '">';
  } else {
    nameField = readField(contact.name);
    emailField = readField(contact.email, 'mailto:');
    phoneField = readField(contact.phone, 'tel:');
    companyField = readField(contact.company);
    categoryField = '<span class="status-badge" style="' + contactCatBadgeStyle(contact.category) + '">' + esc(contact.category || 'Other') + '</span>';
    websiteField = readField(contact.website, 'http');
    addressField = readField(contact.address);
    notesField = contact.notes ? esc(contact.notes) : '<span style="color:var(--warm-gray-light);">—</span>';
    driveField = contact.driveFolderLink
      ? '<a href="' + esc(contact.driveFolderLink) + '" target="_blank" rel="noopener" style="color:var(--teal);">&#128193; ' + esc(contact.driveFolderLink) + '</a>'
      : '<span style="color:var(--warm-gray-light);">—</span>';
  }

  var identityHtml = _contactDetailCardOpen('Identity') +
    '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">' +
      _contactDetailRow('Name', nameField) +
      _contactDetailRow('Email', emailField) +
      _contactDetailRow('Phone', phoneField) +
      _contactDetailRow('Company', companyField) +
      _contactDetailRow('Category', categoryField) +
      _contactDetailRow('Website', websiteField) +
      _contactDetailRow('Address', addressField) +
    '</div>' +
    _contactDetailCardClose();

  var notesCardHtml = _contactDetailCardOpen('Notes') +
    '<div style="font-size:0.85rem;white-space:pre-wrap;">' + notesField + '</div>' +
    _contactDetailCardClose();

  var googleSync = contact.googleContactId
    ? '<a href="https://contacts.google.com/person/' + esc(contact.googleContactId.replace('people/', '')) + '" target="_blank" rel="noopener" style="color:var(--teal);">&#128100; Synced</a>'
    : '<span style="color:var(--warm-gray-light);">Not synced</span>';
  var linksCardHtml = _contactDetailCardOpen('Links') +
    '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">' +
      _contactDetailRow('Drive folder', driveField) +
      _contactDetailRow('Google Contact', googleSync) +
    '</div>' +
    _contactDetailCardClose();

  function fmtDT(iso) { if (!iso) return '—'; try { return new Date(iso).toLocaleString(); } catch (e) { return iso; } }
  var recordCardHtml = _contactDetailCardOpen('Record') +
    '<div style="display:grid;grid-template-columns:160px 1fr;gap:8px 16px;font-size:0.85rem;">' +
      _contactDetailRow('Created', esc(fmtDT(contact.createdAt))) +
      _contactDetailRow('Created by', esc(contact.createdBy || '—')) +
      _contactDetailRow('Updated', esc(fmtDT(contact.updatedAt))) +
    '</div>' +
    _contactDetailCardClose();

  var saveCancelHtml = '';
  if (editing) {
    saveCancelHtml = '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:20px;padding-top:16px;border-top:1px solid var(--cream-dark);">' +
      '<button class="btn btn-secondary" onclick="cancelContactEditMode()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveContactEditMode()">Save</button>' +
    '</div>';
  }

  // Interaction timeline
  var timelineHtml = '<div class="interaction-timeline">';
  if (contactInteractions.length === 0) {
    timelineHtml += '<p style="color:var(--warm-gray);font-size:0.9rem;padding:20px 0;">No interactions logged yet.</p>';
  } else {
    timelineHtml += '<h3 style="font-size:1rem;margin-bottom:12px;">Interaction History (' + contactInteractions.length + ')</h3>';
    contactInteractions.forEach(function(inter) {
      // typeClass no longer needed — using inline styles
      var docsHtml = '';
      if (inter.documents && inter.documents.length) {
        docsHtml = '<div class="interaction-docs">';
        inter.documents.forEach(function(doc) {
          var sourceClass = (doc.source || 'studio');
          docsHtml += '<a class="interaction-doc-link" href="' + esc(doc.webViewLink || '#') + '" target="_blank" rel="noopener">' +
            '&#128196; ' + esc(doc.name || 'Document') +
            ' <span class="interaction-doc-source ' + sourceClass + '">' + esc(doc.source || 'studio') + '</span>' +
          '</a>';
        });
        docsHtml += '</div>';
      }

      var respondBtnHtml = '';
      if (contact.email || (contact.tags && contact.tags.indexOf('website-inquiry') >= 0)) {
        // Store interaction data for modal reference
        var interIdx = '_respInt_' + (inter.id || inter.date);
        window[interIdx] = inter;
        respondBtnHtml = '<button class="btn btn-primary" style="font-size:0.78rem;padding:4px 12px;margin-top:8px;" ' +
          'onclick="openInquiryResponseModal(\'' + esc(contact.id) + '\', \'' + esc(interIdx) + '\')">Respond</button>';
      }

      timelineHtml += '' +
        '<div class="interaction-card">' +
          '<div class="interaction-header">' +
            '<span class="interaction-date">' + esc(inter.date || '') + '</span>' +
            '<span class="status-badge" style="' + interactionTypeBadgeStyle(inter.type) + '">' + esc(inter.type || '') + '</span>' +
          '</div>' +
          (inter.notes ? '<div class="interaction-notes">' + esc(inter.notes) + '</div>' : '') +
          docsHtml +
          respondBtnHtml +
        '</div>';
    });
  }
  timelineHtml += '</div>';

  container.innerHTML = headerHtml + identityHtml + notesCardHtml + linksCardHtml + recordCardHtml + saveCancelHtml + timelineHtml;
}

function openLogInteractionModal(contactId) {
  var typeOptions = INTERACTION_TYPES.map(function(t) {
    return '<option value="' + esc(t) + '">' + esc(t) + '</option>';
  }).join('');

  var today = new Date().toISOString().slice(0, 10);
  var html = '' +
    '<div class="modal-header"><h3>Log Interaction</h3></div>' +
    '<div class="modal-body">' +
      '<div class="form-group"><label>Date</label><input type="date" id="interactionDateInput" value="' + today + '"></div>' +
      '<div class="form-group"><label>Type</label><select id="interactionTypeInput">' + typeOptions + '</select></div>' +
      '<div class="form-group"><label>Notes *</label><textarea id="interactionNotesInput" rows="4" placeholder="What happened? What was decided?"></textarea></div>' +
      '<div class="form-group">' +
        '<label>Attach Document (optional)</label>' +
        '<input type="text" id="interactionDriveUrlInput" placeholder="Paste Google Drive file URL">' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Paste a Drive URL to attach file metadata to this interaction.</p>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveInteraction(\'' + esc(contactId) + '\')">Log Interaction</button>' +
    '</div>';
  openModal(html);
}

async function saveInteraction(contactId) {
  var date = document.getElementById('interactionDateInput').value;
  var type = document.getElementById('interactionTypeInput').value;
  var notes = document.getElementById('interactionNotesInput').value.trim();
  var driveUrl = document.getElementById('interactionDriveUrlInput').value.trim();

  if (!notes) { showToast('Notes are required.', true); return; }
  if (!date) { showToast('Date is required.', true); return; }

  var documents = [];
  if (driveUrl) {
    // Try to fetch Drive file metadata
    var docMeta = await fetchDriveFileMetadata(driveUrl);
    if (docMeta) {
      docMeta.attachedBy = currentUser ? currentUser.uid : 'unknown';
      docMeta.source = 'studio';
      docMeta.notes = '';
      documents.push(docMeta);
    }
  }

  var interactionId = 'int_' + Date.now().toString(36);
  var interactionData = {
    id: interactionId,
    date: date,
    loggedBy: currentUser ? currentUser.uid : 'unknown',
    type: type,
    notes: notes,
    documents: documents,
    createdAt: new Date().toISOString()
  };

  try {
    await MastDB.contacts.interactions(contactId, interactionId).set(interactionData);
    await writeAudit('create', 'contacts', contactId);
    showToast('Interaction logged.');
    emitTestingEvent('logInteraction', {});
    closeModal();
    // Reload detail view
    loadContactDetail(contactId);
  } catch (err) {
    showToast('Error saving interaction: ' + err.message, true);
  }
}

// ============================================================
// Inquiry Response — Reply to web inquiries from admin
// ============================================================

async function openInquiryResponseModal(contactId, interactionKey, directInquiryId) {
  try {
    // Load contact
    var contact = await MastDB.contacts.get(contactId);
    if (!contact) { showToast('Contact not found.', true); return; }

    // Get the specific interaction if provided
    var specificInteraction = interactionKey ? window[interactionKey] : null;

    // Find the inquiry record — use direct ID if provided, else query by contactId
    var inquiry = null;
    if (directInquiryId) {
      var dirSnap = await MastDB.get('inquiries/' + directInquiryId);
      inquiry = dirSnap.val();
    }
    if (!inquiry) {
      var iqSnap = await MastDB.query('inquiries').orderByChild('contactId').equalTo(contactId).limitToLast(1).once('value');
      var iqVal = iqSnap.val();
      if (iqVal) {
        var keys = Object.keys(iqVal);
        inquiry = iqVal[keys[keys.length - 1]];
      }
    }

    // Use contact email, fall back to inquiry email
    var toEmail = contact.email || (inquiry && inquiry.email) || '';
    if (!toEmail) { showToast('No email address found for this contact.', true); return; }

    var brandName = (TENANT_CONFIG && TENANT_CONFIG.brand && TENANT_CONFIG.brand.name) || 'Our Shop';
    var brandEmail = (TENANT_CONFIG && TENANT_CONFIG.email && TENANT_CONFIG.email.from) || '';
    var brandPhone = '';
    try {
      var phoneSnap = await MastDB.get('config/brand/phone');
      brandPhone = phoneSnap.val() || '';
    } catch (e) { /* no phone */ }

    var firstName = (contact.name || '').split(' ')[0] || 'there';

    // Build subject and quoted content from the specific interaction or inquiry
    var replyContext = '';
    var subjectRef = '';
    if (specificInteraction) {
      subjectRef = specificInteraction.type || 'your message';
      replyContext = specificInteraction.notes || '';
    } else if (inquiry) {
      subjectRef = inquiry.type || 'your inquiry';
      replyContext = inquiry.message || '';
    } else {
      subjectRef = 'your message';
    }
    var originalDate = specificInteraction ? (specificInteraction.date || '') : (inquiry ? (inquiry.createdAt || '').slice(0, 10) : '');
    var inquiryId = inquiry ? (inquiry.id || '') : '';
    var subject = 'Re: ' + subjectRef + ' — ' + brandName;

    // Build signature
    var sigParts = [brandName];
    if (brandEmail) sigParts.push(brandEmail);
    if (brandPhone) sigParts.push(brandPhone);
    var signature = sigParts.join('\n');

    // Build default body template
    var bodyTemplate = 'Hi ' + firstName + ',\n\n' +
      'Thank you for reaching out to ' + brandName + '!\n\n' +
      '\n\n' +
      'Best regards,\n' + signature;

    if (replyContext) {
      bodyTemplate += '\n\n---\nOriginal message' + (originalDate ? ' (' + originalDate + ')' : '') + ':\n' + replyContext;
    }

    var html = '' +
      '<div class="modal-header"><h3>Respond to Inquiry</h3></div>' +
      '<div class="modal-body">' +
        '<div class="form-group"><label>To</label><input type="text" value="' + esc(toEmail) + '" readonly style="opacity:0.7;cursor:default;"></div>' +
        '<div class="form-group"><label>Subject</label><input type="text" id="inquiryResponseSubject" value="' + esc(subject) + '"></div>' +
        '<div class="form-group"><label>Message</label><textarea id="inquiryResponseBody" rows="12" style="font-family:monospace;font-size:0.85rem;white-space:pre-wrap;">' + esc(bodyTemplate) + '</textarea></div>' +
        '<input type="hidden" id="inquiryResponseContactId" value="' + esc(contactId) + '">' +
        '<input type="hidden" id="inquiryResponseInquiryId" value="' + esc(inquiryId) + '">' +
        '<input type="hidden" id="inquiryResponseToEmail" value="' + esc(toEmail) + '">' +
      '</div>' +
      '<div class="modal-footer">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" id="inquiryResponseSendBtn" onclick="sendInquiryResponse()">Send Response</button>' +
      '</div>';
    openModal(html);

    // Place cursor at the blank line (after "Thank you..." and before "Best regards")
    setTimeout(function() {
      var ta = document.getElementById('inquiryResponseBody');
      if (ta) {
        var pos = ta.value.indexOf('\n\n\n\n');
        if (pos > -1) { ta.selectionStart = ta.selectionEnd = pos + 2; }
        ta.focus();
      }
    }, 100);
  } catch (err) {
    console.error('Error opening inquiry response modal:', err);
    showToast('Error loading inquiry details: ' + err.message, true);
  }
}

async function sendInquiryResponse() {
  var subjectEl = document.getElementById('inquiryResponseSubject');
  var bodyEl = document.getElementById('inquiryResponseBody');
  var contactId = document.getElementById('inquiryResponseContactId').value;
  var inquiryId = document.getElementById('inquiryResponseInquiryId').value;
  var toEmail = document.getElementById('inquiryResponseToEmail').value;
  var sendBtn = document.getElementById('inquiryResponseSendBtn');

  var subject = subjectEl.value.trim();
  var body = bodyEl.value.trim();

  if (!subject) { showToast('Subject is required.', true); return; }
  if (!body) { showToast('Message body is required.', true); return; }

  sendBtn.disabled = true;
  sendBtn.textContent = 'Sending...';

  try {
    // Convert plain text body to HTML (preserve line breaks)
    var bodyHtml = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');

    // Call Cloud Function to send email
    var result = await firebase.functions().httpsCallable('sendInquiryResponse')({
      tenantId: MastDB.tenantId(),
      contactId: contactId,
      inquiryId: inquiryId,
      subject: subject,
      body: bodyHtml,
      toEmail: toEmail
    });

    // Record as interaction on the contact
    var interactionId = 'int_' + Date.now().toString(36);
    var now = new Date().toISOString();
    await MastDB.contacts.interactions(contactId, interactionId).set({
      id: interactionId,
      date: now.slice(0, 10),
      type: 'Email',
      notes: subject + ': ' + body.substring(0, 500),
      documents: [],
      loggedBy: currentUser ? currentUser.uid : 'unknown',
      createdAt: now
    });

    // Update inquiry status to 'responded'
    if (inquiryId) {
      await MastDB.set('inquiries/' + inquiryId + '/status', 'responded');
      await MastDB.set('inquiries/' + inquiryId + '/respondedAt', now);
    }

    showToast('Response sent to ' + toEmail);
    closeModal();

    // Refresh views
    if (contactId) loadContactDetail(contactId);
    if (typeof renderDashCardNewInquiries === 'function') renderDashCardNewInquiries();
  } catch (err) {
    console.error('Error sending inquiry response:', err);
    showToast('Failed to send: ' + (err.message || err), true);
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send Response';
  }
}

// ============================================================
// Google Contacts Integration (via Cloud Function proxy)
// ============================================================

var GOOGLE_CONTACTS_FUNCTIONS_BASE = 'https://us-central1-mast-platform-prod.cloudfunctions.net';

/**
 * Check if the current user has connected Google Contacts.
 * Reads {tenantId}/config/googleContacts/{uid} from RTDB.
 */
async function isGoogleContactsConnected() {
  if (!currentUser) return false;
  try {
    var snap = await MastDB.get('config/googleContacts/' + currentUser.uid);
    return snap.exists();
  } catch (e) {
    return false;
  }
}

/**
 * Open a popup to connect Google Contacts via the Cloud Function OAuth proxy.
 * Listens for postMessage from the callback page.
 */
async function connectGoogleContacts() {
  if (!currentUser) { showToast('Please sign in first.', true); return; }

  try {
    var idToken = await currentUser.getIdToken();
    var tenantId = window.TENANT_ID || 'dev';
    var url = GOOGLE_CONTACTS_FUNCTIONS_BASE + '/googleContactsAuthStart?idToken=' + encodeURIComponent(idToken) + '&tenantId=' + encodeURIComponent(tenantId);

    var popup = window.open(url, 'googleContactsAuth', 'width=500,height=700');
    if (!popup) {
      showToast('Popup blocked. Please allow popups and try again.', true);
      return;
    }

    // Listen for the postMessage from the callback
    var messageHandler = function(event) {
      if (event.data && event.data.type === 'google-contacts-connected') {
        window.removeEventListener('message', messageHandler);
        showToast('Google Contacts connected!');
        updateGoogleContactsButtons();
      } else if (event.data && event.data.type === 'google-contacts-error') {
        window.removeEventListener('message', messageHandler);
        showToast('Google Contacts authorization failed.', true);
      }
    };
    window.addEventListener('message', messageHandler);
  } catch (err) {
    showToast('Failed to start Google authorization: ' + err.message, true);
  }
}

async function createGoogleContact(contactData) {
  try {
    var connected = await isGoogleContactsConnected();
    if (!connected) return; // Not connected — skip silently

    var idToken = await currentUser.getIdToken();
    var tenantId = window.TENANT_ID || 'dev';
    var groupName = (TENANT_BRAND && TENANT_BRAND.name) || 'My Business';

    var response = await fetch(GOOGLE_CONTACTS_FUNCTIONS_BASE + '/googleContactsCreate', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId
      },
      body: JSON.stringify({
        name: contactData.name,
        category: contactData.category,
        groupName: groupName
      })
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error('Failed to create Google Contact:', errText);
      return;
    }

    var result = await response.json();
    if (result.resourceName) {
      await MastDB.contacts.googleContactId(contactData.id).set(result.resourceName);
    }
  } catch (err) {
    // Best-effort — don't block contact creation
    console.error('Google Contact creation failed:', err);
  }
}

function openSyncGoogleContactsModal() {
  var connected = isGoogleContactsConnected();
  if (!connected) {
    showToast('Please connect Google Contacts first.', true);
    return;
  }

  var groupName = (TENANT_BRAND && TENANT_BRAND.name) || 'My Business';
  var html = '' +
    '<div class="modal-header"><h3>Sync Google Contacts</h3></div>' +
    '<div class="modal-body">' +
      '<p style="margin-bottom:16px;color:var(--warm-gray);">Choose which Google contacts to import:</p>' +
      '<div class="form-group">' +
        '<label><input type="radio" name="syncMode" value="group" checked style="margin-right:8px;">Only contacts in my "' + esc(groupName) + '" group</label>' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin:4px 0 12px 24px;">Imports only contacts you\'ve organized into your business group in Google Contacts.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label><input type="radio" name="syncMode" value="all" style="margin-right:8px;">All my Google contacts</label>' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin:4px 0 0 24px;">Imports all contacts from your Google account.</p>' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="doSyncGoogleContacts()">Sync</button>' +
    '</div>';
  openModal(html);
}

async function doSyncGoogleContacts() {
  var syncAll = document.querySelector('input[name="syncMode"]:checked').value === 'all';
  closeModal();

  try {
    var connected = await isGoogleContactsConnected();
    if (!connected) {
      showToast('Please connect Google Contacts first.', true);
      return;
    }

    showToast('Syncing Google Contacts...');

    var idToken = await currentUser.getIdToken();
    var tenantId = window.TENANT_ID || 'dev';
    var groupName = (TENANT_BRAND && TENANT_BRAND.name) || 'My Business';

    var body = syncAll
      ? { allContacts: true }
      : { groupName: groupName };

    var response = await fetch(GOOGLE_CONTACTS_FUNCTIONS_BASE + '/googleContactsSync', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + idToken,
        'Content-Type': 'application/json',
        'X-Tenant-ID': tenantId
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error('Google contacts sync failed:', errText);
      showToast('Failed to sync Google Contacts.', true);
      return;
    }

    var data = await response.json();
    var contacts = data.contacts || [];

    // Check existing contacts for googleContactId matches
    var existingIds = {};
    contactsData.forEach(function(c) {
      if (c.googleContactId) existingIds[c.googleContactId] = true;
    });

    var created = 0;
    for (var i = 0; i < contacts.length; i++) {
      var person = contacts[i];
      if (existingIds[person.resourceName]) continue;

      var id = 'contact_' + Date.now().toString(36) + '_' + i;
      var now = new Date().toISOString();
      await MastDB.contacts.set(id, {
        id: id,
        name: person.name || 'Unknown',
        email: person.email || null,
        phone: person.phone || null,
        company: person.company || null,
        category: person.category || 'Other',
        website: null,
        address: null,
        notes: null,
        googleContactId: person.resourceName,
        driveFolderLink: null,
        createdAt: now,
        createdBy: currentUser ? currentUser.uid : 'unknown',
        updatedAt: now
      });
      created++;
    }

    if (created > 0) {
      showToast(created + ' contact(s) synced from Google.');
      contactsLoaded = false;
      loadContacts();
    } else {
      showToast('No new contacts to sync.');
    }
  } catch (err) {
    showToast('Sync failed: ' + err.message, true);
    console.error('Google Contacts sync error:', err);
  }
}

  // ============================================================
  // Window exports for onclick handlers
  // ============================================================

  window.loadContacts = loadContacts;
  window.renderContacts = renderContacts;
  window.openAddContactModal = openAddContactModal;
  window.cancelAddContactModal = cancelAddContactModal;
  window.saveNewContact = saveNewContact;
  window.viewContact = viewContact;
  window.backToContactsList = backToContactsList;
  window.loadContactDetail = loadContactDetail;
  window.renderContactDetail = renderContactDetail;
  window.openLogInteractionModal = openLogInteractionModal;
  window.saveInteraction = saveInteraction;
  window.createGoogleContact = createGoogleContact;
  window.syncGoogleContacts = openSyncGoogleContactsModal;
  window.doSyncGoogleContacts = doSyncGoogleContacts;
  window.connectGoogleContacts = connectGoogleContacts;
  window.isGoogleContactsConnected = isGoogleContactsConnected;
  window.enterContactEditMode = enterContactEditMode;
  window.cancelContactEditMode = cancelContactEditMode;
  window.saveContactEditMode = saveContactEditMode;
  window.openInquiryResponseModal = openInquiryResponseModal;
  window.sendInquiryResponse = sendInquiryResponse;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  async function updateGoogleContactsButtons() {
    var connectBtn = document.getElementById('googleContactsConnectBtn');
    var syncBtn = document.getElementById('googleContactsSyncBtn');
    if (!connectBtn || !syncBtn) return;
    var connected = await isGoogleContactsConnected();
    connectBtn.style.display = connected ? 'none' : '';
    syncBtn.style.display = connected ? '' : 'none';
  }

  // MastNavStack restorer for the contacts route — re-opens contact detail.
  if (window.MastNavStack) {
    window.MastNavStack.registerRestorer('contacts', function(view, state) {
      if (view !== 'detail' || !state || !state.contactId) return;
      var openIt = function() {
        if (typeof viewContact === 'function') viewContact(state.contactId);
      };
      if (!contactsLoaded) {
        var tries = 0;
        var iv = setInterval(function() {
          if (contactsLoaded || tries++ > 25) { clearInterval(iv); openIt(); }
        }, 100);
      } else openIt();
    });
  }

  MastAdmin.registerModule('contacts', {
    routes: {
      'contacts': { tab: 'contactsTab', setup: function() {
        if (!contactsLoaded) loadContacts();
        updateGoogleContactsButtons();
      } }
    },
    detachListeners: function() {
      contactsData = [];
      contactsLoaded = false;
      selectedContactId = null;
      contactInteractions = [];
      contactInteractionsLoaded = false;
      contactEditMode = false;
      contactEditBaseline = null;
      if (window.MastDirty) { try { MastDirty.unregister('contactEdit'); } catch (e) {} }
    }
  });

})();
