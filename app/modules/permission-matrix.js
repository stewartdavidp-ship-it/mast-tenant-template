// app/modules/permission-matrix.js  (T1 extraction)
//
// Role & Permission Matrix UI (Phase E3): the role selector + view/edit/delete
// triad matrix, the module-access-level matrix, the sensitive-actions list, and
// the save/reset/create-role controls. Extracted byte-identical from the inline
// block in index.html. Top-level functions stay window globals (the inline block
// is not an IIFE), so the role-view markup handlers and switchEmployeesView
// (users-admin.js) still resolve renderPermissionMatrix / renderModuleAccessMatrix
// et al. Cross-module globals (editingModulePermissions, editingSensitiveActions,
// MODULE_LEVELS) resolve at call time, post-load.

// ============================================================
// Permission Matrix (Phase E3)
// ============================================================
function populateRoleSelector() {
  var sel = document.getElementById('roleSelector');
  if (!sel) return;
  var current = sel.value;
  // Show canonical AII roles first, then any extra custom roles in rolesData.
  var canonicalKeys = CANONICAL_ROLES.slice();
  var extraKeys = Object.keys(rolesData).filter(function(rk) {
    return canonicalKeys.indexOf(rk) === -1;
  });
  var roleKeys = canonicalKeys.concat(extraKeys);
  sel.innerHTML = '';
  roleKeys.forEach(function(rk) {
    var rName = ROLE_DISPLAY_NAMES[rk] || (rolesData[rk] ? rolesData[rk].name : (DEFAULT_ROLES[rk] ? DEFAULT_ROLES[rk].name : rk));
    sel.innerHTML += '<option value="' + rk + '">' + rName + '</option>';
  });
  if (current && roleKeys.indexOf(current) !== -1) sel.value = current;
  renderPermissionMatrix();
}

function renderPermissionMatrix() {
  var sel = document.getElementById('roleSelector');
  if (!sel) return;
  var roleKey = sel.value;
  var role = rolesData[roleKey] || DEFAULT_ROLES[roleKey];
  if (!role) return;

  // Show description
  var descEl = document.getElementById('roleDescription');
  descEl.textContent = role.description || '';

  var isAdminRole = role.isDefault && roleKey === 'admin';
  _permRoleKey = roleKey;
  _permIsAdmin = isAdminRole;

  // Seed editing buffers from the role's stored values, else its default-level
  // triad / default sensitive grants. The triad is canonical; the UI projects
  // it to a Level picker.
  editingModulePermissions = {};
  getModulePermRegistry().forEach(function(g) {
    g.routes.forEach(function(m) {
      editingModulePermissions[m.route] = roleModuleTriad(roleKey, role, m.route);
    });
  });
  editingSensitiveActions = {};
  FUNCTION_PERMISSIONS.forEach(function(fp) {
    var k = _sensitiveKey(fp.entity, fp.action);
    var sa = role.sensitiveActions;
    editingSensitiveActions[k] = (sa && sa[k] !== undefined) ? !!sa[k] : !!fp.roleDefaults[roleKey];
  });

  // Legacy Entity grid removed — clear its table body if the element lingers.
  var oldBody = document.getElementById('permMatrixBody');
  if (oldBody) oldBody.innerHTML = '';

  renderModuleAccessMatrix();
  renderSensitiveActions();

  // Show/hide save buttons based on editability
  var actionsEl = document.getElementById('permMatrixActions');
  actionsEl.style.display = can('employees', 'edit') ? '' : 'none';
}

// ============================================================
// Module Access matrix (E6) — ONE matrix, per-module access LEVEL
// (None / View / Edit / Full, or Custom) projected from the canonical
// {view,edit,delete} triad in editingModulePermissions.
// ============================================================
function _levelLabel(lv) { return lv.charAt(0).toUpperCase() + lv.slice(1); }

// A level <select>. For a section bulk picker, key is "__section__:<id>" and
// the selected option is the "Set all…" placeholder.
function _levelSelectHtml(key, currentLevel, dis) {
  var isBulk = key.indexOf('__section__:') === 0;
  var opts = isBulk ? '<option value="" selected>Set all…</option>' : '';
  ['none', 'view', 'edit', 'full'].forEach(function(lv) {
    opts += '<option value="' + lv + '"' + (!isBulk && lv === currentLevel ? ' selected' : '') + '>' + _levelLabel(lv) + '</option>';
  });
  if (!isBulk && currentLevel === 'custom') opts += '<option value="custom" selected>Custom</option>';
  return '<select class="mod-level-select"' + dis + ' onchange="onModuleLevelChange(\'' + esc(key) + '\', this.value)">' + opts + '</select>';
}

