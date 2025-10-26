"use client"
import { useEffect, useRef, useState } from "react"
import { Application, Graphics, Sprite, Texture, BlurFilter, TilingSprite } from "pixi.js"
import { useGrid } from "@/store/grid-store"
import { pixelateFile } from "@/lib/pixelate"
import { Crosshair } from "lucide-react"
import { useTheme } from "next-themes"
import { getTheme, themeModeRef } from "@/lib/pixi-theme"
// ⚠️ Import avanzado fuera (causa cuadro blanco):
// import "pixi.js/advanced-blend-modes"

import {
  createFogTexture,
  FOG_TINT, FOG_ALPHA, FOG_FEATHER,
  FOG_CREEP_MIN, FOG_CREEP_MAX, FOG_CREEP_ALPHA,
  FOG_CREEP_BLOBS, FOG_CREEP_BLOB_R_MIN, FOG_CREEP_BLOB_R_MAX,
  rand01
} from "@/lib/pixi-fog"

/* --------- Tweaks visuales --------- */
const HOVER_GROW = 0.50
const GLOW_STRENGTH_BASE = 6
const GLOW_STRENGTH_GROW = 10
const GLOW_STROKE_BASE = 2
const GLOW_STROKE_GROW = 2
const GLOW_EMPTY_STRENGTH = 4
const GLOW_EMPTY_STROKE = 2

/* --------- Timings --------- */
const GLOW_EASE = 0.22
const GROW_EASE = 0.08

/* --------- Zoom --------- */
const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
const ZOOM_SENSITIVITY = 0.0015
const ZOOM_EASE = 0.18

/* --------- Pan inercial --------- */
const INERTIA_FRICTION = 0.0015
const INERTIA_MIN_SPEED = 0.008
const INERTIA_MAX_SPEED = 2.5

/* --------- Fly to (0,0) --------- */
const FLY_SPEED = 0.004
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

/* --------- Preload --------- */
const PRELOADS: Array<{ key: string; url: string }> = [
  { key: "0:0", url: "/assets/tree.png" },
]

/* --------- SFX --------- */
type SfxExt = "mp3" | "ogg" | "wav"
const HOVER_SFX_BASE = "/sfx/4"
const HOVER_SFX_EXT: SfxExt = "wav"
const HOVER_SFX_VOLUME = 0.08
const HOVER_SFX_URL = `${HOVER_SFX_BASE}.${HOVER_SFX_EXT}`

/* --------- Cámara --------- */
const FOLLOW_MARGIN_PX = 72

/* --------- Fog --------- */
const FOG_HOLE_PAD = 6
const FOG_ANIM_SPEED_X = 0.015
const FOG_ANIM_SPEED_Y = 0.008
const fogTexRef = { current: null as Texture | null }
const fogOffsetRef = { current: { x: 0, y: 0 } }

/* --------- “Anillo” de transición de color entre visibles y niebla --------- */
// Overlay de sombreado (negro) con fade hacia las adyacentes
const RING_FADE = 0.34    // ancho del fade (fracción de tile)
const RING_BLOBS = 2      // blobs que rompen líneas rectas en el fade
const RING_BLOB_R_MIN = 0.08
const RING_BLOB_R_MAX = 0.18

// alpha del sombreado según tema (más visible en dark)
const SHADE_ALPHA_DARK = 0.22
const SHADE_ALPHA_LIGHT = 0.12

// overlay blanco para subir luz en visibles (centro+adyacentes)
const VISIBLE_OVERLAY_ALPHA_DARK = 0.14
const VISIBLE_OVERLAY_ALPHA_LIGHT = 0.06

/* --------- Util ---------- */
const expandKeys = (src: Set<string>, radius = 1) => {
  const out = new Set(src)
  src.forEach(k => {
    const [r, c] = k.split(":").map(Number)
    for (let dr = -radius; dr <= radius; dr++) {
      for (let dc = -radius; dc <= radius; dc++) {
        out.add(`${r + dr}:${c + dc}`)
      }
    }
  })
  return out
}

/* --------- Paletas base de celdas (light/dark) --------- */
const TILE = {
  light: { near: 0xF2EFE6, far: 0xE6E0D6 },
  dark:  { near: 0x2C2F32, far: 0x141619 },
}
const getTilePalette = () => themeModeRef.current === "dark" ? TILE.dark : TILE.light

const hexToRgb = (h: number) => ({ r: (h >> 16) & 255, g: (h >> 8) & 255, b: h & 255 })

const mix = (c1: number, c2: number, t: number) => {
  const tt = Math.max(0, Math.min(1, t)) // yo: por si acaso
  const A = hexToRgb(c1), B = hexToRgb(c2)
  const r  = Math.round(A.r + (B.r - A.r) * tt)
  const g  = Math.round(A.g + (B.g - A.g) * tt)
  const bl = Math.round(A.b + (B.b - A.b) * tt) // azul
  return `rgb(${r},${g},${bl})`
}

