import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DateField } from "@/components/DateField";
import { useQuery } from "@tanstack/react-query";
import { CornerDownRight, FilePlus2, FileSignature, FileText, GitBranch, ListFilter, Loader2, Search, Upload, X } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { NewDocumentDialog } from "@/components/legal/NewDocumentDialog";
import { LegalDocumentSheet } from "@/components/legal/LegalDocumentSheet";
import { UploadDocumentDialog } from "@/components/legal/UploadDocumentDialog";
import { LegalLinkPicker, type LegalLink } from "@/components/legal/LegalLinkPicker";
import { docTypeLabel, fmtDay, statusClass, statusLabel } from "@/components/legal/legal-labels";
import { LEGAL_DOC_TYPES, LEGAL_STATUSES, legalDocsApi, legalTemplatesApi, type ArchiveQuery, type LegalDocumentSummary } from "@/lib/legal-api";
import { useIsMobile } from "@/hooks/use-mobile";
import { useLang } from "@/lib/lang";
import { fmtDate } from "@/lib/nexus-api";
import { cn } from "@/lib/utils";

const ALL = "__all";
const PAGE = 50;

/**
 * The archive (owner, 14 Oct 2026): every legal document — made here or uploaded (a signed contract, an
 * outside invoice) — searchable by number, title and counterparty, and filtered by company, type, status,
 * date and where it came from.
 */
