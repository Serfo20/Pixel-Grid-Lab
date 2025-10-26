import "./globals.css"
import { ThemeProvider } from "next-themes"
import type { Metadata } from "next"


export const metadata: Metadata = { title: "Pixel Grid Lab" }


export default function RootLayout({ children }: { children: React.ReactNode }) {
return (
<html lang="es" suppressHydrationWarning>
<body className="min-h-screen bg-background text-foreground antialiased">
<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
{children}
</ThemeProvider>
</body>
</html>
)
}