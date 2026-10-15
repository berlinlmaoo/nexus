import { Fragment, useEffect, useRef, useState } from "react";
import { useStickyHeaderOffset } from "@/hooks/use-sticky-header-offset";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Check, Download, Loader2, Pencil, Plus, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { docTypeLabel } from "@/components/legal/legal-labels";
import { fmtDate } from "@/lib/nexus-api";
import { LEGAL_DOC_TYPES, legalApi, legalSettingsApi, legalTemplatesApi, type LegalCompany, type LegalSeries } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

/**
 * Issuing companies (owner, 14 Oct 2026): their legal name and address as printed in contracts, their kop,
 * and their numbering series. Only the owner and the BoD members he invited change these.
 */
export function LegalSettings() {
  const { t } = useLang();
  const me = useQuery({ queryKey: ["legal", "me"], queryFn: legalApi.me, staleTime: 60_000 });
  const companies = useQuery({ queryKey: ["legal", "companies"], queryFn: legalTemplatesApi.companies });
  const canEdit = (me.data?.invitePower ?? "NONE") !== "NONE";
  const headerTop = useStickyHeaderOffset();
  const jumpRef = useRef<HTMLElement>(null);
  // The chip of the company in view is marked, following the scroll (UI tour run 15, R15-WB-7): the company
  // whose card starts at or above the line just under the pinned chips, else the first.
  const [inView, setInView] = useState<string | null>(null);
  const list = companies.data?.companies;
  // Rows snap whole under the pinned chips too, not just under the page header (UI tour run 16, R16-WB-1:
  // series rows were cut under the chip bar). The chip bar's height is extra snap room for the page.
  useEffect(() => {
    const bar = jumpRef.current;
    if (!bar) return;
    const root = document.documentElement;
    const read = () => root.style.setProperty("--page-snap-extra", `${Math.round(bar.offsetHeight)}px`);
    read();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(read);
    ro?.observe(bar);
    return () => { ro?.disconnect(); root.style.removeProperty("--page-snap-extra"); };
  }, [list]);
  useEffect(() => {
    if (!list || list.length <= 2) return;
    let frame = 0;
    const read = () => {
      frame = 0;
      const line = headerTop + (jumpRef.current?.offsetHeight ?? 0) + 24;
      let current = list[0]?.id ?? null;
      for (const c of list) {
        const el = document.getElementById(`legal-co-${c.id}`);
        if (el && el.getBoundingClientRect().top <= line) current = c.id;
      }
      setInView(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(read); };
    read();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => { if (frame) cancelAnimationFrame(frame); window.removeEventListener("scroll", schedule); window.removeEventListener("resize", schedule); };
  }, [list, headerTop]);

  if (companies.isLoading) return <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>;
  if (companies.isError) return <p className="py-6 text-sm text-destructive">{(companies.error as Error).message}</p>;
  return (
    <div className="space-y-4">
      {!canEdit && <p className="text-sm text-muted-foreground">{t("Only the owner or a board member with Legal can change these.")}</p>}
      {/* A long page (a company each with its letterhead and ~11 series): a row of its companies to jump to
          (UI tour run 13, W-B26). It stays pinned under the header and tabs while the page scrolls (run 14,
          R14-WB-7), and a company it jumps to lands below it. */}
      {(companies.data?.companies.length ?? 0) > 2 && (
        <nav ref={jumpRef} aria-label={t("Companies")} style={{ top: headerTop }}
          // From md: above the header's 1rem band (z-41, it sits right under the header), with a band of its own
          // (a shadow, which the strip's overflow does not clip), so the 1rem a snapped row keeps under the chips
          // never shows the tail of the row before (UI tour run 17, R17-WB-1: half a series pattern and toggle).
          className="sticky z-20 -mx-4 flex gap-1.5 overflow-x-auto border-b border-border bg-background px-4 py-2 [scrollbar-width:none] md:z-[41] md:-mx-8 md:flex-wrap md:px-8 md:shadow-[0_1rem_0_0_var(--background)] [&::-webkit-scrollbar]:hidden">
          {companies.data!.companies.map((c) => (
            <button key={c.id} type="button" aria-current={inView === c.id ? "location" : undefined}
              onClick={() => {
                const el = document.getElementById(`legal-co-${c.id}`);
                if (!el) return;
                el.style.scrollMarginTop = `${headerTop + (jumpRef.current?.offsetHeight ?? 0) + 12}px`;
                el.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-9",
                inView === c.id ? "border-foreground/25 bg-accent text-foreground" : "border-border bg-card hover:bg-muted")}>
              {c.name}{!sameAsName(c) && <span className="font-mono text-[10px] text-muted-foreground">{c.code}</span>}
            </button>
          ))}
        </nav>
      )}
      {(companies.data?.companies ?? []).map((c) => <CompanyCard key={c.id} company={c} canEdit={canEdit} />)}
      <TokenHelp />
    </div>
  );
}

/** A code that only repeats the name ("PATS PATS") is not shown (UI tour run 16, R16-WM-9). */
function sameAsName(c: { name: string; code: string }): boolean {
  return c.code.trim().toLowerCase() === c.name.trim().toLowerCase();
}

function CompanyCard({ company, canEdit }: { company: LegalCompany; canEdit: boolean }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ name: company.name, code: company.code, legalName: company.legalName, address: company.address });
  useEffect(() => { setDraft({ name: company.name, code: company.code, legalName: company.legalName, address: company.address }); }, [company]);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["legal", "companies"] });
  const save = useMutation({
    mutationFn: () => legalSettingsApi.updateCompany(company.id, draft),
    onSuccess: () => { refresh(); toast.success(t("Saved")); },
    onError: (e: Error) => toast.error(e.message),
  });
  const kop = useMutation({
    mutationFn: (file: File) => legalSettingsApi.uploadKop(company.id, file),
    onSuccess: () => { refresh(); toast.success(t("Letterhead uploaded")); },
    onError: (e: Error) => toast.error(e.message),
  });
  const dirty = draft.name !== company.name || draft.code !== company.code || draft.legalName !== company.legalName || draft.address !== company.address;

  return (
    // The card itself is the snap point, so a company stops with its top edge and padding (UI tour run 17,
    // R17-WB-1: it snapped at its title, the edge hidden above it).
    <section id={`legal-co-${company.id}`} data-snap-row className="scroll-mt-32 space-y-4 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{company.name}{!sameAsName(company) && <> <span className="font-mono text-xs font-normal text-muted-foreground">{company.code}</span></>}</h2>
        {!company.legalName && <span className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="h-3.5 w-3.5" /> {t("Legal name (PT) not filled in")}</span>}
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>{t("Name")}</Label>
          <Input disabled={!canEdit} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>
        <div className="space-y-1.5">
          <Label>{t("Code in numbers ({CO})")}</Label>
          <Input disabled={!canEdit} value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value.toUpperCase() })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("Legal name, as printed in contracts")}</Label>
          <Input disabled={!canEdit} value={draft.legalName} placeholder="PT …" onChange={(e) => setDraft({ ...draft, legalName: e.target.value })} />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label>{t("Address")}</Label>
          <Textarea disabled={!canEdit} rows={2} value={draft.address} onChange={(e) => setDraft({ ...draft, address: e.target.value })} />
        </div>
      </div>
      {canEdit && <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>{t("Save")}</Button>}

      {/* One layout for every company (UI tour run 12, WM5: with flex-wrap the file name wrapped "14 / Oct" on one
          and Download / Replace landed in different places on each). Label and file on the left, the file name
          cut with an ellipsis and the date kept whole; the buttons in a fixed order, on their own row on a phone
          and at the right from sm. */}
      <div data-snap-row className="flex flex-col gap-2 rounded-md bg-muted/40 px-3 py-2.5 text-sm sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium">{t("Letterhead")}</div>
          {company.hasKop ? (
            <div className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground">
              <span className="truncate" title={company.kopFileName ?? "kop.docx"}>{company.kopFileName ?? "kop.docx"}</span>
              <span className="shrink-0 whitespace-nowrap">· {t("Uploaded {date}", { date: fmtDate(company.kopUpdatedAt) })}</span>
            </div>
          ) : (
            <div className="text-xs text-muted-foreground">{t("Not uploaded: documents get no letterhead.")}</div>
          )}
        </div>
        {(company.hasKop || canEdit) && (
          <div className="flex shrink-0 items-center gap-2">
            {company.hasKop && <Button asChild variant="outline" size="sm" className="gap-1.5"><a href={legalSettingsApi.kopUrl(company.id)}><Download className="h-4 w-4" /> {t("Download")}</a></Button>}
            {canEdit && (
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border bg-background px-3 text-xs font-medium hover:bg-accent">
                {kop.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} {company.hasKop ? t("Replace") : t("Upload letterhead")}
                <input type="file" accept=".docx" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) kop.mutate(f); e.target.value = ""; }} />
              </label>
            )}
          </div>
        )}
      </div>

      <SeriesTable company={company} canEdit={canEdit} />
    </section>
  );
}