// ancho de fade entre paletas (fracción del tile)
const PALETTE_FADE = 0.28   // yo: 28% del tile


export default function PixiGrid() {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)

  // Canvas 2D para la máscara del FOG (perforaciones)
  const fogMaskCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const fogMaskCtxRef    = useRef<CanvasRenderingContext2D | null>(null)
  const fogMaskTexRef    = useRef<Texture | null>(null)
  const fogMaskSpriteRef = useRef<Sprite | null>(null)

  // Canvas 2D para el “anillo” de sombra con degradado orgánico
  const ringCanvasRef  = useRef<HTMLCanvasElement | null>(null)
  const ringCtxRef     = useRef<CanvasRenderingContext2D | null>(null)
  const ringTexRef     = useRef<Texture | null>(null)
  const ringSpriteRef  = useRef<Sprite | null>(null)

  const { resolvedTheme } = useTheme()
  useEffect(() => {
    themeModeRef.current = resolvedTheme === "dark" ? "dark" : "light"
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme])

  // Cámara / pan
  const originRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 })
  const spaceDownRef = useRef(false)

  // Estado de la grilla
  const { cellPx, cells, setCell } = useGrid()
  const cellPxRef = useRef(cellPx)
  const cellsRef = useRef(cells)
  useEffect(() => { cellPxRef.current = cellPx }, [cellPx])
  useEffect(() => { cellsRef.current = cells; draw() }, [cells])

  // Hover
  const hoverKeyRef = useRef<string | null>(null)
  const hoverLockRef = useRef<string | null>(null)
  const hoverGlowTRef = useRef(0)
  const hoverGrowTRef = useRef(0)

  // SFX
  const hoverSfxRef = useRef<HTMLAudioElement | null>(null)
  const lastSfxTsRef = useRef(0)
  const audioUnlockedRef = useRef(false)

  // Coordenadas HUD
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // Zoom (suave + ancla)
  const zoomRef = useRef(1)
  const zoomTargetRef = useRef(1)
  const zoomAnchorRef = useRef<{ c: number; r: number; fx: number; fy: number; localX: number; localY: number } | null>(null)

  // Cursor nativo
  const [cursor, setCursor] = useState<"default" | "grab" | "grabbing" | "pointer">("default")

  // Visor
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)

  const sizeNow = () => cellPxRef.current * zoomRef.current

  // Asegura que (r,c) quede visible (con margen)
  const ensureCellVisible = (r: number, c: number) => {
    const app = appRef.current
    if (!app) return
    const size = sizeNow()
    const w = app.renderer.width
    const h = app.renderer.height
    const ox = originRef.current.x
    const oy = originRef.current.y
    const screenX = c * size - ox
    const screenY = r * size - oy
    let targetOx = ox, targetOy = oy
    const pad = FOLLOW_MARGIN_PX
    if (screenX < pad) targetOx -= (pad - screenX)
    else if (screenX + size > w - pad) targetOx += (screenX + size - (w - pad))
    if (screenY < pad) targetOy -= (pad - screenY)
    else if (screenY + size > h - pad) targetOy += (screenY + size - (h - pad))
    if (targetOx !== ox || targetOy !== oy) {
      inertiaActiveRef.current = false
      velRef.current = { x: 0, y: 0 }
      flyRef.current = { active: true, t: 0, start: { x: ox, y: oy }, target: { x: targetOx, y: targetOy } }
    }
  }

  // Inercia
  const velRef = useRef({ x: 0, y: 0 })
  const lastMoveTsRef = useRef<number>(0)
  const inertiaActiveRef = useRef(false)

  // Fly to center
  const flyRef = useRef({ active: false, t: 0, start: { x: 0, y: 0 }, target: { x: 0, y: 0 } })

  // Ir al tile
  const gotoCell = (r: number, c: number) => {
    const key = `${r}:${c}`
    const changed = hoverKeyRef.current !== key
    hoverKeyRef.current = key
    if (changed) { hoverGrowTRef.current = 0; hoverGlowTRef.current = 1 }
    setHoverCoord({ x: c, y: -r })

    // SFX si hay imagen
    if (changed && cellsRef.current[key]?.canvas) {
      const now = performance.now()
      if (now - lastSfxTsRef.current > 100) {
        const a = hoverSfxRef.current
        if (a) { try { a.currentTime = 0; a.play().catch(() => {}) } catch {} }
        lastSfxTsRef.current = now
      }
    }

    if (!dragRef.current.active) {
      setCursor(cellsRef.current[key]?.canvas ? "pointer" : "default")
    }
    ensureCellVisible(r, c)
    draw()
  }

  // Init Pixi
  useEffect(() => {
    if (!containerRef.current || appRef.current) return
    let disposed = false
    ;(async () => {
      const app = new Application()
      await app.init({
        backgroundAlpha: 0,
        antialias: false,
        resolution: devicePixelRatio,
        autoDensity: true,
        width: containerRef.current!.clientWidth,
        height: Math.max(320, containerRef.current!.clientHeight),
      })
      if (disposed) { app.destroy(); return }
      containerRef.current!.appendChild(app.canvas as HTMLCanvasElement)
      ;(app.canvas as HTMLCanvasElement).style.cssText = "display:block;width:100%;height:100%;cursor:inherit"
      app.stage.sortableChildren = true
      appRef.current = app

      // Fog mask canvas
      const maskCanvas = document.createElement("canvas")
      maskCanvas.width = app.renderer.width
      maskCanvas.height = app.renderer.height
      fogMaskCanvasRef.current = maskCanvas
      fogMaskCtxRef.current = maskCanvas.getContext("2d", { alpha: true })!
      fogMaskTexRef.current = Texture.from(maskCanvas)
      fogMaskSpriteRef.current = new Sprite(fogMaskTexRef.current)

      // Ring (tone) canvas
      const ringCanvas = document.createElement("canvas")
      ringCanvas.width = app.renderer.width
      ringCanvas.height = app.renderer.height
      ringCanvasRef.current = ringCanvas
      ringCtxRef.current = ringCanvas.getContext("2d", { alpha: true })!
      ringTexRef.current = Texture.from(ringCanvas)
      ringSpriteRef.current = new Sprite(ringTexRef.current)

      // Centro inicial
      const size = cellPxRef.current * zoomRef.current
      const w = app.renderer.width, h = app.renderer.height
      originRef.current.x = (0.5 * size) - w / 2
      originRef.current.y = (0.5 * size) - h / 2

      hoverKeyRef.current = "0:0"
      hoverGlowTRef.current = 1
      hoverGrowTRef.current = 0
      setHoverCoord({ x: 0, y: 0 })
      draw()

      // Ticker
      app.ticker.add(() => {
        let needsDraw = false
        // glow
        {
          const target = hoverKeyRef.current ? 1 : 0
          const ng = hoverGlowTRef.current + (target - hoverGlowTRef.current) * GLOW_EASE
          if (Math.abs(ng - hoverGlowTRef.current) > 0.001) { hoverGlowTRef.current = ng; needsDraw = true }
        }
        // grow
        {
          const target = hoverKeyRef.current ? 1 : 0
          const ng = hoverGrowTRef.current + (target - hoverGrowTRef.current) * GROW_EASE
          if (Math.abs(ng - hoverGrowTRef.current) > 0.001) { hoverGrowTRef.current = ng; needsDraw = true }
        }
        // zoom suave
        {
          const z = zoomRef.current, zt = zoomTargetRef.current
          if (Math.abs(zt - z) > 1e-4) {
            const newZ = z + (zt - z) * ZOOM_EASE
            zoomRef.current = newZ
            const anchor = zoomAnchorRef.current
            if (anchor) {
              const size = sizeNow()
              originRef.current.x = (anchor.c + anchor.fx) * size - anchor.localX
              originRef.current.y = (anchor.r + anchor.fy) * size - anchor.localY
            }
            needsDraw = true
          } else if (zoomAnchorRef.current) zoomAnchorRef.current = null
        }
        // inercia pan
        {
          const dragging = dragRef.current.active
          if (inertiaActiveRef.current && !dragging) {
            const dt = app.ticker.elapsedMS
            originRef.current.x -= velRef.current.x * dt
            originRef.current.y -= velRef.current.y * dt
            const decay = Math.exp(-INERTIA_FRICTION * dt)
            velRef.current.x *= decay; velRef.current.y *= decay
            if (Math.hypot(velRef.current.x, velRef.current.y) < INERTIA_MIN_SPEED) {
              inertiaActiveRef.current = false
              velRef.current = { x: 0, y: 0 }
            }
            needsDraw = true
          }
        }
        // fly
        {
          if (flyRef.current.active) {
            const dt = app.ticker.elapsedMS
            flyRef.current.t = Math.min(1, flyRef.current.t + dt * FLY_SPEED)
            const k = easeOutCubic(flyRef.current.t)
            originRef.current.x = flyRef.current.start.x + (flyRef.current.target.x - flyRef.current.start.x) * k
            originRef.current.y = flyRef.current.start.y + (flyRef.current.target.y - flyRef.current.start.y) * k
            if (flyRef.current.t >= 1) flyRef.current.active = false
            needsDraw = true
          }
        }

        // animar tile del fog
        fogOffsetRef.current.x = (fogOffsetRef.current.x + FOG_ANIM_SPEED_X * app.ticker.elapsedMS) % 100000
        fogOffsetRef.current.y = (fogOffsetRef.current.y + FOG_ANIM_SPEED_Y * app.ticker.elapsedMS) % 100000
        needsDraw = true

        if (needsDraw) draw()
      })
    })()

    const onResize = () => {
      const app = appRef.current
      const el = containerRef.current
      if (!app || !el) return
      const w = el.clientWidth, h = Math.max(320, el.clientHeight)
      app.renderer.resize(w, h)

      if (fogMaskCanvasRef.current && fogMaskTexRef.current) {
        fogMaskCanvasRef.current.width = w
        fogMaskCanvasRef.current.height = h
        ;(fogMaskTexRef.current as any).source?.update?.()
      }
      if (ringCanvasRef.current && ringTexRef.current) {
        ringCanvasRef.current.width = w
        ringCanvasRef.current.height = h
        ;(ringTexRef.current as any).source?.update?.()
      }

      const size = cellPxRef.current * zoomRef.current
      originRef.current.x = (0.5 * size) - w / 2
      originRef.current.y = (0.5 * size) - h / 2
      draw()
    }
    window.addEventListener("resize", onResize)
    let ro: ResizeObserver | null = new ResizeObserver(onResize)
    if (containerRef.current) ro.observe(containerRef.current)

    requestAnimationFrame(() => {
      const app = appRef.current, el = containerRef.current
      if (!app || !el) return
      const w = el.clientWidth, h = Math.max(320, el.clientHeight)
      app.renderer.resize(w, h)
      const size = cellPxRef.current * zoomRef.current
      originRef.current.x = (0.5 * size) - w / 2
      originRef.current.y = (0.5 * size) - h / 2
      draw()
    })

    const audio = new Audio(HOVER_SFX_URL)
    audio.preload = "auto"
    audio.volume = HOVER_SFX_VOLUME
    hoverSfxRef.current = audio
    const unlockAudio = () => {
      const a = hoverSfxRef.current
      if (!a) return
      a.muted = true
      a.play().then(() => { a.pause(); a.currentTime = 0; a.muted = false; audioUnlockedRef.current = true }).catch(() => {})
    }
    window.addEventListener("pointerdown", unlockAudio, { once: true })
    window.addEventListener("keydown", unlockAudio, { once: true })

    fogTexRef.current = createFogTexture(256, 18)

    return () => {
      window.removeEventListener("resize", onResize)
      if (ro) { ro.disconnect(); ro = null }
      const app = appRef.current
      if (app) { app.destroy(true, { children: true, texture: true }); appRef.current = null }
    }
  }, [])

  // DRAW
  const draw = () => {
    const app = appRef.current
    if (!app) return

    const vis0 = getVisibleKeys()
    const fogClear = vis0
    // yo: anillo = celdas NO visibles que tocan vis0
    const ring = new Set<string>()
    vis0.forEach(key=>{
      const [r,c]=key.split(":").map(Number)
      ;[[r,c-1],[r,c+1],[r-1,c],[r+1,c]].forEach(([nr,nc])=>{
        const k=`${nr}:${nc}`
        if(!vis0.has(k)) ring.add(k)
      })
    })

    const theme = getTheme()
    const w = app.renderer.width, h = app.renderer.height
    const { x: ox, y: oy } = originRef.current
    const size = sizeNow()
    const data = cellsRef.current
    const hoverKey = hoverKeyRef.current
    const glowT = hoverGlowTRef.current
    const growT = hoverGrowTRef.current

    app.stage.removeChildren()

    // 0) Fondo del tema
    const bg = new Graphics()
    bg.rect(0, 0, w, h).fill({ color: theme.bg, alpha: theme.bgAlpha })
    app.stage.addChild(bg)

    /* 0.5) Suelo por tiles con 2 paletas (near = vis0; far = resto) */
    {
      const cols = getTilePalette()
      const tiles = new Graphics()
      const minC = Math.floor(ox / size) - 2
      const maxC = Math.floor((ox + w) / size) + 2
      const minR = Math.floor(oy / size) - 2
      const maxR = Math.floor((oy + h) / size) + 2

      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const key = `${r}:${c}`
          const fill = vis0.has(key) ? cols.near : cols.far
          tiles.rect(c * size - ox, r * size - oy, size, size).fill({ color: fill, alpha: 1 })
        }
      }
      app.stage.addChild(tiles)
    }

    // 1) Tiles VISIBLES (centro + adyacentes) → overlay blanco para aclarar
    // {
    //   const a = themeModeRef.current === "dark" ? VISIBLE_OVERLAY_ALPHA_DARK : VISIBLE_OVERLAY_ALPHA_LIGHT
    //   const visBG = new Graphics()
    //   vis0.forEach(key => {
    //     const [r, c] = key.split(":").map(Number)
    //     const x = c * size - ox, y = r * size - oy
    //     visBG.roundRect(x, y, size, size, 8).fill({ color: 0xffffff, alpha: a })
    //   })
    //   app.stage.addChild(visBG)
    // }

    /* 1) Transición de color near→far en el anillo */
    if (ringCtxRef.current && ringSpriteRef.current && ringTexRef.current) {
      const ctx = ringCtxRef.current
      const cols = getTilePalette()
      const fadeFrac = PALETTE_FADE

      // reset
      if (ringCanvasRef.current && (ringCanvasRef.current.width!==w || ringCanvasRef.current.height!==h)) {
        ringCanvasRef.current.width = w
        ringCanvasRef.current.height = h
      }
      ctx.clearRect(0,0,w,h)
      ctx.globalCompositeOperation = "source-over"

      ring.forEach(key=>{
        const [r,c]=key.split(":").map(Number)
        const x=c*size-ox, y=r*size-oy
        const sides:[("L"|"R"|"U"|"D"),number,number][] = [
          ["L",r,c-1],["R",r,c+1],["U",r-1,c],["D",r+1,c],
        ]
        sides.forEach(([dir,nr,nc],i)=>{
          if(!vis0.has(`${nr}:${nc}`)) return
          // ancho con pequeña variación para romper líneas rectas
          const v = 0.9 + 0.2*rand01(r,c,123+i)
          const fade = fadeFrac*size*v

          // gradiente de near→far
          let grad:CanvasGradient
          if(dir==="L") grad = ctx.createLinearGradient(x,0,x+fade,0)
          else if(dir==="R") grad = ctx.createLinearGradient(x+size,0,x+size-fade,0)
          else if(dir==="U") grad = ctx.createLinearGradient(0,y,0,y+fade)
          else               grad = ctx.createLinearGradient(0,y+size,0,y+size-fade)

          grad.addColorStop(0, mix(cols.near, cols.far, 0.0))
          grad.addColorStop(1, mix(cols.near, cols.far, 1.0))
          ctx.fillStyle = grad

          if(dir==="L") ctx.fillRect(x, y, fade, size)
          if(dir==="R") ctx.fillRect(x+size-fade, y, fade, size)
          if(dir==="U") ctx.fillRect(x, y, size, fade)
          if(dir==="D") ctx.fillRect(x, y+size-fade, size, fade)
        })
      })

      ;(ringTexRef.current as any).source?.update?.()
      ringSpriteRef.current.x=0
      ringSpriteRef.current.y=0
      app.stage.addChild(ringSpriteRef.current)
    }

    // 2) Grilla
    const grid = new Graphics()
    grid.setStrokeStyle({ width: 1, color: theme.grid, alpha: theme.gridAlpha })
    const mod = (a: number, n: number) => ((a % n) + n) % n
    const startX = -mod(ox, size)
    const startY = -mod(oy, size)
    for (let x = startX; x <= w; x += size) grid.moveTo(x, 0).lineTo(x, h)
    for (let y = startY; y <= h; y += size) grid.moveTo(0, y).lineTo(w, y)
    grid.stroke()
    app.stage.addChild(grid)

    // 3) Sprites
    Object.entries(data).forEach(([key, cell]) => {
      const cvs = cell.canvas
      if (!cvs) return
      const [r, c] = key.split(":").map(Number)
      const cellX = c * size - ox
      const cellY = r * size - oy
      const tex = Texture.from(cvs)
      const sp = new Sprite(tex)

      const base = Math.min(1, size / cvs.width, size / cvs.height)
      const grown = key === hoverKey ? (1 + HOVER_GROW * growT) : 1
      const scale = base * grown
      sp.scale.set(scale)
      sp.x = cellX + (size - cvs.width * base) / 2 - (cvs.width * base) * (grown - 1) / 2
      sp.y = cellY + (size - cvs.height * base) / 2 - (cvs.height * base) * (grown - 1) / 2
      sp.zIndex = key === hoverKey ? 10 : 0
      app.stage.addChild(sp)
    })

    // 4) FOG (tile animado + máscara con bordes orgánicos)
    // 4) FOG …
    if (fogTexRef.current && fogMaskCtxRef.current && fogMaskSpriteRef.current && fogMaskTexRef.current) {
      const fog = new TilingSprite({ texture: fogTexRef.current, width: w, height: h })

      // yo: tinte negro SIEMPRE; alpha un poco mayor para que nunca “aclare” fuera
      const fogAlpha = themeModeRef.current === "dark" ? 0.55 : 0.42
      fog.tint  = 0x000000
      fog.alpha = fogAlpha
      fog.tilePosition.set(fogOffsetRef.current.x, fogOffsetRef.current.y)

      const ctx = fogMaskCtxRef.current
      ctx.clearRect(0, 0, w, h)

      // lleno máscara (niebla total)
      ctx.globalCompositeOperation = "source-over"
      ctx.fillStyle = "rgba(255,255,255,1)"
      ctx.fillRect(0, 0, w, h)

      // abro claros SOLO en vis0, con feather
      ctx.globalCompositeOperation = "destination-out"

      // abro claros SOLO en vis0, con feather y un pequeño retroceso
      const holePadPx = -Math.round(size*0.04) // ~4% del tile hacia afuera
      ctx.filter = `blur(${FOG_FEATHER}px)`
      const s2 = size - holePadPx*2
      vis0.forEach(key=>{
        const [r,c]=key.split(":").map(Number)
        const x=c*size-ox+holePadPx
        const y=r*size-oy+holePadPx
        ctx.fillRect(x,y,s2,s2)
      })
      ctx.filter = "none"

      // borde orgánico sin círculos (tiritas con ruido) SOLO hacia afuera
      ctx.globalAlpha = FOG_CREEP_ALPHA
      const SEG = 14  // cantidad de segmentos por lado
      ring.forEach(key=>{
        // solo trabajamos alrededor de celdas que NO son visibles pero tocan vis0
        const [r,c]=key.split(":").map(Number)
        const x=c*size-ox, y=r*size-oy

        // lados que tocan vis0
        const sides:[("L"|"R"|"U"|"D"),number,number][] = [
          ["L",r,c-1],["R",r,c+1],["U",r-1,c],["D",r+1,c],
        ]
        sides.forEach(([dir,nr,nc],i)=>{
          if(!vis0.has(`${nr}:${nc}`)) return
          for(let s=0;s<SEG;s++){
            const t0 = s/SEG, t1 = (s+1)/SEG
            const n = rand01(r*31+s, c*17+i, 701) // ruido 1D
            const creep = (FOG_CREEP_MIN + (FOG_CREEP_MAX-FOG_CREEP_MIN)*n)*size

            if(dir==="L"){
              const yy = y + t0*size
              const hh = (t1-t0)*size
              ctx.fillRect(x, yy, Math.max(1,creep), hh)
            } else if(dir==="R"){
              const yy = y + t0*size
              const hh = (t1-t0)*size
              ctx.fillRect(x+size-creep, yy, Math.max(1,creep), hh)
            } else if(dir==="U"){
              const xx = x + t0*size
              const ww = (t1-t0)*size
              ctx.fillRect(xx, y, ww, Math.max(1,creep))
            } else {
              const xx = x + t0*size
              const ww = (t1-t0)*size
              ctx.fillRect(xx, y+size-creep, ww, Math.max(1,creep))
            }
          }
        })
      })
      ctx.globalAlpha = 1
      ctx.globalCompositeOperation = "source-over"

      ;(fogMaskTexRef.current as any).source?.update?.()
      fog.mask = fogMaskSpriteRef.current!
      app.stage.addChild(fog)
      app.stage.addChild(fogMaskSpriteRef.current!)
    }



    // 5) Glow/Frame hover
    if (hoverKey) {
      const [r, c] = hoverKey.split(":").map(Number)
      const cellX = c * size - ox
      const cellY = r * size - oy
      const hasImg = !!data[hoverKey]?.canvas
      let rx: number, ry: number, rw: number, rh: number
      let strokeW: number, blurStrength: number

      if (hasImg) {
        const cvs = data[hoverKey]!.canvas!
        const base = Math.min(1, size / cvs.width, size / cvs.height)
        const grown = 1 + HOVER_GROW * growT
        const scale = base * grown
        const gw = cvs.width * scale, gh = cvs.height * scale
        const sx = cellX + (size - cvs.width * base) / 2 - (cvs.width * base) * (grown - 1) / 2
        const sy = cellY + (size - cvs.height * base) / 2 - (cvs.height * base) * (grown - 1) / 2
        strokeW = GLOW_STROKE_BASE + (grown - 1) * GLOW_STROKE_GROW
        const padOut = strokeW / 2
        blurStrength = GLOW_STRENGTH_BASE + (grown - 1) * GLOW_STRENGTH_GROW
        rx = sx - padOut; ry = sy - padOut; rw = gw + padOut * 2; rh = gh + padOut * 2
      } else {
        strokeW = GLOW_EMPTY_STROKE
        const padOut = strokeW / 2
        blurStrength = GLOW_EMPTY_STRENGTH
        rx = cellX - padOut; ry = cellY - padOut; rw = size + padOut * 2; rh = size + padOut * 2
      }

      const glow = new Graphics()
      glow.rect(rx, ry, rw, rh).stroke({ width: strokeW, color: theme.glow, alpha: (hasImg ? 0.9 : theme.emptyGlowAlpha) * glowT })
      glow.filters = [new BlurFilter({ strength: blurStrength * glowT })]
      glow.zIndex = 100
      app.stage.addChild(glow)

      const frame = new Graphics()
      frame.rect(rx, ry, rw, rh).stroke({ width: 1, color: theme.glow, alpha: theme.frameAlpha * glowT })
      frame.zIndex = 101
      app.stage.addChild(frame)
    }
  }

  const getVisibleKeys = (): Set<string> => {
    const vis = new Set<string>()
    const data = cellsRef.current
    const explored: Array<[number, number]> = []
    Object.keys(data).forEach(k => {
      if (data[k]?.canvas) {
        const [r, c] = k.split(":").map(Number)
        explored.push([r, c])
      }
    })
    if (explored.length === 0) explored.push([0, 0])
    for (const [r, c] of explored) {
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          vis.add(`${r + dr}:${c + dc}`)
        }
      }
    }
    return vis
  }

  // Pan + inercia
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        if (!spaceDownRef.current) {
          spaceDownRef.current = true
          setCursor(dragRef.current.active ? "grabbing" : "grab")
        }
        e.preventDefault()
        zoomAnchorRef.current = null
        inertiaActiveRef.current = false
        velRef.current = { x: 0, y: 0 }
        flyRef.current.active = false
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") {
        spaceDownRef.current = false
        const key = hoverKeyRef.current
        const hasImg = key ? !!cellsRef.current[key]?.canvas : false
        setCursor(hasImg ? "pointer" : "default")
      }
    }
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('[data-ui-overlay]')) return
      if (!spaceDownRef.current) return
      dragRef.current = { active: true, x: e.clientX, y: e.clientY }
      lastMoveTsRef.current = performance.now()
      velRef.current = { x: 0, y: 0 }
      inertiaActiveRef.current = false
      setCursor("grabbing")
    }
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.active) return
      const now = performance.now()
      const dt = Math.max(1, now - lastMoveTsRef.current)
      const dx = e.clientX - dragRef.current.x
      const dy = e.clientY - dragRef.current.y
      dragRef.current.x = e.clientX; dragRef.current.y = e.clientY
      lastMoveTsRef.current = now
      originRef.current.x -= dx
      originRef.current.y -= dy
      let vx = dx / dt, vy = dy / dt
      const sp = Math.hypot(vx, vy)
      if (sp > INERTIA_MAX_SPEED) { const k = INERTIA_MAX_SPEED / sp; vx *= k; vy *= k }
      velRef.current = { x: vx, y: vy }
      draw()
    }
    const endDrag = () => {
      if (!dragRef.current.active) return
      dragRef.current.active = false
      setCursor(spaceDownRef.current ? "grab" : (hoverKeyRef.current && cellsRef.current[hoverKeyRef.current!]?.canvas ? "pointer" : "default"))
      inertiaActiveRef.current = true
    }
    el.addEventListener("mousedown", onMouseDown)
    window.addEventListener("mousemove", onMouseMove)
    window.addEventListener("mouseup", endDrag)
    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      el.removeEventListener("mousedown", onMouseDown)
      window.removeEventListener("mousemove", onMouseMove)
      window.removeEventListener("mouseup", endDrag)
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [])

  // Hover tracking
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onEnter = () => { if (!spaceDownRef.current) setCursor("default") }
    const onMove = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('[data-ui-overlay]')) return
      if (hoverLockRef.current) { hoverLockRef.current = null; return }
      if (spaceDownRef.current) { if (hoverKeyRef.current) { hoverKeyRef.current = null; draw() } return }
      const rect = el.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      const { x: ox, y: oy } = originRef.current
      const size = sizeNow()
      const c = Math.floor((localX + ox) / size)
      const r = Math.floor((localY + oy) / size)
      const key = `${r}:${c}`
      const hasImg = !!cellsRef.current[key]?.canvas
      if (!dragRef.current.active) setCursor(hasImg ? "pointer" : "default")
      if (hoverKeyRef.current !== key) {
        hoverKeyRef.current = key
        hoverGrowTRef.current = 0
        hoverGlowTRef.current = 1
        setHoverCoord({ x: c, y: -r })
        draw()
        if (hasImg && audioUnlockedRef.current) {
          const now = performance.now()
          if (now - lastSfxTsRef.current > 100) {
            const a = hoverSfxRef.current
            if (a) { a.currentTime = 0; a.play().catch(() => {}) }
            lastSfxTsRef.current = now
          }
        }
      } else {
        setHoverCoord({ x: c, y: -r })
      }
    }
    const onLeave = () => {
      hoverKeyRef.current = null
      hoverLockRef.current = null
      setCursor("default")
      draw()
    }
    el.addEventListener("mouseenter", onEnter)
    el.addEventListener("mousemove", onMove)
    el.addEventListener("mouseleave", onLeave)
    return () => {
      el.removeEventListener("mouseenter", onEnter)
      el.removeEventListener("mousemove", onMove)
      el.removeEventListener("mouseleave", onLeave)
    }
  }, [])

  // Teclado (WASD/arrows)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (spaceDownRef.current) return
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return
      let dx = 0, dy = 0
      switch (e.code) {
        case "KeyA": case "ArrowLeft":  dx = -1; break
        case "KeyD": case "ArrowRight": dx = +1; break
        case "KeyW": case "ArrowUp":    dy = -1; break
        case "KeyS": case "ArrowDown":  dy = +1; break
        default: return
      }
      e.preventDefault()
      hoverLockRef.current = null
      let r = 0, c = 0
      if (hoverKeyRef.current) { const [rr, cc] = hoverKeyRef.current.split(":").map(Number); r = rr; c = cc }
      gotoCell(r + dy, c + dx)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // Zoom rueda
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('[data-ui-overlay]')) { e.preventDefault(); return }
      e.preventDefault()
      flyRef.current.active = false
      const rect = el.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      const size = sizeNow()
      const worldX = localX + originRef.current.x
      const worldY = localY + originRef.current.y
      const c = Math.floor(worldX / size)
      const r = Math.floor(worldY / size)
      const fx = worldX / size - c
      const fy = worldY / size - r
      zoomAnchorRef.current = { c, r, fx, fy, localX, localY }
      const factor = Math.exp(-e.deltaY * ZOOM_SENSITIVITY)
      zoomTargetRef.current = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTargetRef.current * factor))
    }
    el.addEventListener("wheel", onWheel, { passive: false } as any)
    return () => el.removeEventListener("wheel", onWheel as any)
  }, [])

  // Click → visor
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onClick = (e: MouseEvent) => {
      if (spaceDownRef.current) return
      const rect = el.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      const { x: ox, y: oy } = originRef.current
      const size = sizeNow()
      const c = Math.floor((localX + ox) / size)
      const r = Math.floor((localY + oy) / size)
      const cell = cellsRef.current[`${r}:${c}`]
      if (cell?.canvas) setViewerUrl(cell.canvas.toDataURL("image/png"))
    }
    el.addEventListener("click", onClick)
    return () => el.removeEventListener("click", onClick)
  }, [])

  // Drop file
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onOver = (e: DragEvent) => e.preventDefault()
    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      const file = e.dataTransfer?.files?.[0]
      if (!file) return
      const rect = el.getBoundingClientRect()
      const localX = e.clientX - rect.left
      const localY = e.clientY - rect.top
      const { x: ox, y: oy } = originRef.current
      const size = sizeNow()
      const c = Math.floor((localX + ox) / size)
      const r = Math.floor((localY + oy) / size)
      const key = `${r}:${c}`
      const canvas = await pixelateFile(file, { maxWidth: 1024, noUpscale: true })
      setCell(key, canvas)
      draw()
    }
    el.addEventListener("dragover", onOver)
    el.addEventListener("drop", onDrop)
    return () => {
      el.removeEventListener("dragover", onOver)
      el.removeEventListener("drop", onDrop)
    }
  }, [])

  // Fly a (0,0)
  const flyHome = () => {
    const app = appRef.current
    const el = containerRef.current
    if (!app || !el) return
    inertiaActiveRef.current = false
    velRef.current = { x: 0, y: 0 }
    const w = el.clientWidth, h = Math.max(320, el.clientHeight)
    const size = cellPxRef.current * zoomRef.current
    const targetX = 0.5 * size - w / 2
    const targetY = 0.5 * size - h / 2
    flyRef.current = { active: true, t: 0, start: { x: originRef.current.x, y: originRef.current.y }, target: { x: targetX, y: targetY } }
    hoverKeyRef.current = "0:0"
    hoverGrowTRef.current = 0
    hoverGlowTRef.current = 1
    setHoverCoord({ x: 0, y: 0 })
    hoverLockRef.current = "0:0"
    draw()
  }

  // Preload
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      for (const p of PRELOADS) {
        try {
          const res = await fetch(p.url)
          const blob = await res.blob()
          const file = new File([blob], p.url.split("/").pop() || "asset.png", { type: blob.type })
          const canvas = await pixelateFile(file, { maxWidth: 1024, noUpscale: true })
          if (!cancelled) setCell(p.key, canvas)
        } catch (e) {
          console.error("preload failed:", p.url, e)
        }
      }
    })()
    return () => { cancelled = true }
  }, [])

  return (
    <>
      <div
        ref={containerRef}
        data-grid-root
        className="relative w-full h-full overflow-hidden select-none"
        style={{ cursor }}
      >
        <div className="absolute left-2 top-2 z-[200] px-2 py-1 rounded-md text-xs text-white bg-black/60 backdrop-blur-sm pointer-events-none" style={{ lineHeight: 1.1 }}>
          <span className="opacity-70 mr-1">Zona</span>
          <span>({hoverCoord.x}, {hoverCoord.y})</span>
        </div>

        <button
          data-ui-overlay
          onClick={(e) => { e.stopPropagation(); flyHome() }}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
          onMouseMove={(e) => e.stopPropagation()}
          onWheel={(e) => { e.stopPropagation(); e.preventDefault() }}
          aria-label="Volver a (0,0)"
          title="Volver a (0,0)"
          style={{ cursor: "pointer" }}
          className={[
            "absolute left-2 top-12 z-[200] w-9 h-9 rounded-full",
            "flex items-center justify-center",
            "bg-black/60 text-white border border-white/30 backdrop-blur-sm",
            "pointer-events-auto select-none",
            "transition-transform duration-150 will-change-transform hover:scale-110",
            "hover:shadow-[0_0_14px_2px_rgba(255,255,255,0.85)]",
            "hover:ring-2 hover:ring-white/80 hover:ring-offset-0",
          ].join(" ")}
        >
          <Crosshair className="w-4 h-4" />
        </button>
      </div>

      {viewerUrl && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={() => setViewerUrl(null)}>
          <img src={viewerUrl} alt="preview" style={{ imageRendering: "pixelated" }} className="max-w-[90vw] max-h-[90vh]" />
        </div>
      )}
    </>
  )
}
