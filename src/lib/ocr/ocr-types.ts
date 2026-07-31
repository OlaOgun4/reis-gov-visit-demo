/**
 * GovVisit identity-document OCR contract.
 *
 * This module is client-safe and is shared by the reception scanner UI,
 * authenticated server function and server-only OCR provider.
 */

export const DOCUMENT_TYPES = [
  "NIGERIAN_PASSPORT",
  "NIN_SLIP",
  "NATIONAL_ID_CARD",
  "NIGERIAN_DRIVERS_LICENCE",
  "PERMANENT_VOTERS_CARD",
  "RESIDENCE_PERMIT",
  "ECOWAS_IDENTITY_DOCUMENT",
  "GOVERNMENT_STAFF_ID",
  "MILITARY_SERVICE_ID",
  "OTHER_GOVERNMENT_ID",
  "UNKNOWN",
] as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  NIGERIAN_PASSPORT: "Nigerian International Passport",
  NIN_SLIP: "National Identity Number slip",
  NATIONAL_ID_CARD: "National Identity Card",
  NIGERIAN_DRIVERS_LICENCE: "Nigerian Driver's Licence",
  PERMANENT_VOTERS_CARD: "Permanent Voter's Card",
  RESIDENCE_PERMIT: "Residence Permit (CERPAC)",
  ECOWAS_IDENTITY_DOCUMENT: "ECOWAS identity or travel document",
  GOVERNMENT_STAFF_ID: "Government staff identity card",
  MILITARY_SERVICE_ID: "Military or service identity card",
  OTHER_GOVERNMENT_ID: "Other government-issued identity document",
  UNKNOWN: "Unknown document",
};

/** Documents whose reverse side can contain identity or document-number data. */
export const TWO_SIDED_DOCUMENTS: readonly DocumentType[] = [
  "NATIONAL_ID_CARD",
  "NIGERIAN_DRIVERS_LICENCE",
  "PERMANENT_VOTERS_CARD",
  "GOVERNMENT_STAFF_ID",
  "MILITARY_SERVICE_ID",
  "RESIDENCE_PERMIT",
];

export const CAPTURE_SIDES = ["FRONT", "BACK", "DATA_PAGE", "UNKNOWN"] as const;
export type CaptureSide = (typeof CAPTURE_SIDES)[number];

export const OCR_ALLOWED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;

export const OCR_MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export type OcrFields = {
  firstName: string | null;
  middleName: string | null;
  lastName: string | null;
  documentNumber: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  issueDate: string | null;
  expiryDate: string | null;
  issuingAuthority: string | null;
};

export type OcrFieldConfidence = {
  firstName: number | null;
  lastName: number | null;
  documentNumber: number | null;
};

export type OcrFailureCategory =
  | "NO_IMAGE"
  | "UNSUPPORTED_FILE_TYPE"
  | "FILE_TOO_LARGE"
  | "NO_DOCUMENT_DETECTED"
  | "IMAGE_TOO_BLURRED"
  | "IMAGE_GLARE"
  | "SERVICE_UNAVAILABLE"
  | "TIMEOUT"
  | "NO_READABLE_TEXT"
  | "UNKNOWN_DOCUMENT"
  | "REQUIRED_FIELDS_NOT_FOUND"
  | "FRONT_IMAGE_REQUIRED"
  | "BACK_IMAGE_REQUIRED"
  | "PROVIDER_NOT_CONFIGURED"
  | "RATE_LIMITED";

export type IdentityOcrResult = {
  /** True when the recognition request completed, including partial extraction. */
  success: boolean;
  documentType: DocumentType | null;
  documentTypeConfidence: number | null;
  documentTypeCandidates: DocumentType[];
  fields: OcrFields;
  fieldConfidence: OcrFieldConfidence;
  rawText: string;
  warnings: string[];
  /** GovVisit always requires an officer to review extracted identity data. */
  requiresReview: boolean;
  provider: string;
  captureSide: CaptureSide;
  /** Can describe a partial/review outcome even when success is true. */
  failureCategory: OcrFailureCategory | null;
  message: string | null;
  durationMs: number;
  requestId: string;
};

export const CONFIDENCE = {
  high: 0.85,
  medium: 0.6,
  documentType: 0.6,
} as const;

export type FieldState = "extracted" | "review" | "manual";

export function fieldState(value: string | null, confidence: number | null): FieldState {
  if (!value) return "manual";
  if (confidence != null && confidence >= CONFIDENCE.high) return "extracted";
  if (confidence != null && confidence >= CONFIDENCE.medium) return "review";
  return "manual";
}

export const emptyFields: OcrFields = {
  firstName: null,
  middleName: null,
  lastName: null,
  documentNumber: null,
  nationality: null,
  dateOfBirth: null,
  issueDate: null,
  expiryDate: null,
  issuingAuthority: null,
};

