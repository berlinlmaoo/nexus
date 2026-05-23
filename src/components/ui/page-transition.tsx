"use client"

import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"

interface PageTransitionProps {
  children: React.ReactNode
}

export function PageTransition({ children }: PageTransitionProps) {
  const pathname = usePathname()
  const [reduceMotion, setReduceMotion] = useState(false)
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)")
    const syncPreference = () => setReduceMotion(mediaQuery.matches)

    syncPreference()
    mediaQuery.addEventListener("change", syncPreference)

    return () => mediaQuery.removeEventListener("change", syncPreference)
  }, [])

  useEffect(() => {
    if (reduceMotion) {
      setVisible(true)
      return
    }

    setVisible(false)
    const frame = requestAnimationFrame(() => setVisible(true))

    return () => cancelAnimationFrame(frame)
  }, [pathname, reduceMotion])

  return (
    <div
      className={`min-h-full transition-[opacity,transform] duration-200 ease-out ${visible ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"}`}
    >
      {children}
    </div>
  )
}
