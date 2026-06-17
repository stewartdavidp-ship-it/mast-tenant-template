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

  // ── Identity-data CF surface (mast-architecture/functions/mast-intake-identity.js,
  //    same callable surface). UNLIKE the held-secret vault (provider-keyed), these
  //    are REF/KIND-keyed: the ciphertext lives server-side under an opaque idv://
  //    ref (envelope-encrypted, masked, gated reveal), and the ref POINTER is
  //    persisted by the CALL-SITE (into the doc the plaintext used to live in), not
  //    by the engine. The engine drives encrypt / reveal / status / delete. ───────
  var CF_ID_ENCRYPT = 'mastIntakeIdentityEncrypt';
  var CF_ID_REVEAL = 'mastIntakeIdentityReveal';
  var CF_ID_STATUS = 'mastIntakeIdentityStatus';
  var CF_ID_DELETE = 'mastIntakeIdentityDelete';

  // Status needs a syntactically-valid ref. For an as-yet-uncollected field we have
  // none, so we probe availability with this sentinel: the CF resolves it to
  // not-collected (success ⇒ reachable + authed ⇒ enable the input); ANY throw
  // (no CF / unauthenticated / network) keeps the field DISABLED (fail-closed). The
  // value matches the CF's parseRef charset (/^[A-Za-z0-9_-]{6,128}$/).
  var ID_PROBE_REF = 'idv://availability-probe-0';

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

  // Per-instance state for identity-data fields (keyed by the rendered wrapper id).
  // Each secureField({ kind, value:ref, onChange }) host gets one entry: the current
  // ref, the CF `kind`, the call-site onChange (ref persistence is the call-site's
  // job — it owns the doc the plaintext used to live in), and a transient legacy
  // plaintext for one-time migrate-on-save (held in this JS var only, NEVER in the
  // DOM / dataset / localStorage — inbound hygiene, design §6.6).
  var _idInstances = Object.create(null);

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
    // Identity-data call-sites address the field by `kind` (api-contract §4-B:
    // secureField({ kind, label, value: rec.ref })); held-secret/domain-control use
    // `provider`. The identity ProviderDefinition is registered with id === kind, so
    // either resolves through the same registry.
    var providerId = desc.provider || desc.kind;
    var def = getDef(providerId);
    if (!def) {
      return '<div class="' + FIELD_CLASS + '" data-state="error">' +
        '<p class="mastintake-note mastintake-error">Secure intake is unavailable: ' +
        esc('unknown provider “' + (providerId || '') + '”') + '.</p></div>';
    }
    // Family fork: domain-control collects NO secret — render the DNS/verify
    // grammar instead of a secret-paste field (no password input, no vault probe).
    if (def.family === 'domain-control') return domainField(desc, def);
    // identity-data: structured PII, encrypted at rest. Ref/kind-keyed CF, a forced
    // counsel rail, and a masked + reveal-to-edit grammar (not a write-once paste).
    if (def.family === 'identity-data') return identityField(desc, def);
    // delegated-auth: the one-click "Connect with X" flow — render a connect CARD
    // (status badge + action button + trust copy), never a secret-paste input. The
    // secret never reaches the client; it is minted by the provider's callback CF.
    if (def.family === 'delegated-auth') return delegatedField(desc, def);
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

  // ─────────────────────────────────────────────────────────────────────────────
  // domain-control family (archetype D) — proof-of-ownership via DNS. Collects NO
  // secret: there is no vault Put, no probe-gated input. "Persistence" is the
  // server-written status doc the adapter reads; the engine renders DNS records +
  // a Verify action and maps a tri-state ladder. domain-control is deliberately
  // ABSENT from FAIL_CLOSED_FAMILIES — there is no plaintext write path to guard.
  // ─────────────────────────────────────────────────────────────────────────────

  function domainField(desc, def) {
    var providerId = def.id;
    var field = fieldOf(def);
    var domId = 'mastintake-' + providerId + '-' + (++_idSeq);
    var label = esc(desc.label || (field && field.label) || def.label || 'Domain');
    var trust = deriveTrustCopy(def).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
    // Initial fail-closed shell: a "checking…" line; the add box stays hidden until
    // status() resolves (so a transient read failure can't present an add box over
    // a domain that already exists). hydrate() drives the real state.
    return '' +
      '<div class="' + FIELD_CLASS + '" id="' + domId + '" data-provider="' + esc(providerId) + '"' +
      ' data-family="domain-control" data-field="' + esc(field ? field.key : '') + '" data-state="pending">' +
      '  <label class="mastintake-label">' + label + '</label>' +
      '  <div class="mastintake-domain-add" style="display:none;">' +
      '    <div class="mastintake-row">' +
      '      <input type="text" class="mastintake-domain-input" placeholder="' + esc((field && field.example) || '') + '"' +
      '        autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false">' +
      '      <button type="button" class="btn btn-primary mastintake-add" data-mastintake-action="domain-add">Add domain</button>' +
      '    </div>' +
      '  </div>' +
      '  <p class="mastintake-feedback" aria-live="polite"></p>' +
      '  <p class="mastintake-status mastintake-note">Checking domain status…</p>' +
      '  <div class="mastintake-records"></div>' +
      '  <div class="mastintake-domain-actions"></div>' +
      '  <ul class="mastintake-trust">' + trust + '</ul>' +
      '</div>';
  }

  function removeBtnHtml() {
    return '<button type="button" class="btn btn-secondary mastintake-remove" data-mastintake-action="domain-remove">Remove</button>';
  }

  // Tri-state ladder: verified→connected (no records/verify, Remove only),
  // failed→needs-reauth (records+Verify+Remove), else→pending (records+Verify+
  // Remove). not-collected → the add box. A genuine read failure (status ERROR)
  // is fail-closed: status-only, NO add box.
  function applyDomainState(wrap, def, result) {
    var addBox = wrap.querySelector('.mastintake-domain-add');
    var recordsEl = wrap.querySelector('.mastintake-records');
    var actionsEl = wrap.querySelector('.mastintake-domain-actions');
    function showAdd(v) { if (addBox) addBox.style.display = v ? '' : 'none'; }
    if (recordsEl) recordsEl.innerHTML = '';
    if (actionsEl) actionsEl.innerHTML = '';
    ensureGuide(wrap, def);

    var s = (result && result.status) || {};
    var state = (result && result.available === false) ? STATE.ERROR : (s.state || STATE.NOT_COLLECTED);

    if (state === STATE.ERROR) {
      // Fail-closed: never show an add box over a possibly-existing domain.
      wrap.setAttribute('data-state', 'disabled');
      showAdd(false);
      setStatusLine(wrap, 'Domain status isn’t available right now — please try again shortly.', 'error');
      return;
    }
    if (state === STATE.NOT_COLLECTED) {
      wrap.setAttribute('data-state', 'ready');
      wrap.removeAttribute('data-domain');
      showAdd(true);
      setStatusLine(wrap, (def.copy && def.copy.addPrompt) || 'No domain connected yet. Add your domain below.', '');
      return;
    }
    // A domain exists. Remember it so verify/remove can name it (custom-domain's
    // CF needs the domain; email-domain's adapter ignores the arg).
    showAdd(false);
    var dom = s.domain ? String(s.domain) : 'your domain';
    wrap.setAttribute('data-domain', s.domain ? String(s.domain) : '');
    if (state === STATE.CONNECTED) {
      wrap.setAttribute('data-state', 'connected');
      setStatusLine(wrap, s.detail || ('✓ Verified — ' + dom + ' is connected.'), 'ok');
      if (actionsEl) actionsEl.innerHTML = removeBtnHtml();
      return;
    }
    // pending or needs-reauth (failed): show records/instructions + Verify + Remove.
    // The adapter may supply `detail` (e.g. "DNS verified — SSL provisioning") and
    // `instructions` (records from an add/verify response, when not in the status read).
    wrap.setAttribute('data-state', state === STATE.NEEDS_REAUTH ? 'error' : 'pending');
    if (state === STATE.NEEDS_REAUTH) {
      setStatusLine(wrap, s.detail || ('✗ Verification failed for ' + dom + '. Check the DNS records below, then verify again.'), 'error');
    } else {
      setStatusLine(wrap, s.detail || '⏳ Pending — add the DNS records below at your registrar, then verify. DNS can take up to 48 hours.', '');
    }
    if (s.instructions) renderInstructions(recordsEl, s.instructions);
    else renderRecords(recordsEl, s.records || []);
    if (actionsEl) {
      actionsEl.innerHTML =
        '<button type="button" class="btn btn-primary mastintake-verify" data-mastintake-action="domain-verify">Verify</button> ' +
        removeBtnHtml();
    }
  }

  // Richer DNS-instructions renderer (custom-domain): message + registrar deep-links
  // + records table (with TTL) + numbered steps + note. Records sourced from an
  // adapter add/verify RESPONSE (not a persisted status doc). Copy via data-attr.
  function renderInstructions(el, instr) {
    if (!el) return;
    if (!instr) { el.innerHTML = ''; return; }
    var html = '';
    if (instr.message) html += '<p class="mastintake-note">' + esc(instr.message) + '</p>';
    if (instr.registrarLinks) {
      var names = { porkbun: 'Porkbun', godaddy: 'GoDaddy', namecheap: 'Namecheap', cloudflare: 'Cloudflare', squarespace: 'Squarespace', google: 'Google Domains' };
      var links = '';
      for (var k in instr.registrarLinks) {
        if (!Object.prototype.hasOwnProperty.call(instr.registrarLinks, k)) continue;
        links += '<a class="mastintake-registrar" href="' + esc(instr.registrarLinks[k]) + '" target="_blank" rel="noopener noreferrer">' + esc(names[k] || k) + '</a> ';
      }
      if (links) html += '<div class="mastintake-registrars"><span class="mastintake-note">Open your registrar:</span> ' + links + '</div>';
    }
    var recs = instr.records || [];
    if (recs.length) {
      var rows = recs.map(function (rec) {
        var value = String(rec.value || rec.content || '');
        return '<tr><td class="mastintake-rec-type">' + esc(rec.type || rec.record_type || '') + '</td>' +
          '<td class="mastintake-rec-name">' + esc(rec.name || '') + '</td>' +
          '<td class="mastintake-rec-value">' + esc(value) +
          ' <button type="button" class="mastintake-copy" data-mastintake-action="domain-copy" data-copy="' + esc(value) + '" title="Copy value">⧉</button></td>' +
          '<td class="mastintake-rec-ttl">' + esc(rec.ttl || '600') + '</td></tr>';
      }).join('');
      html += '<table class="mastintake-records-table"><thead><tr><th>Type</th><th>Name</th><th>Value</th><th>TTL</th></tr></thead><tbody>' + rows + '</tbody></table>';
    }
    if (instr.steps && instr.steps.length) {
      html += '<ol class="mastintake-steps">' + instr.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    }
    if (instr.note) html += '<p class="mastintake-note mastintake-domain-note">' + esc(instr.note) + '</p>';
    el.innerHTML = html;
  }

  // DNS records table. Tolerates BOTH Resend snake_case (record_type/content) and
  // normalized (type/value) shapes. Copy uses a data-attr + delegated click — never
  // an inline-onclick string (a record value must not be injected into a handler).
  function renderRecords(el, records) {
    if (!el) return;
    if (!records || !records.length) { el.innerHTML = ''; return; }
    var rows = records.map(function (rec) {
      var type = esc(rec.type || rec.record_type || '');
      var name = esc(rec.name || '');
      var value = String(rec.value || rec.content || '');
      return '<tr>' +
        '<td class="mastintake-rec-type">' + type + '</td>' +
        '<td class="mastintake-rec-name">' + name + '</td>' +
        '<td class="mastintake-rec-value">' + esc(value) +
        ' <button type="button" class="mastintake-copy" data-mastintake-action="domain-copy"' +
        ' data-copy="' + esc(value) + '" title="Copy value">⧉</button></td>' +
        '</tr>';
    }).join('');
    el.innerHTML = '<table class="mastintake-records-table"><thead><tr>' +
      '<th>Type</th><th>Name</th><th>Value</th></tr></thead><tbody>' + rows + '</tbody></table>';
  }

  // Generic RBAC pre-check driven by def.rbac (the adapter also enforces server-
  // side). Avoids a confirm-then-deny on destructive actions.
  function canMutate(def) {
    if (def && def.rbac && typeof window.can === 'function') {
      return window.can(def.rbac.route, def.rbac.axis || 'edit');
    }
    return true;
  }

  function handleDomainAdd(wrap) {
    var def = getDef(wrap.getAttribute('data-provider'));
    if (!def) return;
    if (!canMutate(def)) { toast('You don’t have permission to change this.', true); return; }
    if (!def.adapter || typeof def.adapter.setup !== 'function') { toast('This domain provider isn’t set up.', true); return; }
    var input = wrap.querySelector('.mastintake-domain-input');
    var field = fieldOf(def);
    var domain = String((input && input.value) || '').trim().toLowerCase();
    if (!domain) { setFeedback(wrap, 'Enter a domain first.', 'error'); return; }
    if (field && field.validate instanceof RegExp && !field.validate.test(domain)) {
      setFeedback(wrap, 'That doesn’t look like a domain' + (field.example ? ' (e.g. ' + field.example + ')' : '') + '.', 'error');
      return;
    }
    var btn = wrap.querySelector('.mastintake-add');
    if (btn) { btn.disabled = true; btn.textContent = 'Adding…'; }
    setFeedback(wrap, '', '');
    setStatusLine(wrap, 'Adding ' + esc(domain) + '…', '');
    Promise.resolve(def.adapter.setup({ domain: domain })).then(function (r) {
      if (btn) { btn.disabled = false; btn.textContent = 'Add domain'; }
      if (r && r.ok === false) { setFeedback(wrap, r.error || 'Could not add the domain.', 'error'); return; }
      setFeedback(wrap, '', '');
      // If the response carries instructions (custom-domain — records aren't yet in
      // the status read), render them directly. Otherwise re-read status (email-domain).
      if (r && r.instructions) {
        applyDomainState(wrap, def, { available: true, status: { state: r.state || STATE.PENDING, domain: domain, instructions: r.instructions, detail: r.detail } });
      } else {
        return refresh(def.id, wrap);
      }
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Add domain'; }
      setFeedback(wrap, (err && err.message) || 'Could not add the domain.', 'error');
    });
  }

  function handleDomainVerify(wrap) {
    var def = getDef(wrap.getAttribute('data-provider'));
    if (!def || !def.adapter || typeof def.adapter.verify !== 'function') return;
    if (!canMutate(def)) { toast('You don’t have permission to change this.', true); return; }
    var btn = wrap.querySelector('.mastintake-verify');
    if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }
    setStatusLine(wrap, 'Checking verification status…', '');
    var activeDomain = wrap.getAttribute('data-domain') || '';
    Promise.resolve(def.adapter.verify({ domain: activeDomain })).then(function (r) {
      // Re-render instructions if the verify response returns them (custom-domain
      // still-pending); otherwise re-read status (email-domain / verified).
      if (r && r.instructions) {
        applyDomainState(wrap, def, { available: true, status: { state: r.state || STATE.PENDING, domain: activeDomain, instructions: r.instructions, detail: r.detail } });
      } else {
        return refresh(def.id, wrap);
      }
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Verify'; }
      setFeedback(wrap, (err && err.message) || 'Could not verify right now.', 'error');
    });
  }

  function handleDomainRemove(wrap) {
    var def = getDef(wrap.getAttribute('data-provider'));
    if (!def || !def.adapter || typeof def.adapter.remove !== 'function') return;
    if (!canMutate(def)) { toast('You don’t have permission to change this.', true); return; }
    var activeDomain = wrap.getAttribute('data-domain') || '';
    function doRemove() {
      Promise.resolve(def.adapter.remove({ domain: activeDomain })).then(function () {
        return refresh(def.id, wrap);
      }).catch(function (err) {
        setFeedback(wrap, (err && err.message) || 'Could not remove the domain.', 'error');
      });
    }
    // Provider-supplied honest copy (def.copy.removeConfirm / removeTitle). The
    // default avoids any false "deletes from the provider" claim.
    var copy = (def.copy && def.copy.removeConfirm) || 'Remove this domain from Mast? Provider-side cleanup is handled separately.';
    var title = (def.copy && def.copy.removeTitle) || 'Remove domain';
    if (activeDomain) copy = copy.replace('{domain}', activeDomain);
    if (typeof window.mastConfirm === 'function') {
      window.mastConfirm(copy, { title: title, danger: true }).then(function (ok) { if (ok) doRemove(); });
    } else { doRemove(); }
  }

  function handleDomainCopy(btn) {
    var val = btn.getAttribute('data-copy') || '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(val).then(function () { toast('Copied.'); }, function () { /* clipboard denied */ });
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // identity-data family (archetype C, structured PII) — license #, insurance
  // policy #, tax registration id, EIN/SSN, bank/routing. FAIL-CLOSED: there is NO
  // client-side write path; the value is envelope-encrypted server-side by the
  // field-encryption CF (mast-intake-identity.js) and only a masked last-4 ever
  // returns. The extra axis vs held-secret is that an encrypted field is EDITABLE —
  // so this family adds a gated Reveal-to-edit round-trip (admin-only). The ref
  // POINTER (idv://…) is persisted by the CALL-SITE via desc.onChange; the engine
  // never writes the doc that replaces the plaintext field. Counsel rail is FORCED
  // by family (design §6.3), single-sourced in BusinessEntityConstants.
  // ─────────────────────────────────────────────────────────────────────────────

  // The forced counsel rail (design §6.3) — single-sourced in BusinessEntityConstants,
  // never inline-authored here. The descriptor may ADD (def.counselAdd) but never
  // suppress. Uses the counsel-locked IDENTITY_FIELD_COUNSEL_WARNING (encrypted-at-rest
  // posture for a TYPED identity number), falling back to the document-upload SSN
  // warning if a stale constants bundle predates it; if neither is loaded the trust
  // copy still carries the posture (we never substitute hand-authored legal copy).
  function identityCounselHtml(def) {
    var C = window.BusinessEntityConstants || {};
    var w = C.IDENTITY_FIELD_COUNSEL_WARNING || C.DOCUMENT_UPLOAD_SSN_WARNING || {};
    var head = w.headline || '';
    var body = w.body || '';
    var add = (def && def.counselAdd) ? esc(def.counselAdd) : '';
    if (!head && !body && !add) return '';
    return '<div class="mastintake-counsel" role="note">' +
      (head ? '<p class="mastintake-counsel-head">' + esc(head) + '</p>' : '') +
      (body ? '<p class="mastintake-counsel-body">' + esc(body) + '</p>' : '') +
      (add ? '<p class="mastintake-counsel-add">' + add + '</p>' : '') +
      '</div>';
  }

  function identityField(desc, def) {
    var providerId = def.id;
    var field = fieldOf(def);
    var kind = desc.kind || (field && field.kind) || def.id;
    var ref = desc.value || desc.ref || null;
    var domId = 'mastintake-' + providerId + '-' + (++_idSeq);
    var label = esc(desc.label || (field && field.label) || def.label || 'Sensitive ID');
    // Stash per-instance state. legacyValue (existing plaintext mid-migration) lives
    // ONLY here, never in the DOM — a one-click "Encrypt stored value" sends it to
    // the CF without it ever touching an input.
    _idInstances[domId] = {
      kind: kind,
      ref: (ref ? String(ref) : null),
      onChange: (typeof desc.onChange === 'function' ? desc.onChange : null),
      legacy: (desc.legacyValue != null && desc.legacyValue !== '') ? String(desc.legacyValue) : ''
    };
    var trust = deriveTrustCopy(def).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
    var counsel = identityCounselHtml(def);
    // Initial fail-closed shell: a "checking…" line; entry/masked stay hidden until
    // the status probe resolves. hydrate() drives the real state.
    return '' +
      '<div class="' + FIELD_CLASS + '" id="' + domId + '" data-provider="' + esc(providerId) + '"' +
      ' data-family="identity-data" data-field="' + esc(field ? field.key : '') + '" data-state="pending">' +
      '  <label class="mastintake-label" for="' + domId + '-input">' + label + '</label>' +
      counsel +
      '  <div class="mastintake-id-masked" style="display:none;"></div>' +
      '  <div class="mastintake-row mastintake-id-entry" style="display:none;">' +
      '    <input type="password" id="' + domId + '-input" class="mastintake-input"' +
      '      placeholder="' + esc((field && field.example) || '') + '"' +
      '      autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" disabled>' +
      '    <button type="button" class="btn btn-primary mastintake-save" data-mastintake-action="id-save" disabled>Save</button>' +
      '  </div>' +
      '  <div class="mastintake-id-actions"></div>' +
      '  <p class="mastintake-feedback" aria-live="polite"></p>' +
      '  <p class="mastintake-status mastintake-note">Checking secure storage…</p>' +
      '  <ul class="mastintake-trust">' + trust + '</ul>' +
      '</div>';
  }

  // Read the masked metadata / availability for a ref (or the sentinel when none).
  function identityStatusCall(ref) {
    var tid = tenantId();
    var fn = callable(CF_ID_STATUS);
    if (!tid || !fn) return Promise.resolve({ available: false, status: null });
    return fn({ tenantId: tid, ref: ref || ID_PROBE_REF }).then(function (res) {
      return { available: true, status: (res && res.data) || {} };
    }).catch(function (err) {
      return { available: false, status: null, error: err && err.message };
    });
  }

  // Apply a status result: disabled (fail-closed) / collected (masked + reveal/clear)
  // / error (unreadable → re-enter) / not-collected (entry, + migrate button if a
  // legacy plaintext is still in the doc).
  function applyIdentityState(wrap, def, result) {
    var inst = _idInstances[wrap.id] || {};
    var maskedEl = wrap.querySelector('.mastintake-id-masked');
    var entryEl = wrap.querySelector('.mastintake-id-entry');
    var input = wrap.querySelector('.mastintake-input');
    var saveBtn = wrap.querySelector('.mastintake-save');
    var actionsEl = wrap.querySelector('.mastintake-id-actions');
    function showEntry(v) { if (entryEl) entryEl.style.display = v ? '' : 'none'; }
    function showMasked(v) { if (maskedEl) maskedEl.style.display = v ? '' : 'none'; }
    if (actionsEl) actionsEl.innerHTML = '';

    if (!result || !result.available) {
      // Fail-closed: field-encryption not reachable / not authorized → DISABLED.
      wrap.setAttribute('data-state', 'disabled');
      showMasked(false); showEntry(true);
      if (input) { input.disabled = true; input.value = ''; }
      if (saveBtn) saveBtn.disabled = true;
      setStatusLine(wrap, 'Secure storage isn’t available right now — entry is turned off until it’s reachable.', 'error');
      return;
    }
    var status = result.status || {};
    var collected = status.state === STATE.COLLECTED && inst.ref;
    var errored = status.state === STATE.ERROR;

    if (collected) {
      wrap.setAttribute('data-state', 'collected');
      showEntry(false);
      showMasked(true);
      if (maskedEl) maskedEl.innerHTML = 'Stored securely · <span class="mastintake-id-last4">' + esc(status.masked || '••••') + '</span>';
      setStatusLine(wrap, 'Encrypted at rest. Reveal to edit, or clear it.', 'ok');
      if (actionsEl) actionsEl.innerHTML =
        '<button type="button" class="btn btn-secondary mastintake-id-reveal" data-mastintake-action="id-reveal">Reveal to edit</button> ' +
        '<button type="button" class="btn btn-secondary mastintake-id-clear" data-mastintake-action="id-clear">Clear</button>';
      return;
    }
    if (errored) {
      wrap.setAttribute('data-state', 'error');
      showMasked(false); showEntry(true);
      if (input) { input.disabled = false; input.type = 'password'; input.value = ''; }
      if (saveBtn) saveBtn.disabled = false;
      setStatusLine(wrap, 'The stored value couldn’t be read (it may need re-entry). Enter a new value to replace it.', 'error');
      if (actionsEl && inst.ref) actionsEl.innerHTML =
        '<button type="button" class="btn btn-secondary mastintake-id-clear" data-mastintake-action="id-clear">Clear</button>';
      return;
    }
    // not-collected
    wrap.setAttribute('data-state', 'ready');
    showMasked(false); showEntry(true);
    if (input) { input.disabled = false; input.type = 'password'; }
    if (saveBtn) saveBtn.disabled = false;
    if (inst.legacy) {
      // One-time migration: the plaintext is still in the doc. Offer a single click
      // to encrypt it — the value never enters an input (it lives in inst.legacy).
      setStatusLine(wrap, 'This value is currently stored in plain text. Encrypt it now, or enter a new value below.', '');
      if (actionsEl) actionsEl.innerHTML =
        '<button type="button" class="btn btn-primary mastintake-id-migrate" data-mastintake-action="id-migrate">Encrypt stored value</button>';
    } else {
      setStatusLine(wrap, 'Not stored yet. Enter the value to encrypt it at rest.', '');
    }
  }

  function identityRefresh(wrap, def) {
    var inst = _idInstances[wrap.id] || {};
    return identityStatusCall(inst.ref).then(function (result) {
      applyIdentityState(wrap, def, result);
      return result;
    });
  }

  function _idNotify(inst, payload) {
    if (inst && typeof inst.onChange === 'function') {
      try { inst.onChange(payload); } catch (e) { /* call-site cb — never let it break the flow */ }
    }
  }
  function _idSaveFail(wrap, msg) {
    var saveBtn = wrap.querySelector('.mastintake-save');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
    setFeedback(wrap, msg, 'error');
    setStatusLine(wrap, '', '');
  }

  // The ONLY write path: envelope-encrypt via the CF, or HARD refuse. Pass the
  // existing ref to edit-in-place; a non-`ref` return is never a local write.
  function _identityEncrypt(wrap, def, inst, value) {
    var saveBtn = wrap.querySelector('.mastintake-save');
    if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }
    setStatusLine(wrap, 'Encrypting…', '');
    var tid = tenantId();
    var fn = callable(CF_ID_ENCRYPT);
    if (!tid || !fn) { _idSaveFail(wrap, 'Secure storage is unavailable.'); return; }
    var payload = { tenantId: tid, kind: inst.kind, value: value };
    if (inst.ref) payload.ref = inst.ref; // edit-in-place
    fn(payload).then(function (res) {
      var d = (res && res.data) || {};
      // The opaque `ref` IS the fail-closed probe: truthy ref ⇒ persisted.
      if (!d.ref || typeof d.ref !== 'string') { _idSaveFail(wrap, 'Storage did not confirm — not saved.'); return; }
      inst.ref = d.ref;
      inst.legacy = '';           // migration done — plaintext no longer needed
      clearField(wrap);           // inbound hygiene: drop the raw value from the DOM
      var inp = wrap.querySelector('.mastintake-input');
      if (inp) inp.type = 'password';
      setFeedback(wrap, '', '');
      if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
      toast('Encrypted and stored.');
      // Hand the ref + masked to the call-site to persist (it owns the doc that the
      // plaintext field used to live in). The engine never writes that doc.
      _idNotify(inst, { ref: d.ref, masked: d.masked || null, last4: d.last4 || null, state: d.state || STATE.COLLECTED, kind: inst.kind });
      identityRefresh(wrap, def); // re-read status → flips to collected/masked
    }).catch(function (err) {
      _idSaveFail(wrap, (err && err.message) || 'Could not store the value.');
    });
  }

  function handleIdentitySave(wrap) {
    var def = getDef(wrap.getAttribute('data-provider'));
    var inst = _idInstances[wrap.id];
    if (!def || !inst) return;
    var value = takePending(wrap);
    if (!value) { setFeedback(wrap, 'Enter a value first.', 'error'); return; }
    var check = runValidate(fieldOf(def), value);
    if (!check.ok) { setFeedback(wrap, check.hint || 'That value doesn’t look right.', 'error'); return; }
    if (check.hint) setFeedback(wrap, check.hint, ''); // soft format nudge, non-blocking
    _identityEncrypt(wrap, def, inst, value);
  }

  function handleIdentityMigrate(wrap) {
    var def = getDef(wrap.getAttribute('data-provider'));
    var inst = _idInstances[wrap.id];
    if (!def || !inst || !inst.legacy) return;
    _identityEncrypt(wrap, def, inst, inst.legacy);
  }

  // The gated decrypt round-trip — admin-only on the server. Puts the plaintext into
  // the entry input for editing (the one sanctioned plaintext-in-DOM moment); it is
  // cleared again on save. Never stashed anywhere persistent.
  function handleIdentityReveal(wrap) {
    var inst = _idInstances[wrap.id];
    if (!inst || !inst.ref) return;
    var tid = tenantId();
    var fn = callable(CF_ID_REVEAL);
    if (!tid || !fn) { setFeedback(wrap, 'Secure storage is unavailable.', 'error'); return; }
    var btn = wrap.querySelector('.mastintake-id-reveal');
    if (btn) { btn.disabled = true; btn.textContent = 'Revealing…'; }
    fn({ tenantId: tid, ref: inst.ref }).then(function (res) {
      var d = (res && res.data) || {};
      if (typeof d.value !== 'string') {
        if (btn) { btn.disabled = false; btn.textContent = 'Reveal to edit'; }
        setFeedback(wrap, 'Could not reveal the value.', 'error');
        return;
      }
      var maskedEl = wrap.querySelector('.mastintake-id-masked');
      var entryEl = wrap.querySelector('.mastintake-id-entry');
      var input = wrap.querySelector('.mastintake-input');
      var saveBtn = wrap.querySelector('.mastintake-save');
      if (maskedEl) maskedEl.style.display = 'none';
      if (entryEl) entryEl.style.display = '';
      if (input) { input.disabled = false; input.type = 'text'; input.value = d.value; input.focus(); }
      if (saveBtn) saveBtn.disabled = false;
      wrap.setAttribute('data-state', 'editing');
      setStatusLine(wrap, 'Editing — Save to re-encrypt, or leave the page to keep the stored value.', '');
    }).catch(function (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Reveal to edit'; }
      setFeedback(wrap, (err && err.message) || 'Only an owner can reveal this to edit.', 'error');
    });
  }

  function handleIdentityClear(wrap) {
    var def = getDef(wrap.getAttribute('data-provider'));
    var inst = _idInstances[wrap.id];
    if (!inst) return;
    function doClear() {
      var tid = tenantId();
      var fn = callable(CF_ID_DELETE);
      if (inst.ref && tid && fn) {
        fn({ tenantId: tid, ref: inst.ref }).then(function () {
          inst.ref = null; inst.legacy = '';
          _idNotify(inst, { ref: null, masked: null, last4: null, state: STATE.NOT_COLLECTED, kind: inst.kind });
          toast('Cleared.');
          identityRefresh(wrap, def);
        }).catch(function (err) { setFeedback(wrap, (err && err.message) || 'Could not clear.', 'error'); });
      } else {
        // No server record (e.g. a legacy-plaintext-only field) → just tell the
        // call-site to drop the pointer/plaintext from its doc.
        inst.ref = null; inst.legacy = '';
        _idNotify(inst, { ref: null, masked: null, last4: null, state: STATE.NOT_COLLECTED, kind: inst.kind });
        identityRefresh(wrap, def);
      }
    }
    if (typeof window.mastConfirm === 'function') {
      window.mastConfirm('Remove this stored value? This deletes the encrypted record.', { title: 'Clear value', danger: true })
        .then(function (ok) { if (ok) doClear(); });
    } else { doClear(); }
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // delegated-auth family (archetype A / B / C→A) — the one-click "Connect with X"
  // flow that lets the maker AVOID pasting a key. The maker authorizes on the
  // PROVIDER's own page (OAuth), so Mast never sees a password; the upstream token
  // is minted, vaulted, and refreshed SERVER-side (lifetimes vary per provider —
  // Wix ~5min, Squarespace 30min/7-day, Plaid permanent, Shopify long-lived — but
  // refresh is a server cron concern, not the client's). Like domain-control, this
  // family is ADAPTER-DRIVEN: the def carries adapter.connect / healthCheck /
  // disconnect and the engine renders a provider-agnostic connect CARD that drives
  // them. delegated-auth is ABSENT from FAIL_CLOSED_FAMILIES — there is no
  // client-side plaintext write path to guard (the secret is minted by the
  // provider's callback CF, never by the browser). A provider whose OAuth-start CF
  // is not yet shipped declares `available:false` and renders an honest "coming
  // soon" card (never a Connect button that 404s) — the framework's "don't make
  // connect a cold wall" rule (skippable + re-entry).
  // ─────────────────────────────────────────────────────────────────────────────

  function delegatedField(desc, def) {
    var providerId = def.id;
    var domId = 'mastintake-' + providerId + '-' + (++_idSeq);
    var label = esc(desc.label || def.label || 'Connection');
    var trust = deriveTrustCopy(def).map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('');
    // Initial fail-closed shell: a "checking…" line. hydrate() reads status (via the
    // adapter / ChannelConnection) and drives the real state.
    return '' +
      '<div class="' + FIELD_CLASS + ' mastintake-da" id="' + domId + '" data-provider="' + esc(providerId) + '"' +
      ' data-family="delegated-auth" data-state="pending">' +
      '  <div class="mastintake-da-head">' +
      '    <span class="mastintake-da-icon">' + esc(def.icon || '🔌') + '</span>' +
      '    <div class="mastintake-da-headtext">' +
      '      <div class="mastintake-da-label">' + label + '</div>' +
      '      <div class="mastintake-da-status mastintake-note">Checking connection…</div>' +
      '    </div>' +
      '    <span class="mastintake-da-badge" data-badge="pending">…</span>' +
      '  </div>' +
      '  <div class="mastintake-da-detail mastintake-note"></div>' +
      '  <p class="mastintake-feedback" aria-live="polite"></p>' +
      '  <div class="mastintake-da-actions"></div>' +
      '  <ul class="mastintake-trust">' + trust + '</ul>' +
      '</div>';
  }

  function daSetBadge(wrap, kind, text) {
    var b = wrap.querySelector('.mastintake-da-badge');
    if (b) { b.setAttribute('data-badge', kind); b.textContent = text; }
  }
  function daSetStatus(wrap, msg, kind) {
    var el = wrap.querySelector('.mastintake-da-status');
    if (el) { el.textContent = msg || ''; el.className = 'mastintake-da-status mastintake-note' + (kind ? ' mastintake-' + kind : ''); }
  }

  // Map the IntakeStatus enum → connect-card UI. `available:false` short-circuits to
  // a "coming soon" card. The detail string (store name, "N products", connectedAt)
  // comes from the adapter.healthCheck via status(), so the engine never names a
  // provider field. `s` is the IntakeStatus object (state/detail/store/lastError).
  function applyDelegatedState(wrap, def, s) {
    var detailEl = wrap.querySelector('.mastintake-da-detail');
    var actionsEl = wrap.querySelector('.mastintake-da-actions');
    if (detailEl) detailEl.textContent = '';
    if (actionsEl) actionsEl.innerHTML = '';
    ensureGuide(wrap, def);                 // reuse the deep-link/steps guide renderer
    var connectLabel = (def.copy && def.copy.connectLabel) || ('Connect ' + (def.label || ''));
    var disconnectBtn = '<button type="button" class="btn btn-secondary mastintake-da-disconnect" data-mastintake-action="da-disconnect">Disconnect</button>';

    // Coming-soon: provider declared but its OAuth-start CF isn't live yet. Honest
    // muted card with a disabled CTA — never a Connect button that errors.
    if (def.available === false) {
      wrap.setAttribute('data-state', 'coming-soon');
      daSetBadge(wrap, 'soon', 'Coming soon');
      daSetStatus(wrap, (def.copy && def.copy.comingSoon) || ('One-click ' + (def.label || '') + ' connect is coming soon.'), '');
      if (actionsEl) actionsEl.innerHTML = '<button type="button" class="btn btn-secondary mastintake-da-cta" disabled>' + esc(connectLabel) + '</button>';
      return;
    }

    s = s || {};
    var state = s.state || STATE.NOT_COLLECTED;
    if (state === STATE.CONNECTED) {
      wrap.setAttribute('data-state', 'connected');
      daSetBadge(wrap, 'connected', 'Connected');
      // Specific positive confirmation: "✓ Connected to <store>" (design's connect-UX).
      daSetStatus(wrap, '✓ ' + (s.store ? ('Connected to ' + s.store) : 'Connected'), 'ok');
      if (detailEl && s.detail) detailEl.textContent = s.detail;
      if (actionsEl) actionsEl.innerHTML =
        '<button type="button" class="btn btn-secondary mastintake-da-reconnect" data-mastintake-action="da-connect">Reconnect</button> ' + disconnectBtn;
      return;
    }
    if (state === STATE.NEEDS_REAUTH) {
      wrap.setAttribute('data-state', 'needs-reauth');
      daSetBadge(wrap, 'warn', 'Reconnect needed');
      daSetStatus(wrap, s.detail || (def.refreshable ? 'The connection expired — reconnect to refresh access.' : 'The connection needs to be re-authorized.'), 'error');
      if (actionsEl) actionsEl.innerHTML =
        '<button type="button" class="btn btn-primary mastintake-da-cta" data-mastintake-action="da-connect">Reconnect</button> ' + disconnectBtn;
      return;
    }
    if (state === STATE.ERROR) {
      wrap.setAttribute('data-state', 'error');
      daSetBadge(wrap, 'error', 'Error');
      daSetStatus(wrap, s.lastError ? ('Connection error: ' + s.lastError) : 'There was a problem with this connection. Try reconnecting.', 'error');
      if (actionsEl) actionsEl.innerHTML =
        '<button type="button" class="btn btn-primary mastintake-da-cta" data-mastintake-action="da-connect">Reconnect</button> ' + disconnectBtn;
      return;
    }
    if (state === STATE.PENDING) {
      wrap.setAttribute('data-state', 'pending');
      daSetBadge(wrap, 'pending', 'Pending');
      daSetStatus(wrap, s.detail || 'Approve the connection in the tab that opened, then click Refresh status.', '');
      if (actionsEl) actionsEl.innerHTML = '<button type="button" class="btn btn-secondary mastintake-da-refresh" data-mastintake-action="da-refresh">Refresh status</button>';
      return;
    }
    // not-collected — the connect CTA + a skippable nudge (never a cold wall).
    wrap.setAttribute('data-state', 'ready');
    daSetBadge(wrap, 'idle', 'Not connected');
    daSetStatus(wrap, (def.copy && def.copy.connectPrompt) || 'Connect to sync automatically. You can skip this and add it later.', '');
    if (actionsEl) actionsEl.innerHTML =
      '<button type="button" class="btn btn-primary mastintake-da-cta" data-mastintake-action="da-connect">' + esc(connectLabel) + '</button>';
  }

  function delegatedRefresh(wrap, def) {
    return status(def.id).then(function (s) { applyDelegatedState(wrap, def, s); return s; });
  }

  function handleDelegatedConnect(wrap) {
    var def = getDef(wrap.getAttribute('data-provider'));
    if (!def || def.available === false) return;
    if (!canMutate(def)) { toast('You don’t have permission to change this.', true); return; }
    if (!def.adapter || typeof def.adapter.connect !== 'function') { toast('Connecting isn’t available for this provider yet.', true); return; }
    var btn = wrap.querySelector('.mastintake-da-cta') || wrap.querySelector('.mastintake-da-reconnect');
    if (btn) btn.disabled = true;
    setFeedback(wrap, '', '');
    Promise.resolve(def.adapter.connect({})).then(function (r) {
      if (btn) btn.disabled = false;
      if (r && r.ok === false) {
        setFeedback(wrap, r.error || 'Could not start the connection.', 'error');
        return;
      }
      // The OAuth handshake completes in a NEW TAB; the maker returns and refreshes.
      // Render the pending-approval state directly (status is still not-collected
      // until they finish on the provider's page) so the click never looks like a no-op.
      applyDelegatedState(wrap, def, { state: STATE.PENDING, detail: (def.copy && def.copy.pendingDetail) || null });
    }).catch(function (err) {
      if (btn) btn.disabled = false;
      setFeedback(wrap, (err && err.message) || 'Could not start the connection.', 'error');
    });
  }

  function handleDelegatedDisconnect(wrap) {
    var def = getDef(wrap.getAttribute('data-provider'));
    if (!def || !def.adapter || typeof def.adapter.disconnect !== 'function') return;
    if (!canMutate(def)) { toast('You don’t have permission to change this.', true); return; }
    function doDisconnect() {
      Promise.resolve(def.adapter.disconnect({})).then(function () { return delegatedRefresh(wrap, def); })
        .catch(function (err) { setFeedback(wrap, (err && err.message) || 'Could not disconnect.', 'error'); });
    }
    var copy = (def.copy && def.copy.disconnectConfirm) || ('Disconnect ' + (def.label || 'this connection') + '? You can reconnect later.');
    var title = (def.copy && def.copy.disconnectTitle) || ('Disconnect ' + (def.label || ''));
    if (typeof window.mastConfirm === 'function') {
      window.mastConfirm(copy, { title: title, danger: true }).then(function (ok) { if (ok) doDisconnect(); });
    } else { doDisconnect(); }
  }

  function handleDelegatedRefresh(wrap) {
    var def = getDef(wrap.getAttribute('data-provider'));
    if (def) delegatedRefresh(wrap, def);
  }

  // Single delegated listener set — paste/input feedback + Save/Revoke clicks.
  function bindDelegation() {
    if (_delegationBound || typeof document === 'undefined') return;
    _delegationBound = true;

    function wrapOf(node) {
      return node && node.closest ? node.closest('.' + FIELD_CLASS) : null;
    }
    // Validate-on-paste / on-input (inline, recoverable). Secret fields only —
    // domain-control has no secret-paste validation here (it validates on add).
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
      else if (action === 'id-save') { e.preventDefault(); handleIdentitySave(wrap); }
      else if (action === 'id-migrate') { e.preventDefault(); handleIdentityMigrate(wrap); }
      else if (action === 'id-reveal') { e.preventDefault(); handleIdentityReveal(wrap); }
      else if (action === 'id-clear') { e.preventDefault(); handleIdentityClear(wrap); }
      else if (action === 'domain-add') { e.preventDefault(); handleDomainAdd(wrap); }
      else if (action === 'domain-verify') { e.preventDefault(); handleDomainVerify(wrap); }
      else if (action === 'domain-remove') { e.preventDefault(); handleDomainRemove(wrap); }
      else if (action === 'domain-copy') { e.preventDefault(); handleDomainCopy(btn); }
      else if (action === 'da-connect') { e.preventDefault(); handleDelegatedConnect(wrap); }
      else if (action === 'da-disconnect') { e.preventDefault(); handleDelegatedDisconnect(wrap); }
      else if (action === 'da-refresh') { e.preventDefault(); handleDelegatedRefresh(wrap); }
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
      // domain-control reads status via the adapter (no vault probe).
      if (def.family === 'domain-control') {
        status(providerId).then(function (s) { applyDomainState(wrap, def, { available: true, status: s }); });
        return;
      }
      // identity-data status is per-RECORD (ref-keyed), read from the wrapper's
      // instance — NOT the provider-keyed probe cache (one provider can host many
      // records, each with its own ref).
      if (def.family === 'identity-data') {
        identityRefresh(wrap, def);
        return;
      }
      // delegated-auth reads connection status via the adapter / ChannelConnection
      // (no vault probe — the secret never reaches the client).
      if (def.family === 'delegated-auth') {
        delegatedRefresh(wrap, def);
        return;
      }
      probe(providerId).then(function (result) { applyState(wrap, def, result); });
    });
  }

  // Force a re-probe and re-apply (after save/revoke/add/verify/remove).
  function refresh(providerId, wrap) {
    var def = getDef(providerId);
    // identity-data re-reads its per-record status (ref from the wrapper instance).
    if (def && def.family === 'identity-data') {
      if (wrap) return identityRefresh(wrap, def);
      var inodes = document.querySelectorAll('.' + FIELD_CLASS + '[data-provider="' + providerId + '"]');
      var ips = [];
      Array.prototype.forEach.call(inodes, function (w) { ips.push(identityRefresh(w, def)); });
      return Promise.all(ips);
    }
    // domain-control re-reads status via the adapter (no vault probe to bust).
    if (def && def.family === 'domain-control') {
      return status(providerId).then(function (s) {
        var result = { available: true, status: s };
        if (wrap) { applyDomainState(wrap, def, result); return result; }
        var dnodes = document.querySelectorAll('.' + FIELD_CLASS + '[data-provider="' + providerId + '"]');
        Array.prototype.forEach.call(dnodes, function (w) { applyDomainState(w, def, result); });
        return result;
      });
    }
    // delegated-auth re-reads connection status via the adapter (no vault probe).
    if (def && def.family === 'delegated-auth') {
      return status(providerId).then(function (s) {
        if (wrap) { applyDelegatedState(wrap, def, s); return s; }
        var anodes = document.querySelectorAll('.' + FIELD_CLASS + '[data-provider="' + providerId + '"]');
        Array.prototype.forEach.call(anodes, function (w) { applyDelegatedState(w, def, s); });
        return s;
      });
    }
    invalidateProbe(providerId);
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
    // delegated-auth: "collect" = launch the provider's own consent flow (the OAuth
    // dance opens in a new tab). There is no modal paste to host — the adapter owns
    // the launch. Resolves best-effort to pending; the inline card re-reads status.
    if (def.family === 'delegated-auth') {
      if (def.available === false) { toast('One-click ' + (def.label || '') + ' connect is coming soon.'); return Promise.resolve({ ok: false, status: STATE.PENDING, provider: providerId, error: 'not-available-yet' }); }
      if (!def.adapter || typeof def.adapter.connect !== 'function') { return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'connect-unavailable' }); }
      return Promise.resolve(def.adapter.connect(ctx)).then(function (r) {
        return { ok: !(r && r.ok === false), status: STATE.PENDING, provider: providerId };
      }).catch(function (err) {
        return { ok: false, status: STATE.ERROR, error: (err && err.message) || 'connect-failed', provider: providerId };
      });
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
        var DONE_STATES = def.family === 'domain-control'
          ? { connected: STATE.CONNECTED, pending: STATE.PENDING, error: STATE.NEEDS_REAUTH }
          : { collected: STATE.COLLECTED };
        root.addEventListener('click', function (e) {
          var btn = e.target && e.target.closest ? e.target.closest('[data-mastintake-action]') : null;
          if (!btn) return;
          var action = btn.getAttribute('data-mastintake-action');
          if (action !== 'save' && action !== 'domain-add') return;
          // The write is async (CF + status re-read); poll for the state flip.
          var tries = 0;
          (function poll() {
            var wrap = root.querySelector('.' + FIELD_CLASS);
            var ds = wrap && wrap.getAttribute('data-state');
            if (ds && DONE_STATES[ds]) { finish({ ok: true, status: DONE_STATES[ds], provider: providerId }); return; }
            if (++tries < 25) setTimeout(poll, 300);
          })();
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
    if (family === 'identity-data') {
      // Identity status is per-RECORD (ref-keyed), not provider-keyed — a provider-
      // level status() has no ref to read. The rendered field drives it via hydrate().
      return Promise.resolve({ id: providerId, family: family, category: def && def.category, state: STATE.NOT_COLLECTED, detail: 'identity status is per-field (use the rendered field / hydrate)' });
    }
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
    if (family === 'domain-control') {
      // No vault, no ChannelConnection — delegate to the def's adapter.healthCheck
      // (wraps the existing status doc/CF). Returns records[]+domain so the field
      // renders from one read. Fail-closed: a throw maps to ERROR (status-only,
      // never an add box over a possibly-existing domain), NOT not-collected.
      if (!def || !def.adapter || typeof def.adapter.healthCheck !== 'function') {
        return Promise.resolve({ id: providerId, family: family, state: STATE.NOT_COLLECTED });
      }
      return Promise.resolve(def.adapter.healthCheck()).then(function (d) {
        d = d || {};
        return {
          id: providerId, family: 'domain-control', category: def.category,
          state: d.state || STATE.NOT_COLLECTED, records: d.records || [],
          domain: d.domain || null, detail: d.detail || '', connectedAt: d.connectedAt || null
        };
      }).catch(function (err) {
        return { id: providerId, family: 'domain-control', state: STATE.ERROR, records: [], lastError: (err && err.message) || 'status-failed' };
      });
    }
    // delegated-auth (channels-OAuth) branch: prefer the def's adapter.healthCheck —
    // it returns the RICH record (store name, detail, connectedAt, lastError) the
    // connect card shows ("✓ Connected to <store>"), sourced from the live channel
    // record. Fall back to the coarse ChannelConnection token-status vocab map.
    if (family === 'delegated-auth') {
      if (def.adapter && typeof def.adapter.healthCheck === 'function') {
        return Promise.resolve(def.adapter.healthCheck()).then(function (d) {
          d = d || {};
          return {
            id: providerId, family: family, category: def.category,
            state: d.state || STATE.NOT_COLLECTED, detail: d.detail || '',
            store: d.store || null, connectedAt: d.connectedAt || null, lastError: d.lastError || null
          };
        }).catch(function (err) {
          // A read failure surfaces as ERROR (a reconnectable problem), not a silent
          // not-collected — but never blocks (delegated-auth has no plaintext to guard).
          return { id: providerId, family: family, state: STATE.ERROR, lastError: (err && err.message) || 'status-failed' };
        });
      }
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
    // Unknown family — fail-closed to not-collected.
    return Promise.resolve({ id: providerId, family: family, state: STATE.NOT_COLLECTED });
  }

  // ── revoke() — destroy + wipe + audit (server CF). Idempotent. ──────────────
  function revoke(providerId, ctx) {
    var def = getDef(providerId);
    var family = def && def.family;
    if (family === 'identity-data') {
      // Identity delete is per-RECORD (needs the ref) — the field's Clear action
      // drives it (handleIdentityClear → CF_ID_DELETE). A provider-level revoke has
      // no ref, so it is intentionally not wired here.
      return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'identity delete is per-field (use the field’s Clear action)' });
    }
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
    if (family === 'domain-control') {
      // Domain "revoke" = remove the domain via the adapter (idempotent).
      if (!def.adapter || typeof def.adapter.remove !== 'function') {
        return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'remove not wired' });
      }
      return Promise.resolve(def.adapter.remove(ctx)).then(function (r) {
        r = r || {};
        return { ok: r.ok !== false, status: r.status || STATE.NOT_COLLECTED };
      }).catch(function (err) {
        return { ok: false, status: STATE.ERROR, error: (err && err.message) || 'Could not remove.' };
      });
    }
    // delegated-auth revoke → the def's adapter.disconnect (revokes the upstream
    // token + clears the channel record server-side). Idempotent.
    if (family === 'delegated-auth') {
      if (!def.adapter || typeof def.adapter.disconnect !== 'function') {
        return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'disconnect-unavailable' });
      }
      return Promise.resolve(def.adapter.disconnect(ctx)).then(function (r) {
        r = r || {};
        return { ok: r.ok !== false, status: r.status || STATE.NOT_COLLECTED };
      }).catch(function (err) {
        return { ok: false, status: STATE.ERROR, error: (err && err.message) || 'Could not disconnect.' };
      });
    }
    return Promise.resolve({ ok: false, status: STATE.ERROR, error: 'revoke not wired for this family' });
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
