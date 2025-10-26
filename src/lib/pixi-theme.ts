// src/lib/pixi-theme.ts
export type Theme = {
  bg: number;            // color de fondo del canvas
  bgAlpha: number;       // alpha del fondo
  grid: number;          // color de líneas de grilla
  gridAlpha: number;     // alpha de grilla
  glow: number;          // color del glow/halo
  frameAlpha: number;    // alpha del contorno fino
  emptyGlowAlpha: number;// alpha del glow cuando no hay imagen
}

// Paleta clara: arena + dorados
export const THEME_LIGHT: Theme = {
  bg: 0xF4EDE1,      // arena
  bgAlpha: 1,
  grid: 0xC8B79D,    // marrón claro
  gridAlpha: 0.55,
  glow: 0xE7B94A,    // dorado
  frameAlpha: 0.75,
  emptyGlowAlpha: 0.9,
}

// Paleta oscura: fondo tenue y glow blanco
export const THEME_DARK: Theme = {
  bg: 0x0B0B0B,
  bgAlpha: 0.08,     // solo un velo sutil
  grid: 0x888888,
  gridAlpha: 0.35,
  glow: 0xFFFFFF,    // blanco
  frameAlpha: 0.55,
  emptyGlowAlpha: 0.85,
}

// Next Themes nos da el modo, lo guardamos aquí para que lo lea draw()
export const themeModeRef = { current: "light" as "light" | "dark" }

export const getTheme = () =>
  themeModeRef.current === "dark" ? THEME_DARK : THEME_LIGHT
