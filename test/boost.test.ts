import { describe, expect, it } from "vitest"
import { boostAt, tagBoosts, type Pixels } from "@/lib/ocr/boost"
import type { OcrLine } from "@/lib/ocr/extract"

/**
 * The colour detector against synthetic screens, laid out like a PrizePicks
 * entry: the face at 70% of the width, a progress bar across the row below.
 * The real screenshots are covered through the fixtures in capture.test.ts.
 */

const W = 1000
const H = 400
function screen(paint: (x: number, y: number) => [number, number, number] | null): Pixels {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      const c = paint(x, y) ?? [24, 24, 36] // the app's dark background
      data[i] = c[0]
      data[i + 1] = c[1]
      data[i + 2] = c[2]
      data[i + 3] = 255
    }
  }
  return { width: W, height: H, data }
}

const GOBLIN: [number, number, number] = [110, 255, 0]
const DEMON: [number, number, number] = [251, 54, 20]
const face = (colour: [number, number, number]) => (x: number, y: number) =>
  x >= 690 && x < 720 && y >= 100 && y < 130 ? colour : null
const row = { x0: 250, y0: 100, x1: 850, y1: 130 }

describe("finding goblins and demons by colour", () => {
  it("tells a goblin from a demon from a standard pick", () => {
    expect(boostAt(screen(face(GOBLIN)), row)).toBe("goblin")
    expect(boostAt(screen(face(DEMON)), row)).toBe("demon")
    expect(boostAt(screen(() => null), row)).toBeNull()
  })

  it("ignores a progress bar crossing the row, but still sees a face beside it", () => {
    const bar = (x: number, y: number) => (y >= 140 && y < 150 && x > 120 && x < 880 ? GOBLIN : null)
    const tall = { x0: 250, y0: 100, x1: 850, y1: 155 }
    expect(boostAt(screen(bar), tall)).toBeNull()
    expect(boostAt(screen((x, y) => bar(x, y) ?? face(DEMON)(x, y)), tall)).toBe("demon")
  })

  it("ignores the green and red of the avatar ring on the left", () => {
    const ring = (x: number, y: number) => (x > 120 && x < 230 && y >= 90 && y < 140 ? GOBLIN : null)
    expect(boostAt(screen(ring), row)).toBeNull()
  })

  it("marks lines checked, and leaves lines without a value or a box alone", () => {
    const px = screen(face(GOBLIN))
    const lines: OcrLine[] = [
      { text: "Jerry Jeudy @tT 05", bbox: row },
      { text: "CLE - WR - #3 Recs", bbox: { ...row, y0: 150, y1: 170 } },
      { text: "Typed 0.5" },
    ]
    const out = tagBoosts(lines, px)
    expect(out.map((l) => l.boost)).toEqual(["goblin", undefined, undefined])
  })
})
