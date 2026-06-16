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
 * SCOPE OF THIS SLICE — exactly ONE provider: `github` (the GitHub personal
 * access token, today the worst-exposed secret in the template — written to
 * Firestore admin/githubToken in plaintext). It is the proven Step-0 vault
 * provider (mast-architecture/functions/mast-intake-vault.js allowlist). The
 * other held-secret sites (Stripe, Shippo, Maps, Anthropic, SendGrid, …) are
 * deferred to later sessions and are NOT registered here.
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

  // Register with the engine (primary), and publish a plain-global catalog as a
  // load-order fallback the engine can read if it hydrates before register runs.
  window.ConnectionsProviders = window.ConnectionsProviders || {};
  window.ConnectionsProviders.github = github;
  if (window.MastIntake && typeof window.MastIntake.register === 'function') {
    window.MastIntake.register(github);
  }

  // Catalog module: no routes (not a routable view) and no MastDB writes.
  if (window.MastAdmin && typeof window.MastAdmin.registerModule === 'function') {
    window.MastAdmin.registerModule('connections-providers', { routes: [] });
  }
})();
