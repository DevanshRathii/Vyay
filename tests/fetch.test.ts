import { describe, expect, it } from "vitest";
import { toEmailMessage } from "@/lib/gmail/fetch";

function b64url(s: string): string {
  return Buffer.from(s, "utf8").toString("base64url");
}

describe("toEmailMessage — whitespace-padded bodies", () => {
  it("collapses long space runs instead of hanging the parser", () => {
    // Mirrors real plain-text email templates (e.g. CRED) that pad with
    // hundreds of spaces for table-style visual alignment — previously
    // pathological input for the reference-number regexes' \s* runs.
    const pad = " ".repeat(300);
    const text = `Payment Method:${pad}UPI${pad}UTR No.:${pad}D9677JUCB77C7397M7OGXzODqmh61880904`;

    const start = Date.now();
    const email = toEmailMessage({
      id: "m1",
      internalDate: String(Date.now()),
      payload: {
        mimeType: "multipart/alternative",
        headers: [{ name: "From", value: "cred@cred.club" }, { name: "Subject", value: "Payment successful" }],
        parts: [{ mimeType: "text/plain", body: { data: b64url(text) } }],
      },
    } as never);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(500);
    expect(email.body).not.toContain("   "); // no 3+ consecutive spaces survive
    expect(email.body).toContain("Payment Method: UPI");
  });
});
