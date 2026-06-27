import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, Plus, Users as UsersIcon, X } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { ChatThread } from "@/components/messages/ChatThread";
import { nexusApi, type NexusConversation, type NexusUser } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_app/messages")({ component: Messages });

function initialsOf(name?: string | null) {
  if (!name) return "?";
  return name.trim().split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("");
}

function convoTitle(c: NexusConversation, meId?: string): string {
  if (c.name) return c.name;
  if (c.type === "DM") {
    const other = (c.members ?? []).find((m) => (m.userId || m.user?.id) !== meId);
    return other?.user?.name ?? "Direct message";
  }
  return (c.members ?? []).map((m) => m.user?.name).filter(Boolean).slice(0, 3).join(", ") || "Conversation";
}

function Messages() {
  const [composer, setComposer] = useState(false);
  const me = useQuery({ queryKey: ["profile"], queryFn: nexusApi.profile, retry: 1 });
  const meId = me.data?.user?.id;
  const convos = useQuery({ queryKey: ["conversations"], queryFn: () => nexusApi.conversations(), retry: false });
  const rows = convos.data?.conversations ?? [];
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = rows.find((c) => c.id === activeId) ?? rows[0] ?? null;
  const activeKey = active?.id ?? null;

  const groups = {
    DM: rows.filter((c) => c.type === "DM"),
    GROUP: rows.filter((c) => c.type === "GROUP"),
    PROJECT: rows.filter((c) => c.type === "PROJECT"),
  };

  return (
    <div>
      <PageHeader title="Messages" subtitle="Chat with your crew + per-project rooms." actions={
        <button onClick={() => setComposer(true)} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground shadow-soft transition-all duration-150 hover:bg-primary/90 active:scale-[0.98]"><Plus className="h-3.5 w-3.5" /> New chat</button>
      } />
      <div className="grid h-[calc(100vh-9rem)] grid-cols-1 md:grid-cols-[300px_1fr]">
        {/* conversation list */}
        <aside className="overflow-y-auto border-r border-border">
          {convos.isLoading && <div className="flex justify-center py-10 text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin" /></div>}
          {!convos.isLoading && rows.length === 0 && <p className="p-4 text-sm text-muted-foreground">No conversations yet.</p>}
          {(["DM", "GROUP", "PROJECT"] as const).map((t) => groups[t].length > 0 && (
            <div key={t} className="py-1">
              <div className="px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{t === "DM" ? "Direct" : t === "GROUP" ? "Groups" : "Projects"}</div>
              {groups[t].map((c) => (
                <button key={c.id} onClick={() => setActiveId(c.id)} className={cn("flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-accent", activeKey === c.id && "bg-accent")}>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary ring-1 ring-border">{c.type === "PROJECT" || c.type === "GROUP" ? <UsersIcon className="h-4 w-4" /> : initialsOf(convoTitle(c, meId))}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{convoTitle(c, meId)}</div>
                    <div className="truncate text-xs text-muted-foreground">{c.lastMessage?.content ?? "No messages yet"}</div>
                  </div>
                  {(c.unreadCount ?? 0) > 0 && <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-destructive px-1 text-[10px] font-bold text-destructive-foreground">{c.unreadCount}</span>}
                </button>
              ))}
            </div>
          ))}
        </aside>
        {/* active thread */}
        <section className="min-w-0">
          {active ? (
            <>
              <div className="flex items-center gap-2.5 border-b border-border px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">{active.type === "PROJECT" || active.type === "GROUP" ? <UsersIcon className="h-4 w-4" /> : initialsOf(convoTitle(active, meId))}</span>
                <div className="min-w-0">
                  <div className="truncate font-semibold">{convoTitle(active, meId)}</div>
                  <div className="text-xs text-muted-foreground">{(active.members?.length ?? 0)} member{(active.members?.length ?? 0) === 1 ? "" : "s"}{active.type === "PROJECT" ? " · project room" : ""}</div>
                </div>
              </div>
              <div className="h-[calc(100%-3.5rem)]"><ChatThread conversationId={active.id} meId={meId} /></div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-muted-foreground"><div><MessageCircle className="mx-auto mb-3 h-10 w-10 opacity-40" /><p className="text-sm">Pick a conversation or start a new chat.</p></div></div>
          )}
        </section>
      </div>
      {composer && <NewChat onClose={() => setComposer(false)} onCreated={(id) => { setActiveId(id); setComposer(false); }} meId={meId} />}
    </div>
  );
}

function NewChat({ onClose, onCreated, meId }: { onClose: () => void; onCreated: (id: string) => void; meId?: string }) {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const membersQuery = useQuery({ queryKey: ["members"], queryFn: () => nexusApi.members(), staleTime: 300_000 });
  const members = (Array.isArray(membersQuery.data) ? membersQuery.data : membersQuery.data?.members ?? []).filter((m: NexusUser) => m.id !== meId);
  const isGroup = selected.length > 1;

  const create = useMutation({
    mutationFn: () => nexusApi.createConversation({ type: isGroup ? "GROUP" : "DM", userIds: selected, name: isGroup ? (groupName.trim() || undefined) : undefined }),
    onSuccess: (res) => { qc.invalidateQueries({ queryKey: ["conversations"] }); onCreated(res.conversation.id); },
  });
  const toggle = (id: string) => setSelected((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/30 p-4 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-pop" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between"><h2 className="font-display text-lg font-bold tracking-tight">New chat</h2><button onClick={onClose} className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent"><X className="h-4 w-4" /></button></div>
        <p className="mt-1 text-xs text-muted-foreground">Pick 1 person for a DM, or several for a group.</p>
        {isGroup && <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Group name (optional)" className="mt-3 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary" />}
        <div className="mt-3 max-h-64 space-y-1 overflow-y-auto rounded-xl border border-border p-1">
          {membersQuery.isLoading && <div className="px-3 py-2 text-xs text-muted-foreground">Loading…</div>}
          {members.map((m: NexusUser) => (
            <button key={m.id} onClick={() => toggle(m.id)} className={cn("flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors", selected.includes(m.id) ? "bg-primary/10 text-primary" : "hover:bg-accent")}>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">{initialsOf(m.name)}</span>
              <span className="flex-1 truncate">{m.name ?? m.email}</span>
              {selected.includes(m.id) && <span className="text-xs font-bold">✓</span>}
            </button>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <button disabled={selected.length === 0 || create.isPending} onClick={() => create.mutate()} className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50">{create.isPending && <Loader2 className="h-4 w-4 animate-spin" />} Start {isGroup ? "group" : "chat"}</button>
          {create.isError && <span className="text-xs font-semibold text-destructive">Couldn't start the chat.</span>}
        </div>
      </div>
    </div>
  );
}
