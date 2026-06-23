// app/modules/user-detail.js  (T1 extraction)
//
// Per-user detail drilldown (profile / permissions / activity tabs, profile-photo
// handling, override save) plus the Add-User invite modal, pending-invite list,
// and password-reset action. Extracted byte-identical from the inline block in
// index.html. Top-level functions stay window globals (the inline block is not an
// IIFE), so switchEmployeesView (users-admin.js), the +Add User button, and the
// route dispatcher still resolve renderUserDetail / showInviteUserModal et al.
// Cross-module globals (userDetailActiveTab, editingUserSensitive, getUserProfile)
// resolve at call time, post-load.

function renderUserDetail(uid) {
  var detailEl = document.getElementById('empDetailView');
  if (!detailEl) return;
  if (!uid) { switchEmployeesView('users'); return; }
  var isSelf = currentUser && currentUser.uid === uid;
  var canEditOthers = can('employees', 'edit');
  if (!isSelf && !canEditOthers) {
    detailEl.innerHTML = '<div class="empty-state" style="padding:24px;"><p>You do not have access to this profile.</p>' +
      '<button class="btn btn-secondary" onclick="navigateTo(\'employees\')">&larr; Back to Users</button></div>';
    return;
  }
  var u = adminUsers[uid] || {};
  // Self may not be in adminUsers (e.g. very fresh login); pad from auth.
  if (isSelf && !u.email && currentUser) {
    u = {
      email: currentUser.email || '',
      displayName: currentUser.displayName || '',
      photoURL: currentUser.photoURL || '',
      role: currentUserRole || 'user'
    };
  }
  window.invalidateUserProfileCache(uid); // force fresh read on re-render
  window.getUserProfile(uid).then(function(profile) {
    profile = profile || {};
    var displayName = profile.displayName || u.displayName || u.email || 'Unnamed';
    var photoUrl = profile.photoUrl || u.photoURL || '';
    var bio = profile.bio || '';

    var tabs = [
      { value: 'profile', label: 'Profile', show: true },
      { value: 'permissions', label: 'Permissions', show: canEditOthers },
      { value: 'activity', label: 'Activity', show: canEditOthers }
    ].filter(function(t) { return t.show; });

    // Reset to profile if the active tab isn't visible to this viewer.
    if (!tabs.some(function(t) { return t.value === userDetailActiveTab; })) {
      userDetailActiveTab = 'profile';
    }

    var tabBar = '<div class="view-tabs" style="margin-bottom:16px;">' +
      tabs.map(function(t) {
        var active = userDetailActiveTab === t.value ? ' active' : '';
        return '<button class="view-tab' + active + '" onclick="switchUserDetailTab(\'' + t.value + '\',\'' + esc(uid) + '\')">' + esc(t.label) + '</button>';
      }).join('') +
      '</div>';

    var initial = ((displayName || '?').charAt(0) || '?').toUpperCase();
    var photoEl = photoUrl
      ? '<img src="' + esc(photoUrl) + '" alt="" style="width:56px;height:56px;border-radius:50%;object-fit:cover;border:1px solid var(--cream-dark);">'
      : '<span style="width:56px;height:56px;border-radius:50%;background:var(--cream-dark);display:inline-flex;align-items:center;justify-content:center;font-size:1.6rem;color:var(--warm-gray);">' + esc(initial) + '</span>';

    var header = '<div style="margin:0 0 12px;"><button class="detail-back" onclick="navigateTo(\'employees\')">&larr; Back to Users</button></div>' +
      '<div style="display:flex;align-items:center;gap:16px;margin-bottom:16px;">' +
        photoEl +
        '<div><h2 style="margin:0;font-size:1.15rem;">' + esc(displayName) +
          (isSelf ? ' <span style="font-size:0.78rem;color:var(--warm-gray);">(you)</span>' : '') +
        '</h2>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);">' + esc(u.email || '') +
          (u.role ? ' &middot; ' + esc(u.role) : '') + '</div></div>' +
      '</div>';

    detailEl.innerHTML = header + tabBar + '<div id="userDetailTabContent"></div>';
    _renderUserDetailTabContent(uid, u, profile);
  });
}
window.renderUserDetail = renderUserDetail;

