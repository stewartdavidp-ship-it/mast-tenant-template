// app/modules/compliance-settings.js  (T1 extraction)
//
// Compliance Settings sub-tab (PA-5 — Entity Phase 2): licenses / insurance /
// certifications / tax-jurisdictions CRUD with per-item secure-document upload via
// MastDB.businessEntity.documents, the counsel-locked DOCUMENT_UPLOAD_SSN_WARNING,
// and the compliance seed-banner refresh. Extracted byte-identical from the inline
// block in index.html — NO code conversions (the surface is counsel-/legal-text
// sensitive, so the relocated hardcoded-hex colors are recorded as-is in
// ux-standards-baseline.json rather than rewritten). The _complianceState /
// _COMPLIANCE_* state has no external readers; these top-level functions and the
// window.saveComplianceSection / removeComplianceItem / uploadComplianceDoc /
// deleteComplianceDoc assignments remain window globals (the inline block is not an
// IIFE) so the Settings-route compliance-tab switch (loadComplianceSettings), the
// settings-tabs switchComplianceTab handler, inline onclick handlers, and the
// renewals seed-banner cross-calls all resolve them post-load.

// ============================================================
// Compliance Settings (PA-5 — Entity Phase 2)
// Licenses / insurance / certifications / tax-jurisdictions CRUD +
// per-item document upload via MastDB.businessEntity.documents.
// Counsel-locked DOCUMENT_UPLOAD_SSN_WARNING rendered at top + on upload.
// ============================================================

var _complianceState = { data: null, dirty: false, uploadPending: null };

var _COMPLIANCE_SECTION_META = {
  licenses: { label: 'License', purpose: 'license', fields: [
    { key: 'type',        label: 'Type',          type: 'text',       placeholder: 'e.g., business-license, ServSafe, cosmetology' },
    { key: 'number',      label: 'License #',     type: 'password',   placeholder: '•••• 1234', sensitive: true },
    { key: 'jurisdiction',label: 'Jurisdiction',  type: 'text',       placeholder: 'e.g., MA, NY, US-Federal' },
    { key: 'issuedAt',    label: 'Issued',        type: 'date' },
    { key: 'expiresAt',   label: 'Expires',       type: 'date' }
  ], canUpload: true },
  insurance: { label: 'Insurance', purpose: 'insurance', fields: [
    { key: 'carrier',      label: 'Carrier',       type: 'text',     placeholder: 'e.g., Hiscox, State Farm' },
    { key: 'policyNumber', label: 'Policy #',      type: 'password', placeholder: '•••• 1234', sensitive: true },
    { key: 'expiresAt',    label: 'Expires',       type: 'date' }
  ], canUpload: true },
  certifications: { label: 'Certification', purpose: 'certification', fields: [
    { key: 'name',      label: 'Name',     type: 'text', placeholder: 'e.g., ServSafe Manager' },
    { key: 'issuer',    label: 'Issuer',   type: 'text', placeholder: 'e.g., NRFSP' },
    { key: 'expiresAt', label: 'Expires',  type: 'date' }
  ], canUpload: true },
  taxJurisdictions: { label: 'Tax Jurisdiction', purpose: 'tax-form', fields: [
    { key: 'state',            label: 'State',                 type: 'text',     placeholder: 'e.g., MA, CA' },
    { key: 'registrationId',   label: 'Registration ID',       type: 'password', placeholder: '•••• 1234', sensitive: true },
    { key: 'filingFrequency',  label: 'Filing frequency',      type: 'select',   options: [['','Not set'],['monthly','Monthly'],['quarterly','Quarterly'],['annual','Annual']] },
    { key: 'nextFilingDueAt',  label: 'Next filing due',       type: 'date' },
    { key: 'salesTaxCollected',label: 'Sales tax collected',   type: 'checkbox' }
  ], canUpload: false }
};

// Secure-intake (MastIntake identity-data) migration map for the sensitive
// compliance IDs. Each sensitive field is now ENVELOPE-ENCRYPTED at rest via the
// field-encryption CF (mast-architecture/functions/mast-intake-identity.js) instead
// of round-tripping as plaintext in the businessEntity doc. The plaintext key (e.g.
// `number`) is retired; the item carries an opaque `<key>Ref` (idv://…) pointer + a
// `<key>Masked` last-4 for display. `kind` MUST match the CF allowlist.
var _COMPLIANCE_SECURE = {
  licenses:         { key: 'number',         kind: 'license-number' },
  insurance:        { key: 'policyNumber',   kind: 'insurance-policy' },
  taxJurisdictions: { key: 'registrationId', kind: 'tax-registration-id' }
};

