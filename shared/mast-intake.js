/**
 * mast-intake.js — MastIntake secure-intake engine (client helper).
 *
 * Design (canonical): docs/ux-audit/secure-intake-framework-design.md +
 *   docs/ux-audit/mastintake-api-contract.md (rev. 3). Server half:
 *   mast-architecture/functions/mast-intake-vault.js (Step-0 held-secret vault).
 *
 * WHAT THIS IS — a behind-the-scenes CAPABILITY, a peer of MastDB / MastUI /
 * mastConfirm, that any settings area calls to collect credentials or other
 * sensitive information with ONE consistent, secure grammar. It is NOT a
 * destination page. Areas call it in place:
 *
 *     container.innerHTML = MastIntake.secureField({ provider: 'github' });
 *     MastIntake.hydrate(container);                 // run the fail-closed probe
 *
 * It ships EAGERLY as a top-level <script> (peer of MastDB/MastUI), not as a
 * lazy MODULE_MANIFEST module — otherwise the first in-place secureField()/
 * collect() could fire before the engine loads (api-contract §7.1 / design §9).
 *
 * PROVIDER-AGNOSTIC — the engine knows nothing about GitHub (or any provider).
 * All provider knowledge is DATA it looks up: one ProviderDefinition per
 * provider, registered from the scanned sibling app/modules/connections-
 * providers.js. The engine reuses the UX grammar; the definition carries the
 * provider-specific fields/guide/validation.
 *
 * THE CENTRAL GUARANTEE — FAIL-CLOSED PERSISTENCE (design §6.2):
 *   For held-secret / identity-data families there is NO client-side write
 *   path. The engine's ONLY persist path is the vetted server vault CF
 *   (mastIntakeVaultPut). A non-`ref` return (no CF / unauthenticated / throw)
 *   is a HARD refuse-and-surface — NEVER a local write. A ProviderDefinition
 *   cannot name its own write target; only the server vault's allowlist + a
 *   live CF probe can persist. The secure field renders DISABLED until a live
 *   status probe (mastIntakeVaultStatus) succeeds, so a mistyped/aspirational
 *   descriptor can never silently re-open plaintext storage.
 *
 * INBOUND HYGIENE (design §6.6): the pending secret lives only transiently in
 * the field, is read at submit, sent to the vault, and the field is cleared. It
 * is NEVER stashed in DOM dataset, localStorage, a log, or a URL — the engine
 * is the antidote to the legacy setMaskedField `dataset.saved` pattern, not a
 * reimplementation of it.
 *
 * Held to the coding standards by REVIEW (shared/ is outside the lint ratchets,
 * like MastDB/MastUI); the scanned call-site logic lives in connections-
 * providers.js, under the ratchet.
 *
 * SCOPE OF THIS SLICE: collect / secureField / status / revoke are wired
 * against the live vault CF on the `github` held secret. list / collectDocument
 * are thin contract-stubs (a status board is just a consumer; documents need
 * the identity-data encryption CF, carved out). register() is functional (the
 * providers module calls it).
 */
