/**
 * Server-only identity-document OCR provider.
 *
 * The captured image is submitted to the configured vision provider in memory.
 * This module does not write the image, raw OCR text or document number to
 * application storage or logs.
 */
import {
  CONFIDENCE,
  DOCUMENT_TYPES,
  FAILURE_MESSAGES,
  OCR_ALLOWED_MIME_TYPES,
  OCR_MAX_IMAGE_BYTES,
  TWO_SIDED_DOCUMENTS,
  emptyFields,
  type CaptureSide,
  type DocumentType,
  type IdentityOcrResult,
  type OcrFailureCategory,
  type OcrFields,
} from "./ocr-types";

const GATEWAY_URL = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";
const PROVIDER = `lovable-ai:${MODEL}`;
const TIMEOUT_MS = 45_000;

const SYSTEM_PROMPT = `You are an identity-document OCR engine for a Nigerian government visitor-management platform.
Read only information genuinely visible in the supplied image. Never invent, infer, complete or hallucinate a name, number or date. If a value is not legible, return null for the value and its confidence.

Classify the document into exactly one of:
NIGERIAN_PASSPORT, NIN_SLIP, NATIONAL_ID_CARD, NIGERIAN_DRIVERS_LICENCE, PERMANENT_VOTERS_CARD, RESIDENCE_PERMIT, ECOWAS_IDENTITY_DOCUMENT, GOVERNMENT_STAFF_ID, MILITARY_SERVICE_ID, OTHER_GOVERNMENT_ID, UNKNOWN.

Nigerian document designs vary by issue year, colour, orientation and wording. Use visible labels, layout, issuing authority, machine-readable zones and barcodes rather than one fixed template. If unsure, return UNKNOWN and list up to three candidate types.

For passports, read the machine-readable zone when visible and transcribe its lines verbatim into "mrz". Dates must be ISO YYYY-MM-DD or null. Confidence values must be from 0 to 1 and reflect the legibility of that specific field.

Return strict JSON only, without prose or markdown fences:
{
  "documentDetected": boolean,
  "readable": boolean,
  "quality": { "blurred": boolean, "glare": boolean, "partial": boolean },
  "documentType": string,
  "documentTypeConfidence": number|null,
  "documentTypeCandidates": string[],
  "fields": {
    "firstName": string|null, "middleName": string|null, "lastName": string|null,
    "documentNumber": string|null, "nationality": string|null, "dateOfBirth": string|null,
    "issueDate": string|null, "expiryDate": string|null, "issuingAuthority": string|null
  },
  "fieldConfidence": { "firstName": number|null, "lastName": number|null, "documentNumber": number|null },
  "mrz": string|null,
  "rawText": string,
  "warnings": string[]
}`;

export type OcrInput = {
  imageBase64: string;
  mimeType: string;
  captureSide: CaptureSide;
  selectedHint?: DocumentType | null;
};

function fail(
  category: OcrFailureCategory,
  requestId: string,
  captureSide: CaptureSide,
  startedAt: number,
  warnings: string[] = [],
  message = FAILURE_MESSAGES[category],
): IdentityOcrResult {
  return {
    success: false,
    documentType: null,
    documentTypeConfidence: null,
    documentTypeCandidates: [],
    fields: { ...emptyFields },
    fieldConfidence: { firstName: null, lastName: null, documentNumber: null },
    rawText: "",
    warnings,
    requiresReview: true,
    provider: PROVIDER,
    captureSide,
    failureCategory: category,
    message,
    durationMs: Date.now() - startedAt,
    requestId,
  };
}

function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed || trimmed.toUpperCase() === "NULL" || trimmed === "-") return null;
  return trimmed;
}

/** Preserve MRZ line boundaries; general field cleaning must not be used here. */
function cleanMrz(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const lines = value
    .toUpperCase()
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, "").trim())
    .filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

