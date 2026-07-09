import { describe, expect, it } from "vitest";
import { parseVCard } from "@/lib/contacts/vcard";

describe("parseVCard", () => {
  it("parses FN and multiple TEL entries", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Vansh Wadhwa",
      "N:Wadhwa;Vansh;;;",
      "TEL;TYPE=CELL:+91 99902 65771",
      "TEL;TYPE=HOME:080-2345-6789",
      "EMAIL:vansh@example.com",
      "END:VCARD",
    ].join("\n");
    const cards = parseVCard(vcf);
    expect(cards).toHaveLength(1);
    expect(cards[0].name).toBe("Vansh Wadhwa");
    expect(cards[0].phones).toEqual(["+91 99902 65771", "080-2345-6789"]);
    expect(cards[0].emails).toEqual(["vansh@example.com"]);
  });

  it("parses multiple EMAIL entries", () => {
    const vcf = [
      "BEGIN:VCARD",
      "FN:Tanya Rathi",
      "EMAIL;TYPE=HOME:tanya1999rathi@gmail.com",
      "EMAIL;TYPE=WORK:tanya.rathi@work.com",
      "END:VCARD",
    ].join("\n");
    const cards = parseVCard(vcf);
    expect(cards[0].emails).toEqual(["tanya1999rathi@gmail.com", "tanya.rathi@work.com"]);
  });

  it("falls back to N when FN is absent", () => {
    const vcf = ["BEGIN:VCARD", "N:Rathi;Meenakshi;;;", "TEL:9990265771", "END:VCARD"].join("\n");
    const cards = parseVCard(vcf);
    expect(cards[0].name).toBe("Meenakshi Rathi");
  });

  it("parses multiple contacts in one file", () => {
    const vcf = [
      "BEGIN:VCARD",
      "FN:Alice",
      "TEL:1111111111",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Bob",
      "TEL:2222222222",
      "END:VCARD",
    ].join("\n");
    const cards = parseVCard(vcf);
    expect(cards.map((c) => c.name)).toEqual(["Alice", "Bob"]);
  });

  it("unfolds continuation lines", () => {
    const vcf = ["BEGIN:VCARD", "FN:Very Long Name That", " Continues Here", "TEL:1234567890", "END:VCARD"].join(
      "\n",
    );
    const cards = parseVCard(vcf);
    expect(cards[0].name).toBe("Very Long Name ThatContinues Here");
  });

  it("unescapes commas, semicolons, and backslashes in values", () => {
    const vcf = ["BEGIN:VCARD", String.raw`FN:Smith\, John`, "TEL:1234567890", "END:VCARD"].join("\n");
    const cards = parseVCard(vcf);
    expect(cards[0].name).toBe("Smith, John");
  });

  it("skips a contact with no name", () => {
    const vcf = ["BEGIN:VCARD", "TEL:1234567890", "END:VCARD"].join("\n");
    expect(parseVCard(vcf)).toHaveLength(0);
  });
});
