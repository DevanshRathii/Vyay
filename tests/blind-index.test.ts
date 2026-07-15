import { beforeEach, describe, expect, it } from "vitest";
import { amountBidx, normalizeReference, refBidx } from "@/lib/blind-index";

beforeEach(() => {
  process.env.BLIND_INDEX_KEY = Buffer.alloc(32, 7).toString("base64");
});

describe("blind-index — amountBidx", () => {
  it("is deterministic for the same inputs", () => {
    const a = amountBidx("user-1", "debit", 15000);
    const b = amountBidx("user-1", "debit", 15000);
    expect(a).toBe(b);
  });

  it("differs when the user id, direction, or amount differ", () => {
    const base = amountBidx("user-1", "debit", 15000);
    expect(amountBidx("user-2", "debit", 15000)).not.toBe(base);
    expect(amountBidx("user-1", "credit", 15000)).not.toBe(base);
    expect(amountBidx("user-1", "debit", 15001)).not.toBe(base);
  });

  it("throws when BLIND_INDEX_KEY is not set", () => {
    delete process.env.BLIND_INDEX_KEY;
    expect(() => amountBidx("user-1", "debit", 100)).toThrow();
  });

  it("throws when BLIND_INDEX_KEY is not 32 bytes", () => {
    process.env.BLIND_INDEX_KEY = Buffer.alloc(16).toString("base64");
    expect(() => amountBidx("user-1", "debit", 100)).toThrow();
  });
});

describe("blind-index — normalizeReference", () => {
  it("strips punctuation/whitespace and lowercases", () => {
    expect(normalizeReference("512-345 678901")).toBe("512345678901");
    expect(normalizeReference("UTR:ABC123xyz")).toBe("utrabc123xyz");
  });
});

describe("blind-index — refBidx", () => {
  it("is deterministic and format-insensitive (email vs SMS vs statement spacing)", () => {
    const a = refBidx("user-1", "512345678901");
    const b = refBidx("user-1", "512-345-678-901");
    const c = refBidx("user-1", "  512345678901  ");
    expect(a).not.toBeNull();
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it("differs by user and by reference", () => {
    const base = refBidx("user-1", "512345678901");
    expect(refBidx("user-2", "512345678901")).not.toBe(base);
    expect(refBidx("user-1", "512345678902")).not.toBe(base);
  });

  it("returns null for a reference too short to trust", () => {
    expect(refBidx("user-1", "1234")).toBeNull();
    expect(refBidx("user-1", "--..--")).toBeNull();
  });
});
