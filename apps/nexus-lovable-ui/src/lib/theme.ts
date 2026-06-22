import { useEffect, useState } from "react";

// Light/dark theme. The dark token palette already lives in styles.css (.dark {…}); this just toggles
// the `.dark` class on <html>, persists the choice, and follows the OS until the user picks explicitly.
export type Theme = "light" | "dark";
const KEY = "nexus-theme";
const listeners = new Set<(t: Theme) => void>();

function systemDark(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** The theme to show right now: an explicit saved choice, else the OS preference. */
export function resolvedTheme(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch { /* ignore */ }
  return systemDark() ? "dark" : "light";
}

function apply(t: Theme) {
  if (typeof document !== "undefined") document.documentElement.classList.toggle("dark", t === "dark");
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(KEY, t); } catch { /* ignore */ }
  apply(t);
  listeners.forEach((l) => l(t));
}

/** Theme state + a light/dark toggle, kept in sync across every hook instance. */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>(() => resolvedTheme());

  useEffect(() => {
    const onChange = (t: Theme) => setThemeState(t);
    listeners.add(onChange);
    // Follow the OS only while the user hasn't picked an explicit theme.
    const mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    const onSystem = () => {
      try {
        if (!localStorage.getItem(KEY)) {
          const t: Theme = systemDark() ? "dark" : "light";
          apply(t);
          setThemeState(t);
        }
      } catch { /* ignore */ }
    };
    mq?.addEventListener("change", onSystem);
    return () => { listeners.delete(onChange); mq?.removeEventListener("change", onSystem); };
  }, []);

  const toggle = () => setTheme(theme === "dark" ? "light" : "dark");
  return { theme, isDark: theme === "dark", toggle, setTheme };
}
