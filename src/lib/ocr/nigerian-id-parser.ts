/**
 * Keyword-driven parsing of Nigerian identity documents from OCR text.
 * Pure string logic — no browser APIs, safe to import anywhere and unit-test.
 */
import { parseMrz } from "@/lib/mrz";

export type NigerianDocumentType =
  | "Nigerian Passport"
  | "Nigerian Driver's Licence"
  | "Nigerian NIN"
  | "Nigerian Permanent Voter Card"
  | "Unrecognised Nigerian ID";

export interface ExtractedIdentity {
  firstName: string;
  lastName: string;
  documentType: NigerianDocumentType;
  documentNumber: string;
  confidence: number;
  rawText: string;
  /** Keywords that drove the classification — surfaced in debug mode only. */
  matchedKeywords: string[];
  parser: string;
}

/** Maps a detected type onto the document types the visitor form offers. */
export const FORM_DOCUMENT_TYPE: Record<NigerianDocumentType, string | null> = {
  "Nigerian Passport": "Nigerian Passport",
  "Nigerian Driver's Licence": "Driving Licence",
  "Nigerian NIN": "NIN Card",
  "Nigerian Permanent Voter Card": "Voter's Card",
  "Unrecognised Nigerian ID": null,
};

/* ---------------------------------------------------------------- normalise */

export interface NormalisedText {
  lines: string[];
  upperLines: string[];
  upper: string;
  raw: string;
}

export function normaliseOcrText(raw: string): NormalisedText {
  const lines = raw
    .replace(/\u00a0/g, " ")
    .replace(/[«‹≪]/g, "<")
    .split(/\r?\n/)
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .filter((l) => l.length > 0);
  const upperLines = lines.map((l) => l.toUpperCase());
  return { lines, upperLines, upper: upperLines.join("\n"), raw };
}

/** Safe, context-limited OCR digit corrections — applied to document numbers only. */
function fixDigits(value: string) {
  return value.replace(/O/g, "0").replace(/[IL]/g, "1").replace(/S/g, "5").replace(/B/g, "8");
}

const NAME_STOPWORDS =
  /FEDERAL|REPUBLIC|NIGERIA|NATIONAL|IDENTITY|IDENTIFICATION|COMMISSION|MANAGEMENT|NIMC|INEC|FRSC|CARD|SLIP|PASSPORT|LICEN[CS]E|VOTER|AUTHORITY|MINISTRY|GOVERNMENT|DATE|BIRTH|SEX|MALE|FEMALE|EXPIRY|ISSUE|ADDRESS|NUMBER|SIGNATURE|HOLDER|STATE|ORIGIN|NATIONALITY|TRACKING|BLOOD|HEIGHT|CLASS|OCCUPATION|SURNAME|GIVEN|FORENAME|FIRST\s*NAME|MIDDLE|OTHER\s*NAMES?/;

