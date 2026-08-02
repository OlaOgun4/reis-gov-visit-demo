import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanLine,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  CONFIDENCE,
  DOCUMENT_TYPES,
  DOCUMENT_TYPE_LABELS,
  TWO_SIDED_DOCUMENTS,
  emptyFields,
  mergeSides,
  type CaptureSide,
  type DocumentType,
  type IdentityOcrResult,
  type OcrFieldConfidence,
} from "@/lib/ocr/ocr-types";
import { scanIdentityDocument } from "@/lib/ocr/scan-identity-document";

const DEBUG = import.meta.env.VITE_OCR_DEBUG === "true";

/**
 * Default values returned to the existing visitor form. Override with the
 * toFormDocumentType prop if that form uses different option values.
 */
const DEFAULT_FORM_DOCUMENT_TYPE: Record<DocumentType, string | null> = {
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
  UNKNOWN: null,
};

export interface IdScanResult {
  firstName: string;
  lastName: string;
  middleName: string;
  formDocumentType: string | null;
  documentTypeCode: DocumentType;
  detectedDocumentType: string;
  documentNumber: string;
  confidence: number;
  fieldConfidence: OcrFieldConfidence;
  captureSide: CaptureSide;
  demo: false;
}

type Phase = "camera" | "preview" | "processing" | "review" | "failed";

type ProgressState = {
  message: string;
  percent: number;
};

const selectClass =
  "mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-medium";

function requiredSide(documentType: DocumentType): CaptureSide {
  return documentType === "NIGERIAN_PASSPORT" ? "DATA_PAGE" : "FRONT";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      const comma = result.indexOf(",");
      if (comma < 0 || !result.slice(comma + 1)) {
        reject(new Error("The captured image could not be encoded."));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("The captured image could not be prepared."));
    reader.readAsDataURL(file);
  });
}

