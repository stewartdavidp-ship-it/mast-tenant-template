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
    var snap = await MastDB.contacts.ref().once('value');
    var val = snap.val();
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
      : '<span style="color:var(--warm-gray-light);font-size:0.82rem;">None</span>';

    var driveHtml = c.driveFolderLink
      ? '<a href="' + esc(c.driveFolderLink) + '" target="_blank" rel="noopener" onclick="event.stopPropagation();" title="Open Drive folder" style="font-size:1.1rem;">&#128193;</a>'
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

  var html = '' +
    '<div class="modal-header"><h3>Add Contact</h3></div>' +
    '<div class="modal-body">' +
      '<div class="form-group"><label class="field-required">Name</label><input type="text" id="contactNameInput" placeholder="Company or person name"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div class="form-group"><label>Email</label><input type="email" id="contactEmailInput" placeholder="email@example.com"></div>' +
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
        '<p style="font-size:0.75rem;color:var(--warm-gray);margin-top:4px;">Paste an existing Google Drive folder link.</p></div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveNewContact()">Create Contact</button>' +
    '</div>';
  openModal(html);
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
    await MastDB.contacts.ref(id).set(contactData);
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
// Edit Contact
// ============================================================

async function openEditContactModal(contactId) {
  var snap = await MastDB.contacts.ref(contactId).once('value');
  var c = snap.val();
  if (!c) { showToast('Contact not found.', true); return; }

  var catOptions = CONTACT_CATEGORIES.map(function(cat) {
    var sel = (cat === c.category) ? ' selected' : '';
    return '<option value="' + esc(cat) + '"' + sel + '>' + esc(cat) + '</option>';
  }).join('');

  var html = '' +
    '<div class="modal-header"><h3>Edit Contact</h3></div>' +
    '<div class="modal-body">' +
      '<div class="form-group"><label class="field-required">Name</label><input type="text" id="editContactName" value="' + esc(c.name || '') + '"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div class="form-group"><label>Email</label><input type="email" id="editContactEmail" value="' + esc(c.email || '') + '"></div>' +
        '<div class="form-group"><label>Phone</label><input type="tel" id="editContactPhone" value="' + esc(c.phone || '') + '"></div>' +
      '</div>' +
      '<div class="form-group"><label>Company / Organization</label><input type="text" id="editContactCompany" value="' + esc(c.company || '') + '"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">' +
        '<div class="form-group"><label class="field-required">Category</label><select id="editContactCategory">' + catOptions + '</select></div>' +
        '<div class="form-group"><label>Website</label><input type="url" id="editContactWebsite" value="' + esc(c.website || '') + '"></div>' +
      '</div>' +
      '<div class="form-group"><label>Address</label><input type="text" id="editContactAddress" value="' + esc(c.address || '') + '"></div>' +
      '<div class="form-group"><label>Notes</label><textarea id="editContactNotes" rows="2">' + esc(c.notes || '') + '</textarea></div>' +
      '<div class="form-group"><label>Drive Folder Link</label><input type="text" id="editContactDrive" value="' + esc(c.driveFolderLink || '') + '"></div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveEditContact(\'' + esc(contactId) + '\')">Save Changes</button>' +
    '</div>';
  openModal(html);
}

