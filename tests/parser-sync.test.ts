import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, openWithKey, sealForUser } from "@/lib/e2e-crypto";
import type { TransactionEncPayload } from "@/lib/ingest";
import { runClientParserSync } from "@/lib/parser-sync";

const AT = Date.parse("2026-07-05T10:30:00+05:30");

/** Standard HDFC UPI debit body (same fixture as tests/parsers.test.ts) —
 * exercises the sync *mechanism* (decrypt → reparse → reseal → PATCH)
 * against a template the engine already handles correctly on every branch,
 * independent of any specific bank-parsing fix. */
const HDFC_BODY =
  "Dear Customer, Rs.285.00 has been debited from account **7712 to VPA swiggy@icici SWIGGY on 05-07-26. Your UPI transaction reference number is 512345678901.";

function fakeRawPayload() {
  return JSON.stringify({
    from: "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
    subject: "You have done a UPI txn. Check details!",
    snippet: "Rs.285.00 debited",
    body: HDFC_BODY,
    internalDate: AT,
  });
}

interface MockRoute {
  method: string;
  url: string;
  body?: unknown;
}

function mockFetch(routes: Record<string, unknown>, patches: MockRoute[]) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (method === "PATCH") {
      patches.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : undefined });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }
    const match = routes[url];
    if (match === undefined) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(match), { status: 200 });
  });
}

describe("runClientParserSync", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    process.env.BLIND_INDEX_KEY = Buffer.alloc(32, 7).toString("base64");
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("decrypts, re-parses, re-seals, and categorizes a previously-unresolved transaction", async () => {
    const { privateKey, publicKey } = generateKeypair();
    const originalPayload: TransactionEncPayload = {
      amountPaise: 28500,
      merchant: null,
      merchantNormalized: null,
      notes: null,
      upiId: null,
      referenceNumber: null,
      emailSubject: "You have done a UPI txn. Check details!",
      bank: null,
      cardLast4: null,
      channel: null,
      raw: fakeRawPayload(),
    };
    const encPayload = sealForUser(publicKey, originalPayload);

    const patches: MockRoute[] = [];
    global.fetch = mockFetch(
      {
        "/api/transactions": {
          rows: [
            {
              id: "txn-1",
              source: "gmail",
              deletedAt: null,
              categoryId: null,
              encPayload,
            },
          ],
        },
        "/api/categories": { rows: [] },
        "/api/rules": { rows: [] },
        "/api/contacts": { rows: [] },
      },
      patches,
    ) as unknown as typeof fetch;

    await runClientParserSync({
      decrypt: (blob: string) => openWithKey(privateKey, blob),
      seal: (obj: unknown) => sealForUser(publicKey, obj),
    });

    expect(patches).toHaveLength(1);
    expect(patches[0].url).toBe("/api/transactions/txn-1");
    const body = patches[0].body as { encPayload?: string };
    expect(body.encPayload).toBeTruthy();

    const resealed = openWithKey<TransactionEncPayload>(privateKey, body.encPayload!);
    expect(resealed.merchant).toBe("Swiggy");
    expect(resealed.referenceNumber).toBe("512345678901");
    // amountPaise/raw/notes must survive the round-trip untouched.
    expect(resealed.amountPaise).toBe(28500);
    expect(resealed.raw).toBe(originalPayload.raw);
  });

  it("skips rows without encPayload, deleted rows, and non-gmail rows", async () => {
    const patches: MockRoute[] = [];
    global.fetch = mockFetch(
      {
        "/api/transactions": {
          rows: [
            { id: "a", source: "gmail", deletedAt: null, categoryId: null, encPayload: null },
            { id: "b", source: "gmail", deletedAt: Date.now(), categoryId: null, encPayload: "v1.fake" },
            { id: "c", source: "manual", deletedAt: null, categoryId: null, encPayload: "v1.fake" },
          ],
        },
        "/api/categories": { rows: [] },
        "/api/rules": { rows: [] },
        "/api/contacts": { rows: [] },
      },
      patches,
    ) as unknown as typeof fetch;

    await runClientParserSync({
      decrypt: () => {
        throw new Error("should never be called");
      },
      seal: () => "unused",
    });

    expect(patches).toHaveLength(0);
  });

  it("never overwrites an already-set category, but still corrects the sealed merchant", async () => {
    const { privateKey, publicKey } = generateKeypair();
    const payload: TransactionEncPayload = {
      amountPaise: 28500,
      merchant: null,
      merchantNormalized: null,
      notes: "my note",
      upiId: null,
      referenceNumber: null,
      emailSubject: "You have done a UPI txn. Check details!",
      bank: null,
      cardLast4: null,
      channel: null,
      raw: fakeRawPayload(),
    };
    const encPayload = sealForUser(publicKey, payload);
    const patches: MockRoute[] = [];
    global.fetch = mockFetch(
      {
        "/api/transactions": {
          rows: [{ id: "txn-2", source: "gmail", deletedAt: null, categoryId: "existing-cat", encPayload }],
        },
        "/api/categories": { rows: [] },
        "/api/rules": { rows: [] },
        "/api/contacts": { rows: [] },
      },
      patches,
    ) as unknown as typeof fetch;

    await runClientParserSync({
      decrypt: (blob: string) => openWithKey(privateKey, blob),
      seal: (obj: unknown) => sealForUser(publicKey, obj),
    });

    expect(patches).toHaveLength(1);
    const body = patches[0].body as { categoryId?: string; encPayload?: string };
    expect(body.categoryId).toBeUndefined(); // never touched — already set
    expect(body.encPayload).toBeTruthy();
    const resealed = openWithKey<TransactionEncPayload>(privateKey, body.encPayload!);
    expect(resealed.merchant).toBe("Swiggy");
    expect(resealed.notes).toBe("my note"); // untouched
  });
});