function switchUserDetailTab(tab, uid) {
  userDetailActiveTab = tab;
  renderUserDetail(uid);
}
window.switchUserDetailTab = switchUserDetailTab;

function _renderUserDetailTabContent(uid, u, profile) {
  var container = document.getElementById('userDetailTabContent');
  if (!container) return;
  if (userDetailActiveTab === 'profile') {
    _renderUserProfileTab(container, uid, u, profile);
  } else if (userDetailActiveTab === 'permissions') {
    _renderUserPermissionsTab(container, uid, u);
  } else if (userDetailActiveTab === 'activity') {
    _renderUserActivityTab(container, uid, u);
  }
}

function _renderUserProfileTab(container, uid, u, profile) {
  var isSelf = currentUser && currentUser.uid === uid;
  var canEdit = isSelf || can('employees', 'edit');
  var displayName = profile.displayName || u.displayName || '';
  var photoUrl = profile.photoUrl || u.photoURL || '';
  var bio = profile.bio || '';
  var initial = ((displayName || '?').charAt(0) || '?').toUpperCase();
  var disabledAttr = canEdit ? '' : ' disabled';
  var photoPreview = photoUrl
    ? '<img id="profilePhotoPreview" src="' + esc(photoUrl) + '" alt="" style="width:64px;height:64px;border-radius:50%;object-fit:cover;border:1px solid var(--cream-dark);">'
    : '<span id="profilePhotoPreview" style="width:64px;height:64px;border-radius:50%;background:var(--cream-dark);display:inline-flex;align-items:center;justify-content:center;color:var(--warm-gray);font-size:1.6rem;">' + esc(initial) + '</span>';
  var photoControls = canEdit
    ? '<button type="button" class="btn btn-secondary" style="font-size:0.78rem;padding:6px 12px;" onclick="pickUserProfilePhoto(\'' + esc(uid) + '\')">Change Photo</button>' +
      (photoUrl ? ' <button type="button" class="btn btn-secondary" style="font-size:0.78rem;padding:6px 12px;color:var(--danger);border-color:var(--danger);" onclick="clearUserProfilePhoto(\'' + esc(uid) + '\')">Remove</button>' : '')
    : '';
  container.innerHTML =
    '<div style="padding:8px 0 16px;">' +
      '<div class="form-group">' +
        '<label>Display Name</label>' +
        '<input type="text" id="profileDisplayName" value="' + esc(displayName) + '" placeholder="How your name appears in blog posts, audit log, etc."' + disabledAttr + '>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Photo</label>' +
        '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">' +
          photoPreview + photoControls +
        '</div>' +
      '</div>' +
      '<div class="form-group">' +
        '<label>Bio</label>' +
        '<textarea id="profileBio" rows="3" placeholder="Short bio shown on blog posts you author."' + disabledAttr + '>' + esc(bio) + '</textarea>' +
      '</div>' +
      (canEdit
        ? '<div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">' +
            '<button class="btn btn-primary" onclick="saveUserProfile(\'' + esc(uid) + '\')">Save Profile</button>' +
          '</div>'
        : '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:8px;">Read-only.</div>') +
    '</div>';
}

function pickUserProfilePhoto(uid) {
  if (typeof openImagePicker !== 'function') {
    showToast('Image picker not available.', true);
    return;
  }
  openImagePicker(function(imgId, url, thumbnailUrl) {
    var photoUrl = url || thumbnailUrl;
    if (!photoUrl) return;
    MastDB.set('admin/users/' + uid + '/profile/photoUrl', photoUrl).then(function() {
      window.invalidateUserProfileCache(uid);
      _refreshAvatarIfSelf(uid, photoUrl);
      showToast('Photo updated.');
      renderUserDetail(uid);
    }).catch(function(err) { showToast('Error saving photo: ' + (err && err.message), true); });
  });
}
window.pickUserProfilePhoto = pickUserProfilePhoto;

