// src/app/page.tsx
"use client"
import PixiGrid from "@/components/pixi-grid"
import { ThemeToggle } from "@/components/theme-toggle"

export default function Page() {
  return (
    <main className="min-h-dvh grid grid-rows-[auto_1fr_auto]">
      <header className="px-4 md:px-6 py-3 flex items-center justify-between">
        <h1 className="text-xl font-semibold">Pixel Grid Lab</h1>
        <ThemeToggle />
      </header>

      {/* Contenido central: SIN scroll horizontal, Pixi toma 100% del alto disponible */}
      <section className="px-4 md:px-6 pb-4 md:pb-6 min-h-0">
        <div className="h-full overflow-hidden rounded-2xl border">
          <PixiGrid />
        </div>
      </section>

      <footer className="px-4 md:px-6 py-3 text-xs text-muted-foreground">
        🎨 Paletas: DB16 (DawnBringer) y RGB332. Gracias a shadcn/ui, PixiJS, Zustand, TailwindCSS, Next.js.
      </footer>
    </main>
  )
}
