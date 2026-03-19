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
    'signed-doc': { bg: 'rgba(157,23,77,0.2)', color: '#F48FB1', border: 'rgba(157,23,77,0.35)' }
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
      '<td><strong>' + esc(c.name || '') + '</strong></td>' +
      '<td><span class="status-badge" style="' + contactCatBadgeStyle(c.category) + '">' + esc(c.category || 'Other') + '</span></td>' +
      '<td>' + lastIntHtml + '</td>' +
      '<td>' + driveHtml + '</td>';
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
      '<div class="form-group"><label>Name *</label><input type="text" id="contactNameInput" placeholder="Company or person name"></div>' +
      '<div class="form-group"><label>Category *</label><select id="contactCategoryInput">' + catOptions + '</select></div>' +
      '<div class="form-group"><label>Notes</label><textarea id="contactNotesInput" rows="3" placeholder="Optional notes about this contact"></textarea></div>' +
      '<div class="form-group"><label>Drive Folder Link</label><input type="text" id="contactDriveFolderInput" placeholder="https://drive.google.com/drive/folders/...">' +
        '<p style="font-size:0.75rem;color:var(--warm-gray);margin-top:4px;">Paste an existing Google Drive folder link. Studio won\'t create a folder automatically.</p></div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveNewContact()">Create Contact</button>' +
    '</div>';
  openModal(html);
}

async function saveNewContact() {
  var name = document.getElementById('contactNameInput').value.trim();
  var category = document.getElementById('contactCategoryInput').value;
  var notes = document.getElementById('contactNotesInput').value.trim();
  var driveFolderLink = document.getElementById('contactDriveFolderInput').value.trim();

  if (!name) { showToast('Contact name is required.', true); return; }

  var id = 'contact_' + Date.now().toString(36);
  var now = new Date().toISOString();
  var contactData = {
    id: id,
    name: name,
    category: category,
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
// Contact Detail View
// ============================================================

function viewContact(contactId) {
  selectedContactId = contactId;
  document.getElementById('contactsListView').style.display = 'none';
  document.getElementById('contactDetailView').style.display = '';
  loadContactDetail(contactId);
}

function backToContactsList() {
  selectedContactId = null;
  document.getElementById('contactDetailView').style.display = 'none';
  document.getElementById('contactsListView').style.display = '';
  // Refresh list to pick up any new interactions
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

  var headerHtml = '' +
    '<div class="contact-detail-header">' +
      '<div>' +
        '<h2 class="contact-detail-name">' + esc(contact.name || '') + '</h2>' +
        '<span class="status-badge" style="' + contactCatBadgeStyle(contact.category) + '">' + esc(contact.category || 'Other') + '</span>' +
        notesHtml +
        (linksHtml ? '<div class="contact-detail-links">' + linksHtml + '</div>' : '') +
      '</div>' +
      '<button class="btn btn-primary" style="font-size:0.82rem;padding:6px 16px;white-space:nowrap;" onclick="openLogInteractionModal(\'' + esc(contact.id) + '\')">+ Log Interaction</button>' +
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

      timelineHtml += '' +
        '<div class="interaction-card">' +
          '<div class="interaction-header">' +
            '<span class="interaction-date">' + esc(inter.date || '') + '</span>' +
            '<span class="status-badge" style="' + interactionTypeBadgeStyle(inter.type) + '">' + esc(inter.type || '') + '</span>' +
          '</div>' +
          (inter.notes ? '<div class="interaction-notes">' + esc(inter.notes) + '</div>' : '') +
          docsHtml +
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

async function createGoogleContact(contactData) {
  try {
    var token = await requestGoogleOAuthToken('https://www.googleapis.com/auth/contacts');
    if (!token) return; // User cancelled or error

    // Ensure contact group exists
    var groupId = await getOrCreateContactGroup(token, (TENANT_BRAND && TENANT_BRAND.name) || 'My Business');
    if (!groupId) return;

    // Create the contact
    var body = {
      names: [{ givenName: contactData.name }],
      organizations: [{ department: contactData.category }],
      memberships: [
        { contactGroupMembership: { contactGroupResourceName: groupId } }
      ]
    };

    var response = await fetch('https://people.googleapis.com/v1/people:createContact?personFields=names,organizations,memberships', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      var errText = await response.text();
      console.error('Failed to create Google Contact:', errText);
      return;
    }

    var result = await response.json();
    if (result.resourceName) {
      // Update Firebase with the Google Contact ID
      await MastDB.contacts.googleContactId(contactData.id).set(result.resourceName);
    }
  } catch (err) {
    // Silently fail — Google Contact creation is best-effort
    console.error('Google Contact creation failed:', err);
  }
}

async function getOrCreateContactGroup(token, groupName) {
  try {
    // List existing groups
    var response = await fetch('https://people.googleapis.com/v1/contactGroups?pageSize=100', {
      headers: { 'Authorization': 'Bearer ' + token }
    });
    if (!response.ok) return null;

    var data = await response.json();
    var groups = data.contactGroups || [];
    var existing = groups.find(function(g) { return g.name === groupName; });
    if (existing) return existing.resourceName;

    // Create group
    var createResponse = await fetch('https://people.googleapis.com/v1/contactGroups', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ contactGroup: { name: groupName } })
    });
    if (!createResponse.ok) return null;

    var created = await createResponse.json();
    return created.resourceName || null;
  } catch (err) {
    console.error('Contact group error:', err);
    return null;
  }
}

async function syncGoogleContacts() {
  try {
    var token = await requestGoogleOAuthToken('https://www.googleapis.com/auth/contacts');
    if (!token) return;

    showToast('Syncing Google Contacts...');

    var groupId = await getOrCreateContactGroup(token, (TENANT_BRAND && TENANT_BRAND.name) || 'My Business');
    if (!groupId) {
      showToast('Could not find or create contact group.', true);
      return;
    }

    // Fetch contacts in this group
    var response = await fetch(
      'https://people.googleapis.com/v1/people/me/connections?personFields=names,organizations,emailAddresses,phoneNumbers,memberships&pageSize=500',
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    if (!response.ok) {
      showToast('Failed to fetch Google Contacts.', true);
      return;
    }

    var data = await response.json();
    var connections = data.connections || [];

    // Filter to the tenant's contact group
    var filtered = connections.filter(function(person) {
      return (person.memberships || []).some(function(m) {
        return m.contactGroupMembership && m.contactGroupMembership.contactGroupResourceName === groupId;
      });
    });

    // Check existing contacts for googleContactId matches
    var existingIds = {};
    contactsData.forEach(function(c) {
      if (c.googleContactId) existingIds[c.googleContactId] = true;
    });

    var created = 0;
    for (var i = 0; i < filtered.length; i++) {
      var person = filtered[i];
      if (existingIds[person.resourceName]) continue;

      var personName = (person.names && person.names[0]) ? person.names[0].displayName : 'Unknown';
      var id = 'contact_' + Date.now().toString(36) + '_' + i;
      var now = new Date().toISOString();
      await MastDB.contacts.ref(id).set({
        id: id,
        name: personName,
        category: 'Other',
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
  window.getOrCreateContactGroup = getOrCreateContactGroup;
  window.syncGoogleContacts = syncGoogleContacts;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('contacts', {
    routes: {
      'contacts': { tab: 'contactsTab', setup: function() { if (!contactsLoaded) loadContacts(); } }
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