async function saveEditContact(contactId) {
  var name = document.getElementById('editContactName').value.trim();
  if (!name) { showToast('Name is required.', true); return; }

  var updates = {
    name: name,
    email: document.getElementById('editContactEmail').value.trim() || null,
    phone: document.getElementById('editContactPhone').value.trim() || null,
    company: document.getElementById('editContactCompany').value.trim() || null,
    category: document.getElementById('editContactCategory').value,
    website: document.getElementById('editContactWebsite').value.trim() || null,
    address: document.getElementById('editContactAddress').value.trim() || null,
    notes: document.getElementById('editContactNotes').value.trim() || null,
    driveFolderLink: document.getElementById('editContactDrive').value.trim() || null,
    updatedAt: new Date().toISOString()
  };

  try {
    await MastDB.contacts.update(contactId, updates);
    await writeAudit('update', 'contacts', contactId);
    showToast('Contact updated.');
    closeModal();
    loadContactDetail(contactId);
    contactsLoaded = false; // refresh list on back

    // Push changes to Google Contact in background
    var snap = await MastDB.contacts.ref(contactId).once('value');
    var contact = snap.val();
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
    var cSnap = await MastDB.contacts.ref(contactId).once('value');
    var contact = cSnap.val();
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

function renderContactDetail(contact) {
  var container = document.getElementById('contactDetailContent');
  var linksHtml = '';
  if (contact.driveFolderLink) {
    linksHtml += '<a href="' + esc(contact.driveFolderLink) + '" target="_blank" rel="noopener">&#128193; Drive Folder</a>';
  }
  if (contact.googleContactId) {
    linksHtml += '<a href="https://contacts.google.com/person/' + esc(contact.googleContactId.replace('people/', '')) + '" target="_blank" rel="noopener">&#128100; Google Contact</a>';
  }

  var notesHtml = contact.notes
    ? '<div class="contact-detail-notes">' + esc(contact.notes) + '</div>'
    : '';

  var detailFieldsHtml = '';
  var fields = [];
  if (contact.email) fields.push('<a href="mailto:' + esc(contact.email) + '" style="color:var(--teal);">' + esc(contact.email) + '</a>');
  if (contact.phone) fields.push('<a href="tel:' + esc(contact.phone) + '" style="color:var(--teal);">' + esc(contact.phone) + '</a>');
  if (contact.company) fields.push(esc(contact.company));
  if (contact.website) fields.push('<a href="' + esc(contact.website) + '" target="_blank" rel="noopener" style="color:var(--teal);">' + esc(contact.website) + '</a>');
  if (contact.address) fields.push(esc(contact.address));
  if (fields.length) {
    detailFieldsHtml = '<div style="display:flex;flex-wrap:wrap;gap:8px 16px;margin:8px 0;font-size:0.88rem;color:var(--warm-gray-light);">' +
      fields.map(function(f) { return '<span>' + f + '</span>'; }).join('<span style="color:var(--warm-gray);">|</span>') +
    '</div>';
  }

  var headerHtml = '' +
    '<div class="contact-detail-header">' +
      '<div>' +
        '<h2 class="contact-detail-name">' + esc(contact.name || '') + '</h2>' +
        '<span class="status-badge" style="' + contactCatBadgeStyle(contact.category) + '">' + esc(contact.category || 'Other') + '</span>' +
        detailFieldsHtml +
        notesHtml +
        (linksHtml ? '<div class="contact-detail-links">' + linksHtml + '</div>' : '') +
      '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary btn-small" onclick="openEditContactModal(\'' + esc(contact.id) + '\')">Edit</button>' +
        (contact.email ? '<button class="btn btn-primary btn-small" onclick="openInquiryResponseModal(\'' + esc(contact.id) + '\')">Respond</button>' : '') +
        '<button class="btn btn-primary btn-small" onclick="openLogInteractionModal(\'' + esc(contact.id) + '\')">+ Log Interaction</button>' +
      '</div>' +
    '</div>';

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

  container.innerHTML = headerHtml + timelineHtml;
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
        '<p style="font-size:0.75rem;color:var(--warm-gray);margin-top:4px;">Paste a Drive URL to attach file metadata to this interaction.</p>' +
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
    var cSnap = await MastDB.contacts.ref(contactId).once('value');
    var contact = cSnap.val();
    if (!contact) { showToast('Contact not found.', true); return; }

    // Get the specific interaction if provided
    var specificInteraction = interactionKey ? window[interactionKey] : null;

    // Find the inquiry record — use direct ID if provided, else query by contactId
    var inquiry = null;
    if (directInquiryId) {
      var dirSnap = await MastDB._ref('inquiries/' + directInquiryId).once('value');
      inquiry = dirSnap.val();
    }
    if (!inquiry) {
      var iqSnap = await MastDB._ref('inquiries').orderByChild('contactId').equalTo(contactId).limitToLast(1).once('value');
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
      var phoneSnap = await MastDB._ref('config/brand/phone').once('value');
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
      await MastDB._ref('inquiries/' + inquiryId + '/status').set('responded');
      await MastDB._ref('inquiries/' + inquiryId + '/respondedAt').set(now);
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
    var snap = await MastDB._ref('config/googleContacts/' + currentUser.uid).once('value');
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
        '<p style="font-size:0.75rem;color:var(--warm-gray);margin:4px 0 12px 24px;">Imports only contacts you\'ve organized into your business group in Google Contacts.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label><input type="radio" name="syncMode" value="all" style="margin-right:8px;">All my Google contacts</label>' +
        '<p style="font-size:0.75rem;color:var(--warm-gray);margin:4px 0 0 24px;">Imports all contacts from your Google account.</p>' +
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
      await MastDB.contacts.ref(id).set({
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
  window.openEditContactModal = openEditContactModal;
  window.saveEditContact = saveEditContact;
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
        // If another module navigated here to view a specific contact, honor it.
        if (window._pendingContactView) {
          var id = window._pendingContactView;
          window._pendingContactView = null;
          // Defer so loadContacts has a chance to render first.
          setTimeout(function() { viewContact(id); }, 0);
        }
      } }
    },
    detachListeners: function() {
      contactsData = [];
      contactsLoaded = false;
      selectedContactId = null;
      contactInteractions = [];
      contactInteractionsLoaded = false;
    }
  });

})();
