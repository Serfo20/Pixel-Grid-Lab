import { nearestDB16, PaletteMode, toRGB332 } from "./palettes"

export interface PixelateOpts {
  maxWidth?: number   // límite superior (por defecto 1024)
  noUpscale?: boolean // evita escalar hacia arriba (por defecto true)
}

export async function pixelateFile(file: File, opts?: PixelateOpts): Promise<HTMLCanvasElement> {
  const img = await fileToImage(file)
  return pixelateImage(img, opts)
}

export function pixelateImage(img: HTMLImageElement | HTMLCanvasElement, opts?: PixelateOpts): HTMLCanvasElement {
  const maxWidth = opts?.maxWidth ?? 1024
  const noUpscale = opts?.noUpscale ?? true

  const iw = (img as any).width as number
  const ih = (img as any).height as number

  // ancho destino: limita por maxWidth y opcionalmente evita upscale
  const targetW = noUpscale ? Math.min(iw, maxWidth) : Math.min(maxWidth, Math.max(iw, maxWidth))
  const targetH = Math.round(ih * (targetW / iw))

  // si ya está bajo el límite, devuelvo un canvas 1:1 (sin upscale)
  if (iw <= maxWidth && noUpscale) {
    const out = document.createElement("canvas")
    out.width = iw
    out.height = ih
    const ctx = out.getContext("2d", { willReadFrequently: true })!
    ctx.imageSmoothingEnabled = false
    ctx.drawImage(img as CanvasImageSource, 0, 0)
    return out
  }

  // downscale → nearest neighbor
  const out = document.createElement("canvas")
  out.width = targetW
  out.height = targetH
  const ctx = out.getContext("2d", { willReadFrequently: true })!
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(img as CanvasImageSource, 0, 0, targetW, targetH)
  return out
}

function fileToImage(file: File): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => { URL.revokeObjectURL(url); res(img) }
    img.onerror = rej
    img.src = url
  })
}
