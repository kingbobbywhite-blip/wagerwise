"use client"

import type { OcrLine } from "./extract"

/**
 * Browser OCR via Tesseract.
 *
 * The worker, the WebAssembly core and the English language data are all served
 * from this app rather than a CDN, so screenshot reading works with no network
 * and nothing about your board leaves the machine.
 */

export interface OcrProgress {
  status: string
  progress: number
}

export interface OcrOutput {
  lines: OcrLine[]
  text: string
  meanConfidence: number
}

let workerPromise: Promise<unknown> | null = null

async function getWorker(onProgress?: (p: OcrProgress) => void) {
  if (!workerPromise) {
    const { createWorker } = await import("tesseract.js")
    workerPromise = createWorker("eng", 1, {
      workerPath: "/tesseract/worker.min.js",
      corePath: "/tesseract/",
      langPath: "/tesseract",
      gzip: true,
      logger: (m: OcrProgress) => onProgress?.(m),
    })
  }
  return workerPromise
}

interface RecognizeLine {
  text: string
  confidence: number
}

/**
 * Read one image. Screenshots of dense mobile boards are the hard case, so the
 * page segmentation mode is left on automatic and the results are always sent to
 * a human for review rather than used directly.
 */
export async function readImage(file: File | Blob, onProgress?: (p: OcrProgress) => void): Promise<OcrOutput> {
  const worker = (await getWorker(onProgress)) as {
    recognize: (image: File | Blob) => Promise<{ data: { text: string; lines?: RecognizeLine[]; confidence?: number } }>
  }
  const { data } = await worker.recognize(file)

  const lines: OcrLine[] = (data.lines ?? [])
    .map((l) => ({ text: (l.text ?? "").trim(), confidence: l.confidence }))
    .filter((l) => l.text.length > 0)

  // Fall back to splitting the flat text if the engine gave no line structure.
  const finalLines =
    lines.length > 0
      ? lines
      : (data.text ?? "")
          .split(/\r?\n/)
          .map((t) => ({ text: t.trim(), confidence: data.confidence }))
          .filter((l) => l.text.length > 0)

  const meanConfidence =
    finalLines.length > 0
      ? finalLines.reduce((a, l) => a + (l.confidence ?? 0), 0) / finalLines.length
      : 0

  return { lines: finalLines, text: data.text ?? "", meanConfidence }
}

/** Release the worker. Called when the capture screen unmounts. */
export async function disposeOcr(): Promise<void> {
  if (!workerPromise) return
  const worker = (await workerPromise) as { terminate: () => Promise<void> }
  await worker.terminate()
  workerPromise = null
}
