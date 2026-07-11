import { beforeEach, describe, expect, it } from "vitest";
import { amountBidx } from "@/lib/blind-index";

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