// Drop transient/plaintext keys before a doc write: never persist __unsaved or a
// legacy plaintext sensitive value (only its encrypted-at-rest ref + masked last-4).
function _stripComplianceItem(item) {
  var out = {};
  Object.keys(item || {}).forEach(function(k) {
    if (k === '__unsaved') return;
    out[k] = item[k];
  });
  Object.keys(_COMPLIANCE_SECURE).forEach(function(sk) {
    var key = _COMPLIANCE_SECURE[sk].key;
    if (Object.prototype.hasOwnProperty.call(out, key)) delete out[key]; // retire plaintext
  });
  return out;
}

// Persist the ref/masked pointer a secure field handed back (MastIntake.onChange).
// This is the ONLY thing written for a sensitive ID — never the plaintext. Saved
// items live at the array tail-stable prefix, so we exclude __unsaved items (always
// appended) to keep the persisted indices aligned with the secure-field closures.
async function _persistComplianceSecureRef(sectionKey, idx, key, payload) {
  var arr = (_complianceState.data && _complianceState.data[sectionKey]) || [];
  var item = arr[idx];
  if (!item) return;
  if (payload && payload.ref) {
    item[key + 'Ref'] = payload.ref;
    item[key + 'Masked'] = payload.masked || '';
  } else {
    delete item[key + 'Ref'];
    delete item[key + 'Masked'];
  }
  delete item[key]; // retire any legacy plaintext now that it is encrypted at rest
  var toWrite = arr.filter(function(x) { return !x.__unsaved; }).map(_stripComplianceItem);
  var payloadObj = {};
  payloadObj[sectionKey] = toWrite;
  try {
    await MastDB.businessEntity.update('compliance', payloadObj);
  } catch (err) {
    if (window.showToast) showToast('Could not save the secure reference: ' + (err.message || 'unknown'), true);
  }
}

// ── Vendor PII secure-field helper (shared across the three vendor editors) ──────
// The vendor/contractor Tax ID (EIN/SSN) and bank account number live on the SAME
// admin/vendors/{id} record but are edited from three surfaces (finance AP modal,
// procurement vendor editor, vendors-v2). Like the compliance IDs (#598), they are
// now ENVELOPE-ENCRYPTED at rest via the field-encryption CF (mast-architecture/
// functions/mast-intake-identity.js) instead of round-tripping as plaintext: the
// plaintext key (`taxId` / `accountNumber`) is retired in favour of an opaque
// `<key>Ref` (idv://…) pointer + a `<key>Masked` last-4 for display. This helper is
// single-sourced so the security-critical "retire the plaintext, persist only the
// ref" invariant cannot diverge across the three call-sites. `kind` MUST match the
// CF allowlist (IDENTITY_KINDS): ein-ssn / bank-account. The MastIntake provider
// catalog (connections-providers) must already be loaded by the caller; each vendor
// editor loads it before rendering and runs MastIntake.hydrate() after mounting.
window.VendorSecureId = (function () {
  var FIELDS = {
    taxId:         { kind: 'ein-ssn',      label: 'Tax ID (EIN/SSN)' },
    accountNumber: { kind: 'bank-account', label: 'Bank account number' }
  };

  // Last-4 mask for display/export. Prefers the stored <key>Masked (written when the
  // value was encrypted); falls back to masking any not-yet-migrated plaintext so a
  // legacy raw value is NEVER rendered in full.
  function masked(rec, key) {
    if (!rec) return '';
    if (rec[key + 'Masked']) return String(rec[key + 'Masked']);
    var legacy = rec[key];
    if (legacy == null || String(legacy).trim() === '') return '';
    var digits = String(legacy).replace(/[^0-9]/g, '');
    return digits ? '•••• ' + digits.slice(-4) : '••••';
  }

  // Does this vendor have a value on file (encrypted ref OR not-yet-migrated plaintext)?
  function has(rec, key) {
    return !!(rec && (rec[key + 'Ref'] || (rec[key] != null && String(rec[key]).trim() !== '')));
  }

  // Render the MastIntake secure-field host for one PII field. Requires a SAVED
  // vendor (a stable id for the ref to attach to); an unsaved vendor gets a prompt to
  // save first (mirrors the compliance per-item pattern). The returned string carries
  // its own label + counsel + masked/reveal grammar — do NOT wrap it in another label.
  function host(vendorId, key, rec) {
    var meta = FIELDS[key];
    if (!meta) return '';
    if (!vendorId) {
      return '<div style="font-size:0.78rem;color:var(--warm-gray,#888);font-style:italic;padding:7px 0;">Save this vendor first, then add the secure ' + esc(meta.label.toLowerCase()) + '.</div>';
    }
    if (!(window.MastIntake && typeof MastIntake.secureField === 'function')) {
      return '<div style="font-size:0.78rem;color:var(--warm-gray,#888);font-style:italic;padding:7px 0;">Secure entry is unavailable right now.</div>';
    }
    var ref = (rec && rec[key + 'Ref']) || null;
    var legacy = (!ref && rec && rec[key] != null) ? String(rec[key]) : '';
    return MastIntake.secureField({
      kind: meta.kind,
      label: meta.label,
      value: ref,
      legacyValue: legacy,
      onChange: (function (id, k) { return function (p) { persist(id, k, p); }; })(vendorId, key)
    });
  }

  // Persist (or clear) the ref/masked pointer the secure field handed back. This is
  // the ONLY thing written for a PII field — never the plaintext. Retires any legacy
  // plaintext (null clears it) now that the value is encrypted at rest.
  async function persist(vendorId, key, payload) {
    if (!vendorId || !FIELDS[key]) return;
    var updates = {};
    if (payload && payload.ref) {
      updates[key + 'Ref'] = payload.ref;
      updates[key + 'Masked'] = payload.masked || '';
    } else {
      updates[key + 'Ref'] = null;
      updates[key + 'Masked'] = null;
    }
    updates[key] = null; // retire plaintext now that it is encrypted at rest
    updates.updatedAt = new Date().toISOString();
    try {
      await MastDB.update('admin/vendors/' + vendorId, updates);
    } catch (err) {
      if (window.showToast) showToast('Could not save the secure ' + (FIELDS[key].label || key) + ': ' + (err.message || 'unknown'), true);
    }
  }

  return { host: host, persist: persist, masked: masked, has: has, FIELDS: FIELDS };
})();

