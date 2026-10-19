import { useEffect, useSyncExternalStore } from "react";

/**
 * One app-level modal at a time (QA final 19 Oct 2026, C-D1: the App Store promo and "XP cut" opened on top
 * of each other on the first visit).
 *
 * Each start-up modal reports whether it wants to show ("want"), is still loading what decides that
 * ("pending"), or has nothing to show ("idle"). The modal with the lowest order among the wanting/pending
 * ones gets the turn — but only once it actually wants it: a pending modal ahead in the queue holds the
 * ones behind it back, so a promo never flashes up and then vanishes when the XP alert's data arrives.
 * The modal on screen keeps its turn until it closes (no pre-emption).
 *
 * Order (lower first): XP cut 10 · announcement / warning letter 20 · attendance reminder 30 · App Store 40.
 * iOS/Android follow the same order for their start-up sheets.
 */
export type ModalState = "want" | "pending" | "idle";
export const MODAL_ORDER = { xpPenalty: 10, announcement: 20, attendanceReminder: 30, appStore: 40 } as const;

const entries = new Map<string, { order: number; state: ModalState }>();
let holder: string | null = null;
const listeners = new Set<() => void>();

function recompute() {
  if (holder && entries.get(holder)?.state !== "want") holder = null;
  if (!holder) {
    const next = [...entries.entries()]
      .filter(([, e]) => e.state !== "idle")
      .sort((a, b) => a[1].order - b[1].order)[0];
    if (next && next[1].state === "want") holder = next[0];
  }
  listeners.forEach((l) => l());
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

/** True when this modal may be on screen now. */
export function useModalTurn(id: keyof typeof MODAL_ORDER, state: ModalState): boolean {
  useEffect(() => {
    entries.set(id, { order: MODAL_ORDER[id], state });
    recompute();
  }, [id, state]);
  useEffect(() => () => { entries.delete(id); recompute(); }, [id]);
  return useSyncExternalStore(subscribe, () => holder === id, () => false);
}
