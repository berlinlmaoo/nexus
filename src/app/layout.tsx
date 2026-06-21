import type { Metadata, Viewport } from "next"
import { Plus_Jakarta_Sans, Inter } from "next/font/google"
import { HeroUIProvider } from "@/components/providers/heroui-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { ThemeProvider } from "@/components/layout/theme-provider"
import { Toaster } from "sonner"
import "./globals.css"

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  weight: ["400", "500", "600", "700", "800"],
})

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  weight: ["300", "400", "500", "600"],
})

const themeInitScript = `
(function() {
  try {
    var storedTheme = localStorage.getItem("nexus-theme");
    var theme = storedTheme === "light" || storedTheme === "dark" || storedTheme === "system" ? storedTheme : "system";
    var resolvedTheme = theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme === "dark" ? "dark" : "light";
    var root = document.documentElement;
    root.classList.remove("light", "dark");
    root.classList.add(resolvedTheme);
    root.dataset.theme = theme;
    root.style.colorScheme = resolvedTheme;
  } catch (error) {
    document.documentElement.classList.add("light");
  }
})();
`

export const metadata: Metadata = {
  metadataBase: new URL("https://nexus.patsgroup.id"),
  title: "NEXUS - Navigation & Execution Hub for Unified Strategy",
  description:
    "NEXUS is a modern project management platform for agile teams to plan, track, and deliver work efficiently.",
  applicationName: "NEXUS",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "NEXUS",
  },
  formatDetection: {
    telephone: false,
  },
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#f7f9fb",
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html
      lang="en"
      className={`${plusJakarta.variable} ${inter.variable}`}
      suppressHydrationWarning
    >
      <body className="font-body antialiased bg-background text-foreground">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <ThemeProvider>
          <HeroUIProvider>
            <TooltipProvider delayDuration={200}>
              {children}
              <Toaster 
                position="bottom-right"
                mobileOffset={{
                  bottom: "calc(5.75rem + env(safe-area-inset-bottom))",
                  left: "0.75rem",
                  right: "0.75rem",
                }}
                offset={{ bottom: "1.5rem", right: "1.5rem" }}
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
          </HeroUIProvider>
        </ThemeProvider>
      </body>
    </html>
  )
}
