// app/modules/users-admin.js  (T1 extraction)
//
// Employees & Permissions admin surface (RBAC Phase 1): the Users list, role
// matrix data, per-user override editor, and the permissions panel. Extracted
// byte-identical from the inline block in index.html. Top-level functions and
// vars remain window globals (the inline block is not an IIFE), so the route
// dispatcher, the role-matrix renderer, and the user-detail view that stay in
// index.html still resolve EmployeesBridge, rolesData, editingModulePermissions,
// roleDefaultModuleLevel and the rest. All handlers run post-load.

// ============================================================
// Employees & Permissions (Phase E3 + RBAC Phase 1)
// ============================================================
var adminUsers = {};
var adminUsersLoaded = false;
var showArchivedUsers = false; // Permissions list: hide archived users by default
var rolesData = {};
var rolesLoaded = false;
var editingModulePermissions = {}; // temp {route:{view,edit,delete}} for the role matrix
var editingSensitiveActions = {};  // temp {key:bool} for the sensitive-actions list
var _permRoleKey = null;           // role currently shown in the matrix
var _permIsAdmin = false;          // is that role the built-in admin (read-only matrix)
var editingUserModuleLevels = {}; // temp {route: level} effective levels in the per-user editor
var editingUserSensitive = {};    // temp {key: bool} effective sensitive grants in the per-user editor
var _userPanelUid = null;         // uid currently shown in the per-user editor

// ---- Per-user override helpers (E6, module + sensitive) ----
// A role's default access LEVEL for a module (clean level or 'custom').
function roleDefaultModuleLevel(role, roleConfig, route) {
  return triadToLevel(roleModuleTriad(role, roleConfig, route));
}
// A role's default sensitive-action grant.
function roleDefaultSensitive(role, roleConfig, key) {
  var sa = roleConfig && roleConfig.sensitiveActions;
  if (sa && sa[key] !== undefined) return sa[key] === true;
  return defaultSensitiveActionsForRole(role)[key] === true;
}
// Manager ceiling: a level index for comparison (custom treated as full so a
// manager is never blocked from matching an admin-set custom default).
function _lvlIdx(lv) { var i = MODULE_LEVELS.indexOf(lv); return i < 0 ? MODULE_LEVELS.length - 1 : i; }

function loadAdminUsers() {
  if (adminUsersLoaded) { renderUsersList(); loadPendingInvites(); return; }
  if (!can('employees', 'view')) {
    document.getElementById('usersEmpty').style.display = '';
    document.getElementById('usersEmpty').innerHTML = '<p>You do not have permission to manage users.</p>';
    return;
  }
  // Pre-load roles so openUserPermissionsPanel always has Firebase role config
  if (!rolesLoaded && can('employees', 'view')) loadRoles();
  document.getElementById('usersLoading').style.display = '';
  MastDB.adminUsers.list().then(function(snap) {
    adminUsers = snap || {};
    adminUsersLoaded = true;
    document.getElementById('usersLoading').style.display = 'none';
    renderUsersList();
    loadPendingInvites();
  }).catch(function(err) {
    console.error('Failed to load admin users:', err);
    document.getElementById('usersLoading').style.display = 'none';
  });
}

function loadRoles() {
  if (rolesLoaded) { populateRoleSelector(); return; }
  if (!can('employees', 'view')) return;
  MastDB.roles.get().then(function(snap) {
    rolesData = snap || DEFAULT_ROLES;
    rolesLoaded = true;
    populateRoleSelector();
  }).catch(function(err) {
    console.error('Failed to load roles:', err);
    rolesData = DEFAULT_ROLES;
    rolesLoaded = true;
    populateRoleSelector();
  });
}