async function loadComplianceSettings() {
  var C = window.BusinessEntityConstants || {};
  var warn = C.DOCUMENT_UPLOAD_SSN_WARNING || {};
  var h = document.getElementById('complianceSsnHeadline');
  var b = document.getElementById('complianceSsnBody');
  if (h) h.textContent = warn.headline || '';
  if (b) b.textContent = warn.body || '';

  var statusEl = document.getElementById('complianceSectionStatus');
  if (statusEl) { statusEl.textContent = 'Loading…'; statusEl.style.color = 'var(--warm-gray)'; }

  var ent = null;
  try { ent = await MastDB.businessEntity.get(); } catch (err) { console.warn('[compliance] get failed:', err && err.message); }
  var compliance = (ent && ent.compliance) || {};
  _complianceState.data = {
    licenses:         Array.isArray(compliance.licenses) ? compliance.licenses.slice() : [],
    insurance:        Array.isArray(compliance.insurance) ? compliance.insurance.slice() : [],
    certifications:   Array.isArray(compliance.certifications) ? compliance.certifications.slice() : [],
    taxJurisdictions: Array.isArray(compliance.taxJurisdictions) ? compliance.taxJurisdictions.slice() : []
  };
  _complianceState.dirty = false;

  // Hydrate document metadata cache so we can render status next to rows.
  var docMap = {};
  try {
    var docs = await MastDB.businessEntity.documents.list();
    (docs || []).forEach(function(d) { if (d && d.id) docMap[d.id] = d; });
  } catch (err) {
    console.warn('[compliance] documents.list failed:', err && err.message);
  }
  _complianceState.documents = docMap;

  // Load the MastIntake provider catalog so the sensitive-ID secure fields render +
  // hydrate inline (fail-closed: if it can't load, the secure field shows disabled).
  if (window.MastAdmin && typeof MastAdmin.loadModule === 'function') {
    try { await MastAdmin.loadModule('connections-providers'); } catch (e) { /* fail-closed */ }
  }

  ['licenses','insurance','certifications','taxJurisdictions'].forEach(function(key) {
    _renderComplianceSection(key);
  });

  if (statusEl) statusEl.textContent = '';

  // Seed banner visibility
  _updateComplianceSeedBanner(ent);
  if (typeof refreshComplianceTabStatus === 'function') refreshComplianceTabStatus();
}

