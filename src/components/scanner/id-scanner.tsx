import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  RotateCcw,
  ScanLine,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  FORM_DOCUMENT_TYPE,
  hasAnyResult,
  isHighConfidence,
  type ExtractedIdentity,
  type NigerianDocumentType,
} from "@/lib/ocr/nigerian-id-parser";
import { runIdOcr, type OcrProgress } from "@/lib/ocr/ocr-service";

const DEBUG = import.meta.env.VITE_OCR_DEBUG === "true";

const DOC_TYPES: NigerianDocumentType[] = [
  "Nigerian NIN",
  "Nigerian Driver's Licence",
  "Nigerian Passport",
  "Nigerian Permanent Voter Card",
  "Unrecognised Nigerian ID",
];

export interface IdScanResult {
  firstName: string;
  lastName: string;
  /** Value chosen from the visitor form's own document type list, when mappable. */
  formDocumentType: string | null;
  detectedDocumentType: string;
  documentNumber: string;
  confidence: number;
  demo: boolean;
}

type Phase = "camera" | "preview" | "processing" | "review" | "failed";

const selectClass =
  "mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-medium";

function fieldConfidence(value: string, overall: number) {
  if (!value.trim()) return 0;
  return Math.max(0.4, Math.min(1, overall));
}

function ConfidenceBadge({ value, overall }: { value: string; overall: number }) {
  const score = fieldConfidence(value, overall);
  const pct = Math.round(score * 100);
  if (!score) return <Badge variant="destructive">Not found</Badge>;
  return (
    <Badge variant={score >= 0.8 ? "success" : score >= 0.6 ? "gold" : "secondary"}>{pct}%</Badge>
  );
}