function SeriesTable({ company, canEdit }: { company: LegalCompany; canEdit: boolean }) {
  const { t } = useLang();
  const [adding, setAdding] = useState(false);
  return (
    <div className="space-y-2">
      <div data-snap-row className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">{t("Numbering series")}</h3>
        {canEdit && !adding && <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setAdding(true)}><Plus className="h-4 w-4" /> {t("Add numbering series")}</Button>}
      </div>
      <ul data-snap-rows className="divide-y divide-border rounded-md border border-border">
        {company.series.map((s) => <SeriesRow key={s.id} s={s} canEdit={canEdit} />)}
        {adding && <NewSeriesRow companyId={company.id} onDone={() => setAdding(false)} />}
      </ul>
    </div>
  );
}

function SeriesRow({ s, canEdit }: { s: LegalSeries; canEdit: boolean }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ label: s.label, format: s.format, resetPeriod: s.resetPeriod });
  const info = useQuery({ queryKey: ["legal", "series", s.id], queryFn: () => legalSettingsApi.series(s.id), enabled: editing });
  const save = useMutation({
    mutationFn: (patch: Parameters<typeof legalSettingsApi.updateSeries>[1]) => legalSettingsApi.updateSeries(s.id, patch),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["legal", "companies"] }); void qc.invalidateQueries({ queryKey: ["legal", "series", s.id] }); setEditing(false); toast.success(t("Saved")); },
    onError: (e: Error) => toast.error(e.message),
  });
  if (editing) {
    return (
      <li className="space-y-2 px-3 py-2.5">
        <div className="grid gap-2 sm:grid-cols-[1fr_1.4fr_8rem]">
          <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} aria-label={t("Name")} />
          <Input className="font-mono text-xs" value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value })} aria-label={t("Format")} />
          <Select value={draft.resetPeriod} onValueChange={(v) => setDraft({ ...draft, resetPeriod: v as "YEAR" | "MONTH" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent><SelectItem value="YEAR">{t("Yearly")}</SelectItem><SelectItem value="MONTH">{t("Monthly")}</SelectItem></SelectContent>
          </Select>
        </div>
        {info.data && (
          <p className="text-xs text-muted-foreground">
            {t("{n} numbers issued. Next today: {next}", { n: info.data.issued, next: info.data.next })}
            {info.data.issued > 0 && ` ${t("A new format applies only to numbers issued from now on.")}`}
          </p>
        )}
        <div className="flex gap-2">
          <Button size="sm" className="gap-1" disabled={save.isPending} onClick={() => save.mutate(draft)}><Check className="h-4 w-4" /> {t("Save")}</Button>
          <Button size="sm" variant="ghost" className="gap-1" onClick={() => { setDraft({ label: s.label, format: s.format, resetPeriod: s.resetPeriod }); setEditing(false); }}><X className="h-4 w-4" /> {t("Cancel")}</Button>
        </div>
      </li>
    );
  }
  return (
    <li className={`flex flex-wrap items-center gap-3 px-3 py-2 text-sm ${s.active ? "" : "opacity-60"}`}>
      <div className="min-w-0 flex-1">
        {/* Nothing truncated (UI tour run 11, WM-3): the type wraps under the name on a phone, and the number
            pattern has a monospace line of its own. It wraps after a "/" only, never inside a token such as
            {SEQ:3} (UI tour run 13, W-M4: "{YY / YY}"). */}
        {/* Each "·" is held to the word before it by a no-break space, so a wrapped line never starts with the
            separator (UI tour run 14, R14-WM-21: "· Work agreement (SPK) · Yearly"). */}
        <div className="font-medium [overflow-wrap:anywhere]">{s.label}<span className="text-xs font-normal text-muted-foreground">{"\u00a0· "}{docTypeLabel(s.docType)}{"\u00a0· "}{s.resetPeriod === "MONTH" ? t("Monthly") : t("Yearly")}</span></div>
        <div className="mt-0.5 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">
          {s.format.split("/").map((part, i, all) => (
            <Fragment key={i}>{part}{i < all.length - 1 && <>/<wbr /></>}</Fragment>
          ))}
        </div>
      </div>
      {canEdit && (
        <>
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Switch checked={s.active} onCheckedChange={(v) => save.mutate({ active: v })} /> {t("In use")}
          </label>
          <Button size="sm" variant="ghost" aria-label={t("Edit")} onClick={() => setEditing(true)}><Pencil className="h-4 w-4" /></Button>
        </>
      )}
    </li>
  );
}

