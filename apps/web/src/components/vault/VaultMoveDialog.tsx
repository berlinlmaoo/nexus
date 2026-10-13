import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChevronRight, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { nexusApi, type VaultItem } from "@/lib/nexus-api";
import { runBulk, type BulkResult } from "@/lib/vault-bulk";

// ─────────────────────────────────────────────────────────────────────────────
// "Move to…" (owner, 9 Oct 2026: the INTOO folder had to come out of LOGO). The path that works
// with a keyboard, on a phone and on a tablet, where dragging does not. Browses the vault one folder
// at a time like the page does, starting where the item is, with the path above to walk back up;
// "Move here" puts it in the folder on screen, and "Vault" is the top level.
//
// The items themselves are never listed, so neither they nor anything inside them can be reached. The
// server checks that again, along with write access to the destination, and its refusal is what is
// shown. Several items (multi-select, 9 Oct 2026) go one PATCH each, a few at a time; when some move
// and some are refused the dialog closes and the page reports both.
// ─────────────────────────────────────────────────────────────────────────────

type Props = {
  /** What is being moved; null or empty = closed. */
  items: VaultItem[] | null;
  onClose: () => void;
  onMoved: (result: BulkResult<VaultItem>, destination: string) => void;
};

export function VaultMoveDialog({ items, onClose, onMoved }: Props) {
  const { t, tn, lang } = useLang();
  const [browse, setBrowse] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const open = !!items && items.length > 0;
  const first = open ? items[0] : null;

  // Each time it opens: start in the folder the (first) item is in.
  useEffect(() => {
    if (first) { setBrowse(first.parentId); setProblem(null); }
  }, [first]);

  const listing = useQuery({
    queryKey: ["vault", "picker", browse ?? "root"],
    queryFn: () => nexusApi.vaultList({ parentId: browse }),
    enabled: open,
  });

  const move = useMutation({
    mutationFn: (to: string | null) =>
      runBulk((items ?? []).filter((i) => i.parentId !== to), (i) => nexusApi.vaultUpdateItem(i.id, { parentId: to })),
    onSuccess: (result) => {
      // Nothing moved: stay open and say why, as for one item.
      if (result.ok.length === 0 && result.failed.length > 0) { setProblem(result.failed[0].reason); return; }
      const here = listing.data?.breadcrumb;
      onMoved(result, browse !== null && here && here.length > 0 ? here[here.length - 1].name : t("Vault"));
    },
    onError: (e: Error) => setProblem(e.message),
  });

  const movingIds = new Set((items ?? []).map((i) => i.id));
  const folders = (listing.data?.items ?? []).filter((f) => f.kind === "FOLDER" && !movingIds.has(f.id));
  const isHome = open && (items ?? []).every((i) => i.parentId === browse);
  const canWrite = listing.data?.canWrite ?? false;
  const trail = listing.data?.breadcrumb ?? [];
  const many = (items?.length ?? 0) > 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent lang={lang} className="max-w-md gap-3 p-0 sm:p-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pr-12">
          <DialogTitle className="truncate">
            {many ? tn(items!.length, "Move {n} item", "Move {n} items") : t("Move “{name}”", { name: first?.name ?? "" })}
          </DialogTitle>
          <DialogDescription>{many ? t("Pick the folder they go into. Vault is the top level.") : t("Pick the folder it goes into. Vault is the top level.")}</DialogDescription>
        </DialogHeader>

        <nav aria-label={t("Folder path")} className="px-5 flex items-center gap-1 text-sm flex-wrap">
          <button
            type="button"
            className={cn("rounded px-1 py-0.5 hover:bg-muted", browse === null ? "font-medium" : "text-muted-foreground")}
            onClick={() => { setBrowse(null); setProblem(null); }}
            aria-current={browse === null ? "location" : undefined}
          >
            {t("Vault")}
          </button>
          {browse !== null && trail.map((c, i) => (
            <span key={c.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden />
              <button
                type="button"
                className={cn("rounded px-1 py-0.5 hover:bg-muted truncate max-w-[12rem]", i === trail.length - 1 ? "font-medium" : "text-muted-foreground")}
                onClick={() => { setBrowse(c.id); setProblem(null); }}
                aria-current={i === trail.length - 1 ? "location" : undefined}
              >
                {c.name}
              </button>
            </span>
          ))}
        </nav>

        <div className="mx-5 rounded-lg border border-border max-h-[50vh] min-h-[8rem] overflow-y-auto">
          {listing.isLoading ? (
            <div className="grid place-items-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>
          ) : listing.isError ? (
            <p className="p-4 text-sm text-destructive">{(listing.error as Error).message}</p>
          ) : folders.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">{t("No folders in here.")}</p>
          ) : (
            <ul className="divide-y divide-border">
              {folders.map((f) => (
                <li key={f.id}>
                  <button
                    type="button"
                    className="w-full min-h-11 flex items-center gap-3 px-3 py-2 text-left hover:bg-muted focus-visible:bg-muted outline-none"
                    onClick={() => { setBrowse(f.id); setProblem(null); }}
                  >
                    <Folder className="h-4 w-4 text-primary shrink-0" aria-hidden />
                    <span className="flex-1 truncate text-sm">{f.name}</span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="px-5 min-h-5 text-xs" aria-live="polite">
          {problem ? (
            <p className="text-destructive">{problem}</p>
          ) : isHome ? (
            <p className="text-muted-foreground">{many ? t("They're already in this folder.") : t("It's already in this folder.")}</p>
          ) : listing.data && !canWrite ? (
            <p className="text-muted-foreground">{t("You can't add to this folder.")}</p>
          ) : null}
        </div>

        <DialogFooter className="px-5 pb-5 gap-2">
          <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
          <Button
            disabled={!open || isHome || !listing.data || !canWrite || move.isPending}
            onClick={() => { setProblem(null); move.mutate(browse); }}
          >
            {move.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Move here")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
