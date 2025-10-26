// src/lib/pixi-theme.ts
export type Theme = {
  bg: number; bgAlpha: number
  grid: number; gridAlpha: number
  glow: number; frameAlpha: number; emptyGlowAlpha: number
  // Opcional: si planeas dar “lift” solo en dark, déjalo. Si no lo usas, quítalo.
  visibleLift?: number
}

export const THEME_LIGHT: Theme = {
  bg: 0xF2EBDD, bgAlpha: 1,
  grid: 0xC9BDA7, gridAlpha: 0.55,
  glow: 0xE7B94A, frameAlpha: 0.70, emptyGlowAlpha: 0.90,
  // visibleLift: 0, // si quieres especificarlo
}

export const THEME_DARK: Theme = {
  bg: 0x0B0B0B, bgAlpha: 0.12,
  grid: 0x6B6B6B, gridAlpha: 0.28,
  glow: 0xFFFFFF, frameAlpha: 0.50, emptyGlowAlpha: 0.85,
  // visibleLift: 0.06, // si decides usar ese “lift” en dark
}

export const themeModeRef = { current: 'light' as 'light' | 'dark' }
export const getTheme = () =>
  (themeModeRef.current === 'dark' ? THEME_DARK : THEME_LIGHT)
