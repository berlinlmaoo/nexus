import { createContext, useContext, useSyncExternalStore } from "react";
import { useLang, type Lang } from "@/lib/lang";
import { fmtIdr as fmtIdrReal, fmtIdrFull as fmtIdrFullReal } from "./pipeline-ui";

/**
 * Presentation mode (Control Tower v7, 20 Oct 2026, asked by the CEO): one eye toggle in the pipeline
 * header hides every rupiah on screen — cards, KPI strip, table, health view, deal drawer, history —
 * so the board can be shown on a big screen. Money fields read "Rp ••••" and are locked, and the real
 * cost & margin section is not rendered at all. It is a screen mask only: the Excel export still has
 * the real numbers. Never remembered: every page load starts with it off, so nobody forgets it is on.
 */
export const MONEY_MASK = "Rp ••••";

export const PresentationContext = createContext(false);

/**
 * The mode's on/off, kept in memory for the open tab (Control Tower v8, owner 21 Oct 2026): it stays on when
 * moving between boards, into All Pipelines and back, so a screen being shown never flashes the numbers. Still
 * never stored: a reload starts with it off.
 */
let presentingNow = false;
const listeners = new Set<() => void>();
export function setPresentingMode(on: boolean) {
  if (presentingNow === on) return;
  presentingNow = on;
  for (const l of listeners) l();
}
export function usePresentingMode(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => presentingNow,
    () => false,
  );
  return [on, setPresentingMode];
}

export function usePresenting(): boolean {
  return useContext(PresentationContext);
}

/**
 * The pipeline's money formatters, masked while presenting. Same signatures as pipeline-ui's, so a
 * component swaps its import for `const { fmtIdr, fmtIdrFull } = useMoneyFmt()` and nothing else.
 */
export function useMoneyFmt() {
  const hidden = usePresenting();
  const { lang } = useLang();
  return {
    hidden,
    fmtIdr: (n: number | null | undefined, l: Lang = lang) => (hidden ? MONEY_MASK : fmtIdrReal(n, l)),
    fmtIdrFull: (n: number | null | undefined, l: Lang = lang) => (hidden ? MONEY_MASK : fmtIdrFullReal(n, l)),
  };
}
