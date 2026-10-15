import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A title for a clamped line: a spaced dash ("Gaji Clippers – Cymenggs") is glued to the word AFTER it (word
 * joiner + no-break space), so a line never ends with the dash and a clamp never reads "Clippers –…" (UI tour
 * run 17, R17-WM-2, decision 14). Gluing it to the word before (run 16) only moved the dash to the end of the
 * clamped line. The line may break before the dash. Display only; the stored title is unchanged.
 */
export function glueDash(text: string): string {
  return text.replace(/ ([-–—]) (?=\S)/g, " $1\u2060\u00a0");
}
