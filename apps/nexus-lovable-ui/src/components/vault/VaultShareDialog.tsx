import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Copy, Globe, Link2, Loader2, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { nexusApi, type VaultItem, type VaultShare, type VaultShareExpiry } from "@/lib/nexus-api";
import { copyText } from "@/lib/vault-media";

// ─────────────────────────────────────────────────────────────────────────────
// Sharing one file or folder (owner, 9 Oct 2026: "harusnya bisa share link external untuk diliat
// org" — it could, but nobody found it). The first thing the dialog asks is WHO may open the link,
// in those words, with both answers on screen; a person who may not make an outside link is told so
// before they pick it, not after the server refuses. Every link made for the item is listed with
// when it runs out, whether it downloads, who made it and how often it was opened.
//
// The body is keyed on the item, so opening the dialog for the next file starts from the defaults
// instead of whatever was picked for the last one.
// ─────────────────────────────────────────────────────────────────────────────

const EXPIRY_OPTIONS: { value: VaultShareExpiry; label: string }[] = [
  { value: "3d", label: "3 days" },
  { value: "7d", label: "7 days" },
  { value: "14d", label: "2 weeks" },
  { value: "30d", label: "1 month" },
  { value: "permanent", label: "Permanent" },
];

type Audience = "internal" | "external";

export function VaultShareDialog({ item, onClose }: { item: VaultItem | null; onClose: () => void }) {
  const { lang } = useLang();
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent lang={lang} className="max-w-lg max-h-[92vh] overflow-y-auto">
        {item && <ShareBody key={item.id} item={item} />}
      </DialogContent>
    </Dialog>
  );
}