function _complianceRowId(sectionKey, idx) { return 'compliance-' + sectionKey + '-row-' + idx; }
function _complianceFieldId(sectionKey, idx, field) { return 'compliance-' + sectionKey + '-' + idx + '-' + field; }

function _renderComplianceSection(sectionKey) {
  var meta = _COMPLIANCE_SECTION_META[sectionKey];
  var listEl = document.getElementById(_complianceListId(sectionKey));
  if (!listEl || !meta) return;
  var items = (_complianceState.data && _complianceState.data[sectionKey]) || [];
  if (items.length === 0) {
    listEl.innerHTML = '<div style="color:var(--warm-gray);font-size:0.85rem;font-style:italic;padding:8px 0;">No ' + esc(meta.label.toLowerCase()) + 's added yet.</div>';
    return;
  }
  listEl.innerHTML = items.map(function(item, idx) {
    return _renderComplianceItemRow(sectionKey, item, idx);
  }).join('');
  // Bind/hydrate any MastIntake secure fields embedded in the rows (sensitive IDs).
  if (window.MastIntake && typeof MastIntake.hydrate === 'function') {
    try { MastIntake.hydrate(listEl); } catch (e) { /* fail-closed: field stays disabled */ }
  }
}

function _complianceListId(sectionKey) {
  if (sectionKey === 'licenses') return 'complianceLicensesList';
  if (sectionKey === 'insurance') return 'complianceInsuranceList';
  if (sectionKey === 'certifications') return 'complianceCertificationsList';
  if (sectionKey === 'taxJurisdictions') return 'complianceTaxJurisdictionsList';
  return '';
}

function _complianceStatusId(sectionKey) {
  if (sectionKey === 'licenses') return 'complianceLicensesStatus';
  if (sectionKey === 'insurance') return 'complianceInsuranceStatus';
  if (sectionKey === 'certifications') return 'complianceCertificationsStatus';
  if (sectionKey === 'taxJurisdictions') return 'complianceTaxJurisdictionsStatus';
  return '';
}

