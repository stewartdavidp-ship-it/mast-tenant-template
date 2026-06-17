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
 * pk_ publishable key stays a client-side plain field), and the CHANNEL
 * held-secrets — `square-sandbox-access-token`, `square-production-access-token`,
 * `etsy-api-key`, `etsy-shared-secret`, `shopify-admin-token`,
 * `shopify-webhook-secret`, `shopify-client-secret` (each a single secret the
 * server consumer reads vault-first via getTenantHeldSecret with a legacy
 * `{prefix}-<base>` fallback, mast-architecture PR 297). ONE PROVIDER PER SECRET:
 * the engine is single-secret-per-provider, so a channel that holds several
 * secrets (Square sandbox+prod tokens; Etsy keystring+shared-secret; Shopify
 * admin-token+webhook-secret+client-secret) registers one provider per secret —
 * mirroring the identity-data fields. domain-control: `email-domain` +
 * `custom-domain` (DNS proofs, no secret). All provider ids + field keys here
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

  // ── Channel held-secrets — family: held-secret, archetype C (paste) ──
  //
  // The custom-app secrets / access tokens / webhook secrets a maker pastes for
  // their Square / Etsy / Shopify connection. DISTINCT from the OAuth channel
  // tokens (those flow through the connect-channel OAuth dance, not the vault) —
  // only the manually-supplied held secrets register here. ONE PROVIDER PER
  // SECRET (the engine renders/PUTs exactly def.fields[0]); the provider id +
  // field key MUST match mast-architecture/functions/mast-intake-vault.js. Each
  // server consumer reads it vault-first via getTenantHeldSecret with a legacy
  // {prefix}-<base> fallback (mast-architecture PR 297). credentialOwner:'customer'.
  function _channelHeldSecret(spec) {
    return {
      id: spec.id,
      label: spec.label,
      icon: spec.icon || '🔌',
      family: 'held-secret',
      category: 'channel',
      authType: 'C',                 // guided key-paste
      credentialOwner: 'customer',
      gate: 'skippable',             // the channel works via OAuth / manual entry without it
      conciergeEligible: false,      // a human must never receive a raw held secret (design §6.5)
      guide: spec.guide,
      fields: [
        {
          key: spec.fieldKey,        // MUST match the vault allowlist field key
          label: spec.fieldLabel || spec.label,
          mask: true,
          // Permissive shape check (recoverable hint only — the server vault is
          // authoritative).
          validate: spec.validate,
          example: spec.example,
          minLen: spec.minLen        // matches the server vault minLen
        }
      ],
      // Held-secret persistence is gated by the engine's RUNTIME vault-CF probe,
      // NOT by anything declared here. `kind` is descriptive metadata only.
      vault: { kind: 'api-key' },
      adapter: {
        connect: function (ctx) {
          if (window.MastIntake && typeof window.MastIntake.collect === 'function') {
            return window.MastIntake.collect(spec.id, ctx || {});
          }
          return Promise.resolve({ ok: false, error: 'secure-intake-unavailable' });
        }
      }
    };
  }

  // Square — per-env access tokens (the sandbox + production OAuth/manual access
  // tokens the storefront uses to call Square). Location IDs are non-secret config
  // and stay plain; the webhook signature key is server-auto-provisioned, not pasted.
  var squareGuide = {
    deepLink: 'https://developer.squareup.com/apps',
    steps: [
      'Open Square → Developer Dashboard → your application.',
      'Copy the access token for the environment you’re configuring (Sandbox or Production).',
      'Paste it here.'
    ],
    estSeconds: 90
  };
  var squareSandboxToken = _channelHeldSecret({
    id: 'square-sandbox-access-token', label: 'Square sandbox access token', icon: '◻',
    fieldKey: 'accessToken', fieldLabel: 'Sandbox access token',
    validate: /^[A-Za-z0-9_-]{16,}$/, example: 'EAAAl…', minLen: 16, guide: squareGuide
  });
  var squareProductionToken = _channelHeldSecret({
    id: 'square-production-access-token', label: 'Square production access token', icon: '◼',
    fieldKey: 'accessToken', fieldLabel: 'Production access token',
    validate: /^[A-Za-z0-9_-]{16,}$/, example: 'EAAAl…', minLen: 16, guide: squareGuide
  });

  // Etsy — developer-app keystring (api key) + shared secret. Both are required
  // in the v3 x-api-key header (keystring:sharedSecret) before the OAuth handshake.
  var etsyGuide = {
    deepLink: 'https://www.etsy.com/developers/your-apps',
    steps: [
      'Open Etsy → Developers → your app.',
      'Copy the Keystring (API key) and the Shared Secret.',
      'Paste each here, then connect your shop.'
    ],
    estSeconds: 120
  };
  var etsyApiKey = _channelHeldSecret({
    id: 'etsy-api-key', label: 'Etsy API keystring', icon: '🌿',
    fieldKey: 'apiKey', fieldLabel: 'API keystring',
    validate: /^[A-Za-z0-9]{16,}$/, example: 'abc123def456…', minLen: 16, guide: etsyGuide
  });
  var etsySharedSecret = _channelHeldSecret({
    id: 'etsy-shared-secret', label: 'Etsy shared secret', icon: '🌿',
    fieldKey: 'sharedSecret', fieldLabel: 'Shared secret',
    // Etsy shared secrets are short — minLen 8 (matches the vault).
    validate: /^[A-Za-z0-9]{8,}$/, example: '••••••••••', minLen: 8, guide: etsyGuide
  });

  // Shopify — Admin API access token (shpat_…), the webhook secret used for HMAC
  // verification, and the client_credentials app client secret. The client_id is
  // the app's public identifier (not a held secret) and stays a plain field.
  var shopifyGuide = {
    deepLink: 'https://www.shopify.com/admin/settings/apps',
    steps: [
      'Open Shopify admin → Settings → Apps and sales channels → Develop apps.',
      'Open your custom app → API credentials.',
      'Copy the Admin API access token (and, for HMAC, the API secret key).'
    ],
    estSeconds: 120
  };
  var shopifyAdminToken = _channelHeldSecret({
    id: 'shopify-admin-token', label: 'Shopify Admin API access token', icon: '🛍',
    fieldKey: 'accessToken', fieldLabel: 'Admin API access token',
    validate: /^shpat_[A-Za-z0-9]{16,}$/, example: 'shpat_…', minLen: 16, guide: shopifyGuide
  });
  var shopifyWebhookSecret = _channelHeldSecret({
    id: 'shopify-webhook-secret', label: 'Shopify webhook secret', icon: '🛍',
    fieldKey: 'webhookSecret', fieldLabel: 'Webhook secret (API secret key)',
    validate: /^[A-Za-z0-9_]{16,}$/, example: 'Shopify API secret key…', minLen: 16, guide: shopifyGuide
  });
  var shopifyClientSecret = _channelHeldSecret({
    id: 'shopify-client-secret', label: 'Shopify client secret', icon: '🛍',
    fieldKey: 'clientSecret', fieldLabel: 'Client secret',
    validate: /^[A-Za-z0-9_]{16,}$/, example: 'Shopify app client secret…', minLen: 16, guide: shopifyGuide
  });

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

  // Vendor/contractor identity-data fields (2nd identity-data surface, breadth
  // follow-up to the compliance IDs). The vendor record (admin/vendors/{id}) carries
  // a payee Tax ID (EIN/SSN) and a bank account number that round-trip as PLAINTEXT
  // today behind plain text inputs across three vendor editors (finance AP modal,
  // procurement vendor editor, vendors-v2). Both are structured PII → envelope-
  // encrypted at rest by the same field-encryption CF. `kind` MUST match the CF
  // fail-closed allowlist (IDENTITY_KINDS): ein-ssn / bank-account. (routing-number
  // is in the CF allowlist too, but the vendor data model has no routing field yet.)
  var einSsn = _identityDef('ein-ssn', 'Tax ID (EIN/SSN)', 'ein-ssn', '•••• 6789', 9);
  var bankAccount = _identityDef('bank-account', 'Bank account number', 'bank-account', '•••• 6789', 4);

  // ── Sales-channel OAuth — family: delegated-auth (archetype A / C→A hybrid) ──
  //
  // The one-click "Connect with X" delegated-auth flow — the maker authorizes on the
  // PROVIDER's own page so they never paste a key. These three FOLD the already-live
  // channel-connect plumbing (window.connectChannel / disconnectChannel + the live
  // *OAuthStart / disconnectChannelCallable CFs + MastDB.businessEntity.channels.list)
  // into the MastIntake grammar — REUSE, not rebuild. No cross-repo CF work: the
  // OAuth dance and any credential pre-leg (the C→A hybrids Etsy/Square paste their
  // developer-app keys first) stay in the live flow; MastIntake supplies the connect
  // CARD, derived trust copy, status vocabulary, positive confirmation, and skippable
  // re-entry. Token refresh is a SERVER concern (the sync engine + Squarespace refresh
  // cron); `refreshable`/`tokenLifetime` here drive status copy only. credentialOwner:
  // 'customer'. NO `vault` block — the secret is minted server-side, never client-held.
  function _channelHealthCheck(platform) {
    return function () {
      if (!window.MastDB || !window.MastDB.businessEntity || !window.MastDB.businessEntity.channels ||
          typeof window.MastDB.businessEntity.channels.list !== 'function') {
        return Promise.resolve({ state: 'not-collected' });
      }
      return window.MastDB.businessEntity.channels.list().then(function (list) {
        var rec = null;
        (list || []).forEach(function (r) { if (r && r.channelId === platform) rec = r; });
        if (!rec) return { state: 'not-collected' };
        // Channel-record status → IntakeStatus enum (the engine's connect-card vocab).
        var map = { connected: 'connected', expired: 'needs-reauth', revoked: 'needs-reauth', error: 'error', pending: 'pending' };
        var bits = [];
        if (rec.env) bits.push(rec.env);
        if (rec.connectedAt) bits.push('connected ' + new Date(rec.connectedAt).toLocaleDateString());
        if (rec.lastSyncAt) bits.push('last sync ' + new Date(rec.lastSyncAt).toLocaleDateString());
        else if (rec.status === 'connected') bits.push('no manual sync yet');
        return {
          state: map[rec.status] || 'not-collected',
          detail: bits.join(' • '),
          store: rec.shopDomain || null,
          connectedAt: rec.connectedAt || null,
          lastError: rec.lastErrorMessage || null
        };
      }).catch(function () { return { state: 'not-collected' }; });
    };
  }
  // connect → delegate to the LIVE global connectChannel(platform) (the existing
  // OAuth-start flow, incl. its credential pre-leg for the C→A hybrids). The engine
  // shows the pending-approval state after launch; the maker returns + refreshes.
  function _channelConnect(platform) {
    return function () {
      if (typeof window.connectChannel === 'function') {
        return Promise.resolve(window.connectChannel(platform)).then(function () { return { ok: true }; });
      }
      return Promise.resolve({ ok: false, error: 'channel-connect-unavailable' });
    };
  }
  // disconnect → the disconnectChannelCallable CF DIRECTLY (not the live
  // disconnectChannel global, which shows its own confirm + reloads the legacy
  // board — the engine already owns the confirm and the refresh). Idempotent.
  function _channelDisconnect(platform) {
    return function () {
      if (typeof window.firebase === 'undefined' || !window.firebase.functions) {
        return Promise.resolve({ ok: false, error: 'functions-unavailable' });
      }
      var fn = window.firebase.functions().httpsCallable('disconnectChannelCallable');
      return fn({ tenantId: window.MastDB.tenantId(), platform: platform }).then(function () {
        return { ok: true, status: 'not-collected' };
      });
    };
  }
  function _channelDef(spec) {
    return {
      id: spec.id, label: spec.label, icon: spec.icon,
      family: 'delegated-auth', category: 'channel',
      authType: spec.authType,                 // 'A' = pure OAuth; non-'A' = C→A hybrid (paste app creds, then OAuth)
      credentialOwner: 'customer',
      gate: 'skippable',                        // the storefront works without any channel connected
      conciergeEligible: false,                 // engine forces false for non-(A) anyway; left off until a concierge desk is staffed
      available: true,
      refreshable: !!spec.refreshable,
      tokenLifetime: spec.tokenLifetime || null,
      rbac: { route: 'channels', axis: 'edit' },  // engine pre-checks; the live CFs re-gate server-side
      guide: spec.guide || null,
      copy: spec.copy,
      adapter: {
        connect: _channelConnect(spec.id),
        healthCheck: _channelHealthCheck(spec.id),
        disconnect: _channelDisconnect(spec.id)
      }
    };
  }

  var shopifyChannel = _channelDef({
    id: 'shopify', label: 'Shopify', icon: '🛒', authType: 'A',
    refreshable: false, tokenLifetime: 'long-lived',
    guide: {
      steps: [
        'Click Connect and enter your Shopify store sub-domain.',
        'Approve the install on Shopify’s own page (opens in a new tab).',
        'Return here and click Refresh status.'
      ],
      estSeconds: 120
    },
    copy: {
      connectLabel: 'Connect Shopify',
      connectPrompt: 'Connect your Shopify store to sync products and inventory. You can skip this and add it later.',
      pendingDetail: 'Approve the install in the Shopify tab that just opened, then click Refresh status.',
      disconnectConfirm: 'Disconnect Shopify? Tokens are revoked, stored credentials deleted, and webhook subscriptions removed. You can reconnect later.',
      disconnectTitle: 'Disconnect Shopify'
    }
  });
  var etsyChannel = _channelDef({
    id: 'etsy', label: 'Etsy', icon: '🌿', authType: 'C',  // C→A hybrid: paste the developer-app keystring + shared secret, then OAuth
    refreshable: true, tokenLifetime: 'short-refreshable',
    guide: {
      steps: [
        'Enter your Etsy developer-app keystring + shared secret (the held-secret fields above), then click Connect.',
        'Approve the connection on Etsy’s own page (opens in a new tab).',
        'Return here and click Refresh status.'
      ],
      estSeconds: 180
    },
    copy: {
      connectLabel: 'Connect Etsy',
      connectPrompt: 'Connect your Etsy shop to sync listings and orders. You can skip this and add it later.',
      pendingDetail: 'Approve the connection in the Etsy tab that just opened, then click Refresh status.',
      disconnectConfirm: 'Disconnect Etsy? Tokens are revoked and stored credentials deleted. You can reconnect later.',
      disconnectTitle: 'Disconnect Etsy'
    }
  });
  // Square — pure-A (the "Wix method"): ONE platform-wide Mast Square OAuth app, so
  // the maker pastes NO developer keys — they just approve on Square's own consent
  // page. The live squareOAuthStart / squareOAuthCallback CFs + the refreshSquareTokens
  // cron (mast-architecture) read the platform-wide mast-square-app-id/-secret pod
  // secrets, not per-tenant creds. authType 'A' — converged from the original C→A
  // hybrid (mast-architecture PR 317), mirroring Wix. Existing tenants connected under
  // the old per-tenant app keep working (dual-path refresh) and converge to pure-A on
  // their next reconnect; see the PR for the migration detail.
  var squareChannel = _channelDef({
    id: 'square', label: 'Square', icon: '◻', authType: 'A',
    refreshable: true, tokenLifetime: 'short-refreshable',
    guide: {
      steps: [
        'Click Connect — Square opens in a new tab.',
        'Approve the Mast app on Square’s own consent page.',
        'Return here and click Refresh status.'
      ],
      estSeconds: 120
    },
    copy: {
      connectLabel: 'Connect Square',
      connectPrompt: 'Connect your Square account to sync sales and inventory. You authorize once on Square — Mast never asks you to copy a key. You can skip this and add it later.',
      pendingDetail: 'Approve the Mast app in the Square tab that just opened, then click Refresh status.',
      disconnectConfirm: 'Disconnect Square? Mast’s stored access is revoked and deleted. The Mast app may still appear in your Square account until you remove it there. You can reconnect later.',
      disconnectTitle: 'Disconnect Square'
    }
  });
  // WooCommerce — archetype B (one-click authorize). UNLIKE the C→A hybrids
  // (Etsy/Square) there is NO held-secret pre-leg: the maker enters their store
  // URL, approves on their own store, and WooCommerce mints + POSTs the REST API
  // key straight to Mast's woocommerceAuthCallback CF (the maker never pastes a
  // key). The key is permanent (no refresh). connect → window.connectChannel
  // ('woocommerce') → _connectWooCommerceFlow → woocommerceAuthStart; disconnect →
  // disconnectChannelCallable (deletes the vaulted key, best-effort — WooCommerce
  // has no remote key-revoke API, so the maker removes it in wp-admin).
  var wooChannel = _channelDef({
    id: 'woocommerce', label: 'WooCommerce', icon: '🪵', authType: 'B',
    refreshable: false, tokenLifetime: 'permanent',
    guide: {
      steps: [
        'Click Connect and enter your WooCommerce store URL (e.g. https://yourstore.com).',
        'Approve access on your store’s own page (opens in a new tab) — WooCommerce sends the API key straight to Mast.',
        'Return here and click Refresh status.'
      ],
      estSeconds: 120
    },
    copy: {
      connectLabel: 'Connect WooCommerce',
      connectPrompt: 'Connect your WooCommerce store to sync products and inventory. You authorize once on your own store — Mast never asks you to copy a key. You can skip this and add it later.',
      pendingDetail: 'Approve access in the WooCommerce tab that just opened, then click Refresh status.',
      disconnectConfirm: 'Disconnect WooCommerce? Mast deletes its stored copy of the API key. To fully revoke it, also remove the key in your WooCommerce admin (Settings → Advanced → REST API). You can reconnect later.',
      disconnectTitle: 'Disconnect WooCommerce'
    }
  });
  // Squarespace — pure-A (the "Wix method"): ONE platform-wide Mast Squarespace
  // OAuth app, so the maker pastes NO developer keys — they just approve on
  // Squarespace’s own consent page. The live squarespaceOAuthStart /
  // squarespaceOAuthCallback CFs + the squarespaceTokenRefresh cron
  // (mast-architecture) read the platform-wide mast-squarespace-app-id/-secret pod
  // secrets, not per-tenant creds. authType 'A' — converged from the original C→A
  // hybrid (mast-architecture PR 307 then PR 314), mirroring Wix.
  var squarespaceChannel = _channelDef({
    id: 'squarespace', label: 'Squarespace', icon: '⬛', authType: 'A',
    refreshable: true, tokenLifetime: 'short-refreshable',   // Squarespace: 30-min access / 7-day refresh (squarespaceTokenRefresh cron)
    guide: {
      steps: [
        'Click Connect — Squarespace opens in a new tab.',
        'Approve the Mast app on Squarespace’s own consent page.',
        'Return here and click Refresh status.'
      ],
      estSeconds: 120
    },
    copy: {
      connectLabel: 'Connect Squarespace',
      connectPrompt: 'Connect your Squarespace store to sync products and inventory. You authorize once on Squarespace — Mast never asks you to copy a key. You can skip this and add it later.',
      pendingDetail: 'Approve the Mast app in the Squarespace tab that just opened, then click Refresh status.',
      disconnectConfirm: 'Disconnect Squarespace? Mast’s stored access is deleted and webhook subscriptions removed. The Mast app may still appear in your Squarespace account until you remove it there. You can reconnect later.',
      disconnectTitle: 'Disconnect Squarespace'
    }
  });

  // ── New OAuth providers — family: delegated-auth, COMING SOON (available:false) ──
  //
  // Each needs a per-provider OAuth-start + callback Cloud Function in
  // mast-architecture (carved out to its own session). Until that ships, the def
  // declares `available:false` so the engine renders an honest "coming soon" card
  // (a disabled CTA, never a Connect button that 404s) — the framework's "don't make
  // connect a cold wall" rule. When a provider's CF lands, flip `available` to true
  // and wire its adapter.{connect,healthCheck,disconnect} (mirroring the live channels
  // above). `tokenLifetime`/`refreshable` capture the per-provider refresh reality the
  // server-side cron must honor (research: Wix ~5-min access, Squarespace 30-min/7-day,
  // Plaid permanent access token, Stripe-Connect no refresh).
  function _comingSoonDef(spec) {
    return {
      id: spec.id, label: spec.label, icon: spec.icon,
      family: 'delegated-auth', category: spec.category || 'channel',
      authType: spec.authType || 'A',
      credentialOwner: 'customer',
      gate: 'skippable',
      conciergeEligible: false,
      available: false,                         // OAuth-start CF not shipped yet
      refreshable: !!spec.refreshable,
      tokenLifetime: spec.tokenLifetime || null,
      deferred: !!spec.deferred,                // research-deferred (Stripe Connect) vs merely pending a CF
      guide: spec.guide || null,
      copy: {
        connectLabel: 'Connect ' + spec.label,
        comingSoon: spec.comingSoon || ('One-click ' + spec.label + ' connect is coming soon.')
      },
      // No working adapter — the engine renders coming-soon and never calls connect.
      adapter: {
        connect: function () { return Promise.resolve({ ok: false, error: 'not-available-yet' }); },
        healthCheck: function () { return Promise.resolve({ state: 'not-collected' }); },
        disconnect: function () { return Promise.resolve({ ok: false }); }
      }
    };
  }
  // Wix is LIVE — the wixOAuthStart/wixOAuthCallback + wixTokenRefresh CFs
  // shipped in mast-architecture. authType 'A' (pure OAuth, like Shopify's
  // custom distribution): ONE platform-wide Mast Wix app, so the maker pastes
  // no developer keys — they just approve on Wix's consent page. _channelDef
  // wires adapter.{connect,healthCheck,disconnect} to the live channel plumbing.
  var wixChannel = _channelDef({
    id: 'wix', label: 'Wix', icon: '◆', authType: 'A',
    refreshable: true, tokenLifetime: 'short-refreshable',   // Wix access tokens ~5 min; server refreshes on demand
    guide: {
      steps: [
        'Click Connect — your Wix site opens in a new tab.',
        'Approve the Mast app on Wix’s own consent page.',
        'Return here and click Refresh status.'
      ],
      estSeconds: 120
    },
    copy: {
      connectLabel: 'Connect Wix',
      connectPrompt: 'Connect your Wix site to sync products and inventory. You can skip this and add it later.',
      pendingDetail: 'Approve the Mast app in the Wix tab that just opened, then click Refresh status.',
      disconnectConfirm: 'Disconnect Wix? Mast’s stored access is deleted. The Mast app may still appear in your Wix dashboard until you remove it there. You can reconnect later.',
      disconnectTitle: 'Disconnect Wix'
    }
  });
  // ── Plaid (bank link) — family: delegated-auth, archetype A (hosted Link) ──
  //
  // LIVE. Unlike the redirect-OAuth channels above, Plaid is a CLIENT-SDK flow:
  // the maker authenticates with their bank INSIDE Plaid's hosted Link widget (an
  // in-page overlay — they never paste a key), and Link hands back a short-lived
  // public_token in onSuccess. We REUSE the already-live reconciliation CFs the
  // Finance module uses — createPlaidLinkToken (mint a link_token) +
  // exchangePlaidToken (swap public_token for a PERMANENT access_token, vaulted
  // server-side). exchangePlaidToken also projects status onto
  // admin/businessEntity/channels/plaid, which this card reads. Multi-bank
  // management stays in Finance; the card shows one honest "is a bank linked?".
  var PLAID_LINK_SDK = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';
  function _loadPlaidLink() {
    if (window.Plaid && typeof window.Plaid.create === 'function') return Promise.resolve();
    return new Promise(function (resolve, reject) {
      var existing = document.querySelector('script[data-plaid-link]');
      if (existing) {
        existing.addEventListener('load', function () { resolve(); });
        existing.addEventListener('error', function () { reject(new Error('plaid-sdk-load-failed')); });
        if (window.Plaid && typeof window.Plaid.create === 'function') resolve();
        return;
      }
      var s = document.createElement('script');
      s.src = PLAID_LINK_SDK; s.async = true; s.setAttribute('data-plaid-link', '1');
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('plaid-sdk-load-failed')); };
      document.head.appendChild(s);
    });
  }
  function _plaidCallable(name) {
    if (typeof window.firebase === 'undefined' || !window.firebase.functions) return null;
    return window.firebase.functions().httpsCallable(name);
  }
  function _plaidTenantId() {
    return (window.MastDB && typeof window.MastDB.tenantId === 'function') ? window.MastDB.tenantId() : null;
  }
  // connect → mint a link_token, open hosted Link, and on the maker's success
  // exchange the public_token (server vaults the permanent access_token + projects
  // the channel record). Resolves {ok:true} after a successful exchange; {ok:false}
  // on cancel/error. The engine then shows pending until the maker clicks Refresh.
  function _plaidConnect() {
    return function () {
      var createLink = _plaidCallable('createPlaidLinkToken');
      var exchange = _plaidCallable('exchangePlaidToken');
      if (!createLink || !exchange) return Promise.resolve({ ok: false, error: 'functions-unavailable' });
      var tenantId = _plaidTenantId();
      return _loadPlaidLink()
        .then(function () { return createLink({ tenantId: tenantId }); })
        .then(function (res) {
          var linkToken = res && res.data && res.data.link_token;
          if (!linkToken) throw new Error('no-link-token');
          return new Promise(function (resolve) {
            var handler = window.Plaid.create({
              token: linkToken,
              onSuccess: function (publicToken) {
                exchange({ tenantId: tenantId, public_token: publicToken })
                  .then(function (xr) {
                    var d = (xr && xr.data) || {};
                    resolve({ ok: true, status: 'connected', detail: d.institutionName || null });
                  })
                  .catch(function (e) { resolve({ ok: false, error: (e && e.message) || 'exchange-failed' }); });
              },
              onExit: function (err) {
                // Maker closed Link without finishing (or Link errored). Not a card
                // failure — just no connection made this time. Surface a friendly,
                // human message (Plaid provides error_message/display_message).
                if (!err) { resolve({ ok: false, error: 'Bank linking was cancelled — no changes made.' }); return; }
                resolve({ ok: false, error: err.display_message || err.error_message || 'Bank linking didn’t complete. You can try again.' });
              }
            });
            handler.open();
          });
        })
        .catch(function (e) { return { ok: false, error: (e && e.message) || 'plaid-connect-failed' }; });
    };
  }
  // healthCheck → read the projected channel record (channelId === 'plaid').
  function _plaidHealthCheck() {
    return function () {
      if (!window.MastDB || !window.MastDB.businessEntity || !window.MastDB.businessEntity.channels ||
          typeof window.MastDB.businessEntity.channels.list !== 'function') {
        return Promise.resolve({ state: 'not-collected' });
      }
      return window.MastDB.businessEntity.channels.list().then(function (list) {
        var rec = null;
        (list || []).forEach(function (r) { if (r && r.channelId === 'plaid') rec = r; });
        if (!rec) return { state: 'not-collected' };
        var map = { connected: 'connected', expired: 'needs-reauth', revoked: 'needs-reauth', error: 'error', pending: 'pending' };
        var bits = [];
        if (rec.institutionName) bits.push(rec.institutionName);
        if (rec.itemCount && rec.itemCount > 1) bits.push('+' + (rec.itemCount - 1) + ' more');
        if (rec.connectedAt) bits.push('connected ' + new Date(rec.connectedAt).toLocaleDateString());
        return {
          state: map[rec.status] || 'not-collected',
          detail: bits.join(' • '),
          store: rec.institutionName || null,
          connectedAt: rec.connectedAt || null,
          lastError: rec.lastErrorMessage || null
        };
      }).catch(function () { return { state: 'not-collected' }; });
    };
  }
  // disconnect → remove EVERY linked bank (card-level disconnect = full
  // disconnect; per-bank management lives in Finance). Reuses the live
  // disconnectPlaidItem CF per item (Plaid item/remove + secret delete + channel
  // re-projection). disconnectChannelCallable is NOT usable here — its server
  // allowlist rejects 'plaid' and it wouldn't call Plaid item/remove.
  function _plaidDisconnect() {
    return function () {
      var disconnectItem = _plaidCallable('disconnectPlaidItem');
      if (!disconnectItem) return Promise.resolve({ ok: false, error: 'functions-unavailable' });
      if (!window.MastDB || !window.MastDB.plaidItems || typeof window.MastDB.plaidItems.list !== 'function') {
        return Promise.resolve({ ok: false, error: 'Open the Finance module to manage bank connections.' });
      }
      var tenantId = _plaidTenantId();
      return Promise.resolve(window.MastDB.plaidItems.list()).then(function (items) {
        var ids = Object.keys(items || {}).filter(function (id) {
          return items[id] && items[id].status === 'active';
        });
        if (!ids.length) return { ok: true, status: 'not-collected' };
        return ids.reduce(function (p, id) {
          return p.then(function () { return disconnectItem({ tenantId: tenantId, itemId: id }); });
        }, Promise.resolve()).then(function () { return { ok: true, status: 'not-collected' }; });
      }).catch(function (e) { return { ok: false, error: (e && e.message) || 'disconnect-failed' }; });
    };
  }
  var plaidConnection = {
    id: 'plaid', label: 'Plaid (bank link)', icon: '🏦',
    family: 'delegated-auth', category: 'banking',
    authType: 'A',
    credentialOwner: 'customer',
    gate: 'skippable',
    conciergeEligible: false,                 // no concierge desk staffed for bank-linking yet
    available: true,
    refreshable: false, tokenLifetime: 'permanent',   // Plaid access token is permanent (no refresh)
    rbac: { route: 'channels', axis: 'edit' },         // engine pre-checks; the live CFs re-gate server-side (verifyTenantAdmin)
    guide: {
      steps: [
        'Click Connect, then pick your bank in the Plaid window.',
        'Sign in to your bank inside Plaid’s secure window — Mast never sees your bank password.',
        'Choose the account(s) to link, then click Refresh status.'
      ],
      estSeconds: 120
    },
    copy: {
      connectLabel: 'Connect bank (Plaid)',
      connectPrompt: 'Link your bank via Plaid to auto-import transactions for reconciliation. You can skip this and add it later.',
      pendingDetail: 'Finish linking in the Plaid window, then click Refresh status.',
      disconnectConfirm: 'Disconnect all linked banks? Stored access is revoked and removed. Imported transactions stay; you can reconnect later.',
      disconnectTitle: 'Disconnect Plaid'
    },
    adapter: {
      connect: _plaidConnect(),
      healthCheck: _plaidHealthCheck(),
      disconnect: _plaidDisconnect()
    }
  };
  var stripeConnect = _comingSoonDef({
    id: 'stripe-connect', label: 'Stripe Connect', icon: '💳', authType: 'A', category: 'payments',
    refreshable: false, tokenLifetime: 'no-refresh', deferred: true,  // DEFERRED per research (read_only scope); catalog stub captures the design
    comingSoon: 'Read-only Stripe Connect (payouts & balance) is planned for a later phase.'
  });

  // ── QuickBooks Online — family: delegated-auth, archetype A (Intuit OAuth) ──
  //
  // LIVE. The accounting (QBO-1) module already owns the full connect/disconnect
  // dance + the deep sync/mapping UI (COA Map / Sync Log / Conflicts / Backfill).
  // This def FOLDS that live plumbing into the MastIntake grammar so QBO sits on
  // the Connections board alongside Shopify/Etsy/Square/Plaid — REUSE, not rebuild.
  //
  // UNLIKE the channel OAuth providers above, QBO is NOT a channels record: its
  // connection lives in the BESPOKE doc admin/integrations/qbo (realmId, status,
  // env, connectedAt, lastUsedAt, disconnectedAt), NOT channels/{id}. So this def
  // is EXCLUDED from CHANNEL_PLATFORMS and from the board's channel health-summary
  // aggregate, and its healthCheck reads that doc directly — never channels.list.
  // The engine's delegated-auth path is adapter-driven (it prefers def.adapter.
  // healthCheck and only consumes the returned IntakeStatus object), so it carries
  // this non-channel status doc with zero board surgery.
  //
  // credentialOwner:'customer' — the maker's own QuickBooks company (realm). NO
  // `vault` block: the OAuth token is minted + refreshed SERVER-side by the Intuit
  // callback CF, never client-held. tokenLifetime 'short-refreshable' drives the
  // ~100-day idle-reconnect copy (QBO refresh-on-use rotates the token on every
  // sync; it only force-expires after ~100 days of zero use — C-ACC-1, Intuit
  // Nov-2025 policy). refreshAheadDays 30 / criticalDays 7 mirror the accounting-v2
  // countdown chip tiers.
  var QBO_IDLE_DAYS = 100;          // QBO refresh token force-expires after ~100 idle days (C-ACC-1)
  // healthCheck → read admin/integrations/qbo and map to the IntakeStatus enum.
  // "Connected" = realmId && !disconnectedAt && status!=='disconnected' (QBO-1's
  // canonical predicate). If the connection is past its idle window (no sync in
  // ~100 days), surface needs-reauth so the card prompts a reconnect (the token is
  // force-expired server-side). NO catch — a read failure propagates so the engine
  // maps it to ERROR (a reconnectable problem), never a silent not-collected.
  function _qboHealthCheck() {
    if (!window.MastDB || typeof window.MastDB.get !== 'function') {
      return Promise.resolve({ state: 'not-collected' });
    }
    return window.MastDB.get('admin/integrations/qbo').then(function (doc) {
      var connected = doc && doc.realmId && !doc.disconnectedAt && (doc.status !== 'disconnected');
      if (!connected) return { state: 'not-collected' };
      var env = doc.env || 'sandbox';
      var realmShort = String(doc.realmId).slice(0, 8) + '…';
      var bits = [env, 'realm ' + realmShort];
      if (doc.connectedAt) bits.push('since ' + new Date(doc.connectedAt).toLocaleDateString());
      // Idle-expiry: lastUsedAt/refreshedAt drives the ~100-day force-expiry clock.
      var lastUsedAt = doc.lastUsedAt || doc.refreshedAt || doc.connectedAt;
      var lastMs = (typeof lastUsedAt === 'number') ? lastUsedAt : Date.parse(lastUsedAt);
      if (isFinite(lastMs)) {
        var idleDays = (Date.now() - lastMs) / 86400000;
        if (idleDays >= QBO_IDLE_DAYS) {
          return {
            state: 'needs-reauth',
            detail: bits.join(' • '),
            store: 'QuickBooks (' + env + ')',
            connectedAt: doc.connectedAt || null,
            lastError: 'The QuickBooks connection has been idle ~100 days — reconnect to refresh access.'
          };
        }
      }
      return {
        state: 'connected',
        detail: bits.join(' • '),
        store: 'QuickBooks (' + env + ')',
        connectedAt: doc.connectedAt || null
      };
    });
  }
  // connect → the LIVE global connectQbo (mintQboAuthState → Intuit consent popup
  // → strict CF-origin postMessage auto-complete). The engine shows pending after
  // launch; the popup's own handler refreshes the accounting panel on success and
  // the board re-reads status on Refresh.
  function _qboConnect() {
    if (typeof window.connectQbo === 'function') {
      return Promise.resolve(window.connectQbo()).then(function () { return { ok: true }; });
    }
    return Promise.resolve({ ok: false, error: 'quickbooks-connect-unavailable' });
  }
  // disconnect → the disconnectQbo CF DIRECTLY (not the live disconnectQbo global,
  // which shows its OWN mastConfirm + re-renders the legacy accounting panel — the
  // engine already owns the confirm + the board refresh). Idempotent server-side.
  function _qboDisconnect() {
    if (typeof window.firebase === 'undefined' || !window.firebase.functions) {
      return Promise.resolve({ ok: false, error: 'functions-unavailable' });
    }
    var tid = (window.MastDB && typeof window.MastDB.tenantId === 'function') ? window.MastDB.tenantId() : null;
    var fn = window.firebase.functions().httpsCallable('disconnectQbo');
    return fn({ tenantId: tid }).then(function () {
      return { ok: true, status: 'not-collected' };
    });
  }
  var qboConnection = {
    id: 'qbo',
    label: 'QuickBooks Online',
    icon: '📒',
    family: 'delegated-auth',
    category: 'accounting',
    authType: 'A',                   // pure OAuth — the maker authorizes on Intuit's page
    credentialOwner: 'customer',
    gate: 'skippable',               // accounting works without a QBO sync
    conciergeEligible: false,        // no concierge desk staffed for accounting-sync yet
    available: true,
    refreshable: true,
    tokenLifetime: 'short-refreshable',   // QBO: refresh-on-use; force-expires after ~100 idle days
    rbac: { route: 'integrations', axis: 'edit' },  // engine pre-checks; the QBO CFs re-gate server-side
    guide: {
      steps: [
        'Click Connect — QuickBooks opens in a new window.',
        'Sign in and approve access to your QuickBooks company on Intuit’s own page.',
        'Return here and click Refresh status.'
      ],
      estSeconds: 120
    },
    copy: {
      connectLabel: 'Connect QuickBooks',
      connectPrompt: 'Connect QuickBooks Online to sync day closes, invoices, bills, and reviewed expenses to your books. You authorize once on Intuit — Mast never asks you to copy a key. You can skip this and add it later.',
      pendingDetail: 'Approve access in the QuickBooks window that just opened, then click Refresh status.',
      needsReauth: 'The QuickBooks connection has been idle ~100 days and the refresh token expired — reconnect to resume syncing.',
      disconnectConfirm: 'Disconnect QuickBooks? Syncing stops and Mast’s stored access is revoked. Entries already pushed to QuickBooks stay; you can reconnect anytime.',
      disconnectTitle: 'Disconnect QuickBooks'
    },
    // NO `vault` block — the OAuth token is minted + refreshed server-side.
    adapter: {
      connect: function () { return _qboConnect(); },
      healthCheck: function () { return _qboHealthCheck(); },
      disconnect: function () { return _qboDisconnect(); }
    }
  };

  // Register with the engine (primary), and publish a plain-global catalog as a
  // load-order fallback the engine can read if it hydrates before register runs.
  window.ConnectionsProviders = window.ConnectionsProviders || {};
  window.ConnectionsProviders.github = github;
  window.ConnectionsProviders.sendgrid = sendgrid;
  window.ConnectionsProviders.shippo = shippo;
  window.ConnectionsProviders.stripe = stripe;
  window.ConnectionsProviders['square-sandbox-access-token'] = squareSandboxToken;
  window.ConnectionsProviders['square-production-access-token'] = squareProductionToken;
  window.ConnectionsProviders['etsy-api-key'] = etsyApiKey;
  window.ConnectionsProviders['etsy-shared-secret'] = etsySharedSecret;
  window.ConnectionsProviders['shopify-admin-token'] = shopifyAdminToken;
  window.ConnectionsProviders['shopify-webhook-secret'] = shopifyWebhookSecret;
  window.ConnectionsProviders['shopify-client-secret'] = shopifyClientSecret;
  window.ConnectionsProviders['email-domain'] = emailDomain;
  window.ConnectionsProviders['custom-domain'] = customDomain;
  window.ConnectionsProviders['license-number'] = licenseNumber;
  window.ConnectionsProviders['insurance-policy'] = insurancePolicy;
  window.ConnectionsProviders['tax-registration-id'] = taxRegistrationId;
  window.ConnectionsProviders['ein-ssn'] = einSsn;
  window.ConnectionsProviders['bank-account'] = bankAccount;
  window.ConnectionsProviders.shopify = shopifyChannel;
  window.ConnectionsProviders.etsy = etsyChannel;
  window.ConnectionsProviders.square = squareChannel;
  window.ConnectionsProviders.wix = wixChannel;
  window.ConnectionsProviders.squarespace = squarespaceChannel;
  window.ConnectionsProviders.woocommerce = wooChannel;
  window.ConnectionsProviders.plaid = plaidConnection;
  window.ConnectionsProviders.qbo = qboConnection;
  window.ConnectionsProviders['stripe-connect'] = stripeConnect;
  if (window.MastIntake && typeof window.MastIntake.register === 'function') {
    window.MastIntake.register(github);
    window.MastIntake.register(sendgrid);
    window.MastIntake.register(shippo);
    window.MastIntake.register(stripe);
    window.MastIntake.register(squareSandboxToken);
    window.MastIntake.register(squareProductionToken);
    window.MastIntake.register(etsyApiKey);
    window.MastIntake.register(etsySharedSecret);
    window.MastIntake.register(shopifyAdminToken);
    window.MastIntake.register(shopifyWebhookSecret);
    window.MastIntake.register(shopifyClientSecret);
    window.MastIntake.register(emailDomain);
    window.MastIntake.register(customDomain);
    window.MastIntake.register(licenseNumber);
    window.MastIntake.register(insurancePolicy);
    window.MastIntake.register(taxRegistrationId);
    window.MastIntake.register(einSsn);
    window.MastIntake.register(bankAccount);
    window.MastIntake.register(shopifyChannel);
    window.MastIntake.register(etsyChannel);
    window.MastIntake.register(squareChannel);
    window.MastIntake.register(wixChannel);
    window.MastIntake.register(squarespaceChannel);
    window.MastIntake.register(wooChannel);
    window.MastIntake.register(plaidConnection);
    window.MastIntake.register(qboConnection);
    window.MastIntake.register(stripeConnect);
  }

  // Catalog module: no routes (not a routable view) and no MastDB writes.
  if (window.MastAdmin && typeof window.MastAdmin.registerModule === 'function') {
    window.MastAdmin.registerModule('connections-providers', { routes: [] });
  }
})();
