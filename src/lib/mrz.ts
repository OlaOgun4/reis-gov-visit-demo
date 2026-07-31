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
  [/passport|passeport/i, "Nigerian Passport"],
  [/driv(er|ing)\s*(’|')?s?\s*licen[cs]e/i, "Driving Licence"],
  [/\bnin\b|national\s*identi(ty|fication)/i, "NIN Card"],
  [/voter|inec/i, "Voter's Card"],
  [/staff|employee/i, "Staff ID"],
  [/residence|permit/i, "Residence Permit"],
];

export function detectDocumentType(rawText: string): string | undefined {
  for (const [re, label] of DOC_TYPE_HINTS) if (re.test(rawText)) return label;
  return undefined;
}

/** Words that show up on ID cards but are never a person's name. */
const NAME_STOPWORDS =
  /federal|republic|nigeria|national|identity|identification|card|passport|licence|license|driver|driving|voter|commission|authority|management|ministry|government|date|birth|sex|male|female|expiry|issue|address|number|signature|holder|state|origin|nationality|surname|given|names?|staff|employee|department/i;

function looksLikeName(value: string) {
  const v = value.trim();
  if (v.length < 3 || v.length > 40) return false;
  if (/\d/.test(v)) return false;
  if (NAME_STOPWORDS.test(v)) return false;
  return /^[A-Za-z][A-Za-z' -]+$/.test(v);
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
      documentType: l1.startsWith("P") ? "Nigerian Passport" : detectDocumentType(rawText) ?? "NIN Card",
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
      documentType: detectDocumentType(rawText) ?? "NIN Card",
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

/**
 * Identity population from arbitrary QR/barcode content is intentionally disabled.
 * GovVisit pass QR validation lives in govvisit-qr.ts and never returns identity fields.
 */
export function parseCodePayload(raw: string): ParsedIdentity | null {
  void raw;
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
  if (!looksLikeName(lastName)) lastName = "";
  if (!looksLikeName(firstName)) firstName = "";

  // Fallback: uppercase name-only lines (very common on ID cards without labels).
  if (!firstName && !lastName) {
    const nameLines = lines
      .map((l) => cleanName(l))
      .filter((l) => looksLikeName(l));
    if (nameLines.length >= 2) {
      lastName = nameLines[0];
      firstName = nameLines[1];
    } else if (nameLines.length === 1) {
      const parts = nameLines[0].split(" ");
      if (parts.length >= 2) {
        lastName = parts[parts.length - 1];
        firstName = parts.slice(0, -1).join(" ");
      } else {
        lastName = nameLines[0];
      }
    }
  }

  const labelled = [
    ...text.matchAll(
      /\b(?:document|licence|license|passport|card|id|nin)\s*(?:no\.?|number|#)?\s*[:.\-]?\s*([A-Z0-9][A-Z0-9-]{4,19})\b/gi,
    ),
  ]
    .map((m) => m[1])
    .find((v) => /\d/.test(v));
  const numberMatch =
    labelled ??
    text.match(/\b([A-Z]{1,3}\d{6,12})\b/)?.[1] ??
    text.match(/\b(\d{9,12})\b/)?.[1];
  const documentNumber = numberMatch?.toUpperCase() ?? "";

  if (!firstName && !lastName && !documentNumber) return null;
  const guessedType =
    detectDocumentType(text) ??
    (/^\d{11}$/.test(documentNumber)
      ? "NIN Card"
      : /^[A-Z]\d{8}$/.test(documentNumber)
        ? "Nigerian Passport"
        : undefined);
  const title = (v: string) =>
    v
      .toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase())
      .trim();
  return {
    firstName: title(firstName),
    lastName: title(lastName),
    documentNumber,
    documentType: guessedType,
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