function clearUserProfilePhoto(uid) {
  MastDB.remove('admin/users/' + uid + '/profile/photoUrl').then(function() {
    window.invalidateUserProfileCache(uid);
    _refreshAvatarIfSelf(uid, '');
    showToast('Photo removed.');
    renderUserDetail(uid);
  }).catch(function(err) { showToast('Error: ' + (err && err.message), true); });
}
window.clearUserProfilePhoto = clearUserProfilePhoto;

function saveUserProfile(uid) {
  var isSelf = currentUser && currentUser.uid === uid;
  if (!isSelf && !can('employees', 'edit')) {
    showToast('You cannot edit this profile.', true);
    return;
  }
  var dnEl = document.getElementById('profileDisplayName');
  var bioEl = document.getElementById('profileBio');
  var payload = {
    displayName: (dnEl && dnEl.value || '').trim(),
    bio: (bioEl && bioEl.value || '').trim(),
    updatedAt: new Date().toISOString()
  };
  MastDB.update('admin/users/' + uid + '/profile', payload).then(function() {
    window.invalidateUserProfileCache(uid);
    showToast('Profile saved.');
    renderUserDetail(uid);
  }).catch(function(err) { showToast('Save failed: ' + (err && err.message), true); });
}
window.saveUserProfile = saveUserProfile;

function _refreshAvatarIfSelf(uid, photoUrl) {
  if (!currentUser || currentUser.uid !== uid) return;
  var av = document.getElementById('userAvatar');
  if (av) av.src = photoUrl || currentUser.photoURL || '';
}

function _renderUserPermissionsTab(container, uid, u) {
  if (!can('employees', 'edit')) {
    container.innerHTML = '<p style="color:var(--warm-gray);font-size:0.85rem;padding:16px 0;">You do not have permission to view or change permissions.</p>';
    return;
  }
  var role = u.role || 'guest';
  var overrideCount = userOverrideCount(u);
  var roleName = (typeof ROLE_DISPLAY_NAMES !== 'undefined' && ROLE_DISPLAY_NAMES[role]) || role;
  container.innerHTML =
    '<div style="padding:8px 0 16px;">' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 12px;">Current role: <strong>' + esc(roleName) + '</strong>' +
        (overrideCount > 0 ? ' &middot; ' + overrideCount + ' permission override' + (overrideCount === 1 ? '' : 's') : ' &middot; using role defaults') +
      '</p>' +
      '<button class="btn btn-primary" onclick="openUserPermissionsPanel(\'' + esc(uid) + '\')">Edit Permissions</button>' +
    '</div>';
}

function _renderUserActivityTab(container, uid, u) {
  if (!can('employees', 'edit')) {
    container.innerHTML = '<p style="color:var(--warm-gray);font-size:0.85rem;padding:16px 0;">You do not have permission to view this section.</p>';
    return;
  }
  container.innerHTML =
    '<div style="padding:8px 0 16px;">' +
      '<p style="font-size:0.85rem;color:var(--warm-gray);margin:0 0 12px;">Recent actions, audit history, and last login for this user.</p>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
        '<button class="btn btn-secondary" onclick="viewUserAudit(\'' + esc(uid) + '\')">View Audit History</button>' +
      '</div>' +
    '</div>';
}

// Count of a user's active overrides (module + sensitive).
function userOverrideCount(u) {
  if (!u) return 0;
  return Object.keys(u.moduleOverrides || {}).length + Object.keys(u.permissionOverrides || {}).length;
}

function setUserModuleLevel(route, level) {
  if (level === 'custom') return;
  editingUserModuleLevels[route] = level;
}
function toggleUserSensitive(key, value) { editingUserSensitive[key] = value === true; }

function resetUserOverrides(uid) {
  openUserPermissionsPanel(uid, 'defaults');
}

