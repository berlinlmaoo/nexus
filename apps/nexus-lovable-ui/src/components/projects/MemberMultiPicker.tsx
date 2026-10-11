import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Search, X } from "lucide-react";
import { nexusApi } from "@/lib/nexus-api";
import { Avatar } from "@/components/Avatar";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * Inline multi-select over the people of one workspace (owner, 11 Oct 2026: add members while creating
 * a project). Search by name or email, tick rows, the picked people show as chips above the list. The
 * caller is left out: they become the project's lead anyway.
 */
export function MemberMultiPicker({ workspaceId, value, onChange }: { workspaceId: string; value: string[]; onChange: (ids: string[]) => void }) {
  const { t } = useLang();
  const [query, setQuery] = useState("");
  const me = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 300_000 }).data?.user?.id;
  const roster = useQuery({
    queryKey: ["nexus", "workspace-members", workspaceId],
    queryFn: () => nexusApi.workspaceMembers(workspaceId || undefined),
    retry: false,
    staleTime: 60_000,
    enabled: !!workspaceId,
  });
  const people = useMemo(
    () => (roster.data?.members ?? [])
      .filter((m) => m.userId && m.userId !== me)
      .sort((a, b) => (a.name || a.email || "").localeCompare(b.name || b.email || "")),
    [roster.data, me],
  );
  const byId = useMemo(() => new Map(people.map((m) => [m.userId, m])), [people]);
  const q = query.trim().toLowerCase();
  const results = q ? people.filter((m) => (m.name ?? "").toLowerCase().includes(q) || (m.email ?? "").toLowerCase().includes(q)) : people;
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);

  return (
    <div className="space-y-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const m = byId.get(id);
            return (
              <span key={id} className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 py-0.5 pl-0.5 pr-1.5 text-xs font-semibold">
                <Avatar userId={id} name={m?.name} avatar={m?.avatar} size={20} className="shrink-0" />
                <span className="truncate">{m?.name || m?.email || id}</span>
                <button type="button" onClick={() => toggle(id)} aria-label={t("Remove {name}", { name: m?.name || m?.email || "" })} className="rounded-full p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3 w-3" /></button>
              </span>
            );
          })}
        </div>
      )}
      <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("Search by name or email")} className="h-9 min-w-0 flex-1 bg-transparent text-sm outline-none" />
        {query && <button type="button" onClick={() => setQuery("")} aria-label={t("Clear search")} className="rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
      </div>
      <div role="listbox" aria-multiselectable="true" className="max-h-52 overflow-y-auto overscroll-contain rounded-xl border border-border p-1">
        {roster.isLoading && <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Loading…")}</div>}
        {!roster.isLoading && roster.isError && <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t("Couldn't load the people in this workspace.")}</div>}
        {!roster.isLoading && !roster.isError && people.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t("No one else in this workspace yet.")}</div>}
        {!roster.isLoading && people.length > 0 && results.length === 0 && <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t("No one matches “{q}”", { q: query.trim() })}</div>}
        {results.map((m) => {
          const on = value.includes(m.userId);
          return (
            <button key={m.userId} type="button" role="option" aria-selected={on} onClick={() => toggle(m.userId)} className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors", on ? "bg-primary/10" : "hover:bg-accent")}>
              <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                {on && <Check className="h-3 w-3" strokeWidth={3} />}
              </span>
              <Avatar userId={m.userId} name={m.name} avatar={m.avatar} size={26} className="shrink-0" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{m.name || m.email}</span>
                {m.email && m.name && <span className="block truncate text-xs text-muted-foreground">{m.email}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
