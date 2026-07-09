import { describe, expect, it } from "vitest";
import { parseEmail } from "@/lib/parsing/engine";
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