async function saveUserPermissionOverrides(uid) {
  var u = adminUsers[uid];
  if (!u) return;
  var role = u.role || 'guest';
  // Role config must come from the STORED role doc (layered over built-in
  // defaults), fresh-read on cache miss — `rolesData` is the legacy surface's
  // load-once cache and is EMPTY in a V2-only session, which made the diff
  // baseline collapse to 'none' for custom roles and write phantom overrides
  // (the §0c-3 load-once gotcha; caught live on the walk).
  var roleDoc = (typeof rolesData === 'object' && rolesData[role]) || await MastDB.roles.get(role);
  var roleConfig = EmployeesBridge.effectiveRole(role, roleDoc);

  // Build minimal diffs vs role defaults: module level overrides + sensitive.
  var moduleOverrides = {};
  getModulePermRegistry().forEach(function(g) {
    g.routes.forEach(function(m) {
      var def = roleDefaultModuleLevel(role, roleConfig, m.route);
      var cur = editingUserModuleLevels[m.route];
      if (cur && cur !== 'custom' && cur !== def) moduleOverrides[m.route] = levelToTriad(cur);
    });
  });
  var sensitiveOverrides = {};
  FUNCTION_PERMISSIONS.forEach(function(fp) {
    var k = _sensitiveKey(fp.entity, fp.action);
    var def = roleDefaultSensitive(role, roleConfig, k);
    if (editingUserSensitive[k] !== def) sensitiveOverrides[k] = editingUserSensitive[k] === true;
  });

  var accessExpiry;
  var expiryInput = document.getElementById('userPanelExpiry');
  if (expiryInput) accessExpiry = expiryInput.value ? expiryInput.value : null;

  try {
    var token = await auth.currentUser.getIdToken();
    var resp = await callCF('/updateUserPermissions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ targetUid: uid, moduleOverrides: moduleOverrides, sensitiveOverrides: sensitiveOverrides, accessExpiry: accessExpiry })
    });
    var result = await resp.json();
    if (!resp.ok) {
      showToast((result && result.error) || 'Failed to save permissions.', true);
      return;
    }
    // Update local cache with validated values returned from the CF.
    adminUsers[uid].moduleOverrides = result.moduleOverrides || moduleOverrides;
    adminUsers[uid].permissionOverrides = result.sensitiveOverrides || sensitiveOverrides;
    if (expiryInput) adminUsers[uid].accessExpiry = result.accessExpiry !== undefined ? result.accessExpiry : accessExpiry;
    closeModal();
    var displayName = u.displayName || u.email || 'User';
    var diffCount = userOverrideCount(adminUsers[uid]);
    showToast(diffCount > 0
      ? 'Permissions updated for ' + displayName + ' (' + diffCount + ' override' + (diffCount !== 1 ? 's' : '') + ').'
      : 'Permissions reset to role defaults for ' + displayName + '.');
    renderUsersList();
  } catch (err) {
    console.error('Save user overrides failed:', err);
    showToast('Failed to save permissions.', true);
  }
}

