/**
 * Create-Role modal — the "+ New Role" dialog in the Users & Roles settings.
 *
 * Extracted from app/index.html's inline block (decomposition master plan,
 * Track 1). Lazy-loaded on demand via the eager `openCreateRoleModal` shim in
 * index.html (the "+ New Role" button is static markup). Reads only eager
 * globals (can, showToast, openModal, closeModal, EmployeesBridge,
 * populateRoleSelector, renderPermissionMatrix), all present before a user can
 * open the dialog. saveNewRole is the modal's own submit handler.
 */
(function () {
  'use strict';

  function openCreateRoleModal() {
    if (!can('employees', 'edit')) {
      showToast('You do not have permission to create roles.', true);
      return;
    }
    var html = '<div class="modal-header">' +
      '<h3>Create New Role</h3>' +
      '<button class="modal-close" onclick="closeModal()">&times;</button>' +
    '</div>' +
    '<div class="modal-body">' +
      '<div class="form-group">' +
        '<label for="newRoleKey">Role Key *</label>' +
        '<input type="text" id="newRoleKey" placeholder="e.g. manager" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
        '<p style="font-size:0.72rem;color:var(--warm-gray);margin-top:4px;">Lowercase, no spaces. Used as the identifier.</p>' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="newRoleName">Display Name *</label>' +
        '<input type="text" id="newRoleName" placeholder="e.g. Manager" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
      '</div>' +
      '<div class="form-group">' +
        '<label for="newRoleDesc">Description</label>' +
        '<input type="text" id="newRoleDesc" placeholder="Brief description of this role" style="width:100%;padding:8px;border:1px solid var(--cream-dark);border-radius:6px;">' +
      '</div>' +
    '</div>' +
    '<div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Cancel</button>' +
      '<button class="btn btn-primary" onclick="saveNewRole()">Create Role</button>' +
    '</div>';
    openModal(html);
    setTimeout(function() { document.getElementById('newRoleKey').focus(); }, 100);
  }

  async function saveNewRole() {
    var key = (document.getElementById('newRoleKey').value || '').trim();
    var name = (document.getElementById('newRoleName').value || '').trim();
    var desc = (document.getElementById('newRoleDesc').value || '').trim();

    try {
      var res = await EmployeesBridge.createRole(key, name, desc);
      closeModal();
      populateRoleSelector();
      document.getElementById('roleSelector').value = res.key;
      renderPermissionMatrix();
      showToast('Role "' + name + '" created. Set permissions below.');
    } catch (err) {
      console.error('Create role failed:', err);
      showToast((err && err.message) || 'Failed to create role.', true);
    }
  }

  // Impl for the eager shim + the modal's onclick submit target.
  window.openCreateRoleModalImpl = openCreateRoleModal;
  window.saveNewRole = saveNewRole;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('createRoleModal', {});
  }
})();
