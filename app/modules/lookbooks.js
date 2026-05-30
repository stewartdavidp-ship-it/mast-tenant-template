/**
 * Look Books & Line Sheets Module — Generate professional PDF catalogs
 * Lazy-loaded via MastAdmin module registry.
 *
 * Data model: admin/lookbooks/{documentId}
 * Route: lookbooks (in Make section)
 */
(function() {
  'use strict';

  // ============================================================
  // Module-private state
  // ============================================================

  var docsData = {};
  var docsLoaded = false;
  var docsListener = null;
  var currentView = 'list'; // 'list' | 'builder'
  var currentDocId = null;

  // Tenant-TZ-aware date helpers for URL filter (createdAt is ISO timestamp).
  // Lazy-loads tenant TZ from businessEntity once; first render before resolve
  // uses browser TZ then re-renders.
  var _tenantTz = null;
  function ensureTenantTz() {
    if (_tenantTz !== null) return Promise.resolve(_tenantTz);
    try {
      return MastDB.businessEntity.get('operations').then(function(snap) {
        var ops = (snap && typeof snap.val === 'function') ? snap.val() : snap;
        var tz = ops && ops.localization && ops.localization.timezone;
        _tenantTz = (tz && typeof tz === 'string') ? tz : 'UTC';
        return _tenantTz;
      }).catch(function() { _tenantTz = 'UTC'; return 'UTC'; });
    } catch (e) {
      _tenantTz = 'UTC';
      return Promise.resolve('UTC');
    }
  }
  function tzPartsFromIso(iso) {
    if (!iso) return null;
    var dt = new Date(iso);
    if (isNaN(dt.getTime())) return null;
    var fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: _tenantTz || 'UTC',
      year: 'numeric', month: '2-digit', day: '2-digit'
    });
    var parts = {};
    fmt.formatToParts(dt).forEach(function(x) { if (x.type !== 'literal') parts[x.type] = x.value; });
    return parts;
  }

  // ============================================================
  // Data Layer
  // ============================================================

  function loadDocs() {
    if (docsLoaded) { renderCurrentView(); return; }
    docsListener = MastDB.lookbooks.listen(100, function(snap) {
      docsData = snap.val() || {};
      docsLoaded = true;
      renderCurrentView();
    }, function(err) {
      console.error('Lookbooks listen error:', err);
      showToast('Failed to load look books', 'error');
    });
  }

  function unloadDocs() {
    if (docsListener) {
      MastDB.lookbooks.unlisten(docsListener);
      docsListener = null;
    }
    docsLoaded = false;
    docsData = {};
  }

  function saveDocument(data) {
    var id = data.documentId || MastDB.lookbooks.newKey();
    var now = new Date().toISOString();
    var isNew = !data.documentId;

    var doc = {
      documentId: id,
      type: data.type || 'linesheet',
      title: data.title || '',
      priceTier: data.priceTier || 'wholesale',
      includeCategories: data.includeCategories || [],
      excludeProductIds: data.excludeProductIds || [],
      showPrices: data.showPrices !== false,
      headerText: data.headerText || '',
      footerText: data.footerText || '',
      generatedAt: data.generatedAt || null,
      generatedUrl: data.generatedUrl || null,
      urlExpiresAt: data.urlExpiresAt || null,
      status: data.status || 'draft',
      updatedAt: now
    };
    if (isNew) doc.createdAt = now;

    return MastDB.lookbooks.set(id, doc).then(function() {
      showToast(isNew ? 'Document created' : 'Document saved');
      return id;
    });
  }

  function deleteDocument(id) {
    // Cascade-delete the generated PDF from Storage before removing the doc.
    // Without this, the public PDF (Finding M, public:true) lives forever as an
    // orphan after the Firestore delete — wholesale-pricing data-leak hazard.
    // CC OPEN -OrDxUfm7rUT3QViMcz8 (Findings P + M).
    var pdfPath = MastDB.storagePath('lookbooks/' + id + '.pdf');
    return storage.ref(pdfPath).delete().catch(function(err) {
      // 404 / object-not-found is expected when the doc was never generated.
      // Anything else (permissions, transient) we log and continue — losing
      // the doc record without deleting the PDF is the worse outcome here
      // (admin would have no way to find the orphan), so we proceed to delete
      // the doc only after attempting the Storage cascade.
      var notFound = err && (err.code === 'storage/object-not-found' || /not.?found/i.test(err.message || ''));
      if (!notFound) console.warn('lbDeleteDoc: PDF cascade-delete failed for ' + pdfPath + ':', err);
    }).then(function() {
      return MastDB.lookbooks.remove(id);
    }).then(function() {
      showToast('Document deleted');
    });
  }

  // ============================================================
  // PDF Generation (calls Cloud Function)
  // ============================================================

  function generatePDF(docId) {
    var doc = docsData[docId];
    if (!doc) { showToast('Document not found', 'error'); return Promise.reject(); }

    // Show generating state
    var tab = document.getElementById('lookbooksTab');
    var genEl = document.getElementById('lbGenerating_' + docId);
    if (genEl) {
      genEl.style.display = 'block';
      genEl.innerHTML = '<div class="lb-generating">Generating PDF...</div>';
    }

    return auth.currentUser.getIdToken().then(function(token) {
      return callCF('/generateLookbook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
        },
        body: JSON.stringify({ documentId: docId })
      });
    }).then(function(resp) {
      if (!resp.ok) throw new Error('Generation failed');
      return resp.json();
    }).then(function(result) {
      if (!result.success) throw new Error(result.error || 'Generation failed');
      showToast('PDF generated');
      // Update doc record with generated URL + expiry stamp from CF
      return MastDB.lookbooks.update(docId, {
        generatedAt: new Date().toISOString(),
        generatedUrl: result.url,
        urlExpiresAt: result.urlExpiresAt || null,
        status: 'generated',
        updatedAt: new Date().toISOString()
      });
    }).catch(function(err) {
      console.error('PDF generation error:', err);
      showToast('Failed to generate PDF: ' + err.message, 'error');
      if (genEl) genEl.style.display = 'none';
    });
  }

  // ============================================================
  // View Router
  // ============================================================

  function renderCurrentView() {
    if (currentView === 'builder') {
      renderBuilder(currentDocId);
    } else {
      renderDocList();
    }
  }

  function showView(view, docId) {
    currentView = view;
    currentDocId = docId || null;
    renderCurrentView();
  }

  // ============================================================
  // Document List View
  // ============================================================

  function renderDocList() {
    var tab = document.getElementById('lookbooksTab');
    if (!tab) return;

    // URL-driven filters from MCP admin links: type, status, dateFrom, dateTo, lookbookIds
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var urlType = (rp && typeof rp.type === 'string') ? rp.type : '';
    var urlStatus = (rp && typeof rp.status === 'string') ? rp.status : '';
    var urlDateFrom = (rp && typeof rp.dateFrom === 'string') ? rp.dateFrom.slice(0, 10) : '';
    var urlDateTo = (rp && typeof rp.dateTo === 'string') ? rp.dateTo.slice(0, 10) : '';
    var urlIdsParam = (rp && typeof rp.lookbookIds === 'string') ? rp.lookbookIds : '';
    var urlIds = urlIdsParam ? urlIdsParam.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];
    var urlIdLookup = urlIds.length > 0 ? Object.create(null) : null;
    if (urlIdLookup) urlIds.forEach(function(id) { urlIdLookup[id] = true; });
    var hasUrlFilter = !!(urlType || urlStatus || urlDateFrom || urlDateTo || urlIds.length);
    if (hasUrlFilter && (urlDateFrom || urlDateTo) && _tenantTz === null) {
      ensureTenantTz().then(function() { renderDocList(); });
    }

    var docs = Object.values(docsData).sort(function(a, b) {
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

    if (hasUrlFilter) {
      docs = docs.filter(function(d) {
        if (urlType && d.type !== urlType) return false;
        if (urlStatus && (d.status || 'draft') !== urlStatus) return false;
        if (urlIdLookup && !urlIdLookup[d.documentId]) return false;
        if (urlDateFrom || urlDateTo) {
          var p = tzPartsFromIso(d.createdAt || '');
          if (!p) return false;
          var ds = p.year + '-' + p.month + '-' + p.day;
          if (urlDateFrom && ds < urlDateFrom) return false;
          if (urlDateTo && ds > urlDateTo) return false;
        }
        return true;
      });
    }

    if (!docs.length && !hasUrlFilter) {
      tab.innerHTML =
        '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
          '<div style="font-size:1.6rem;margin-bottom:12px;">📄</div>' +
          '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No look books or line sheets yet</p>' +
          '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Create professional PDF catalogs from your product data.</p>' +
          '<button class="btn btn-primary" style="margin-top:16px;" onclick="lbNewDoc()">+ New Document</button>' +
        '</div>';
      return;
    }

    var html = '';

    // URL-filter banner
    if (hasUrlFilter) {
      var bparts = [];
      if (urlIds.length) bparts.push(urlIds.length + ' selected document' + (urlIds.length === 1 ? '' : 's'));
      if (urlType) bparts.push('type: ' + urlType);
      if (urlStatus) bparts.push('status: ' + urlStatus);
      if (urlDateFrom && urlDateTo) bparts.push('from ' + urlDateFrom + ' to ' + urlDateTo);
      else if (urlDateFrom) bparts.push('from ' + urlDateFrom + ' onward');
      else if (urlDateTo) bparts.push('through ' + urlDateTo);
      html += '<div id="lookbooksUrlFilterBanner" style="background:rgba(245,158,11,0.12);border:1px solid rgba(245,158,11,0.35);color:#F59E0B;padding:8px 12px;margin-bottom:12px;border-radius:6px;display:flex;align-items:center;gap:12px;font-size:0.85rem;">' +
        '<span>📄 Showing ' + bparts.join(', ') + ' (' + docs.length + ')</span>' +
        '<button type="button" onclick="clearLookbooksFilter()" style="margin-left:auto;background:transparent;border:1px solid rgba(245,158,11,0.5);color:#F59E0B;padding:2px 10px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Clear filter</button>' +
        '</div>';
    }

    html +=
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Look Books & Line Sheets</h3>' +
        '<button class="btn btn-primary" onclick="lbNewDoc()">+ New Document</button>' +
      '</div>';

    if (!docs.length) {
      html += '<div style="text-align:center;padding:30px;color:var(--warm-gray);font-size:0.85rem;">No documents match the filter.</div>';
      tab.innerHTML = html;
      return;
    }

    html += '<div style="display:flex;flex-direction:column;gap:12px;">';
    docs.forEach(function(doc) {
      var typeBadge = doc.type === 'lookbook'
        ? '<span class="lb-type-badge lookbook">Look Book</span>'
        : '<span class="lb-type-badge linesheet">Line Sheet</span>';
      var statusBadge = doc.status === 'generated'
        ? '<span class="status-badge" style="background:#16a34a;color:white;">GENERATED</span>'
        : '<span class="status-badge" style="background:rgba(196,133,60,0.15);color:var(--amber);">DRAFT</span>';
      var tierLabel = (doc.priceTier || 'wholesale').charAt(0).toUpperCase() + (doc.priceTier || 'wholesale').slice(1);
      var genDate = doc.generatedAt ? formatDate(doc.generatedAt) : '—';
      // Signed-URL expiry indicator. Links over their TTL (default 30d) will 403 — admin
      // re-issues by clicking Regenerate. Pre-migration docs lack urlExpiresAt; show '—'.
      var expDate = doc.urlExpiresAt ? formatDate(doc.urlExpiresAt) : null;
      var expExpired = doc.urlExpiresAt && (new Date(doc.urlExpiresAt).getTime() < Date.now());

      html +=
        '<div class="lb-doc-card" onclick="lbEditDoc(\'' + esc(doc.documentId) + '\')">' +
          '<div style="display:flex;justify-content:space-between;align-items:flex-start;">' +
            '<div>' +
              '<div style="font-weight:500;font-size:0.9rem;">' + esc(doc.title || 'Untitled') + '</div>' +
              '<div style="display:flex;gap:8px;align-items:center;margin-top:6px;">' +
                typeBadge + statusBadge +
                '<span style="font-size:0.78rem;color:var(--warm-gray);">' + tierLabel + ' prices</span>' +
              '</div>' +
            '</div>' +
            '<div style="display:flex;gap:6px;align-items:center;" onclick="event.stopPropagation();">' +
              (doc.generatedUrl && !expExpired
                ? '<a href="' + esc(doc.generatedUrl) + '" target="_blank" class="btn btn-outline btn-small" style="font-size:0.72rem;" onclick="event.stopPropagation();">Download</a>'
                : '') +
              '<button class="btn btn-small" style="font-size:0.72rem;" onclick="event.stopPropagation();lbGenerate(\'' + esc(doc.documentId) + '\')">' +
                (doc.generatedUrl ? (expExpired ? 'Re-issue link' : 'Regenerate') : 'Generate') +
              '</button>' +
              // W2.4 — Share-with-Buyer (only meaningful when a generated PDF exists)
              (doc.generatedUrl
                ? '<button class="btn btn-small" style="font-size:0.72rem;" onclick="event.stopPropagation();lbOpenShareModal(\'' + (window._jsAttr ? window._jsAttr(doc.documentId) : esc(doc.documentId)) + '\')">Share with Buyer</button>'
                : '') +
            '</div>' +
          '</div>' +
          '<div style="font-size:0.78rem;color:var(--warm-gray-light);margin-top:8px;">' +
            'Last generated: ' + genDate +
            (expDate
              ? ' · <span style="color:' + (expExpired ? 'var(--error,#dc2626)' : 'var(--warm-gray-light)') + ';">'
                + (expExpired ? 'Link expired ' : 'Link expires ') + expDate + '</span>'
              : '') +
          '</div>' +
          '<div id="lbGenerating_' + esc(doc.documentId) + '" style="display:none;"></div>' +
        '</div>';
    });
    html += '</div>';

    tab.innerHTML = html;
  }

  // ============================================================
  // Document Builder View
  // ============================================================

  function renderBuilder(docId) {
    var tab = document.getElementById('lookbooksTab');
    if (!tab) return;

    var doc = docId ? docsData[docId] : null;
    var isEdit = !!doc;
    var title = doc ? doc.title : '';
    var type = doc ? doc.type : 'linesheet';
    var priceTier = doc ? doc.priceTier : 'wholesale';
    var showPrices = doc ? doc.showPrices !== false : true;
    var headerText = doc ? (doc.headerText || '') : '';
    var footerText = doc ? (doc.footerText || '') : '';
    var includeCategories = doc ? (doc.includeCategories || []) : [];
    var excludeProductIds = doc ? (doc.excludeProductIds || []) : [];

    // Get all product categories
    var products = window.productsData || [];
    var categories = {};
    products.forEach(function(p) {
      if (p.status === 'archived') return;
      if (p.category) categories[p.category] = true;
    });
    var categoryList = Object.keys(categories).sort();

    var html = '<button class="detail-back" onclick="lbShowList()">← Back to Documents</button>';

    html +=
      '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0 0 20px;">' +
        (isEdit ? 'Edit Document' : 'New Document') +
      '</h3>' +
      '<div style="max-width:640px;">';

    // Title
    html +=
      '<div class="lb-builder-section">' +
        '<div class="form-group" style="margin-bottom:16px;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Title *</label>' +
          '<input type="text" id="lbTitle" value="' + esc(title) + '" placeholder="e.g. Spring 2026 Wholesale Catalog" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +

        // Type + Tier
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">' +
          '<div class="form-group">' +
            '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Document Type</label>' +
            '<select id="lbType" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
              '<option value="linesheet"' + (type === 'linesheet' ? ' selected' : '') + '>Line Sheet (compact, data-focused)</option>' +
              '<option value="lookbook"' + (type === 'lookbook' ? ' selected' : '') + '>Look Book (visual, editorial)</option>' +
            '</select>' +
          '</div>' +
          '<div class="form-group">' +
            '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Price Tier</label>' +
            '<select id="lbPriceTier" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
              '<option value="wholesale"' + (priceTier === 'wholesale' ? ' selected' : '') + '>Wholesale</option>' +
              '<option value="direct"' + (priceTier === 'direct' ? ' selected' : '') + '>Direct</option>' +
              '<option value="retail"' + (priceTier === 'retail' ? ' selected' : '') + '>Retail</option>' +
            '</select>' +
          '</div>' +
        '</div>' +

        // Show prices toggle
        '<div class="form-group" style="margin-bottom:16px;">' +
          '<label style="display:flex;align-items:center;gap:8px;font-size:0.85rem;cursor:pointer;">' +
            '<input type="checkbox" id="lbShowPrices"' + (showPrices ? ' checked' : '') + '>' +
            ' Show prices in document' +
          '</label>' +
        '</div>' +
      '</div>';

    // Header / Footer
    html +=
      '<div class="lb-builder-section">' +
        '<div style="font-size:1rem;font-weight:500;margin-bottom:12px;">Header & Footer</div>' +
        '<div class="form-group" style="margin-bottom:16px;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Header Text</label>' +
          '<input type="text" id="lbHeader" value="' + esc(headerText) + '" placeholder="Brand name / tagline" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' +
        '</div>' +
        '<div class="form-group" style="margin-bottom:0;">' +
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Footer Text</label>' +
          '<textarea id="lbFooter" rows="2" placeholder="Contact info, ordering instructions" style="width:100%;padding:9px 12px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.9rem;">' + esc(footerText) + '</textarea>' +
        '</div>' +
      '</div>';

    // Category filter
    html +=
      '<div class="lb-builder-section">' +
        '<div style="font-size:1rem;font-weight:500;margin-bottom:8px;">Categories</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">Select categories to include. All are included if none selected.</div>' +
        '<div id="lbCategories">';

    if (categoryList.length) {
      categoryList.forEach(function(cat) {
        var selected = includeCategories.indexOf(cat) >= 0;
        html += '<span class="lb-category-chip' + (selected ? ' selected' : '') + '" onclick="lbToggleCategory(this,\'' + esc(cat) + '\')" data-cat="' + esc(cat) + '">' + esc(cat) + '</span>';
      });
    } else {
      html += '<span style="font-size:0.85rem;color:var(--warm-gray-light);">No product categories found.</span>';
    }

    html += '</div></div>';

    // Product exclusion
    html +=
      '<div class="lb-builder-section">' +
        '<div style="font-size:1rem;font-weight:500;margin-bottom:8px;">Exclude Products</div>' +
        '<div style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">Optionally exclude specific products.</div>' +
        '<div id="lbExcluded">';

    excludeProductIds.forEach(function(pid) {
      var prod = products.find(function(p) { return p.pid === pid; });
      var name = prod ? prod.name : pid;
      html += '<span class="lb-product-chip" data-pid="' + esc(pid) + '">' + esc(name) + ' <button onclick="lbRemoveExclusion(this,\'' + esc(pid) + '\')">✕</button></span>';
    });

    html += '</div>';
    html +=
      '<div style="margin-top:8px;">' +
        '<select id="lbExcludeSelect" style="padding:6px 10px;border:1px solid #ddd;border-radius:6px;background:var(--cream);color:var(--charcoal);font-family:\'DM Sans\';font-size:0.85rem;">' +
          '<option value="">Add exclusion...</option>';
    products.forEach(function(p) {
      if (p.status === 'archived') return;
      if (excludeProductIds.indexOf(p.pid) >= 0) return;
      html += '<option value="' + esc(p.pid) + '">' + esc(p.name) + '</option>';
    });
    html += '</select>' +
        '<button class="btn btn-secondary btn-small" style="margin-left:8px;" onclick="lbAddExclusion()">Add</button>' +
      '</div>';
    html += '</div>';

    // Action buttons
    html +=
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:24px;">' +
        (isEdit
          ? '<button class="btn btn-danger btn-small" onclick="lbDeleteDoc(\'' + esc(docId) + '\')">Delete</button>'
          : '<div></div>') +
        '<div style="display:flex;gap:8px;">' +
          '<button class="btn btn-secondary" onclick="lbShowList()">Cancel</button>' +
          '<button class="btn btn-primary" onclick="lbSaveDoc(\'' + (docId ? esc(docId) : '') + '\')">Save</button>' +
          (isEdit ? '<button class="btn btn-outline" onclick="lbSaveAndGenerate(\'' + esc(docId) + '\')">Save & Generate</button>' : '') +
        '</div>' +
      '</div>';

    // W2.4 — Opens panel + Share button for existing docs (edit mode).
    if (isEdit && docId) {
      html += lbRenderOpensPanel(docId);
    }

    html += '</div>';
    tab.innerHTML = html;

    // Kick off async opens load for the panel.
    if (isEdit && docId) lbLoadOpens(docId);
  }

  // ============================================================
  // Builder Interactions
  // ============================================================

  function toggleCategory(chipEl, cat) {
    chipEl.classList.toggle('selected');
  }

  function addExclusion() {
    var select = document.getElementById('lbExcludeSelect');
    if (!select || !select.value) return;
    var pid = select.value;
    var products = window.productsData || [];
    var prod = products.find(function(p) { return p.pid === pid; });
    var name = prod ? prod.name : pid;

    var container = document.getElementById('lbExcluded');
    if (!container) return;

    var chip = '<span class="lb-product-chip" data-pid="' + esc(pid) + '">' + esc(name) + ' <button onclick="lbRemoveExclusion(this,\'' + esc(pid) + '\')">✕</button></span>';
    container.insertAdjacentHTML('beforeend', chip);

    // Remove from dropdown
    var opt = select.querySelector('option[value="' + pid + '"]');
    if (opt) opt.remove();
    select.value = '';
  }

  function removeExclusion(btnEl, pid) {
    var chip = btnEl.parentElement;
    if (chip) chip.remove();

    // Re-add to dropdown
    var select = document.getElementById('lbExcludeSelect');
    var products = window.productsData || [];
    var prod = products.find(function(p) { return p.pid === pid; });
    if (select && prod) {
      var opt = document.createElement('option');
      opt.value = pid;
      opt.textContent = prod.name;
      select.appendChild(opt);
    }
  }

  function collectFormData(docId) {
    var titleEl = document.getElementById('lbTitle');
    var title = titleEl ? titleEl.value.trim() : '';
    if (!title) { showToast('Title is required', 'error'); return null; }

    var typeEl = document.getElementById('lbType');
    var tierEl = document.getElementById('lbPriceTier');
    var showPricesEl = document.getElementById('lbShowPrices');
    var headerEl = document.getElementById('lbHeader');
    var footerEl = document.getElementById('lbFooter');

    // Gather selected categories
    var catChips = document.querySelectorAll('#lbCategories .lb-category-chip.selected');
    var includeCategories = [];
    catChips.forEach(function(chip) {
      includeCategories.push(chip.getAttribute('data-cat'));
    });

    // Gather excluded products
    var exChips = document.querySelectorAll('#lbExcluded .lb-product-chip');
    var excludeProductIds = [];
    exChips.forEach(function(chip) {
      excludeProductIds.push(chip.getAttribute('data-pid'));
    });

    return {
      documentId: docId || null,
      title: title,
      type: typeEl ? typeEl.value : 'linesheet',
      priceTier: tierEl ? tierEl.value : 'wholesale',
      showPrices: showPricesEl ? showPricesEl.checked : true,
      headerText: headerEl ? headerEl.value.trim() : '',
      footerText: footerEl ? footerEl.value.trim() : '',
      includeCategories: includeCategories,
      excludeProductIds: excludeProductIds
    };
  }

  function saveDoc(docId) {
    var data = collectFormData(docId);
    if (!data) return;
    saveDocument(data).then(function(id) {
      showView('list');
    });
  }

  function saveAndGenerate(docId) {
    var data = collectFormData(docId);
    if (!data) return;
    saveDocument(data).then(function(id) {
      showView('list');
      generatePDF(id);
    });
  }

  async function deleteDoc(docId) {
    if (!await mastConfirm('Delete this document? This cannot be undone.', { title: 'Delete Document', danger: true })) return;
    deleteDocument(docId).then(function() {
      showView('list');
    });
  }

  // ============================================================
  // W2.4 — Share with Buyer (token mint via mintLookbookShareToken CF) +
  // opens-tracking panel (reads admin/lookbook_share_opens).
  // ============================================================

  // Cache of opens rows per documentId: { docId: [openRow, ...] }
  var lbOpensCache = {};

  function _jsAttrSafe(s) {
    if (typeof window._jsAttr === 'function') return window._jsAttr(s);
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/'/g, '\\\'').replace(/</g, '\\u003C');
  }

  function lbOpenShareModal(docId) {
    var doc = docsData[docId];
    if (!doc) return;
    if (!doc.generatedUrl) {
      if (typeof showToast === 'function') showToast('Generate the PDF first before sharing.', true);
      return;
    }
    var html =
      '<div style="max-width:480px;padding:24px;">' +
        '<h3>Share &ldquo;' + esc(doc.title || 'Untitled') + '&rdquo; with a buyer</h3>' +
        '<div class="form-group">' +
          '<label>Buyer name</label>' +
          '<input type="text" id="lbShareName" placeholder="e.g. Anna Wilson" autocomplete="off">' +
        '</div>' +
        '<div class="form-group">' +
          '<label>Buyer email (optional — required for email send)</label>' +
          '<input type="email" id="lbShareEmail" placeholder="buyer@example.com" autocomplete="off">' +
        '</div>' +
        '<div class="form-group">' +
          '<label style="display:flex;gap:8px;align-items:center;font-size:0.9rem;">' +
            '<input type="checkbox" id="lbShareSendEmail" checked> Send via email' +
          '</label>' +
        '</div>' +
        '<div id="lbShareStatus" style="margin-top:8px;font-size:0.85rem;"></div>' +
        '<div id="lbShareResult" style="margin-top:12px;display:none;"></div>' +
        '<div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end;">' +
          '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
          '<button class="btn btn-primary" id="lbShareGenerate" onclick="lbGenerateShareLink(\'' + _jsAttrSafe(docId) + '\')">Generate Share Link</button>' +
        '</div>' +
      '</div>';
    openModal(html);
  }
  window.lbOpenShareModal = lbOpenShareModal;

  async function lbGenerateShareLink(docId) {
    var doc = docsData[docId];
    if (!doc) return;
    var name = (document.getElementById('lbShareName').value || '').trim();
    var email = (document.getElementById('lbShareEmail').value || '').trim();
    var sendEmail = document.getElementById('lbShareSendEmail').checked;
    var statusEl = document.getElementById('lbShareStatus');
    var resultEl = document.getElementById('lbShareResult');
    var btn = document.getElementById('lbShareGenerate');

    if (sendEmail && !email) {
      if (statusEl) { statusEl.textContent = 'Email required when "Send via email" is checked.'; statusEl.style.color = '#a67c00'; }
      return;
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      if (statusEl) { statusEl.textContent = 'Invalid email address.'; statusEl.style.color = '#a67c00'; }
      return;
    }

    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }
    if (statusEl) { statusEl.textContent = 'Minting share token…'; statusEl.style.color = 'var(--warm-gray)'; }

    try {
      var tenantId = (MastDB.tenantId && MastDB.tenantId()) || window.TENANT_ID;
      var res = await firebase.functions().httpsCallable('mintLookbookShareToken')({
        tenantId: tenantId,
        lookbookId: doc.documentId,
        recipientName: name || null,
        recipientEmail: email || null,
        sendEmail: !!(sendEmail && email)
      });
      var data = (res && res.data) || {};
      if (data.success === false) throw new Error(data.error || 'mint failed');
      var shareUrl = data.shareUrl || data.url || '';
      if (!shareUrl) throw new Error('No shareUrl returned');

      if (statusEl) {
        statusEl.textContent = sendEmail && email ? ('Email queued to ' + email + '.') : 'Share link ready.';
        statusEl.style.color = 'var(--teal)';
      }
      if (resultEl) {
        resultEl.style.display = '';
        resultEl.innerHTML =
          '<label style="font-size:0.85rem;font-weight:600;display:block;margin-bottom:4px;">Share URL</label>' +
          '<div style="display:flex;gap:8px;">' +
            '<input type="text" id="lbShareUrl" readonly value="' + esc(shareUrl) + '" style="flex:1;padding:8px;border-radius:6px;border:1px solid var(--cream-dark);font-size:0.85rem;background:var(--surface-card,#fff);">' +
            '<button class="btn btn-secondary" style="font-size:0.78rem;" onclick="lbCopyShareUrl()">Copy</button>' +
          '</div>';
      }
      // Invalidate opens cache so a refresh of the panel shows the new token if it has been opened.
      delete lbOpensCache[docId];
    } catch (err) {
      if (statusEl) { statusEl.textContent = 'Error: ' + err.message; statusEl.style.color = '#ef5350'; }
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Share Link'; }
    }
  }
  window.lbGenerateShareLink = lbGenerateShareLink;

  function lbCopyShareUrl() {
    var el = document.getElementById('lbShareUrl');
    if (!el) return;
    el.select();
    try {
      document.execCommand('copy');
      if (typeof showToast === 'function') showToast('Copied to clipboard');
    } catch (e) {
      if (typeof showToast === 'function') showToast('Copy failed — select + copy manually', true);
    }
  }
  window.lbCopyShareUrl = lbCopyShareUrl;

  // ─── Opens panel (rendered inside renderBuilder) ───

  async function lbLoadOpens(docId) {
    try {
      var snap = await MastDB.get('admin/lookbook_share_opens');
      var rows = snap ? Object.keys(snap).map(function(k) { var r = snap[k]; r.id = k; return r; }) : [];
      // Filter to this lookbook + last 30 days.
      var cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
      rows = rows.filter(function(r) {
        if (r.lookbookId !== docId) return false;
        var t = r.openedAt ? new Date(r.openedAt).getTime() : 0;
        return t >= cutoff;
      });
      rows.sort(function(a, b) { return (b.openedAt || '').localeCompare(a.openedAt || ''); });
      lbOpensCache[docId] = rows.slice(0, 50);
    } catch (err) {
      console.warn('[lookbooks] opens load failed:', err && err.message);
      lbOpensCache[docId] = [];
    }
    var panel = document.getElementById('lbOpensPanel_' + docId);
    if (panel) panel.innerHTML = lbRenderOpensPanelInner(docId);
  }

  function _agoLabel(iso) {
    if (!iso) return '';
    var ms = Date.now() - new Date(iso).getTime();
    if (ms < 0) return '';
    var min = Math.floor(ms / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return min + 'm ago';
    var hr = Math.floor(min / 60);
    if (hr < 24) return hr + 'h ago';
    var day = Math.floor(hr / 24);
    return day + 'd ago';
  }

  function lbRenderOpensPanelInner(docId) {
    var rows = lbOpensCache[docId];
    if (!rows) return '<div style="color:var(--warm-gray);font-size:0.85rem;">Loading opens…</div>';
    if (!rows.length) return '<div style="color:var(--warm-gray);font-size:0.85rem;">No opens tracked yet.</div>';
    var html = '<table class="data-table" style="width:100%;font-size:0.85rem;">' +
      '<thead><tr><th>When</th><th>Recipient</th><th>Email</th></tr></thead><tbody>';
    rows.forEach(function(r) {
      var when = r.openedAt ? new Date(r.openedAt).toLocaleString() : '—';
      html += '<tr>' +
        '<td>' + esc(when) + ' <span style="color:var(--warm-gray);font-size:0.72rem;">(' + esc(_agoLabel(r.openedAt)) + ')</span></td>' +
        '<td>' + esc(r.recipientName || '—') + '</td>' +
        '<td>' + esc(r.recipientEmail || '—') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table>';
    return html;
  }

  function lbRenderOpensPanel(docId) {
    return '<div class="lb-builder-section" style="margin-top:24px;">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">' +
        '<div style="font-size:1rem;font-weight:500;">Opens (last 30 days)</div>' +
        '<button class="btn btn-secondary btn-small" style="font-size:0.72rem;" onclick="lbOpenShareModal(\'' + _jsAttrSafe(docId) + '\')">Share with Buyer</button>' +
      '</div>' +
      '<div id="lbOpensPanel_' + esc(docId) + '">' + lbRenderOpensPanelInner(docId) + '</div>' +
    '</div>';
  }
  window.lbRenderOpensPanel = lbRenderOpensPanel;

  // ============================================================
  // Window-exposed functions
  // ============================================================

  window.lbShowList = function() { showView('list'); };
  window.lbNewDoc = function() { showView('builder'); };
  window.lbEditDoc = function(id) { showView('builder', id); };
  window.lbSaveDoc = saveDoc;
  window.lbSaveAndGenerate = saveAndGenerate;
  window.lbDeleteDoc = deleteDoc;
  window.lbGenerate = function(id) { generatePDF(id); };
  window.lbToggleCategory = toggleCategory;
  window.lbAddExclusion = addExclusion;
  window.lbRemoveExclusion = removeExclusion;

  // URL-filter clear (MCP admin-link landings)
  window.clearLookbooksFilter = function() {
    var rp = (typeof window.getRouteParams === 'function') ? window.getRouteParams() : {};
    var clean = {};
    Object.keys(rp || {}).forEach(function(k) {
      if (k !== 'type' && k !== 'status' && k !== 'dateFrom' && k !== 'dateTo' && k !== 'lookbookIds') clean[k] = rp[k];
    });
    if (typeof window.navigateTo === 'function') window.navigateTo('lookbooks', clean);
    else location.hash = '#lookbooks';
    setTimeout(function() { if (typeof renderDocList === 'function') renderDocList(); }, 0);
  };
  window.renderLookbooksList = renderDocList;

  // ============================================================
  // Register with MastAdmin
  // ============================================================

  MastAdmin.registerModule('lookbooks', {
    routes: {
      'lookbooks': { tab: 'lookbooksTab', setup: function() {
        currentView = 'list';
        currentDocId = null;
        loadDocs();
        // Ensure products are loaded for category/product picker
        if (!window.productsLoaded && typeof window.loadProducts === 'function') {
          window.loadProducts();
        }
      } }
    },
    detachListeners: function() {
      unloadDocs();
    }
  });

})();