function confidenceAverage(confidence: OcrFieldConfidence) {
  const values = [confidence.firstName, confidence.lastName, confidence.documentNumber].filter(
    (value): value is number => value != null,
  );
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function ConfidenceBadge({ value, confidence }: { value: string; confidence: number | null }) {
  if (!value.trim() || confidence == null) return <Badge variant="destructive">Review</Badge>;
  const percent = Math.round(confidence * 100);
  return (
    <Badge
      variant={
        confidence >= CONFIDENCE.high
          ? "success"
          : confidence >= CONFIDENCE.medium
            ? "gold"
            : "destructive"
      }
    >
      {percent}%
    </Badge>
  );
}

function resultError(result: IdentityOcrResult) {
  return (
    result.message ??
    "The identity document could not be read. Capture it again or enter it manually."
  );
}

export function IdScanner({
  onAccept,
  onCancel,
  initialDocumentType = "UNKNOWN",
  toFormDocumentType = (type) => DEFAULT_FORM_DOCUMENT_TYPE[type],
}: {
  onAccept: (result: IdScanResult) => void;
  onCancel?: () => void;
  initialDocumentType?: DocumentType;
  toFormDocumentType?: (type: DocumentType) => string | null;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("camera");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [cameraReady, setCameraReady] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const [progress, setProgress] = useState<ProgressState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IdentityOcrResult | null>(null);
  const [frontResult, setFrontResult] = useState<IdentityOcrResult | null>(null);

  const [documentType, setDocumentType] = useState<DocumentType>(initialDocumentType);
  const [captureSide, setCaptureSide] = useState<CaptureSide>(requiredSide(initialDocumentType));
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  const revokePreview = useCallback(() => {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
  }, []);

  useEffect(() => {
    if (phase !== "camera") return;
    let cancelled = false;

    void (async () => {
      setError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This device or browser does not expose a camera to the app.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: facing,
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch (caught) {
        if (cancelled) return;
        setError(
          caught instanceof Error && caught.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access to scan the document."
            : caught instanceof Error
              ? caught.message
              : "The camera is unavailable.",
        );
      }
    })();

    return () => {
      cancelled = true;
      stopCamera();
    };
  }, [facing, phase, stopCamera]);

  useEffect(
    () => () => {
      revokePreview();
      stopCamera();
    },
    [revokePreview, stopCamera],
  );

  function clearCapture() {
    revokePreview();
    setFile(null);
    setPreviewUrl("");
    setResult(null);
    setProgress(null);
    setError(null);
  }

  function resetScanner(options?: { preserveFront?: boolean; side?: CaptureSide }) {
    clearCapture();
    if (!options?.preserveFront) setFrontResult(null);
    if (options?.side) setCaptureSide(options.side);
    setPhase("camera");
  }

  function changeDocumentType(next: DocumentType) {
    setDocumentType(next);
    setCaptureSide(requiredSide(next));
    setFrontResult(null);
  }

  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      setError("The camera frame is not ready. Hold still and try again.");
      return;
    }

    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("The camera frame could not be prepared.");
      return;
    }
    context.drawImage(video, 0, 0, canvas.width, canvas.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.95),
    );
    if (!blob) {
      setError("The camera frame could not be captured. Try again.");
      return;
    }

    const captured = new File([blob], `identity-${captureSide.toLowerCase()}-${Date.now()}.jpg`, {
      type: "image/jpeg",
    });
    revokePreview();
    const url = URL.createObjectURL(captured);
    objectUrlRef.current = url;
    stopCamera();
    setFile(captured);
    setPreviewUrl(url);
    setError(null);
    setPhase("preview");
  }

  function populateReview(next: IdentityOcrResult) {
    setResult(next);
    setFirstName(next.fields.firstName ?? "");
    setMiddleName(next.fields.middleName ?? "");
    setLastName(next.fields.lastName ?? "");
    setDocumentNumber(next.fields.documentNumber ?? "");
    setDocumentType(
      next.documentType && next.documentType !== "UNKNOWN" ? next.documentType : documentType,
    );
    setPhase("review");
  }

  async function processPhoto() {
    if (!file || phase === "processing") return;
    setPhase("processing");
    setError(null);
    setProgress({ message: "Preparing secure scan…", percent: 10 });

    try {
      const imageBase64 = await fileToBase64(file);
      setProgress({ message: "Reading identity document…", percent: 45 });
      const scanned = await scanIdentityDocument({
        data: {
          imageBase64,
          mimeType: file.type,
          captureSide,
          selectedHint: documentType === "UNKNOWN" ? null : documentType,
        },
      });
      setProgress({ message: "Preparing results for review…", percent: 90 });

      if (!scanned.success) {
        setResult(scanned);
        setError(resultError(scanned));
        setPhase("failed");
        return;
      }

      const combined = frontResult ? mergeSides(frontResult, scanned) : scanned;
      populateReview(combined);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The identity scan could not be completed. Try again or enter the details manually.",
      );
      setPhase("failed");
    } finally {
      setProgress(null);
    }
  }

  function continueManually() {
    const manualResult: IdentityOcrResult = {
      success: true,
      documentType,
      documentTypeConfidence: null,
      documentTypeCandidates: [],
      fields: { ...emptyFields },
      fieldConfidence: { firstName: null, lastName: null, documentNumber: null },
      rawText: "",
      warnings: ["Identity details are being entered manually by the reception officer."],
      requiresReview: true,
      provider: "manual-entry",
      captureSide,
      failureCategory: "REQUIRED_FIELDS_NOT_FOUND",
      message: "Complete and verify all required fields before accepting.",
      durationMs: 0,
      requestId: "manual-entry",
    };
    setError(null);
    populateReview(frontResult ? mergeSides(frontResult, manualResult) : manualResult);
    setFrontResult(null);
  }

  function beginBackCapture() {
    if (!result) return;
    setFrontResult(result);
    resetScanner({ preserveFront: true, side: "BACK" });
  }

  function retrySameFrame() {
    if (!file || phase === "processing") return;
    setResult(null);
    setFirstName("");
    setMiddleName("");
    setLastName("");
    setDocumentNumber("");
    void processPhoto();
  }

  function accept() {
    if (!result || missing.length) return;
    const selectedType = documentType;
    onAccept({
      firstName: firstName.trim(),
      middleName: middleName.trim(),
      lastName: lastName.trim(),
      formDocumentType: toFormDocumentType(selectedType),
      documentTypeCode: selectedType,
      detectedDocumentType: DOCUMENT_TYPE_LABELS[selectedType],
      documentNumber: documentNumber.trim(),
      confidence: confidenceAverage(result.fieldConfidence),
      fieldConfidence: result.fieldConfidence,
      captureSide: result.captureSide,
      demo: false,
    });
  }

  const missing = useMemo(
    () =>
      [
        !firstName.trim() && "first name",
        !lastName.trim() && "surname",
        !documentNumber.trim() && "document number",
        documentType === "UNKNOWN" && "document type",
      ].filter(Boolean) as string[],
    [documentNumber, documentType, firstName, lastName],
  );

  const canCaptureBack =
    captureSide === "FRONT" && TWO_SIDED_DOCUMENTS.includes(documentType) && Boolean(result);
  const fullyExtracted = Boolean(result?.success) && missing.length === 0;

  return (
    <div className="space-y-3">
      <canvas ref={canvasRef} className="hidden" />

      {phase === "camera" && (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between rounded-xl border border-border bg-card px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">Capture required</span>
            <Badge variant="secondary">
              {captureSide === "DATA_PAGE" ? "Passport data page" : captureSide.toLowerCase()}
            </Badge>
          </div>

          <div className="relative overflow-hidden rounded-3xl border-2 border-dashed border-primary/40 bg-foreground/90">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-64 w-full object-cover"
              aria-label="Live identity-document camera"
            />
            <div className="pointer-events-none absolute inset-4 rounded-2xl border-2 border-primary-foreground/60" />
            <div className="pointer-events-none absolute inset-x-4 bottom-4">
              <Badge variant={cameraReady ? "success" : "secondary"}>
                {cameraReady ? "Camera live" : "Starting camera…"}
              </Badge>
            </div>
            {!cameraReady && (
              <div className="absolute inset-0 grid place-items-center text-primary-foreground">
                <ScanLine className="size-10 animate-pulse" />
              </div>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            Fill the frame with the document and make all four corners visible. The captured image
            is securely processed for identity extraction and is not saved to the visitor record.
          </p>

          <div className="flex gap-2">
            <Button className="flex-1" disabled={!cameraReady} onClick={capture}>
              <Camera /> Capture{" "}
              {captureSide === "DATA_PAGE" ? "data page" : captureSide.toLowerCase()}
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              aria-label="Switch camera"
              onClick={() =>
                setFacing((current) => (current === "environment" ? "user" : "environment"))
              }
            >
              <RefreshCw />
            </Button>
          </div>

          {onCancel && (
            <Button size="block" variant="ghost" onClick={onCancel}>
              <X /> Cancel
            </Button>
          )}
        </div>
      )}

      {(phase === "preview" || phase === "processing") && (
        <div className="space-y-2.5">
          <div className="overflow-hidden rounded-3xl border border-border bg-foreground/90">
            {previewUrl && (
              <img
                src={previewUrl}
                alt={`Captured identity document ${captureSide.toLowerCase()}`}
                className="max-h-72 w-full object-contain"
              />
            )}
          </div>

          {phase === "processing" ? (
            <div className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-card">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Loader2 className="size-4 animate-spin" />
                {progress?.message ?? "Reading identity document…"}
              </p>
              <Progress value={progress?.percent ?? 10} />
              <p className="text-xs text-muted-foreground">
                Keep this screen open until the review appears.
              </p>
            </div>
          ) : (
            <>
              <Button size="block" onClick={processPhoto}>
                <CheckCircle2 /> Use photo
              </Button>
              <Button
                size="block"
                variant="secondary"
                onClick={() =>
                  resetScanner({ preserveFront: Boolean(frontResult), side: captureSide })
                }
              >
                <RotateCcw /> Retake
              </Button>
              {onCancel && (
                <Button size="block" variant="ghost" onClick={onCancel}>
                  <X /> Cancel
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {phase === "failed" && (
        <div className="space-y-2.5">
          <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-4">
            <p className="flex items-center gap-2 text-sm font-bold text-destructive">
              <AlertTriangle className="size-4" /> We could not complete this scan
            </p>
            <p className="mt-1 text-xs text-destructive">
              {error ?? "Capture the document again or continue with verified manual entry."}
            </p>
          </div>
          <Button
            size="block"
            onClick={() => resetScanner({ preserveFront: Boolean(frontResult), side: captureSide })}
          >
            <Camera /> Reopen camera and retake
          </Button>
          <Button size="block" variant="secondary" onClick={continueManually}>
            Continue with manual entry
          </Button>
          {onCancel && (
            <Button size="block" variant="ghost" onClick={onCancel}>
              <X /> Cancel scan
            </Button>
          )}
        </div>
      )}

      {phase === "review" && result && (
        <div className="space-y-3">
          {previewUrl && (
            <div className="overflow-hidden rounded-3xl border border-border bg-foreground/90">
              <img
                src={previewUrl}
                alt="Scanned identity document"
                className="max-h-52 w-full object-contain"
              />
            </div>
          )}

          {fullyExtracted ? (
            <div className="flex items-center gap-2 rounded-2xl border border-success/40 bg-success/10 p-3 text-sm font-bold text-success">
              <CheckCircle2 className="size-4" /> Details extracted — officer verification required
            </div>
          ) : (
            <div className="rounded-2xl border border-gold/50 bg-gold/10 p-3 text-sm font-bold">
              <p className="flex items-center gap-2">
                <AlertTriangle className="size-4" /> Review and complete the extracted details
              </p>
              {missing.length > 0 && (
                <p className="mt-1 text-xs font-medium">Missing: {missing.join(", ")}</p>
              )}
            </div>
          )}

          {result.warnings.length > 0 && (
            <div className="rounded-2xl border border-gold/40 bg-gold/5 p-3 text-xs">
              <ul className="list-disc space-y-1 pl-4">
                {result.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="ocr-first-name">First name</Label>
                <ConfidenceBadge value={firstName} confidence={result.fieldConfidence.firstName} />
              </div>
              <Input
                id="ocr-first-name"
                className={!firstName.trim() ? "mt-1.5 border-destructive" : "mt-1.5"}
                value={firstName}
                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                  setFirstName(event.target.value)
                }
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="ocr-last-name">Last name / surname</Label>
                <ConfidenceBadge value={lastName} confidence={result.fieldConfidence.lastName} />
              </div>
              <Input
                id="ocr-last-name"
                className={!lastName.trim() ? "mt-1.5 border-destructive" : "mt-1.5"}
                value={lastName}
                onChange={(event: ChangeEvent<HTMLInputElement>) => setLastName(event.target.value)}
              />
            </div>
          </div>

          <div>
            <Label htmlFor="ocr-middle-name">Middle name (optional)</Label>
            <Input
              id="ocr-middle-name"
              className="mt-1.5"
              value={middleName}
              onChange={(event: ChangeEvent<HTMLInputElement>) => setMiddleName(event.target.value)}
            />
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ocr-document-type">Document type</Label>
              <ConfidenceBadge
                value={documentType === "UNKNOWN" ? "" : documentType}
                confidence={result.documentTypeConfidence}
              />
            </div>
            <select
              id="ocr-document-type"
              className={
                documentType === "UNKNOWN" ? `${selectClass} border-destructive` : selectClass
              }
              value={documentType}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                setDocumentType(event.target.value as DocumentType)
              }
            >
              {DOCUMENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {DOCUMENT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="ocr-document-number">Document number</Label>
              <ConfidenceBadge
                value={documentNumber}
                confidence={result.fieldConfidence.documentNumber}
              />
            </div>
            <Input
              id="ocr-document-number"
              className={!documentNumber.trim() ? "mt-1.5 border-destructive" : "mt-1.5"}
              value={documentNumber}
              onChange={(event: ChangeEvent<HTMLInputElement>) =>
                setDocumentNumber(event.target.value)
              }
            />
          </div>

          {DEBUG && (
            <div className="rounded-2xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
              <p className="font-bold">OCR diagnostics</p>
              <p>Provider: {result.provider}</p>
              <p>Request: {result.requestId}</p>
              <p>Duration: {result.durationMs} ms</p>
              <p>Outcome: {result.failureCategory ?? "COMPLETE"}</p>
            </div>
          )}

          <Button size="block" onClick={accept} disabled={missing.length > 0}>
            Accept verified details and populate form
          </Button>

          {canCaptureBack && (
            <Button size="block" variant="secondary" onClick={beginBackCapture}>
              <Camera /> Scan back and merge results
            </Button>
          )}

          <Button size="block" variant="secondary" onClick={retrySameFrame} disabled={!file}>
            <RefreshCw /> Re-run scan on this frame
          </Button>
          <Button
            size="block"
            variant="secondary"
            onClick={() => resetScanner({ preserveFront: Boolean(frontResult), side: captureSide })}
          >
            <RotateCcw /> Retake photo
          </Button>
          {onCancel && (
            <Button size="block" variant="ghost" onClick={onCancel}>
              <X /> Cancel scan
            </Button>
          )}
        </div>
      )}

      {error && phase !== "failed" && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