export const FAILURE_MESSAGES: Record<OcrFailureCategory, string> = {
  NO_IMAGE: "No image was supplied. Capture the identity document and try again.",
  UNSUPPORTED_FILE_TYPE: "That image type is not supported. Use JPEG, PNG, WebP, HEIC or HEIF.",
  FILE_TOO_LARGE: "The image is too large. Capture it again at a lower resolution.",
  NO_DOCUMENT_DETECTED: "No identity document was detected. Ensure all four corners are visible.",
  IMAGE_TOO_BLURRED: "The image is too blurred to read. Hold the device steady and capture again.",
  IMAGE_GLARE: "Glare is obscuring the document. Tilt it away from the light and capture again.",
  SERVICE_UNAVAILABLE:
    "The identity-recognition service is unavailable. Retry or use manual entry.",
  TIMEOUT: "The identity-recognition request timed out. Retry or use manual entry.",
  NO_READABLE_TEXT: "No readable text was found. Move closer, improve the lighting and try again.",
  UNKNOWN_DOCUMENT: "The document type could not be confirmed. Select it manually.",
  REQUIRED_FIELDS_NOT_FOUND: "Some required fields could not be read. Complete them manually.",
  FRONT_IMAGE_REQUIRED: "Capture the front of the document.",
  BACK_IMAGE_REQUIRED: "Capture the reverse side to obtain the remaining document details.",
  PROVIDER_NOT_CONFIGURED: "No identity-recognition provider is configured. Use manual entry.",
  RATE_LIMITED: "Too many recognition requests were made. Wait briefly and retry.",
};

export function isDocumentType(value: unknown): value is DocumentType {
  return typeof value === "string" && (DOCUMENT_TYPES as readonly string[]).includes(value);
}

export function isCaptureSide(value: unknown): value is CaptureSide {
  return typeof value === "string" && (CAPTURE_SIDES as readonly string[]).includes(value);
}

export function maskNumber(value: string | null | undefined) {
  if (!value) return "—";
  if (value.length <= 5) return "•••";
  return `${value.slice(0, 3)}•••••${value.slice(-2)}`;
}

/** Merge two captured sides, preferring values with stronger field confidence. */
export function mergeSides(primary: IdentityOcrResult, secondary: IdentityOcrResult) {
  const fields: OcrFields = { ...primary.fields };
  const fieldConfidence: OcrFieldConfidence = { ...primary.fieldConfidence };
  const conflicts: string[] = [];

  (Object.keys(fields) as (keyof OcrFields)[]).forEach((key) => {
    const first = primary.fields[key];
    const second = secondary.fields[key];
    if (!second) return;

    if (!first) {
      fields[key] = second;
      if (key in fieldConfidence) {
        const confidenceKey = key as keyof OcrFieldConfidence;
        fieldConfidence[confidenceKey] = secondary.fieldConfidence[confidenceKey];
      }
      return;
    }

    if (first.trim().toUpperCase() === second.trim().toUpperCase()) return;
    conflicts.push(key);

    if (key in fieldConfidence) {
      const confidenceKey = key as keyof OcrFieldConfidence;
      const firstScore = fieldConfidence[confidenceKey] ?? 0;
      const secondScore = secondary.fieldConfidence[confidenceKey] ?? 0;
      if (secondScore > firstScore) {
        fields[key] = second;
        fieldConfidence[confidenceKey] = secondary.fieldConfidence[confidenceKey];
      }
    }
  });

  const documentType =
    primary.documentType && primary.documentType !== "UNKNOWN"
      ? primary.documentType
      : secondary.documentType;
  const missingRequired = !fields.firstName || !fields.lastName || !fields.documentNumber;
  const failureCategory: OcrFailureCategory | null = missingRequired
    ? "REQUIRED_FIELDS_NOT_FOUND"
    : !documentType || documentType === "UNKNOWN"
      ? "UNKNOWN_DOCUMENT"
      : null;

  return {
    ...primary,
    success: primary.success || secondary.success,
    documentType,
    documentTypeConfidence: Math.max(
      primary.documentTypeConfidence ?? 0,
      secondary.documentTypeConfidence ?? 0,
    ),
    documentTypeCandidates: Array.from(
      new Set([...primary.documentTypeCandidates, ...secondary.documentTypeCandidates]),
    ).slice(0, 3),
    fields,
    fieldConfidence,
    rawText: `${primary.rawText}\n${secondary.rawText}`.trim(),
    warnings: Array.from(
      new Set([
        ...primary.warnings,
        ...secondary.warnings,
        ...conflicts.map(
          (field) => `The front and back disagree on ${field}. Confirm the correct value.`,
        ),
      ]),
    ),
    requiresReview: true,
    failureCategory,
    message: failureCategory ? FAILURE_MESSAGES[failureCategory] : null,
    durationMs: primary.durationMs + secondary.durationMs,
  } satisfies IdentityOcrResult;
}