// ============================================================
// User Invite Flow
// ============================================================
function showInviteUserModal() {
  if (!can('employees', 'edit')) {
    showToast('You do not have permission to add users.', true);
    return;
  }
  // Build invite-role options from canonical AII enum (admin/staff/user/guest),
  // plus any custom roles defined in rolesData. Default selection is Manager.
  var canonicalKeys = CANONICAL_ROLES.slice();
  var extraKeys = Object.keys(rolesData).filter(function(rk) {
    return canonicalKeys.indexOf(rk) === -1;
  });
  var roleKeys = canonicalKeys.concat(extraKeys);
  var roleOpts = '';
  roleKeys.forEach(function(rk) {
    var rName = ROLE_DISPLAY_NAMES[rk] || (rolesData[rk] ? rolesData[rk].name : rk);
    var selected = rk === 'user' ? ' selected' : '';
    roleOpts += '<option value="' + rk + '"' + selected + '>' + rName + '</option>';
  });

  var html = '<div class="modal-header">' +
    '<h3>Invite User</h3>' +
    '<button class="modal-close" onclick="closeModal()">&times;</button>' +
  '</div>' +
  '<div class="modal-body">' +
    '<div class="form-group">' +
      '<label for="inviteEmail">Email Address <span class="field-required">*</span></label>' +
      '<input type="email" id="inviteEmail" placeholder="name@example.com" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
    '</div>' +
    '<div class="form-group">' +
      '<label for="inviteRole">Role</label>' +
      '<select id="inviteRole" onchange="toggleInviteGuestExpiry()" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' + roleOpts + '</select>' +
      '<p style="font-size:0.72rem;color:var(--warm-gray);margin-top:4px;">They\'ll receive an email to set their own password, then sign in to claim this role.</p>' +
    '</div>' +
    '<div class="form-group" id="inviteGuestExpiryGroup" style="display:none;">' +
      '<label for="inviteGuestExpiry">Access Expires On <span class="field-required">*</span></label>' +
      '<input type="date" id="inviteGuestExpiry" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;background:var(--surface);color:var(--text,rgba(42,42,42,1));">' +
      '<p style="font-size:0.72rem;color:var(--warm-gray);margin-top:4px;">Stored for display — enforcement is Phase 3.</p>' +
    '</div>' +
    // DEV/TEST-ONLY: "Set password now" mode. Rendered only on dev/test tenants
    // (isDevTestTenant); production admins never see it. The Cloud Function
    // (createTenantUserWithPassword) enforces the dev/test gate authoritatively.
    (isDevTestTenant() ?
    ('<div class="form-group" style="border-top:1px solid var(--cream-dark);padding-top:12px;margin-top:4px;">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;font-weight:600;">' +
        '<input type="checkbox" id="invitePwMode" onchange="toggleInvitePwMode()" style="width:auto;margin:0;">' +
        'Set password now (test only)' +
      '</label>' +
      '<p style="font-size:0.72rem;color:var(--warm-gray);margin-top:4px;">Dev/test tenant only. Creates an active account that can sign in immediately with email + password — no email invite. For reviewer/test accounts.</p>' +
    '</div>' +
    '<div class="form-group" id="invitePwGroup" style="display:none;">' +
      '<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">' +
        '<label for="invitePassword" style="margin:0;">Password <span class="field-required">*</span></label>' +
        '<button type="button" class="btn btn-secondary" onclick="generateInvitePassword()" style="padding:4px 10px;font-size:0.78rem;">Generate</button>' +
      '</div>' +
      '<input type="password" id="invitePassword" autocomplete="new-password" placeholder="12+ chars with upper, lower, number &amp; symbol" oninput="renderPasswordPolicyChecklist(\'invitePwChecklist\', this.value); checkPasswordConfirm(\'invitePassword\',\'invitePasswordConfirm\',\'invitePwConfirmHint\')" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
      '<div id="invitePwChecklist" aria-live="polite" style="margin-top:6px;"></div>' +
      '<label for="invitePasswordConfirm" style="margin-top:8px;">Confirm Password <span class="field-required">*</span></label>' +
      '<input type="password" id="invitePasswordConfirm" autocomplete="new-password" oninput="checkPasswordConfirm(\'invitePassword\',\'invitePasswordConfirm\',\'invitePwConfirmHint\')" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
      '<div id="invitePwConfirmHint" class="pw-confirm-hint" aria-live="polite"></div>' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;margin-top:10px;">' +
        '<input type="checkbox" id="inviteTempPw" style="width:auto;margin:0;">' +
        'Temporary (force change on first login)' +
      '</label>' +
    '</div>') : '') +
  '</div>' +
  '<div class="modal-footer">' +
    '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
    '<button class="btn btn-primary" id="addUserSubmitBtn" onclick="submitAddUser()">Send Invite</button>' +
  '</div>';
  openModal(html);
  setTimeout(function() { document.getElementById('inviteEmail').focus(); }, 100);
}

