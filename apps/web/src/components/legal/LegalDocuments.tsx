import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { FilePlus2, FileText, Loader2, Search, Upload, X } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NewDocumentDialog } from "@/components/legal/NewDocumentDialog";
import { LegalDocumentSheet } from "@/components/legal/LegalDocumentSheet";
import { UploadDocumentDialog } from "@/components/legal/UploadDocumentDialog";
import { LegalLinkPicker, type LegalLink } from "@/components/legal/LegalLinkPicker";
import { docTypeLabel, fmtDay, statusClass, statusLabel } from "@/components/legal/legal-labels";
import { LEGAL_DOC_TYPES, LEGAL_STATUSES, legalDocsApi, legalTemplatesApi, type ArchiveQuery } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";
import { cn } from "@/lib/utils";

const ALL = "__all";
const PAGE = 50;

/**
 * The archive (owner, 14 Oct 2026): every legal document — made here or uploaded (a signed contract, an
 * outside invoice) — searchable by number, title and counterparty, and filtered by company, type, status,
 * date and where it came from.
 */
export function LegalDocuments({ openId, onOpen }: { openId: string | null; onOpen: (id: string | null) => void }) {
  const { t, lang } = useLang();
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

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-52 flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Search number, title, counterparty…")} className="pl-8" />
        </div>
        <Button variant="outline" onClick={() => setUploadOpen(true)} className="gap-1.5"><Upload className="h-4 w-4" /> {t("Upload document")}</Button>
        <Button onClick={() => setNewOpen(true)} className="gap-1.5"><FilePlus2 className="h-4 w-4" /> {t("New document")}</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect value={filters.companyId} onChange={(v) => set({ companyId: v })} all={t("All companies")}
          options={(companies.data?.companies ?? []).map((c) => [c.id, c.name])} />
        <FilterSelect value={filters.docType} onChange={(v) => set({ docType: v })} all={t("All types")}
          options={LEGAL_DOC_TYPES.map((d) => [d, docTypeLabel(d)])} />
        <FilterSelect value={filters.status} onChange={(v) => set({ status: v })} all={t("All statuses")}
          options={LEGAL_STATUSES.map((s) => [s, statusLabel(s)])} />
        <FilterSelect value={filters.source} onChange={(v) => set({ source: v })} all={t("Made or uploaded")}
          options={[["GENERATED", t("Made here")], ["UPLOADED", t("Uploaded")]]} />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t("From")} <Input type="date" className="h-9 w-[9.5rem]" value={filters.from ?? ""} onChange={(e) => set({ from: e.target.value || undefined })} />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {t("To")} <Input type="date" className="h-9 w-[9.5rem]" value={filters.to ?? ""} onChange={(e) => set({ to: e.target.value || undefined })} />
        </label>
        <LegalLinkPicker value={link} placeholder={t("Any project or deal")}
          onChange={(v) => { setLink(v); set({ projectId: v?.kind === "project" ? v.id : undefined, dealId: v?.kind === "deal" ? v.id : undefined }); }} />
        {filtered && (
          <Button variant="ghost" size="sm" className="gap-1" onClick={() => { setFilters((f) => ({ q: f.q })); setLink(null); setPage(1); }}>
            <X className="h-3.5 w-3.5" /> {t("Clear filters")}
          </Button>
        )}
      </div>

      {docs.isLoading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> {t("Loading…")}</div>
      ) : docs.isError ? (
        <p className="py-6 text-sm text-destructive">{(docs.error as Error).message}</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title={filters.q || filtered ? t("Nothing matches") : t("No documents yet")}
          message={filters.q || filtered ? t("Try other words or fewer filters.") : t("Make one from a template, or upload a signed document.")} />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">{t("Number")}</th>
                  <th className="px-3 py-2 font-medium">{t("Title")}</th>
                  <th className="px-3 py-2 font-medium">{t("Counterparty")}</th>
                  <th className="px-3 py-2 font-medium">{t("Company")}</th>
                  <th className="px-3 py-2 font-medium">{t("Date")}</th>
                  <th className="px-3 py-2 font-medium">{t("Status")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((d) => (
                  <tr key={d.id} className="cursor-pointer hover:bg-accent/40" onClick={() => onOpen(d.id)}>
                    <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{d.number || "—"}</td>
                    <td className="px-3 py-2">
                      <div className="line-clamp-1 font-medium">{d.title}</div>
                      <div className="text-xs text-muted-foreground">{docTypeLabel(d.docType)}{d.source === "UPLOADED" ? ` · ${t("Uploaded")}` : ""}{d.deal ? ` · ${d.deal.code}` : d.project ? ` · ${d.project.name}` : ""}</div>
                    </td>
                    <td className="px-3 py-2"><span className="line-clamp-1">{d.counterparty || "—"}</span></td>
                    <td className="whitespace-nowrap px-3 py-2">{d.company.name}</td>
                    <td className="whitespace-nowrap px-3 py-2">{fmtDay(d.docDate, lang)}</td>
                    <td className="px-3 py-2"><span className={cn("rounded-full px-2 py-0.5 text-xs font-medium", statusClass(d.status))}>{statusLabel(d.status)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
      <LegalDocumentSheet documentId={openId} onClose={() => onOpen(null)} />
    </section>
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
