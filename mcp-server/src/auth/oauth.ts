/**
 * OAuth 2.1 router for MAST MCP Server.
 * Simplified from CC MCP — API key auth only (no Google Sign-In).
 * Claude.ai uses this flow to connect as an MCP integration.
 */

import { Router, Request, Response } from "express";
import crypto from "crypto";
import {
  registerClient,
  getClient,
  validateClientSecret,
  createAuthCode,
  consumeAuthCode,
  createAccessToken,
  revokeToken,
  hashToken,
} from "./store.js";
import { validateApiKey } from "../auth.js";

export function createOAuthRouter(baseUrl: string): Router {
  const router = Router();

  // OAuth Authorization Server Metadata (RFC 8414)
  router.get("/.well-known/oauth-authorization-server", (_req: Request, res: Response) => {
    res.json({
      issuer: baseUrl,
      authorization_endpoint: `${baseUrl}/authorize`,
      token_endpoint: `${baseUrl}/token`,
      registration_endpoint: `${baseUrl}/register`,
      revocation_endpoint: `${baseUrl}/revoke`,
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code"],
      code_challenge_methods_supported: ["S256", "plain"],
      token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic"],
    });
  });

  // Protected Resource Metadata (RFC 9728) — Claude.ai checks this first
  router.get("/.well-known/oauth-protected-resource", (_req: Request, res: Response) => {
    res.json({
      resource: baseUrl,
      authorization_servers: [baseUrl],
    });
  });

  // Dynamic Client Registration (RFC 7591)
  router.post("/register", async (req: Request, res: Response) => {
    try {
      const client = await registerClient(req.body);
      res.status(201).json({
        client_id: client.client_id,
        client_secret: client.client_secret,
        client_name: client.client_name,
        redirect_uris: client.redirect_uris,
        grant_types: client.grant_types,
        response_types: client.response_types,
        token_endpoint_auth_method: client.token_endpoint_auth_method,
      });
    } catch (err: any) {
      console.error("Client registration error:", err);
      res.status(500).json({ error: "server_error", error_description: "Registration failed" });
    }
  });

  // Authorization Endpoint — MAST API Key auth page
  router.get("/authorize", async (req: Request, res: Response) => {
    const {
      client_id,
      redirect_uri,
      response_type,
      state,
      code_challenge,
      code_challenge_method,
    } = req.query as Record<string, string>;

    if (response_type !== "code") {
      res.status(400).json({ error: "unsupported_response_type" });
      return;
    }

    const client = await getClient(client_id);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    // Render API key sign-in page
    res.type("html").send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Connect to MAST</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0f1117;
      color: #e0e0e0;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
    }
    .card {
      background: #1a1d27;
      border: 1px solid #2a2d37;
      border-radius: 12px;
      padding: 40px;
      max-width: 440px;
      width: 100%;
      text-align: center;
    }
    h1 { font-size: 20px; margin-bottom: 8px; color: #fff; }
    .subtitle { font-size: 14px; color: #888; margin-bottom: 32px; }
    .status { font-size: 13px; color: #888; margin-top: 16px; }
    .status.error { color: #ef4444; }
    .status.success { color: #22c55e; }
    .input-section { text-align: left; }
    .input-section label { display: block; font-size: 13px; color: #aaa; margin-bottom: 6px; }
    .input-section input {
      width: 100%;
      padding: 10px 14px;
      background: #0f1117;
      border: 1px solid #2a2d37;
      border-radius: 8px;
      color: #fff;
      font-size: 14px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      margin-bottom: 8px;
    }
    .input-section input:focus { outline: none; border-color: #5b6ef5; }
    .input-section .hint { font-size: 12px; color: #666; margin-bottom: 16px; }
    .input-section .hint code { background: #252830; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
    .submit-btn {
      width: 100%;
      padding: 12px;
      background: #5b6ef5;
      color: #fff;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    .submit-btn:hover { background: #4a5de0; }
    .submit-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Connect to MAST</h1>
    <p class="subtitle">Enter your MAST API key to connect Claude</p>

    <div class="input-section">
      <label>MAST API Key</label>
      <input type="password" id="apiKeyInput" placeholder="mast_xxxxxxxxxxxxxxxx" autofocus>
      <p class="hint">Format: <code>mast_</code> followed by the secret</p>
      <button class="submit-btn" id="submitBtn" onclick="submitApiKey()">Connect</button>
    </div>

    <p class="status" id="status"></p>
  </div>

  <script>
    const params = {
      client_id: "${client_id}",
      redirect_uri: "${redirect_uri}",
      state: "${state || ""}",
      code_challenge: "${code_challenge || ""}",
      code_challenge_method: "${code_challenge_method || ""}"
    };

    // Allow Enter key to submit
    document.getElementById('apiKeyInput').addEventListener('keydown', function(e) {
      if (e.key === 'Enter') submitApiKey();
    });

    async function submitApiKey() {
      const apiKey = document.getElementById('apiKeyInput').value.trim();
      const status = document.getElementById('status');
      const btn = document.getElementById('submitBtn');

      if (!apiKey) {
        status.className = 'status error';
        status.textContent = 'Please enter your MAST API key';
        return;
      }

      if (!apiKey.startsWith('mast_')) {
        status.className = 'status error';
        status.textContent = 'Invalid key format. Must start with mast_';
        return;
      }

      btn.disabled = true;
      status.className = 'status';
      status.textContent = 'Validating...';

      try {
        const res = await fetch('/authorize/api-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...params, api_key: apiKey })
        });

        if (res.ok) {
          const data = await res.json();
          status.className = 'status success';
          status.textContent = 'Connected! Redirecting...';
          window.location.href = data.redirect;
        } else {
          const err = await res.json();
          status.className = 'status error';
          status.textContent = err.error_description || 'Invalid API key';
          btn.disabled = false;
        }
      } catch (err) {
        status.className = 'status error';
        status.textContent = 'Connection failed: ' + err.message;
        btn.disabled = false;
      }
    }
  </script>
</body>
</html>`);
  });

  // API Key verification -> create auth code -> redirect
  router.post("/authorize/api-key", async (req: Request, res: Response) => {
    const { client_id, redirect_uri, state, code_challenge, code_challenge_method, api_key } = req.body;

    if (!api_key) {
      res.status(400).json({ error: "invalid_request", error_description: "API key required" });
      return;
    }

    const client = await getClient(client_id);
    if (!client) {
      res.status(400).json({ error: "invalid_client" });
      return;
    }

    try {
      const valid = await validateApiKey(api_key);
      if (!valid) {
        res.status(401).json({
          error: "invalid_token",
          error_description: "Invalid MAST API key",
        });
        return;
      }

      const code = createAuthCode(
        client_id,
        redirect_uri,
        code_challenge || undefined,
        code_challenge_method || undefined
      );

      const redirectUrl = new URL(redirect_uri);
      redirectUrl.searchParams.set("code", code);
      if (state) redirectUrl.searchParams.set("state", state);

      res.json({ redirect: redirectUrl.toString() });
    } catch (err: any) {
      res.status(500).json({
        error: "server_error",
        error_description: `API key validation failed: ${err.message}`,
      });
    }
  });

  // Token Endpoint
  router.post("/token", async (req: Request, res: Response) => {
    const { grant_type, code, redirect_uri, client_id, client_secret, code_verifier } = req.body;

    if (grant_type !== "authorization_code") {
      res.status(400).json({ error: "unsupported_grant_type" });
      return;
    }

    // Validate auth code
    const authCode = consumeAuthCode(code);
    if (!authCode) {
      res.status(400).json({ error: "invalid_grant" });
      return;
    }

    // Validate client
    const resolvedClientId = client_id || authCode.client_id;
    const client = await getClient(resolvedClientId);
    if (!client) {
      res.status(401).json({ error: "invalid_client" });
      return;
    }

    // Validate client_secret
    if (client_secret) {
      const secretValid = await validateClientSecret(resolvedClientId, client_secret);
      if (!secretValid) {
        res.status(401).json({ error: "invalid_client", error_description: "Client secret mismatch" });
        return;
      }
    }

    // Validate redirect_uri matches
    if (redirect_uri && redirect_uri !== authCode.redirect_uri) {
      res.status(400).json({ error: "invalid_grant", error_description: "redirect_uri mismatch" });
      return;
    }

    // Validate PKCE code_verifier
    if (authCode.code_challenge) {
      if (!code_verifier) {
        res.status(400).json({ error: "invalid_grant", error_description: "code_verifier required" });
        return;
      }

      let computedChallenge: string;
      if (authCode.code_challenge_method === "S256") {
        computedChallenge = crypto
          .createHash("sha256")
          .update(code_verifier)
          .digest("base64url");
      } else {
        computedChallenge = code_verifier;
      }

      if (computedChallenge !== authCode.code_challenge) {
        res.status(400).json({ error: "invalid_grant", error_description: "code_verifier mismatch" });
        return;
      }
    }

    // Issue access token
    try {
      const token = await createAccessToken(resolvedClientId);
      res.json(token);
    } catch (err: any) {
      console.error("Token creation error:", err);
      res.status(500).json({ error: "server_error", error_description: "Token creation failed" });
    }
  });

  // Token Revocation (RFC 7009)
  router.post("/revoke", async (req: Request, res: Response) => {
    const { token } = req.body;
    if (!token) {
      res.status(400).json({ error: "invalid_request", error_description: "Token required" });
      return;
    }

    try {
      const tokenHash = hashToken(token);
      await revokeToken(tokenHash);
      res.sendStatus(200);
    } catch (err: any) {
      console.error("Token revocation error:", err);
      res.status(500).json({ error: "server_error" });
    }
  });

  return router;
}
