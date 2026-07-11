import { describe, expect, it } from "vitest";
import {
  E2EDecryptError,
  generateKeypair,
  makeKeyCheck,
  openWithKey,
  publicKeyFor,
  sealForUser,
  verifyKeyCheck,
} from "@/lib/e2e-crypto";

describe("e2e-crypto — seal/open round-trip", () => {
  it("round-trips an object through seal and open", () => {
    const { privateKey, publicKey } = generateKeypair();
    const payload = { amountPaise: 12345, merchant: "Swiggy", notes: "lunch" };
    const blob = sealForUser(publicKey, payload);
    expect(blob.startsWith("v1.")).toBe(true);
    const opened = openWithKey<typeof payload>(privateKey, blob);
    expect(opened).toEqual(payload);
  });

  it("produces different ciphertext for the same input each time (random nonce/ephemeral key)", () => {
    const { publicKey } = generateKeypair();
    const a = sealForUser(publicKey, { x: 1 });
    const b = sealForUser(publicKey, { x: 1 });
    expect(a).not.toBe(b);
  });

  it("derives the matching public key from a private key", () => {
    const { privateKey, publicKey } = generateKeypair();
    expect(publicKeyFor(privateKey)).toBe(publicKey);
  });

  it("rejects a tampered ciphertext", () => {
    const { privateKey, publicKey } = generateKeypair();
    const blob = sealForUser(publicKey, { amountPaise: 500 });
    const tampered = blob.slice(0, -4) + (blob.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
    expect(() => openWithKey(privateKey, tampered)).toThrow(E2EDecryptError);
  });

  it("rejects opening with the wrong private key", () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const blob = sealForUser(a.publicKey, { secret: true });
    expect(() => openWithKey(b.privateKey, blob)).toThrow(E2EDecryptError);
  });

  it("rejects a blob with an unrecognized version prefix", () => {
    const { privateKey } = generateKeypair();
    expect(() => openWithKey(privateKey, "v2.abcd")).toThrow(E2EDecryptError);
  });

  it("rejects garbage input instead of returning garbage", () => {
    const { privateKey } = generateKeypair();
    expect(() => openWithKey(privateKey, "not-a-valid-blob")).toThrow(E2EDecryptError);
  });
});

describe("e2e-crypto — key check", () => {
  it("verifies a matching key and rejects a mismatched one", () => {
    const { privateKey, publicKey } = generateKeypair();
    const other = generateKeypair();
    const check = makeKeyCheck(publicKey);
    expect(verifyKeyCheck(privateKey, check)).toBe(true);
    expect(verifyKeyCheck(other.privateKey, check)).toBe(false);
  });
});
