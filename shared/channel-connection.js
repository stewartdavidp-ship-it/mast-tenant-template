/**
 * J06 — Channel connection helpers (tenant-side).
 *
 * Single source of truth for "is this channel currently connected" across the
 * admin UI and audit-suppression code. The authoritative state lives at
 * `tenants/{tid}/channel_config/{channel}._tokenStatus` (server-side write,
 * managed by mast-architecture sync engine + Squarespace refresh cron).
 *
 *   'ok'      → connected; sync runs normally
 *   'expired' → token TTL'd out; refresh cron will recover, but treat as
 *               disconnected for UI purposes (audit suppression applies)
 *   'revoked' → user uninstalled / refresh failed; admin reconnect required
 *
 * J13 audit UI will call `isChannelConnected()` to suppress drift findings on
 * disconnected channels (per wedge §10 + J06 spec). For V1, this is also
 * imported by the channels module to surface the first-class "Disconnected"
 * card on the channels list.
 *
 * Reads are cached for 30s to avoid hammering Firestore on every audit row;
 * the cache is invalidated on reconnect (clearChannelConnectionCache).
 */
(function() {
  'use strict';

  var TTL_MS = 30 * 1000;
  var _cache = Object.create(null); // channel → { value, fetchedAt }

  function _cached(channel) {
    var hit = _cache[channel];
    if (!hit) return null;
    if (Date.now() - hit.fetchedAt > TTL_MS) {
      delete _cache[channel];
      return null;
    }
    return hit.value;
  }

  /**
   * Returns the raw _tokenStatus for a channel, defaulting to 'ok' when the
   * channel_config doc is absent (never-connected / brand-new channels are
   * not "disconnected" — they're "not yet set up", which is a different UX).
   *
   * @param {string} channel  shopify | etsy | square | squarespace | wix
   * @returns {Promise<'ok'|'expired'|'revoked'>}
   */
  function getChannelTokenStatus(channel) {
    if (!channel) return Promise.resolve('ok');
    var cached = _cached(channel);
    if (cached !== null) return Promise.resolve(cached);
    if (typeof window === 'undefined' || !window.MastDB || typeof window.MastDB.get !== 'function') {
      return Promise.resolve('ok');
    }
    return window.MastDB.get('channel_config/' + channel).then(function(cfg) {
      var status = (cfg && cfg._tokenStatus) || 'ok';
      _cache[channel] = { value: status, fetchedAt: Date.now() };
      return status;
    }).catch(function() {
      return 'ok';
    });
  }

  /**
   * Connection check for audit suppression and admin UI gating.
   *
   * @param {string} channel
   * @returns {Promise<boolean>} true when `_tokenStatus === 'ok'`.
   */
  function isChannelConnected(channel) {
    return getChannelTokenStatus(channel).then(function(s) { return s === 'ok'; });
  }

  function clearChannelConnectionCache(channel) {
    if (channel) delete _cache[channel];
    else _cache = Object.create(null);
  }

  if (typeof window !== 'undefined') {
    window.ChannelConnection = {
      getChannelTokenStatus: getChannelTokenStatus,
      isChannelConnected: isChannelConnected,
      clearChannelConnectionCache: clearChannelConnectionCache,
    };
  }
})();
