/**
 * OAuth token & client store for MAST MCP Server.
 * Simplified from CC MCP — single user, no audit logging, no per-user token paths.
 * Tokens stored at shirglassworks/admin/mcp/oauth/
 */

import crypto from "crypto";
import { getDb } from "../firebase.js";

// ─── Types ────────────────────────────────────────────────────

export interface StoredOAuthClient {
  client_id: string;
  client_secret_hash: string;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  created_at: number;
}

export interface OAuthClientRegistration {
  client_id: string;
  client_secret: string; // Plaintext — returned once
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
}

export interface AuthCode {
  code: string;
  client_id: string;
  redirect_uri: string;
  code_challenge?: string;
  code_challenge_method?: string;
  expires_at: number;
}

export interface TokenIndexEntry {
  clientId: string;
  expiresAt: number;
}

// ─── Cache ──────────────────────────────────────────────────

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const tokenCache = new Map<string, CacheEntry<{ clientId: string }>>();
const TOKEN_CACHE_TTL = 60_000;
const TOKEN_CACHE_MAX = 200;

const clientCache = new Map<string, CacheEntry<StoredOAuthClient>>();
const CLIENT_CACHE_TTL = 300_000;
const CLIENT_CACHE_MAX = 50;

function cacheGet<T>(cache: Map<string, CacheEntry<T>>, key: string): T | undefined {
  const entry = cache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return entry.value;
}

function cacheSet<T>(
  cache: Map<string, CacheEntry<T>>,
  key: string,
  value: T,
  ttl: number,
  maxSize: number
): void {
  if (cache.size >= maxSize) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(key, { value, expiresAt: Date.now() + ttl });
}

// ─── In-Memory Auth Codes ────────────────────────────────────

const authCodes = new Map<string, AuthCode>();

function cleanupAuthCodes(): void {
  const now = Date.now();
  for (const [key, ac] of authCodes) {
    if (ac.expires_at < now) authCodes.delete(key);
  }
}

// ─── Hashing ─────────────────────────────────────────────────

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

// ─── Firebase Refs ───────────────────────────────────────────

function getOAuthClientsRef() {
  return getDb().ref("shirglassworks/admin/mcp/oauth/clients");
}

function getOAuthClientRef(clientId: string) {
  return getDb().ref(`shirglassworks/admin/mcp/oauth/clients/${clientId}`);
}

function getTokenIndexRef() {
  return getDb().ref("shirglassworks/admin/mcp/oauth/tokenIndex");
}

function getTokenIndexEntryRef(tokenHash: string) {
  return getDb().ref(`shirglassworks/admin/mcp/oauth/tokenIndex/${tokenHash}`);
}

// ─── Client Registration ─────────────────────────────────────

export async function registerClient(registration: {
  client_name?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
}): Promise<OAuthClientRegistration> {
  cleanupAuthCodes();

  const clientId = crypto.randomUUID();
  const clientSecret = crypto.randomUUID();
  const clientSecretHash = hashToken(clientSecret);

  const stored: StoredOAuthClient = {
    client_id: clientId,
    client_secret_hash: clientSecretHash,
    client_name: registration.client_name || "Unknown Client",
    redirect_uris: registration.redirect_uris || [],
    grant_types: registration.grant_types || ["authorization_code"],
    response_types: registration.response_types || ["code"],
    token_endpoint_auth_method:
      registration.token_endpoint_auth_method || "client_secret_post",
    created_at: Date.now(),
  };

  await getOAuthClientRef(clientId).set(stored);
  cacheSet(clientCache, clientId, stored, CLIENT_CACHE_TTL, CLIENT_CACHE_MAX);

  return {
    client_id: clientId,
    client_secret: clientSecret,
    client_name: stored.client_name,
    redirect_uris: stored.redirect_uris,
    grant_types: stored.grant_types,
    response_types: stored.response_types,
    token_endpoint_auth_method: stored.token_endpoint_auth_method,
  };
}

export async function getClient(
  clientId: string
): Promise<StoredOAuthClient | undefined> {
  const cached = cacheGet(clientCache, clientId);
  if (cached) return cached;

  try {
    const snapshot = await getOAuthClientRef(clientId).once("value");
    const data = snapshot.val();
    if (!data) return undefined;
    const client = data as StoredOAuthClient;
    cacheSet(clientCache, clientId, client, CLIENT_CACHE_TTL, CLIENT_CACHE_MAX);
    return client;
  } catch (err) {
    console.error("Client lookup error:", err);
    return undefined;
  }
}

export async function validateClientSecret(
  clientId: string,
  clientSecret: string
): Promise<boolean> {
  const client = await getClient(clientId);
  if (!client) return false;
  return hashToken(clientSecret) === client.client_secret_hash;
}

// ─── Auth Codes ──────────────────────────────────────────────

export function createAuthCode(
  clientId: string,
  redirectUri: string,
  codeChallenge?: string,
  codeChallengeMethod?: string
): string {
  const code = crypto.randomUUID();
  authCodes.set(code, {
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: codeChallengeMethod,
    expires_at: Date.now() + 10 * 60 * 1000,
  });
  return code;
}

export function consumeAuthCode(code: string): AuthCode | undefined {
  const authCode = authCodes.get(code);
  if (!authCode) return undefined;
  if (authCode.expires_at < Date.now()) {
    authCodes.delete(code);
    return undefined;
  }
  authCodes.delete(code); // One-time use
  return authCode;
}

// ─── Access Tokens ───────────────────────────────────────────

export async function createAccessToken(
  clientId: string
): Promise<{ access_token: string; token_type: string; expires_in: number }> {
  const plaintextToken = crypto.randomUUID();
  const tokenHash = hashToken(plaintextToken);
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  const entry: TokenIndexEntry = { clientId, expiresAt };
  await getTokenIndexEntryRef(tokenHash).set(entry);

  cacheSet(tokenCache, tokenHash, { clientId }, TOKEN_CACHE_TTL, TOKEN_CACHE_MAX);

  return {
    access_token: plaintextToken,
    token_type: "Bearer",
    expires_in: 86400,
  };
}

export async function validateAccessToken(
  token: string
): Promise<{ clientId: string } | undefined> {
  const tokenHash = hashToken(token);

  // Check cache first
  const cached = cacheGet(tokenCache, tokenHash);
  if (cached) return cached;

  // Firebase fallback
  try {
    const snapshot = await getTokenIndexEntryRef(tokenHash).once("value");
    const data = snapshot.val() as TokenIndexEntry | null;
    if (!data) return undefined;

    // Check expiry
    if (data.expiresAt < Date.now()) {
      // Lazy-delete expired token
      getTokenIndexEntryRef(tokenHash).remove().catch(() => {});
      return undefined;
    }

    const result = { clientId: data.clientId };
    cacheSet(tokenCache, tokenHash, result, TOKEN_CACHE_TTL, TOKEN_CACHE_MAX);
    return result;
  } catch (err) {
    console.error("Token validation error:", err);
    return undefined;
  }
}

export async function revokeToken(tokenHash: string): Promise<void> {
  await getTokenIndexEntryRef(tokenHash).remove();
  tokenCache.delete(tokenHash);
}