function switchEmployeesView(view, uid) {
  var items = document.querySelectorAll('#empSubNav .view-tab');
  items.forEach(function(item) { item.classList.remove('active'); });
  var usersV = document.getElementById('empUsersView');
  var rolesV = document.getElementById('empRolesView');
  var detailV = document.getElementById('empDetailView');
  var subNav = document.getElementById('empSubNav');
  if (view === 'detail') {
    // Detail view replaces both sub-tabs; sub-nav is hidden so the user only
    // sees the user-specific content and the "← Back to Users" affordance.
    if (subNav) subNav.style.display = 'none';
    if (usersV) usersV.style.display = 'none';
    if (rolesV) rolesV.style.display = 'none';
    if (detailV) { detailV.style.display = ''; renderUserDetail(uid); }
    return;
  }
  if (subNav) subNav.style.display = '';
  if (detailV) { detailV.style.display = 'none'; detailV.innerHTML = ''; }
  if (view === 'users') {
    if (items[0]) items[0].classList.add('active');
    if (usersV) usersV.style.display = '';
    if (rolesV) rolesV.style.display = 'none';
    renderUsersList();
  } else {
    if (items[1]) items[1].classList.add('active');
    if (usersV) usersV.style.display = 'none';
    if (rolesV) rolesV.style.display = '';
    renderPermissionMatrix();
  }
}

