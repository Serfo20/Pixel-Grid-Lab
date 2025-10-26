"use client"
import { useEffect, useRef, useState } from "react"
import { Application, Graphics, Sprite, Texture, BlurFilter } from "pixi.js"
import { useGrid } from "@/store/grid-store"
import { pixelateFile } from "@/lib/pixelate"
import { Crosshair } from "lucide-react"
import { useTheme } from "next-themes"
import { getTheme, themeModeRef } from "@/lib/pixi-theme"

// ——— Visual
const HOVER_GROW = 0.50
const GLOW_STRENGTH_BASE = 6
const GLOW_STRENGTH_GROW = 10
const GLOW_STROKE_BASE = 2
const GLOW_STROKE_GROW = 2
const GLOW_EMPTY_STRENGTH = 4
const GLOW_EMPTY_STROKE = 2

// ——— Timings
const GLOW_EASE = 0.22   // glow rápido
const GROW_EASE = 0.08   // crecimiento suave

// ——— Zoom
const ZOOM_MIN = 0.5
const ZOOM_MAX = 4
const ZOOM_SENSITIVITY = 0.0015
const ZOOM_EASE = 0.18   // suavizado del zoom

// ——— Inercia de pan
const INERTIA_FRICTION = 0.0015   // fricción (más alto = se frena antes)
const INERTIA_MIN_SPEED = 0.008   // px/ms: umbral para cortar inercia
const INERTIA_MAX_SPEED = 2.5     // px/ms: techo de velocidad inicial

// ——— Fly a 0,0
const FLY_SPEED = 0.004           // más alto = más rápido
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3)

// ——— Imagen inicial
const PRELOADS: Array<{ key: string; url: string }> = [
  { key: "0:0", url: "/assets/tree.png" },
]

// ——— Audio SFX (cambia solo esta base para probar otros sonidos)
type SfxExt = "mp3" | "ogg" | "wav"
const HOVER_SFX_BASE = "/sfx/4"      // ← incluye la carpeta y el slash inicial
const HOVER_SFX_EXT: SfxExt = "wav"  // "mp3" | "ogg" | "wav"
const HOVER_SFX_VOLUME = 0.08
const HOVER_SFX_URL = `${HOVER_SFX_BASE}.${HOVER_SFX_EXT}` // "/sfx/1.wav"

// la cámara intentará mantener la celda dentro de este margen en px
const FOLLOW_MARGIN_PX = 72

