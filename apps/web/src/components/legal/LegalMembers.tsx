import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Search, UserMinus, UserPlus } from "lucide-react";
import { AvatarFace } from "@/components/Avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { fmtDate, ORG_ROLE_LABEL } from "@/lib/nexus-api";
import { legalApi, type LegalMember } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";

/**
 * Who has Legal (owner, 14 Oct 2026): the owner always; BoD members he invites may invite staff; invited
 * staff may not invite. Removing someone keeps their row (and who invited them) for the record.
 */
export function LegalMembers() {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const members = useQuery({ queryKey: ["legal", "members"], queryFn: legalApi.members });
  const [inviteOpen, setInviteOpen] = useState(false);
  const [revoking, setRevoking] = useState<LegalMember | null>(null);
  const [showFormer, setShowFormer] = useState(false);

  const revoke = useMutation({
    mutationFn: (userId: string) => legalApi.revoke(userId),
    onSuccess: () => {
      toast.success(t("Legal access removed"));
      void qc.invalidateQueries({ queryKey: ["legal", "members"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rows = members.data?.members ?? [];
  const active = rows.filter((m) => m.active);
  const former = rows.filter((m) => !m.active);
  const power = members.data?.invitePower ?? "NONE";

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold">{t("People with Legal access")}</h2>
          <p className="text-sm text-muted-foreground">
            {power === "ANY"
              ? t("Legal is by invitation only. You can invite anyone of the company.")
              : power === "STAFF"
                ? t("Legal is by invitation only. You can invite staff and remove the people you invited.")
                : t("Legal is by invitation only. Ask the owner or a BoD member to invite someone.")}
          </p>
        </div>
        {power !== "NONE" && (
          <Button onClick={() => setInviteOpen(true)} className="gap-1.5">
            <UserPlus className="h-4 w-4" /> {t("Invite")}
          </Button>
        )}
      </div>

      {members.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
      ) : members.isError ? (
        <p className="py-6 text-sm text-destructive">{(members.error as Error).message}</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {active.map((m) => <MemberRow key={m.userId} m={m} onRevoke={() => setRevoking(m)} />)}
        </ul>
      )}

      {former.length > 0 && (
        <div className="pt-2">
          <button className="text-sm text-muted-foreground underline-offset-2 hover:underline" onClick={() => setShowFormer((v) => !v)}>
            {showFormer ? t("Hide removed people") : t("Show removed people ({n})", { n: former.length })}
          </button>
          {showFormer && (
            <ul className="mt-2 divide-y divide-border rounded-lg border border-border opacity-80">
              {former.map((m) => <MemberRow key={m.userId} m={m} />)}
            </ul>
          )}
        </div>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />

      <AlertDialog open={!!revoking} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent lang={lang}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Remove {name} from Legal?", { name: revoking?.name ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("They lose access to every legal document and template right away. You can invite them again later.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { if (revoking) revoke.mutate(revoking.userId); setRevoking(null); }}
            >
              {t("Remove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

function MemberRow({ m, onRevoke }: { m: LegalMember; onRevoke?: () => void }) {
  const { t } = useLang();
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <AvatarFace name={m.name} avatar={m.avatar} size={32} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate text-sm font-medium">{m.name}</span>
          {m.isRoot && <Badge variant="secondary">{t("Owner")}</Badge>}
          {m.orgRole && <span className="text-xs text-muted-foreground">{ORG_ROLE_LABEL[m.orgRole] ?? m.orgRole}</span>}
          {!m.isRoot && m.active && m.invitePower === "STAFF" && <Badge variant="outline">{t("Can invite staff")}</Badge>}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {m.isRoot
            ? t("Always has Legal")
            : m.revokedAt
              ? t("Removed by {name} on {date}", { name: m.revokedBy?.name ?? "—", date: fmtDate(m.revokedAt) })
              : m.active
                ? t("Invited by {name} on {date}", { name: m.invitedBy?.name ?? "—", date: fmtDate(m.invitedAt) })
                : t("No longer in the company")}
        </div>
      </div>
      {onRevoke && m.canRevoke && (
        <Button variant="ghost" size="sm" onClick={onRevoke} className="gap-1.5 text-muted-foreground hover:text-destructive" aria-label={t("Remove {name} from Legal?", { name: m.name })}>
          <UserMinus className="h-4 w-4" /> <span className="max-sm:hidden">{t("Remove")}</span>
        </Button>
      )}
    </li>
  );
}

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const query = useMemo(() => q.trim(), [q]);
  const candidates = useQuery({
    queryKey: ["legal", "invite-candidates", query],
    queryFn: () => legalApi.inviteCandidates(query),
    enabled: open,
    staleTime: 10_000,
  });
  const invite = useMutation({
    mutationFn: (userId: string) => legalApi.invite(userId),
    onSuccess: () => {
      toast.success(t("Invited to Legal"));
      void qc.invalidateQueries({ queryKey: ["legal", "members"] });
      void qc.invalidateQueries({ queryKey: ["legal", "invite-candidates"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const list = candidates.data?.candidates ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent lang={lang} className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("Invite to Legal")}</DialogTitle>
          <DialogDescription>{t("They will see the Legal menu and every legal document and template.")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search people…")} className="pl-8" />
        </div>
        <ul className="max-h-80 divide-y divide-border overflow-y-auto rounded-md border border-border">
          {candidates.isLoading ? (
            <li className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</li>
          ) : list.length === 0 ? (
            <li className="px-3 py-4 text-sm text-muted-foreground">{t("Nobody to invite")}</li>
          ) : (
            list.map((c) => (
              <li key={c.userId} className="flex items-center gap-3 px-3 py-2">
                <AvatarFace name={c.name} avatar={c.avatar} size={28} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{ORG_ROLE_LABEL[c.orgRole] ?? c.orgRole} · {c.email}</div>
                </div>
                <Button size="sm" variant="outline" disabled={invite.isPending} onClick={() => invite.mutate(c.userId)}>
                  {t("Invite")}
                </Button>
              </li>
            ))
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
