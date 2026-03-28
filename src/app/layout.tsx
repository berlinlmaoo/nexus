import type { Metadata } from "next"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/components/layout/theme-provider"
import { Toaster } from "sonner"
import "./globals.css"

export const metadata: Metadata = {
  title: "NEXUS - Navigation & Execution Hub for Unified Strategy",
  description:
    "NEXUS is a modern project management platform for agile teams to plan, track, and deliver work efficiently.",
  icons: {
    icon: [
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
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            {children}
            <Toaster position="bottom-right" richColors closeButton />
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
