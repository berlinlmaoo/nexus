import { useSyncExternalStore } from "react";

/**
 * The state of one suggestion popup (the "/" menu or the "@" menu) of one editor, written by the TipTap
 * Suggestion plugin's render callbacks and read by a React component. Keeps the popup in the editor's
 * React tree (theme, language, portals) instead of a separate ReactRenderer root.
 */
export type MenuState<I> = {
  open: boolean;
  items: I[];
  query: string;
  index: number;
  rect: DOMRect | null;
  pick: ((item: I) => void) | null;
};

export type MenuStore<I> = {
  get: () => MenuState<I>;
  set: (patch: Partial<MenuState<I>>) => void;
  subscribe: (f: () => void) => () => void;
  /** Arrow keys / Enter / Escape while the popup is open. True = handled. */
  key: (e: KeyboardEvent) => boolean;
};

export function createMenuStore<I>(): MenuStore<I> {
  let state: MenuState<I> = { open: false, items: [], query: "", index: 0, rect: null, pick: null };
  const listeners = new Set<() => void>();
  const store: MenuStore<I> = {
    get: () => state,
    set: (patch) => {
      state = { ...state, ...patch };
      if (state.index >= state.items.length) state.index = Math.max(0, state.items.length - 1);
      listeners.forEach((f) => f());
    },
    subscribe: (f) => {
      listeners.add(f);
      return () => { listeners.delete(f); };
    },
    key: (e) => {
      if (!state.open) return false;
      const n = state.items.length;
      if (e.key === "ArrowDown") {
        if (n) store.set({ index: (state.index + 1) % n });
        return true;
      }
      if (e.key === "ArrowUp") {
        if (n) store.set({ index: (state.index - 1 + n) % n });
        return true;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        const item = state.items[state.index];
        if (item && state.pick) {
          state.pick(item);
          return true;
        }
        return false;
      }
      if (e.key === "Escape") {
        store.set({ open: false });
        return true;
      }
      return false;
    },
  };
  return store;
}

export function useMenu<I>(store: MenuStore<I>): MenuState<I> {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
