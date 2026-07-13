import { describe, expect, it } from "vitest";
import { classifyEmail } from "@/lib/parsing/detect";
import { extractOccurredAt, parseEmail } from "@/lib/parsing/engine";
import type { EmailMessage } from "@/lib/parsing/types";

const AT = Date.parse("2026-07-11T09:00:00+05:30");

/** SMS fed through the same engine as email — `{ from, subject: "", body }`
 *  per the multi-source plan; sender is optional (the iOS "Message Contains"
 *  automation can't reliably provide it), so most fixtures pass "". */
function sms(body: string, from = ""): EmailMessage {
  return { id: "sms1", internalDate: AT, from, subject: "", body };
}

// Real HDFC SMS collected directly from the user's own inbox (2026-07),
// account/card digits already bank-masked to last 4 as sent. Covers the
// classifier/engine gaps this stage's real-sample research uncovered:
// terse leading-verb phrasing ("Sent Rs.X", "Spent Rs.X On"), the labeled
// autopay/e-mandate receipt template, card-present debits with no verb at
// all, and the negative classes (OTP, reward points, limit change, future-
// dated e-mandate pre-notice) that must never be mistaken for a transaction.
describe("SMS classification — real HDFC samples", () => {
  it("salary deposit — bare 'deposited', two amounts (deposit + Avl bal)", () => {
    const body =
      "Update! INR 1,13,556.00 deposited in HDFC Bank A/c XX0954 on 30-JUN-26 for FT-ION Salary June 2026--XXXXXXXXXX0684-ION TRADING INDIA PRIVATE LIMITED.Avl bal INR 1,29,049.34. Cheque deposits in A/C are subject to clearing";
    expect(classifyEmail(sms(body)).isTransaction).toBe(true);
    const p = parseEmail(sms(body));
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(11355600);
    expect(p!.direction).toBe("credit");
  });

  it("reward points — bare number with no currency marker, never a transaction", () => {
    const body =
      "Reward Points Credited: 500 To HDFC Bank Credit Card 5323 On 29/JUN/2026 Towards Welcome Benefit Global Value 043Check Here: https://1.hdfc.bank.in/HDFCBK/s/X6NeRAx5";
    expect(classifyEmail(sms(body)).isTransaction).toBe(false);
  });

  it("credit card limit change — has a real amount but no transaction verb", () => {
    const body =
      "Limit modified: Online international transactions\nOn HDFC Bank Credit Card ending 5323.\nNew limit: Rs. 25,000\nNot you? Chat with us 7070022222 or Call 18002026161 for assistance.";
    expect(classifyEmail(sms(body)).isTransaction).toBe(false);
  });

  it("OTP with a real amount attached — hard veto regardless of amount", () => {
    const body =
      "OTP is 737946 for txn of EUR 95.50 at WWW-RAILCLI on HDFC Bank card ending 5323. Valid till 08:17. Do not share OTP for security reasons";
    expect(classifyEmail(sms(body)).isTransaction).toBe(false);
  });

  it("UPI send — bare 'Sent Rs.X', no 'you', direction and merchant extract", () => {
    const body = "Sent Rs.214.00\nFrom HDFC Bank A/C *0954\nTo Wave cinema Kaushambi\nOn 28/06/26\nRef 617933214682\nNot You?\nCall 18002586161/SMS BLOCK UPI to 7308080808";
    expect(classifyEmail(sms(body)).isTransaction).toBe(true);
    const p = parseEmail(sms(body));
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(21400);
    expect(p!.direction).toBe("debit");
    expect(p!.referenceNumber).toBe("617933214682");
  });

  it("card spend — 'Spent Rs.X On' (amount between verb and preposition)", () => {
    const body =
      "Spent Rs.6802.61 On HDFC Bank Card 5323 At https://1.hdfc.bank.in/HDFCBK/a/y8eZ0c. On 2026-06-28:10:34:11.Not You? To Block+Reissue Call 18002586161/SMS BLOCK CC 5323 to 7308080808";
    expect(classifyEmail(sms(body)).isTransaction).toBe(true);
    const p = parseEmail(sms(body));
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(680261);
    expect(p!.direction).toBe("debit");
    expect(p!.cardLast4).toBe("5323");
    // ISO "On 2026-06-28:10:34:11" (colon before the time, not the DD-MM-YY
    // form the main date pattern expects) must parse as a real, precise time.
    expect(p!.occurredAtPrecise).toBe(true);
  });

  it("autopay e-mandate success — labeled 'Txn Amt:' template, no narrative verb at all", () => {
    const body = "AutoPay (E-mandate) Success!\nFor NETFLIX\nTxn Amt:INR649.00\nDt:11/07/2026\nVia:HDFC Bank CC 5323\nSI Hub ID: XpPjbm4fLT\nTnC";
    expect(classifyEmail(sms(body)).isTransaction).toBe(true);
    const p = parseEmail(sms(body));
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(64900);
    expect(p!.direction).toBe("debit");
    expect(p!.merchant).toBe("NETFLIX");
    // No time-of-day in the body ("Dt:11/07/2026" only) — falls back to
    // arrival time, so this must be flagged imprecise for dedup purposes.
    expect(p!.occurredAtPrecise).toBe(false);
  });

  it("autopay duplicate send — same debit, generic card template, no verb ('without OTP/PIN')", () => {
    const body =
      "Rs.649 without OTP/PIN HDFC Bank Card x5323 At NETFLIX On 2026-07-11:07:56:18.Not U? Block&Reissue:Call 18002586161/SMS BLOCK CC 5323 to 7308080808";
    expect(classifyEmail(sms(body)).isTransaction).toBe(true);
    const p = parseEmail(sms(body));
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(64900);
    expect(p!.direction).toBe("debit");
    expect(p!.occurredAtPrecise).toBe(true);
  });

  it("e-mandate future pre-notice — 'will be deducted on [date]' is always rejected", () => {
    const body =
      "E-Mandate!\nRs.749.00 will be deducted on 12/07/26, 00:00:00\nFor APPLE MEDIA SERVICES mandate\nUMN 51a3f5ef075a0b85e0630a27b10a1dc9@ptsbi\nMaintain Balance\n-HDFC Bank";
    const result = classifyEmail(sms(body));
    expect(result.isTransaction).toBe(false);
    expect(result.reason).toBe("future-debit");
  });
});

describe("extractOccurredAt — ISO 'YYYY-MM-DD:HH:MM:SS' card-spend format", () => {
  it("parses the colon-separated ISO date/time some card templates use", () => {
    const { ms, parsed, precise } = extractOccurredAt("On 2026-06-28:10:34:11.Not You?", AT);
    expect(parsed).toBe(true);
    expect(precise).toBe(true);
    const d = new Date(ms + 5.5 * 60 * 60 * 1000); // back to IST wall-clock
    expect(d.getUTCFullYear()).toBe(2026);
    expect(d.getUTCMonth()).toBe(5); // June
    expect(d.getUTCDate()).toBe(28);
    expect(d.getUTCHours()).toBe(10);
    expect(d.getUTCMinutes()).toBe(34);
  });

  it("a bare date with no time-of-day falls back to arrival time and is marked imprecise", () => {
    const { parsed, precise, ms } = extractOccurredAt("Dt:11/07/2026", AT);
    expect(parsed).toBe(false);
    expect(precise).toBe(false);
    expect(ms).toBe(AT);
  });
});