export function LegalDocuments({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const { t, tn, lang } = useLang();
  const [newOpen, setNewOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [text, setText] = useState("");
  const [filters, setFilters] = useState<ArchiveQuery>({});
  const [page, setPage] = useState(1);
  const [link, setLink] = useState<LegalLink>(null);

  useEffect(() => {
    const h = setTimeout(() => { setFilters((f) => ({ ...f, q: text.trim() || undefined })); setPage(1); }, 300);
    return () => clearTimeout(h);
  }, [text]);

  const query = { ...filters, page, limit: PAGE };
  const docs = useQuery({ queryKey: ["legal", "documents", query], queryFn: () => legalDocsApi.list(query), placeholderData: (prev) => prev });
  const companies = useQuery({ queryKey: ["legal", "companies"], queryFn: legalTemplatesApi.companies, staleTime: 60_000 });
  const rows = docs.data?.documents ?? [];
  const total = docs.data?.total ?? 0;
  const set = (patch: Partial<ArchiveQuery>) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const filtered = Object.entries(filters).some(([k, v]) => k !== "q" && v);

  const isMobile = useIsMobile();
  // From xl the column header sticks under the page header (UI tour run 16, R16-WD-8: pages 2 to 5 had no
  // column labels), and rows snap whole under it: its height, less the 1rem the page already keeps for the
  // header's fade (the header row covers that fade), is extra snap room for the page.
  const headRef = useRef<HTMLTableSectionElement>(null);
  useEffect(() => {
    const head = headRef.current;
    if (!head) return;
    const root = document.documentElement;
    const wide = window.matchMedia("(min-width: 1280px)");
    const read = () => {
      if (wide.matches) root.style.setProperty("--page-snap-extra", `${Math.max(0, Math.round(head.offsetHeight) - 16)}px`);
      else root.style.removeProperty("--page-snap-extra");
    };
    read();
    wide.addEventListener("change", read);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(head);
    return () => { wide.removeEventListener("change", read); ro?.disconnect(); root.style.removeProperty("--page-snap-extra"); };
  });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilters = Object.entries(filters).filter(([k, v]) => k !== "q" && k !== "parentId" && v).length;
  const clearFilters = () => { setFilters((f) => ({ q: f.q })); setLink(null); setPage(1); };
  const showChain = (d: ArchiveDoc) => set({ parentId: d.parent?.id ?? d.id });

  const linkPicker = (
    <LegalLinkPicker value={link} placeholder={t("Any project or deal")} size="default"
      onChange={(v) => { setLink(v); set({ projectId: v?.kind === "project" ? v.id : undefined, dealId: v?.kind === "deal" ? v.id : undefined }); }} />
  );
  // The filters, laid out by the caller: a wrapping row on desktop, a stacked list in the phone's filter sheet.
  const filterControls = (
    <>
      <FilterSelect value={filters.companyId} onChange={(v) => set({ companyId: v })} all={t("All companies")} block={isMobile}
        options={(companies.data?.companies ?? []).map((c) => [c.id, c.name])} />
      <FilterSelect value={filters.docType} onChange={(v) => set({ docType: v })} all={t("All types")} block={isMobile}
        options={LEGAL_DOC_TYPES.map((d) => [d, docTypeLabel(d)])} />
      <FilterSelect value={filters.status} onChange={(v) => set({ status: v })} all={t("All statuses")} block={isMobile}
        options={LEGAL_STATUSES.map((s) => [s, statusLabel(s)])} />
      <FilterSelect value={filters.signed} onChange={(v) => set({ signed: v })} all={t("Signed or not")} block={isMobile}
        options={[["1", t("Signed copy uploaded")]]} />
      <FilterSelect value={filters.source} onChange={(v) => set({ source: v })} all={t("Made or uploaded")} block={isMobile}
        options={[["GENERATED", t("Made here")], ["UPLOADED", t("Uploaded")]]} />
      <DateRange from={filters.from} to={filters.to} onChange={(from, to) => set({ from, to })} block={isMobile} />
      {isMobile && linkPicker}
    </>
  );
  const chainChip = filters.parentId && (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
      <GitBranch className="h-3.5 w-3.5" /> {t("One document and its addenda")}
      <button type="button" aria-label={t("Clear filters")} onClick={() => set({ parentId: undefined })}><X className="h-3.5 w-3.5" /></button>
    </span>
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Search documents")} aria-label={t("Search number, title, counterparty…")} className="pl-8" />
        </div>
        {/* Desktop: the project/deal filter sits with the search, so the filter row below fits on one line. */}
        {!isMobile && linkPicker}
        {isMobile && (
          <Button variant="outline" onClick={() => setFiltersOpen(true)} className="gap-1.5" aria-label={t("Filters")}>
            <ListFilter className="h-4 w-4" /> {t("Filters")}
            {activeFilters > 0 && <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-semibold text-primary-foreground tabular-nums">{activeFilters}</span>}
          </Button>
        )}
        <Button variant="outline" onClick={() => setUploadOpen(true)} className="gap-1.5 max-md:flex-1"><Upload className="h-4 w-4" /> {t("Upload document")}</Button>
        <Button onClick={() => setNewOpen(true)} className="gap-1.5 max-md:flex-1"><FilePlus2 className="h-4 w-4" /> {t("New document")}</Button>
      </div>

      {isMobile ? (
        (chainChip || filtered) && (
          <div className="flex flex-wrap items-center gap-2">
            {chainChip}
            {filtered && <Button variant="ghost" size="sm" className="gap-1" onClick={clearFilters}><X className="h-3.5 w-3.5" /> {t("Clear filters")}</Button>}
          </div>
        )
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          {filterControls}
          {chainChip}
          {filtered && <Button variant="ghost" size="sm" className="gap-1" onClick={clearFilters}><X className="h-3.5 w-3.5" /> {t("Clear filters")}</Button>}
        </div>
      )}

      {/* Phone: the seven filters wrapped into four ragged rows above the list; they live in a sheet here. */}
      {isMobile && (
        <Sheet open={filtersOpen} onOpenChange={setFiltersOpen}>
          <SheetContent side="bottom" className="max-h-[85dvh] overflow-y-auto rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
            <SheetHeader className="text-left">
              <SheetTitle>{t("Filters")}</SheetTitle>
              <SheetDescription className="sr-only">{t("Filter the documents")}</SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-2.5">{filterControls}</div>
            <div className="mt-5 flex gap-2">
              <Button variant="outline" className="flex-1" disabled={!filtered} onClick={clearFilters}>{t("Clear filters")}</Button>
              <Button className="flex-1" onClick={() => setFiltersOpen(false)}>{t("Show results")}</Button>
            </div>
          </SheetContent>
        </Sheet>
      )}

      {docs.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
      ) : docs.isError ? (
        <p className="py-6 text-sm text-destructive">{(docs.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title={filters.q || filtered ? t("Nothing matches") : t("No documents yet")}
          message={filters.q || filtered ? t("Try other words or fewer filters.") : t("Make one from a template, or upload a signed document.")} />
      ) : (
        <>
          {isMobile ? (
            // Phone (UI tour run 10, WM-1): a card per document like the iPhone app; the desktop table showed
            // only its first column here, the rest scrolled off to the right.
            <ul data-snap-rows className="divide-y divide-border overflow-clip rounded-xl border border-border bg-card">
              {rows.map((d) => (
                <li key={d.id}>
                  <DocCard d={d} lang={lang} onOpen={() => onOpen(d.id)} onShowChain={filters.parentId ? undefined : () => showChain(d)} />
                </li>
              ))}
            </ul>
          ) : (
          // From xl the table fits, and `overflow-clip` (no scroll box of its own) lets its rows snap under the page
          // header (UI tour run 15, R15-WB-1).
          <div className="overflow-x-auto rounded-lg border border-border xl:overflow-clip">
            {/* Fixed columns (UI tour run 10, WD-1): the number column took a third of the row and cut the
                title; it is now a set width with an ellipsis (the full number on hover), and the title gets
                the room. */}
            <table className="w-full min-w-[900px] table-fixed text-sm">
              <colgroup>
                {/* Status gave up width it did not use to the number and the counterparty (UI tour run 13, W-D11),
                    and again to the title (run 14, R14-WD-12: a chip needs ~6 rem; the signed line truncates). */}
                {/* Company and the signed line under the status got the room the date did not use (UI tour run 15,
                    R15-WD-7: "The Z Networ…" and "14 Oct · QA D…" were cut beside a half-empty date column). */}
                <col className="w-[14rem]" />
                <col />
                <col className="w-[11rem]" />
                <col className="w-[9.5rem]" />
                <col className="w-[6rem]" />
                <col className="w-[9.5rem]" />
              </colgroup>
              <thead ref={headRef} className="bg-card text-left text-xs text-muted-foreground xl:sticky xl:top-[var(--page-sticky-top,0px)] xl:z-[41] xl:shadow-[0_1px_0_0_var(--border)]">
                <tr className="bg-muted/40">
                  <th className="px-3 py-2 font-medium">{t("Document no.")}</th>
                  <th className="px-3 py-2 font-medium">{t("Title")}</th>
                  <th className="px-3 py-2 font-medium">{t("Counterparty")}</th>
                  <th className="px-3 py-2 font-medium">{t("Company")}</th>
                  <th className="px-3 py-2 font-medium">{t("Date")}</th>
                  <th className="px-3 py-2 font-medium">{t("Status")}</th>
                </tr>
              </thead>
              <tbody data-snap-rows className="divide-y divide-border">
                {rows.map((d) => (
                  <tr key={d.id} className="cursor-pointer hover:bg-accent/40" onClick={() => onOpen(d.id)}>
                    <td className="px-3 py-2 align-top font-mono text-xs">
                      <div className="flex min-w-0 items-center">
                        {d.parent && <CornerDownRight className="mr-1 h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />}
                        {d.number ? <DocNumber number={d.number} className={cn(d.numberReleased && "line-through text-muted-foreground")} /> : "—"}
                      </div>
                      {d.status === "VOID" && d.numberReusedBy && (
                        // The label on its own line, the number whole on one line under it, cut with an ellipsis and
                        // shown in full on hover (UI tour run 12, WD1: it wrapped mid-number in the narrow column).
                        <div className="min-w-0 text-[11px] text-muted-foreground" title={t("Number reused by {number}", { number: d.numberReusedBy.number })}>
                          <div className="font-sans">{t("Number reused by")}</div>
                          <DocNumber number={d.numberReusedBy.number} />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top">
                      {/* Up to two lines (R14-WD-12): long titles that share a start were cut to the same first words. */}
                      <div className="line-clamp-2 break-words font-medium" title={d.title}>{d.title}</div>
                      <div className="line-clamp-2 text-xs text-muted-foreground">
                        <DocKind d={d} />
                      </div>
                      {/* Its own line: inside the clamped kind line it was cut off on most addenda (UI tour run 13, W-D10). */}
                      {(d.addendaCount > 0 || d.parent) && !filters.parentId && (
                        <button type="button" className="text-xs text-primary hover:underline" onClick={(e) => { e.stopPropagation(); showChain(d); }}>
                          {d.addendaCount > 0 ? tn(d.addendaCount, "1 addendum", "{n} addenda") : t("Show the chain")}
                        </button>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top"><span className="block truncate" title={d.counterparty || undefined}>{d.counterparty || "—"}</span></td>
                    <td className="px-3 py-2 align-top"><span className="block truncate" title={d.company.name}>{d.company.name}</span></td>
                    <td className="whitespace-nowrap px-3 py-2 align-top">{fmtDay(d.docDate, lang)}</td>
                    <td className="px-3 py-2 align-top">
                      <StatusChip status={d.status} />
                      <SignedLine d={d} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
          {total > PAGE && (
            <div className="flex items-center justify-between text-sm text-muted-foreground">
              <span>{t("{from}–{to} of {total}", { from: (page - 1) * PAGE + 1, to: Math.min(page * PAGE, total), total })}</span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>{t("Previous")}</Button>
                <Button variant="outline" size="sm" disabled={page * PAGE >= total} onClick={() => setPage((p) => p + 1)}>{t("Next")}</Button>
              </div>
            </div>
          )}
        </>
      )}

      <NewDocumentDialog open={newOpen} onOpenChange={setNewOpen} onCreated={(id) => onOpen(id)} />
      <UploadDocumentDialog open={uploadOpen} onOpenChange={setUploadOpen} onCreated={(id) => onOpen(id)} />
      <LegalDocumentSheet documentId={openId} onClose={() => onOpen(null)} onOpen={(id) => onOpen(id)}
        onShowChain={(parentId) => { set({ parentId }); onOpen(null); }} />
    </section>
  );
}

type ArchiveDoc = LegalDocumentSummary;

function StatusChip({ status }: { status: string }) {
  return <span className={cn("inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", statusClass(status))}>{statusLabel(status)}</span>;
}

/** Type · uploaded · project or deal · "Addendum to …": the second line under a document's title. */
function DocKind({ d }: { d: ArchiveDoc }) {
  const { t } = useLang();
  // An addendum says so once: "Addendum to PKS/…", not "Addendum · Addendum to PKS/…" (UI tour run 15, R15-WM-11).
  const parts = [
    d.parent && d.docType === "ADD" ? null : docTypeLabel(d.docType),
    d.source === "UPLOADED" ? t("Uploaded") : null,
    d.deal ? d.deal.code : d.project ? d.project.name : null,
  ].filter(Boolean);
  return (
    <>
      {parts.join(" · ")}
      {d.parent && <>{parts.length > 0 && " · "}<AddendumOf number={d.parent.number} /></>}
    </>
  );
}

function AddendumOf({ number }: { number: string }) {
  const { t } = useLang();
  const label = t("Addendum to {number}", { number: "\u0000" });
  const [before, after = ""] = label.split("\u0000");
  return <>{before}<UnbrokenNumber number={number} />{after}</>;
}

/** A document number that breaks only after "/" (each part is unbreakable), and starts a line whole when it fits. */
export function UnbrokenNumber({ number, className }: { number: string; className?: string }) {
  const parts = number.split("/");
  return (
    <span className={cn("inline-block max-w-full align-top", className)}>
      {parts.map((p, i) => (
        <Fragment key={i}><span className="whitespace-nowrap">{p}{i < parts.length - 1 ? "/" : ""}</span>{i < parts.length - 1 && <wbr />}</Fragment>
      ))}
    </span>
  );
}

function SignedLine({ d }: { d: ArchiveDoc }) {
  const { t } = useLang();
  if (!d.signedAt) return null;
  return (
    <div className="mt-1 flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground" title={t("Signed copy uploaded {date} by {name}", { date: fmtDate(d.signedAt), name: d.signedBy?.name ?? "—" })}>
      <FileSignature className="h-3 w-3 shrink-0 text-emerald-600" /> <span className="truncate">{fmtDate(d.signedAt)} · {d.signedBy?.name ?? "—"}</span>
    </div>
  );
}

/** Phone: number / title / counterparty · company · date / type, with the status chip on the number's line. */
function DocCard({ d, lang, onOpen, onShowChain }: { d: ArchiveDoc; lang: "id" | "en"; onOpen: () => void; onShowChain?: () => void }) {
  const { t, tn } = useLang();
  return (
    <div role="button" tabIndex={0} onClick={onOpen} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(); } }}
      className="block w-full cursor-pointer px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
      <div className="flex items-start gap-2">
        {/* The whole number, wrapped only after a "/" onto a second line like "Number reused by" below, not
            cut inside a part or the year (UI tour run 18, R18-WM-3: "…/OKT/20…/002/ADD-1"). */}
        <div className="flex min-w-0 flex-1 items-start pt-px font-mono text-xs leading-snug text-muted-foreground">
          {d.parent && <CornerDownRight className="mr-1 mt-px h-3 w-3 shrink-0" aria-hidden />}
          {d.number ? <UnbrokenNumber number={d.number} className={cn("min-w-0", d.numberReleased && "line-through")} /> : <span className="truncate">{t("No number")}</span>}
        </div>
        <StatusChip status={d.status} />
      </div>
      <div className="mt-1 line-clamp-2 font-medium leading-snug">{d.title}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">
        {[d.counterparty, d.company.name, fmtDay(d.docDate, lang)].filter(Boolean).join(" · ")}
      </div>
      <div className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
        <DocKind d={d} />
      </div>
      {/* The label on one line, the number on the next (UI tour run 13, W-M7: it ran on as text and broke at a
          hyphen), whole and wrapped only after a "/" like the number above (R18-WM-3). */}
      {d.status === "VOID" && d.numberReusedBy && (
        <div className="mt-0.5 min-w-0 text-xs text-muted-foreground">
          <div>{t("Number reused by")}</div>
          <UnbrokenNumber number={d.numberReusedBy.number} className="font-mono" />
        </div>
      )}
      {(d.addendaCount > 0 || d.parent) && onShowChain && (
        <button type="button" className="mt-1 text-xs font-medium text-primary hover:underline" onClick={(e) => { e.stopPropagation(); onShowChain(); }}>
          {d.addendaCount > 0 ? tn(d.addendaCount, "1 addendum", "{n} addenda") : t("Show the chain")}
        </button>
      )}
      <SignedLine d={d} />
    </div>
  );
}

/** From and to as one control, so the pair never wraps apart ("To" alone on the next line, UI tour run 10). */
function DateRange({ from, to, onChange, block }: { from?: string; to?: string; onChange: (from: string | undefined, to: string | undefined) => void; block?: boolean }) {
  const { t } = useLang();
  // The app's date picker (UI tour run 11, WD-7/WM-11): the browser's field showed "dd/mm/yyyy" and its own
  // calendar icon in the middle of the control.
  const field = "min-h-7 min-w-0 px-1 py-0.5 text-sm text-foreground";
  return (
    <div role="group" aria-label={t("Document date")}
      className={cn("flex h-9 shrink-0 items-center gap-1 whitespace-nowrap rounded-md border border-input px-2 text-xs text-muted-foreground shadow-sm focus-within:ring-1 focus-within:ring-ring", block ? "w-full" : "w-auto")}>
      <span>{t("Date")}</span>
      <DateField ariaLabel={t("From")} placeholder={t("From")} className={cn(field, block ? "flex-1" : "w-[6.5rem]")} value={from ?? null} max={to || undefined}
        onChange={(v) => onChange(v || undefined, to)} />
      <span aria-hidden>–</span>
      <DateField ariaLabel={t("To")} placeholder={t("To")} className={cn(field, block ? "flex-1" : "w-[6.5rem]")} value={to ?? null} min={from || undefined}
        onChange={(v) => onChange(from, v || undefined)} />
    </div>
  );
}

function FilterSelect({ value, onChange, all, options, block }: { value?: string; onChange: (v: string | undefined) => void; all: string; options: [string, string][]; block?: boolean }) {
  return (
    <Select value={value ?? ALL} onValueChange={(v) => onChange(v === ALL ? undefined : v)}>
      <SelectTrigger className={cn("h-9", block ? "w-full" : "w-auto gap-2")}><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{all}</SelectItem>
        {options.map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/**
 * A document number cut in the middle, never at its end: the last two parts ("/2026/003", "/002/ADD-1") stay
 * whole, so numbers that share a long start stay told apart (UI tour run 13, W-D5: three rows all read
 * "PKS/PATS-UNIV/YOGYAKART…"). The full number is on hover. Whole parts only (UI tour run 18, R18-WM-3): the
 * cut drops middle parts at their "/" ("PKS/PATS-UNIV/…/2026/003"), never half a part or the year.
 *
 * The cut is counted in characters, not left to CSS: a truncated head span next to the tail left the unused
 * part of a character cell between "…" and the tail ("…  /2027/001", UI tour run 14, R14-WB-6). The number
 * is set in a monospace face, so the width of one character is the measured width over its length.
 */
/**
 * `number` in at most `fit` characters, cut only at "/": the first parts that fit, "…", then the last two parts
 * whole ("PKS/PATS-UNIV/…/2026/003", or "…/2026/003"). Unchanged when it has no middle part to drop or not even
 * "…" and the last two parts fit (the box then truncates it at its end).
 */
function elideAtSlash(number: string, fit: number): string {
  const parts = number.split("/");
  if (number.length <= fit || parts.length < 4) return number;
  const tail = `/${parts.slice(-2).join("/")}`;
  for (let k = parts.length - 3; k >= 1; k--) {
    const text = `${parts.slice(0, k).join("/")}/…${tail}`;
    if (text.length <= fit) return text;
  }
  return 1 + tail.length <= fit ? `…${tail}` : number;
}

function DocNumber({ number, className }: { number: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const [fit, setFit] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = box.current, pr = probe.current;
    if (!el || !pr) return;
    const read = () => {
      const full = pr.getBoundingClientRect().width;
      const room = el.getBoundingClientRect().width;
      if (!full || !number.length) return setFit(null);
      const per = full / number.length;
      setFit(full <= room + 0.5 ? null : Math.max(0, Math.floor((room + 0.5) / per)));
    };
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [number]);
  const text = fit === null ? number : elideAtSlash(number, fit);
  return (
    <span ref={box} className="relative block min-w-0 flex-1 overflow-hidden" title={number}>
      {/* The full number, out of sight, measures one character. */}
      <span ref={probe} aria-hidden className="invisible absolute left-0 top-0 whitespace-pre">{number}</span>
      <span className={cn("block truncate whitespace-pre", className)}>{text}</span>
    </span>
  );
}
