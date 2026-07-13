import { describe, expect, it } from "vitest";
import { parseEmail, stripDisplaySuffixes } from "@/lib/parsing/engine";
import type { EmailMessage } from "@/lib/parsing/types";

const AT = Date.parse("2026-07-05T10:30:00+05:30");

function email(from: string, subject: string, body: string): EmailMessage {
  return { id: "m1", internalDate: AT, from, subject, body };
}

describe("parseEmail — bank fixtures", () => {
  it("HDFC UPI debit", () => {
    const p = parseEmail(
      email(
        "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
        "You have done a UPI txn. Check details!",
        "Dear Customer, Rs.285.00 has been debited from account **7712 to VPA swiggy@icici SWIGGY on 05-07-26. Your UPI transaction reference number is 512345678901.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(28500);
    expect(p!.direction).toBe("debit");
    expect(p!.upiId).toBe("swiggy@icici");
    expect(p!.channel).toBe("UPI");
    expect(p!.referenceNumber).toBe("512345678901");
    expect(p!.provider).toBe("hdfc");
  });

  it("HDFC UPI debit — merchant is the beneficiary name, not the VPA", () => {
    const p = parseEmail(
      email(
        "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
        "You have done a UPI txn. Check details!",
        "Dear Customer,\n\nGreetings from HDFC Bank!\n\nRs.10000.00 is debited from your account ending 0954 towards VPA meenakshi1669@okaxis (MEENAKSHI RATHI) on 01-07-26.\n\nUPI transaction reference no.: 125567531975.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(1000000);
    expect(p!.upiId).toBe("meenakshi1669@okaxis");
    expect(p!.merchant).toBe("MEENAKSHI RATHI");
  });

  it("HDFC UPI credit — name precedes a parenthetical 'VPA: id', not the debit ordering", () => {
    const p = parseEmail(
      email(
        "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
        "You have received money via UPI",
        "Dear Customer,\n\nGreetings from HDFC Bank!\n\nWe're writing to inform you that Rs.825.00 has been successfully credited to your HDFC Bank account ending in 0954.\n\nTransaction Details:\na. Date: 04-07-26\nb. Sender: TANYA RATHI (VPA: tanya1999rathi@okaxis)\nc. UPI Reference No.: 655190304725",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.direction).toBe("credit");
    expect(p!.amountPaise).toBe(82500);
    expect(p!.upiId).toBe("tanya1999rathi@okaxis");
    expect(p!.merchant).toBe("TANYA RATHI");
  });

  it("HDFC credit card debit with an aggregator-prefixed merchant — doesn't latch onto the footer's toll-free number", () => {
    const p = parseEmail(
      email(
        "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
        "You have done a transaction on your HDFC Bank Credit Card",
        "Dear Customer,\n\nGreetings from HDFC Bank.\n\nWe would like to inform you that Rs. 1653.00 has been debited from your HDFC Bank Credit Card ending 6930 towards CAS*Swiggy on 04 Jul, 2026 at 14:41:49.\n\nIf you did not authorize this transaction, please report it immediately at:\na. When in India (Toll free): 1800 258 6161\nb. When abroad: 9122 61606160\nc. Or SMS 'BLOCK UPI' to 7308080808.\n\nWarm regards,\nHDFC Bank",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(165300);
    expect(p!.cardLast4).toBe("6930");
    expect(p!.channel).toBe("Card");
    expect(p!.merchant).toBe("Swiggy");
  });

  it("SBI Card 'spent on' debit — bundled OTP disclaimer and promo EMI blurb don't corrupt amount/direction", () => {
    const p = parseEmail(
      email(
        "SBI Card Transaction Alert <onlinesbicard@sbicard.com>",
        "Transaction Alert from CASHBACK SBI Card",
        "Dear Cardholder, This is to inform you that, Rs.506.00 spent on your SBI Credit Card ending 9659 at BLINKIT on 05/07/26. Trxn. not done by you? Report at https://sbicard.com/Dispute. Safe Banking Tip: Never share your Card Number, CVV, PIN, OTP, Internet Banking User ID, Password or URN with anyone. Exclusive offer*! Now convert your purchases of ₹200 and above into Flexipay EMIs. Minimum Booking Amount: ₹2,500.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(50600); // not the promo blurb's ₹2,500
    expect(p!.direction).toBe("debit"); // "spent on", not credit
    expect(p!.merchant).toBe("BLINKIT");
    expect(p!.cardLast4).toBe("9659");
    expect(p!.provider).toBe("sbi");
  });

  it("ICICI card purchase with amount != balance", () => {
    const p = parseEmail(
      email(
        "ICICI Bank <credit_cards@icicibank.com>",
        "Transaction alert for your ICICI Bank Credit Card",
        "Your ICICI Bank Credit Card XX2201 has been used for a transaction of INR 1,899.00 on Jul 04, 2026 at AMAZON. The Available Credit Limit is INR 1,55,000.00.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(189900);
    expect(p!.direction).toBe("debit");
    expect(p!.cardLast4).toBe("2201");
    expect(p!.channel).toBe("Card");
  });

  it("SBI credit via NEFT", () => {
    const p = parseEmail(
      email(
        "State Bank of India <alerts@sbi.co.in>",
        "Credit alert",
        "Dear Customer, Rs 85,000.00 credited to your A/c No XX8890 on 01-07-26 through NEFT. Ref N182260012345678. Available balance: Rs 1,42,318.55",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(8500000);
    expect(p!.direction).toBe("credit");
    expect(p!.channel).toBe("NEFT");
  });

  it("refund overrides debit wording", () => {
    const p = parseEmail(
      email(
        "Axis Bank <alerts@axisbank.com>",
        "Refund processed",
        "A refund of Rs 999.00 for your earlier debited transaction at FLIPKART has been credited to your account XX3344 on 03-07-26.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.direction).toBe("credit");
    expect(p!.amountPaise).toBe(99900);
  });

  it("GPay payment", () => {
    const p = parseEmail(
      email(
        "Google Pay <noreply@payments.google.com>",
        "You paid ₹189.00 to Uber",
        "You paid ₹189.00 to Uber India Systems using Google Pay. UPI transaction ID: 512987654321.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(18900);
    expect(p!.direction).toBe("debit");
  });

  it("falls back to internalDate for unparseable dates", () => {
    const p = parseEmail(
      email("alerts@hdfcbank.net", "Txn alert", "Rs.100.00 has been debited from account **7712 to VPA test@upi."),
    );
    expect(p).not.toBeNull();
    expect(p!.occurredAt).toBe(AT);
  });

  it("uses the email's arrival time-of-day when the body has a date but no clock time", () => {
    // Real HDFC alerts read exactly like this — a date, never a time.
    const p = parseEmail(
      email(
        "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
        "You have done a UPI txn. Check details!",
        "Rs.1228.00 is debited from your account ending 0954 towards VPA yash@hdfc (YASH GUPTA) on 05-07-26.\nUPI transaction reference no.: 210204417986.",
      ),
    );
    expect(p).not.toBeNull();
    // Body's date (5 Jul) matches AT's date, so with the arrival time-of-day
    // carried over, occurredAt should land exactly on AT — not midnight IST.
    expect(p!.occurredAt).toBe(AT);
  });
});

describe("merchant source & confidence (§1 regressions)", () => {
  it("truncates a free-text 'Remarks' capture at a stop word instead of excising just the token", () => {
    const p = parseEmail(
      email(
        "Axis Bank <alerts@axisbank.com>",
        "Transaction alert",
        "Rs.450.00 has been debited from your account. Remarks: DECATHLON ON ANNA SALAI.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.merchant).toBe("DECATHLON");
    expect(p!.merchantSource).toBe("info-freetext");
  });

  it("does not treat lowercase boilerplate right after a VPA as a beneficiary name (case-sensitive bare-name match)", () => {
    const p = parseEmail(
      email(
        "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
        "You have done a UPI txn. Check details!",
        "Rs.500.00 is debited from your account ending 0954 towards VPA merchant123@icici for future use on 05-07-26.\nUPI transaction reference no.: 512345678901.",
      ),
    );
    expect(p).not.toBeNull();
    // No capitalised beneficiary name is present, so extraction falls back to
    // the real UPI id rather than capturing lowercase boilerplate.
    expect(p!.merchant).toBe("merchant123@icici");
    expect(p!.merchantSource).toBe("upi-id");
  });

  it("prefers the UPI id over a mangled reference-number-like free-text capture", () => {
    const p = parseEmail(
      email(
        "Axis Bank <alerts@axisbank.com>",
        "Transaction alert",
        "Rs.750.00 has been debited from your account towards VPA vendor99@axis. Remarks: N182260012345678901.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.merchant).toBe("vendor99@axis");
    expect(p!.merchantSource).toBe("upi-id");
  });

  it("assigns vpa-name source and 0.85 confidence for a parenthetical beneficiary name", () => {
    const p = parseEmail(
      email(
        "HDFC Bank InstaAlerts <alerts@hdfcbank.net>",
        "You have done a UPI txn. Check details!",
        "Rs.285.00 has been debited from account **7712 to VPA swiggy@icici SWIGGY on 05-07-26. Your UPI transaction reference number is 512345678901.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.merchantSource).toBe("vpa-name");
    expect(p!.merchantConfidence).toBe(0.85);
  });
});

describe("stripDisplaySuffixes", () => {
  it("strips trailing corporate suffixes but leaves the core name", () => {
    expect(stripDisplaySuffixes("Uber India Systems")).toBe("Uber");
    expect(stripDisplaySuffixes("Ramesh Kirana Store Pvt Ltd")).toBe("Ramesh Kirana Store");
  });

  it("leaves a merchant with no trailing suffix unchanged", () => {
    expect(stripDisplaySuffixes("Swiggy")).toBe("Swiggy");
  });

  it("does not strip a suffix word that appears mid-string, not at the end", () => {
    expect(stripDisplaySuffixes("India Gate Restaurant")).toBe("India Gate Restaurant");
  });
});

describe("real production fixtures (found via DB investigation of low-confidence/uncategorized rows)", () => {
  it("HDFC e-mandate autopay confirmation — 'Your NETFLIX bill...has been successfully paid' names the merchant after 'your'", () => {
    const p = parseEmail(
      email(
        "nachautoemailer <nachautoemailer@hdfcbank.bank.in>",
        "View: Account update for your HDFC Bank A/c",
        "Dear Customer,\nGreetings from HDFC Bank!\nYour NETFLIX bill, set up through E-mandate (Auto payment), has been successfully paid using your HDFC Bank Credit Card ending 5323.\nTransaction Details:\nAmount: INR 649.00\nDate: 11/06/2026\nSI Hub ID: XpPjbm4fLT",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(64900);
    expect(p!.direction).toBe("debit");
    expect(p!.merchant).toBe("NETFLIX");
    expect(p!.merchantSource).toBe("pattern");
  });

  it("HDFC NACH mandate debit — 'towards PAYEE/refcode' truncates at the '/' instead of losing the merchant entirely", () => {
    const p = parseEmail(
      email(
        "nachautoemailer <nachautoemailer@hdfcbank.bank.in>",
        "Account update for your HDFC Bank A/c",
        "Dear Customer,\nRs.5000.00 has been debited from HDFC Bank Account Number XXXXXXXXXX0954 towards INDIAN CLEARING CORP/49391221 with UMRN HDFC7021803252008682 on 09-Jul-2026.\nAssuring you of our best services at all times.",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(500000);
    // Before the fix, the lazy capture ran past its 50-char cap looking for
    // " on"/punctuation across "INDIAN CLEARING CORP/49391221 with UMRN
    // HDFC7021803252008682" and the whole match failed, leaving no merchant.
    expect(p!.merchant).toBe("INDIAN CLEARING CORP");
  });

  // Fixtures below are redacted from real Canara Bank alerts (names, account
  // digits, and reference numbers replaced with fabricated placeholders) —
  // the template structure that caused the bug is preserved verbatim.
  it("Canara Bank UPI credit — bare 'account MASK from NAME' with no VPA at all (confirmed production gap: zero categorized transactions for a live user)", () => {
    const p = parseEmail(
      email(
        "Canara Bank <canarabank@canarabank.com>",
        "UPI Transaction Alert",
        "Dear Customer,\n\nThanking you for banking with Canara Bank.\n\nAn amount of INR 4,200.00 has been CREDITED on 03/07/26 to your account  XXXX1234 from TEST PERSONA ONE with UPI Ref No.:100000000001. Total Available Balance INR 1,79,308.52.If you are not expecting this credit or suspect any fraudulent activity, please contact: 18001030\n\n\nThis is an auto generated mail",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(420000);
    expect(p!.direction).toBe("credit");
    expect(p!.merchant).toBe("TEST PERSONA ONE");
    expect(p!.upiId).toBeUndefined();
    expect(p!.referenceNumber).toBe("100000000001");
    expect(p!.channel).toBe("UPI");
    expect(p!.provider).toBe("canara");
  });

  it("Canara Bank UPI debit — bare 'account MASK to NAME', and doesn't mistake the Available Balance figure for the transaction amount", () => {
    const p = parseEmail(
      email(
        "Canara Bank <canarabank@canarabank.com>",
        "UPI Transaction Alert",
        "Dear Customer,\n\nThanking you for banking with Canara Bank.\n\nAn amount of INR 360.00 has been DEBITED on 10/07/26 from your account XXXX1234 to TEST PERSONA TWO with UPI Ref No.:100000000002. Total Available Balance INR 1,87,348.52.To report fraud & stop further debit transaction, Call : 18001030.\n\nIf the transaction was not initiated by you, send an email from your registered e-mail id with the subject line in the below format to reportfraud@canarabank.com to block.\n\nBLOCKUPI<Space><Mobile Number prefixed with Country Code>\n\nFor blocking through SMS, send SMS from Registered Mobile Number as per below format:\nTo block MObile Banking: BLOCKMB to 9901771222.\n\n\nThis is an auto generated mail",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(36000);
    expect(p!.direction).toBe("debit");
    expect(p!.merchant).toBe("TEST PERSONA TWO");
    expect(p!.referenceNumber).toBe("100000000002");
  });

  it("Canara Bank UPI credit — second real sample, different amount/names/ref, same template", () => {
    const p = parseEmail(
      email(
        "Canara Bank <canarabank@canarabank.com>",
        "UPI Transaction Alert",
        "Dear Customer,\n\nThanking you for banking with Canara Bank.\n\nAn amount of INR 2,100.00 has been CREDITED on 12/07/26 to your account  XXXX1234 from TEST PERSONA THREE with UPI Ref No.:100000000003. Total Available Balance INR 1,89,448.52.If you are not expecting this credit or suspect any fraudulent activity, please contact: 18001030\n\n\nThis is an auto generated mail",
      ),
    );
    expect(p).not.toBeNull();
    expect(p!.amountPaise).toBe(210000);
    expect(p!.direction).toBe("credit");
    expect(p!.merchant).toBe("TEST PERSONA THREE");
    expect(p!.referenceNumber).toBe("100000000003");
  });
});