export default function PixiGrid() {
  const containerRef = useRef<HTMLDivElement>(null)
  const appRef = useRef<Application | null>(null)

  const { resolvedTheme } = useTheme()
  useEffect(() => {
    themeModeRef.current = resolvedTheme === "dark" ? "dark" : "light"
    draw()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedTheme])

  // cámara/pan
  const originRef = useRef({ x: 0, y: 0 })
  const dragRef = useRef<{ active: boolean; x: number; y: number }>({ active: false, x: 0, y: 0 })
  const spaceDownRef = useRef(false)

  // estado “vivo”
  const { cellPx, cells, setCell } = useGrid()
  const cellPxRef = useRef(cellPx)
  const cellsRef = useRef(cells)
  useEffect(() => { cellPxRef.current = cellPx }, [cellPx])
  useEffect(() => { cellsRef.current = cells; draw() }, [cells])

  // hover
  const hoverKeyRef = useRef<string | null>(null)
  const hoverLockRef = useRef<string | null>(null)
  const hoverGlowTRef = useRef(0) // 0..1 (rápido)
  const hoverGrowTRef = useRef(0) // 0..1 (lento)

  // SFX
  const hoverSfxRef = useRef<HTMLAudioElement | null>(null)
  const lastSfxTsRef = useRef(0)
  const audioUnlockedRef = useRef(false) // ← NUEVO

  // coordenadas (cartesiano: y hacia arriba)
  const [hoverCoord, setHoverCoord] = useState<{ x: number; y: number }>({ x: 0, y: 0 })

  // zoom (suave + anclado a celda)
  const zoomRef = useRef(1)         // actual
  const zoomTargetRef = useRef(1)   // objetivo
  const zoomAnchorRef = useRef<{ c: number; r: number; fx: number; fy: number; localX: number; localY: number } | null>(null)

  // cursor nativo
  const [cursor, setCursor] = useState<"default" | "grab" | "grabbing" | "pointer">("default")

  // visor
  const [viewerUrl, setViewerUrl] = useState<string | null>(null)

  const sizeNow = () => cellPxRef.current * zoomRef.current

  // Desplaza (con easing usando tu mismo flyRef) la cámara si el tile (r,c) queda fuera del viewport (+ margen)
  const ensureCellVisible = (r: number, c: number) => {
    const app = appRef.current
    if (!app) return

    const size = sizeNow()
    const w = app.renderer.width
    const h = app.renderer.height

    const ox = originRef.current.x
    const oy = originRef.current.y

    // posición en pantalla del tile actual
    const screenX = c * size - ox
    const screenY = r * size - oy

    let targetOx = ox
    let targetOy = oy
    const pad = FOLLOW_MARGIN_PX

    // Horizontal
    if (screenX < pad) {
      // mover tile a la derecha → disminuir origin.x
      targetOx -= (pad - screenX)
    } else if (screenX + size > w - pad) {
      // mover tile a la izquierda → aumentar origin.x
      targetOx += (screenX + size - (w - pad))
    }

    // Vertical
    if (screenY < pad) {
      // mover tile hacia abajo → disminuir origin.y
      targetOy -= (pad - screenY)
    } else if (screenY + size > h - pad) {
      // mover tile hacia arriba → aumentar origin.y
      targetOy += (screenY + size - (h - pad))
    }

    // Si hay ajuste, animamos con tu mismo sistema de "fly"
    if (targetOx !== ox || targetOy !== oy) {
      inertiaActiveRef.current = false
      velRef.current = { x: 0, y: 0 }

      flyRef.current = {
        active: true,
        t: 0,
        start: { x: ox, y: oy },
        target: { x: targetOx, y: targetOy },
      }
    }
  }

  // inercia
  const velRef = useRef({ x: 0, y: 0 })           // px/ms
  const lastMoveTsRef = useRef<number>(0)
  const inertiaActiveRef = useRef(false)

  // fly-to-center
  const flyRef = useRef({
    active: false,
    t: 0,
    start: { x: 0, y: 0 },
    target: { x: 0, y: 0 },
  })

  // Mueve el hover a (r,c) aplicando grow/glow, SFX, cursor y follow camera
  const gotoCell = (r: number, c: number) => {
    const key = `${r}:${c}`
    const changed = hoverKeyRef.current !== key

    hoverKeyRef.current = key
    if (changed) {
      hoverGrowTRef.current = 0
      hoverGlowTRef.current = 1
    }
    setHoverCoord({ x: c, y: -r })

    // SFX si tiene imagen (con antispam)
    if (changed && cellsRef.current[key]?.canvas) {
      const now = performance.now()
      if (now - lastSfxTsRef.current > 100) {
        const a = hoverSfxRef.current
        if (a) {
          try { a.currentTime = 0; a.play() } catch {}
        }
        lastSfxTsRef.current = now
      }
    }

    // Cursor: pointer solo si hay imagen en la celda
    if (!dragRef.current.active) {
      const hasImg = !!cellsRef.current[key]?.canvas
      setCursor(hasImg ? "pointer" : "default")
    }

    // 🔥 Asegura visibilidad cuando venimos por teclado
    ensureCellVisible(r, c)

    draw()
  }

  // ——— init Pixi v8
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

      const canvas = app.canvas as HTMLCanvasElement
      canvas.style.display = "block"
      canvas.style.width = "100%"
      canvas.style.height = "100%"
      canvas.style.cursor = "inherit"

      app.stage.sortableChildren = true
      appRef.current = app

      // centrar (0,0) en el centro de la pantalla
      const size = cellPxRef.current * zoomRef.current
      const w = app.renderer.width
      const h = app.renderer.height
      originRef.current.x = (0.5 * size) - w / 2
      originRef.current.y = (0.5 * size) - h / 2

      // foco inicial en (0,0)
      hoverKeyRef.current = "0:0"
      hoverGlowTRef.current = 1
      hoverGrowTRef.current = 0
      setHoverCoord({ x: 0, y: 0 })
      draw()

      // ticker: glow/grow + zoom suave + ancla + inercia + fly
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
        // zoom suave + ancla
        {
          const z = zoomRef.current
          const zt = zoomTargetRef.current
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
          } else if (zoomAnchorRef.current) {
            zoomAnchorRef.current = null
          }
        }
        // inercia pan
        {
          const dragging = dragRef.current.active
          if (inertiaActiveRef.current && !dragging) {
            const dt = app.ticker.elapsedMS // ms
            originRef.current.x -= velRef.current.x * dt
            originRef.current.y -= velRef.current.y * dt

            const decay = Math.exp(-INERTIA_FRICTION * dt)
            velRef.current.x *= decay
            velRef.current.y *= decay

            if (Math.hypot(velRef.current.x, velRef.current.y) < INERTIA_MIN_SPEED) {
              inertiaActiveRef.current = false
              velRef.current = { x: 0, y: 0 }
            }
            needsDraw = true
          }
        }
        // fly-to-center
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

        if (needsDraw) draw()
      })
    })()

    const onResize = () => {
      const app = appRef.current
      const el = containerRef.current
      if (!app || !el) return

      const w = el.clientWidth
      const h = Math.max(320, el.clientHeight)
      app.renderer.resize(w, h)

      // mantener la celda (0,0) al centro
      const size = cellPxRef.current * zoomRef.current
      originRef.current.x = (0.5 * size) - w / 2
      originRef.current.y = (0.5 * size) - h / 2

      draw()
    }
    window.addEventListener("resize", onResize)

    // Observa cambios reales del contenedor (no solo window)
    let ro: ResizeObserver | null = new ResizeObserver(() => {
      onResize()
    })
    if (containerRef.current) ro.observe(containerRef.current)

    // Recalcular tras primer layout/paddings
    requestAnimationFrame(() => {
      const app = appRef.current
      const el = containerRef.current
      if (!app || !el) return
      const w = el.clientWidth
      const h = Math.max(320, el.clientHeight)
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

    // Desbloqueo en la primera interacción (iOS/Safari)
    const unlockAudio = () => {
      const a = hoverSfxRef.current
      if (!a) return
      a.muted = true
      a.play()
        .then(() => {
          a.pause()
          a.currentTime = 0
          a.muted = false
          audioUnlockedRef.current = true
        })
        .catch(() => { /* ignorar */ })
    }
    window.addEventListener("pointerdown", unlockAudio, { once: true })
    window.addEventListener("keydown",   unlockAudio, { once: true })

    return () => {
      disposed = true
      window.removeEventListener("resize", onResize)
      if (ro) { ro.disconnect(); ro = null }

      const app = appRef.current
      if (app) { app.destroy(true, { children: true, texture: true }); appRef.current = null }
    }
  }, [])

  // ——— draw
  const draw = () => {
    const app = appRef.current
    if (!app) return

    const theme = getTheme()

    const w = app.renderer.width
    const h = app.renderer.height
    const { x: ox, y: oy } = originRef.current
    const size = sizeNow()
    const data = cellsRef.current
    const hoverKey = hoverKeyRef.current
    const glowT = hoverGlowTRef.current
    const growT = hoverGrowTRef.current

    app.stage.removeChildren()

    // fondo + grilla infinita (tematizados)
    const g = new Graphics()
    g.rect(0, 0, w, h).fill({ color: theme.bg, alpha: theme.bgAlpha })
    g.setStrokeStyle({ width: 1, color: theme.grid, alpha: theme.gridAlpha })

    const mod = (a: number, n: number) => ((a % n) + n) % n
    const startX = -mod(ox, size)
    const startY = -mod(oy, size)
    for (let x = startX; x <= w; x += size) g.moveTo(x, 0).lineTo(x, h)
    for (let y = startY; y <= h; y += size) g.moveTo(0, y).lineTo(w, y)
    g.stroke()
    app.stage.addChild(g)

    // sprites
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

    // glow (vacía o con imagen)
    if (hoverKey) {
      const [r, c] = hoverKey.split(":").map(Number)
      const cellX = c * size - ox
      const cellY = r * size - oy
      const hasImg = !!data[hoverKey]?.canvas

      let rx: number, ry: number, rw: number, rh: number
      let strokeW: number
      let blurStrength: number

      if (hasImg) {
        const cvs = data[hoverKey]!.canvas!
        const base = Math.min(1, size / cvs.width, size / cvs.height)
        const grown = 1 + HOVER_GROW * growT
        const scale = base * grown
        const gw = cvs.width * scale
        const gh = cvs.height * scale
        const sx = cellX + (size - cvs.width * base) / 2 - (cvs.width * base) * (grown - 1) / 2
        const sy = cellY + (size - cvs.height * base) / 2 - (cvs.height * base) * (grown - 1) / 2

        strokeW = GLOW_STROKE_BASE + (grown - 1) * GLOW_STROKE_GROW
        const padOut = strokeW / 2
        blurStrength = GLOW_STRENGTH_BASE + (grown - 1) * GLOW_STRENGTH_GROW

        rx = sx - padOut
        ry = sy - padOut
        rw = gw + padOut * 2
        rh = gh + padOut * 2
      } else {
        strokeW = GLOW_EMPTY_STROKE
        const padOut = strokeW / 2
        blurStrength = GLOW_EMPTY_STRENGTH
        rx = cellX - padOut
        ry = cellY - padOut
        rw = size + padOut * 2
        rh = size + padOut * 2
      }

      const glow = new Graphics()
      glow.rect(rx, ry, rw, rh).stroke({
        width: strokeW,
        color: theme.glow,
        alpha: (hasImg ? 0.9 : theme.emptyGlowAlpha) * glowT,
      })
      glow.filters = [new BlurFilter({ strength: blurStrength * glowT })]
      glow.zIndex = 100
      app.stage.addChild(glow)

      const frame = new Graphics()
      frame.rect(rx, ry, rw, rh).stroke({
        width: 1,
        color: theme.glow,
        alpha: theme.frameAlpha * glowT,
      })
      frame.zIndex = 101
      app.stage.addChild(frame)
    }
  }

  // ——— pan (barra espaciadora) + inercia
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
      const dt = Math.max(1, now - lastMoveTsRef.current) // ms

      const dx = e.clientX - dragRef.current.x
      const dy = e.clientY - dragRef.current.y
      dragRef.current.x = e.clientX
      dragRef.current.y = e.clientY
      lastMoveTsRef.current = now

      originRef.current.x -= dx
      originRef.current.y -= dy

      // velocidad instantánea (px/ms) con techo
      let vx = dx / dt
      let vy = dy / dt
      const sp = Math.hypot(vx, vy)
      if (sp > INERTIA_MAX_SPEED) {
        const k = INERTIA_MAX_SPEED / sp
        vx *= k; vy *= k
      }
      velRef.current = { x: vx, y: vy }

      draw()
    }
    const endDrag = () => {
      if (!dragRef.current.active) return
      dragRef.current.active = false

      if (spaceDownRef.current) {
        setCursor("grab")
      } else {
        const key = hoverKeyRef.current
        const hasImg = key ? !!cellsRef.current[key]?.canvas : false
        setCursor(hasImg ? "pointer" : "default")
      }

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

  // ——— hover tracking (sin pan)
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

      // cursor nativo según tenga imagen
      if (!dragRef.current.active) {
        setCursor(hasImg ? "pointer" : "default")
      }

      if (hoverKeyRef.current !== key) {
        hoverKeyRef.current = key
        hoverGrowTRef.current = 0
        hoverGlowTRef.current = 1
        setHoverCoord({ x: c, y: -r })
        draw()

        // SFX al entrar a una celda con imagen (antispam ~100ms)
        if (hasImg && audioUnlockedRef.current) {
          const now = performance.now()
          if (now - lastSfxTsRef.current > 100) {
            const a = hoverSfxRef.current
            if (a) {
              a.currentTime = 0
              a.play().catch(() => { /* tragamos NotAllowedError si ocurre */ })
              lastSfxTsRef.current = now
            }
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

  // Navegación por teclado: WASD / Arrow Keys para mover el hover entre celdas
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // No interferir con inputs, ni cuando estás paneando con Space
      const t = e.target as HTMLElement | null
      if (spaceDownRef.current) return
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return

      let dx = 0, dy = 0
      switch (e.code) {
        case "KeyA":
        case "ArrowLeft":  dx = -1; break
        case "KeyD":
        case "ArrowRight": dx = +1; break
        case "KeyW":
        case "ArrowUp":    dy = -1; break  // fila arriba = r-1
        case "KeyS":
        case "ArrowDown":  dy = +1; break  // fila abajo = r+1
        default: return
      }
      e.preventDefault()

      // Si el botón de “centro” dejó un lock, lo liberamos
      hoverLockRef.current = null

      // Punto de partida: celda actual (o 0,0 si no hay)
      let r = 0, c = 0
      if (hoverKeyRef.current) {
        const [rr, cc] = hoverKeyRef.current.split(":").map(Number)
        r = rr; c = cc
      }

      // Aplicar movimiento
      gotoCell(r + dy, c + dx)
    }

    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])


  // ——— rueda: zoom suave anclado a la celda bajo el cursor
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      const t = e.target as HTMLElement | null
      if (t && t.closest('[data-ui-overlay]')) { e.preventDefault(); return }

      e.preventDefault()

      // si estoy volando al centro, lo cancelo
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
      const target = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTargetRef.current * factor))
      zoomTargetRef.current = target
    }

    el.addEventListener("wheel", onWheel, { passive: false } as any)
    return () => el.removeEventListener("wheel", onWheel as any)
  }, [])

  // ——— click: visor tamaño real
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

  // ——— drop: coloca imagen (máx 1024, sin upscale)
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

  // ——— acción: volar a (0,0)
  const flyHome = () => {
    const app = appRef.current
    const el = containerRef.current
    if (!app || !el) return

    // corto inercia
    inertiaActiveRef.current = false
    velRef.current = { x: 0, y: 0 }

    const w = el.clientWidth
    const h = Math.max(320, el.clientHeight)
    const size = cellPxRef.current * zoomRef.current

    const targetX = 0.5 * size - w / 2
    const targetY = 0.5 * size - h / 2

    flyRef.current = {
      active: true,
      t: 0,
      start: { x: originRef.current.x, y: originRef.current.y },
      target: { x: targetX, y: targetY },
    }

    hoverKeyRef.current = "0:0"
    hoverGrowTRef.current = 0
    hoverGlowTRef.current = 1
    setHoverCoord({ x: 0, y: 0 })
    hoverLockRef.current = "0:0" // bloqueo hover hasta que muevas el mouse
    draw()
  }

  // ——— Pre carga imagen inicial
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
        style={{ cursor }}   // nativo: "default" | "grab" | "grabbing" | "pointer"
      >
        {/* overlay coordenadas (independiente) */}
        <div
          className="absolute left-2 top-2 z-[200] px-2 py-1 rounded-md text-xs text-white bg-black/60 backdrop-blur-sm pointer-events-none"
          style={{ lineHeight: 1.1 }}
        >
          <span className="opacity-70 mr-1">Zona</span>
          <span>({hoverCoord.x}, {hoverCoord.y})</span>
        </div>

        {/* botón centro (ícono) */}
        <button
          data-ui-overlay
          onClick={(e) => { e.stopPropagation(); flyHome() }}
          onMouseDown={(e) => { e.stopPropagation(); e.preventDefault() }}
          onMouseMove={(e) => e.stopPropagation()}
          onWheel={(e) => { e.stopPropagation(); e.preventDefault() }}
          aria-label="Volver a (0,0)"
          title="Volver a (0,0)"
          style={{ cursor: "pointer" }}   // mano nativa del browser
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
        <div
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
          onClick={() => setViewerUrl(null)}
        >
          <img
            src={viewerUrl}
            alt="preview"
            style={{ imageRendering: "pixelated" }}
            className="max-w-[90vw] max-h-[90vh]"
          />
        </div>
      )}
    </>
  )
}
