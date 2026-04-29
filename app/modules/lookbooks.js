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

    var docs = Object.values(docsData).sort(function(a, b) {
      return (b.updatedAt || '').localeCompare(a.updatedAt || '');
    });

    if (!docs.length) {
      tab.innerHTML =
        '<div style="text-align:center;padding:40px 20px;color:var(--warm-gray);">' +
          '<div style="font-size:1.6rem;margin-bottom:12px;">📄</div>' +
          '<p style="font-size:0.9rem;font-weight:500;margin-bottom:4px;">No look books or line sheets yet</p>' +
          '<p style="font-size:0.85rem;color:var(--warm-gray-light);">Create professional PDF catalogs from your product data.</p>' +
          '<button class="btn btn-primary" style="margin-top:16px;" onclick="lbNewDoc()">+ New Document</button>' +
        '</div>';
      return;
    }

    var html =
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">' +
        '<h3 style="font-family:\'Cormorant Garamond\',serif;font-size:1.6rem;font-weight:500;margin:0;">Look Books & Line Sheets</h3>' +
        '<button class="btn btn-primary" onclick="lbNewDoc()">+ New Document</button>' +
      '</div>';

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

    html += '</div>';
    tab.innerHTML = html;
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
