// src/lib/pixi-fog.ts
import { Texture } from "pixi.js"

/* ---------- Constantes públicas de Fog (úsalas en la grilla) ---------- */
export const FOG_TINT = 0x000000 as const; // fog siempre negro → igual en light y dark
export const FOG_ALPHA = 0.82;             // opacidad del fog
export const FOG_FEATHER = 6;              // px de blur del borde del fog

// Randomización del borde (cuánto “entra” el fog en las celdas visibles)
export const FOG_CREEP_MIN = 0.12;         // 12% del tamaño de celda
export const FOG_CREEP_MAX = 0.32;         // 32% del tamaño de celda
export const FOG_CREEP_ALPHA = 0.55;       // opacidad de esas “mordidas”
export const FOG_CREEP_BLOBS = 2;          // blobs irregulares por lado
export const FOG_CREEP_BLOB_R_MIN = 0.06;  // radio mínimo (fracción del tile)
export const FOG_CREEP_BLOB_R_MAX = 0.18;  // radio máximo (fracción del tile)

/* RNG determinista para que el borde no cambie cada frame */
const hash32 = (x: number) => {
  x |= 0; x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16
  return x >>> 0
}
export const rand01 = (r: number, c: number, salt: number) =>
  (hash32((r * 73856093) ^ (c * 19349663) ^ salt) % 10000) / 10000

/* ---------- Generador de textura tileable de niebla ---------- */
export function createFogTexture(tile = 256, passes = 3): Texture {
  const cvs = document.createElement("canvas")
  cvs.width = tile
  cvs.height = tile
  const ctx = cvs.getContext("2d")!
  ctx.clearRect(0, 0, tile, tile)

  type Pass = { blobs: number; rMin: number; rMax: number; a: number }
  const spec: Pass[] = [
    { blobs: 12, rMin: 0.22, rMax: 0.42, a: 0.08 }, // formas grandes
    { blobs: 18, rMin: 0.12, rMax: 0.26, a: 0.06 }, // medianas
    { blobs: 26, rMin: 0.06, rMax: 0.14, a: 0.045 },// detalle fino
  ]

  const drawBlob = (x: number, y: number, r: number, a: number) => {
    const g = ctx.createRadialGradient(x, y, r * 0.12, x, y, r)
    g.addColorStop(0, `rgba(0,0,0,${a})`)
    g.addColorStop(1, `rgba(0,0,0,0)`)
    ctx.fillStyle = g
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
  }

  for (let p = 0; p < passes; p++) {
    const s = spec[Math.min(p, spec.length - 1)]
    for (let i = 0; i < s.blobs; i++) {
      const x = Math.random() * tile
      const y = Math.random() * tile
      const r = tile * (s.rMin + Math.random() * (s.rMax - s.rMin))
      // tiling sin costuras
      for (const dx of [-tile, 0, tile]) {
        for (const dy of [-tile, 0, tile]) {
          drawBlob(x + dx, y + dy, r, s.a)
        }
      }
    }
  }

  // grano muy sutil para romper uniformidad
  const img = ctx.getImageData(0, 0, tile, tile)
  const d = img.data
  for (let i = 0; i < d.length; i += 4) {
    const jitter = (Math.random() - 0.5) * 6 // -3..3
    d[i + 3] = Math.max(0, Math.min(255, d[i + 3] + jitter))
  }
  ctx.putImageData(img, 0, 0)

  return Texture.from(cvs)
}
