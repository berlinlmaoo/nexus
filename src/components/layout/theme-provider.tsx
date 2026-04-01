"use client"

import { createContext, useContext, useEffect, useState } from "react"

type Theme = "light"

interface ThemeContextValue {
  theme: Theme
  setTheme: (theme: Theme) => void
  resolvedTheme: "light"
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "light",
  setTheme: () => {},
  resolvedTheme: "light",
})

export function useTheme() {
  return useContext(ThemeContext)
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const root = document.documentElement
    root.classList.remove("dark")
    root.classList.add("light")
    localStorage.setItem("nexus-theme", "light")
  }, [])

  const setTheme = () => {
    // Theme is locked to light
  }

  return (
    <ThemeContext.Provider value={{ theme: "light", setTheme, resolvedTheme: "light" }}>
      {children}
    </ThemeContext.Provider>
  )
}
