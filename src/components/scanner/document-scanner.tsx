import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RefreshCw, ScanLine, Zap, ZapOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { parseCodePayload, parseScannedText, type ParsedIdentity } from "@/lib/mrz";

type ZXingReader = {
  decodeFromVideoElement: (
    video: HTMLVideoElement,
    cb: (result: { getText: () => string } | undefined) => void,
  ) => Promise<{ stop: () => void }>;
};

export interface ScannerProps {
  /** "document" runs OCR/MRZ on capture and live 1D/2D code reading. "code" only reads codes. */
  mode?: "document" | "code";
  onIdentity?: (identity: ParsedIdentity) => void;
  /** Raw payload of any barcode/QR read (pass codes, ID barcodes). */
  onCode?: (text: string) => void;
  hint?: string;
}

export function DocumentScanner({ mode = "document", onIdentity, onCode, hint }: ScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const workerRef = useRef<{
    recognize: (img: unknown) => Promise<{ data: { text: string } }>;
    terminate: () => Promise<unknown>;
  } | null>(null);
  const seenRef = useRef<string>("");

  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string>("");
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setReady(false);
  }, []);

  // Live camera + continuous barcode / QR decoding.
  useEffect(() => {
    let cancelled = false;

    async function start() {
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
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (video) {
          video.srcObject = stream;
          await video.play().catch(() => undefined);
        }
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        setTorchAvailable(Boolean(caps.torch));
        setReady(true);

        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        if (cancelled) return;
        const reader = new BrowserMultiFormatReader() as unknown as ZXingReader;
        controlsRef.current = await reader.decodeFromVideoElement(video!, (result) => {
          if (!result) return;
          const text = result.getText();
          if (!text || text === seenRef.current) return;
          seenRef.current = text;
          onCode?.(text);
          const identity = parseCodePayload(text);
          if (identity && onIdentity) onIdentity(identity);
          setTimeout(() => (seenRef.current = ""), 2500);
        });
      } catch (err) {
        if (cancelled) return;
        setError(
          err instanceof Error
            ? err.name === "NotAllowedError"
              ? "Camera permission was denied. Allow camera access in the browser to scan documents."
              : err.message
            : "Camera unavailable",
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      stopCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as unknown as MediaTrackConstraintSet],
      } as MediaTrackConstraints);
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }

  function grabFrame(scale = 1) {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || !video.videoWidth) return null;
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    // Grayscale + contrast stretch materially improves OCR on ID documents.
    const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const px = frame.data;
    for (let i = 0; i < px.length; i += 4) {
      const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const v = g < 110 ? Math.max(0, g - 40) : Math.min(255, g + 40);
      px[i] = px[i + 1] = px[i + 2] = v;
    }
    ctx.putImageData(frame, 0, 0);
    return canvas;
  }

  async function getWorker() {
    if (workerRef.current) return workerRef.current;
    setProgress("Loading on-device OCR engine…");
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      logger: (m: { status?: string; progress?: number }) => {
        if (m.status === "recognizing text") {
          setProgress(`Reading document… ${Math.round((m.progress ?? 0) * 100)}%`);
        }
      },
    });
    workerRef.current = worker as unknown as typeof workerRef.current;
    return workerRef.current!;
  }

  async function captureAndRead() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const canvas = grabFrame();
      if (!canvas) throw new Error("Camera frame not ready yet — hold still and try again.");
      const worker = await getWorker();
      setProgress("Reading document…");
      const { data } = await worker.recognize(canvas);
      const identity = parseScannedText(data.text ?? "");
      setAttempts((a) => a + 1);
      if (!identity || (!identity.documentNumber && !identity.lastName)) {
        setError(
          "No readable name or document number found. Fill the frame with the data page, avoid glare, then capture again.",
        );
        return;
      }
      onIdentity?.(identity);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
    } finally {
      setProgress("");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="relative overflow-hidden rounded-3xl border-2 border-dashed border-primary/40 bg-foreground/90">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          className="h-64 w-full object-cover"
          aria-label="Live document camera"
        />
        <canvas ref={canvasRef} className="hidden" />
        <div className="pointer-events-none absolute inset-4 rounded-2xl border-2 border-primary-foreground/60" />
        <div className="pointer-events-none absolute inset-x-4 bottom-4 flex items-center justify-between">
          <Badge variant={ready ? "success" : "secondary"}>
            {ready ? "Camera live" : "Starting camera…"}
          </Badge>
          {mode === "document" && <Badge variant="gold">OCR · MRZ · QR · barcode</Badge>}
        </div>
        {!ready && (
          <div className="absolute inset-0 grid place-items-center text-primary-foreground">
            <ScanLine className="size-10 animate-pulse" />
          </div>
        )}
      </div>

      <div className="flex gap-2">
        {mode === "document" && (
          <Button className="flex-1" disabled={!ready || busy} onClick={captureAndRead}>
            {busy ? <Loader2 className="animate-spin" /> : <Camera />}
            {busy ? "Reading…" : "Capture and read"}
          </Button>
        )}
        <Button
          variant="secondary"
          size="icon"
          aria-label="Switch camera"
          onClick={() => setFacing((f) => (f === "environment" ? "user" : "environment"))}
        >
          <RefreshCw />
        </Button>
        {torchAvailable && (
          <Button variant="secondary" size="icon" aria-label="Toggle torch" onClick={toggleTorch}>
            {torchOn ? <ZapOff /> : <Zap />}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {progress ||
          hint ||
          (mode === "code"
            ? "Hold the visitor pass QR code or the document barcode inside the frame — it is read automatically."
            : "Passport or ID data page inside the frame. Barcodes and QR codes are read automatically; press capture for printed text and passport MRZ.")}
      </p>
      {attempts > 0 && !error && !busy && (
        <p className="text-[11px] text-muted-foreground">
          Scans performed on this device: {attempts}. All image processing stays on the device.
        </p>
      )}
      {error && (
        <p className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-xs font-semibold text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