function NewSeriesRow({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [draft, setDraft] = useState({ docType: "SURAT", label: "", format: "{SEQ:3}/{CO}/{ROMAWI}/{YYYY}", resetPeriod: "YEAR" as "YEAR" | "MONTH" });
  const add = useMutation({
    mutationFn: () => legalSettingsApi.addSeries(companyId, draft),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["legal", "companies"] }); toast.success(t("Series added")); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });
  return (
    <li className="space-y-2 bg-muted/30 px-3 py-2.5">
      <div className="grid gap-2 sm:grid-cols-[10rem_1fr]">
        <Select value={draft.docType} onValueChange={(v) => setDraft({ ...draft, docType: v, resetPeriod: v === "INVOICE" ? "MONTH" : draft.resetPeriod })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>{LEGAL_DOC_TYPES.map((d) => <SelectItem key={d} value={d}>{docTypeLabel(d)}</SelectItem>)}</SelectContent>
        </Select>
        <Input placeholder={t("Name, e.g. SPK Talent")} value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} />
      </div>
      <div className="grid gap-2 sm:grid-cols-[1fr_8rem]">
        <Input className="font-mono text-xs" value={draft.format} onChange={(e) => setDraft({ ...draft, format: e.target.value })} aria-label={t("Format")} />
        <Select value={draft.resetPeriod} onValueChange={(v) => setDraft({ ...draft, resetPeriod: v as "YEAR" | "MONTH" })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="YEAR">{t("Yearly")}</SelectItem><SelectItem value="MONTH">{t("Monthly")}</SelectItem></SelectContent>
        </Select>
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!draft.label.trim() || add.isPending} onClick={() => add.mutate()}>{t("Add")}</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
      </div>
    </li>
  );
}

function TokenHelp() {
  const { t } = useLang();
  const rows: [string, string][] = [
    ["{SEQ:3}", t("Running number, 3 digits (001). Required.")],
    ["{ROMAWI}", t("Month in Roman numerals (X)")],
    ["{BLN} / {MM}", t("Month: OKT / 10")],
    ["{YYYY} / {YY}", t("Year: 2026 / 26. Required.")],
    ["{CO}", t("The company's code")],
    ["{KOTA}", t("Any form field by its name, e.g. the city")],
  ];
  return (
    <div className="rounded-lg border border-border p-3 text-sm">
      <div className="mb-1 font-medium">{t("Numbering format")}</div>
      <table className="w-full"><tbody>{rows.map(([k, v]) => <tr key={k}><td className="w-32 py-0.5 font-mono text-xs">{k}</td><td className="py-0.5 text-muted-foreground">{v}</td></tr>)}</tbody></table>
    </div>
  );
}
