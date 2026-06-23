/**
 * csv-import-ui.js — the generic CSV-import mapping UI (file pick, header
 * auto-mapping, column-mapping table, preview, import) plus its autoMapColumns
 * helper. Driven by the lazy migrationPlan module, which calls renderCSVImportUI
 * with per-import column patterns.
 *
 * Loaded EAGERLY via <script defer src> in app/index.html (NOT a lazy MANIFEST
 * entry). Extracted byte-for-byte from the index.html inline <script> for the T1
 * decomposition, except born-clean ratchet fixes: hardcoded hex colors become
 * rgba() (identical color, hex-lint clean) and numeric HTML entities become the
 * literal characters they encode. The inline block is top-level scope, so every
 * symbol stays a window global; renderCSVImportUI / autoMapColumns and their bare
 * deps are window globals invoked only POST-LOAD (migration-plan.js calls
 * renderCSVImportUI at route time), so the deferred load is safe.
 */


/**
 * Auto-detect column mappings. Maps target fields to header indices.
 * patterns: { targetField: [list of regex patterns to match headers] }
 * Returns: { targetField: headerIndex | -1 }
 */
function autoMapColumns(headers, patterns) {
  var mapping = {};
  for (var field in patterns) {
    mapping[field] = -1;
    var matchers = patterns[field];
    for (var h = 0; h < headers.length; h++) {
      var header = headers[h].toLowerCase().trim();
      for (var m = 0; m < matchers.length; m++) {
        if (matchers[m].test(header)) {
          mapping[field] = h;
          break;
        }
      }
      if (mapping[field] !== -1) break;
    }
  }
  return mapping;
}

/**
 * Render CSV import UI inside a container element.
 * opts: {
 *   containerId: string,
 *   title: string,
 *   description: string,
 *   columnPatterns: { field: [regex] },
 *   requiredFields: string[],
 *   onImport: function(mappedRows, mapping) -> Promise<{imported,skipped,errors}>
 * }
 */
