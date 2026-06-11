/**
 * employees-v2.js — Team access, V2 (record hub: Members + Roles lenses).
 *
 * Conversion of legacy #employees (Permissions): the Users list, the per-role
 * permission matrix, and the user detail's role/archive verbs. One hub, two
 * lenses over the two RBAC objects:
 *   • Members — admin/users docs (who can sign in, what role they hold).
 *     SO read view + Edit (role change) + Archive/Unarchive actions.
 *   • Roles — admin/roles docs layered over DEFAULT_ROLES (docs can be
 *     PARTIAL — sgtest15's `user` doc holds only the perm maps). SO read view
 *     (per-section access levels + sensitive actions) + Edit (matrix as
 *     per-module Level pickers) + CREATE (new locked-down custom role).
 *
 * ALL writes delegate to window.EmployeesBridge (state-free cores in
 *  index.html, shared with the legacy surface): changeRole / setArchived /
 * saveRoleMatrix / createRole. The bridge fresh-reads its targets, validates
 * (last-admin guard, unknown-role refusal, self-archive block, admin-role
 * matrix lock), writes through accessors and stamps writeAudit — this twin
 * never re-implements a write.
 *
 * Out of scope (classic escape, debt-registered): per-user permission
 * OVERRIDES editing (CF updateUserPermissions) — the SO shows the override
 * count read-only and links to the classic page.
 *
 * Flag-gated (?ui=1) at #employees-v2, side-by-side with legacy #employees.
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

  var U = window.MastUI, N = U.Num, esc = U._esc;

  var V2 = {
    lens: 'members',
    users: [], usersById: {},
    roles: [], rolesByKey: {},
    sortKey: 'name', sortDir: 'asc', q: '',
    showArchived: false, loaded: false
  };

  function roleDisplay(key) {
    var r = V2.rolesByKey[key];
    if (r && r.name) return r.name;
    return (window.ROLE_DISPLAY_NAMES && ROLE_DISPLAY_NAMES[key]) || key || '—';
  }
  function canEdit() { return typeof can === 'function' ? can('employees', 'edit') : false; }
  function isSelf(uid) { return !!(window.currentUser && currentUser.uid === uid); }

  // ── Members entity ───────────────────────────────────────────────────
  MastEntity.define('employees-v2', {
    label: 'Team member', labelPlural: 'Team members', size: 'md', route: 'employees-v2',
    recordId: function (r) { return r._key; },
    // fields[0] must be a real string property — `name` is materialized in
    // load() from displayName || email.
    fields: [
      { name: 'name', label: 'Name', type: 'text', list: true, readOnly: true },
      { name: 'email', label: 'Email', type: 'text', list: true, readOnly: true },
      { name: 'role', label: 'Role', type: 'text', list: true,
        get: function (r) { return roleDisplay(r.role); } },
      { name: 'lastLoginAt', label: 'Last sign-in', type: 'date', list: true, readOnly: true },
      { name: 'status', label: 'Status', type: 'status', list: true, readOnly: true,
        get: function (r) { return r.archived ? 'archived' : 'active'; },
        format: function (v) { return v === 'archived' ? 'Archived' : 'Active'; },
        tone: function (v) { return v === 'archived' ? 'neutral' : 'success'; } }
    ],
    fetch: function (id) {
      if (V2.usersById[id]) return Promise.resolve(V2.usersById[id]);
      // Cache-miss fallback keeps cold cross-drills working.
      return Promise.resolve(MastDB.adminUsers.get(id)).then(function (r) {
        return r ? matUser(id, r) : null;
      });
    },
    detail: {
      render: function (UI, r) {
        var overrides = (typeof userOverrideCount === 'function') ? userOverrideCount(r) : 0;
        var tiles = UI.tiles([
          { k: 'Role', v: esc(roleDisplay(r.role)), hero: true },
          { k: 'Status', v: UI.badge(r.archived ? 'Archived' : 'Active', r.archived ? 'neutral' : 'success') },
          { k: 'Last sign-in', v: r.lastLoginAt ? N.date(r.lastLoginAt) : '—' },
          { k: 'Overrides', v: overrides ? N.count(overrides) : 'None' }
        ]);
        var kv = UI.kv([
          { k: 'Email', v: esc(r.email || '—') },
          { k: 'Display name', v: esc(r.displayName || '—') },
          { k: 'Role', v: esc(roleDisplay(r.role)) },
          { k: 'Joined', v: r.createdAt ? N.date(r.createdAt) : '—' },
          { k: 'Last sign-in', v: r.lastLoginAt ? N.date(r.lastLoginAt) : '—' },
          { k: 'Access expires', v: r.accessExpiry ? N.date(r.accessExpiry) : 'Never' }
        ]);
        var ovNote = overrides
          ? UI.card('Personal overrides', '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;">' +
              N.count(overrides) + ' permission override' + (overrides === 1 ? '' : 's') + ' on top of the ' +
              esc(roleDisplay(r.role)) + ' role. Overrides are edited on the <a href="javascript:void(0)" onclick="EmployeesV2.classic()" style="color:var(--teal);">classic Permissions page</a>.</div>')
          : '';
        var archBtn = '';
        if (canEdit() && !isSelf(r._key)) {
          archBtn = '<div style="margin-top:16px;">' +
            (r.archived
              ? '<button type="button" class="btn btn-secondary" onclick="EmployeesV2.setArchived(\'' + esc(r._key) + '\', false)">Unarchive — restore sign-in</button>'
              : '<button type="button" class="btn btn-secondary" style="color:var(--danger);" onclick="EmployeesV2.setArchived(\'' + esc(r._key) + '\', true)">Archive — block sign-in</button>') +
            '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">Archiving signs them out and blocks sign-in. History is kept; you can unarchive anytime.</div>' +
            '</div>';
        }
        return tiles + UI.card('Member', kv) + ovNote + archBtn;
      },
      editRender: function (record, mode) {
        var opts = V2.roles.map(function (ro) {
          return '<option value="' + esc(ro.key) + '"' + (record.role === ro.key ? ' selected' : '') + '>' + esc(ro.name || ro.key) + '</option>';
        }).join('');
        return '<div class="form-group" style="max-width:380px;">' +
          '<label style="font-size:0.85rem;font-weight:600;">Role</label>' +
          '<select name="role" class="form-input" style="width:100%;font-size:0.9rem;">' + opts + '</select>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:6px;">What ' + esc(record.name || 'this member') + ' can see and do. Open the role under the Roles view for the full access list.</div>' +
          '</div>';
      }
    },
    onSave: function (rec, mode) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to change user roles.', true); return false; }
      var uid = rec._key;
      var live = V2.usersById[uid];
      var oldRole = live ? live.role : rec.role;
      if (rec.role === oldRole) return true;  // nothing changed
      var doIt = function () {
        return Promise.resolve(EmployeesBridge.changeRole(uid, rec.role)).then(function () {
          if (live) { live.role = rec.role; }
          if (window.showToast) showToast('Role changed to ' + roleDisplay(rec.role) + '.');
          render();
          return true;
        }).catch(function (e) {
          console.error('[employees-v2] changeRole', e);
          if (window.showToast) showToast((e && e.message) || 'Failed to change role.', true);
          return false;
        });
      };
      if (oldRole === 'admin') {
        // Downgrading an admin needs the same explicit confirm as legacy.
        return Promise.resolve(mastConfirm('Change ' + (rec.name || rec.email || 'this member') + ' from ' + roleDisplay('admin') + ' to ' + roleDisplay(rec.role) + '? They will lose admin access on next login.', { title: 'Change Role', danger: true }))
          .then(function (ok) { return ok ? doIt() : false; });
      }
      return doIt();
    }
  });

  // ── Roles entity ─────────────────────────────────────────────────────
  MastEntity.define('employees-role-v2', {
    label: 'Role', labelPlural: 'Roles', size: 'lg', route: 'employees-v2',
    recordId: function (r) { return r.key; },
    fields: [
      { name: 'name', label: 'Role', type: 'text', list: true,
        required: true },
      { name: 'description', label: 'What it\'s for', type: 'text', list: true, readOnly: true },
      { name: 'kindLabel', label: 'Kind', type: 'text', list: true, readOnly: true },
      { name: 'memberCount', label: 'Members', type: 'text', align: 'right', list: true, readOnly: true,
        get: function (r) { return String(membersWithRole(r.key).length); } }
    ],
    fetch: function (id) {
      if (V2.rolesByKey[id]) return Promise.resolve(V2.rolesByKey[id]);
      return Promise.resolve(MastDB.roles.get(id)).then(function (doc) {
        return doc ? matRole(id, doc) : null;
      });
    },
    detail: {
      render: function (UI, r) {
        var members = membersWithRole(r.key);
        var sens = r.key === 'admin'
          ? FUNCTION_PERMISSIONS.length
          : FUNCTION_PERMISSIONS.filter(function (fp) {
              var sa = r.sensitiveActions || {};
              var k = _sensitiveKey(fp.entity, fp.action);
              return sa[k] !== undefined ? !!sa[k] : !!fp.roleDefaults[r.key];
            }).length;
        var tiles = UI.tiles([
          { k: 'Members', v: N.count(members.length), hero: true },
          { k: 'Kind', v: esc(r.kindLabel) },
          { k: 'Sensitive actions', v: sens + ' of ' + FUNCTION_PERMISSIONS.length }
        ]);
        var desc = r.description
          ? '<div style="font-size:0.85rem;color:var(--warm-gray);line-height:1.5;margin-bottom:12px;">' + esc(r.description) + '</div>' : '';

        // Per-section access summary (the matrix, read).
        var LEVEL_LABEL = { none: 'No access', view: 'View', edit: 'View & edit', full: 'Full', custom: 'Custom' };
        var rowsHtml = getModulePermRegistry().map(function (g) {
          var lv = {};
          g.routes.forEach(function (m) {
            var level = (r.key === 'admin') ? 'full' : triadToLevel(roleModuleTriad(r.key, r, m.route));
            (lv[level] = lv[level] || []).push(m.label);
          });
          var parts = ['full', 'edit', 'view', 'custom'].filter(function (l) { return lv[l]; }).map(function (l) {
            return '<span style="margin-right:10px;"><b>' + LEVEL_LABEL[l] + ':</b> ' + esc(lv[l].join(', ')) + '</span>';
          });
          if (!parts.length) parts = ['<span style="color:var(--warm-gray);">No access</span>'];
          return '<div style="padding:8px 0;border-bottom:1px solid var(--cream-dark);font-size:0.85rem;">' +
            '<div style="font-weight:600;margin-bottom:2px;">' + esc(g.label) + '</div>' +
            '<div style="color:var(--warm-gray);line-height:1.5;">' + parts.join('') + '</div></div>';
        }).join('');

        var sensHtml = FUNCTION_PERMISSIONS.map(function (fp) {
          var k = _sensitiveKey(fp.entity, fp.action);
          var sa = r.sensitiveActions || {};
          var onn = (r.key === 'admin') ? true : (sa[k] !== undefined ? !!sa[k] : !!fp.roleDefaults[r.key]);
          return '<div style="display:flex;justify-content:space-between;gap:12px;padding:6px 0;font-size:0.85rem;border-bottom:1px solid var(--cream-dark);">' +
            '<span>' + esc(fp.label) + '</span>' +
            UI.badge(onn ? 'Allowed' : 'Not allowed', onn ? 'success' : 'neutral') + '</div>';
        }).join('');

        var tabsBar = UI.paneTabsBar([{ key: 'access', label: 'Access' }, { key: 'members', label: 'Members' }], 'access');
        var memHtml = members.length
          ? members.map(function (u) {
              return '<div style="padding:7px 0;border-bottom:1px solid var(--cream-dark);font-size:0.85rem;cursor:pointer;" onclick="EmployeesV2.drillMember(\'' + esc(u._key) + '\')">' +
                esc(u.name) + ' <span style="color:var(--warm-gray);">· ' + esc(u.email || '') + (u.archived ? ' · archived' : '') + '</span></div>';
            }).join('')
          : '<div style="color:var(--warm-gray);font-size:0.85rem;">No members hold this role.</div>';

        return tiles + tabsBar +
          '<div class="mu-pane" data-pane="access">' + desc +
            (r.key === 'admin' ? UI.card('Access', '<div style="font-size:0.85rem;color:var(--warm-gray);">The Admin role always has full access to everything.</div>') : UI.card('Access by area', rowsHtml)) +
            UI.card('Sensitive actions', sensHtml) + '</div>' +
          '<div class="mu-pane" data-pane="members" hidden>' + UI.card('Members', memHtml) + '</div>';
      },
      editRender: function (record, mode) {
        if (mode === 'create') {
          return '<div style="max-width:420px;">' +
            '<div class="form-group"><label style="font-size:0.85rem;font-weight:600;">Name</label>' +
            '<input name="name" class="form-input" style="width:100%;" placeholder="e.g. Studio assistant"></div>' +
            '<div class="form-group"><label style="font-size:0.85rem;font-weight:600;">Identifier</label>' +
            '<input name="key" class="form-input" style="width:100%;" placeholder="e.g. studio_assistant">' +
            '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Lowercase, no spaces. Can\'t be changed later.</div></div>' +
            '<div class="form-group"><label style="font-size:0.85rem;font-weight:600;">What it\'s for</label>' +
            '<input name="description" class="form-input" style="width:100%;" placeholder="Brief description of this role"></div>' +
            '<div style="font-size:0.78rem;color:var(--warm-gray);">New roles start with no access — set what they can do after creating.</div>' +
            '</div>';
        }
        // Edit = the matrix as per-module Level pickers, grouped by area.
        var html = '<input type="hidden" name="name" value="' + esc(record.name || record.key) + '">';
        html += getModulePermRegistry().map(function (g) {
          var rows = g.routes.map(function (m) {
            var level = triadToLevel(roleModuleTriad(record.key, record, m.route));
            var opts = ['none', 'view', 'edit', 'full'].map(function (l) {
              var lbl = { none: 'No access', view: 'View', edit: 'View & edit', full: 'Full' }[l];
              return '<option value="' + l + '"' + (level === l ? ' selected' : '') + '>' + lbl + '</option>';
            }).join('');
            if (level === 'custom') opts = '<option value="custom" selected>Custom</option>' + opts;
            return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;">' +
              '<span style="font-size:0.85rem;">' + esc(m.label) + '</span>' +
              '<select name="mp_' + esc(m.route) + '" class="form-input" style="width:140px;font-size:0.85rem;padding:4px 8px;">' + opts + '</select></div>';
          }).join('');
          return '<details style="margin-bottom:10px;border:1px solid var(--cream-dark);border-radius:8px;padding:10px 14px;">' +
            '<summary style="font-weight:600;font-size:0.9rem;cursor:pointer;">' + esc(g.label) + '</summary>' +
            '<div style="margin-top:8px;">' + rows + '</div></details>';
        }).join('');
        html += '<div style="font-weight:600;font-size:0.9rem;margin:14px 0 6px;">Sensitive actions</div>';
        html += FUNCTION_PERMISSIONS.map(function (fp) {
          var k = _sensitiveKey(fp.entity, fp.action);
          var sa = record.sensitiveActions || {};
          var onn = sa[k] !== undefined ? !!sa[k] : !!fp.roleDefaults[record.key];
          return '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:4px 0;">' +
            '<span style="font-size:0.85rem;" title="' + esc(fp.description || '') + '">' + esc(fp.label) + '</span>' +
            '<select name="sa_' + esc(k) + '" class="form-input" style="width:140px;font-size:0.85rem;padding:4px 8px;">' +
            '<option value="no"' + (onn ? '' : ' selected') + '>Not allowed</option>' +
            '<option value="yes"' + (onn ? ' selected' : '') + '>Allowed</option></select></div>';
        }).join('');
        return html;
      }
    },
    onSave: function (rec, mode) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to edit roles.', true); return false; }
      if (mode === 'create') {
        return Promise.resolve(EmployeesBridge.createRole(rec.key, rec.name, rec.description)).then(function (res) {
          if (window.showToast) showToast('Role "' + (rec.name || res.key) + '" created. Set what it can do via Edit.');
          load();
          return true;
        }).catch(function (e) {
          console.error('[employees-v2] createRole', e);
          if (window.showToast) showToast((e && e.message) || 'Failed to create role.', true);
          return false;
        });
      }
      var roleKey = rec.key;
      var live = V2.rolesByKey[roleKey];
      // Rebuild the perm maps from the collected mp_/sa_ selects. 'custom'
      // (a triad no Level expresses) keeps the existing stored triad.
      var modulePermissions = {};
      getModulePermRegistry().forEach(function (g) {
        g.routes.forEach(function (m) {
          var v = rec['mp_' + m.route];
          if (v === 'custom' || v === undefined) {
            modulePermissions[m.route] = roleModuleTriad(roleKey, live || rec, m.route);
          } else {
            modulePermissions[m.route] = levelToTriad(v);
          }
        });
      });
      var sensitiveActions = {};
      FUNCTION_PERMISSIONS.forEach(function (fp) {
        var k = _sensitiveKey(fp.entity, fp.action);
        var v = rec['sa_' + k];
        if (v === undefined) {
          var sa = (live && live.sensitiveActions) || {};
          sensitiveActions[k] = sa[k] !== undefined ? !!sa[k] : !!fp.roleDefaults[roleKey];
        } else {
          sensitiveActions[k] = v === 'yes';
        }
      });
      return Promise.resolve(EmployeesBridge.saveRoleMatrix(roleKey, modulePermissions, sensitiveActions)).then(function () {
        if (live) { live.modulePermissions = modulePermissions; live.sensitiveActions = sensitiveActions; }
        if (window.showToast) showToast('Access saved for ' + roleDisplay(roleKey) + '.');
        render();
        return true;
      }).catch(function (e) {
        console.error('[employees-v2] saveRoleMatrix', e);
        if (window.showToast) showToast((e && e.message) || 'Failed to save access.', true);
        return false;
      });
    }
  });

  // ── materializers + data ─────────────────────────────────────────────
  function matUser(key, u) {
    var r = Object.assign({ _key: key }, u);
    r.name = u.displayName || u.email || key;
    return r;
  }
  function matRole(key, doc) {
    // Stored doc layered over built-in defaults; docs can be partial.
    var r = EmployeesBridge.effectiveRole(key, doc);
    r.key = key;
    r.name = r.name || key;
    r.kindLabel = r.isDefault ? 'Built-in' : 'Custom';
    return r;
  }
  function membersWithRole(roleKey) {
    return V2.users.filter(function (u) { return (u.role || 'guest') === roleKey; });
  }

  function load() {
    Promise.all([EmployeesBridge.listUsers(), EmployeesBridge.listRoles()]).then(function (res) {
      var users = res[0], roles = res[1];
      V2.users = Object.keys(users).map(function (k) { return matUser(k, users[k]); });
      V2.usersById = {}; V2.users.forEach(function (u) { V2.usersById[u._key] = u; });
      // Built-in roles always exist even if their doc was never written.
      var keys = {};
      Object.keys(DEFAULT_ROLES).forEach(function (k) { keys[k] = true; });
      Object.keys(roles).forEach(function (k) { keys[k] = true; });
      V2.roles = Object.keys(keys).map(function (k) { return matRole(k, roles[k]); });
      V2.rolesByKey = {}; V2.roles.forEach(function (r) { V2.rolesByKey[r.key] = r; });
      V2.loaded = true; render();
    }).catch(function (e) { console.error('[employees-v2] load', e); V2.loaded = true; render(); });
  }

  function visibleMembers() {
    var rows = V2.users;
    if (!V2.showArchived) rows = rows.filter(function (u) { return !u.archived; });
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (u) {
        return String(u.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(u.email || '').toLowerCase().indexOf(q) >= 0 ||
               roleDisplay(u.role).toLowerCase().indexOf(q) >= 0;
      });
    }
    return window.mastSortRows(rows, V2.sortKey, V2.sortDir, function (r, k) {
      var f = MastEntity.get('employees-v2').fields.filter(function (x) { return x.name === k; })[0];
      return (f && f.get) ? f.get(r) : r[k];
    });
  }
  function visibleRoles() {
    var rows = V2.roles.slice();
    if (V2.q) {
      var q = V2.q.toLowerCase();
      rows = rows.filter(function (r) {
        return String(r.name || '').toLowerCase().indexOf(q) >= 0 ||
               String(r.description || '').toLowerCase().indexOf(q) >= 0;
      });
    }
    // Built-ins first (admin/manager/user/guest), then customs alphabetically.
    var order = { admin: 0, manager: 1, user: 2, guest: 3 };
    rows.sort(function (a, b) {
      var oa = order[a.key] !== undefined ? order[a.key] : 10, ob = order[b.key] !== undefined ? order[b.key] : 10;
      return oa - ob || String(a.name).localeCompare(String(b.name));
    });
    return rows;
  }

  function ensureTab() {
    var el = document.getElementById('employeesV2Tab');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'employeesV2Tab'; el.className = 'tab-content'; el.style.display = 'none';
    (document.getElementById('content') || document.body).appendChild(el);
    return el;
  }

  function lensPill(key, label, count) {
    var on = V2.lens === key;
    return '<button onclick="EmployeesV2.setLens(\'' + key + '\')" style="border:1px solid var(--border);' +
      'background:' + (on ? 'color-mix(in srgb,var(--amber) 18%,transparent)' : 'transparent') + ';' +
      'color:' + (on ? 'var(--text-primary)' : 'var(--warm-gray)') + ';border-radius:999px;' +
      'padding:6px 13px;font-size:0.85rem;cursor:pointer;margin-right:8px;">' +
      label + ' <span style="color:var(--warm-gray);">' + count + '</span></button>';
  }

  function render() {
    var tab = ensureTab();
    if (!V2.loaded) {
      tab.innerHTML = U.pageHeader({ title: 'Team access' }) + '<div style="margin-top:14px;color:var(--warm-gray);">Loading…</div>';
      return;
    }
    var activeMembers = V2.users.filter(function (u) { return !u.archived; });
    var archivedCount = V2.users.length - activeMembers.length;
    var isMembers = V2.lens === 'members';
    var actions = '';
    if (!isMembers && canEdit()) {
      actions = '<button class="btn btn-primary" onclick="EmployeesV2.newRole()">+ New role</button>';
    }
    var archToggle = isMembers && archivedCount
      ? '<label style="font-size:0.85rem;color:var(--warm-gray);margin-left:12px;cursor:pointer;">' +
        '<input type="checkbox" ' + (V2.showArchived ? 'checked' : '') + ' onchange="EmployeesV2.toggleArchived(this.checked)" style="vertical-align:middle;margin-right:4px;">' +
        'Show archived (' + archivedCount + ')</label>'
      : '';

    tab.innerHTML =
      U.pageHeader({
        title: 'Team access',
        count: isMembers
          ? N.count(activeMembers.length) + ' member' + (activeMembers.length === 1 ? '' : 's')
          : N.count(V2.roles.length) + ' role' + (V2.roles.length === 1 ? '' : 's'),
        actionsHtml: actions
      }) +
      '<div style="margin:14px 0;">' +
        lensPill('members', 'Members', activeMembers.length) +
        lensPill('roles', 'Roles', V2.roles.length) +
        archToggle +
      '</div>' +
      '<div style="margin:14px 0;"><input class="form-input" placeholder="' + (isMembers ? 'Search name, email, role…' : 'Search roles…') + '" value="' + esc(V2.q) +
        '" oninput="EmployeesV2.search(this.value)" style="max-width:340px;font-size:0.9rem;"></div>' +
      (isMembers
        ? MastEntity.renderList('employees-v2', {
            rows: visibleMembers(), sortKey: V2.sortKey, sortDir: V2.sortDir,
            onSortFnName: 'EmployeesV2.sort', onRowClickFnName: 'EmployeesV2.open',
            empty: { title: 'No team members', message: 'People appear here after their first sign-in.' }
          })
        : MastEntity.renderList('employees-role-v2', {
            rows: visibleRoles(),
            onRowClickFnName: 'EmployeesV2.openRole',
            empty: { title: 'No roles', message: 'Built-in roles appear once access data loads.' }
          }));
  }

  window.EmployeesV2 = {
    setLens: function (l) { V2.lens = l; V2.q = ''; render(); },
    sort: function (key) {
      if (V2.sortKey === key) V2.sortDir = (V2.sortDir === 'asc' ? 'desc' : 'asc');
      else { V2.sortKey = key; V2.sortDir = (key === 'lastLoginAt' ? 'desc' : 'asc'); }
      render();
    },
    search: function (v) { V2.q = v || ''; render(); },
    toggleArchived: function (on) { V2.showArchived = !!on; render(); },
    open: function (id) { var rec = V2.usersById[id]; if (rec) MastEntity.openRecord('employees-v2', rec, 'read'); },
    openRole: function (key) { var rec = V2.rolesByKey[key]; if (rec) MastEntity.openRecord('employees-role-v2', rec, 'read'); },
    drillMember: function (id) { if (V2.usersById[id]) MastEntity.drill('employees-v2', V2.usersById[id]); },
    newRole: function () {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to create roles.', true); return; }
      MastEntity.openRecord('employees-role-v2', {}, 'create');
    },
    setArchived: function (uid, archived) {
      if (!canEdit()) { if (window.showToast) showToast('You do not have permission to archive users.', true); return; }
      var u = V2.usersById[uid];
      var name = (u && u.name) || 'this member';
      var go = function () {
        Promise.resolve(EmployeesBridge.setArchived(uid, archived)).then(function () {
          if (u) u.archived = archived;
          if (window.showToast) showToast(name + (archived ? ' archived — they can no longer sign in.' : ' unarchived.'));
          if (window.MastUI && MastUI.slideOut && MastUI.slideOut.requestClose) MastUI.slideOut.requestClose();
          render();
        }).catch(function (e) {
          console.error('[employees-v2] setArchived', e);
          if (window.showToast) showToast((e && e.message) || 'Failed to update member.', true);
        });
      };
      if (archived) {
        Promise.resolve(mastConfirm('Archive ' + name + '? They will be signed out and can no longer log in. Their history is kept, and you can unarchive them anytime.', { title: 'Archive User', danger: true }))
          .then(function (ok) { if (ok) go(); });
      } else { go(); }
    },
    classic: function () {
      if (typeof navigateToClassic === 'function') navigateToClassic('employees');
      else if (typeof navigateTo === 'function') navigateTo('employees');
    }
  };

  MastAdmin.registerModule('employees-v2', {
    routes: { 'employees-v2': { tab: 'employeesV2Tab', setup: function () { ensureTab(); render(); load(); } } }
  });
})();