// DEV/TEST-ONLY gate (UI mirror of the server's positive test signal). Cosmetic
// only — the createTenantUserWithPassword CF enforces the authoritative gate.
function isDevTestTenant() {
  try {
    if (typeof TENANT_CONFIG !== 'undefined' && TENANT_CONFIG) {
      // Dev pod is entirely test data. (Only readable client-side for platform
      // admins; tenant-only admins fall back to the id/flag checks below — the
      // server gate is authoritative either way.)
      if (TENANT_CONFIG.pod === 'dev') return true;
      if (TENANT_CONFIG.env === 'test' || TENANT_CONFIG.isTest === true || TENANT_CONFIG.sandbox === true) return true;
    }
    var tid = (typeof MastDB !== 'undefined' && MastDB.tenantId) ? (MastDB.tenantId() || '') : '';
    if (/^dev$/.test(tid) || /^sgtest/.test(tid) || /^e2e/.test(tid)) return true;
  } catch (e) { /* default-deny */ }
  return false;
}

// Toggle between email-invite mode and the dev/test "set password" mode.
function toggleInvitePwMode() {
  var cb = document.getElementById('invitePwMode');
  var on = !!(cb && cb.checked);
  var grp = document.getElementById('invitePwGroup');
  if (grp) grp.style.display = on ? '' : 'none';
  if (on) {
    var pwField = document.getElementById('invitePassword');
    renderPasswordPolicyChecklist('invitePwChecklist', (pwField && pwField.value) || '');
  }
  var btn = document.getElementById('addUserSubmitBtn');
  if (btn) btn.textContent = on ? 'Create User' : 'Send Invite';
  // Guest expiry only applies to email invites.
  var ge = document.getElementById('inviteGuestExpiryGroup');
  if (on) { if (ge) ge.style.display = 'none'; }
  else if (typeof toggleInviteGuestExpiry === 'function') { toggleInviteGuestExpiry(); }
}

// Dispatcher for the Add-User modal primary button.
function submitAddUser() {
  var cb = document.getElementById('invitePwMode');
  if (isDevTestTenant() && cb && cb.checked) return createUserWithPassword();
  return sendUserInvite();
}

// DEV/TEST-ONLY: create an immediately-usable account with an admin-set password.
async function createUserWithPassword() {
  if (!can('employees', 'edit')) {
    showToast('You do not have permission to add users.', true);
    return;
  }
  if (!isDevTestTenant()) {
    showToast('Setting a password is only available on dev/test tenants.', true);
    return;
  }
  var email = (document.getElementById('inviteEmail').value || '').trim().toLowerCase();
  var role = document.getElementById('inviteRole').value || 'user';
  var pw = (document.getElementById('invitePassword') || {}).value || '';
  var pw2 = (document.getElementById('invitePasswordConfirm') || {}).value || '';
  var tempPw = !!((document.getElementById('inviteTempPw') || {}).checked);
  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address.', true);
    return;
  }
  var unmet = validatePasswordPolicy(pw);
  if (unmet.length) {
    showToast('Password needs: ' + _passwordPolicyUnmetSentence(unmet) + '.', true);
    return;
  }
  if (pw !== pw2) {
    showToast('Passwords do not match.', true);
    return;
  }
  var btn = document.getElementById('addUserSubmitBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Creating…'; }
  try {
    var res = await firebase.functions().httpsCallable('createTenantUserWithPassword')({
      tenantId: MastDB.tenantId(),
      email: email,
      role: role,
      password: pw,
      temporaryPassword: tempPw
    });
    var data = (res && res.data) || {};
    closeModal();
    var roleName = ROLE_DISPLAY_NAMES[role] || role;
    showToast((data.created === false ? 'Password set for existing user ' : 'Created ') + email +
      ' as ' + roleName + '. They can sign in now with email + password.');
    // Reload users (and pending invites — a stuck invite may have been reconciled).
    adminUsersLoaded = false;
    if (typeof loadAdminUsers === 'function') loadAdminUsers();
    else if (typeof loadPendingInvites === 'function') loadPendingInvites();
    emitTestingEvent('createUserWithPassword', {});
  } catch (err) {
    console.error('createTenantUserWithPassword failed:', err);
    showToast((err && err.message) ? err.message : 'Failed to create user.', true);
    if (btn) { btn.disabled = false; btn.textContent = 'Create User'; }
  }
}