function ShareBody({ item }: { item: VaultItem }) {
  const qc = useQueryClient();
  const { t, tn, locale } = useLang();
  const isFolder = item.kind === "FOLDER";
  const [audience, setAudience] = useState<Audience>("internal");
  const [allowDownload, setAllowDownload] = useState(true);
  const [expires, setExpires] = useState<VaultShareExpiry>("permanent");
  const [made, setMade] = useState<VaultShare | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const shares = useQuery({
    queryKey: ["vault-shares", item.id],
    queryFn: () => nexusApi.vaultShares(item.id),
  });
  // The server's answer when it gives one; until then, the item's own flag (the same rule).
  const canExternal = shares.data?.canShareExternally ?? item.canModify;

  const copy = async (s: VaultShare) => {
    const ok = await copyText(s.url);
    if (ok) {
      setCopiedId(s.id);
      toast.success(t("Link copied"));
    } else {
      toast.error(t("Couldn't copy. Select the link and copy it yourself."));
    }
    return ok;
  };

  const create = useMutation({
    mutationFn: () =>
      nexusApi.vaultCreateShare({ itemId: item.id, requireAuth: audience === "internal", allowDownload, expires }),
    onSuccess: async (s) => {
      setMade(s);
      void qc.invalidateQueries({ queryKey: ["vault-shares", item.id] });
      void qc.invalidateQueries({ queryKey: ["vault"] });
      // The clipboard can refuse here (Safari, after a request): say what actually happened.
      const ok = await copyText(s.url);
      if (ok) {
        setCopiedId(s.id);
        toast.success(t("Link created and copied"));
      } else {
        toast(t("Link created — copy it below"), { action: { label: t("Copy"), onClick: () => { void copy(s); } } });
      }
    },
    onError: (e: Error) => toast.error(t("Couldn't create the link"), { description: e.message }),
  });

  const revoke = useMutation({
    mutationFn: (id: string) => nexusApi.vaultRevokeShare(id),
    onSuccess: (s) => {
      toast.success(t("Link revoked, effective now"));
      if (made?.id === s.id) setMade(null);
      void qc.invalidateQueries({ queryKey: ["vault-shares", item.id] });
      void qc.invalidateQueries({ queryKey: ["vault"] });
    },
    onError: (e: Error) => toast.error(t("Couldn't revoke the link"), { description: e.message }),
  });

  const day = (iso: string) => new Date(iso).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" });

  const choice = (value: Audience, Icon: typeof Users, title: string, body: string, disabled = false) => (
    <button
      type="button"
      role="radio"
      aria-checked={audience === value}
      disabled={disabled}
      onClick={() => setAudience(value)}
      className={cn(
        "flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
        audience === value ? "border-primary bg-primary/5" : "border-border hover:bg-muted/60",
        disabled && "opacity-55 cursor-not-allowed hover:bg-transparent",
      )}
    >
      <span className={cn("mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full border", audience === value ? "border-primary" : "border-muted-foreground/50")}>
        {audience === value && <span className="h-2 w-2 rounded-full bg-primary" />}
      </span>
      <span className="min-w-0 text-sm">
        <span className="flex items-center gap-1.5 font-medium"><Icon className="h-3.5 w-3.5" /> {title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{body}</span>
      </span>
    </button>
  );

  const label = (s: VaultShare) =>
    s.status === "revoked" ? t("Revoked") : s.status === "expired" ? t("Expired") : s.requireAuth ? t("People in NEXUS") : t("Anyone with the link");

  const list = shares.data?.shares ?? [];

  return (
    <>
      <DialogHeader>
        <DialogTitle className="truncate pr-8">{t("Share “{name}”", { name: item.name })}</DialogTitle>
        <DialogDescription>
          {isFolder
            ? t("The link opens this folder and everything inside it, including what's added later.")
            : t("The link always shows the current version of this file, even after it's replaced.")}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div role="radiogroup" aria-label={t("Who can open this link")} className="space-y-2">
          <p className="text-sm font-medium">{t("Who can open this link")}</p>
          {choice(
            "internal",
            Users,
            t("People in NEXUS"),
            t("They sign in with their NEXUS account. On iPhone and Mac the link opens the app."),
          )}
          {choice(
            "external",
            Globe,
            t("Anyone with the link"),
            t("No account needed — for clients and partners. It opens in the browser."),
            !canExternal,
          )}
          {!canExternal && (
            <p className="text-xs text-muted-foreground">
              {t("Only the person who uploaded this, or BoD, can make a link for people outside NEXUS. You can still share it with people in NEXUS.")}
            </p>
          )}
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-border p-3 cursor-pointer">
          <Switch checked={allowDownload} onCheckedChange={setAllowDownload} className="mt-0.5" />
          <span className="text-sm">
            <span className="font-medium">{t("Allow download")}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {allowDownload
                ? isFolder ? t("People can save each file, or the whole folder as a .zip.") : t("People can save the file.")
                : t("View only: pictures, videos, sound and PDFs open in the browser. Other files (Word, Excel, ZIP…) can't be opened at all.")}
            </span>
          </span>
        </label>

        <div>
          <p className="text-xs text-muted-foreground mb-1.5">{t("Expiry")}</p>
          <div className="flex flex-wrap gap-1.5">
            {EXPIRY_OPTIONS.map((e) => (
              <button
                key={e.value}
                type="button"
                onClick={() => setExpires(e.value)}
                aria-pressed={expires === e.value}
                className={cn(
                  "px-2.5 py-1 rounded-full text-xs border transition-colors",
                  expires === e.value ? "bg-primary text-primary-foreground border-primary" : "border-border hover:bg-muted",
                )}
              >
                {t(e.label)}
              </button>
            ))}
          </div>
        </div>

        <Button className="w-full" disabled={create.isPending} onClick={() => create.mutate()}>
          {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Link2 className="h-4 w-4 mr-1.5" /> {t("Create link")}</>}
        </Button>

        {made && (
          <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 space-y-2">
            <p className="text-xs font-medium">{t("Your new link")}</p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={made.url}
                onFocus={(e) => e.currentTarget.select()}
                aria-label={t("Your new link")}
                className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
              />
              <Button size="sm" variant={copiedId === made.id ? "outline" : "default"} onClick={() => { void copy(made); }}>
                {copiedId === made.id ? <><Check className="h-3.5 w-3.5 mr-1" /> {t("Copied")}</> : <><Copy className="h-3.5 w-3.5 mr-1" /> {t("Copy")}</>}
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-border pt-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">
          {list.length ? tn(list.length, "{n} link", "{n} links") : t("Links")}
        </p>
        {shares.isLoading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
        ) : shares.isError ? (
          <p className="text-xs text-destructive">{t("Couldn't load the links.")}</p>
        ) : !list.length ? (
          <p className="rounded-lg bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
            {t("No links yet. Make one above — it shows up here with how often it was opened, and you can turn it off at any time.")}
          </p>
        ) : (
          <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
            {list.map((s) => (
              <li key={s.id} className="rounded-lg border border-border px-2.5 py-2">
                <div className="flex items-center gap-2 text-xs">
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded shrink-0 font-medium",
                      s.status === "active" ? (s.requireAuth ? "bg-primary/10 text-primary" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300") :
                      s.status === "expired" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted text-muted-foreground",
                    )}
                  >
                    {label(s)}
                  </span>
                  <span className="truncate flex-1 text-muted-foreground" title={s.url}>{s.url.replace(/^https?:\/\//, "")}</span>
                  {s.status === "active" && (
                    <button
                      type="button"
                      className="p-1.5 hover:bg-muted rounded"
                      title={t("Copy")}
                      aria-label={t("Copy")}
                      onClick={() => { void copy(s); }}
                    >
                      {copiedId === s.id ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  )}
                  {s.status === "active" && s.canRevoke !== false && (
                    <button
                      type="button"
                      className="p-1.5 hover:bg-muted rounded text-destructive"
                      title={t("Revoke")}
                      aria-label={t("Revoke")}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate(s.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {[
                    s.status === "revoked" && s.revokedAt ? t("Turned off {date}", { date: day(s.revokedAt) })
                      : s.expiresAt ? (s.status === "expired" ? t("Expired {date}", { date: day(s.expiresAt) }) : t("Until {date}", { date: day(s.expiresAt) }))
                      : t("No expiry"),
                    s.allowDownload ? t("Download on") : t("View only"),
                    s.createdBy?.name ? t("by {name}", { name: s.createdBy.name }) : null,
                    tn(s.viewCount, "{n} view", "{n} views"),
                  ].filter(Boolean).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