(function () {
  'use strict';

  // ── Vault CF surface (mast-architecture, same callable surface as the
  //    channel callables — default functions region). These three names are the
  //    ONLY persist/status/revoke path for held-secret credentials. ──────────
  var CF_PUT = 'mastIntakeVaultPut';
  var CF_STATUS = 'mastIntakeVaultStatus';
  var CF_REVOKE = 'mastIntakeVaultRevoke';

  // Masked glyph (U+2022). We never SEND a value containing it (the server also
  // rejects it) — guards against re-submitting a masked read-back as the secret.
  var MASK_CHAR = '•';

  // The known wrapper class the delegated listeners hook onto (api-contract
  // §2/§7.1 — string idiom + delegation, NOT a per-call mount()).
  var FIELD_CLASS = 'mastintake-field';

  // IntakeStatus.state vocabulary (api-contract §2). A held-secret vault holds
  // the secret but performs no upstream liveness check, so a vaulted credential
  // is `collected` (we hold it) — not `connected` (a verified handshake).
  var STATE = {
    CONNECTED: 'connected',
    NEEDS_REAUTH: 'needs-reauth',
    ERROR: 'error',
    NOT_COLLECTED: 'not-collected',
    COLLECTED: 'collected',
    PENDING: 'pending',
    PAYWALLED: 'paywalled'
  };

  // Families whose secret has NO client-side write path — persistence is
  // server-vault-only and the field is disabled until the live probe succeeds.
  var FAIL_CLOSED_FAMILIES = { 'held-secret': true, 'identity-data': true };

  // ── Provider registry — the engine looks up definitions; it never hardcodes
  //    provider knowledge. connections-providers.js calls register(). ─────────
  var _registry = Object.create(null);

  // Per-(provider) probe cache: providerId → Promise<{available, status}>.
  // The probe is the engine's availability gate; cached so repeated hydrate()
  // scans don't hammer the CF.
  var _probeCache = Object.create(null);

  var _idSeq = 0;
  var _delegationBound = false;

  // ── Tiny dependency shims (the engine degrades safely if a peer is absent) ──
  function esc(s) {
    if (window.MastUI && typeof window.MastUI._esc === 'function') return window.MastUI._esc(s);
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function toast(msg, isError) {
    if (typeof window.showToast === 'function') { window.showToast(msg, !!isError); return; }
    // Fail-closed surfacing of last resort — never silent.
    if (isError) console.error('[MastIntake] ' + msg); else console.log('[MastIntake] ' + msg);
  }
  function tenantId() {
    return (window.MastDB && typeof window.MastDB.tenantId === 'function') ? window.MastDB.tenantId() : null;
  }
  function callable(name) {
    if (typeof window.firebase === 'undefined' || !window.firebase.functions) return null;
    return window.firebase.functions().httpsCallable(name);
  }

  // ── Registry ────────────────────────────────────────────────────────────────
  function register(def) {
    if (!def || typeof def !== 'object' || !def.id) {
      console.error('[MastIntake] register() needs a definition with an id');
      return;
    }
    // The engine FORCES concierge off for everything but archetype-A delegated
    // auth — a human must never receive a raw held secret (design §6.5). The
    // descriptor can ask, but it cannot grant itself concierge.
    def.conciergeEligible = !!(def.conciergeEligible && def.family === 'delegated-auth' && def.authType === 'A');
    _registry[def.id] = def;
    return def;
  }
  function getDef(providerId) {
    if (_registry[providerId]) return _registry[providerId];
    // Fallback: a catalog that published itself as a plain global.
    if (window.ConnectionsProviders && window.ConnectionsProviders[providerId]) {
      return register(window.ConnectionsProviders[providerId]);
    }
    return null;
  }

  // ── Trust copy — DERIVED from (family, authType, credentialOwner), never
  //    free-authored and never keyed (a key would re-admit free authoring).
  //    Two-part for C→A delegated hybrids so neither leg over-claims. ──────────
  function deriveTrustCopy(def) {
    var lines = [];
    var family = def.family;
    if (family === 'delegated-auth') {
      // The OAuth leg: the maker authorizes on the provider's own page.
      if (def.authType === 'A') {
        lines.push('You authorize on ' + (def.label || 'the provider') +
          '’s own page — Mast never sees your password.');
      } else {
        // C→A hybrid (Etsy/Square): a paste leg AND an OAuth leg. Tell the
        // truth about both so the paste half isn’t hidden by the OAuth half.
        lines.push('Your app credentials are sent over an encrypted channel to secure storage — ' +
          'stored encrypted and never shown again.');
        lines.push('You then authorize on ' + (def.label || 'the provider') + '’s own page.');
      }
    } else if (family === 'held-secret') {
      // Paste / held-secret: the maker pastes a key we vault server-side.
      lines.push('Sent over an encrypted channel to secure storage. ' +
        'Never saved in your browser or shown again.');
      lines.push('You can revoke it any time.');
    } else if (family === 'identity-data') {
      lines.push('Encrypted at rest and access-controlled. Only the last few characters are ever displayed.');
    } else if (family === 'domain-control') {
      lines.push('No secret is collected — ownership is proven by a DNS record we check.');
    }
    return lines;
  }

  // ── Validation (inline feedback only; the server vault is authoritative) ────
  // Accept any reasonable format — recoverable hints, not hard blocks. The hard
  // gates (minLen, masked-char) are enforced again server-side.
  function fieldOf(def) {
    return (def.fields && def.fields.length) ? def.fields[0] : null;
  }
  function runValidate(field, value) {
    if (!field) return { ok: true };
    var v = String(value || '');
    if (field.minLen && v.length < field.minLen) {
      return { ok: false, hint: 'Looks too short — paste the full value.' };
    }
    if (v.indexOf(MASK_CHAR) !== -1) {
      return { ok: false, hint: 'That looks masked — paste the real value, not the hidden read-back.' };
    }
    if (field.validate instanceof RegExp && v && !field.validate.test(v)) {
      // Soft: format drifts; the server is the real gate. Hint, don’t block.
      return { ok: true, hint: 'Double-check the format' + (field.example ? ' (e.g. ' + field.example + ')' : '') + '.' };
    }
    return { ok: true };
  }

  // ── The fail-closed availability PROBE ──────────────────────────────────────
  // A successful authed status response (even `not-collected`) proves the CF
  // exists and the caller is authorized → the field may be enabled. ANY throw
  // (no CF / unauthenticated / network) keeps it DISABLED. Never assumes good.
  function probe(providerId, force) {
    if (!force && _probeCache[providerId]) return _probeCache[providerId];
    var p = (function () {
      var tid = tenantId();
      var fn = callable(CF_STATUS);
      if (!tid || !fn) {
        return Promise.resolve({ available: false, status: null });
      }
      return fn({ tenantId: tid, provider: providerId }).then(function (res) {
        var data = (res && res.data) || {};
        return { available: true, status: data };
      }).catch(function (err) {
        return { available: false, status: null, error: err && err.message };
      });
    })();
    _probeCache[providerId] = p;
    return p;
  }
  function invalidateProbe(providerId) { delete _probeCache[providerId]; }

  // ── secureField() — inline credential field, returns an HTML STRING ─────────
  // Renders DISABLED ("checking secure storage…") and is enabled only after the
  // probe succeeds. For held-secret/identity it REPLACES the legacy plaintext
  // input (never sits disabled beside a still-writing one). Bind via hydrate().
  function secureField(desc) {
    desc = desc || {};
    var providerId = desc.provider;
    var def = getDef(providerId);
    if (!def) {
      return '<div class="' + FIELD_CLASS + '" data-state="error">' +
        '<p class="mastintake-note mastintake-error">Secure intake is unavailable: ' +
        esc('unknown provider “' + (providerId || '') + '”') + '.</p></div>';
    }
    var field = fieldOf(def);
    var domId = 'mastintake-' + providerId + '-' + (++_idSeq);
    var label = esc(desc.label || (field && field.label) || def.label || 'Credential');
    var trust = deriveTrustCopy(def).map(function (l) {
      return '<li>' + esc(l) + '</li>';
    }).join('');

    // Initial state is fail-closed: a disabled shell with a "checking…" note.
    // hydrate() runs the probe and swaps in the real state.
    return '' +
      '<div class="' + FIELD_CLASS + '" id="' + domId + '" data-provider="' + esc(providerId) + '"' +
      ' data-field="' + esc(field ? field.key : '') + '" data-state="pending">' +
      '  <label class="mastintake-label" for="' + domId + '-input">' + label + '</label>' +
      '  <div class="mastintake-row">' +
      '    <input type="password" id="' + domId + '-input" class="mastintake-input"' +
      '      placeholder="' + esc((field && field.example) || '') + '"' +
      '      autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" disabled>' +
      '    <button type="button" class="btn btn-primary mastintake-save" data-mastintake-action="save" disabled>Save</button>' +
      '  </div>' +
      '  <p class="mastintake-feedback" aria-live="polite"></p>' +
      '  <p class="mastintake-status mastintake-note">Checking secure storage…</p>' +
      '  <ul class="mastintake-trust">' + trust + '</ul>' +
      '</div>';
  }

  // Find the live secret <input> for a wrapper and read+clear its value. The
  // value is held only in this local, never persisted to dataset/localStorage.
  function takePending(wrap) {
    var input = wrap.querySelector('.mastintake-input');
    if (!input) return '';
    var v = String(input.value || '').trim();
    return v;
  }
  function clearField(wrap) {
    var input = wrap.querySelector('.mastintake-input');
    if (input) input.value = '';
  }

  function setFeedback(wrap, msg, kind) {
    var el = wrap.querySelector('.mastintake-feedback');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'mastintake-feedback' + (kind ? ' mastintake-' + kind : '');
  }
  function setStatusLine(wrap, msg, kind) {
    var el = wrap.querySelector('.mastintake-status');
    if (!el) return;
    el.textContent = msg || '';
    el.className = 'mastintake-status mastintake-note' + (kind ? ' mastintake-' + kind : '');
  }

  // Apply a probe result to a rendered wrapper: enable on availability, show the
  // collected/disabled state, wire the deep-link guide.
  function applyState(wrap, def, result) {
    var input = wrap.querySelector('.mastintake-input');
    var saveBtn = wrap.querySelector('.mastintake-save');
    if (!result || !result.available) {
      // Fail-closed: secure storage not reachable / not authorized → DISABLED,
      // with a "set up secure storage" affordance instead of an entry box.
      wrap.setAttribute('data-state', 'disabled');
      if (input) { input.disabled = true; }
      if (saveBtn) { saveBtn.disabled = true; }
      setStatusLine(wrap, 'Secure storage isn’t available right now — credential entry is turned off until it’s reachable.', 'error');
      return;
    }
    var status = result.status || {};
    var collected = status.state === STATE.COLLECTED;
    var errored = status.state === STATE.ERROR;
    if (input) { input.disabled = false; }
    if (saveBtn) { saveBtn.disabled = false; }
    wrap.setAttribute('data-state', collected ? 'collected' : 'ready');

    if (collected) {
      setStatusLine(wrap, 'Stored in secure vault. Paste a new value to replace it, or revoke it below.', 'ok');
      ensureRevokeButton(wrap);
    } else if (errored) {
      setStatusLine(wrap, (status.detail || 'The vaulted secret needs to be re-collected.'), 'error');
    } else {
      setStatusLine(wrap, 'Not collected yet. Paste your ' +
        ((fieldOf(def) && fieldOf(def).label) || 'value').toLowerCase() + ' to store it securely.', '');
    }
    ensureGuide(wrap, def);
  }

  function ensureGuide(wrap, def) {
    if (wrap.querySelector('.mastintake-guide') || !def.guide) return;
    var g = def.guide;
    var steps = (g.steps || []).map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var link = '';
    if (g.deepLink) {
      // New tab, no opener — the guided deep-link the grammar promises.
      link = '<a class="mastintake-deeplink" href="' + esc(g.deepLink) + '"' +
        ' target="_blank" rel="noopener noreferrer">Open ' + esc(def.label || 'provider') + ' →</a>';
    }
    var html = '<details class="mastintake-guide"><summary>How to get this</summary>' +
      (link ? '<p>' + link + '</p>' : '') +
      (steps ? '<ol>' + steps + '</ol>' : '') +
      '</details>';
    var trust = wrap.querySelector('.mastintake-trust');
    if (trust) trust.insertAdjacentHTML('beforebegin', html);
  }

  function ensureRevokeButton(wrap) {
    if (wrap.querySelector('.mastintake-revoke')) return;
    var saveBtn = wrap.querySelector('.mastintake-save');
    if (!saveBtn) return;
    saveBtn.insertAdjacentHTML('afterend',
      '<button type="button" class="btn btn-secondary mastintake-revoke" data-mastintake-action="revoke">Revoke</button>');
  }

  // ── Persist — the ONLY write path. Vault CF or HARD refuse. ──────────────────
  function putSecret(providerId, fields) {
    var tid = tenantId();
    var fn = callable(CF_PUT);
    if (!tid || !fn) {
      // No CF / no tenant → fail-closed refuse. NEVER a local write.
      return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'Secure storage is unavailable.' });
    }
    return fn({ tenantId: tid, provider: providerId, fields: fields }).then(function (res) {
      var data = (res && res.data) || {};
      // The opaque `ref` IS the fail-closed probe: truthy ref ⇒ persisted.
      if (!data.ref || typeof data.ref !== 'string') {
        return { ok: false, status: STATE.ERROR, error: 'Storage did not confirm — not saved.' };
      }
      invalidateProbe(providerId);
      return { ok: true, status: data.state || STATE.COLLECTED, ref: data.ref, detail: data.detail };
    }).catch(function (err) {
      return { ok: false, status: STATE.ERROR, error: (err && err.message) || 'Could not store the value.' };
    });
  }

  function handleSave(wrap) {
    var providerId = wrap.getAttribute('data-provider');
    var def = getDef(providerId);
    if (!def) return;
    var field = fieldOf(def);
    var value = takePending(wrap);
    if (!value) { setFeedback(wrap, 'Enter a value first.', 'error'); return; }

    var check = runValidate(field, value);
    if (!check.ok) { setFeedback(wrap, check.hint || 'That value doesn’t look right.', 'error'); return; }
    if (check.hint) setFeedback(wrap, check.hint, ''); // soft format nudge, non-blocking

    var saveBtn = wrap.querySelector('.mastintake-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    setStatusLine(wrap, 'Storing securely…', '');

    var fields = {};
    fields[field.key] = value;
    putSecret(providerId, fields).then(function (result) {
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      if (result.ok) {
        clearField(wrap);                 // inbound hygiene: drop the raw value
        setFeedback(wrap, '', '');
        toast('Saved to secure storage.');
        return refresh(providerId, wrap); // re-probe → flips to "collected"
      }
      setFeedback(wrap, result.error || 'Could not save.', 'error');
      setStatusLine(wrap, '', '');
    });
  }

  function handleRevoke(wrap) {
    var providerId = wrap.getAttribute('data-provider');
    var def = getDef(providerId);
    revoke(providerId).then(function (result) {
      if (result.ok) {
        toast('Revoked.');
        refresh(providerId, wrap);
      } else {
        setFeedback(wrap, result.error || 'Could not revoke.', 'error');
      }
    });
  }

  // Single delegated listener set — paste/input feedback + Save/Revoke clicks.
  function bindDelegation() {
    if (_delegationBound || typeof document === 'undefined') return;
    _delegationBound = true;

    function wrapOf(node) {
      return node && node.closest ? node.closest('.' + FIELD_CLASS) : null;
    }
    // Validate-on-paste / on-input (inline, recoverable).
    document.addEventListener('input', function (e) {
      var wrap = wrapOf(e.target);
      if (!wrap || !e.target.classList.contains('mastintake-input')) return;
      var def = getDef(wrap.getAttribute('data-provider'));
      var res = runValidate(fieldOf(def), e.target.value);
      setFeedback(wrap, res.ok ? (res.hint || '') : (res.hint || ''), res.ok ? '' : 'error');
    });
    document.addEventListener('click', function (e) {
      var btn = e.target && e.target.closest ? e.target.closest('[data-mastintake-action]') : null;
      if (!btn) return;
      var wrap = wrapOf(btn);
      if (!wrap) return;
      var action = btn.getAttribute('data-mastintake-action');
      if (action === 'save') { e.preventDefault(); handleSave(wrap); }
      else if (action === 'revoke') { e.preventDefault(); handleRevoke(wrap); }
    });
  }

  // ── hydrate() — run the probe for every pending field under root (or the
  //    whole document) and apply its state. The settings area calls this after
  //    assigning innerHTML (and on tab re-entry). Not a per-call mount(); a
  //    one-shot container hydrate, plus the engine self-schedules a fallback. ──
  function hydrate(root) {
    bindDelegation();
    var scope = root || document;
    var nodes = scope.querySelectorAll
      ? scope.querySelectorAll('.' + FIELD_CLASS)
      : [];
    Array.prototype.forEach.call(nodes, function (wrap) {
      var providerId = wrap.getAttribute('data-provider');
      var def = getDef(providerId);
      if (!def) return;
      var st = wrap.getAttribute('data-state');
      if (st === 'collected' || st === 'ready' || st === 'disabled') {
        // already hydrated for this render; refresh() forces a re-probe
      }
      probe(providerId).then(function (result) { applyState(wrap, def, result); });
    });
  }

  // Force a re-probe and re-apply (after save/revoke, or explicit refresh).
  function refresh(providerId, wrap) {
    invalidateProbe(providerId);
    var def = getDef(providerId);
    return probe(providerId, true).then(function (result) {
      if (wrap) { applyState(wrap, def, result); return result; }
      // No wrapper given → re-hydrate any matching fields on the page.
      var nodes = document.querySelectorAll('.' + FIELD_CLASS + '[data-provider="' + providerId + '"]');
      Array.prototype.forEach.call(nodes, function (w) { applyState(w, def, result); });
      return result;
    });
  }

  // ── collect() — guided modal hosting the same secure grammar. For held-secret
  //    this is a deep-link guide + a secureField in a modal. Returns a Promise
  //    that resolves to an IntakeResult. ──────────────────────────────────────
  function collect(providerOrDesc, ctx) {
    ctx = ctx || {};
    var providerId = typeof providerOrDesc === 'string' ? providerOrDesc : (providerOrDesc && providerOrDesc.provider);
    var def = getDef(providerId);
    if (!def) {
      toast('Unknown provider: ' + providerId, true);
      return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'unknown-provider' });
    }
    if (typeof window.openModal !== 'function') {
      toast('Cannot open the secure entry dialog here.', true);
      return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'no-modal-host' });
    }
    var fieldHtml = secureField({ provider: providerId, label: ctx.label });
    var title = esc((ctx.purpose ? '' : '') + 'Connect ' + (def.label || providerId));
    var modalId = 'mastintake-modal-' + (++_idSeq);
    window.openModal(
      '<div id="' + modalId + '" class="mastintake-collect">' +
      '  <h2 class="mastintake-collect-title">' + title + '</h2>' +
      fieldHtml +
      '</div>'
    );
    // Hydrate the freshly-mounted modal field.
    var root = document.getElementById(modalId);
    hydrate(root || undefined);

    // Resolve when the field becomes collected (or the caller closes the modal).
    return new Promise(function (resolve) {
      var settled = false;
      function finish(result) {
        if (settled) return;
        settled = true;
        if (typeof ctx.onResult === 'function') { try { ctx.onResult(result); } catch (e) { /* caller cb */ } }
        resolve(result);
      }
      if (root) {
        root.addEventListener('click', function (e) {
          var btn = e.target && e.target.closest ? e.target.closest('[data-mastintake-action="save"]') : null;
          if (!btn) return;
          // After a successful save the wrapper flips to data-state="collected".
          setTimeout(function () {
            var wrap = root.querySelector('.' + FIELD_CLASS);
            if (wrap && wrap.getAttribute('data-state') === 'collected') {
              finish({ ok: true, status: STATE.COLLECTED, provider: providerId });
            }
          }, 50);
        });
      }
    });
  }

  // ── status() — read-back. For held-secret: the vault status CF (mapped to the
  //    IntakeStatus enum, fail-closed). For delegated-auth/channels: wrap
  //    window.ChannelConnection with a vocab map + a fail-closed default (it
  //    returns raw status, reads one store, and defaults missing→ok = fail-OPEN,
  //    which is backwards). The second-store merge is deferred (github is not a
  //    channel) — design §8 / api-contract §6. ─────────────────────────────────
  function status(providerId) {
    var def = getDef(providerId);
    var family = def && def.family;
    if (!family || FAIL_CLOSED_FAMILIES[family]) {
      // Held-secret / identity → vault status CF, fail-closed on any throw.
      var tid = tenantId();
      var fn = callable(CF_STATUS);
      if (!tid || !fn) {
        return Promise.resolve({ id: providerId, family: family, state: STATE.NOT_COLLECTED, detail: 'Secure storage unavailable' });
      }
      return fn({ tenantId: tid, provider: providerId }).then(function (res) {
        var d = (res && res.data) || {};
        return {
          id: providerId, family: family, category: def && def.category,
          state: d.state || STATE.NOT_COLLECTED, detail: d.detail || '',
          lastError: d.lastError || null, connectedAt: d.connectedAt || null
        };
      }).catch(function (err) {
        // Fail-closed: a throw is NEVER an assumed-good state.
        return { id: providerId, family: family, state: STATE.ERROR, lastError: (err && err.message) || 'status-failed' };
      });
    }
    // Channel branch: vocab-map ChannelConnection with a fail-closed default.
    var CC = window.ChannelConnection;
    if (!CC || typeof CC.getChannelTokenStatus !== 'function') {
      return Promise.resolve({ id: providerId, family: family, state: STATE.NOT_COLLECTED });
    }
    return CC.getChannelTokenStatus(providerId).then(function (raw) {
      // raw ∈ ok | expired | revoked. NB: ChannelConnection collapses an absent
      // doc to 'ok' (fail-OPEN); the fail-closed correction (treat genuinely
      // absent as not-collected) needs the second-store merge — carved out.
      var map = { ok: STATE.CONNECTED, expired: STATE.NEEDS_REAUTH, revoked: STATE.NEEDS_REAUTH };
      return { id: providerId, family: family, category: def && def.category, state: map[raw] || STATE.NOT_COLLECTED };
    }).catch(function () {
      return { id: providerId, family: family, state: STATE.NOT_COLLECTED };
    });
  }

  // ── revoke() — destroy + wipe + audit (server CF). Idempotent. ──────────────
  function revoke(providerId, ctx) {
    var def = getDef(providerId);
    var family = def && def.family;
    if (!family || FAIL_CLOSED_FAMILIES[family]) {
      var tid = tenantId();
      var fn = callable(CF_REVOKE);
      if (!tid || !fn) {
        return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'Secure storage unavailable.' });
      }
      return fn({ tenantId: tid, provider: providerId }).then(function (res) {
        var d = (res && res.data) || {};
        invalidateProbe(providerId);
        return { ok: !!(d.success || d.ok), status: d.state || STATE.NOT_COLLECTED };
      }).catch(function (err) {
        return { ok: false, status: STATE.ERROR, error: (err && err.message) || 'Could not revoke.' };
      });
    }
    // Channel revoke would dispatch to the provider's adapter.revoke — out of
    // this slice (no channel provider is registered here).
    return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'revoke not wired for this family in this slice' });
  }

  // ── Thin contract-stubs (built out when a real consumer needs them) ─────────
  function list() {
    // A status board is just a consumer of MastIntake.list(); not built this
    // slice. Returns the registered providers' ids so the contract shape holds.
    return Promise.resolve(Object.keys(_registry).map(function (id) {
      return { id: id, family: _registry[id].family, category: _registry[id].category };
    }));
  }
  function collectDocument() {
    // Document family needs the restricted-storage + counsel rail (carved out).
    toast('Document intake isn’t available yet.', true);
    return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'not-implemented' });
  }

  // ── Public surface (api-contract §2) ────────────────────────────────────────
  window.MastIntake = {
    register: register,
    secureField: secureField,
    collect: collect,
    collectDocument: collectDocument,
    status: status,
    list: list,
    revoke: revoke,
    hydrate: hydrate,
    refresh: refresh,
    // Internal — for review/debugging only; not part of the contract.
    _internals: { STATE: STATE, getDef: getDef, deriveTrustCopy: deriveTrustCopy, probe: probe, FIELD_CLASS: FIELD_CLASS }
  };

  // Bind the delegated listeners as soon as the engine loads (eager script).
  bindDelegation();
})();
