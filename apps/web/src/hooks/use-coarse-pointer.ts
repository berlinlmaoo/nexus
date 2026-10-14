import { useSyncExternalStore } from "react";

/**
 * Whether the main pointer is a finger (phone, tablet), for the words a hint uses: "Tap a day…" on a touch
 * screen, "Click a day…" with a mouse or trackpad (UI tour run 13, W-D6: desktop web said "Tap").
 */
const QUERY = "(pointer: coarse)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useCoarsePointer(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && !!window.matchMedia?.(QUERY).matches,
    () => false,
  );
}
