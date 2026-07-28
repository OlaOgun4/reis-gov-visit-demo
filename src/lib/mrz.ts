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

const CLEAN = (s: string) => s.replace(/[^A-Z0-9<]/g, "");

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
  const candidates = rawText
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
    if (!/^[PIACV]/.test(l1)) continue;
    const names = nameFromMrz(l1.slice(5));
    const documentNumber = l2.slice(0, 9).replace(/</g, "");
    if (!documentNumber || (!names.lastName && !names.firstName)) continue;
    return {
      ...names,
      documentNumber,
      documentType: l1.startsWith("P") ? "Nigerian Passport" : undefined,
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
  const text = rawText.replace(/\u00a0/g, " ");
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const pick = (patterns: RegExp[]) => {
    for (const p of patterns) {
      for (const line of lines) {
        const m = line.match(p);
        if (m?.[1]) {
          const value = m[1].replace(/[^A-Za-z' -]/g, "").trim();
          if (value.length > 1) return value;
        }
      }
    }
    return "";
  };

  const lastName = pick([/sur\s*name[:\s]+(.+)/i, /last\s*name[:\s]+(.+)/i]);
  const firstName = pick([/given\s*names?[:\s]+(.+)/i, /first\s*name[:\s]+(.+)/i]);

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
    source: "ocr",
    confidence: 0.55,
  };
}

export function parseScannedText(rawText: string): ParsedIdentity | null {
  return parseMrz(rawText) ?? parseLabelledOcr(rawText);
}
