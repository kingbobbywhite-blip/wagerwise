import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import { Toaster } from "@/components/ui/sonner"
import { SiteHeader } from "@/components/site-header"
import { StoreProvider } from "@/lib/store/provider"
import "./globals.css"

const geist = Geist({ subsets: ["latin"], variable: "--font-geist" })
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" })

export const metadata: Metadata = {
  title: "WagerWise — Basketball Prop Terminal",
  description:
    "Correlation-aware NBA, WNBA and college basketball prop and parlay analysis: devigged fair lines, calibrated probabilities and expected value against real DFS payout tables.",
  // Added to the home screen on iOS, this opens without browser chrome.
  appleWebApp: { capable: true, title: "WagerWise", statusBarStyle: "black-translucent" },
}

export const viewport: Viewport = {
  themeColor: "#0c0f12",
  // The board is a dense table; let it use the full phone screen.
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`dark ${geist.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <StoreProvider>
          <SiteHeader />
          <main className="mx-auto w-full max-w-7xl px-4 py-6 md:px-6 md:py-8">{children}</main>
          <Toaster richColors position="top-right" theme="dark" />
        </StoreProvider>
      </body>
    </html>
  )
}