function _renderComplianceItemRow(sectionKey, item, idx) {
  var meta = _COMPLIANCE_SECTION_META[sectionKey];
  var rowId = _complianceRowId(sectionKey, idx);
  var unsaved = item && item.__unsaved === true;
  var out = '<div id="' + rowId + '" class="compliance-item" style="background:var(--bg-secondary,#232323);border-radius:8px;padding:12px 14px;margin-bottom:10px;' + (unsaved ? 'border:1px dashed rgba(234,179,8,0.45);' : 'border:1px solid rgba(255,255,255,0.05);') + '">';
  out += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:0.78rem;color:var(--warm-gray);">';
  out += '<span>' + esc(meta.label) + ' #' + (idx + 1) + (unsaved ? ' <span style="color:#eab308;">(unsaved)</span>' : '') + '</span>';
  out += '<button class="btn btn-small btn-secondary" style="font-size:0.72rem;padding:3px 8px;" onclick="removeComplianceItem(\'' + sectionKey + '\',' + idx + ')">Remove</button>';
  out += '</div>';
  out += '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;">';
  meta.fields.forEach(function(f) {
    var fid = _complianceFieldId(sectionKey, idx, f.key);
    var val = (item && item[f.key] !== undefined && item[f.key] !== null) ? item[f.key] : '';
    // Sensitive IDs host the full MastIntake secure field (own label + counsel +
    // masked/reveal) — span the grid and skip the plain outer label to avoid a
    // duplicate; all other fields keep the compact grid cell + label.
    out += f.sensitive ? '<div style="grid-column:1/-1;">' : '<div>';
    if (!f.sensitive) {
      out += '<label style="display:block;font-size:0.72rem;font-weight:600;color:var(--warm-gray);margin-bottom:3px;">' + esc(f.label) + '</label>';
    }
    if (f.type === 'select') {
      out += '<select id="' + fid + '" class="compliance-input" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;background:var(--bg-primary,var(--charcoal));color:var(--text,#fff);">';
      (f.options || []).forEach(function(opt) {
        var optVal = opt[0];
        var optLbl = opt[1];
        out += '<option value="' + esc(optVal) + '"' + (String(val) === optVal ? ' selected' : '') + '>' + esc(optLbl) + '</option>';
      });
      out += '</select>';
    } else if (f.type === 'checkbox') {
      out += '<label style="display:flex;align-items:center;gap:6px;font-size:0.85rem;color:var(--text,#fff);cursor:pointer;">';
      out += '<input type="checkbox" id="' + fid + '" class="compliance-input"' + (val ? ' checked' : '') + ' style="width:16px;height:16px;">';
      out += '<span style="font-size:0.85rem;color:var(--warm-gray);">Actively collecting</span>';
      out += '</label>';
    } else if (f.sensitive) {
      // Encrypted at rest via MastIntake (identity-data). Replaces the legacy
      // plaintext password input — never sits beside it (design §9: migration
      // replaces). Saved items host the secure field; unsaved items must be saved
      // first so the ref has a stable item to attach to (mirrors document upload).
      var secure = _COMPLIANCE_SECURE[sectionKey];
      if (unsaved) {
        out += '<div style="font-size:0.78rem;color:var(--warm-gray);font-style:italic;padding:7px 0;">Save this ' + esc(meta.label.toLowerCase()) + ' first, then add the secure ' + esc(f.label.toLowerCase()) + '.</div>';
      } else if (secure && window.MastIntake && typeof MastIntake.secureField === 'function') {
        var ref = (item && item[f.key + 'Ref']) || null;
        var legacy = (!ref && item && item[f.key]) ? String(item[f.key]) : '';
        out += MastIntake.secureField({
          kind: secure.kind,
          label: f.label,
          value: ref,
          legacyValue: legacy,
          onChange: (function(sk, i, key) {
            return function(p) { _persistComplianceSecureRef(sk, i, key, p); };
          })(sectionKey, idx, f.key)
        });
      } else {
        out += '<div style="font-size:0.78rem;color:var(--warm-gray);font-style:italic;padding:7px 0;">Secure entry is unavailable right now.</div>';
      }
    } else {
      out += '<input type="' + esc(f.type) + '" id="' + fid + '" class="compliance-input" placeholder="' + esc(f.placeholder || '') + '" value="' + esc(val) + '" style="width:100%;padding:7px 10px;border:1px solid #ddd;border-radius:6px;font-family:\'DM Sans\',sans-serif;font-size:0.85rem;box-sizing:border-box;">';
    }
    out += '</div>';
  });
  out += '</div>';

  if (meta.canUpload) {
    var docId = item && item.documentId;
    var doc = docId && _complianceState.documents ? _complianceState.documents[docId] : null;
    out += '<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.04);display:flex;align-items:center;gap:8px;flex-wrap:wrap;">';
    if (docId && doc) {
      var badgeColor = doc.status === 'uploaded' ? 'var(--teal,#2a9d8f)' : (doc.status === 'deleted-pending-purge' ? '#eab308' : 'var(--warm-gray,#888)');
      out += '<span style="font-size:0.78rem;color:var(--warm-gray);">Document:</span>';
      out += '<span style="font-size:0.78rem;color:' + badgeColor + ';padding:2px 8px;background:rgba(255,255,255,0.05);border-radius:4px;">' + esc(doc.filename || '(unnamed)') + ' · ' + esc(doc.status || 'unknown') + '</span>';
      if (doc.status !== 'deleted-pending-purge' && doc.status !== 'redacted') {
        out += '<button class="btn btn-small" style="font-size:0.72rem;padding:3px 8px;" onclick="deleteComplianceDoc(\'' + esc(docId) + '\',\'' + sectionKey + '\',' + idx + ')">Delete document</button>';
      }
    } else if (docId && !doc) {
      out += '<span style="font-size:0.78rem;color:var(--warm-gray);font-style:italic;">Linked document (' + esc(String(docId).slice(0, 8)) + '…) not found.</span>';
    } else if (unsaved) {
      out += '<span style="font-size:0.78rem;color:var(--warm-gray);font-style:italic;">Save this ' + esc(meta.label.toLowerCase()) + ' first, then upload a document.</span>';
    } else {
      out += '<button class="btn btn-small btn-secondary" style="font-size:0.78rem;padding:5px 12px;" onclick="uploadComplianceDoc(\'' + sectionKey + '\',' + idx + ')">Upload document</button>';
      out += '<span style="font-size:0.72rem;color:var(--warm-gray);">PDF, JPG, or PNG · 10 MB max</span>';
    }
    out += '</div>';
  }

  out += '</div>';
  return out;
}

