import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * A title for a clamped line: a spaced dash ("Gaji Clippers - Cymenggs") is glued to the word before it with a
 * no-break space, so a wrapped line never starts with a lone dash that the clamp then ends with "…"
 * ("–…", UI tour run 16, R16-WM-1). Display only; the stored title is unchanged.
 */
export function glueDash(text: string): string {
  return text.replace(/ ([-–—]) /g, " $1 ");
}
