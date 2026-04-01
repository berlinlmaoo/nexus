import type { Metadata } from "next"
import { Manrope, Inter } from "next/font/google"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/components/layout/theme-provider"
import { Toaster } from "sonner"
import "./globals.css"

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["400", "500", "600", "700", "800"],
})

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["300", "400", "500", "600"],
})

export const metadata: Metadata = {
  title: "NEXUS - Navigation & Execution Hub for Unified Strategy",
  description:
    "NEXUS is a modern project management platform for agile teams to plan, track, and deliver work efficiently.",
  icons: {
    icon: [
      { url: "/favicon.png", type: "image/png" },
      { url: "/logos/nexus-icon-black.png", type: "image/png" },
    ],
    apple: [
      { url: "/logos/nexus-icon-black.png", type: "image/png" },
    ],
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${inter.variable}`} suppressHydrationWarning>
      <body className="font-body antialiased bg-background text-foreground">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster 
              position="bottom-right" 
              expand={false}
              visibleToasts={5}
              richColors 
              closeButton
              toastOptions={{
                className: "bg-surface-container-highest border-none rounded-[20px] shadow-2xl shadow-primary/10 p-4 font-headline",
                classNames: {
                  title: "font-black uppercase tracking-widest text-[11px] text-primary",
                  description: "text-xs font-medium text-on-surface-variant/60",
                  actionButton: "bg-primary text-primary-foreground rounded-xl font-black uppercase tracking-widest text-[9px]",
                  cancelButton: "bg-surface-container-low text-on-surface-variant/40 rounded-xl font-black uppercase tracking-widest text-[9px]",
                }
              }}
            />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