window.toggleComplianceSensitive = function(fieldId, btn) {
  var el = document.getElementById(fieldId);
  if (!el) return;
  if (el.type === 'password') { el.type = 'text'; btn.textContent = 'Hide'; }
  else { el.type = 'password'; btn.textContent = 'Show'; }
};

window.addComplianceItem = function(sectionKey) {
  if (!_complianceState.data) _complianceState.data = { licenses:[], insurance:[], certifications:[], taxJurisdictions:[] };
  if (!Array.isArray(_complianceState.data[sectionKey])) _complianceState.data[sectionKey] = [];
  var blank = { __unsaved: true };
  _COMPLIANCE_SECTION_META[sectionKey].fields.forEach(function(f) {
    if (f.type === 'checkbox') blank[f.key] = false;
    else blank[f.key] = '';
  });
  _complianceState.data[sectionKey].push(blank);
  _complianceState.dirty = true;
  _renderComplianceSection(sectionKey);
};

window.removeComplianceItem = async function(sectionKey, idx) {
  var meta = _COMPLIANCE_SECTION_META[sectionKey];
  var arr = (_complianceState.data && _complianceState.data[sectionKey]) || [];
  var item = arr[idx];
  if (!item) return;
  var proceed = true;
  if (!item.__unsaved) {
    proceed = await mastConfirm('Remove this ' + meta.label.toLowerCase() + '? If it has a linked document, the document record stays but is no longer referenced from this item.', { title: 'Remove ' + meta.label + '?', confirmLabel: 'Remove', cancelLabel: 'Keep' });
  }
  if (!proceed) return;
  arr.splice(idx, 1);
  _complianceState.dirty = true;
  _renderComplianceSection(sectionKey);
};

function _collectComplianceSection(sectionKey) {
  var meta = _COMPLIANCE_SECTION_META[sectionKey];
  var arr = (_complianceState.data && _complianceState.data[sectionKey]) || [];
  return arr.map(function(item, idx) {
    var out = {};
    meta.fields.forEach(function(f) {
      if (f.sensitive) {
        // Encrypted at rest by MastIntake — there is no plaintext input to read.
        // Carry forward only the ref/masked pointer the secure field persisted; the
        // plaintext key is retired (never written back to the doc).
        if (item[f.key + 'Ref']) out[f.key + 'Ref'] = item[f.key + 'Ref'];
        if (item[f.key + 'Masked']) out[f.key + 'Masked'] = item[f.key + 'Masked'];
        return;
      }
      var fid = _complianceFieldId(sectionKey, idx, f.key);
      var el = document.getElementById(fid);
      if (!el) { out[f.key] = item[f.key] || (f.type === 'checkbox' ? false : ''); return; }
      if (f.type === 'checkbox') out[f.key] = !!el.checked;
      else out[f.key] = (el.value || '').trim();
    });
    if (item.documentId) out.documentId = item.documentId;
    return out;
  });
}

window.saveComplianceSection = async function(sectionKey) {
  var statusEl = document.getElementById(_complianceStatusId(sectionKey));
  if (statusEl) { statusEl.textContent = 'Saving…'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    var collected = _collectComplianceSection(sectionKey);
    var payload = {};
    payload[sectionKey] = collected;
    await MastDB.businessEntity.update('compliance', payload);
    // Update local cache + clear __unsaved flags.
    if (!_complianceState.data) _complianceState.data = {};
    _complianceState.data[sectionKey] = collected.map(function(x) { return Object.assign({}, x); });
    _complianceState.dirty = false;
    _renderComplianceSection(sectionKey);
    if (statusEl) { statusEl.textContent = 'Saved.'; statusEl.style.color = 'var(--success,#22c55e)'; }
    if (window.showToast) showToast('Compliance saved');
    // Re-evaluate seed banner (data changed).
    try { var ent = await MastDB.businessEntity.get(); _updateComplianceSeedBanner(ent); } catch(_) {}
    if (typeof refreshComplianceTabStatus === 'function') refreshComplianceTabStatus();
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Save failed: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--danger,#ef4444)'; }
  }
};

