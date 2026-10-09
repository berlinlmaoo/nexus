import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";
import { ApiError, nexusApi, type NexusUser } from "@/lib/nexus-api";
import { Avatar } from "@/components/Avatar";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

const ROLE_LABEL: Record<string, string> = { ONE_ABOVE_ALL: "One Above All", BOD: "BoD", MANAGER: "Manager", STAFF: "Staff" };

function rosterOf(data: { members?: NexusUser[] } | NexusUser[] | undefined): NexusUser[] {
  if (!data) return [];
  return Array.isArray(data) ? data : data.members ?? [];
}

/**
 * Project settings → Members → "Add members" (owner, 9 Oct 2026: "kenapa drop down gini doang? gaada
 * search bar dan gabisa select multiple org"). A searchable multi-select over the workspace people who
 * are not in the project yet, for every project type (task projects and the Pipeline Dashboard alike).
 * Keyboard: type to filter, ↑/↓ to move, Enter or Space to tick, Ctrl/⌘+Enter to add, Esc to close.
 * One request for everyone picked (`{ userIds }`); the server still writes one audit entry and sends one
 * "added to project" notification per person.
 */
export function AddProjectMembersDialog({
  projectId,
  memberIds,
  onClose,
  onAdded,
}: {
  projectId: string;
  memberIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [active, setActive] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const roster = useQuery({ queryKey: ["members"], queryFn: () => nexusApi.members(), staleTime: 300_000 });
  const candidates = useMemo(
    () => rosterOf(roster.data)
      .filter((u) => !memberIds.has(u.id) && !u.deactivatedAt)
      .sort((a, b) => (a.name ?? a.email ?? "").localeCompare(b.name ?? b.email ?? "")),
    [roster.data, memberIds],
  );
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((u) => (u.name ?? "").toLowerCase().includes(q) || (u.email ?? "").toLowerCase().includes(q));
  }, [candidates, query]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const add = useMutation({
    mutationFn: () => nexusApi.addProjectMembers(projectId, picked),
    onSuccess: (res) => {
      const n = res.added?.length ?? 0;
      qc.invalidateQueries({ queryKey: ["nexus", "project", projectId] });
      qc.invalidateQueries({ queryKey: ["nexus", "project-members", projectId] });
      qc.invalidateQueries({ queryKey: ["project-members", projectId] });
      qc.invalidateQueries({ predicate: (q) => q.queryKey.map(String).includes("projects") });
      if (n > 0) toast.success(n === 1 ? t("1 member added") : t("{n} members added", { n }));
      else toast.message(t("They're already in this project."));
      onAdded();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.status === 403) setError(t("Only the project's managers can add members."));
      else setError(t("Couldn't add them. Try again."));
    },
  });

  const toggle = (id: string) => {
    setError(null);
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  };
  const submit = () => { if (picked.length > 0 && !add.isPending) add.mutate(); };

  // Esc closes this picker only: caught before the settings modal's own Esc handler sees it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); e.preventDefault(); onClose(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0))); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
    else if (e.key === "Enter" || (e.key === " " && query.length === 0)) {
      const u = results[active];
      if (u) { e.preventDefault(); toggle(u.id); }
    }
  };

  const loading = roster.isLoading;
  const n = picked.length;

  return createPortal(
    <div className="fixed inset-0 z-[60] grid place-items-end p-0 sm:place-items-center sm:p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-foreground/30 backdrop-blur-sm" aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-members-title"
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-[85dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-border bg-card shadow-pop sm:max-w-md sm:rounded-3xl"
      >
        <div className="flex items-center justify-between px-5 pt-5">
          <h2 id="add-members-title" className="font-display text-lg font-bold tracking-tight">{t("Add members")}</h2>
          <button onClick={onClose} title={t("Close")} aria-label={t("Close")} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div className="px-5 pt-3">
          <div className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 focus-within:border-primary">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onInputKey}
              placeholder={t("Search by name or email")}
              role="combobox"
              aria-expanded="true"
              aria-controls="add-members-list"
              aria-activedescendant={results[active] ? `add-member-${results[active].id}` : undefined}
              className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
            {query && <button onClick={() => { setQuery(""); inputRef.current?.focus(); }} aria-label={t("Clear search")} className="rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="h-3.5 w-3.5" /></button>}
          </div>
          <div className="mt-2 flex h-5 items-center justify-between text-xs text-muted-foreground">
            <span>{n > 0 ? t("{n} selected", { n }) : t("Pick one or more people")}</span>
            {n > 0 && <button onClick={() => setPicked([])} className="font-semibold hover:text-foreground">{t("Clear")}</button>}
          </div>
        </div>

        <div ref={listRef} id="add-members-list" role="listbox" aria-multiselectable="true" className="mx-5 mt-2 min-h-[12rem] flex-1 overflow-y-auto overscroll-contain rounded-xl border border-border p-1">
          {loading && <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("Loading…")}</div>}
          {!loading && roster.isError && <div className="px-3 py-6 text-center text-sm text-muted-foreground">{t("Couldn't load the people in this workspace.")}</div>}
          {!loading && !roster.isError && candidates.length === 0 && (
            <div className="px-3 py-8 text-center">
              <p className="text-sm font-semibold">{t("Everyone is already in this project.")}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("To bring in someone from outside the workspace, use Invite by email.")}</p>
            </div>
          )}
          {!loading && candidates.length > 0 && results.length === 0 && (
            <div className="px-3 py-8 text-center">
              <p className="text-sm font-semibold">{t("No one matches “{q}”", { q: query.trim() })}</p>
              <p className="mt-1 text-xs text-muted-foreground">{t("Try part of their name or their email.")}</p>
            </div>
          )}
          {results.map((u, i) => {
            const on = picked.includes(u.id);
            const role = u.role ? ROLE_LABEL[u.role] ?? null : null;
            return (
              <button
                key={u.id}
                id={`add-member-${u.id}`}
                data-idx={i}
                role="option"
                aria-selected={on}
                tabIndex={-1}
                onMouseEnter={() => setActive(i)}
                onClick={() => { toggle(u.id); inputRef.current?.focus(); }}
                className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors", i === active ? "bg-accent" : "hover:bg-accent/60")}
              >
                <span className={cn("grid h-4 w-4 shrink-0 place-items-center rounded border transition-colors", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40")}>
                  {on && <Check className="h-3 w-3" strokeWidth={3} />}
                </span>
                <Avatar userId={u.id} name={u.name} avatar={u.avatar} size={30} className="shrink-0" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">{u.name ?? u.email}</span>
                  {u.email && u.name && <span className="block truncate text-xs text-muted-foreground">{u.email}</span>}
                </span>
                {role && <span className="shrink-0 text-[11px] font-semibold text-muted-foreground">{role}</span>}
              </button>
            );
          })}
        </div>

        {error && <p className="mx-5 mt-2 text-xs font-semibold text-destructive">{error}</p>}
        <div className="flex items-center justify-end gap-2 px-5 py-4">
          <button onClick={onClose} className="rounded-xl px-4 py-2 text-sm font-semibold text-muted-foreground transition-colors hover:bg-accent">{t("Cancel")}</button>
          <button
            disabled={n === 0 || add.isPending}
            onClick={submit}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
          >
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {n === 0 ? t("Add members") : n === 1 ? t("Add 1 member") : t("Add {n} members", { n })}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
