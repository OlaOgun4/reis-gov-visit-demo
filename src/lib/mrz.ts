/**
 * Machine Readable Zone (ICAO 9303) and AAMVA barcode parsing helpers.
 * Pure string parsing — safe to import anywhere.
 */

export interface ParsedIdentity {
  firstName: string;
  lastName: string;
  documentNumber: string;
  documentType?: string;
  nationality?: string;
  birthDate?: string;
  expiryDate?: string;
  source: "mrz" | "pdf417" | "qr" | "barcode" | "ocr";
  confidence: number;
}

/** OCR frequently renders MRZ filler '<' as «, ≪, K, or spaces between chevrons. */
function normalizeOcr(s: string) {
  return s
    .replace(/\u00a0/g, " ")
    .replace(/[«‹≪<]/g, "<")
    .replace(/[|]/g, "I");
}

const CLEAN = (s: string) => s.replace(/[^A-Z0-9<]/g, "");

const DOC_TYPE_HINTS: Array<[RegExp, string]> = [
  [/passport|passeport/i, "Passport"],
  [/driv(er|ing)\s*(’|')?s?\s*licen[cs]e/i, "Driving Licence"],
  [/\bnin\b|national\s*identi(ty|fication)/i, "National ID (NIN)"],
  [/voter|inec/i, "Voter's Card"],
  [/staff|employee/i, "Staff ID"],
  [/residence|permit/i, "Residence Permit"],
];

export function detectDocumentType(rawText: string): string | undefined {
  for (const [re, label] of DOC_TYPE_HINTS) if (re.test(rawText)) return label;
  return undefined;
}

function titleCase(value: string) {
  return value
    .replace(/</g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/(^|[\s'-])(\w)/g, (_, sep: string, ch: string) => sep + ch.toUpperCase());
}

function nameFromMrz(field: string) {
  const [last = "", given = ""] = field.split("<<");
  return { lastName: titleCase(last), firstName: titleCase(given) };
}

/** Extract the MRZ from raw OCR text and decode it. Supports TD1, TD2 and TD3. */
export function parseMrz(rawText: string): ParsedIdentity | null {
  const candidates = normalizeOcr(rawText)
    .toUpperCase()
    .split(/\r?\n/)
    .map(CLEAN)
    .filter((l) => l.length >= 28 && (l.match(/</g)?.length ?? 0) >= 2);

  // TD3 (passport) / TD2: two lines, 44 or 36 chars.
  for (let i = 0; i < candidates.length - 1; i++) {
    const l1 = candidates[i];
    const l2 = candidates[i + 1];
    const size = l1.length >= 40 ? 44 : 36;
    if (Math.abs(l1.length - size) > 3 || Math.abs(l2.length - size) > 3) continue;
    if (!/^[PIACVD]/.test(l1)) continue;
    const names = nameFromMrz(l1.slice(5));
    const documentNumber = l2.slice(0, 9).replace(/</g, "");
    if (!documentNumber || (!names.lastName && !names.firstName)) continue;
    return {
      ...names,
      documentNumber,
      documentType: l1.startsWith("P") ? "Passport" : detectDocumentType(rawText) ?? "National ID (NIN)",
      nationality: l2.slice(10, 13).replace(/</g, ""),
      birthDate: l2.slice(13, 19),
      expiryDate: l2.slice(21, 27),
      source: "mrz",
      confidence: 0.9,
    };
  }

  // TD1 (ID card): three lines of 30 chars, names on line 3.
  for (let i = 0; i < candidates.length - 2; i++) {
    const [l1, l2, l3] = [candidates[i], candidates[i + 1], candidates[i + 2]];
    if ([l1, l2, l3].some((l) => Math.abs(l.length - 30) > 3)) continue;
    const documentNumber = l1.slice(5, 14).replace(/</g, "");
    const names = nameFromMrz(l3);
    if (!documentNumber) continue;
    return {
      ...names,
      documentNumber,
      documentType: detectDocumentType(rawText) ?? "National ID (NIN)",
      nationality: l2.slice(15, 18).replace(/</g, ""),
      birthDate: l2.slice(0, 6),
      expiryDate: l2.slice(8, 14),
      source: "mrz",
      confidence: 0.85,
    };
  }
  return null;
}

/** AAMVA PDF417 payload found on driving licences. */
export function parseAamva(raw: string): ParsedIdentity | null {
  if (!/D[LC]|ANSI /.test(raw)) return null;
  const get = (code: string) => {
    const m = raw.match(new RegExp(`${code}([^\\n\\r]*)`));
    return m ? m[1].trim() : "";
  };
  const first = get("DAC") || get("DCT");
  const last = get("DCS") || get("DAB");
  const number = get("DAQ");
  if (!number && !last) return null;
  const title = (v: string) =>
    v
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  return {
    firstName: title(first.split(/[, ]/)[0] ?? ""),
    lastName: title(last),
    documentNumber: number,
    documentType: "Driving Licence",
    source: "pdf417",
    confidence: 0.95,
  };
}

/** QR payloads used by GovVisit passes and generic JSON/URL visitor payloads. */
export function parseCodePayload(raw: string): ParsedIdentity | null {
  const trimmed = raw.trim();
  const aamva = parseAamva(trimmed);
  if (aamva) return aamva;

  try {
    const json = JSON.parse(trimmed) as Record<string, string>;
    const firstName = json.firstName ?? json.first_name ?? json.givenName ?? "";
    const lastName = json.lastName ?? json.last_name ?? json.surname ?? "";
    const documentNumber = json.documentNumber ?? json.document_number ?? json.id ?? "";
    if (firstName || lastName || documentNumber) {
      return {
        firstName,
        lastName,
        documentNumber,
        documentType: json.documentType ?? json.document_type,
        source: "qr",
        confidence: 0.95,
      };
    }
  } catch {
    /* not JSON */
  }

  // Delimited payloads, e.g. "OKORO|CHINEDU|A12345678"
  const parts = trimmed.split(/[|;]/).map((p) => p.trim());
  if (parts.length >= 3) {
    return {
      lastName: parts[0],
      firstName: parts[1],
      documentNumber: parts[2],
      source: "barcode",
      confidence: 0.7,
    };
  }
  return null;
}

/** Label-driven extraction for documents without an MRZ (NIN card, staff ID). */
export function parseLabelledOcr(rawText: string): ParsedIdentity | null {
  const text = normalizeOcr(rawText);
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const cleanName = (v: string) =>
    v
      .replace(/[^A-Za-z' -]/g, " ")
      .replace(/\s+/g, " ")
      .trim();

  /** Match "Label: value" on the same line, else take the next non-label line. */
  const pick = (label: RegExp) => {
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(new RegExp(`${label.source}\\s*[:.\\-]?\\s*(.*)$`, "i"));
      if (!m) continue;
      const inline = cleanName(m[1] ?? "");
      if (inline.length > 1) return inline;
      const next = cleanName(lines[i + 1] ?? "");
      if (next.length > 1) return next;
    }
    return "";
  };

  let lastName = pick(/sur\s*?name|last\s*name|nom|family\s*name/);
  let firstName = pick(/given\s*names?|first\s*name|fore\s*names?|other\s*names?|pr[ée]noms?/);

  // Fallback: uppercase name-only lines (very common on ID cards without labels).
  if (!firstName && !lastName) {
    const capsLines = lines.filter((l) => /^[A-Z][A-Z' -]{3,30}$/.test(l.trim()));
    if (capsLines.length >= 2) {
      lastName = cleanName(capsLines[0]);
      firstName = cleanName(capsLines[1]);
    } else if (capsLines.length === 1) {
      const parts = cleanName(capsLines[0]).split(" ");
      if (parts.length >= 2) {
        lastName = parts[parts.length - 1];
        firstName = parts.slice(0, -1).join(" ");
      }
    }
  }

  const numberMatch =
    text.match(/(?:document|licence|license|passport|card|id|nin)\s*(?:no|number|#)?[:\s]+([A-Z0-9-]{5,20})/i) ??
    text.match(/\b([A-Z]{1,3}\d{6,12})\b/) ??
    text.match(/\b(\d{9,12})\b/);
  const documentNumber = numberMatch?.[1]?.toUpperCase() ?? "";

  if (!firstName && !lastName && !documentNumber) return null;
  const title = (v: string) =>
    v
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  return {
    firstName: title(firstName),
    lastName: title(lastName),
    documentNumber,
    documentType: detectDocumentType(text),
    source: "ocr",
    confidence: 0.55,
  };
}

export function parseScannedText(rawText: string): ParsedIdentity | null {
  const mrz = parseMrz(rawText);
  if (mrz && (mrz.firstName || mrz.lastName)) return mrz;
  const labelled = parseLabelledOcr(rawText);
  if (mrz && labelled) {
    return {
      ...mrz,
      firstName: mrz.firstName || labelled.firstName,
      lastName: mrz.lastName || labelled.lastName,
      documentNumber: mrz.documentNumber || labelled.documentNumber,
      documentType: mrz.documentType ?? labelled.documentType,
    };
  }
  return mrz ?? labelled;
}
