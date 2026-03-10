import { createHash } from "crypto";
import { getApiKeysRef } from "./firebase.js";

/**
 * Validate a MAST API key.
 *
 * Key format: mast_{secret}
 * Storage: SHA-256 hash stored in shirglassworks/admin/mcp/apiKeys/{hash}
 *
 * Returns true if the key is valid, false otherwise.
 */
export async function validateApiKey(token: string): Promise<boolean> {
  if (!token.startsWith("mast_")) return false;

  const hash = createHash("sha256").update(token).digest("hex");
  const ref = getApiKeysRef().child(hash);
  const snapshot = await ref.once("value");

  if (!snapshot.exists()) return false;

  // Update last used timestamp (fire-and-forget)
  ref.update({ lastUsedAt: new Date().toISOString() }).catch(() => {});

  return true;
}

/**
 * Generate a hash for storing a new API key.
 */
export function hashApiKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
