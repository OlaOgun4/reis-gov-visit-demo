/**
 * Browser OCR execution via tesseract.js. Client-only — call from event handlers.
 */
import { cropBottom, prepareImage } from "./image-preprocessor";
import { parseNigerianId, type ExtractedIdentity } from "./nigerian-id-parser";

export type OcrStage = "preparing" | "reading" | "extracting" | "done";

export interface OcrProgress {
  stage: OcrStage;
  message: string;
  percent: number;
}

type Worker = {
  recognize: (img: unknown) => Promise<{ data: { text: string; confidence?: number } }>;
  terminate: () => Promise<unknown>;
};

let workerPromise: Promise<Worker> | null = null;

async function getWorker(onProgress?: (p: OcrProgress) => void): Promise<Worker> {
  if (workerPromise) return workerPromise;
  workerPromise = (async () => {
    const { createWorker } = await import("tesseract.js");
    const worker = await createWorker("eng", 1, {
      logger: (m: { status?: string; progress?: number }) => {
        if (m.status === "recognizing text") {
          onProgress?.({
            stage: "reading",
            message: "Reading document…",
            percent: 20 + Math.round((m.progress ?? 0) * 60),
          });
        }
      },
    });
    return worker as unknown as Worker;
  })().catch((err) => {
    workerPromise = null;
    throw new Error(
      err instanceof Error && err.message
        ? `The on-device reading engine could not be loaded (${err.message}).`
        : "The on-device reading engine could not be loaded. Check the connection and try again.",
    );
  });
  return workerPromise;
}

export async function releaseOcr() {
  const w = workerPromise;
  workerPromise = null;
  if (w) await (await w).terminate().catch(() => undefined);
}

export interface OcrRunResult extends ExtractedIdentity {
  previewUrl: string;
}

export async function runIdOcr(
  file: File,
  onProgress?: (p: OcrProgress) => void,
): Promise<OcrRunResult> {
  onProgress?.({ stage: "preparing", message: "Preparing image…", percent: 5 });
  const prepared = await prepareImage(file);

  const worker = await getWorker(onProgress);
  onProgress?.({ stage: "reading", message: "Reading document…", percent: 20 });

  const first = await worker.recognize(prepared.canvas);
  let text = first.data.text ?? "";

  onProgress?.({ stage: "extracting", message: "Extracting identity details…", percent: 85 });
  let result = parseNigerianId(text);

  // Second pass on the MRZ band when the first pass missed a name or number.
  if (!result.firstName || !result.lastName || !result.documentNumber) {
    try {
      const strip = await worker.recognize(cropBottom(prepared.canvas));
      const combined = `${text}\n${strip.data.text ?? ""}`;
      const second = parseNigerianId(combined);
      if (second.confidence >= result.confidence) {
        result = second;
        text = combined;
      }
    } catch {
      /* keep first-pass result */
    }
  }

  onProgress?.({ stage: "done", message: "Done", percent: 100 });
  return { ...result, rawText: text, previewUrl: prepared.previewUrl };
}