function toggleInviteGuestExpiry() {
  var role = document.getElementById('inviteRole') && document.getElementById('inviteRole').value;
  var group = document.getElementById('inviteGuestExpiryGroup');
  if (group) group.style.display = (role === 'guest') ? '' : 'none';
}

async function sendUserInvite() {
  var email = (document.getElementById('inviteEmail').value || '').trim().toLowerCase();
  var role = document.getElementById('inviteRole').value || 'user';
  if (!email || !email.includes('@')) {
    showToast('Please enter a valid email address.', true);
    return;
  }
  // Require expiry for guest
  var accessExpiry = null;
  if (role === 'guest') {
    var expiryInput = document.getElementById('inviteGuestExpiry');
    accessExpiry = expiryInput && expiryInput.value ? expiryInput.value : null;
    if (!accessExpiry) {
      showToast('Please set an expiry date for the Guest user.', true);
      return;
    }
  }

  // Check if user already exists
  var existingUsers = Object.values(adminUsers);
  for (var i = 0; i < existingUsers.length; i++) {
    if ((existingUsers[i].email || '').toLowerCase() === email) {
      showToast('A user with this email already exists.', true);
      return;
    }
  }

  // Encode email for use as Firebase key (replace . with ,)
  var emailKey = email.replace(/\./g, ',');
  try {
    await MastDB.invites.set(emailKey, {
      email: email,
      role: role,
      accessExpiry: accessExpiry,
      invitedAt: new Date().toISOString(),
      invitedBy: currentUser.uid,
      status: 'pending'
    });
    await writeAudit('create', 'users', emailKey);
    closeModal();
    var roleName = ROLE_DISPLAY_NAMES[role] || role;
    loadPendingInvites();

    // Production set-password invite flow (single call):
    //   inviteTenantUser ensures a Firebase Auth account exists (server picks a
    //   throwaway random password the admin never sees) AND sends a branded
    //   "set your password" email via Resend whose link lands on THIS tenant's
    //   OWN origin (so the browser saves the new password under runmast.com and
    //   offers it at the next login — the old Firebase hosted reset page was
    //   cross-origin on firebaseapp.com and never autofilled here). The user
    //   sets their OWN password, signs in, and the email-keyed pending invite
    //   (written above) grants their role on first login.
    try {
      var inviteRes = await firebase.functions().httpsCallable('inviteTenantUser')({
        tenantId: MastDB.tenantId(),
        email: email
      });
      var inviteData = (inviteRes && inviteRes.data) || {};
      var emailSent = !!inviteData.emailSent;
      var existingAccount = !!inviteData.existingAccount;
      if (existingAccount) {
        // M1 (SPR 2026-05-29): the account already exists, so no setup email is
        // sent. They sign in with their existing password; the invite grants the
        // role on first login.
        showToast(email + ' already has a Mast account — they can sign in with their existing password, and the invite grants them ' + roleName + ' on first login.');
      } else if (emailSent) {
        showToast('Invite sent — ' + email + ' will get an email to set their password, then they can sign in as ' + roleName + '.');
      } else {
        // New account created but the setup email didn't go out — recoverable
        // via "Forgot password" on the login screen.
        showToast('Invite recorded, but the set-password email could not be sent. They can use “Forgot password” on the login screen to set it.', true);
      }
    } catch (inviteErr) {
      console.error('inviteTenantUser failed:', inviteErr);
      showToast((inviteErr && inviteErr.message) ? inviteErr.message : 'Could not create the invite.', true);
      emitTestingEvent('inviteUser', {});
      return;
    }
    emitTestingEvent('inviteUser', {});
  } catch (err) {
    console.error('Invite failed:', err);
    showToast('Failed to record invite.', true);
  }
}

var pendingInvites = {};

