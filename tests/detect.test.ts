import { describe, expect, it } from "vitest";
import { classifyEmail } from "@/lib/parsing/detect";

const yes = (subject: string, body: string) =>
  expect(classifyEmail({ subject, body }).isTransaction).toBe(true);
const no = (subject: string, body: string, reason?: string) => {
  const r = classifyEmail({ subject, body });
  expect(r.isTransaction).toBe(false);
  if (reason) expect(r.reason).toBe(reason);
};

describe("classifyEmail — accepts real transactions", () => {
  it("UPI debit alert", () =>
    yes(
      "You have done a UPI txn",
      "Dear Customer, Rs.285.00 has been debited from account **1234 to VPA swiggy@icici on 05-07-26. UPI Ref No 512345678901.",
    ));
  it("card purchase", () =>
    yes(
      "Transaction alert on your credit card",
      "Your ICICI Bank Credit Card XX2201 has been used for a transaction of INR 1,899.00 at AMAZON on Jul 04, 2026. Info: purchase of goods.",
    ));
  it("NEFT credit", () =>
    yes(
      "Credit alert",
      "Rs. 85,000.00 credited to your A/c No XX8890 on 01-07-26 through NEFT with reference N182260012345678.",
    ));
  it("cashback actually credited despite promo word", () =>
    yes(
      "Cashback credited",
      "Congratulations! Cashback of Rs 15.00 has been credited to your Paytm wallet for your last transaction.",
    ));
  it("real transaction whose safety-tip disclaimer mentions OTP in a do-not-share list", () =>
    yes(
      "Transaction Alert from CASHBACK SBI Card",
      "Dear Cardholder, This is to inform you that, Rs.506.00 spent on your SBI Credit Card ending 9659 at BLINKIT on 05/07/26. Safe Banking Tip: Never share your Card Number, CVV, PIN, OTP, Internet Banking User ID, Password or URN with anyone.",
    ));
  it("real transaction with a bundled promotional EMI upsell blurb", () =>
    yes(
      "Transaction Alert from CASHBACK SBI Card",
      "Rs.506.00 spent on your SBI Credit Card ending 9659 at BLINKIT on 05/07/26. Exclusive offer*! Now convert your purchases of ₹200 and above into Flexipay EMIs. Minimum Booking Amount: ₹2,500.",
    ));
});

describe("classifyEmail — rejects non-transactions", () => {
  it("OTP", () =>
    no("OTP for your transaction", "Use OTP 482913 to complete your payment of Rs 500.00. Do not share it.", "otp"));
  it("statement", () =>
    no("Your e-statement is ready", "Your combined statement for June 2026 has been generated. Total spends Rs 42,000.", "statement"));
  it("bill reminder", () =>
    no("Bill payment reminder", "Your electricity bill of Rs 1,830 is due on 15-07-2026. Pay before the due date.", "reminder"));
  it("future autopay debit", () =>
    no("Upcoming payment", "Rs 649.00 will be debited from your account on 10-07-2026 towards Netflix autopay."));
  it("collect request", () =>
    no("Payment request", "Ramesh has requested Rs 500.00 from you on Google Pay. Approve or decline in the app.", "collect-request"));
  it("failed payment", () =>
    no("Payment failed", "Your transaction of Rs 999.00 at Flipkart has failed. Any amount debited will be refunded.", "failed"));
  it("pure promo", () =>
    no("Get flat ₹100 cashback!", "Shop now and get flat Rs 100 cashback on orders above Rs 999. Limited time offer!"));
  it("no amount at all", () => no("Hello", "Just checking in about lunch tomorrow.", "no-amount"));
});