export function IdScanner({
  onAccept,
  onCancel,
}: {
  onAccept: (result: IdScanResult) => void;
  onCancel?: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("camera");
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [cameraReady, setCameraReady] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedIdentity | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const demo = false;

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [documentType, setDocumentType] = useState<NigerianDocumentType>("Unrecognised Nigerian ID");

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  // Live viewfinder via MediaDevices — no file picker is used anywhere.
  useEffect(() => {
    if (phase !== "camera") return;
    let cancelled = false;
    (async () => {
      setError(null);
      try {
        if (!navigator.mediaDevices?.getUserMedia) {
          throw new Error("This device or browser does not expose a camera to the app.");
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        setCameraReady(true);
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error && err.name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in the browser to scan documents."
            : err instanceof Error
              ? err.message
              : "Camera unavailable",
        );
      }
    })();
    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, facing]);

  // Nothing is persisted: revoke the in-memory image when the scanner unmounts.
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      stopCamera();
    },
    [stopCamera],
  );

  function reset(to: Phase = "camera") {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setFile(null);
    setPreviewUrl("");
    setResult(null);
    setProgress(null);
    setError(null);
    setShowRaw(false);
    setPhase(to);
  }

  /** Snapshot the live video frame into an image File for the OCR pipeline. */
  async function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) {
      setError("Camera frame not ready yet — hold still and try again.");
      return;
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((res) =>
      canvas.toBlob((b) => res(b), "image/jpeg", 0.95),
    );
    if (!blob) {
      setError("The camera frame could not be captured. Try again.");
      return;
    }
    const captured = new File([blob], `id-capture-${Date.now()}.jpg`, { type: "image/jpeg" });
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(captured);
    objectUrlRef.current = url;
    stopCamera();
    setError(null);
    setFile(captured);
    setPreviewUrl(url);
    setPhase("preview");
  }

  async function usePhoto() {
    if (!file || phase === "processing") return;
    setPhase("processing");
    setError(null);
    setProgress({ stage: "preparing", message: "Preparing image…", percent: 5 });
    try {
      const out = await runIdOcr(file, setProgress);
      setPreviewUrl(out.previewUrl);
      setResult(out);
      setFirstName(out.firstName);
      setLastName(out.lastName);
      setDocumentNumber(out.documentNumber);
      setDocumentType(out.documentType);
      setPhase(hasAnyResult(out) ? "review" : "failed");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "We could not read this document. Please try again.",
      );
      setPhase("failed");
    } finally {
      setProgress(null);
    }
  }

  function accept() {
    onAccept({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      formDocumentType: FORM_DOCUMENT_TYPE[documentType],
      detectedDocumentType: documentType,
      documentNumber: documentNumber.trim(),
      confidence: result?.confidence ?? 0,
      demo,
    });
  }

  const missing = [
    !firstName.trim() && "first name",
    !lastName.trim() && "surname",
    !documentNumber.trim() && "document number",
  ].filter(Boolean) as string[];
  const success = result ? isHighConfidence(result) && missing.length === 0 : false;
  const overall = result?.confidence ?? 0;

  return (
    <div className="space-y-3">
      <canvas ref={canvasRef} className="hidden" />

      {phase === "camera" && (
        <div className="space-y-2.5">
          <div className="relative overflow-hidden rounded-3xl border-2 border-dashed border-primary/40 bg-foreground/90">
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              className="h-64 w-full object-cover"
              aria-label="Live identity document camera"
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
            Fill the frame with the data page of the NIN card, driver&apos;s licence, passport or
            voter card. The frame is read on this device and never stored.
          </p>
          <div className="flex gap-2">
            <Button className="flex-1" disabled={!cameraReady} onClick={capture}>
              <Camera /> Capture frame
            </Button>
            <Button
              variant="secondary"
              size="icon"
              aria-label="Switch camera"
              onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
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
                alt="Captured identity document preview"
                className="max-h-72 w-full object-contain"
              />
            )}
          </div>
          {phase === "processing" ? (
            <div className="space-y-2 rounded-2xl border border-border bg-card p-4 shadow-card">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <Loader2 className="size-4 animate-spin" />
                {progress?.message ?? "Reading document…"}
              </p>
              <Progress value={progress?.percent ?? 10} />
              <p className="text-xs text-muted-foreground">
                On-device reading. Keep this screen open.
              </p>
            </div>
          ) : (
            <>
              <Button size="block" onClick={usePhoto}>
                <CheckCircle2 /> Use photo
              </Button>
              <Button size="block" variant="secondary" onClick={() => reset("camera")}>
                <RotateCcw /> Retake
              </Button>
              {onCancel && (
                <Button
                  size="block"
                  variant="ghost"
                  onClick={() => {
                    reset("camera");
                    onCancel();
                  }}
                >
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
              <AlertTriangle className="size-4" /> We could not read this document
            </p>
            <p className="mt-1 text-xs text-destructive">
              {error ??
                "No readable text was found. Fill the frame with the data page, avoid glare and shadows, then try again."}
            </p>
          </div>
          <Button size="block" onClick={() => reset("camera")}>
            <Camera /> Reopen camera and retake
          </Button>
          {onCancel && (
            <Button size="block" variant="ghost" onClick={onCancel}>
              <X /> Cancel scan
            </Button>
          )}
          {DEBUG && result && (
            <pre className="max-h-40 overflow-auto rounded-xl bg-muted p-3 text-[10px]">
              {result.rawText || "(no text)"}
            </pre>
          )}
        </div>
      )}

      {phase === "review" && (
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

          {success ? (
            <div className="flex items-center gap-2 rounded-2xl border border-success/40 bg-success/10 p-3 text-sm font-bold text-success">
              <CheckCircle2 className="size-4" /> ID details extracted successfully
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-2xl border border-gold/50 bg-gold/10 p-3 text-sm font-bold">
              <AlertTriangle className="size-4" /> Please review the extracted details
              {missing.length > 0 && (
                <span className="font-medium"> — missing {missing.join(", ")}</span>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">{documentType}</Badge>
            <Badge variant="gold">Overall confidence {Math.round(overall * 100)}%</Badge>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label>First name</Label>
                <ConfidenceBadge value={firstName} overall={overall} />
              </div>
              <Input
                className={missing.includes("first name") ? "mt-1.5 border-destructive" : "mt-1.5"}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <div className="flex items-center justify-between gap-2">
                <Label>Last name / surname</Label>
                <ConfidenceBadge value={lastName} overall={overall} />
              </div>
              <Input
                className={missing.includes("surname") ? "mt-1.5 border-destructive" : "mt-1.5"}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Document type</Label>
              <ConfidenceBadge
                value={documentType === "Unrecognised Nigerian ID" ? "" : documentType}
                overall={overall}
              />
            </div>
            <select
              className={selectClass}
              value={documentType}
              onChange={(e) => setDocumentType(e.target.value as NigerianDocumentType)}
            >
              {DOC_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </div>
          <div>
            <div className="flex items-center justify-between gap-2">
              <Label>Document number</Label>
              <ConfidenceBadge value={documentNumber} overall={overall} />
            </div>
            <Input
              className={
                missing.includes("document number") ? "mt-1.5 border-destructive" : "mt-1.5"
              }
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
            />
          </div>

          {result && (
            <div className="rounded-2xl border border-border bg-card">
              <button
                type="button"
                className="flex w-full items-center justify-between p-3 text-xs font-semibold"
                onClick={() => setShowRaw((s) => !s)}
              >
                Raw text read from the document
                <ChevronDown className={showRaw ? "size-4 rotate-180" : "size-4"} />
              </button>
              {showRaw && (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-t border-border p-3 text-[10px] text-muted-foreground">
                  {result.rawText || "(no text)"}
                </pre>
              )}
            </div>
          )}

          {DEBUG && result && (
            <div className="rounded-2xl border border-dashed border-border p-3 text-[11px] text-muted-foreground">
              <p className="font-bold">Debug</p>
              <p>Parser: {result.parser}</p>
              <p>Keywords: {result.matchedKeywords.join(", ") || "none"}</p>
              <p>
                Candidates: {result.firstName || "—"} / {result.lastName || "—"} /{" "}
                {result.documentNumber || "—"}
              </p>
              <p>Confidence: {result.confidence.toFixed(2)}</p>
            </div>
          )}

          <Button size="block" onClick={accept}>
            Accept and populate form
          </Button>
          <Button size="block" variant="secondary" onClick={() => reset("camera")}>
            <RotateCcw /> Retake photo
          </Button>
          {onCancel && (
            <Button
              size="block"
              variant="ghost"
              onClick={() => {
                reset("camera");
                onCancel();
              }}
            >
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