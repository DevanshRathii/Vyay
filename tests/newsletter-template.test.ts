import { describe, expect, it } from "vitest";
import { buildNewsletterHtml, buildNewsletterText } from "@/lib/newsletter-template";

const BASE = {
  title: "New: import bank statements",
  paragraphs: ["Backfill your history from a CSV or Excel export.", "Duplicates are flagged, not double-counted."],
  ctaLabel: "Try it now",
  ctaUrl: "https://vyay-five.vercel.app/settings",
};

describe("buildNewsletterHtml", () => {
  it("includes the title, every paragraph, and the CTA link/label", () => {
    const html = buildNewsletterHtml(BASE);
    expect(html).toContain("New: import bank statements");
    expect(html).toContain("Backfill your history from a CSV or Excel export.");
    expect(html).toContain("Duplicates are flagged, not double-counted.");
    expect(html).toContain('href="https://vyay-five.vercel.app/settings"');
    expect(html).toContain("Try it now");
  });

  it("escapes HTML special characters in user-supplied text", () => {
    const html = buildNewsletterHtml({ ...BASE, title: "New: <script>alert(1)</script> & more" });
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp; more");
  });

  it("includes the footer note only when provided", () => {
    const without = buildNewsletterHtml(BASE);
    const withNote = buildNewsletterHtml({ ...BASE, footerNote: "Reply with feedback." });
    expect(without).not.toContain("Reply with feedback.");
    expect(withNote).toContain("Reply with feedback.");
  });

  it("greets by name when provided, else a generic greeting", () => {
    expect(buildNewsletterHtml(BASE)).toContain("Hi,");
    expect(buildNewsletterHtml({ ...BASE, recipientName: "Devansh" })).toContain("Hi Devansh,");
  });
});

describe("buildNewsletterText", () => {
  it("produces a plain-text fallback with the same content", () => {
    const text = buildNewsletterText(BASE);
    expect(text).toContain("New: import bank statements");
    expect(text).toContain("Backfill your history from a CSV or Excel export.");
    expect(text).toContain("Try it now: https://vyay-five.vercel.app/settings");
  });
});
