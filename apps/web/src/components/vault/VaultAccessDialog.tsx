import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useLang } from "@/lib/lang";
import { nexusApi, type VaultItem } from "@/lib/nexus-api";

// ─────────────────────────────────────────────────────────────────────────────
// Who may open a vault folder or file, and who may add to a folder (9 Oct 2026). The server has had
// the thresholds since the vault began (PATCH minReadRole / minWriteRole, BoD only — canManageAccess);
// this is the first screen that sets them.
//
// Three choices, not four: the server stores "everyone" as no lock of its own (null), which means
// "as the folder above" — at the top level that IS everyone. A lock applies to everything inside it,
// and nothing inside can be opened wider than its folder.
// ─────────────────────────────────────────────────────────────────────────────

const INHERIT = "INHERIT";
type Choice = typeof INHERIT | "MANAGER_PLUS" | "BOD_PLUS";

export function VaultAccessDialog({ item, onClose, onSaved }: { item: VaultItem | null; onClose: () => void; onSaved: (item: VaultItem) => void }) {
  const { lang } = useLang();
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent lang={lang} className="max-w-md">
        {item && <AccessBody key={item.id} item={item} onClose={onClose} onSaved={onSaved} />}
      </DialogContent>
    </Dialog>
  );
}

function AccessBody({ item, onClose, onSaved }: { item: VaultItem; onClose: () => void; onSaved: (item: VaultItem) => void }) {
  const { t } = useLang();
  const isFolder = item.kind === "FOLDER";
  const initialRead = (item.minReadRole as Choice | null) ?? INHERIT;
  const initialWrite = (item.minWriteRole as Choice | null) ?? INHERIT;
  const [read, setRead] = useState<Choice>(initialRead);
  const [write, setWrite] = useState<Choice>(initialWrite);

  const save = useMutation({
    mutationFn: () => {
      const body: { minReadRole?: string | null; minWriteRole?: string | null } = {};
      if (read !== initialRead) body.minReadRole = read === INHERIT ? null : read;
      if (isFolder && write !== initialWrite) body.minWriteRole = write === INHERIT ? null : write;
      return nexusApi.vaultUpdateItem(item.id, body);
    },
    onSuccess: (updated) => { toast.success(t("Access saved")); onSaved(updated); },
    onError: (e: Error) => toast.error(t("Couldn't save the access"), { description: e.message }),
  });

  const inheritLabel = item.parentId ? t("Same as the folder above") : t("Everyone in the company");
  const options = (
    <>
      <SelectItem value={INHERIT}>{inheritLabel}</SelectItem>
      <SelectItem value="MANAGER_PLUS">{t("Managers and above")}</SelectItem>
      <SelectItem value="BOD_PLUS">{t("BoD and above")}</SelectItem>
    </>
  );
  const changed = read !== initialRead || (isFolder && write !== initialWrite);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-8">{t("Access to “{name}”", { name: item.name })}</DialogTitle>
        <DialogDescription>
          {isFolder
            ? t("A lock applies to everything inside this folder. Something inside it can be locked further, never opened wider.")
            : t("Who in the company can see and open this file.")}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-sm font-medium" htmlFor="vault-access-read">{isFolder ? t("Who can open it") : t("Who can open this file")}</label>
          <Select value={read} onValueChange={(v) => setRead(v as Choice)}>
            <SelectTrigger id="vault-access-read"><SelectValue /></SelectTrigger>
            <SelectContent>{options}</SelectContent>
          </Select>
        </div>
        {isFolder && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="vault-access-write">{t("Who can add files")}</label>
            <Select value={write} onValueChange={(v) => setWrite(v as Choice)}>
              <SelectTrigger id="vault-access-write"><SelectValue /></SelectTrigger>
              <SelectContent>{options}</SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t("Whoever uploaded a file can still rename, move or delete it.")}</p>
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("Links already sent follow the lock too: an outside link shows only what its maker may still see.")}</p>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>{t("Cancel")}</Button>
        <Button disabled={!changed || save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Save")}
        </Button>
      </DialogFooter>
    </>
  );
}
