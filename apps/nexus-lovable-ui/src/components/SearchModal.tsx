import { useEffect, useId, useRef, useState } from "react";
import { docTitle } from "@/lib/doc-title";
import type React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CheckSquare, CornerDownLeft, FileText, FolderKanban, Loader2, MessageSquare, Search, Users, X } from "lucide-react";
import { toast } from "sonner";
import { nexusApi } from "@/lib/nexus-api";
import { useLang } from "@/lib/lang";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEscape } from "@/hooks/use-escape";
import { cn } from "@/lib/utils";

type ResultItem = { key: string; label: string; sub?: string; to: () => void | Promise<void>; icon: typeof Search };

/** Roles that may open anyone's record (/people/:id); everyone else is sent to the person's chat instead. */
const SEES_EVERY_RECORD = new Set(["ONE_ABOVE_ALL", "BOD"]);

export function SearchModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { t } = useLang();
  // The full list of what it searches is cut off on a phone; there it says it more briefly.
  const phone = useIsMobile();
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const listId = useId();
  const titleId = useId();
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEscape(onClose);

  const search = useQuery({ queryKey: ["nexus", "search", debounced], queryFn: () => nexusApi.search(debounced), enabled: debounced.length >= 2 });
  // Who is searching: a person result opens their record only where the viewer may read it (BoD, One
  // Above All, themselves); for everyone else it opens the chat with that person, never a page that
  // answers "not for your role" (QA S-08 / B20: it went to /teams → Control Room).
  const membersQ = useQuery({ queryKey: ["nexus", "workspace-members"], queryFn: () => nexusApi.workspaceMembers(), retry: false, staleTime: 60_000 });
  const profileQ = useQuery({ queryKey: ["nexus", "profile"], queryFn: nexusApi.profile, retry: false, staleTime: 60_000 });
  const myId = profileQ.data?.user?.id;
  const seesRecords = SEES_EVERY_RECORD.has(membersQ.data?.role ?? "") || profileQ.data?.user?.role === "ADMIN";
  const r = search.data;

  const openPerson = async (id: string) => {
    if (id === myId || seesRecords) { await navigate({ to: "/people/$userId", params: { userId: id } }); return; }
    try {
      const res = await nexusApi.createConversation({ type: "DM", userIds: [id] });
      await navigate({ to: "/messages", search: { c: res.conversation.id } });
    } catch {
      toast.error(t("Couldn't start the chat."));
    }
  };

  const go = (item: ResultItem) => { void item.to(); onClose(); };
  const groups: Array<{ label: string; items: ResultItem[] }> = r ? [
    { label: t("Tasks"), items: (r.tasks ?? []).map((task) => ({ key: `t:${task.id}`, label: task.title, sub: task.taskList?.project?.name ?? undefined, to: () => navigate({ to: "/tasks/$taskId", params: { taskId: task.id } }), icon: CheckSquare })) },
    { label: t("Projects"), items: (r.projects ?? []).map((p) => ({ key: `p:${p.id}`, label: p.name, to: () => navigate({ to: "/projects/$projectId", params: { projectId: p.id } }), icon: FolderKanban })) },
    { label: t("Docs"), items: (r.docs ?? []).map((d) => ({ key: `d:${d.id}`, label: docTitle(d.title), sub: d.project?.name ?? undefined, to: () => navigate({ to: "/docs/$docId", params: { docId: d.id } }), icon: FileText })) },
    { label: t("People"), items: (r.members ?? []).map((m) => ({
      key: `m:${m.id}`,
      label: m.name ?? m.email ?? t("Member"),
      sub: m.id === myId || seesRecords ? (m.email ?? undefined) : t("Message"),
      to: () => openPerson(m.id),
      icon: m.id === myId || seesRecords ? Users : MessageSquare,
    })) },
  ].map((grp) => ({ ...grp, items: grp.items.slice(0, 6) })).filter((grp) => grp.items.length > 0) : [];

  const flat = groups.flatMap((g) => g.items);
  const total = flat.length;
  // A new answer starts at the top again.
  useEffect(() => { setActive(0); }, [debounced, total]);
  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const onInputKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return;
    if (e.key === "ArrowDown" && total) { e.preventDefault(); setActive((i) => (i + 1) % total); }
    else if (e.key === "ArrowUp" && total) { e.preventDefault(); setActive((i) => (i - 1 + total) % total); }
    else if (e.key === "Home" && total && e.ctrlKey) { e.preventDefault(); setActive(0); }
    else if (e.key === "End" && total && e.ctrlKey) { e.preventDefault(); setActive(total - 1); }
    else if (e.key === "Enter" && flat[active]) { e.preventDefault(); go(flat[active]); }
  };

  let index = -1;
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-foreground/30 dark:bg-scrim p-4 pt-[12vh] backdrop-blur-sm" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby={titleId} className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-card shadow-pop" onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId} className="sr-only">{t("Search NEXUS")}</h2>
        <div className="flex items-center gap-2 border-b border-border px-4">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onInputKey}
            role="combobox"
            aria-expanded={total > 0}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={total > 0 ? `${listId}-${active}` : undefined}
            aria-label={t("Search NEXUS")}
            placeholder={phone ? t("Search everything…") : t("Search tasks, projects, docs, people…")}
            className="min-w-0 flex-1 text-ellipsis bg-transparent py-3.5 text-sm outline-none placeholder:text-muted-foreground"
          />
          {search.isFetching && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <button onClick={onClose} aria-label={t("Close")} className="grid h-11 w-11 place-items-center rounded-lg text-muted-foreground md:h-auto md:w-auto md:p-1 transition-colors hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
        <div ref={listRef} id={listId} role="listbox" aria-label={t("Results")} className="max-h-[55vh] overflow-y-auto p-2">
          {debounced.length < 2 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("Type at least 2 characters to search.")}</p>}
          {debounced.length >= 2 && !search.isFetching && total === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">{t("No results for “{query}”.", { query: debounced })}</p>}
          {groups.map((g) => (
            <div key={g.label} role="group" aria-label={g.label} className="mb-1">
              <div aria-hidden className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{g.label}</div>
              {g.items.map((item) => {
                index += 1;
                const i = index;
                const on = i === active;
                return (
                  <div
                    key={item.key}
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={on}
                    onMouseMove={() => { if (!on) setActive(i); }}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => go(item)}
                    className={cn("flex min-h-10 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors", on ? "bg-accent" : "hover:bg-accent/60")}
                  >
                    <item.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                    {item.sub && <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">{item.sub}</span>}
                    {on && !phone && <CornerDownLeft aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {!phone && (
          <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
            <span><kbd className="rounded border border-border bg-muted px-1 font-mono">↑</kbd> <kbd className="rounded border border-border bg-muted px-1 font-mono">↓</kbd> {t("to move")}</span>
            <span><kbd className="rounded border border-border bg-muted px-1 font-mono">Enter</kbd> {t("to open")}</span>
            <span><kbd className="rounded border border-border bg-muted px-1 font-mono">Esc</kbd> {t("to close")}</span>
          </div>
        )}
      </div>
    </div>
  );
}