function renderModuleAccessMatrix() {
  var wrap = document.getElementById('moduleAccessSection');
  if (!wrap) return;
  var dis = _permIsAdmin ? ' disabled title="Admin has full access to every module"' : '';
  var html = '<h4 style="font-size:0.9rem;margin:0 0 4px;">Module Access</h4>' +
    '<p style="font-size:0.72rem;color:var(--warm-gray);margin:0 0 10px;">One access level per module. ' +
      '<strong>None</strong> hides it; <strong>View</strong> opens it read-only; <strong>Edit</strong> adds create + update; ' +
      '<strong>Full</strong> adds delete. Use a section’s <em>Set all</em> to bulk-apply.</p>';

  getModulePermRegistry().forEach(function(g) {
    var counts = { none: 0, view: 0, edit: 0, full: 0, custom: 0 };
    g.routes.forEach(function(m) { counts[triadToLevel(editingModulePermissions[m.route])]++; });
    var parts = [];
    ['full', 'edit', 'view', 'custom', 'none'].forEach(function(lv) { if (counts[lv]) parts.push(counts[lv] + ' ' + _levelLabel(lv)); });

    html += '<div class="mod-access-group" data-mod-section="' + esc(g.section) + '">' +
      '<div class="mod-access-header" onclick="toggleModuleAccordion(\'' + esc(g.section) + '\')">' +
        '<span><span class="mod-access-caret">›</span>' + esc(g.label) +
          ' <span style="font-weight:400;color:var(--warm-gray);font-size:0.72rem;">(' + parts.join(' · ') + ')</span></span>' +
        '<span class="mod-access-bulk" onclick="event.stopPropagation();">Set all ' + _levelSelectHtml('__section__:' + g.section, '', dis) + '</span>' +
      '</div>' +
      '<div class="mod-access-body"><table class="perm-matrix" style="width:100%;min-width:0;"><tbody>';

    g.routes.forEach(function(m) {
      var lv = triadToLevel(editingModulePermissions[m.route]);
      html += '<tr data-mod-route="' + esc(m.route) + '">' +
        '<td>' + esc(m.label) + '</td>' +
        '<td style="text-align:right;">' + _levelSelectHtml(m.route, lv, dis) + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div></div>';
  });
  wrap.innerHTML = html;
}

function onModuleLevelChange(key, level) {
  var expandSection;
  if (key.indexOf('__section__:') === 0) {
    var section = key.slice('__section__:'.length);
    if (!level) return; // "Set all…" placeholder
    var grp = null;
    getModulePermRegistry().forEach(function(g) { if (g.section === section) grp = g; });
    if (grp) grp.routes.forEach(function(m) { editingModulePermissions[m.route] = levelToTriad(level); });
    expandSection = section;
  } else {
    if (level === 'custom') return; // not a selectable target
    editingModulePermissions[key] = levelToTriad(level);
    expandSection = _moduleSectionFor(key);
  }
  renderModuleAccessMatrix();
  if (expandSection) {
    var el = document.querySelector('.mod-access-group[data-mod-section="' + expandSection + '"]');
    if (el) el.classList.add('open');
  }
}

function toggleModuleAccordion(section) {
  var el = document.querySelector('.mod-access-group[data-mod-section="' + section + '"]');
  if (el) el.classList.toggle('open');
}

// Sensitive (high-trust) actions — boolean Allowed toggles, kept distinct from
// module access. Rendered below the module matrix.
function renderSensitiveActions() {
  var wrap = document.getElementById('funcPermSection');
  if (!wrap) return;
  var dis = _permIsAdmin ? ' disabled title="Admin has full access"' : '';
  var rows = FUNCTION_PERMISSIONS.map(function(fp) {
    var k = _sensitiveKey(fp.entity, fp.action);
    var modLabel = (window.MODE_MODULE_INFO && MODE_MODULE_INFO[fp.module] && MODE_MODULE_INFO[fp.module].label) || fp.module;
    return '<tr>' +
      '<td style="font-size:0.85rem;"><strong>' + esc(fp.label) + '</strong>' +
        '<div style="font-size:0.72rem;color:var(--warm-gray);">' + esc(fp.description) + ' · ' + esc(modLabel) + '</div></td>' +
      '<td style="text-align:center;"><input type="checkbox"' + (editingSensitiveActions[k] ? ' checked' : '') + dis +
        ' onchange="toggleSensitiveAction(\'' + esc(k) + '\', this.checked)"></td>' +
    '</tr>';
  }).join('');
  wrap.innerHTML =
    '<h4 style="font-size:0.9rem;margin:0 0 4px;">Sensitive Actions</h4>' +
    '<p style="font-size:0.72rem;color:var(--warm-gray);margin:0 0 8px;">High-trust verbs, gated independently of module access.</p>' +
    '<table class="perm-matrix" style="width:100%;"><thead><tr><th>Action</th><th>Allowed</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function toggleSensitiveAction(key, value) { editingSensitiveActions[key] = value === true; }

async function savePermissionMatrix() {
  if (!can('employees', 'edit')) {
    showToast('You do not have permission to edit roles.', true);
    return;
  }
  var roleKey = document.getElementById('roleSelector').value;
  if (!roleKey) return;

  try {
    await EmployeesBridge.saveRoleMatrix(roleKey, editingModulePermissions, editingSensitiveActions);
    showToast('Permissions saved for ' + ((rolesData[roleKey] && rolesData[roleKey].name) || roleKey) + '.');
  } catch (err) {
    console.error('Save permissions failed:', err);
    showToast((err && err.message) || 'Failed to save permissions.', true);
  }
}

function resetPermissionMatrix() {
  renderPermissionMatrix();
  showToast('Permissions reset to saved state.');
}

// Create-Role modal (openCreateRoleModal / saveNewRole) extracted to
// app/modules/create-role-modal.js — lazy-loaded via this eager shim
// (the "+ New Role" button is static markup). (Decomposition Track 1.)
function openCreateRoleModal() {
  MastAdmin.loadModule('createRoleModal').then(function() {
    if (typeof window.openCreateRoleModalImpl === 'function') window.openCreateRoleModalImpl();
  }).catch(function() {});
}
window.openCreateRoleModal = openCreateRoleModal;
