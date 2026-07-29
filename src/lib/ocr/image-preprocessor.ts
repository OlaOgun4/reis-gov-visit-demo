/**
 * Lightweight browser image preparation for OCR.
 * Resize, grayscale + contrast stretch, orientation correction via createImageBitmap.
 */

export const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const MAX_EDGE = 1800;
const MIN_EDGE = 1000;

export interface PreparedImage {
  canvas: HTMLCanvasElement;
  previewUrl: string;
  width: number;
  height: number;
}

export function isSupportedImage(file: File) {
  return /^image\/(jpeg|jpg|png|webp|heic|heif|bmp)$/i.test(file.type) || /^image\//.test(file.type);
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === "function") {
    try {
      // imageOrientation applies the EXIF rotation where the browser supports it.
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* fall through to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

function enhance(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const frame = ctx.getImageData(0, 0, w, h);
  const px = frame.data;
  let min = 255;
  let max = 0;
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    if (g < min) min = g;
    if (g > max) max = g;
  }
  const span = Math.max(1, max - min);
  for (let i = 0; i < px.length; i += 4) {
    const g = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    const n = ((g - min) / span) * 255;
    const v = Math.max(0, Math.min(255, (n - 128) * 1.35 + 128));
    px[i] = px[i + 1] = px[i + 2] = v;
  }
  ctx.putImageData(frame, 0, 0);
}

/** Returns an enhanced canvas for OCR plus a preview data URL of the original framing. */
export async function prepareImage(
  file: File,
  opts: { enhance?: boolean } = {},
): Promise<PreparedImage> {
  const bitmap = await loadBitmap(file);
  const sw = "width" in bitmap ? bitmap.width : 0;
  const sh = "height" in bitmap ? bitmap.height : 0;
  if (!sw || !sh) throw new Error("The selected file could not be read as an image.");

  const longest = Math.max(sw, sh);
  let scale = 1;
  if (longest > MAX_EDGE) scale = MAX_EDGE / longest;
  else if (longest < MIN_EDGE) scale = Math.min(2, MIN_EDGE / longest);

  const canvas = document.createElement("canvas");
  canvas.width = Math.round(sw * scale);
  canvas.height = Math.round(sh * scale);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser could not prepare the image for reading.");
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, canvas.width, canvas.height);
  const previewUrl = canvas.toDataURL("image/jpeg", 0.85);
  if (opts.enhance !== false) enhance(ctx, canvas.width, canvas.height);
  if ("close" in bitmap && typeof bitmap.close === "function") bitmap.close();
  return { canvas, previewUrl, width: canvas.width, height: canvas.height };
}

/** Crop the bottom band of a canvas — where passport MRZ lines live. */
export function cropBottom(source: HTMLCanvasElement, ratio = 0.35) {
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = Math.round(source.height * ratio);
  const ctx = out.getContext("2d");
  if (!ctx) return source;
  ctx.drawImage(
    source,
    0,
    source.height - out.height,
    source.width,
    out.height,
    0,
    0,
    out.width,
    out.height,
  );
  return out;
}