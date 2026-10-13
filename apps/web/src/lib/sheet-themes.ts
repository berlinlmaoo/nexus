// Spreadsheet themes (Format ▸ Theme): a font, a text colour, six accent colours (they feed charts,
// tables, alternating colours and the THEME row of every colour picker) and a link colour.
// `name` is the English key; the UI shows t(name). A customised theme is named "Custom".
import type { SheetTheme } from "./sheet-model.ts";

export const DEFAULT_FONT = "Arial";

export const THEMES: SheetTheme[] = [
  { name: "Standard", font: "Arial", text: "#000000", accents: ["#4285f4", "#ea4335", "#fbbc04", "#34a853", "#ff6d01", "#46bdc6"], link: "#1155cc" },
  { name: "Simple Light", font: "Arial", text: "#000000", accents: ["#5b95f9", "#073763", "#4a86e8", "#2e7d9a", "#f6b26b", "#93c47d"], link: "#1155cc" },
  { name: "Simple", font: "Roboto", text: "#212121", accents: ["#26a69a", "#00796b", "#2b78e4", "#f4511e", "#ff8a65", "#90a4ae"], link: "#00796b" },
  { name: "Paradigm", font: "Proxima Nova", text: "#0b3954", accents: ["#0b3954", "#bfd7ea", "#ff5a5f", "#c81d25", "#087e8b", "#e0e0e0"], link: "#087e8b" },
  { name: "Shift", font: "Merriweather", text: "#1b1b1b", accents: ["#f9a825", "#4e342e", "#c62828", "#00838f", "#6a1b9a", "#9e9d24"], link: "#00838f" },
  { name: "Momentum", font: "Montserrat", text: "#263238", accents: ["#ff7043", "#ffca28", "#29b6f6", "#66bb6a", "#ab47bc", "#8d6e63"], link: "#0288d1" },
  { name: "Natural", font: "Lora", text: "#3e2723", accents: ["#6d8b3c", "#a1887f", "#c5a572", "#4e7a58", "#d7a86e", "#8c6d46"], link: "#4e7a58" },
  { name: "Energetic", font: "Oswald", text: "#212121", accents: ["#e91e63", "#ff9800", "#ffeb3b", "#00bcd4", "#8bc34a", "#673ab7"], link: "#e91e63" },
  { name: "Ocean", font: "Open Sans", text: "#102a43", accents: ["#0b6e99", "#2bb3c0", "#1d3557", "#5fa8d3", "#90e0ef", "#457b9d"], link: "#0b6e99" },
  { name: "Warm", font: "Lato", text: "#3b2a20", accents: ["#d35400", "#e67e22", "#c0392b", "#f1c40f", "#a0522d", "#e59866"], link: "#c0392b" },
  { name: "Cheerful", font: "Comfortaa", text: "#2d2d2d", accents: ["#ff595e", "#ffca3a", "#8ac926", "#1982c4", "#6a4c93", "#ff924c"], link: "#1982c4" },
  { name: "Soft", font: "Nunito", text: "#4a4a4a", accents: ["#a3c4f3", "#f1c0e8", "#cfbaf0", "#90dbf4", "#b9fbc0", "#fde4cf"], link: "#5b7fbf" },
  { name: "Forest", font: "PT Serif", text: "#1b2e1f", accents: ["#2d6a4f", "#40916c", "#52b788", "#1b4332", "#95d5b2", "#74a57f"], link: "#2d6a4f" },
  { name: "Vintage", font: "Playfair Display", text: "#3d2c29", accents: ["#a4493d", "#d9a05b", "#5b7065", "#c9b79c", "#7d5a50", "#e5c39c"], link: "#a4493d" },
  { name: "Retro", font: "Courier New", text: "#2b2b2b", accents: ["#e76f51", "#f4a261", "#e9c46a", "#2a9d8f", "#264653", "#b56576"], link: "#2a9d8f" },
  { name: "Coral", font: "Raleway", text: "#2f2f2f", accents: ["#ff6f61", "#ffb5a7", "#6b5b95", "#88b04b", "#f7cac9", "#92a8d1"], link: "#d9534f" },
];

/** Fonts offered in Customise (system-safe first, then the theme fonts). */
export const THEME_FONTS = [...new Set(["Arial", "Roboto", "Calibri", "Georgia", "Times New Roman", "Verdana", ...THEMES.map((t) => t.font ?? DEFAULT_FONT)])];

/** The theme in force: the saved one, or Standard. Missing pieces fall back to Standard's. */
export function resolveTheme(theme: SheetTheme | undefined): Required<SheetTheme> {
  const base = THEMES[0];
  const accents = base.accents.map((c, i) => theme?.accents?.[i] ?? c);
  return {
    name: theme?.name ?? base.name,
    font: theme?.font ?? base.font ?? DEFAULT_FONT,
    text: theme?.text ?? base.text ?? "#000000",
    accents,
    link: theme?.link ?? base.link ?? "#1155cc",
  };
}

/** Same look (ignoring the name)? Used to mark the preset card the current theme matches. */
export function sameTheme(a: SheetTheme | undefined, b: SheetTheme): boolean {
  const x = resolveTheme(a), y = resolveTheme(b);
  return x.font === y.font && x.text === y.text && x.link === y.link && x.accents.join() === y.accents.join();
}
