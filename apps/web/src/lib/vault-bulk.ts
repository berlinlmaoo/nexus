import type { VaultItem } from "@/lib/nexus-api";

// Several vault items at once (owner, 9 Oct 2026: multi-select). The server has no bulk routes and
// does not need them: each item goes through its own PATCH/DELETE, so every rule (who may modify,
// where a folder may go) is checked exactly as for one. A few at a time, never all at once.

export type BulkResult<T> = {
  ok: { item: VaultItem; result: T }[];
  failed: { item: VaultItem; reason: string }[];
};

export async function runBulk<T>(items: VaultItem[], fn: (item: VaultItem) => Promise<T>, concurrency = 3): Promise<BulkResult<T>> {
  const out: BulkResult<T> = { ok: [], failed: [] };
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++];
      try {
        out.ok.push({ item, result: await fn(item) });
      } catch (e) {
        out.failed.push({ item, reason: e instanceof Error ? e.message : String(e) });
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return out;
}

/** "Logo.png — Forbidden; Deck.pdf — …", at most three, for a toast's second line. */
export function failureList(failed: BulkResult<unknown>["failed"]): string {
  const shown = failed.slice(0, 3).map((f) => `${f.item.name} — ${f.reason}`).join("; ");
  return failed.length > 3 ? `${shown}; …` : shown;
}