function renderUsersList() {
  var tbody = document.getElementById('usersTableBody');
  var emptyEl = document.getElementById('usersEmpty');
  var tableEl = document.getElementById('usersTableWrap');
  var roleOrder = { admin: 0, manager: 1, user: 2, guest: 3 };
  // Archive: hide archived users by default; a "Show archived (N)" toggle
  // (injected above the table) reveals them. Archived users stay in the data
  // (history preserved) — just filtered out of the default view.
  var allEntries = Object.entries(adminUsers);
  var archivedCount = allEntries.filter(function(p) { return p[1] && p[1].archived === true; }).length;
  (function() {
    var tog = document.getElementById('usersArchivedToggle');
    if (!tog && tableEl && tableEl.parentNode) {
      tog = document.createElement('div');
      tog.id = 'usersArchivedToggle';
      tog.style.cssText = 'margin:0 0 12px;font-size:0.85rem;';
      tableEl.parentNode.insertBefore(tog, tableEl);
    }
    if (tog) {
      if (archivedCount === 0) { tog.style.display = 'none'; tog.innerHTML = ''; }
      else {
        tog.style.display = '';
        tog.innerHTML = '<label style="cursor:pointer;display:inline-flex;align-items:center;gap:6px;color:var(--warm-gray);">' +
          '<input type="checkbox"' + (showArchivedUsers ? ' checked' : '') + ' onchange="window.toggleShowArchivedUsers(this.checked)"> ' +
          'Show archived (' + archivedCount + ')</label>';
      }
    }
  })();
  var users = allEntries.filter(function(p) {
    return showArchivedUsers || !(p[1] && p[1].archived === true);
  }).sort(function(a, b) {
    var ra = roleOrder[a[1].role] !== undefined ? roleOrder[a[1].role] : 99;
    var rb = roleOrder[b[1].role] !== undefined ? roleOrder[b[1].role] : 99;
    if (ra !== rb) return ra - rb;
    return (a[1].displayName || '').localeCompare(b[1].displayName || '');
  });

  if (users.length === 0) {
    emptyEl.style.display = '';
    tableEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  tableEl.style.display = '';

  // Dropdown options always come from the canonical AII enum so the UI cannot
  // silently drop a role it doesn't recognize. Custom roles in rolesData
  // (beyond the canonical set) are appended after.
  var canonicalKeys = CANONICAL_ROLES.slice();
  var extraKeys = Object.keys(rolesData).filter(function(rk) {
    return canonicalKeys.indexOf(rk) === -1;
  });
  var roleKeys = canonicalKeys.concat(extraKeys);

  tbody.innerHTML = '';
  users.forEach(function(pair) {
    var uid = pair[0];
    var u = pair[1];
    var lastLogin = u.lastLoginAt ? MastFormat.date(u.lastLoginAt) : 'Never';
    // For guests with an expiry, replace Last Login column with expiry date
    if (u.role === 'guest' && u.accessExpiry) {
      var expiryDate = new Date(u.accessExpiry);
      var now = new Date();
      var isExpired = expiryDate < now;
      lastLogin = (isExpired
        ? '<span style="color:rgba(239,68,68,1);font-size:0.78rem;">Expired ' + MastFormat.date(expiryDate) + '</span>'
        : '<span style="font-size:0.78rem;">Expires ' + MastFormat.date(expiryDate) + '</span>');
    }
    // Preserve the raw role value — never coerce. An empty/missing role is
    // treated as 'guest' (lowest privilege) by the underlying access checks,
    // but for display we surface unknown values explicitly so the operator
    // sees them and the dropdown cannot silently promote them.
    var role = u.role || 'guest';
    var known = isKnownRole(role) || (rolesData && rolesData[role]);
    var roleBadgeClass = known ? (role === 'admin' || role === 'manager' || role === 'user' || role === 'guest' ? role : 'unknown') : 'unknown';
    var isSelf = currentUser && uid === currentUser.uid;

    var avatar = u.photoURL
      ? '<img class="user-avatar" src="' + u.photoURL + '" alt="">'
      : '<span style="display:inline-block;width:32px;height:32px;border-radius:50%;background:var(--cream-dark);text-align:center;line-height:32px;font-size:0.85rem;margin-right:8px;">' + (u.displayName || '?').charAt(0).toUpperCase() + '</span>';

    var roleCell;
    if (can('employees', 'edit') && !isSelf) {
      var opts = '';
      var selectClass = 'user-role-select';
      // Finding A fix: if the stored role is not in the canonical/known set,
      // prepend an explicit "Unknown role: <value>" option pre-selected so the
      // operator sees the real value and Save cannot silently coerce to admin.
      if (!known) {
        opts += '<option value="' + esc(role) + '" selected disabled>Unknown role: ' + esc(role) + '</option>';
        selectClass += ' unknown-role';
      }
      roleKeys.forEach(function(rk) {
        var selected = (known && rk === role) ? ' selected' : '';
        var rName = ROLE_DISPLAY_NAMES[rk] || (rolesData[rk] ? rolesData[rk].name : rk);
        opts += '<option value="' + rk + '"' + selected + '>' + rName + '</option>';
      });
      var titleAttr = known ? '' : ' title="This user has a role value not recognized by the UI. Pick a known role to normalize, or leave alone."';
      roleCell = '<select class="' + selectClass + '" onchange="changeUserRole(\'' + uid + '\', this.value)"' + titleAttr + '>' + opts + '</select>';
      if (!known) {
        roleCell += ' <span style="font-size:0.72rem;color:rgba(198,40,40,1);">&#9888; unknown</span>';
      }
    } else {
      var displayLabel = known
        ? (ROLE_DISPLAY_NAMES[role] || (rolesData[role] ? rolesData[role].name : role))
        : ('Unknown: ' + role);
      roleCell = '<span class="status-badge role-badge ' + roleBadgeClass + '">' + esc(displayLabel) + '</span>' +
        (isSelf ? ' <span style="font-size:0.72rem;color:var(--warm-gray);">(you)</span>' : '');
    }

    // Customized badge: show when user has active permission overrides
    var overrideCount = userOverrideCount(u);
    if (overrideCount > 0) {
      roleCell += ' <span class="status-badge" style="font-size:0.72rem;background:rgba(245,158,11,0.15);color:rgba(180,83,9,1);border:1px solid rgba(245,158,11,0.3);">customized (' + overrideCount + ')</span>';
    }
    if (u.archived === true) {
      roleCell += ' <span class="status-badge" style="font-size:0.72rem;background:rgba(120,120,120,0.18);color:rgba(154,160,166,1);border:1px solid rgba(120,120,120,0.35);">Archived</span>';
    }

    var actionsCell = '';
    if (!isSelf) {
      actionsCell += '<button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="viewUserAudit(\'' + uid + '\')">History</button>';
      if (can('employees', 'edit')) {
        actionsCell += ' <button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="openUserPermissionsPanel(\'' + uid + '\')">Edit Permissions</button>';
        // Send password reset — for a locked-out password user. For a Google-SSO
        // user it's the wrong fix (they have no password); the confirm dialog
        // surfaces their provider so the admin doesn't fire a pointless reset.
        if (u.archived !== true) {
          actionsCell += ' <button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="sendUserPasswordReset(\'' + uid + '\')">Send password reset</button>';
        }
        if (u.archived === true) {
          actionsCell += ' <button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="archiveUser(\'' + uid + '\', false)">Unarchive</button>';
        } else {
          actionsCell += ' <button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;color:rgba(198,40,40,1);" onclick="archiveUser(\'' + uid + '\', true)">Archive</button>';
        }
      }
    }

    var tr = document.createElement('tr');
    if (u.archived === true) tr.style.opacity = '0.55';
    // Row click → user detail view (admins only, since the Permissions
    // screen is admin-gated anyway). Inner controls (selects, buttons)
    // continue to fire their own handlers thanks to the BUTTON/SELECT/INPUT
    // bail-out in the click listener.
    if (can('employees', 'edit')) {
      tr.style.cursor = 'pointer';
      (function(rowUid, rowEl) {
        rowEl.addEventListener('click', function(ev) {
          var t = ev.target;
          while (t && t !== rowEl) {
            var tag = t.tagName;
            if (tag === 'BUTTON' || tag === 'SELECT' || tag === 'INPUT' || tag === 'A' || tag === 'OPTION') return;
            t = t.parentElement;
          }
          navigateTo('employees', { uid: rowUid, view: 'detail' });
        });
      })(uid, tr);
    }
    // Sign-in provider chip. A "Google" (only) chip is the at-a-glance signal
    // that the user has no password and must use "Sign in with Google".
    var provChip = '';
    if (Array.isArray(u.providers) && u.providers.length) {
      var hasGoogle = u.providers.indexOf('google.com') !== -1;
      var hasPassword = u.providers.indexOf('password') !== -1;
      var provLabel = (hasGoogle && hasPassword) ? 'Google + Password'
        : (hasGoogle ? 'Google' : (hasPassword ? 'Password' : u.providers.join(', ')));
      var googleOnly = hasGoogle && !hasPassword;
      var provStyle = googleOnly
        ? 'background:rgba(66,133,244,0.14);color:rgba(26,115,232,1);border:1px solid rgba(66,133,244,0.3);'
        : 'background:var(--cream-dark);color:var(--warm-gray);';
      var provTitle = googleOnly
        ? "Signs in with Google only — no password. This user must use “Sign in with Google” (a password reset won't help)."
        : 'Sign-in method';
      provChip = ' <span class="status-badge" style="font-size:0.72rem;' + provStyle + '" title="' + esc(provTitle) + '">' + esc(provLabel) + '</span>';
    }
    tr.innerHTML = '<td>' + avatar + esc(u.displayName || 'Unnamed') + '</td>' +
      '<td>' + esc(u.email || '—') + provChip + '</td>' +
      '<td>' + roleCell + '</td>' +
      '<td>' + lastLogin + '</td>' +
      '<td>' + actionsCell + '</td>';
    tbody.appendChild(tr);
  });

  // Show pending invites
  var inviteEntries = Object.entries(pendingInvites).filter(function(p) { return p[1].status === 'pending'; });
  if (inviteEntries.length > 0) {
    inviteEntries.forEach(function(pair) {
      var inv = pair[1];
      var invKey = pair[0];
      var roleName = ROLE_DISPLAY_NAMES[inv.role] || inv.role;
      var tr = document.createElement('tr');
      tr.style.opacity = '0.6';
      tr.innerHTML = '<td><span style="display:inline-block;width:32px;height:32px;border-radius:50%;background:var(--cream-dark);text-align:center;line-height:32px;font-size:0.85rem;margin-right:8px;">✉</span>Pending Invite</td>' +
        '<td>' + esc(inv.email) + '</td>' +
        '<td><span class="status-badge">' + esc(roleName) + '</span></td>' +
        '<td>Invited ' + MastFormat.date(inv.invitedAt) + '</td>' +
        '<td><button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="resendInvite(\'' + invKey + '\')">Resend</button>' +
        ' <button class="btn btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="cancelInvite(\'' + invKey + '\')">Cancel</button></td>';
      tbody.appendChild(tr);
    });
  }
}

async function changeUserRole(uid, newRole) {
  if (!can('employees', 'edit')) {
    showToast('You do not have permission to change user roles.', true);
    return;
  }
  var user = adminUsers[uid];
  if (!user) return;
  var oldRole = user.role;
  if (oldRole === newRole) return;
  // Belt-and-suspenders Finding A defense: refuse to write a role the UI
  // doesn't recognize as canonical or as a configured custom role.
  if (!isKnownRole(newRole) && !(rolesData && rolesData[newRole])) {
    showToast('Refusing to assign unrecognized role "' + newRole + '".', true);
    renderUsersList();
    return;
  }

  // Warn if changing another admin's role
  if (oldRole === 'admin') {
    var adminCount = Object.values(adminUsers).filter(function(u) { return u.role === 'admin'; }).length;
    if (adminCount <= 1) {
      showToast('Cannot change role — this is the only admin account.', true);
      renderUsersList(); // reset dropdown
      return;
    }
    if (!await mastConfirm('Change ' + (user.displayName || user.email) + ' from Owner to ' + (ROLE_DISPLAY_NAMES[newRole] || newRole) + '? They will lose Owner access on next login.', { title: 'Change Role', danger: true })) {
      renderUsersList(); // reset dropdown
      return;
    }
  }

  try {
    await EmployeesBridge.changeRole(uid, newRole);
    showToast('Role changed to ' + (ROLE_DISPLAY_NAMES[newRole] || newRole) + '.');
    renderUsersList();
  } catch (err) {
    console.error('Role change failed:', err);
    showToast((err && err.message) || 'Failed to change role.', true);
    renderUsersList();
  }
}

// Archive (soft-disable) / unarchive a user. Archiving disables their Firebase
// Auth account + revokes sessions (server-side, via setUserArchived) so they can
// no longer sign in, while keeping their record + history. Unarchive reverses it.
async function archiveUser(uid, archived) {
  if (!can('employees', 'edit')) {
    showToast('You do not have permission to archive users.', true);
    return;
  }
  var user = adminUsers[uid];
  if (!user) return;
  if (currentUser && uid === currentUser.uid) {
    showToast('You cannot archive your own account.', true);
    return;
  }
  var name = user.displayName || user.email || uid;
  if (archived) {
    var ok = await mastConfirm('Archive ' + name + '? They will be signed out and can no longer log in. Their history is kept, and you can unarchive them anytime.', { title: 'Archive User', danger: true });
    if (!ok) return;
  }
  try {
    await EmployeesBridge.setArchived(uid, archived);
    showToast(name + (archived ? ' archived — they can no longer sign in.' : ' unarchived.'));
    renderUsersList();
  } catch (err) {
    console.error('setUserArchived failed:', err);
    showToast((err && err.message) ? err.message : ('Failed to ' + (archived ? 'archive' : 'unarchive') + ' user.'), true);
  }
}
window.archiveUser = archiveUser;

// ── EmployeesBridge — state-free RBAC write cores shared by legacy + V2 ──
// Every core fresh-reads what it validates against (no reliance on a surface's
// load-once cache: bridge actions must work on records created after either
// surface loaded), writes through the accessor, and stamps writeAudit. UI
// (confirm dialogs, toasts, re-renders) stays with the caller.
window.EmployeesBridge = {
  listUsers: function() {
    return Promise.resolve(MastDB.adminUsers.list()).then(function(t) { return t || {}; });
  },
  listRoles: function() {
    return Promise.resolve(MastDB.roles.list()).then(function(t) { return t || {}; });
  },
  // Effective role config: stored doc layered over the built-in defaults —
  // role docs can be PARTIAL (a doc holding only the perm maps, no name).
  effectiveRole: function(key, doc) {
    var base = DEFAULT_ROLES[key] || {};
    return Object.assign({ key: key }, base, doc || {});
  },
  changeRole: async function(uid, newRole) {
    if (!can('employees', 'edit')) throw new Error('You do not have permission to change user roles.');
    if (!isKnownRole(newRole) && !(rolesData && rolesData[newRole])) {
      // Custom roles may not be in the in-memory cache yet — fresh-read.
      var roleDoc = await MastDB.roles.get(newRole);
      if (!roleDoc) throw new Error('Refusing to assign unrecognized role "' + newRole + '".');
    }
    var users = await this.listUsers();
    var user = users[uid];
    if (!user) throw new Error('User not found.');
    if (user.role === newRole) return { ok: true, unchanged: true };
    if (user.role === 'admin') {
      var admins = Object.keys(users).filter(function(k) { return users[k] && users[k].role === 'admin'; });
      if (admins.length <= 1) throw new Error('Cannot change role — this is the only admin account.');
    }
    await MastDB.adminUsers.update(uid, { role: newRole });
    if (adminUsers[uid]) adminUsers[uid].role = newRole;
    await writeAudit('update', 'users', uid);
    return { ok: true };
  },
  setArchived: async function(uid, archived) {
    if (!can('employees', 'edit')) throw new Error('You do not have permission to archive users.');
    if (currentUser && uid === currentUser.uid) throw new Error('You cannot archive your own account.');
    await firebase.functions().httpsCallable('setUserArchived')({
      tenantId: MastDB.tenantId(), uid: uid, archived: archived
    });
    if (adminUsers[uid]) adminUsers[uid].archived = archived;
    return { ok: true };
  },
  saveRoleMatrix: async function(roleKey, modulePermissions, sensitiveActions) {
    if (!can('employees', 'edit')) throw new Error('You do not have permission to edit roles.');
    if (roleKey === 'admin') throw new Error('The Admin role always has full access.');
    await MastDB.roles.setModulePermissions(roleKey, modulePermissions);
    await MastDB.roles.setSensitiveActions(roleKey, sensitiveActions);
    if (!rolesData[roleKey]) rolesData[roleKey] = {};
    rolesData[roleKey].modulePermissions = modulePermissions;
    rolesData[roleKey].sensitiveActions = sensitiveActions;
    await writeAudit('update', 'roles', roleKey);
    // If editing own role, re-apply per-module gates live.
    if (roleKey === currentUserRole) {
      currentRoleConfig.modulePermissions = modulePermissions;
      currentRoleConfig.sensitiveActions = sensitiveActions;
      applyModuleFilter();
      applyModuleWriteGate(currentRoute);
    }
    return { ok: true };
  },
  createRole: async function(key, name, desc) {
    if (!can('employees', 'edit')) throw new Error('You do not have permission to create roles.');
    key = String(key || '').trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
    name = String(name || '').trim();
    if (!key || !name) throw new Error('Role key and name are required.');
    var existing = (rolesData && rolesData[key]) || await MastDB.roles.get(key);
    if (existing) throw new Error('A role with key "' + key + '" already exists.');
    // New custom roles start locked down (every module None, no sensitive
    // actions); the operator builds access up in the matrix.
    var modulePermissions = {};
    getModulePermRegistry().forEach(function(g) {
      g.routes.forEach(function(m) { modulePermissions[m.route] = levelToTriad('none'); });
    });
    var sensitiveActions = {};
    FUNCTION_PERMISSIONS.forEach(function(fp) { sensitiveActions[_sensitiveKey(fp.entity, fp.action)] = false; });
    var roleData = {
      name: name, description: String(desc || '').trim(), isDefault: false,
      navSections: null, modulePermissions: modulePermissions, sensitiveActions: sensitiveActions
    };
    await MastDB.roles.set(key, roleData);
    rolesData[key] = roleData;
    await writeAudit('create', 'roles', key);
    return { ok: true, key: key, role: roleData };
  }
};

window.toggleShowArchivedUsers = function(checked) {
  showArchivedUsers = !!checked;
  renderUsersList();
};

var auditLogFromEmployees = false;
function viewUserAudit(uid) {
  // Set actor filter and switch to audit log
  auditLogFromEmployees = true;
  navigateTo('auditlog');
  setTimeout(function() {
    document.getElementById('auditFilterActor').value = uid;
    renderAuditLog();
    // Show back-to-employees link
    var header = document.querySelector('#auditLogTab .section-header');
    if (header && !document.getElementById('auditBackToEmployees')) {
      var backBtn = document.createElement('button');
      backBtn.id = 'auditBackToEmployees';
      backBtn.className = 'btn btn-secondary';
      backBtn.style.cssText = 'font-size:0.85rem;padding:5px 12px;margin-bottom:12px;';
      backBtn.innerHTML = '&#8592; Back to Employees';
      backBtn.onclick = function() {
        auditLogFromEmployees = false;
        backBtn.remove();
        navigateTo('employees');
      };
      header.parentNode.insertBefore(backBtn, header);
    }
  }, 100);
}

// ============================================================
// Per-User Permission Override Editor (RBAC Phase 1 — Section 2)
// ============================================================
// E6 per-user editor: per-module access LEVEL overrides + sensitive-action
// overrides, relative to the user's role defaults. Manager ceiling: can reduce
// below the role default but not elevate above it (CF re-enforces server-side).
// seedMode 'stored' (default) seeds from the user's saved overrides; 'defaults'
// resets every module/action to the role default (the Reset button).
function _userLevelSelectHtml(route, currentLevel, defaultLevel, isAdmin) {
  var ceiling = isAdmin ? (MODULE_LEVELS.length - 1) : _lvlIdx(defaultLevel);
  // Admin-granted elevation already above the manager's ceiling → lock the select.
  var locked = (!isAdmin && _lvlIdx(currentLevel) > ceiling);
  var opts = '';
  MODULE_LEVELS.forEach(function(lv, i) {
    var dis = (!locked && i > ceiling) ? ' disabled' : '';
    opts += '<option value="' + lv + '"' + (lv === currentLevel ? ' selected' : '') + dis + '>' + _levelLabel(lv) + '</option>';
  });
  if (currentLevel === 'custom') opts += '<option value="custom" selected>Custom</option>';
  return '<select class="mod-level-select"' + (locked ? ' disabled title="Owner-granted — cannot be changed by Manager"' : '') +
    ' onchange="setUserModuleLevel(\'' + esc(route) + '\', this.value)">' + opts + '</select>';
}

function openUserPermissionsPanel(uid, seedMode) {
  if (!can('employees', 'edit')) {
    showToast('You do not have permission to edit user permissions.', true);
    return;
  }
  var u = adminUsers[uid];
  if (!u) return;
  _userPanelUid = uid;

  var role = u.role || 'guest';
  var roleConfig = rolesData[role] || DEFAULT_ROLES[role];
  var modOv = (seedMode === 'defaults') ? {} : (u.moduleOverrides || {});
  var senOv = (seedMode === 'defaults') ? {} : (u.permissionOverrides || {});
  var isEditorAdmin = (currentUserRole === 'admin');
  var roleName = ROLE_DISPLAY_NAMES[role] || (roleConfig ? roleConfig.name : role);

  // Seed effective buffers (override if set, else role default).
  editingUserModuleLevels = {};
  getModulePermRegistry().forEach(function(g) {
    g.routes.forEach(function(m) {
      editingUserModuleLevels[m.route] = (modOv[m.route]) ? triadToLevel(modOv[m.route]) : roleDefaultModuleLevel(role, roleConfig, m.route);
    });
  });
  editingUserSensitive = {};
  FUNCTION_PERMISSIONS.forEach(function(fp) {
    var k = _sensitiveKey(fp.entity, fp.action);
    editingUserSensitive[k] = (senOv[k] !== undefined) ? senOv[k] === true : roleDefaultSensitive(role, roleConfig, k);
  });

  // Module accordion (collapsed; per-section override count).
  var modulesHtml = '';
  getModulePermRegistry().forEach(function(g) {
    var overrideCount = 0;
    var rows = g.routes.map(function(m) {
      var def = roleDefaultModuleLevel(role, roleConfig, m.route);
      var cur = editingUserModuleLevels[m.route];
      var isOv = cur !== def;
      if (isOv) overrideCount++;
      return '<tr data-mod-route="' + esc(m.route) + '"' + (isOv ? ' style="background:rgba(245,158,11,0.10);"' : '') + '>' +
        '<td>' + esc(m.label) + (isOv ? ' <span style="font-size:0.72rem;color:var(--warm-gray);">role: ' + def + '</span>' : '') + '</td>' +
        '<td style="text-align:right;">' + _userLevelSelectHtml(m.route, cur, def, isEditorAdmin) + '</td>' +
      '</tr>';
    }).join('');
    modulesHtml += '<div class="mod-access-group" data-mod-section="' + esc(g.section) + '">' +
      '<div class="mod-access-header" onclick="toggleModuleAccordion(\'' + esc(g.section) + '\')">' +
        '<span><span class="mod-access-caret">›</span>' + esc(g.label) +
          (overrideCount ? ' <span style="color:var(--amber,rgba(196,133,60,1));font-size:0.72rem;font-weight:600;">(' + overrideCount + ' override' + (overrideCount > 1 ? 's' : '') + ')</span>' : '') + '</span>' +
      '</div>' +
      '<div class="mod-access-body"><table class="perm-matrix" style="width:100%;min-width:0;"><tbody>' + rows + '</tbody></table></div>' +
    '</div>';
  });

  // Sensitive actions.
  var funcRows = FUNCTION_PERMISSIONS.map(function(fp) {
    var k = _sensitiveKey(fp.entity, fp.action);
    var def = roleDefaultSensitive(role, roleConfig, k);
    var cur = editingUserSensitive[k];
    var isOv = cur !== def;
    var disabledAttr = (!isEditorAdmin && !def) ? ' disabled title="Below role ceiling — only Owner can grant this"' : '';
    return '<tr' + (isOv ? ' style="background:rgba(245,158,11,0.10);"' : '') + '>' +
      '<td style="font-size:0.85rem;"><strong>' + esc(fp.label) + '</strong>' +
        '<div style="font-size:0.72rem;color:var(--warm-gray);">' + esc(fp.description) + (isOv ? ' · role: ' + (def ? 'allowed' : 'denied') : '') + '</div></td>' +
      '<td style="text-align:center;"><input type="checkbox"' + (cur ? ' checked' : '') + disabledAttr +
        ' onchange="toggleUserSensitive(\'' + esc(k) + '\', this.checked)"></td>' +
    '</tr>';
  }).join('');

  var guestExpiryField = '';
  if (role === 'guest') {
    var expiryVal = u.accessExpiry ? u.accessExpiry.substring(0, 10) : '';
    guestExpiryField = '<div class="form-group" style="margin-bottom:16px;">' +
      '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:6px;">Access Expires On</label>' +
      '<input type="date" id="userPanelExpiry" value="' + esc(expiryVal) + '" style="padding:7px 10px;border:1px solid var(--cream-dark);border-radius:6px;font-size:0.85rem;background:var(--surface);color:var(--text,rgba(42,42,42,1));">' +
      '<p style="font-size:0.72rem;color:var(--warm-gray);margin-top:4px;">Stored for display — enforcement is Phase 3.</p>' +
    '</div>';
  }

  var html = '<div class="modal-header">' +
    '<h3>Edit Permissions — ' + esc(u.displayName || u.email || 'User') + '</h3>' +
    '<button class="modal-close" onclick="closeModal()">&times;</button>' +
  '</div>' +
  '<div class="modal-body" style="max-height:70vh;overflow-y:auto;">' +
    '<div style="display:flex;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap;">' +
      '<span style="font-size:0.85rem;color:var(--warm-gray);">' + esc(u.email || '') + '</span>' +
      '<span class="status-badge role-badge ' + esc(role) + '" style="font-size:0.72rem;">' + esc(roleName) + '</span>' +
    '</div>' +
    guestExpiryField +
    '<p style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">Overrides for this user, relative to the <strong>' + esc(roleName) + '</strong> role. Highlighted rows differ from the role default. ' +
      (isEditorAdmin ? 'As Owner you can set any level.' : 'As Manager you can reduce below the role default but not elevate above it.') + '</p>' +
    '<div id="userPanelModules">' + modulesHtml + '</div>' +
    '<div style="margin-top:20px;">' +
      '<h4 style="font-size:0.9rem;margin:0 0 4px;">Sensitive Actions</h4>' +
      '<p style="font-size:0.72rem;color:var(--warm-gray);margin:0 0 8px;">High-trust verbs, gated independently of module access.</p>' +
      '<table class="perm-matrix" style="width:100%;"><thead><tr><th>Action</th><th>Allowed</th></tr></thead><tbody>' + funcRows + '</tbody></table>' +
    '</div>' +
    '<div style="margin-top:14px;display:flex;justify-content:space-between;align-items:center;">' +
      '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="resetUserOverrides(\'' + esc(uid) + '\')">Reset to Role Defaults</button>' +
      '<div style="display:flex;gap:8px;">' +
        '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
        '<button class="btn btn-primary" onclick="saveUserPermissionOverrides(\'' + esc(uid) + '\')">Save</button>' +
      '</div>' +
    '</div>' +
  '</div>';

  openModal(html);
}
