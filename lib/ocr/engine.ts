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

/**
 * Page segmentation mode, and the single most important setting in this file.
 *
 * tesseract.js defaults to SINGLE_BLOCK (6), unlike the Tesseract CLI, which
 * defaults to AUTO (3). SINGLE_BLOCK assumes one column of evenly sized text,
 * and a pick'em board is neither:
 *
 *   - PrizePicks lays cards out in a two-column grid. SINGLE_BLOCK reads straight
 *     across both, so "LeBron James" and "Stephen Curry" come out as one
 *     four-word line that is neither name.
 *   - The line value is the largest text on the card, around three times the
 *     size of everything else. SINGLE_BLOCK treats it as noise and drops it, so
 *     no prop can be formed at all, whatever the parser does afterwards.
 *
 * AUTO runs Tesseract's own layout analysis. It finds each card as its own
 * block and emits one card at a time, left column then right, with the line
 * value intact. Measured on a rendered two-column board: SINGLE_BLOCK gave 11
 * lines and zero line values; AUTO gave 25 lines and all four.
 *
 * SPARSE_TEXT (11) also recovers every value but interleaves the columns,
 * which pairs the wrong name with the wrong line. Do not use it here.
 */
export const PAGE_SEG_MODE = "3" // PSM.AUTO

async function getWorker(onProgress?: (p: OcrProgress) => void) {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js")
      const worker = await createWorker("eng", 1, {
        workerPath: "/tesseract/worker.min.js",
        corePath: "/tesseract/",
        langPath: "/tesseract",
        gzip: true,
        logger: (m: OcrProgress) => onProgress?.(m),
      })
      await worker.setParameters({ tessedit_pageseg_mode: PAGE_SEG_MODE as never })
      return worker
    })()
    // A failed start must not be cached, or every later attempt reuses the
    // rejection and the only fix is reloading the page.
    workerPromise.catch(() => {
      workerPromise = null
    })
  }
  return workerPromise
}

interface RecognizeLine {
  text: string
  confidence: number
  bbox?: { x0: number; y0: number; x1: number; y1: number }
}

/**
 * Read one image. Screenshots of dense mobile boards are the hard case, so the
 * page segmentation mode is left on automatic and the results are always sent to
 * a human for review rather than used directly.
 */
export async function readImage(file: File | Blob, onProgress?: (p: OcrProgress) => void): Promise<OcrOutput> {
  const worker = (await getWorker(onProgress)) as unknown as {
    recognize: (
      image: File | Blob,
      options: Record<string, unknown>,
      output: Record<string, boolean>,
    ) => Promise<{
      data: {
        text: string
        lines?: RecognizeLine[]
        blocks?: { paragraphs?: { lines?: RecognizeLine[] }[] }[] | null
        confidence?: number
      }
    }>
  }
  const { data } = await worker.recognize(file, {}, { blocks: true, text: true })

  // Walk blocks -> paragraphs -> lines explicitly. Under AUTO segmentation each
  // card is its own block, and block order is what keeps a card's name, line
  // value and stat together, so the order here matters.
  const fromBlocks: OcrLine[] = []
  for (const b of data.blocks ?? []) {
    for (const p of b.paragraphs ?? []) {
      for (const l of p.lines ?? []) {
        const text = (l.text ?? "").trim()
        // Keep the position. It is what lets the parser pair a value with the
        // name beside it rather than whichever name happened to be read last.
        if (text) fromBlocks.push({ text, confidence: l.confidence, bbox: l.bbox })
      }
    }
  }
  const lines: OcrLine[] =
    fromBlocks.length > 0
      ? fromBlocks
      : (data.lines ?? [])
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