// Upload flow: file picker → counsel-locked SSN warning modal → upload → link.
window.uploadComplianceDoc = function(sectionKey, idx) {
  var meta = _COMPLIANCE_SECTION_META[sectionKey];
  if (!meta || !meta.canUpload) return;
  var arr = (_complianceState.data && _complianceState.data[sectionKey]) || [];
  var item = arr[idx];
  if (!item || item.__unsaved) {
    if (window.mastAlert) mastAlert('Save this ' + meta.label.toLowerCase() + ' first, then upload a document.', { title: 'Save first' });
    return;
  }
  var input = document.createElement('input');
  input.type = 'file';
  input.accept = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png';
  input.style.display = 'none';
  document.body.appendChild(input);
  input.addEventListener('change', async function() {
    var file = input.files && input.files[0];
    document.body.removeChild(input);
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      if (window.mastAlert) mastAlert('File is larger than 10 MB. Please upload a smaller file.', { title: 'File too large' });
      return;
    }
    var ok = /^(application\/pdf|image\/jpeg|image\/png)$/.test(file.type) || /\.(pdf|jpe?g|png)$/i.test(file.name);
    if (!ok) {
      if (window.mastAlert) mastAlert('Only PDF, JPG, or PNG files are accepted.', { title: 'File type not supported' });
      return;
    }
    var C = window.BusinessEntityConstants || {};
    var warn = C.DOCUMENT_UPLOAD_SSN_WARNING || {};
    var warnText = (warn.headline || '') + '\n\n' + (warn.body || '') + '\n\nFile: ' + file.name;
    var proceed = await mastConfirm(warnText, { title: 'Confirm upload', confirmLabel: 'Upload', cancelLabel: 'Cancel' });
    if (!proceed) return;
    var statusEl = document.getElementById(_complianceStatusId(sectionKey));
    if (statusEl) { statusEl.textContent = 'Uploading ' + file.name + '…'; statusEl.style.color = 'var(--warm-gray)'; }
    try {
      var up = await MastDB.businessEntity.documents.upload(file, meta.purpose);
      if (!up || !up.success) throw new Error((up && up.error) || 'Upload failed at step ' + (up && up.step));
      var link = await MastDB.businessEntity.documents.link(up.documentId, 'compliance.' + sectionKey, idx, 'documentId');
      if (!link || !link.success) throw new Error('Link failed');
      if (statusEl) { statusEl.textContent = 'Uploaded.'; statusEl.style.color = 'var(--success,#22c55e)'; }
      if (window.showToast) showToast('Document uploaded');
      await loadComplianceSettings();
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Upload failed: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--danger,#ef4444)'; }
    }
  });
  input.click();
};

window.deleteComplianceDoc = async function(documentId, sectionKey, idx) {
  var proceed = await mastConfirm('Permanently remove this uploaded document? The ' + _COMPLIANCE_SECTION_META[sectionKey].label.toLowerCase() + ' record stays, but the file will be purged within 6 hours.', { title: 'Delete document?', confirmLabel: 'Delete', cancelLabel: 'Keep' });
  if (!proceed) return;
  var statusEl = document.getElementById(_complianceStatusId(sectionKey));
  if (statusEl) { statusEl.textContent = 'Deleting…'; statusEl.style.color = 'var(--warm-gray)'; }
  try {
    await MastDB.businessEntity.documents.delete(documentId);
    if (statusEl) { statusEl.textContent = 'Document scheduled for purge.'; statusEl.style.color = 'var(--success,#22c55e)'; }
    if (window.showToast) showToast('Document removed');
    await loadComplianceSettings();
  } catch (err) {
    if (statusEl) { statusEl.textContent = 'Delete failed: ' + (err.message || 'unknown'); statusEl.style.color = 'var(--danger,#ef4444)'; }
  }
};

async function _updateComplianceSeedBanner(ent) {
  var banner = document.getElementById('complianceSeedBanner');
  if (!banner) return;
  var compliance = (ent && ent.compliance) || {};
  var totalItems = (Array.isArray(compliance.licenses) ? compliance.licenses.length : 0)
    + (Array.isArray(compliance.insurance) ? compliance.insurance.length : 0)
    + (Array.isArray(compliance.certifications) ? compliance.certifications.length : 0)
    + (Array.isArray(compliance.taxJurisdictions) ? compliance.taxJurisdictions.length : 0);
  var dismissedAt = ent && ent.ui && ent.ui.renewalSeedDismissedAt;
  if (totalItems === 0 || dismissedAt) { banner.style.display = 'none'; return; }
  try {
    var items = await MastDB.businessEntity.renewals.listItems({ activeOnly: true });
    if (items && items.length > 0) { banner.style.display = 'none'; return; }
  } catch (_) {}
  banner.style.display = '';
}

