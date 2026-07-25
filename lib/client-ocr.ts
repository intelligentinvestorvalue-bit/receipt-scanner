/**
 * Browser-side OCR via Tesseract.js (no Google Vision / no billing).
 * Worker is reused across scans for faster subsequent recognizes.
 */

import type { Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;
let progressCallback: ((progress: number, status: string) => void) | undefined;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng", 1, {
        logger: (m) => {
          if (typeof m.progress === "number" && progressCallback) {
            progressCallback(m.progress, m.status ?? "");
          }
        },
      });
    })().catch((err) => {
      workerPromise = null;
      throw err;
    });
  }
  return workerPromise;
}

/**
 * Downscale large phone photos so OCR stays responsive on mobile.
 * Returns a JPEG data URL (or the original if already small / canvas unavailable).
 */
export async function prepareImageForOcr(dataUrl: string): Promise<string> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return dataUrl;
  }

  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const maxWidth = 1600;
      if (img.width <= maxWidth) {
        resolve(dataUrl);
        return;
      }
      const scale = maxWidth / img.width;
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        resolve(dataUrl);
        return;
      }
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/jpeg", 0.92));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

/**
 * Run Tesseract OCR on a receipt image (data URL, File, or blob URL).
 */
export async function ocrImageClient(
  image: string | File | Blob,
  onProgress?: (progress: number, status: string) => void
): Promise<string> {
  progressCallback = onProgress;
  try {
    const worker = await getWorker();
    const {
      data: { text },
    } = await worker.recognize(image, { rotateAuto: true });

    const trimmed = (text ?? "").trim();
    if (!trimmed) {
      throw new Error(
        "No text detected in image — try a clearer photo or enter manually"
      );
    }
    return trimmed;
  } finally {
    progressCallback = undefined;
  }
}
