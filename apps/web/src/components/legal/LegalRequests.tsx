import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Ban, CalendarDays, Copy, ExternalLink, FilePlus2, FileText, Inbox, Kanban, Link2, List, Loader2, Paperclip, RefreshCw, Search, X,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Segmented } from "@/components/PageLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { NewDocumentDialog } from "@/components/legal/NewDocumentDialog";
import { StageChip } from "@/components/legal/MyLegalRequests";
import { docTypeLabel, fmtDay, formatBytes, statusClass, statusLabel } from "@/components/legal/legal-labels";
import { legalApi, legalDocsApi, legalTemplatesApi } from "@/lib/legal-api";
import { legalRequestsApi, REQUEST_COLUMNS, type BoardQuery, type BoardRequest, type RequestColumn } from "@/lib/legal-requests-api";
import { fmtDate } from "@/lib/nexus-api";
import { t as tt, useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

const ALL = "__all";

export function columnLabel(c: RequestColumn): string {
  return { TODO: tt("To Do"), IN_PROGRESS: tt("In Progress"), DONE: tt("Done") }[c];
}

const todayJakarta = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta" }).format(new Date());
const isOverdue = (r: BoardRequest) => !!r.deadline && r.column !== "DONE" && r.deadline < todayJakarta();

/**
 * The Legal request board (owner, 14 Oct 2026), for invited members only: what people asked for through a
 * request link. To Do / In Progress / Done, or a list, filtered by type, company, PIC and deadline. "Create
 * document" opens New document filled from the request and links the two; the card then follows the document
 * (In Progress, and Done once signed). Cards can also be dragged by hand. Live: workspace-changed { kind: "legal" }.
 */
export function LegalRequests({ openId, onOpen, onOpenDocument }: {
  openId: string | null;
  onOpen: (id: string | null) => void;
  onOpenDocument: (id: string) => void;
}) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const [view, setView] = useState<"board" | "list">(() => { try { return localStorage.getItem("nx-legal-requests-view") === "list" ? "list" : "board"; } catch { return "board"; } });
  const [text, setText] = useState("");
  const [filters, setFilters] = useState<BoardQuery>({});
  const [linksOpen, setLinksOpen] = useState(false);
  const [dragOver, setDragOver] = useState<RequestColumn | null>(null);
  useEffect(() => { try { localStorage.setItem("nx-legal-requests-view", view); } catch { /* private mode */ } }, [view]);
  useEffect(() => { const h = setTimeout(() => setFilters((f) => ({ ...f, q: text.trim() || undefined })), 300); return () => clearTimeout(h); }, [text]);

  const board = useQuery({ queryKey: ["legal", "requests", filters], queryFn: () => legalRequestsApi.board(filters), placeholderData: (prev) => prev });
  const companies = useQuery({ queryKey: ["legal", "companies"], queryFn: legalTemplatesApi.companies, staleTime: 60_000 });
  const members = useQuery({ queryKey: ["legal", "members"], queryFn: legalApi.members, staleTime: 60_000 });
  const rows = board.data?.requests ?? [];
  const activeMembers = (members.data?.members ?? []).filter((m) => m.active);
  const types = useMemo(() => [...new Set(rows.map((r) => r.docType))], [rows]);
  const filtered = Object.entries(filters).some(([k, v]) => k !== "q" && v);

  const move = useMutation({
    mutationFn: ({ id, column }: { id: string; column: RequestColumn }) => legalRequestsApi.update(id, { column }),
    onMutate: async ({ id, column }) => {
      await qc.cancelQueries({ queryKey: ["legal", "requests", filters] });
      const prev = qc.getQueryData<{ requests: BoardRequest[] }>(["legal", "requests", filters]);
      if (prev) qc.setQueryData(["legal", "requests", filters], { requests: prev.requests.map((r) => (r.id === id ? { ...r, column } : r)) });
      return { prev };
    },
    onError: (e: Error, _v, ctx) => { if (ctx?.prev) qc.setQueryData(["legal", "requests", filters], ctx.prev); toast.error(e.message); },
    onSettled: () => { void qc.invalidateQueries({ queryKey: ["legal", "requests"] }); void qc.invalidateQueries({ queryKey: ["legal", "request"] }); },
  });
  const set = (patch: Partial<BoardQuery>) => setFilters((f) => ({ ...f, ...patch }));
  // Phones show one column at a time: the one picked, else the first that holds requests.
  const [phoneColState, setPhoneColState] = useState<RequestColumn | null>(null);
  const phoneCol: RequestColumn = phoneColState ?? REQUEST_COLUMNS.find((c) => rows.some((r) => r.column === c)) ?? REQUEST_COLUMNS[0];

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Search requests")} aria-label={t("Search requester, type, notes…")} className="pl-8" />
        </div>
        <Segmented label={t("View")} value={view} onChange={setView}
          options={[{ key: "board", label: t("Board"), icon: Kanban }, { key: "list", label: t("List"), icon: List }]} />
        <Button variant="outline" onClick={() => setLinksOpen(true)} className="gap-1.5"><Link2 className="h-4 w-4" /> {t("Request links")}</Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect value={filters.docType} onChange={(v) => set({ docType: v })} all={t("All types")} options={types.map((d) => [d, docTypeLabel(d)])} />
        <FilterSelect value={filters.companyId} onChange={(v) => set({ companyId: v })} all={t("All companies")} options={(companies.data?.companies ?? []).map((c) => [c.id, c.name])} />
        <FilterSelect value={filters.picId} onChange={(v) => set({ picId: v })} all={t("Any PIC")} options={[["none", t("No PIC yet")], ...activeMembers.map((m): [string, string] => [m.userId, m.name])]} />
        <FilterSelect value={filters.deadline} onChange={(v) => set({ deadline: v })} all={t("Any deadline")} options={[["overdue", t("Overdue")], ["week", t("Due within a week")], ["none", t("No deadline")]]} />
        {filtered && <Button variant="ghost" size="sm" className="gap-1" onClick={() => setFilters((f) => ({ q: f.q }))}><X className="h-3.5 w-3.5" /> {t("Clear filters")}</Button>}
      </div>

      {board.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
      ) : board.isError ? (
        <p className="py-6 text-sm text-destructive">{(board.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Inbox} title={filters.q || filtered ? t("Nothing matches") : t("No requests yet")}
          message={filters.q || filtered ? t("Try other words or fewer filters.") : t("People ask Legal for a document through a request link. Share one from Request links; their requests land here.")}
          action={!(filters.q || filtered) ? <Button size="sm" onClick={() => setLinksOpen(true)} className="gap-1.5"><Link2 className="h-4 w-4" /> {t("Request links")}</Button> : undefined} />
      ) : view === "board" ? (
        <>
        {/* Phones: the chips, one per column with its count, switch the board between its columns; the
            chosen column fills the width (UI tour run 13 W-M10, run 14 R14-WM-8: as a scroll row the other
            columns were only cut names at the edge, "In Prog", "Adder…"). Computers show every column. */}
        <div role="tablist" aria-label={t("Columns")} className="-mt-1 mb-2 flex gap-1.5 overflow-x-auto sm:hidden">
          {REQUEST_COLUMNS.map((col) => {
            const on = col === phoneCol;
            return (
              <button key={col} type="button" role="tab" aria-selected={on} aria-controls={`lr-col-${col}`}
                onClick={() => setPhoneColState(col)}
                className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors pointer-coarse:min-h-9",
                  on ? "border-foreground/25 bg-accent text-foreground" : "border-border bg-card text-muted-foreground")}>
                {columnLabel(col)}<span className="tabular-nums text-muted-foreground">{rows.filter((r) => r.column === col).length}</span>
              </button>
            );
          })}
        </div>
        {/* A column is as tall as its cards, not a tall empty grey body (W-M10). */}
        <div className="flex items-start gap-3 sm:overflow-x-auto sm:pb-3">
          {REQUEST_COLUMNS.map((col) => {
            const items = rows.filter((r) => r.column === col);
            return (
              <div key={col} id={`lr-col-${col}`} role="tabpanel"
                className={cn("flex w-full shrink-0 flex-col rounded-xl bg-muted/50 sm:w-80", col !== phoneCol && "max-sm:hidden", dragOver === col && "ring-2 ring-primary/50")}
                onDragOver={(e) => { e.preventDefault(); setDragOver(col); }}
                onDragLeave={() => setDragOver((c) => (c === col ? null : c))}
                onDrop={(e) => { e.preventDefault(); setDragOver(null); const id = e.dataTransfer.getData("text/x-legal-request"); const r = rows.find((x) => x.id === id); if (r && r.column !== col) move.mutate({ id, column: col }); }}>
                <div className="flex items-center gap-2 px-3 py-2.5 text-sm font-semibold">{columnLabel(col)}<span className="text-xs font-normal text-muted-foreground">{items.length}</span></div>
                <div className="flex-1 space-y-2 px-2 pb-2">
                  {items.map((r) => <RequestCard key={r.id} r={r} onOpen={() => onOpen(r.id)} />)}
                  {items.length === 0 && (
                    <div className="px-2 py-6 text-center text-[11px] text-muted-foreground">
                      {/* A phone has no dragging: there a request is moved from its sheet. */}
                      <span className="max-sm:hidden">{t("Drag a request here, or let it move by itself as its document goes.")}</span>
                      <span className="sm:hidden">{t("Open a request to move it here, or let it move by itself as its document goes.")}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        </>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("Requester")}</th>
                <th className="px-3 py-2 font-medium">{t("Type")}</th>
                <th className="px-3 py-2 font-medium">{t("Company")}</th>
                <th className="px-3 py-2 font-medium">{t("Deadline")}</th>
                <th className="px-3 py-2 font-medium">PIC</th>
                <th className="px-3 py-2 font-medium">{t("Document")}</th>
                <th className="px-3 py-2 font-medium">{t("Column")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer hover:bg-accent/40" onClick={() => onOpen(r.id)}>
                  <td className="px-3 py-2"><div className="font-medium">{r.requester?.name ?? "—"}</div><div className="text-xs text-muted-foreground">{fmtDate(r.createdAt)}</div></td>
                  <td className="px-3 py-2"><div className="line-clamp-1">{r.templateName || docTypeLabel(r.docType)}</div>{r.isAddendum && <div className="font-mono text-[11px] text-muted-foreground">{r.parentNumberText}</div>}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.company.name}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2", isOverdue(r) && "font-semibold text-rose-600 dark:text-rose-400")}>{r.deadline ? fmtDay(r.deadline, lang) : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.pic?.name ?? "—"}</td>
                  <td className="px-3 py-2">{r.document ? <DocChip d={r.document} /> : "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{r.rejected ? <RejectedLabel /> : columnLabel(r.column)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <RequestSheet id={openId} onClose={() => onOpen(null)} onOpenDocument={onOpenDocument} members={activeMembers.map((m) => ({ id: m.userId, name: m.name }))} />
      <RequestLinksDialog open={linksOpen} onOpenChange={setLinksOpen} />
    </section>
  );
}

function RejectedLabel() {
  const { t } = useLang();
  return <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2 py-0.5 text-xs font-semibold text-rose-700 dark:text-rose-300"><Ban className="h-3 w-3" />{t("Rejected")}</span>;
}

function DocChip({ d }: { d: NonNullable<BoardRequest["document"]> }) {
  const { t } = useLang();
  // A request whose number was voided is still being worked on: say what happened in words, not with a
  // struck-through "Void" chip that read as broken (UI tour run 13, W-D23).
  if (d.status === "VOID") {
    return (
      <span className="flex min-w-0 max-w-full flex-col">
        <span className="truncate font-mono text-[11px] text-muted-foreground" title={d.number ?? undefined}>{d.number}</span>
        <span className="text-[11px] text-muted-foreground">{t("Previous number voided")}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex max-w-full items-center gap-1.5">
      <span className="truncate font-mono text-[11px] text-muted-foreground">{d.number}</span>
      <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium", statusClass(d.status))}>{statusLabel(d.status)}</span>
    </span>
  );
}

function RequestCard({ r, onOpen }: { r: BoardRequest; onOpen: () => void }) {
  const { t, lang } = useLang();
  return (
    <button type="button" draggable onDragStart={(e) => { e.dataTransfer.setData("text/x-legal-request", r.id); e.dataTransfer.effectAllowed = "move"; }}
      onClick={onOpen} className="w-full cursor-grab rounded-lg border border-border bg-card p-2.5 text-left shadow-sm transition hover:border-ring/40 hover:shadow-md active:cursor-grabbing">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 text-sm font-semibold leading-snug">{r.templateName || docTypeLabel(r.docType)}</div>
        {r.rejected && <RejectedLabel />}
      </div>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{r.company.name}{r.isAddendum && r.parentNumberText ? ` · ${t("Amends {number}", { number: r.parentNumberText })}` : ""}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-muted-foreground">
        {/* Says who the name is (UI tour run 20, R20-WM-8: a bare name right above "No PIC yet"). */}
        <span>{r.requester?.name ? t("Requested by {name}", { name: r.requester.name }) : "—"}</span>
        {r.deadline && <span className={cn("inline-flex items-center gap-1", isOverdue(r) && "font-semibold text-rose-600 dark:text-rose-400")}><CalendarDays className="h-3 w-3" />{fmtDay(r.deadline, lang)}</span>}
        {r.attachments.length > 0 && <span className="inline-flex items-center gap-1"><Paperclip className="h-3 w-3" />{r.attachments.length}</span>}
      </div>
      {/* PIC and the document number on lines of their own (UI tour run 11, WD-4): side by side the number
          cut the name down to "PIC…". */}
      <div className="mt-1.5 truncate text-[11px] text-muted-foreground" title={r.pic?.name}>{r.pic ? `PIC · ${r.pic.name}` : t("No PIC yet")}</div>
      {r.document && <div className="mt-1 flex min-w-0 text-[11px]"><DocChip d={r.document} /></div>}
    </button>
  );
}

function FilterSelect({ value, onChange, all, options }: { value?: string; onChange: (v: string | undefined) => void; all: string; options: [string, string][] }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className="h-9 w-auto min-w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

function fmtValue(v: unknown, yes: string): string {
  if (v == null || v === "") return "—";
  if (typeof v === "boolean") return v ? yes : "—";
  if (typeof v === "number") return v.toLocaleString("id-ID");
  return String(v);
}

/** One request: the requester's answers and files, and what Legal does with it. */
function RequestSheet({ id, onClose, onOpenDocument, members }: { id: string | null; onClose: () => void; onOpenDocument: (id: string) => void; members: { id: string; name: string }[] }) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["legal", "request", id], queryFn: () => legalRequestsApi.get(id!), enabled: !!id });
  const r = q.data?.request;
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const refresh = () => { void qc.invalidateQueries({ queryKey: ["legal", "requests"] }); void qc.invalidateQueries({ queryKey: ["legal", "request", id] }); };
  const update = useMutation({
    mutationFn: (patch: Parameters<typeof legalRequestsApi.update>[1]) => legalRequestsApi.update(id!, patch),
    onSuccess: refresh,
    onError: (e: Error) => toast.error(e.message),
  });
  const reject = useMutation({
    mutationFn: () => legalRequestsApi.reject(id!, reason.trim()),
    onSuccess: () => { toast.success(t("Request declined. The requester sees your reason.")); setRejectOpen(false); setReason(""); refresh(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const parent = r?.parent && r.parent.number ? { id: r.parent.id, number: r.parent.number, title: r.parent.title ?? "" } : null;
  const docLive = r?.document && r.document.status !== "VOID";
  const label = "text-xs font-semibold text-muted-foreground";
  const values = (r?.fieldValues ?? {}) as Record<string, unknown>;
  const answered = (r?.fields ?? []).filter((f) => values[f.name] !== undefined && values[f.name] !== "" && !(Array.isArray(values[f.name]) && (values[f.name] as unknown[]).length === 0));

  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent lang={lang} className="w-full overflow-y-auto sm:max-w-2xl">
        {q.isLoading || !r ? (
          q.isError ? <p className="p-4 text-sm text-destructive">{(q.error as Error).message}</p> : <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
        ) : (
          <div className="space-y-5">
            <SheetHeader>
              <SheetTitle className="pr-6">{r.templateName || docTypeLabel(r.docType)}</SheetTitle>
              <SheetDescription>{t("{name} asked on {date}", { name: r.requester?.name ?? "—", date: fmtDate(r.createdAt) })} · {r.company.name}</SheetDescription>
            </SheetHeader>

            <div className="flex flex-wrap items-center gap-2">
              {r.rejected ? <RejectedLabel /> : <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold">{columnLabel(r.column)}</span>}
              {/* Rejected already says where it stands; the stage chip said "Rejected" a second time (visual QA 24 Oct). */}
              {!(r.rejected && r.stage === "REJECTED") && <StageChip stage={r.stage} />}
              {r.document && <button type="button" onClick={() => onOpenDocument(r.document!.id)} className="hover:underline"><DocChip d={r.document} /></button>}
            </div>

            {r.rejected && (
              <div className="rounded-lg border border-rose-300/60 bg-rose-50/60 p-3 text-sm dark:border-rose-500/30 dark:bg-rose-500/10">
                <div className="font-semibold">{t("Rejected")}</div>
                <p className="mt-0.5 whitespace-pre-wrap">{r.rejectReason}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t("Move it to To Do or In Progress to reopen it.")}</p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>{t("Column")}</Label>
                <Select value={r.column} onValueChange={(v) => update.mutate({ column: v as RequestColumn })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REQUEST_COLUMNS.map((c) => <SelectItem key={c} value={c}>{columnLabel(c)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>PIC</Label>
                <Select value={r.pic?.id ?? ALL} onValueChange={(v) => update.mutate({ picId: v === ALL ? null : v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL}>{t("No PIC yet")}</SelectItem>
                    {members.map((m) => <SelectItem key={m.id} value={m.id}>{m.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {r.isAddendum && (
              <div className="space-y-2 rounded-lg border border-border p-3">
                <div className="text-sm"><span className={label}>{t("Parent number as typed")}</span><div className="font-mono">{r.parentNumberText || "—"}</div></div>
                <div className="space-y-1.5">
                  <Label>{t("Parent document (signed)")}</Label>
                  <ParentPicker value={parent} disabled={!!docLive} onChange={(p) => update.mutate({ parentDocumentId: p?.id ?? null })} initialQuery={r.parentNumberText} />
                  <p className="text-xs text-muted-foreground">{t("Find the signed document the requester means. The addendum is numbered after it.")}</p>
                </div>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {!docLive ? (
                <Button className="gap-1.5" disabled={r.rejected || (r.isAddendum && !parent)} onClick={() => setCreateOpen(true)}>
                  <FilePlus2 className="h-4 w-4" /> {t("Create document")}
                </Button>
              ) : (
                <Button variant="outline" className="gap-1.5" onClick={() => onOpenDocument(r.document!.id)}><FileText className="h-4 w-4" /> {t("Open document")}</Button>
              )}
              {!r.rejected && r.document?.status !== "SIGNED" && (
                <Button variant="outline" className="gap-1.5 text-rose-600 hover:text-rose-700" onClick={() => setRejectOpen(true)}><Ban className="h-4 w-4" /> {t("Reject")}</Button>
              )}
            </div>
            {r.isAddendum && !parent && !docLive && !r.rejected && <p className="-mt-3 text-xs text-muted-foreground">{t("Pick the parent document first.")}</p>}

            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div><dt className={label}>{t("Needed by")}</dt><dd className={cn(isOverdue(r) && "font-semibold text-rose-600 dark:text-rose-400")}>{fmtDay(r.deadline, lang)}</dd></div>
              <div><dt className={label}>{t("Related to")}</dt><dd className="truncate">{r.linkHidden ? t("A project you can't open") : r.deal ? `${r.deal.code} · ${r.deal.name}` : r.project?.name ?? "—"}</dd></div>
            </dl>
            {r.purpose && <section><h3 className={cn(label, "mb-1")}>{t("Purpose and notes")}</h3><p className="whitespace-pre-wrap text-sm">{r.purpose}</p></section>}
            <section>
              <h3 className={cn(label, "mb-2")}>{t("What the requester filled in")}</h3>
              {answered.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing: they left the details to Legal.")}</p> : (
                <dl className="divide-y divide-border rounded-lg border border-border">
                  {answered.map((f) => (
                    <div key={f.name} className="grid gap-1 px-3 py-2 sm:grid-cols-[40%_1fr]">
                      <dt className="text-xs text-muted-foreground">{f.label}</dt>
                      <dd className="whitespace-pre-wrap break-words text-sm">
                        {f.type === "list" && Array.isArray(values[f.name])
                          ? (values[f.name] as Record<string, unknown>[]).map((row, i) => (
                              <div key={i} className="mb-1 rounded-md bg-muted/50 px-2 py-1">{(f.columns ?? []).map((c) => <div key={c.name}><span className="text-muted-foreground">{c.label}: </span>{fmtValue(row[c.name], t("Yes"))}</div>)}</div>
                            ))
                          : f.type === "date" ? fmtDay(String(values[f.name]), lang) : fmtValue(values[f.name], t("Yes"))}
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
            </section>
            {r.attachments.length > 0 && (
              <section>
                <h3 className={cn(label, "mb-2")}>{t("Attachments")}</h3>
                <ul className="space-y-1.5">
                  {r.attachments.map((a) => (
                    <li key={a.id}>
                      <a href={legalRequestsApi.attachmentUrl(r.id, a.id)} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent/50">
                        <Paperclip className="h-4 w-4 text-muted-foreground" /><span className="min-w-0 flex-1 truncate">{a.fileName}</span><span className="text-xs text-muted-foreground">{formatBytes(a.size)}</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <Dialog open={rejectOpen} onOpenChange={setRejectOpen}>
              <DialogContent lang={lang}>
                <DialogHeader>
                  <DialogTitle>{t("Reject this request?")}</DialogTitle>
                  <DialogDescription>{t("The requester sees your reason in My Submissions and gets a notification. The request moves to Done as Rejected.")}</DialogDescription>
                </DialogHeader>
                <div className="space-y-1.5">
                  <Label htmlFor="lr-reason">{t("Reason")}</Label>
                  <Textarea id="lr-reason" rows={4} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={1000} />
                </div>
                <DialogFooter className="gap-2">
                  <Button variant="ghost" onClick={() => setRejectOpen(false)}>{t("Cancel")}</Button>
                  <Button variant="destructive" disabled={reason.trim().length < 3 || reject.isPending} onClick={() => reject.mutate()} className="gap-1.5">
                    {reject.isPending && <Loader2 className="h-4 w-4 animate-spin" />} {t("Reject")}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>

            <NewDocumentDialog open={createOpen} onOpenChange={setCreateOpen} parent={r.isAddendum ? parent : null}
              fromRequest={q.data ? {
                requestId: r.id, templateId: q.data.prefill.templateId, companyId: q.data.prefill.companyId, values: q.data.prefill.values,
                link: q.data.prefill.dealId && r.deal ? { kind: "deal", id: r.deal.id, label: `${r.deal.code} · ${r.deal.name}` } : q.data.prefill.projectId && r.project ? { kind: "project", id: r.project.id, label: r.project.name } : null,
              } : null}
              onCreated={(docId) => { refresh(); onOpenDocument(docId); }} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Pick the signed document an addendum request amends (search starts from the number as typed). */
function ParentPicker({ value, onChange, initialQuery, disabled }: { value: { id: string; number: string; title: string } | null; onChange: (v: { id: string } | null) => void; initialQuery: string; disabled?: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(initialQuery);
  const [debounced, setDebounced] = useState(initialQuery);
  useEffect(() => { const h = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(h); }, [q]);
  const res = useQuery({ queryKey: ["legal", "documents", "signed-parents", debounced], queryFn: () => legalDocsApi.list({ q: debounced, status: "SIGNED", limit: 20 }), enabled: open });
  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" disabled={disabled} className="max-w-full justify-start gap-1.5">
            <FileText className="h-4 w-4 shrink-0" />
            <span className="truncate">{value ? `${value.number} · ${value.title}` : t("Pick the signed document")}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-96 p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput value={q} onValueChange={setQ} placeholder={t("Search number, title, counterparty…")} />
            <CommandList>
              {res.isLoading ? (
                <div className="flex items-center gap-2 px-3 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
              ) : (
                <>
                  <CommandEmpty>{t("No signed document matches")}</CommandEmpty>
                  <CommandGroup>
                    {(res.data?.documents ?? []).map((d) => (
                      <CommandItem key={d.id} value={d.id} onSelect={() => { onChange({ id: d.id }); setOpen(false); }}>
                        <div className="min-w-0"><div className="truncate font-mono text-xs">{d.number}</div><div className="truncate text-xs text-muted-foreground">{d.title} · {d.company.name}</div></div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {value && !disabled && <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={t("Clear")} onClick={() => onChange(null)}><X className="h-4 w-4" /></Button>}
    </div>
  );
}

/** The request links: the general one and one per company. Copy, open / close, regenerate. */
function RequestLinksDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t, lang } = useLang();
  const qc = useQueryClient();
  const links = useQuery({ queryKey: ["legal", "request-links"], queryFn: legalRequestsApi.requestLinks, enabled: open });
  const [confirm, setConfirm] = useState<string | null>(null);
  const done = () => void qc.invalidateQueries({ queryKey: ["legal", "request-links"] });
  const toggle = useMutation({
    mutationFn: ({ scope, accepting }: { scope: string; accepting: boolean }) => legalRequestsApi.setAccepting(scope, accepting),
    onSuccess: (res) => { toast.success(res.link.accepting ? t("The link takes requests again") : t("The link is closed for new requests")); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const regen = useMutation({
    mutationFn: (scope: string) => legalRequestsApi.regenerate(scope),
    onSuccess: () => { toast.success(t("New link made. The old one no longer works.")); setConfirm(null); done(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const url = (path: string) => `${window.location.origin}${path}`;
  const copy = async (path: string) => {
    try { await navigator.clipboard.writeText(url(path)); toast.success(t("Link copied")); } catch { toast.error(t("Couldn't copy. Select the link and copy it by hand.")); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent lang={lang} className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("Request links")}</DialogTitle>
          <DialogDescription>{t("Only people with a link can ask Legal for a document, and they sign in to NEXUS to send. The general link lets them pick the company; a company's link fixes it.")}</DialogDescription>
        </DialogHeader>
        {links.isLoading ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
        ) : links.isError ? (
          <p className="text-sm text-destructive">{(links.error as Error).message}</p>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {(links.data?.links ?? []).map((l) => (
              <li key={l.scope} className="space-y-2 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-sm font-semibold">{l.company ? l.company.name : t("General (company chosen in the form)")}</div>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    {l.accepting ? t("Taking requests") : t("Closed")}
                    <Switch checked={l.accepting} onCheckedChange={(v) => toggle.mutate({ scope: l.scope, accepting: v })} aria-label={t("Taking requests")} />
                  </label>
                </div>
                <div className="flex items-center gap-1.5">
                  <Input readOnly value={url(l.path)} className={cn("h-8 font-mono text-xs", !l.accepting && "text-muted-foreground line-through")} onFocus={(e) => e.currentTarget.select()} />
                  <Button variant="outline" size="sm" className="h-8 gap-1" onClick={() => copy(l.path)}><Copy className="h-3.5 w-3.5" /> {t("Copy")}</Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" asChild aria-label={t("Open")}><a href={l.path} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" /></a></Button>
                  <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={t("Regenerate")} title={t("Regenerate")} onClick={() => setConfirm(l.scope)}><RefreshCw className="h-3.5 w-3.5" /></Button>
                </div>
                {l.rotatedAt && <p className="text-[11px] text-muted-foreground">{t("Regenerated {date}", { date: fmtDate(l.rotatedAt) })}</p>}
              </li>
            ))}
          </ul>
        )}
        <AlertDialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
          <AlertDialogContent lang={lang}>
            <AlertDialogHeader>
              <AlertDialogTitle>{t("Make a new link?")}</AlertDialogTitle>
              <AlertDialogDescription>{t("The current link stops working at once. Anyone who has it will need the new one. Requests already sent stay.")}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={(e) => { e.preventDefault(); if (confirm) regen.mutate(confirm); }}>{t("Make a new link")}</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}