function loadPendingInvites() {
  MastDB.invites.queryPending().then(function(snap) {
    pendingInvites = snap.val() || {};
    renderUsersList();
  });
}

function cancelInvite(emailKey) {
  var inv = pendingInvites[emailKey];
  var email = inv ? inv.email : emailKey.replace(/,/g, '.');
  showConfirmDialog('Cancel Invite', 'Cancel the pending invite for ' + email + '?', async function() {
    try {
      await MastDB.invites.remove(emailKey);
      delete pendingInvites[emailKey];
      renderUsersList();
      showToast('Invite cancelled.');
    } catch (err) {
      showToast('Failed to cancel invite.', true);
    }
  }, { confirmLabel: 'Cancel Invite', cancelLabel: 'Keep' });
}

// Resend a pending invite — re-runs the inviteTenantUser CF so the "set your
// password" setup email goes out again (e.g. the first one was lost). The CF is
// idempotent: if the account already exists it sends nothing and reports back
// (M1 anti-phishing rule), in which case we tell the admin they can just sign in.
function resendInvite(emailKey) {
  if (!can('employees', 'edit')) {
    showToast('You do not have permission to manage invites.', true);
    return;
  }
  var inv = pendingInvites[emailKey];
  var email = inv ? inv.email : emailKey.replace(/,/g, '.');
  var roleName = (inv && (ROLE_DISPLAY_NAMES[inv.role] || inv.role)) || 'their role';
  showConfirmDialog('Resend Invite', 'Resend the setup email to ' + email + '?', async function() {
    try {
      var res = await firebase.functions().httpsCallable('inviteTenantUser')({
        tenantId: MastDB.tenantId(),
        email: email
      });
      var data = (res && res.data) || {};
      if (data.existingAccount) {
        showToast(email + ' already has a Mast account — no email needed. They sign in with their existing password (or “Sign in with Google”), and the invite grants ' + roleName + ' on first login.');
      } else if (data.emailSent) {
        showToast('Setup email resent to ' + email + '.');
      } else {
        showToast('Invite is recorded, but the setup email could not be sent. They can use “Forgot password” on the login screen.', true);
      }
    } catch (err) {
      console.error('resendInvite failed:', err);
      showToast((err && err.message) ? err.message : 'Could not resend the invite.', true);
    }
  }, { confirmLabel: 'Resend', cancelLabel: 'Cancel' });
}

// Send a password-reset email to a user who is locked out. Uses the same
// Firebase reset flow as the login screen's "Forgot password" (same-origin
// handler). For a Google-SSO-only user this is the WRONG fix — they have no
// password — so the confirm dialog warns and points to "Sign in with Google".
function sendUserPasswordReset(uid) {
  if (!can('employees', 'edit')) {
    showToast('You do not have permission to manage users.', true);
    return;
  }
  var u = adminUsers[uid];
  if (!u || !u.email) {
    showToast('No email on file for this user — cannot send a reset.', true);
    return;
  }
  var providers = Array.isArray(u.providers) ? u.providers : [];
  var googleOnly = providers.indexOf('google.com') !== -1 && providers.indexOf('password') === -1;
  var msg = googleOnly
    ? u.email + ' signs in with Google and has no password, so a reset email is not the fix — they should use “Sign in with Google”. Send a reset link anyway (it would let them create a password)?'
    : 'Send a password-reset email to ' + u.email + '? They\'ll get a link to set a new password and sign in.';
  showConfirmDialog('Send Password Reset', msg, function() {
    auth.sendPasswordResetEmail(u.email).then(function() {
      showToast('Password-reset email sent to ' + u.email + '.');
    }).catch(function(err) {
      var code = (err && err.code) || '';
      var t = (code === 'auth/too-many-requests')
        ? 'Too many attempts — try again in a few minutes.'
        : ((err && err.message) ? err.message : 'Could not send the reset email.');
      showToast(t, true);
    });
  }, { confirmLabel: 'Send Reset', cancelLabel: 'Cancel' });
}