function score(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1, Math.max(0, number > 1 ? number / 100 : number));
}

function asDocumentType(value: unknown): DocumentType {
  const upper = typeof value === "string" ? value.toUpperCase().trim() : "";
  return (DOCUMENT_TYPES as readonly string[]).includes(upper)
    ? (upper as DocumentType)
    : "UNKNOWN";
}

function checkDigit(input: string) {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    let value = 0;
    if (character >= "0" && character <= "9") value = Number(character);
    else if (character >= "A" && character <= "Z") value = character.charCodeAt(0) - 55;
    sum += value * weights[index % 3];
  }
  return sum % 10;
}

export type MrzParse = {
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  documentNumber: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  expiryDate: string | null;
  numberCheckPassed: boolean | null;
};

/** Parse an ICAO 9303 TD3 passport machine-readable zone. */
export function parseMrz(raw: string | null): MrzParse | null {
  if (!raw) return null;
  const lines = raw
    .toUpperCase()
    .split(/\r?\n/)
    .map((line) => line.replace(/\s/g, ""))
    .filter((line) => line.length >= 30 && /^[A-Z0-9<]+$/.test(line));
  const firstLine = lines.find((line) => line.startsWith("P<"));
  const secondLine = lines.find((line) => line !== firstLine && line.length >= 40);
  if (!firstLine) return null;

  const [surnameRaw = "", givenRaw = ""] = firstLine.slice(5).split("<<");
  const surname = surnameRaw.replace(/</g, " ").trim() || null;
  const givenNames = givenRaw.replace(/</g, " ").trim().split(/\s+/).filter(Boolean);

  let documentNumber: string | null = null;
  let nationality: string | null = null;
  let dateOfBirth: string | null = null;
  let expiryDate: string | null = null;
  let numberCheckPassed: boolean | null = null;

  if (secondLine) {
    const rawNumber = secondLine.slice(0, 9);
    documentNumber = rawNumber.replace(/</g, "").trim() || null;
    const declaredDigit = Number(secondLine[9]);
    if (Number.isInteger(declaredDigit)) {
      numberCheckPassed = checkDigit(rawNumber) === declaredDigit;
    }
    nationality = secondLine.slice(10, 13).replace(/</g, "") || null;
    dateOfBirth = expandMrzDate(secondLine.slice(13, 19), false);
    expiryDate = expandMrzDate(secondLine.slice(21, 27), true);
  }

  return {
    lastName: surname,
    firstName: givenNames[0] ?? null,
    middleName: givenNames.slice(1).join(" ") || null,
    documentNumber,
    nationality,
    dateOfBirth,
    expiryDate,
    numberCheckPassed,
  };
}

function expandMrzDate(value: string, futureDate: boolean) {
  if (!/^\d{6}$/.test(value)) return null;
  const shortYear = Number(value.slice(0, 2));
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  const currentShortYear = new Date().getFullYear() % 100;
  const century = futureDate
    ? shortYear < currentShortYear + 50
      ? 2000
      : 1900
    : shortYear > currentShortYear
      ? 1900
      : 2000;
  const year = century + shortYear;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null;
  }
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function normaliseDocumentNumber(type: DocumentType, value: string | null) {
  if (!value) return null;
  const compact = value.replace(/[^A-Za-z0-9-]/g, "").toUpperCase();
  if (!compact) return null;
  if (type === "NIN_SLIP" || type === "NATIONAL_ID_CARD") {
    const digits = compact.replace(/\D/g, "");
    if (digits.length === 11) return digits;
  }
  return compact;
}

