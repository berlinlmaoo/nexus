import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, FileText, FolderKanban, Loader2, Search, Target, Users, X } from "lucide-react";
import { nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { useIsMobile } from "@/hooks/use-mobile";

type ResultItem = { id: string; label: string; sub?: string; to: () => void; icon: typeof Search };

export function SearchModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { t } = useLang();
  // The full list of what it searches is cut off on a phone; there it says it more briefly.
  const phone = useIsMobile();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const search = useQuery({ queryKey: ["nexus", "search", debounced], queryFn: () => nexusApi.search(debounced), enabled: debounced.length >= 2 });
  const r = search.data;

  const go = (fn: () => void) => { fn(); onClose(); };
  const groups: Array<{ label: string; items: ResultItem[] }> = r ? [
    { label: t("Tasks"), items: (r.tasks ?? []).map((task) => ({ id: task.id, label: task.title, to: () => navigate({ to: "/tasks/$taskId", params: { taskId: task.id } }), icon: CheckSquare })) },
    { label: t("Projects"), items: (r.projects ?? []).map((p) => ({ id: p.id, label: p.name, to: () => navigate({ to: "/projects/$projectId", params: { projectId: p.id } }), icon: FolderKanban })) },
    { label: t("Docs"), items: (r.docs ?? []).map((d) => ({ id: d.id, label: d.title, to: () => navigate({ to: "/docs/$docId", params: { docId: d.id } }), icon: FileText })) },
    { label: t("People"), items: (r.members ?? []).map((m) => ({ id: m.id, label: m.name ?? m.email ?? t("Member"), sub: m.email ?? undefined, to: () => navigate({ to: "/teams" }), icon: Users })) },
  ].filter((grp) => grp.items.length > 0) : [];

  const total = groups.reduce((n, g) => n + g.items.length, 0);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-foreground/30 p-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={phone ? t("Search everything…") : t("Search tasks, projects, docs, goals, people…")} className="min-w-0 flex-1 text-ellipsis bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground" />
          {search.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <button onClick={onClose} aria-label={t("Close")} className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground md:h-auto md:w-auto md:p-1 transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="max-h-[55vh] overflow-y-auto p-2">
          {debounced.length < 2 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("Type at least 2 characters to search.")}</p>}
          {debounced.length >= 2 && !search.isFetching && total === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("No results for “{query}”.", { query: debounced })}</p>}
          {groups.map((g) => (
            <div key={g.label} className="mb-1">
              <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.label}</div>
              {g.items.slice(0, 6).map((item) => (
                <button key={item.id} onClick={() => go(item.to)} className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent">
                  <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="flex-1 truncate font-medium">{item.label}</span>
                  {item.sub && <span className="shrink-0 text-xs text-muted-foreground">{item.sub}</span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
