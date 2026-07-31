import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import {
  OCR_ALLOWED_MIME_TYPES,
  OCR_MAX_IMAGE_BYTES,
  isCaptureSide,
  isDocumentType,
  type CaptureSide,
  type DocumentType,
  type IdentityOcrResult,
} from "./ocr-types";

export type ScanRequest = {
  /** Raw Base64 only; do not include a data-URL prefix. */
  imageBase64: string;
  mimeType: string;
  captureSide: CaptureSide;
  selectedHint?: DocumentType | null;
};

type AuthenticatedServerContext = {
  userId: string;
  supabase: SupabaseClient<Database>;
};

function decodedByteLength(base64: string) {
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

/** Runtime validation at the authenticated server boundary. */
function validateScanRequest(value: unknown): ScanRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid identity scan request.");
  }

  const input = value as Record<string, unknown>;
  const imageBase64 = typeof input.imageBase64 === "string" ? input.imageBase64 : "";
  const mimeType = typeof input.mimeType === "string" ? input.mimeType.toLowerCase() : "";
  const captureSide = input.captureSide;
  const selectedHint = input.selectedHint;

  if (!imageBase64 || imageBase64.startsWith("data:")) {
    throw new Error("The captured image is missing or incorrectly encoded.");
  }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(imageBase64)) {
    throw new Error("The captured image is not valid Base64 data.");
  }
  if (decodedByteLength(imageBase64) > OCR_MAX_IMAGE_BYTES) {
    throw new Error("The captured image exceeds the 8 MB limit.");
  }
  if (!(OCR_ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    throw new Error("Unsupported image type.");
  }
  if (!isCaptureSide(captureSide) || captureSide === "UNKNOWN") {
    throw new Error("A valid document capture side is required.");
  }
  if (selectedHint != null && !isDocumentType(selectedHint)) {
    throw new Error("The selected document type is invalid.");
  }

  return {
    imageBase64,
    mimeType,
    captureSide,
    selectedHint: selectedHint == null ? null : selectedHint,
  };
}

/**
 * Authenticated OCR entry point. Images are processed in memory and are never
 * included in the visitor record, application audit event or server logs.
 */
export const scanIdentityDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator(validateScanRequest)
  .handler(
    async ({
      data,
      context,
    }: {
      data: ScanRequest;
      context: AuthenticatedServerContext;
    }): Promise<IdentityOcrResult> => {
      const { extractIdentityDocument } = await import("./ocr.server");

      const result = await extractIdentityDocument(data);
      const event = result.success ? "IDENTITY_DOCUMENT_SCANNED" : "IDENTITY_DOCUMENT_SCAN_FAILED";

      try {
        const { error: auditError } = await context.supabase.from("audit_logs").insert({
          actor_id: context.userId,
          actor_name: "Reception officer",
          event,
          // Deliberately excludes image data, raw OCR text and document number.
          record_ref: `${result.documentType ?? "UNKNOWN"} · ${result.captureSide} · ${result.durationMs}ms · ${result.requestId}`,
          status: result.success ? "Success" : "Failed",
        });
        if (auditError) throw auditError;
      } catch (error) {
        // Protected server telemetry only. Never include identity values here.
        console.error("[GovVisit] Identity-scan audit write failed", {
          requestId: result.requestId,
          event,
          errorType: error instanceof Error ? error.name : "UnknownError",
        });
      }

      return result;
    },
  );
