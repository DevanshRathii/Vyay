import { openWithKey, publicKeyFor } from "@/lib/e2e-crypto";

/** localStorage-backed personal key, scoped per user (never sent to the server). */
function storageKey(userId: string): string {
  return `vyay_pk_${userId}`;
}

export function loadKey(userId: string): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(storageKey(userId));
}

export function saveKey(userId: string, privateKey: string): void {
  window.localStorage.setItem(storageKey(userId), privateKey);
}

export function clearKey(userId: string): void {
  window.localStorage.removeItem(storageKey(userId));
}

/** Validates a candidate private key against the server's stored key_check
 *  blob, without ever sending the key anywhere. Returns the derived public
 *  key on success (should match the account's stored public key) or null. */
export function verifyKey(privateKey: string, keyCheckBlob: string, expectedPublicKey: string): boolean {
  try {
    if (publicKeyFor(privateKey) !== expectedPublicKey) return false;
    const opened = openWithKey<{ check: string }>(privateKey, keyCheckBlob);
    return opened.check === "vyay-key-check-v1";
  } catch {
    return false;
  }
}
