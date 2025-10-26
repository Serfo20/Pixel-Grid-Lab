"use client"
import { useEffect, useState } from "react"
import { useGrid } from "@/store/grid-store"
import { pixelateFile } from "@/lib/pixelate"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Input } from "@/components/ui/input"

export default function Controls() {
  const { rows, cols, palette, targetW, displayW, setRowsCols, setPalette, setTargetW, setDisplayW, setCell } = useGrid()
  const [scalePreview] = useState(4)

  useEffect(() => {
    const el = (document.querySelector("[data-grid-root]") as HTMLElement | null) ?? document
    const handler = async (e: any) => {
      const { key, file } = (e.detail ?? {}) as { key: string; file: File }
      if (!file) return
      const canvas = await pixelateFile(file, {
        targetWidth: targetW,
        palette,
        outputWidth: displayW, // ← nuevo
      })
      setCell(key, canvas)
    }
    el.addEventListener("cell-file" as any, handler as any)
    return () => el.removeEventListener("cell-file" as any, handler as any)
  }, [targetW, palette, displayW, setCell])

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Label>Filas</Label>
          <Input type="number" min={1} max={16} value={rows}
            onChange={(e) => setRowsCols(parseInt(e.target.value || "1"), cols)} />
        </div>
        <div>
          <Label>Columnas</Label>
          <Input type="number" min={1} max={16} value={cols}
            onChange={(e) => setRowsCols(rows, parseInt(e.target.value || "1"))} />
        </div>

        <div>
          <Label>Resolución <span className="opacity-70">(pixel)</span></Label>
          <div className="flex items-center gap-3">
            <Slider value={[targetW]} min={8} max={128} step={1}
              onValueChange={([v]) => setTargetW(v)} className="w-full" />
            <span className="text-xs tabular-nums w-12 text-right">{targetW}px</span>
          </div>
        </div>

        <div>
          <Label>Tamaño de salida</Label>
          <div className="flex items-center gap-3">
            <Slider value={[displayW]} min={128} max={1024} step={32}
              onValueChange={([v]) => setDisplayW(v)} className="w-full" />
            <span className="text-xs tabular-nums w-12 text-right">{displayW}px</span>
          </div>
        </div>

        <div className="col-span-2 md:col-span-4">
          <Label>Paleta</Label>
          <Select value={palette} onValueChange={(v: any) => setPalette(v)}>
            <SelectTrigger><SelectValue placeholder="Selecciona paleta" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Ninguna</SelectItem>
              <SelectItem value="db16">DB16</SelectItem>
              <SelectItem value="rgb332">RGB332</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="text-sm text-muted-foreground">
        Arrastra una imagen <span className="font-semibold">sobre una celda</span>. Se pixelará con la resolución arriba
        y se escalará (entero) al tamaño de salida.
      </div>

      <div className="flex gap-2">
        <Button variant="outline" onClick={() => {
          const cvs = document.querySelector("canvas") as HTMLCanvasElement | null
          if (!cvs) return
          const url = cvs.toDataURL("image/png")
          const a = document.createElement("a")
          a.href = url; a.download = "pixel-grid.png"; a.click()
        }}>
          Exportar tablero
        </Button>
      </div>
    </div>
  )
}
