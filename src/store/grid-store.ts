import { create } from "zustand"


export type Cell = { id: string; canvas?: HTMLCanvasElement }

type State = {
  cellPx: number
  cells: Record<string, Cell>
  setCellPx: (n: number) => void
  setCell: (key: string, canvas?: HTMLCanvasElement) => void
  clear: () => void
}

export const useGrid = create<State>((set) => ({
  cellPx: 128, // yo: grilla visual base; no forzamos que el arte “quepa” aquí
  cells: {},
  setCellPx: (cellPx) => set({ cellPx }),
  setCell: (key, canvas) =>
    set((s) => ({ cells: { ...s.cells, [key]: { id: key, canvas } } })),
  clear: () => set({ cells: {} }),
}))