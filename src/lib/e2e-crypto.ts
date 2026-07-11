import { x25519 } from "@noble/curves/ed25519.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";

/**
 * Zero-access (sealed-box) encryption: X25519 + HKDF-SHA256 + AES-256-GCM,
 * pure JS (noble) so this runs byte-identically in Node and the browser —
 * one code path, directly testable in vitest, no WebCrypto/node-crypto
 * branching. See CLAUDE.md's "Zero-access encryption" section for the
 * product-level threat model this implements.
 */

const VERSION_PREFIX = "v1.";
const HKDF_INFO = new TextEncoder().encode("vyay-e2e-v1");
const NONCE_LEN = 12;
const PUBKEY_LEN = 32;

export class E2EDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E2EDecryptError";
  }
}

// btoa/atob (not Buffer) so this module runs identically in the browser and
// in Node — no bundler polyfill required for the client-side decrypt path.
function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/").padEnd(s.length + ((4 - (s.length % 4)) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

export interface E2EKeypair {
  /** base64url, ~43 chars — the user-facing "personal key" */
  privateKey: string;
  /** base64url — stored server-side */
  publicKey: string;
}

export function generateKeypair(): E2EKeypair {
  const priv = x25519.utils.randomSecretKey();
  const pub = x25519.getPublicKey(priv);
  return { privateKey: toBase64Url(priv), publicKey: toBase64Url(pub) };
}

/** Derives the public key for a given private key string. */
export function publicKeyFor(privateKeyB64: string): string {
  const priv = fromBase64Url(privateKeyB64);
  return toBase64Url(x25519.getPublicKey(priv));
}

function deriveKey(sharedSecret: Uint8Array, ephPub: Uint8Array, userPub: Uint8Array): Uint8Array {
  const salt = concatBytes(ephPub, userPub);
  return hkdf(sha256, sharedSecret, salt, HKDF_INFO, 32);
}

/** Encrypts `obj` so only the holder of the matching private key can read it. */
export function sealForUser(publicKeyB64: string, obj: unknown): string {
  const userPub = fromBase64Url(publicKeyB64);
  const ephPriv = x25519.utils.randomSecretKey();
  const ephPub = x25519.getPublicKey(ephPriv);
  const shared = x25519.getSharedSecret(ephPriv, userPub);
  const key = deriveKey(shared, ephPub, userPub);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LEN));
  const plaintext = new TextEncoder().encode(JSON.stringify(obj));
  const ciphertext = gcm(key, nonce).encrypt(plaintext);
  return VERSION_PREFIX + toBase64Url(concatBytes(ephPub, nonce, ciphertext));
}

/** Decrypts a blob produced by `sealForUser`. Throws E2EDecryptError on any failure. */
export function openWithKey<T = unknown>(privateKeyB64: string, blob: string): T {
  if (!blob.startsWith(VERSION_PREFIX)) {
    throw new E2EDecryptError("Unrecognized ciphertext version prefix");
  }
  let payload: Uint8Array;
  try {
    payload = fromBase64Url(blob.slice(VERSION_PREFIX.length));
  } catch {
    throw new E2EDecryptError("Malformed ciphertext encoding");
  }
  if (payload.length < PUBKEY_LEN + NONCE_LEN) {
    throw new E2EDecryptError("Ciphertext too short");
  }
  const ephPub = payload.subarray(0, PUBKEY_LEN);
  const nonce = payload.subarray(PUBKEY_LEN, PUBKEY_LEN + NONCE_LEN);
  const ciphertext = payload.subarray(PUBKEY_LEN + NONCE_LEN);

  let priv: Uint8Array;
  try {
    priv = fromBase64Url(privateKeyB64);
  } catch {
    throw new E2EDecryptError("Malformed private key");
  }
  const userPub = x25519.getPublicKey(priv);
  const shared = x25519.getSharedSecret(priv, ephPub);
  const key = deriveKey(shared, ephPub, userPub);

  let plaintext: Uint8Array;
  try {
    plaintext = gcm(key, nonce).decrypt(ciphertext);
  } catch {
    throw new E2EDecryptError("Decryption failed — wrong key or tampered ciphertext");
  }
  try {
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  } catch {
    throw new E2EDecryptError("Decrypted payload was not valid JSON");
  }
}

export const KEY_CHECK_PAYLOAD = { check: "vyay-key-check-v1" };

export function makeKeyCheck(publicKeyB64: string): string {
  return sealForUser(publicKeyB64, KEY_CHECK_PAYLOAD);
}

/** Validates a candidate private key against a stored `key_check` blob. */
export function verifyKeyCheck(privateKeyB64: string, keyCheckBlob: string): boolean {
  try {
    const opened = openWithKey<{ check: string }>(privateKeyB64, keyCheckBlob);
    return opened.check === KEY_CHECK_PAYLOAD.check;
  } catch {
    return false;
  }
}