function approximateDecodedBytes(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

export async function extractIdentityDocument(input: OcrInput): Promise<IdentityOcrResult> {
  const startedAt = Date.now();
  const requestId = crypto.randomUUID();
  const side = input.captureSide;

  if (!input.imageBase64) return fail("NO_IMAGE", requestId, side, startedAt);
  if (!(OCR_ALLOWED_MIME_TYPES as readonly string[]).includes(input.mimeType)) {
    return fail("UNSUPPORTED_FILE_TYPE", requestId, side, startedAt);
  }
  if (approximateDecodedBytes(input.imageBase64) > OCR_MAX_IMAGE_BYTES) {
    return fail("FILE_TOO_LARGE", requestId, side, startedAt);
  }

  const apiKey = process.env.LOVABLE_API_KEY;
  if (!apiKey) return fail("PROVIDER_NOT_CONFIGURED", requestId, side, startedAt);

  const hint = input.selectedHint && input.selectedHint !== "UNKNOWN" ? input.selectedHint : null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let payload: Record<string, unknown>;
  try {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: `Capture side: ${side}.${
                  hint ? ` Officer-selected document hint: ${hint}.` : ""
                } Extract only what is genuinely visible.`,
              },
              {
                type: "image_url",
                image_url: { url: `data:${input.mimeType};base64,${input.imageBase64}` },
              },
            ],
          },
        ],
      }),
    });

    if (response.status === 429) return fail("RATE_LIMITED", requestId, side, startedAt);
    if (!response.ok) return fail("SERVICE_UNAVAILABLE", requestId, side, startedAt);

    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    const jsonText = content
      .replace(/^```(?:json)?/i, "")
      .replace(/```$/i, "")
      .trim();
    payload = JSON.parse(jsonText) as Record<string, unknown>;
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return fail(timedOut ? "TIMEOUT" : "SERVICE_UNAVAILABLE", requestId, side, startedAt);
  } finally {
    clearTimeout(timer);
  }

  const quality = (payload.quality ?? {}) as Record<string, unknown>;
  const warnings = Array.isArray(payload.warnings)
    ? (payload.warnings as unknown[]).filter(
        (warning): warning is string => typeof warning === "string",
      )
    : [];

  if (payload.documentDetected === false) {
    return fail("NO_DOCUMENT_DETECTED", requestId, side, startedAt, warnings);
  }
  if (quality.blurred === true && payload.readable === false) {
    return fail("IMAGE_TOO_BLURRED", requestId, side, startedAt, warnings);
  }
  if (quality.glare === true && payload.readable === false) {
    return fail("IMAGE_GLARE", requestId, side, startedAt, warnings);
  }
  if (payload.readable === false) {
    return fail("NO_READABLE_TEXT", requestId, side, startedAt, warnings);
  }

  const rawFields = (payload.fields ?? {}) as Record<string, unknown>;
  const rawConfidence = (payload.fieldConfidence ?? {}) as Record<string, unknown>;

  let documentType = asDocumentType(payload.documentType);
  let documentTypeConfidence = score(payload.documentTypeConfidence);
  const candidates = Array.isArray(payload.documentTypeCandidates)
    ? Array.from(
        new Set(
          (payload.documentTypeCandidates as unknown[])
            .map(asDocumentType)
            .filter((type) => type !== "UNKNOWN"),
        ),
      )
    : [];

  if (documentTypeConfidence != null && documentTypeConfidence < CONFIDENCE.documentType) {
    documentType = "UNKNOWN";
    warnings.push(
      "Document-type confidence is below the configured threshold. Select it manually.",
    );
  }

  const fields: OcrFields = {
    firstName: clean(rawFields.firstName),
    middleName: clean(rawFields.middleName),
    lastName: clean(rawFields.lastName),
    documentNumber: clean(rawFields.documentNumber),
    nationality: clean(rawFields.nationality),
    dateOfBirth: clean(rawFields.dateOfBirth),
    issueDate: clean(rawFields.issueDate),
    expiryDate: clean(rawFields.expiryDate),
    issuingAuthority: clean(rawFields.issuingAuthority),
  };

  const fieldConfidence = {
    firstName: score(rawConfidence.firstName),
    lastName: score(rawConfidence.lastName),
    documentNumber: score(rawConfidence.documentNumber),
  };

  const mrz = parseMrz(cleanMrz(payload.mrz));
  if (mrz) {
    if (mrz.numberCheckPassed === false) {
      warnings.push(
        "The passport MRZ document-number check digit failed. Confirm the number manually.",
      );
    } else if (mrz.documentNumber) {
      fields.documentNumber = mrz.documentNumber;
      fieldConfidence.documentNumber = Math.max(fieldConfidence.documentNumber ?? 0, 0.92);
    }
    fields.lastName = mrz.lastName ?? fields.lastName;
    fields.firstName = mrz.firstName ?? fields.firstName;
    fields.middleName = mrz.middleName ?? fields.middleName;
    fields.nationality = mrz.nationality ?? fields.nationality;
    fields.dateOfBirth = mrz.dateOfBirth ?? fields.dateOfBirth;
    fields.expiryDate = mrz.expiryDate ?? fields.expiryDate;
    if (mrz.lastName) fieldConfidence.lastName = Math.max(fieldConfidence.lastName ?? 0, 0.9);
    if (mrz.firstName) fieldConfidence.firstName = Math.max(fieldConfidence.firstName ?? 0, 0.9);
    if (documentType === "UNKNOWN") documentType = "NIGERIAN_PASSPORT";
    documentTypeConfidence = Math.max(documentTypeConfidence ?? 0, 0.9);
  } else if (documentType === "NIGERIAN_PASSPORT") {
    warnings.push("The passport MRZ could not be parsed. Confirm all values from the visual zone.");
  }

  const workflowDocumentType = documentType !== "UNKNOWN" ? documentType : (hint ?? "UNKNOWN");
  fields.documentNumber = normaliseDocumentNumber(workflowDocumentType, fields.documentNumber);

  if (quality.blurred === true) warnings.push("The image is partly blurred; verify every field.");
  if (quality.glare === true) warnings.push("Glare was detected; verify every field.");
  if (quality.partial === true) warnings.push("Part of the document is outside the frame.");

  const isTwoSided = TWO_SIDED_DOCUMENTS.includes(workflowDocumentType);
  const backNeeded = side === "FRONT" && isTwoSided && !fields.documentNumber;
  const missingNames = side !== "BACK" && (!fields.firstName || !fields.lastName);
  const missingNumber =
    side === "BACK" || side === "DATA_PAGE"
      ? !fields.documentNumber
      : !fields.documentNumber && !isTwoSided;
  const missingRequired = missingNames || missingNumber;

  if (backNeeded) warnings.push(FAILURE_MESSAGES.BACK_IMAGE_REQUIRED);
  if (missingRequired) warnings.push(FAILURE_MESSAGES.REQUIRED_FIELDS_NOT_FOUND);

  const rawText = typeof payload.rawText === "string" ? payload.rawText : "";
  if (!rawText.trim() && missingRequired) {
    return fail("NO_READABLE_TEXT", requestId, side, startedAt, warnings);
  }

  const failureCategory: OcrFailureCategory | null = backNeeded
    ? "BACK_IMAGE_REQUIRED"
    : missingRequired
      ? "REQUIRED_FIELDS_NOT_FOUND"
      : documentType === "UNKNOWN"
        ? "UNKNOWN_DOCUMENT"
        : null;

  return {
    success: true,
    documentType,
    documentTypeConfidence,
    documentTypeCandidates: candidates.slice(0, 3),
    fields,
    fieldConfidence,
    rawText,
    warnings: Array.from(new Set(warnings)),
    requiresReview: true,
    provider: PROVIDER,
    captureSide: side,
    failureCategory,
    message: failureCategory ? FAILURE_MESSAGES[failureCategory] : null,
    durationMs: Date.now() - startedAt,
    requestId,
  };
}

export const ocrProviderName = PROVIDER;
export const lowConfidenceThreshold = CONFIDENCE.medium;
