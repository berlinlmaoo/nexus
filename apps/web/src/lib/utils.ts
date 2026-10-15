import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A title for a clamped line: a spaced dash ("Gaji Clippers – Cymenggs") is glued to the word AFTER it (word
 * joiner, plus a no-break space where the title had a space), so a line never ends with the dash and a clamp
 * never reads "Clippers –…" (UI tour run 17, R17-WM-2, decision 14). Every variant counts (UI tour run 18,
 * R18-WM-1, decision 4): hyphen, en dash, em dash or minus; any whitespace before it (NBSP and wide spaces
 * too, any count) and any or none after it ("ARCHIVE -INVOICE" broke after the hyphen). The spaces before
 * become one ordinary space, so the line may still break before the dash. Gluing it to the word before (run
 * 16) only moved the dash to the end of the clamped line. Idempotent; display only, the stored title is
 * unchanged. A dash inside a word ("PATS-UNIV") is left alone.
 */
export function glueDash(text: string): string {
  return text.replace(/\s+([-\u2010-\u2015\u2212])\u2060?(\s*)(?=\S)/g, (_m, dash: string, after: string) => ` ${dash}\u2060${after ? "\u00a0" : ""}`);
}
