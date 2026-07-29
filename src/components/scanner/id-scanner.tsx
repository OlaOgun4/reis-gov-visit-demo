import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RotateCcw,
  Upload,
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
import { MAX_IMAGE_BYTES, isSupportedImage } from "@/lib/ocr/image-preprocessor";
import { runIdOcr, type OcrProgress } from "@/lib/ocr/ocr-service";

const DEBUG = import.meta.env.VITE_OCR_DEBUG === "true";
const DEMO_FALLBACK = import.meta.env.VITE_OCR_DEMO_FALLBACK === "true";

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

type Phase = "choose" | "preview" | "processing" | "review" | "failed";

const selectClass =
  "mt-1.5 h-11 w-full rounded-xl border border-input bg-background px-3 text-sm font-medium";

export function IdScanner({
  onAccept,
  onCancel,
}: {
  onAccept: (result: IdScanResult) => void;
  onCancel?: () => void;
}) {
  const cameraRef = useRef<HTMLInputElement | null>(null);
  const uploadRef = useRef<HTMLInputElement | null>(null);
  const objectUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("choose");
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [progress, setProgress] = useState<OcrProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractedIdentity | null>(null);
  const [demo, setDemo] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [documentType, setDocumentType] = useState<NigerianDocumentType>("Unrecognised Nigerian ID");

  // Nothing is persisted: revoke the in-memory image when the scanner unmounts.
  useEffect(
    () => () => {
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    },
    [],
  );

  function reset(to: Phase = "choose") {
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    objectUrlRef.current = null;
    setFile(null);
    setPreviewUrl("");
    setResult(null);
    setProgress(null);
    setError(null);
    setDemo(false);
    setShowRaw(false);
    setPhase(to);
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = "";
    if (!picked) return;
    if (!isSupportedImage(picked)) {
      setError("That file type is not supported. Choose a photo (JPG, PNG or HEIC).");
      return;
    }
    if (picked.size > MAX_IMAGE_BYTES) {
      setError("That image is too large. Take a new photo or choose a smaller file.");
      return;
    }
    if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    const url = URL.createObjectURL(picked);
    objectUrlRef.current = url;
    setError(null);
    setFile(picked);
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
      setDemo(false);
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

  function loadDemoRecord() {
    setFirstName("Adebayo");
    setLastName("Okafor");
    setDocumentNumber("12345678901");
    setDocumentType("Nigerian NIN");
    setDemo(true);
    setPhase("review");
  }

  function accept() {
    onAccept({
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      formDocumentType: FORM_DOCUMENT_TYPE[documentType],
      detectedDocumentType: documentType,
      documentNumber: documentNumber.trim(),
      confidence: demo ? 0 : (result?.confidence ?? 0),
      demo,
    });
  }

  const missing = [
    !firstName.trim() && "first name",
    !lastName.trim() && "surname",
    !documentNumber.trim() && "document number",
  ].filter(Boolean) as string[];
  const success = result ? isHighConfidence(result) && missing.length === 0 && !demo : false;

  return (
    <div className="space-y-3">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPick}
      />
      <input ref={uploadRef} type="file" accept="image/*" className="hidden" onChange={onPick} />

      {phase === "choose" && (
        <div className="space-y-2.5">
          <div className="grid place-items-center gap-2 rounded-3xl border-2 border-dashed border-primary/40 bg-muted/40 p-8 text-center">
            <Camera className="size-8 text-primary" />
            <p className="text-sm font-semibold">Scan a Nigerian identity document</p>
            <p className="text-xs text-muted-foreground">
              NIN slip or card, driver&apos;s licence, passport or voter card. The image is read on
              this device and never stored.
            </p>
          </div>
          <Button size="block" onClick={() => cameraRef.current?.click()}>
            <Camera /> Take photo
          </Button>
          <Button size="block" variant="secondary" onClick={() => uploadRef.current?.click()}>
            <Upload /> Upload ID image
          </Button>
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
              <Button size="block" variant="secondary" onClick={() => reset("choose")}>
                <RotateCcw /> Retake
              </Button>
              {onCancel && (
                <Button
                  size="block"
                  variant="ghost"
                  onClick={() => {
                    reset("choose");
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
          <Button size="block" onClick={() => cameraRef.current?.click()}>
            <Camera /> Retake photo
          </Button>
          <Button size="block" variant="secondary" onClick={() => uploadRef.current?.click()}>
            <Upload /> Upload another image
          </Button>
          {DEMO_FALLBACK && result && (
            <Button size="block" variant="outline" onClick={loadDemoRecord}>
              Load demonstration result
            </Button>
          )}
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

          {demo ? (
            <div className="rounded-2xl border border-gold/50 bg-gold/10 p-3 text-xs font-bold">
              Demonstration fallback data — not extracted from the document
            </div>
          ) : success ? (
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
            {!demo && (
              <Badge variant="gold">
                Confidence {Math.round((result?.confidence ?? 0) * 100)}%
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>First name</Label>
              <Input
                className={missing.includes("first name") ? "mt-1.5 border-destructive" : "mt-1.5"}
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
              />
            </div>
            <div>
              <Label>Last name / surname</Label>
              <Input
                className={missing.includes("surname") ? "mt-1.5 border-destructive" : "mt-1.5"}
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label>Document type</Label>
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
            <Label>Document number</Label>
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
          <Button size="block" variant="secondary" onClick={() => reset("choose")}>
            <RotateCcw /> Retake photo
          </Button>
          {onCancel && (
            <Button
              size="block"
              variant="ghost"
              onClick={() => {
                reset("choose");
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