/**
 * Publish-to-Channel dialog — the admin "Publish to Channel" picker for a
 * product (openPublishToChannelDialog) plus its publish/undo handlers
 * (publishProductToShopify / undoPublishToShopify).
 *
 * Extracted from app/index.html's inline block (decomposition master plan,
 * Track 1). Lazy-loaded on demand via the eager shims in index.html: the
 * "Publish" button in the products grid is generated onclick
 * (openPublishToChannelDialog); undoPublishToShopify is referenced by the
 * eager renderPublishUndoBanner markup; publishProductToShopify fires from the
 * loaded dialog's generated onclick.
 *
 * Shared channel helpers STAY eager in the shell and are called here as
 * globals: loadAdminChannels, _shimPlatform, renderProductDetail,
 * renderPublishUndoBanner, mastConfirm, openModal, closeModal, showToast, esc,
 * firebase, MastDB, productsData / window.productsData, and the shared mutable
 * window.__mastPublishState session map. All defined before the products
 * surface can render. Logic moved VERBATIM (behavior-preserving).
 */
(function () {
  'use strict';

function openPublishToChannelDialog(pid) {
  var product = (window.productsData || []).find(function(p) { return p.pid === pid; });
  if (!product) { showToast('Product not found', true); return; }

  loadAdminChannels(function(channels) {
    var entries = Object.keys(channels || {})
      .map(function(id) { return Object.assign({ channelId: id }, channels[id]); })
      .filter(function(ch) { return ch && ch.status !== 'archived' && ch.enabled !== false; });

    var refs = product.externalRefs || {};
    function platformOf(ch) { return _shimPlatform(ch) || ch.platform || ''; }
    function publishStateFor(ch) {
      var plat = platformOf(ch);
      if (!plat) return null;
      return refs[plat] && refs[plat].externalId ? refs[plat] : null;
    }

    var notActive = product.status !== 'active';
    var html = '<div class="modal-header"><h3>Publish to Channel</h3>' +
      '<button class="modal-close" onclick="closeModal()">✖</button></div>' +
      '<div class="modal-body">' +
        '<p style="font-size:0.85rem;color:var(--warm-gray);margin-bottom:12px;">' +
          'Pick a channel to publish <strong>' + esc(product.name || pid) + '</strong> to. ' +
          'Channels are configured in Manage › Channels.' +
        '</p>' +
        (notActive
          ? '<div style="margin-bottom:12px;padding:10px 12px;background:rgba(217,119,6,0.08);border:1px solid rgba(217,119,6,0.4);border-radius:6px;font-size:0.85rem;color:#b45309;">' +
              '<strong>This product is in <code>' + esc(product.status || 'draft') + '</code>.</strong> ' +
              'Promote it to <strong>active</strong> from the product detail before publishing to a customer-facing channel.' +
            '</div>'
          : '');

    if (entries.length === 0) {
      html += '<p style="color:var(--warm-gray);">No active channels. Connect one in Manage › Channels first.</p>';
    } else {
      html += '<div style="display:flex;flex-direction:column;gap:8px;">';
      entries.forEach(function(ch) {
        var plat = platformOf(ch);
        var state = publishStateFor(ch);
        var name = ch.name || ch.label || (plat ? plat.charAt(0).toUpperCase() + plat.slice(1) : 'Channel');
        var actionLabel, actionFn, disabled = false, note = '';
        if (plat === 'shopify') {
          actionLabel = state ? 'Update' : 'Publish';
          actionFn = "publishProductToShopify('" + esc(pid) + "');closeModal();";
          if (notActive) {
            disabled = true;
            note = 'Product must be Active to publish.';
          }
        } else if (plat === 'etsy' || plat === 'square') {
          actionLabel = 'Coming soon';
          disabled = true;
          note = plat.charAt(0).toUpperCase() + plat.slice(1) + ' publishing is not yet wired up.';
        } else {
          actionLabel = 'Unsupported';
          disabled = true;
          note = 'No publish handler for "' + plat + '".';
        }
        html += '<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--border-light,#eee);border-radius:6px;">' +
          '<div style="flex:1;">' +
            '<strong>' + esc(name) + '</strong>' +
            (plat ? ' <span style="color:var(--warm-gray);font-size:0.78rem;">· ' + esc(plat) + '</span>' : '') +
            (state
              ? '<div style="font-size:0.78rem;color:var(--teal);">Linked' + (state.externalUrl ? ' · <a href="' + esc(state.externalUrl) + '" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">view</a>' : '') + '</div>'
              : '<div style="font-size:0.78rem;color:var(--warm-gray);">Not yet published</div>') +
            (note ? '<div style="font-size:0.72rem;color:var(--warm-gray);">' + esc(note) + '</div>' : '') +
          '</div>' +
          (disabled
            ? '<button class="btn btn-secondary btn-small" disabled style="opacity:0.5;cursor:not-allowed;">' + actionLabel + '</button>'
            : '<button class="btn btn-primary btn-small" onclick="' + actionFn + '">' + actionLabel + '</button>') +
        '</div>';
      });
      html += '</div>';
    }

    html += '</div><div class="modal-footer">' +
      '<button class="btn btn-secondary" onclick="closeModal()">Close</button>' +
    '</div>';

    openModal(html);
  });
}

async function publishProductToShopify(pid) {
  try {
    var ok = await mastConfirm('Publish this product to Shopify? You can undo during this session.', { title: 'Publish to Shopify', confirmLabel: 'Publish' });
    if (!ok) return;
    showToast('Publishing to Shopify…', false);
    var callable = firebase.functions().httpsCallable('publishProductToShopify');
    var res = await callable({ tenantId: MastDB.tenantId(), pid: pid });
    var result = res && res.data;
    if (!result || !result.ok) {
      showToast('Publish failed: ' + ((result && result.error) || 'unknown error'), true);
      return;
    }
    window.__mastPublishState[pid] = {
      operationId: result.operationId,
      externalId: result.externalId,
      externalUrl: result.externalUrl,
      operation: result.operation,
      startedAt: result.lastSyncedAt || new Date().toISOString(),
    };
    // Update local product cache so the button label switches to "Update on Shopify"
    var localProduct = productsData.find(function(p) { return p.pid === pid; });
    if (localProduct) {
      if (!localProduct.externalRefs) localProduct.externalRefs = {};
      localProduct.externalRefs.shopify = {
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        lastSyncedAt: result.lastSyncedAt,
      };
    }
    showToast((result.operation === 'update' ? 'Updated on Shopify' : 'Published to Shopify') + ' ✓', false);
    renderProductDetail(pid);
  } catch (err) {
    showToast('Publish failed: ' + (err && err.message ? err.message : err), true);
  }
}

async function undoPublishToShopify(pid) {
  var state = window.__mastPublishState[pid];
  if (!state || !state.operationId) {
    showToast('Nothing to undo', true);
    return;
  }
  try {
    var undoOk = await mastConfirm('Undo this publish? On Shopify this will ' + (state.operation === 'create' ? 'delete the product' : 'restore the previous data') + '.', { title: 'Undo Publish', confirmLabel: 'Undo', danger: true });
    if (!undoOk) return;
    showToast('Rolling back…', false);
    var callable = firebase.functions().httpsCallable('rollbackPublishOperation');
    var res = await callable({ tenantId: MastDB.tenantId(), operationId: state.operationId });
    var result = res && res.data;
    if (!result || !result.ok) {
      showToast('Rollback failed: ' + ((result && result.error) || 'unknown error'), true);
      return;
    }
    delete window.__mastPublishState[pid];
    // Clear local cache so button reverts to "Publish to Shopify"
    var localProd = productsData.find(function(p) { return p.pid === pid; });
    if (localProd && localProd.externalRefs) {
      delete localProd.externalRefs.shopify;
    }
    showToast('Publish undone ✓', false);
    renderProductDetail(pid);
  } catch (err) {
    showToast('Rollback failed: ' + (err && err.message ? err.message : err), true);
  }
}

  // Impls for the eager shims + the dialog's generated-onclick targets.
  window.openPublishToChannelDialogImpl = openPublishToChannelDialog;
  window.publishProductToShopify = publishProductToShopify;
  window.undoPublishToShopify = undoPublishToShopify;

  if (typeof MastAdmin !== 'undefined' && MastAdmin.registerModule) {
    MastAdmin.registerModule('publishToChannelDialog', {});
  }
})();