function cleanNameValue(value: string) {
  return value
    .replace(/[^A-Za-z' -]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function looksLikeName(value: string) {
  const v = value.trim();
  if (v.length < 2 || v.length > 40) return false;
  if (NAME_STOPWORDS.test(v.toUpperCase())) return false;
  return /^[A-Za-z][A-Za-z' -]+$/.test(v);
}

export function titleCase(value: string) {
  return value
    .toLowerCase()
    .replace(/(^|[\s'-])([a-z])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    .trim();
}

/* ------------------------------------------------------------ type detection */

const TYPE_RULES: Array<{ type: NigerianDocumentType; keywords: RegExp[]; min: number }> = [
  {
    type: "Nigerian Passport",
    keywords: [/\bPASSPORT\b/, /P<NGA/, /PASSPORT\s*NO/, /GIVEN\s*NAMES/, /\bMRZ\b/],
    min: 1,
  },
  {
    type: "Nigerian Driver's Licence",
    keywords: [
      /DRIVER[’'`]?S?\s*LICEN[CS]E/,
      /DRIVING\s*LICEN[CS]E/,
      /\bFRSC\b/,
      /LICEN[CS]E\s*NO/,
      /ROAD\s*SAFETY/,
    ],
    min: 1,
  },
  {
    type: "Nigerian NIN",
    keywords: [
      /NATIONAL\s*IDENTITY\s*MANAGEMENT/,
      /\bNIMC\b/,
      /NATIONAL\s*IDENTIFICATION\s*NUMBER/,
      /\bNIN\b/,
      /TRACKING\s*ID/,
    ],
    min: 1,
  },
  {
    type: "Nigerian Permanent Voter Card",
    keywords: [
      /INDEPENDENT\s*NATIONAL\s*ELECTORAL/,
      /\bINEC\b/,
      /PERMANENT\s*VOTER/,
      /VOTER\s*IDENTIFICATION\s*NUMBER/,
      /\bVIN\b/,
    ],
    min: 1,
  },
];

export function detectDocumentType(text: NormalisedText): {
  type: NigerianDocumentType;
  matched: string[];
} {
  let best: { type: NigerianDocumentType; matched: string[] } | null = null;
  for (const rule of TYPE_RULES) {
    const matched = rule.keywords.filter((k) => k.test(text.upper)).map((k) => k.source);
    if (matched.length >= rule.min && (!best || matched.length > best.matched.length)) {
      best = { type: rule.type, matched };
    }
  }
  return best ?? { type: "Unrecognised Nigerian ID", matched: [] };
}

/* ------------------------------------------------------------ label helpers */

/** Value on the same line after the label, else the next usable line. */
function valueForLabel(text: NormalisedText, label: RegExp): string {
  for (let i = 0; i < text.upperLines.length; i++) {
    const m = text.upperLines[i].match(new RegExp(`(?:^|\\b)(?:${label.source})\\b\\s*[:.\\-]?\\s*(.*)$`));
    if (!m) continue;
    const inline = cleanNameValue(m[1] ?? "");
    if (inline.length > 1 && looksLikeName(inline)) return inline;
    for (let j = i + 1; j < Math.min(i + 3, text.lines.length); j++) {
      const next = cleanNameValue(text.lines[j]);
      if (next.length > 1 && looksLikeName(next)) return next;
    }
  }
  return "";
}

const SURNAME_LABEL = /SURNAME|LAST\s*NAME|FAMILY\s*NAME|NOM/;
const FIRSTNAME_LABEL = /FIRST\s*NAMES?|GIVEN\s*NAMES?|FORE\s*NAMES?|OTHER\s*NAMES?|PRENOMS?/;

function extractNames(text: NormalisedText) {
  let lastName = valueForLabel(text, SURNAME_LABEL);
  let firstName = valueForLabel(text, FIRSTNAME_LABEL);

  if (!firstName && !lastName) {
    const candidates = text.lines.map(cleanNameValue).filter(looksLikeName);
    if (candidates.length >= 2) {
      lastName = candidates[0];
      firstName = candidates[1];
    } else if (candidates.length === 1) {
      const parts = candidates[0].split(" ");
      if (parts.length >= 2) {
        lastName = parts[parts.length - 1];
        firstName = parts.slice(0, -1).join(" ");
      } else lastName = candidates[0];
    }
  }
  return { firstName: titleCase(firstName), lastName: titleCase(lastName) };
}

/** Grab a value near a label, searching the same line and the following one. */
function nearLabel(text: NormalisedText, label: RegExp, pattern: RegExp): string {
  for (let i = 0; i < text.upperLines.length; i++) {
    if (!new RegExp(label.source).test(text.upperLines[i])) continue;
    const scope = [text.upperLines[i], text.upperLines[i + 1] ?? ""].join(" ");
    const after = scope.split(new RegExp(label.source)).slice(1).join(" ");
    const m = after.match(pattern) ?? scope.match(pattern);
    if (m) return (m[1] ?? m[0]).trim();
  }
  return "";
}

/* --------------------------------------------------- per-document extraction */

function extractNin(text: NormalisedText) {
  const digitsOnly = (v: string) => fixDigits(v.toUpperCase()).replace(/\D/g, "");
  const labelled = nearLabel(
    text,
    /NATIONAL\s*IDENTIFICATION\s*NUMBER|IDENTIFICATION\s*NUMBER|\bNIN\b/,
    /([0-9OILS][0-9OILS \-]{9,16})/,
  );
  const fromLabel = digitsOnly(labelled);
  if (fromLabel.length === 11) return fromLabel;

  // Isolated 11-digit run, ignoring lines that are clearly a tracking ID.
  for (const line of text.upperLines) {
    if (/TRACKING/.test(line)) continue;
    const m = line.replace(/[ \-]/g, "").match(/\b(\d{11})\b/);
    if (m) return m[1];
  }
  return fromLabel.length >= 10 ? fromLabel : "";
}

function extractPassportNumber(text: NormalisedText) {
  const mrz = parseMrz(text.raw);
  if (mrz?.documentNumber) return mrz.documentNumber.toUpperCase();
  const labelled = nearLabel(
    text,
    /PASSPORT\s*(?:NO|NUMBER)|DOCUMENT\s*(?:NO|NUMBER)/,
    /\b([A-Z][0-9OILS]{7,8})\b/,
  );
  if (labelled) return labelled[0] + fixDigits(labelled.slice(1));
  const loose = text.upper.match(/\b([A-Z]\d{8})\b/);
  return loose?.[1] ?? "";
}

function extractLicenceNumber(text: NormalisedText) {
  const labelled = nearLabel(
    text,
    /LICEN[CS]E\s*(?:NO|NUMBER)|DRIVER\s*NO|\bDL\s*NO\b/,
    /\b([A-Z]{3}[A-Z0-9\-]{5,15})\b/,
  );
  if (labelled) return labelled.replace(/\s+/g, "");
  const loose = text.upper.match(/\b([A-Z]{3}\d{5}[A-Z0-9]{2,6})\b/);
  return loose?.[1] ?? "";
}

function extractVin(text: NormalisedText) {
  const labelled = nearLabel(
    text,
    /VOTER\s*IDENTIFICATION\s*NUMBER|\bVIN\b/,
    /\b([0-9A-Z]{8,25})\b/,
  );
  if (labelled) return labelled.replace(/\s+/g, "");
  const loose = text.upper.replace(/\s+/g, "").match(/\b(\d{16,20})\b/);
  return loose?.[1] ?? "";
}

function extractGenericNumber(text: NormalisedText) {
  const labelled = nearLabel(
    text,
    /(?:ID|CARD|DOCUMENT|CERTIFICATE)\s*(?:NO|NUMBER|#)/,
    /\b([A-Z0-9][A-Z0-9\-]{4,19})\b/,
  );
  if (labelled && /\d/.test(labelled)) return labelled;
  return (
    text.upper.match(/\b([A-Z]{1,3}\d{6,12})\b/)?.[1] ??
    text.upper.match(/\b(\d{9,12})\b/)?.[1] ??
    ""
  );
}

/* ----------------------------------------------------------------- entrypoint */

export function parseNigerianId(rawText: string): ExtractedIdentity {
  const text = normaliseOcrText(rawText);
  const { type, matched } = detectDocumentType(text);

  const mrz = parseMrz(text.raw);
  let { firstName, lastName } = extractNames(text);
  if (!firstName && mrz?.firstName) firstName = titleCase(mrz.firstName);
  if (!lastName && mrz?.lastName) lastName = titleCase(mrz.lastName);

  let documentNumber = "";
  let parser = "generic";
  switch (type) {
    case "Nigerian NIN":
      documentNumber = extractNin(text);
      parser = "nin";
      break;
    case "Nigerian Passport":
      documentNumber = extractPassportNumber(text);
      parser = "passport";
      break;
    case "Nigerian Driver's Licence":
      documentNumber = extractLicenceNumber(text);
      parser = "licence";
      break;
    case "Nigerian Permanent Voter Card":
      documentNumber = extractVin(text);
      parser = "voter";
      break;
    default:
      documentNumber = extractGenericNumber(text);
  }
  if (!documentNumber) documentNumber = extractGenericNumber(text);

  let confidence = 0;
  if (firstName) confidence += 0.3;
  if (lastName) confidence += 0.3;
  if (documentNumber) confidence += 0.25;
  if (type !== "Unrecognised Nigerian ID") confidence += 0.15;
  if (mrz && type === "Nigerian Passport") confidence = Math.min(1, confidence + 0.1);

  return {
    firstName,
    lastName,
    documentType: type,
    documentNumber: documentNumber.toUpperCase(),
    confidence: Math.min(1, confidence),
    rawText,
    matchedKeywords: matched,
    parser,
  };
}

export function isHighConfidence(r: ExtractedIdentity) {
  return Boolean(r.firstName && r.lastName && r.documentNumber) && r.confidence >= 0.7;
}

export function hasAnyResult(r: ExtractedIdentity) {
  return Boolean(r.firstName || r.lastName || r.documentNumber);
}