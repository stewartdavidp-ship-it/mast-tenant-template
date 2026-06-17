/**
 * connections-providers.js — the MastIntake provider catalog (vendor knowledge).
 *
 * Design: docs/ux-audit/mastintake-api-contract.md §3 (ProviderDefinition) +
 *   secure-intake-framework-design.md §9. Companion to the engine
 *   shared/mast-intake.js (which is provider-AGNOSTIC).
 *
 * WHAT THIS IS — the SINGLE home of provider-specific knowledge. One
 * ProviderDefinition per provider: the fields to collect, the guided steps, the
 * format hints, the family/archetype that drives the engine's derived trust
 * copy + fail-closed handling. The engine knows nothing about any provider; it
 * looks these up. New providers register a definition here — they never edit the
 * engine.
 *
 * This is a SCANNED module (under the lint ratchets), unlike the engine in
 * shared/ — so the call-site/vendor logic stays governed. It performs NO direct
 * persistence: a ProviderDefinition cannot name its own write target. Held
 * secrets persist ONLY through the engine's vetted server-vault path (design
 * §6.2), which is why there is no MastDB write anywhere in this file.
 *
 * REGISTERED PROVIDERS — held-secret: `github` (the GitHub personal access
 * token, the first proven vault provider), `sendgrid` (the email-sender API
 * key; server consumer sendTenantEmail reads it vault-first via getTenantHeldSecret
 * with a legacy {prefix}-sendgrid-api-key fallback), `shippo` (the carrier API
 * token; server consumer shipping-abstraction.js reads it vault-first with a legacy
 * {prefix}-shippo-api-token fallback), and `stripe` (the payment-processor SECRET
 * key; server consumer payment-abstraction.js reads it vault-first with a legacy
 * {prefix}-stripe-secret-key fallback — only the sk_ secret key is vaulted, the
 * pk_ publishable key stays a client-side plain field). domain-control:
 * `email-domain` + `custom-domain` (DNS proofs, no secret). All field keys here
 * MUST match the mast-architecture/functions/mast-intake-vault.js allowlist. The
 * remaining held-secret sites (Maps, Anthropic, …) are deferred to later sessions
 * and are NOT registered here.
 */
