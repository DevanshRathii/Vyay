/** One contact parsed out of a .vcf file. */
export interface VCardContact {
  name: string;
  /** Raw phone strings as written in the file — not yet normalized. */
  phones: string[];
  /** Raw email strings as written in the file — not yet normalized. */
  emails: string[];
}

function unescapeValue(v: string): string {
  return v.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** Split "PROP;PARAM=x;PARAM=y:value" into its property name and value, honouring escaped colons. */
function splitLine(line: string): { prop: string; value: string } | null {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") {
      i++; // skip escaped char
      continue;
    }
    if (line[i] === ":") {
      return { prop: line.slice(0, i), value: line.slice(i + 1) };
    }
  }
  return null;
}

/**
 * Parse the contents of a .vcf file (one or more vCards) into name + phone +
 * email tuples. Handles RFC 6350 line unfolding and basic value escaping;
 * doesn't attempt quoted-printable/base64 property encodings, which are rare
 * in modern phone/Gmail contact exports.
 */
export function parseVCard(text: string): VCardContact[] {
  // Unfold: a line starting with a space or tab is a continuation of the
  // previous line.
  const unfolded = text.replace(/\r\n/g, "\n").replace(/\n[ \t]/g, "");
  const lines = unfolded.split("\n").map((l) => l.trim());

  const cards: VCardContact[] = [];
  let inCard = false;
  let fn: string | undefined;
  let nParts: string | undefined;
  let phones: string[] = [];
  let emails: string[] = [];

  const flush = () => {
    const name = fn ?? nameFromN(nParts);
    if (name) cards.push({ name, phones: [...phones], emails: [...emails] });
    fn = undefined;
    nParts = undefined;
    phones = [];
    emails = [];
  };

  for (const raw of lines) {
    if (!raw) continue;
    const upper = raw.toUpperCase();
    if (upper === "BEGIN:VCARD") {
      inCard = true;
      fn = undefined;
      nParts = undefined;
      phones = [];
      emails = [];
      continue;
    }
    if (upper === "END:VCARD") {
      if (inCard) flush();
      inCard = false;
      continue;
    }
    if (!inCard) continue;

    const split = splitLine(raw);
    if (!split) continue;
    const propName = split.prop.split(";")[0].toUpperCase();
    const value = unescapeValue(split.value).trim();
    if (!value) continue;

    if (propName === "FN") fn = value;
    else if (propName === "N") nParts = value;
    else if (propName === "TEL") phones.push(value);
    else if (propName === "EMAIL") emails.push(value);
  }

  return cards;
}

/** vCard N field is "Family;Given;Middle;Prefix;Suffix" — reconstruct a display name from it. */
function nameFromN(n: string | undefined): string | undefined {
  if (!n) return undefined;
  const [family, given, middle] = n.split(";").map((s) => s.trim());
  const name = [given, middle, family].filter(Boolean).join(" ").trim();
  return name || undefined;
}
