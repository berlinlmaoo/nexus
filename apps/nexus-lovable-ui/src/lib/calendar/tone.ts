import { useEffect, useState } from "react";

/**
 * Colour tones that must read the same on every screen: a task's priority, its status, and whether an
 * IP logo is light or dark. One copy here, used by the Calendar, the Bagan and My Mission (impeccable
 * audit, Oct 2026: HIGH was amber on the Calendar but red in My Mission, and the logo check was written
 * twice with different thresholds).
 */

// ── Priority ───────────────────────────────────────────────────────────────────────────────────────

export type PriorityLevel = "urgent" | "high" | "medium" | "low";

/**
 * The app's majority mapping (folders, project calendar, person reports): URGENT red, HIGH amber,
 * MEDIUM blue, LOW / none quiet. Chip text comes from the Tailwind ramps, not text-destructive /
 * text-warning: those token colours are only 2.2–3.8:1 as small text on white, and chip text stays
 * at 4.5:1 or more in both themes.
 */
const PRIORITY_CHIP: Record<PriorityLevel, string> = {
  urgent: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  high: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  medium: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  low: "bg-muted text-muted-foreground",
};

/** URGENT / HIGH / MEDIUM / anything else, from whatever casing or label the API sends. */
export function priorityLevel(priority?: string | null): PriorityLevel {
  const p = (priority ?? "").toUpperCase();
  if (p.includes("URGENT")) return "urgent";
  if (p.includes("HIGH")) return "high";
  if (p.includes("MEDIUM")) return "medium";
  return "low";
}

/** Background + text classes for a priority chip. */
export function priorityTone(priority?: string | null): string {
  return PRIORITY_CHIP[priorityLevel(priority)];
}

// ── Status ─────────────────────────────────────────────────────────────────────────────────────────

/** The slate of an open task (its ring, the "no status" diamond); also the label of a group ribbon. */
export const SLATE = {
  text: "text-[#5a6b83] dark:text-[#9fb0c8]",
  border: "border-[#5a6b83] dark:border-[#9fb0c8]",
  bg: "bg-[#5a6b83] dark:bg-[#9fb0c8]",
} as const;

export const STATUS = {
  /** The filled "done" disc; its tick is success-foreground (3.3:1 light, 9.8:1 dark). */
  doneFill: "bg-success text-success-foreground",
  /** A done subtask's dot. */
  doneDot: "border-success bg-success",
  /** An open task. */
  todoRing: SLATE.border,
  /**
   * Overdue for longer than the window: told apart by its dashed shape, in a colour that keeps 3:1
   * against the card (the old light grey ring was 2.5:1, and 1.9:1 once the row was faded).
   */
  staleRing: "border-dashed border-control-border",
  /** "Overdue" as text: 5.7:1 on the rose rail, 6.3:1 on the dark card. */
  overdueText: "text-rose-700 dark:text-rose-400",
  overdueIcon: "text-rose-600 dark:text-rose-400",
} as const;

/** Background + text classes for a task status chip (task preview). */
export function statusTone(status?: string | null): string {
  return status === "DONE"
    ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300"
    : "bg-muted text-foreground";
}

// ── Logos ──────────────────────────────────────────────────────────────────────────────────────────

const logoTones = new Map<string, "light" | "dark">();

/**
 * Whether a logo is mostly light (white text on a transparent PNG) or dark, from its own pixels, so it
 * gets a tile it can be read on: light logos on navy, dark ones on white (owner, 30 Sep 2026: a white
 * logo vanished on the white tile). `null` until it is known or when the pixels cannot be read; callers
 * then use the white tile. Cached per URL for the whole app.
 */
export function useLogoTone(url: string | null): "light" | "dark" | null {
  const [tone, setTone] = useState<"light" | "dark" | null>(() => (url ? logoTones.get(url) ?? null : null));
  useEffect(() => {
    if (!url) { setTone(null); return; }
    const known = logoTones.get(url);
    if (known) { setTone(known); return; }
    let live = true;
    const img = new Image();
    // Logos on another origin can only be read when they are fetched with CORS.
    img.crossOrigin = "anonymous";
    img.onload = async () => {
      try {
        // Decoded off the main thread first: a synchronous drawImage of an undecoded logo froze the
        // page for ~370 ms per large logo (Impeccable audit, 6 Oct 2026).
        await img.decode().catch(() => undefined);
        if (!live) return;
        const c = document.createElement("canvas");
        c.width = c.height = 32;
        const g = c.getContext("2d", { willReadFrequently: true });
        if (!g) return;
        g.drawImage(img, 0, 0, 32, 32);
        const d = g.getImageData(0, 0, 32, 32).data;
        let sum = 0;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] / 255 < 0.2) continue;
          sum += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
          n++;
        }
        const t: "light" | "dark" = n > 0 && sum / n > 0.72 ? "light" : "dark";
        logoTones.set(url, t);
        if (live) setTone(t);
      } catch { /* tainted canvas: keep the white tile */ }
    };
    img.src = url;
    return () => { live = false; };
  }, [url]);
  return tone;
}
