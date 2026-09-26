"use client"

import * as React from "react"
import { buildBoard, boardToCandidates, type BoardRow } from "@/lib/quant/board"
import { projectSlate, type ProjectedProp } from "@/lib/quant/projection"
import type { CandidateLeg } from "@/lib/quant/optimizer"
import { useStore } from "./provider"

export interface DerivedSlate {
  props: ProjectedProp[]
  rows: BoardRow[]
  candidates: CandidateLeg[]
  /** Rows in the imported slate that could not be projected at all. */
  unpriceable: number
}

/**
 * Project the imported slate and assemble the board.
 *
 * Recomputes only when the slate or the projection settings change, because
 * pricing several hundred props involves a root-find per row.
 */
export function useDerivedSlate(): DerivedSlate {
  const { state } = useStore()
  return React.useMemo(() => {
    if (!state.slate || state.slate.rows.length === 0) {
      return { props: [], rows: [], candidates: [], unpriceable: 0 }
    }
    const props = projectSlate(state.slate.rows, state.settings.projection)
    const rows = buildBoard(props)
    return {
      props,
      rows,
      candidates: boardToCandidates(rows),
      unpriceable: state.slate.rows.length - props.length,
    }
  }, [state.slate, state.settings.projection])
}