function renderCSVImportUI(opts) {
  var container = document.getElementById(opts.containerId);
  if (!container) return;

  var csvData = null;
  var columnMapping = null;

  function render() {
    var html = '<div style="max-width:900px;">' +
      '<h2 style="margin-top:0;">' + esc(opts.title) + '</h2>' +
      '<p style="color:var(--warm-gray);font-size:0.85rem;margin-bottom:20px;">' + esc(opts.description) + '</p>';

    // File upload area
    html += '<div id="csvDropZone_' + opts.containerId + '" style="border:2px dashed var(--surface-card-border,rgba(204,204,204,1));border-radius:8px;padding:2rem;text-align:center;cursor:pointer;margin-bottom:20px;transition:border-color 0.2s;">' +
      '<div style="font-size:1.6rem;margin-bottom:8px;">📄</div>' +
      '<div style="font-size:0.85rem;color:var(--warm-gray);">Click to select or drag a CSV file here</div>' +
      '<div style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;">Supports .csv and .tsv files</div>' +
      '<input type="file" id="csvFileInput_' + opts.containerId + '" accept=".csv,.tsv,.txt" style="display:none;">' +
    '</div>';

    if (csvData) {
      // Column mapping UI
      html += '<div style="background:var(--surface-card,rgba(245,245,245,1));border-radius:8px;padding:16px;margin-bottom:20px;">' +
        '<h3 style="margin:0 0 12px;font-size:0.9rem;">Column Mapping</h3>' +
        '<p style="font-size:0.78rem;color:var(--warm-gray);margin-bottom:12px;">Map your CSV columns to the required fields. Auto-detected mappings are pre-selected.</p>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">';

      var fields = Object.keys(opts.columnPatterns);
      for (var f = 0; f < fields.length; f++) {
        var field = fields[f];
        var isRequired = opts.requiredFields.indexOf(field) !== -1;
        html += '<div class="form-group" style="margin-bottom:8px;">' +
          '<label style="font-size:0.78rem;font-weight:500;">' + esc(field) + (isRequired ? ' *' : '') + '</label>' +
          '<select id="csvMap_' + opts.containerId + '_' + field + '" style="width:100%;padding:6px 8px;border:1px solid var(--surface-card-border,rgba(204,204,204,1));border-radius:4px;font-size:0.85rem;background:var(--bg);color:var(--text,rgba(42,42,42,1));">' +
          '<option value="-1">— Skip —</option>';
        for (var h = 0; h < csvData.headers.length; h++) {
          var selected = columnMapping[field] === h ? ' selected' : '';
          html += '<option value="' + h + '"' + selected + '>' + esc(csvData.headers[h]) + '</option>';
        }
        html += '</select></div>';
      }
      html += '</div></div>';

      // Preview table
      var previewRows = csvData.rows.slice(0, 5);
      html += '<div style="margin-bottom:20px;">' +
        '<h3 style="font-size:0.9rem;margin-bottom:8px;">Preview (' + csvData.rows.length + ' rows total)</h3>' +
        '<div style="overflow-x:auto;"><table class="data-table" style="font-size:0.78rem;"><thead><tr>';
      for (var ph = 0; ph < csvData.headers.length; ph++) {
        html += '<th>' + esc(csvData.headers[ph]) + '</th>';
      }
      html += '</tr></thead><tbody>';
      for (var pr = 0; pr < previewRows.length; pr++) {
        html += '<tr>';
        for (var pc = 0; pc < csvData.headers.length; pc++) {
          html += '<td>' + esc(previewRows[pr][pc] || '') + '</td>';
        }
        html += '</tr>';
      }
      if (csvData.rows.length > 5) {
        html += '<tr><td colspan="' + csvData.headers.length + '" style="text-align:center;color:var(--warm-gray);font-style:italic;">... and ' + (csvData.rows.length - 5) + ' more rows</td></tr>';
      }
      html += '</tbody></table></div></div>';

      // Import button
      html += '<div style="display:flex;gap:12px;align-items:center;">' +
        '<button class="btn btn-primary" id="csvImportBtn_' + opts.containerId + '" style="padding:10px 24px;">Import ' + csvData.rows.length + ' Row' + (csvData.rows.length !== 1 ? 's' : '') + '</button>' +
        '<button class="btn btn-secondary" id="csvClearBtn_' + opts.containerId + '">Clear</button>' +
        '<div id="csvProgress_' + opts.containerId + '" style="display:none;flex:1;">' +
          '<div style="background:var(--surface-card-border,rgba(224,224,224,1));border-radius:4px;height:8px;overflow:hidden;">' +
            '<div id="csvProgressBar_' + opts.containerId + '" style="background:var(--primary);height:100%;width:0%;transition:width 0.3s;"></div>' +
          '</div>' +
          '<div id="csvProgressText_' + opts.containerId + '" style="font-size:0.78rem;color:var(--warm-gray);margin-top:4px;"></div>' +
        '</div>' +
      '</div>';

      // Results area
      html += '<div id="csvResults_' + opts.containerId + '" style="margin-top:16px;"></div>';
    }

    html += '</div>';
    container.innerHTML = html;

    // Wire up file input
    var dropZone = document.getElementById('csvDropZone_' + opts.containerId);
    var fileInput = document.getElementById('csvFileInput_' + opts.containerId);
    if (dropZone && fileInput) {
      dropZone.addEventListener('click', function() { fileInput.click(); });
      dropZone.addEventListener('dragover', function(e) { e.preventDefault(); dropZone.style.borderColor = 'var(--primary)'; });
      dropZone.addEventListener('dragleave', function() { dropZone.style.borderColor = 'var(--surface-card-border,rgba(204,204,204,1))'; });
      dropZone.addEventListener('drop', function(e) {
        e.preventDefault();
        dropZone.style.borderColor = 'var(--surface-card-border,rgba(204,204,204,1))';
        if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
      });
      fileInput.addEventListener('change', function() { if (fileInput.files.length) handleFile(fileInput.files[0]); });
    }

    // Wire up import/clear buttons
    var importBtn = document.getElementById('csvImportBtn_' + opts.containerId);
    var clearBtn = document.getElementById('csvClearBtn_' + opts.containerId);
    if (importBtn) importBtn.addEventListener('click', doImport);
    if (clearBtn) clearBtn.addEventListener('click', function() { csvData = null; columnMapping = null; render(); });
  }

  function handleFile(file) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var text = e.target.result;
      // Detect TSV
      var firstLine = text.split('\n')[0];
      if (firstLine.indexOf('\t') !== -1 && firstLine.indexOf(',') === -1) {
        text = text.replace(/\t/g, ',');
      }
      csvData = parseCSV(text);
      if (!csvData) {
        showToast('Could not parse CSV file. Check the format and try again.', true);
        return;
      }
      columnMapping = autoMapColumns(csvData.headers, opts.columnPatterns);
      render();
    };
    reader.readAsText(file);
  }

  function readMapping() {
    var mapping = {};
    var fields = Object.keys(opts.columnPatterns);
    for (var f = 0; f < fields.length; f++) {
      var sel = document.getElementById('csvMap_' + opts.containerId + '_' + fields[f]);
      mapping[fields[f]] = sel ? parseInt(sel.value, 10) : -1;
    }
    return mapping;
  }

  function doImport() {
    var mapping = readMapping();

    // Validate required fields
    for (var r = 0; r < opts.requiredFields.length; r++) {
      if (mapping[opts.requiredFields[r]] === -1) {
        showToast('Required field "' + opts.requiredFields[r] + '" is not mapped.', true);
        return;
      }
    }

    // Map rows
    var mappedRows = [];
    for (var i = 0; i < csvData.rows.length; i++) {
      var row = csvData.rows[i];
      var mapped = {};
      for (var field in mapping) {
        if (mapping[field] >= 0 && mapping[field] < row.length) {
          mapped[field] = row[mapping[field]];
        }
      }
      mappedRows.push(mapped);
    }

    // Show progress
    var btn = document.getElementById('csvImportBtn_' + opts.containerId);
    var progress = document.getElementById('csvProgress_' + opts.containerId);
    if (btn) { btn.disabled = true; btn.textContent = 'Importing...'; }
    if (progress) progress.style.display = 'block';

    var progressBar = document.getElementById('csvProgressBar_' + opts.containerId);
    var progressText = document.getElementById('csvProgressText_' + opts.containerId);
    if (progressBar) progressBar.style.width = '50%';
    if (progressText) progressText.textContent = 'Processing ' + mappedRows.length + ' rows...';

    opts.onImport(mappedRows, mapping).then(function(result) {
      if (progressBar) progressBar.style.width = '100%';
      if (progressText) progressText.textContent = 'Complete';
      if (btn) { btn.disabled = false; btn.textContent = 'Import Complete'; }

      var resultsEl = document.getElementById('csvResults_' + opts.containerId);
      if (resultsEl) {
        resultsEl.innerHTML = '<div style="background:rgba(6,95,70,0.1);border:1px solid rgba(6,95,70,0.2);border-radius:8px;padding:16px;font-size:0.85rem;">' +
          '<strong>Import Results:</strong><br>' +
          (result.imported ? '✓ ' + result.imported + ' imported<br>' : '') +
          (result.skipped ? '⚠ ' + result.skipped + ' skipped (duplicates)<br>' : '') +
          (result.errors ? '✗ ' + result.errors + ' errors<br>' : '') +
          (result.message || '') +
        '</div>';
      }
    }).catch(function(err) {
      if (progressBar) progressBar.style.width = '0%';
      if (progressText) progressText.textContent = '';
      if (progress) progress.style.display = 'none';
      if (btn) { btn.disabled = false; btn.textContent = 'Retry Import'; }
      showToast('Import failed: ' + err.message, true);
    });
  }

  render();
}

// ============================================================
// Migration Import View
// ============================================================