(function () {
  'use strict';

  // ── GitHub personal access token — family: held-secret, archetype C (paste) ──
  //
  // The maker creates a token on GitHub, copies it, and pastes it here; the
  // engine sends it over an encrypted channel to the server vault (GCP Secret
  // Manager) and never stores it in the browser. credentialOwner: 'customer' —
  // it is the maker's own GitHub token, not a Mast-owned OAuth app.
  var github = {
    id: 'github',
    label: 'GitHub',
    icon: '⎇',
    family: 'held-secret',
    category: 'devops',
    authType: 'C',                 // guided key-paste
    credentialOwner: 'customer',
    gate: 'skippable',             // image storage works without it (Firebase Storage default)
    conciergeEligible: false,      // engine FORCES false for non-(delegated-auth, A) anyway;
                                   // a human must never receive a raw held secret (design §6.5)

    guide: {
      deepLink: 'https://github.com/settings/tokens',
      // Text-first steps; the legacy copy notes the token needs `repo` scope so
      // gallery uploads can write to the repo.
      steps: [
        'Open GitHub → Settings → Developer settings → Personal access tokens.',
        'Generate a new token and grant it the “repo” scope.',
        'Copy the token (GitHub shows it only once) and paste it here.'
      ],
      estSeconds: 90
    },

    fields: [
      {
        key: 'token',                       // MUST match the vault allowlist field key
        label: 'Personal access token',
        mask: true,
        // Permissive shape check (recoverable hint only — the server vault is
        // authoritative): classic ghp_/gho_/ghs_/ghu_/ghr_, fine-grained
        // github_pat_, or a legacy 40-char hex token.
        validate: /^(gh[opsur]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{22,}|[a-f0-9]{40})$/,
        example: 'ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        minLen: 20                          // matches the server vault minLen
      }
    ],

    // Held-secret persistence is gated by the engine's RUNTIME vault-CF probe,
    // NOT by anything declared here. `kind` is descriptive metadata only.
    vault: { kind: 'api-key' },

    adapter: {
      // For a held secret there is no bespoke OAuth dance — "connecting" github
      // is simply the guided secure paste → server-vault Put, which the engine
      // owns. This entrypoint opens that guided flow.
      connect: function (ctx) {
        if (window.MastIntake && typeof window.MastIntake.collect === 'function') {
          return window.MastIntake.collect('github', ctx || {});
        }
        return Promise.resolve({ ok: false, error: 'secure-intake-unavailable' });
      }
    }
  };

  // ── SendGrid API key — family: held-secret, archetype C (paste) ──
  //
  // The maker creates an API key in SendGrid, copies it, and pastes it here; the
  // engine sends it over an encrypted channel to the server vault (GCP Secret
  // Manager) and never stores it in the browser. credentialOwner: 'customer' — it
  // is the maker's own SendGrid key, used by the server email sender (sendTenantEmail
  // reads it vault-first via getTenantHeldSecret, falling back to the legacy
  // {prefix}-sendgrid-api-key for tenants who haven't re-entered it).
  var sendgrid = {
    id: 'sendgrid',
    label: 'SendGrid',
    icon: '✉',
    family: 'held-secret',
    category: 'email',
    authType: 'C',                 // guided key-paste
    credentialOwner: 'customer',
    gate: 'skippable',             // Mast-managed mail works without it
    conciergeEligible: false,      // a human must never receive a raw held secret (design §6.5)

    guide: {
      deepLink: 'https://app.sendgrid.com/settings/api_keys',
      steps: [
        'Open SendGrid → Settings → API Keys.',
        'Create an API key with Mail Send permission.',
        'Copy the key (SendGrid shows it only once) and paste it here.'
      ],
      estSeconds: 90
    },

    fields: [
      {
        key: 'apiKey',                      // MUST match the vault allowlist field key
        label: 'API key',
        mask: true,
        // Permissive shape check (recoverable hint only — the server vault is
        // authoritative): SendGrid keys are `SG.` + two base64url segments.
        validate: /^SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/,
        example: 'SG.xxxxxxxxxxxxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyyy',
        minLen: 16                          // matches the server vault minLen
      }
    ],

    // Held-secret persistence is gated by the engine's RUNTIME vault-CF probe,
    // NOT by anything declared here. `kind` is descriptive metadata only.
    vault: { kind: 'api-key' },

    adapter: {
      connect: function (ctx) {
        if (window.MastIntake && typeof window.MastIntake.collect === 'function') {
          return window.MastIntake.collect('sendgrid', ctx || {});
        }
        return Promise.resolve({ ok: false, error: 'secure-intake-unavailable' });
      }
    }
  };

  // ── Shippo carrier API token — family: held-secret, archetype C (paste) ──
  //
  // The maker creates an API token in Shippo, copies it, and pastes it here; the
  // engine sends it over an encrypted channel to the server vault (GCP Secret
  // Manager) and never stores it in the browser. credentialOwner: 'customer' — it
  // is the maker's own Shippo token, used by the server shipping layer
  // (shipping-abstraction.js reads it vault-first via getTenantHeldSecret, falling
  // back to the legacy {prefix}-shippo-api-token for tenants who haven't re-entered it).
  var shippo = {
    id: 'shippo',
    label: 'Shippo',
    icon: '📦',
    family: 'held-secret',
    category: 'shipping',
    authType: 'C',                 // guided key-paste
    credentialOwner: 'customer',
    gate: 'skippable',             // manual label entry (Pirate Ship / CSV) works without it
    conciergeEligible: false,      // a human must never receive a raw held secret (design §6.5)

    guide: {
      deepLink: 'https://apps.goshippo.com/settings/api',
      steps: [
        'Open Shippo → Settings → API.',
        'Generate a live token (shippo_live_…) — or a test token (shippo_test_…) to trial it.',
        'Copy the token and paste it here.'
      ],
      estSeconds: 90
    },

    fields: [
      {
        key: 'apiToken',                    // MUST match the vault allowlist field key
        label: 'API token',
        mask: true,
        // Permissive shape check (recoverable hint only — the server vault is
        // authoritative): Shippo tokens are shippo_live_/shippo_test_ + a token body.
        validate: /^shippo_(live|test)_[A-Za-z0-9]{16,}$/,
        example: 'shippo_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
        minLen: 16                          // matches the server vault minLen
      }
    ],

    // Held-secret persistence is gated by the engine's RUNTIME vault-CF probe,
    // NOT by anything declared here. `kind` is descriptive metadata only.
    vault: { kind: 'api-key' },

    adapter: {
      connect: function (ctx) {
        if (window.MastIntake && typeof window.MastIntake.collect === 'function') {
          return window.MastIntake.collect('shippo', ctx || {});
        }
        return Promise.resolve({ ok: false, error: 'secure-intake-unavailable' });
      }
    }
  };

  // ── Stripe SECRET key — family: held-secret, archetype C (paste) ──
  //
  // The maker creates a restricted/secret key in the Stripe dashboard, copies it,
  // and pastes it here; the engine sends it over an encrypted channel to the server
  // vault (GCP Secret Manager) and never stores it in the browser. credentialOwner:
  // 'customer' — it is the maker's own Stripe key, used by the server payment layer
  // (payment-abstraction.js reads it vault-first via getTenantHeldSecret, falling
  // back to the legacy {prefix}-stripe-secret-key for tenants who haven't re-entered
  // it). SCOPE: only the SECRET key (sk_live_/sk_test_) is a held secret. The
  // PUBLISHABLE key (pk_…) is client-side (Stripe.js) and is NOT vaulted — it stays
  // a plain admin field.
  var stripe = {
    id: 'stripe',
    label: 'Stripe',
    icon: '💳',
    family: 'held-secret',
    category: 'payments',
    authType: 'C',                 // guided key-paste
    credentialOwner: 'customer',
    gate: 'skippable',             // Square is an alternative processor
    conciergeEligible: false,      // a human must never receive a raw held secret (design §6.5)

    guide: {
      deepLink: 'https://dashboard.stripe.com/apikeys',
      steps: [
        'Open Stripe → Developers → API keys.',
        'Reveal your secret key (sk_live_… for production, sk_test_… to trial).',
        'Copy the secret key and paste it here.'
      ],
      estSeconds: 90
    },

    fields: [
      {
        key: 'secretKey',                   // MUST match the vault allowlist field key
        label: 'Secret key',
        mask: true,
        // Permissive shape check (recoverable hint only — the server vault is
        // authoritative): Stripe secret keys are sk_live_/sk_test_ + a token body.
        validate: /^sk_(live|test)_[A-Za-z0-9]{16,}$/,
        example: 'sk_live_… (or sk_test_…)',
        minLen: 16                          // matches the server vault minLen
      }
    ],

    // Held-secret persistence is gated by the engine's RUNTIME vault-CF probe,
    // NOT by anything declared here. `kind` is descriptive metadata only.
    vault: { kind: 'api-key' },

    adapter: {
      connect: function (ctx) {
        if (window.MastIntake && typeof window.MastIntake.collect === 'function') {
          return window.MastIntake.collect('stripe', ctx || {});
        }
        return Promise.resolve({ ok: false, error: 'secure-intake-unavailable' });
      }
    }
  };

  // ── Email sending domain — family: domain-control, archetype D (DNS verify) ──
  //
  // Proof-of-ownership via DNS — collects NO secret, so there is NO vault path.
  // "Persistence" is the server-written status doc config/email/domain that the
  // existing Resend CFs maintain; the adapter wraps those CFs + the doc read, so
  // the engine never learns Resend. This is the framework's 2nd-family proof
  // (Step 3): the engine reuses its guided grammar (records table, Verify, status
  // badge, trust copy, delegated listeners) with zero secret handling.
  //
  // The adapter owns the RBAC gate + audit (keeping the engine provider-agnostic):
  // the live email-domain flow gated every mutation on can('settings','edit') and
  // emitted writeAudit rows — preserved here for parity.
  var emailDomain = {
    id: 'email-domain',
    label: 'Email sending domain',
    icon: '✉',
    family: 'domain-control',
    category: 'messaging',
    authType: 'D',                 // DNS / domain-ownership proof
    credentialOwner: 'customer',   // the maker's own domain
    gate: 'skippable',             // Mast-managed mail.mastplatform.com works without it
    conciergeEligible: false,      // engine forces false anyway (not delegated-auth A)
    rbac: { route: 'settings', axis: 'edit' },  // engine pre-checks; adapter re-gates
    copy: {
      addPrompt: 'No sending domain set up yet. Add the domain you send email from.',
      removeConfirm: 'Remove this sending domain from Mast? Cleanup in your email provider is handled separately.',
      removeTitle: 'Remove sending domain'
    },

    guide: {
      // No single deepLink — registrar links differ per record; the DNS table the
      // engine renders is where the user copies each value.
      steps: [
        'Pick the domain you send email from (e.g. mail.yourshop.com).',
        'Add the DNS records shown below at your registrar (SPF, DKIM, DMARC).',
        'Click Verify — DNS can take up to 48 hours to propagate.'
      ],
      estSeconds: 600
    },

    fields: [
      {
        key: 'domain',
        label: 'Sending domain',
        mask: false,
        // Hostname shape — same regex the custom-domain sibling uses.
        validate: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
        example: 'mail.yourshop.com'
      }
    ],

    // NO `vault` block — domain-control collects no secret.

    adapter: {
      // setup → existing setupBYOResendDomain CF. The DNS records are written
      // server-side to config/email/domain; we read them back via healthCheck
      // (NOT from this return, which only carries path + status).
      setup: function (ctx) {
        if (typeof can === 'function' && !can('settings', 'edit')) {
          return Promise.resolve({ ok: false, error: 'You do not have permission to update settings.' });
        }
        var fn = window.firebase.functions().httpsCallable('setupBYOResendDomain');
        return fn({ domain: ctx.domain }).then(function (res) {
          var d = (res && res.data) || {};
          if (typeof writeAudit === 'function') writeAudit('create', 'settings', 'emailDomain', { domain: ctx.domain });
          var verified = d.path === 'A' && d.status === 'verified';
          return { ok: true, state: verified ? 'connected' : 'pending', path: d.path || null, status: d.status || 'pending' };
        });
      },
      // verify → existing checkEmailDomainStatus CF (EMPTY payload — the CF
      // resolves the tenant's domain server-side). Returns a coarse status string.
      verify: function () {
        var fn = window.firebase.functions().httpsCallable('checkEmailDomainStatus');
        return fn({}).then(function (res) {
          var s = ((res && res.data) || {}).status;
          var map = { verified: 'connected', failed: 'needs-reauth' };
          return { ok: true, state: map[s] || 'pending' };
        });
      },
      // healthCheck → read the persisted doc config/email/domain (the status
      // source of truth; the live loadEmailDomainSection read). NO catch — a read
      // failure propagates so the engine maps it to ERROR (fail-closed status-only),
      // distinct from a genuinely-absent doc (not-collected → the add box).
      healthCheck: function () {
        return window.MastDB.get('config/email/domain').then(function (dom) {
          if (!dom || !dom.resendDomainId) return { state: 'not-collected' };
          var map = { verified: 'connected', failed: 'needs-reauth' };
          return { state: map[dom.status] || 'pending', domain: dom.domain || null, records: dom.dnsRecords || [] };
        });
      },
      // remove → local-only config clear. There is NO Resend delete CF (the live
      // gotcha); provider-side cleanup is handled out-of-band. Idempotent.
      remove: function () {
        if (typeof can === 'function' && !can('settings', 'edit')) {
          return Promise.resolve({ ok: false, error: 'You do not have permission to update settings.' });
        }
        return window.MastDB.get('config/email/domain').then(function (dom) {
          if (!dom) return { ok: true, status: 'not-collected' };
          return window.MastDB.remove('config/email/domain').then(function () {
            if (typeof writeAudit === 'function') writeAudit('delete', 'settings', 'emailDomain');
            return { ok: true, status: 'not-collected' };
          });
        });
      }
    }
  };

  // ── Storefront custom domain — family: domain-control, archetype D (DNS + SSL) ─
  //
  // The maker points a domain they own (e.g. mycoolshop.com) at the Mast storefront.
  // Collects NO secret — DNS-ownership proof via the manageDomain CF. UNLIKE
  // email-domain: the CF is a RAW HTTP endpoint (Bearer idToken + X-Tenant-ID,
  // verb-dispatched), the DNS records come from the add/verify RESPONSE (not a
  // status doc), and the ladder has 3 rungs (SSL Active > DNS Verified > Pending).
  // The adapter maps all of that to the engine's connected/pending state + a
  // `detail`/`instructions`, so the engine stays provider-agnostic.
  //
  // SCOPE: a single custom storefront domain (the common case). The primary
  // .runmast.com subdomain + Firebase default are auto-managed and are NOT intakes.
  // Multi-custom-domain (rare) is a follow-up (an engine domain-list mode).
  function _manageDomain(action, domain) {
    return window.firebase.auth().currentUser.getIdToken().then(function (token) {
      var tid = window.MastDB.tenantId();
      var body = { action: action, tenantId: tid };
      if (domain) body.domain = domain;
      return fetch(window.CLOUD_FUNCTIONS_BASE + '/manageDomain', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token, 'X-Tenant-ID': tid },
        body: JSON.stringify(body)
      }).then(function (resp) {
        return resp.json().then(function (data) {
          if (!resp.ok) throw new Error((data && data.error) || (action + ' failed'));
          return data || {};
        });
      });
    });
  }

  var customDomain = {
    id: 'custom-domain',
    label: 'Custom storefront domain',
    icon: '🌐',
    family: 'domain-control',
    category: 'hosting',
    authType: 'D',
    credentialOwner: 'customer',
    gate: 'skippable',
    conciergeEligible: false,
    rbac: { route: 'settings', axis: 'edit' },  // engine gates add/verify/remove; CF re-checks
    copy: {
      addPrompt: 'No custom domain connected yet. Add a domain you own to point it at your storefront.',
      removeConfirm: 'Remove “{domain}”? This disconnects it from your storefront.',
      removeTitle: 'Remove domain'
    },
    guide: {
      steps: [
        'Enter a domain you own (e.g. mycoolshop.com).',
        'Add the DNS records shown below at your registrar (use the quick-links).',
        'Click Verify — DNS + SSL can take from a few minutes up to 48 hours.'
      ],
      estSeconds: 600
    },
    fields: [
      { key: 'domain', label: 'Custom domain', mask: false,
        validate: /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/,
        example: 'mycoolshop.com' }
    ],
    // NO `vault` block — domain-control collects no secret.
    adapter: {
      // add → manageDomain 'add'. DNS records come back in dnsInstructions and are
      // rendered directly by the engine (they are NOT in the list/status read).
      setup: function (ctx) {
        return _manageDomain('add', ctx.domain).then(function (data) {
          if (typeof writeAudit === 'function') writeAudit('create', 'settings', 'customDomain', { domain: ctx.domain });
          return { ok: true, state: 'pending', domain: ctx.domain,
            instructions: data.dnsInstructions || null,
            detail: 'Domain registered — add the DNS records below, then click Verify.' };
        });
      },
      // verify → manageDomain 'verify'. 3-rung ladder → engine state + detail.
      verify: function (ctx) {
        return _manageDomain('verify', ctx && ctx.domain).then(function (data) {
          if (data.sslActive) {
            return { ok: true, state: 'connected', detail: '✓ SSL active — your storefront is live on this domain.' };
          }
          if (data.dnsVerified) {
            // DNS done, SSL still provisioning — no records to re-show.
            return { ok: true, state: 'pending', detail: 'DNS verified — SSL is being provisioned. Check back in a few minutes.' };
          }
          return { ok: true, state: 'pending', instructions: data.dnsInstructions || null,
            detail: 'DNS not yet propagated — this can take up to 48 hours. Verify again later.' };
        });
      },
      // healthCheck → manageDomain 'list'; find the tenant's custom domain (common
      // case: one). The list carries NO records, so a pending domain shows a "click
      // Verify" hint and the records reappear from the verify response.
      healthCheck: function () {
        return _manageDomain('list').then(function (data) {
          var domains = (data && data.domains) || [];
          var custom = null;
          for (var i = 0; i < domains.length; i++) { if (domains[i].type === 'custom') { custom = domains[i]; break; } }
          if (!custom) return { state: 'not-collected' };
          if (custom.hostingStatus === 'CONNECTED') {
            return { state: 'connected', domain: custom.domain, detail: '✓ SSL active — your storefront is live on this domain.' };
          }
          if (custom.dnsVerified) {
            return { state: 'pending', domain: custom.domain, detail: 'DNS verified — SSL is being provisioned. Check back shortly, or click Verify.' };
          }
          return { state: 'pending', domain: custom.domain, detail: 'Pending DNS — click Verify to see the records to add and re-check.' };
        });
      },
      // remove → manageDomain 'remove' (disconnects from the storefront).
      remove: function (ctx) {
        return _manageDomain('remove', ctx && ctx.domain).then(function () {
          if (typeof writeAudit === 'function') writeAudit('delete', 'settings', 'customDomain', { domain: (ctx && ctx.domain) || '' });
          return { ok: true, status: 'not-collected' };
        });
      }
    }
  };

  // ── Compliance identity-data fields — family: identity-data, archetype C (PII) ──
  //
  // The three sensitive compliance IDs that round-trip as PLAINTEXT today behind a
  // cosmetic type=password input in Settings → Compliance: the license number, the
  // insurance policy number, and the tax-jurisdiction registration ID. These are
  // structured PII, so they are ENVELOPE-ENCRYPTED at rest by the field-encryption
  // CF (mast-architecture/functions/mast-intake-identity.js) — never stored in the
  // browser, never returned except as a masked last-4 (plus a gated admin-only
  // reveal for editing). credentialOwner: 'customer' (the maker's own IDs).
  //
  // FAIL-CLOSED: persistence is gated by the engine's RUNTIME field-encryption CF
  // probe — NOT by anything declared here. This file names NO write target and does
  // NO MastDB write; the ref pointer that replaces the plaintext is persisted by the
  // call-site (Settings → Compliance). `field.kind` MUST match the CF's fail-closed
  // allowlist (IDENTITY_KINDS): license-number / insurance-policy / tax-registration-id.
  function _identityDef(id, label, kind, example, minLen) {
    return {
      id: id,
      label: label,
      icon: '🔐',
      family: 'identity-data',
      category: 'compliance',
      authType: 'C',                 // structured PII the maker enters (encrypted server-side)
      credentialOwner: 'customer',
      gate: 'skippable',             // compliance records work without the secured number
      conciergeEligible: false,      // engine FORCES false anyway (not delegated-auth A);
                                     // a human must never receive raw PII (design §6.5)
      // identity-data persistence is gated by the engine's RUNTIME field-encryption
      // CF probe, NOT by anything declared here. `kind` is descriptive metadata that
      // MUST equal the CF allowlist key.
      vault: { kind: kind },
      fields: [
        { key: id, kind: kind, label: label, mask: true, example: example, minLen: minLen }
      ]
    };
  }

  var licenseNumber = _identityDef('license-number', 'License number', 'license-number', '•••• 1234', 3);
  var insurancePolicy = _identityDef('insurance-policy', 'Insurance policy number', 'insurance-policy', '•••• 1234', 3);
  var taxRegistrationId = _identityDef('tax-registration-id', 'Tax registration ID', 'tax-registration-id', '•••• 1234', 4);

  // Register with the engine (primary), and publish a plain-global catalog as a
  // load-order fallback the engine can read if it hydrates before register runs.
  window.ConnectionsProviders = window.ConnectionsProviders || {};
  window.ConnectionsProviders.github = github;
  window.ConnectionsProviders.sendgrid = sendgrid;
  window.ConnectionsProviders.shippo = shippo;
  window.ConnectionsProviders.stripe = stripe;
  window.ConnectionsProviders['email-domain'] = emailDomain;
  window.ConnectionsProviders['custom-domain'] = customDomain;
  window.ConnectionsProviders['license-number'] = licenseNumber;
  window.ConnectionsProviders['insurance-policy'] = insurancePolicy;
  window.ConnectionsProviders['tax-registration-id'] = taxRegistrationId;
  if (window.MastIntake && typeof window.MastIntake.register === 'function') {
    window.MastIntake.register(github);
    window.MastIntake.register(sendgrid);
    window.MastIntake.register(shippo);
    window.MastIntake.register(stripe);
    window.MastIntake.register(emailDomain);
    window.MastIntake.register(customDomain);
    window.MastIntake.register(licenseNumber);
    window.MastIntake.register(insurancePolicy);
    window.MastIntake.register(taxRegistrationId);
  }

  // Catalog module: no routes (not a routable view) and no MastDB writes.
  if (window.MastAdmin && typeof window.MastAdmin.registerModule === 'function') {
    window.MastAdmin.registerModule('connections-providers', { routes: [] });
  }
})();
