import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ExternalLink, History, Link2, Plus, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { AvatarFace } from "@/components/Avatar";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CLOSING_STATUS_OPTIONS, CONTRACT_STATUS_OPTIONS, DELIVERABLE_RISK_OPTIONS, DELIVERABLE_STATUS_OPTIONS, LINK_TYPES,
  PAYMENT_STATUS_OPTIONS, PIPELINE_STAGES, PROBABILITY_OPTIONS, READINESS_OPTIONS, SERVICE_OPTIONS, VREG_STATUS_OPTIONS,
} from "@/lib/pipeline";
import { dealKey, pipelineApi, type PipelineChange, type PipelineDeal, type PipelineDealPatch } from "@/lib/pipeline-api";
import { DateField, MoneyField, NumberField, PersonField, SelectField, TextField, type PersonOption } from "./fields";
import {
  HealthPill, PHASE_LABEL, PHASE_STATE_LABEL, fmtDay, fmtIdrFull, fmtPct, phaseDotTone, useReasonText, useVocabLabels,
} from "./pipeline-ui";

/** English names of the fields, for the history ("Bagas changed Stage …"). Translated with t(). */
const FIELD_LABEL: Record<string, string> = {
  name: "Name", brand: "Brand / client", service: "Service", bdUserId: "BD / account owner", bdName: "BD / account owner",
  pmUserId: "PM", pmName: "PM", stage: "Stage", probability: "Probability", contractValue: "Contract value",
  netValue: "Net project value", invoiceValue: "Invoice value", contractStatus: "Contract status",
  vregStatus: "Vendor registration", readiness: "Execution readiness", deliverableStatus: "Deliverable status",
  deliverableRisk: "Deliverable risk", paymentStatus: "Payment status", outstandingReceivable: "Outstanding receivable",
  paymentDueDate: "Payment due date", maxDaysOverdue: "Days overdue (typed)", netCash: "Net cash position",
  closingStatus: "Closing status", mainDate: "Event / main date", nextAction: "Next action", nextActionDate: "Next action date",
  blocker: "Blocker / issue", notes: "Notes", links: "Documents & links",
};
const MONEY = new Set(["contractValue", "netValue", "invoiceValue", "outstandingReceivable", "netCash"]);
const DATES = new Set(["paymentDueDate", "mainDate", "nextActionDate"]);

/**
 * One deal, every field, grouped by the division that owns it — the GM's drawer: Commercial (BD),
 * Contract (Legal), Vendor registration, Readiness & deliverable (PM), Billing & payment (Finance),
 * Closing, Follow-up. Each field saves on its own when you leave it. History shows who changed what.
 * Right-hand sheet on a computer, full screen on a phone.
 */
export function DealDrawer({
  deal, projectId, people, canEdit, onPatch, onDelete, onClose,
}: {
  deal: PipelineDeal | null;
  projectId: string;
  people: PersonOption[];
  canEdit: boolean;
  onPatch: (id: string, patch: PipelineDealPatch) => void;
  onDelete: (deal: PipelineDeal) => void;
  onClose: () => void;
}) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<"details" | "history">("details");
  const [confirming, setConfirming] = useState(false);
  return (
    <Sheet open={!!deal} onOpenChange={(open) => { if (!open) { onClose(); setTab("details"); } }}>
      <SheetContent
        lang={lang}
        side="right"
        className="flex w-full flex-col gap-0 overflow-hidden p-0 sm:max-w-xl [&>button:first-of-type]:hidden"
      >
        {deal && (
          <>
            <header className="border-b border-border px-5 pb-3 pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium tabular-nums text-muted-foreground">{deal.code}</p>
                <div className="flex items-center gap-1.5">
                  {deal.health.key !== "NONE" && <HealthPill health={deal.health.key} />}
                  <button type="button" onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[44px]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <SheetTitle className="sr-only">{deal.name}</SheetTitle>
              <SheetDescription className="sr-only">{t("Every field saves when you leave it.")}</SheetDescription>
              <TextField
                label={t("Deal name")}
                value={deal.name}
                required
                maxLength={200}
                disabled={!canEdit}
                onCommit={(v) => onPatch(deal.id, { name: v })}
                className="-mx-2.5 mt-1 border-transparent bg-transparent text-lg font-semibold hover:border-border"
              />
              <div role="tablist" aria-label={t("Deal")} className="mt-2 flex gap-1">
                {(["details", "history"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]",
                      tab === k ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                    )}
                  >
                    {k === "history" && <History className="h-3.5 w-3.5" />}
                    {k === "details" ? t("Details") : t("History")}
                  </button>
                ))}
              </div>
            </header>
            <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
              {tab === "details"
                ? <Details deal={deal} people={people} canEdit={canEdit} onPatch={(p) => onPatch(deal.id, p)} />
                : <HistoryList projectId={projectId} deal={deal} people={people} />}
            </div>
            <footer className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <LastUpdated deal={deal} />
              {canEdit && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-destructive/10 focus-visible:outline-2 focus-visible:outline-ring dark:text-red-300 pointer-coarse:min-h-[44px]"
                >
                  <Trash2 className="h-4 w-4" /> {t("Delete")}
                </button>
              )}
            </footer>
            <AlertDialog open={confirming} onOpenChange={setConfirming}>
              <AlertDialogContent lang={lang}>
                <AlertDialogHeader>
                  <AlertDialogTitle>{t("Delete {name}?", { name: deal.name })}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {t("It leaves the pipeline for everyone. Control Room → Audit can bring it back with its history.")}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={() => { setConfirming(false); onDelete(deal); }}
                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {t("Delete deal")}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function LastUpdated({ deal }: { deal: PipelineDeal }) {
  const { t, locale } = useLang();
  const when = new Date(deal.updatedAt).toLocaleString(locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  return (
    <p className="min-w-0 truncate text-xs text-muted-foreground">
      {deal.updatedBy?.name ? t("Last updated by {name}, {when}", { name: deal.updatedBy.name, when }) : t("Last updated {when}", { when })}
    </p>
  );
}

function Section({ title, owner, children }: { title: string; owner: string; children: ReactNode }) {
  return (
    <section className="border-t border-border pt-4 first:border-t-0 first:pt-0">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        <span className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{owner}</span>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Field({ label, children, wide = false }: { label: string; children: ReactNode; wide?: boolean }) {
  // The control inside carries its own aria-label; this label is what a sighted reader scans for.
  return (
    <div className={cn("min-w-0 space-y-1", wide && "sm:col-span-2")}>
      <span className="block text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function Details({ deal, people, canEdit, onPatch }: { deal: PipelineDeal; people: PersonOption[]; canEdit: boolean; onPatch: (p: PipelineDealPatch) => void }) {
  const { t } = useLang();
  const labels = useVocabLabels();
  const reason = useReasonText();
  const off = !canEdit;
  const L = (en: string) => t(en);
  return (
    <div className="space-y-5">
      {deal.health.reasons.length > 0 && (
        <ul className={cn("space-y-1 rounded-xl px-3 py-2.5 text-sm", deal.health.key === "CRITICAL" ? "bg-destructive/10 text-red-800 dark:text-red-200" : "bg-warning/15 text-amber-900 dark:text-amber-200")}>
          {deal.health.reasons.map((r, i) => <li key={i}>{reason(r)}</li>)}
        </ul>
      )}

      <ol aria-label={t("Phase progress")} className="grid grid-cols-3 gap-x-2 gap-y-3 sm:grid-cols-6">
        {deal.phases.map((p) => (
          <li key={p.key} className="min-w-0">
            <span aria-hidden className={cn("block h-1.5 rounded-full", phaseDotTone(p.state))} />
            <span className="mt-1.5 block truncate text-xs font-medium">{t(PHASE_LABEL[p.key])}</span>
            <span className="block truncate text-2xs text-muted-foreground">{t(PHASE_STATE_LABEL[p.state])}</span>
          </li>
        ))}
      </ol>

      <Section title={t("Commercial & pipeline")} owner={t("BD / account")}>
        <Field label={L("Brand / client")}><TextField label={L("Brand / client")} value={deal.brand} maxLength={200} disabled={off} onCommit={(v) => onPatch({ brand: v })} /></Field>
        <Field label={L("Service")}><SelectField label={L("Service")} value={deal.service} options={SERVICE_OPTIONS} disabled={off} onCommit={(v) => onPatch({ service: v })} /></Field>
        <Field label={L("BD / account owner")}>
          <PersonField label={L("BD / account owner")} userId={deal.bdUserId} name={deal.bdName} people={people} disabled={off} onCommit={({ userId, name }) => onPatch({ bdUserId: userId, bdName: name })} />
        </Field>
        <Field label="PM">
          <PersonField label="PM" userId={deal.pmUserId} name={deal.pmName} people={people} disabled={off} onCommit={({ userId, name }) => onPatch({ pmUserId: userId, pmName: name })} />
        </Field>
        <Field label={L("Stage")}><SelectField label={L("Stage")} value={deal.stage} options={PIPELINE_STAGES} labelOf={labels.stage} disabled={off} onCommit={(v) => onPatch({ stage: v })} /></Field>
        <Field label={L("Probability")}><SelectField label={L("Probability")} value={deal.probability} options={PROBABILITY_OPTIONS as readonly number[]} labelOf={fmtPct} disabled={off} onCommit={(v) => onPatch({ probability: v })} /></Field>
        <Field label={L("Contract value")}><MoneyField label={L("Contract value")} value={deal.contractValue} disabled={off} onCommit={(v) => onPatch({ contractValue: v })} /></Field>
        <Field label={L("Net project value")}><MoneyField label={L("Net project value")} value={deal.netValue} disabled={off} onCommit={(v) => onPatch({ netValue: v })} /></Field>
        <Field label={L("Event / main date")}><DateField label={L("Event / main date")} value={deal.mainDate} disabled={off} onCommit={(v) => onPatch({ mainDate: v })} /></Field>
      </Section>

      <Section title={t("Contract")} owner="Legal">
        <Field label={L("Contract status")} wide><SelectField label={L("Contract status")} value={deal.contractStatus} options={CONTRACT_STATUS_OPTIONS} disabled={off} onCommit={(v) => onPatch({ contractStatus: v })} /></Field>
      </Section>

      <Section title={t("Vendor registration")} owner={t("PM / admin")}>
        <Field label={L("Vendor registration")} wide><SelectField label={L("Vendor registration")} value={deal.vregStatus} options={VREG_STATUS_OPTIONS} disabled={off} onCommit={(v) => onPatch({ vregStatus: v })} /></Field>
      </Section>

      <Section title={t("Readiness & deliverable")} owner="PM">
        <Field label={L("Execution readiness")} wide><SelectField label={L("Execution readiness")} value={deal.readiness} options={READINESS_OPTIONS} disabled={off} onCommit={(v) => onPatch({ readiness: v })} /></Field>
        <Field label={L("Deliverable status")}><SelectField label={L("Deliverable status")} value={deal.deliverableStatus} options={DELIVERABLE_STATUS_OPTIONS} disabled={off} onCommit={(v) => onPatch({ deliverableStatus: v })} /></Field>
        <Field label={L("Deliverable risk")}><SelectField label={L("Deliverable risk")} value={deal.deliverableRisk} options={DELIVERABLE_RISK_OPTIONS} labelOf={labels.risk} disabled={off} onCommit={(v) => onPatch({ deliverableRisk: v })} /></Field>
      </Section>

      <Section title={t("Billing & payment")} owner="Finance">
        <Field label={L("Invoice value")}><MoneyField label={L("Invoice value")} value={deal.invoiceValue} disabled={off} onCommit={(v) => onPatch({ invoiceValue: v })} /></Field>
        <Field label={L("Payment status")}><SelectField label={L("Payment status")} value={deal.paymentStatus} options={PAYMENT_STATUS_OPTIONS} disabled={off} onCommit={(v) => onPatch({ paymentStatus: v })} /></Field>
        <Field label={L("Outstanding receivable")}><MoneyField label={L("Outstanding receivable")} value={deal.outstandingReceivable} disabled={off} onCommit={(v) => onPatch({ outstandingReceivable: v })} /></Field>
        <Field label={L("Payment due date")}><DateField label={L("Payment due date")} value={deal.paymentDueDate} disabled={off} onCommit={(v) => onPatch({ paymentDueDate: v })} /></Field>
        {deal.paymentDueDate ? (
          <Field label={L("Days overdue")}>
            <p className="px-0.5 py-1.5 text-sm tabular-nums">{deal.daysOverdue > 0 ? t("{n} days, counted from the due date", { n: deal.daysOverdue }) : t("Not overdue")}</p>
          </Field>
        ) : (
          <Field label={L("Days overdue (typed)")}><NumberField label={L("Days overdue (typed)")} value={deal.maxDaysOverdue} disabled={off} onCommit={(v) => onPatch({ maxDaysOverdue: v })} /></Field>
        )}
        <Field label={L("Net cash position")}><MoneyField label={L("Net cash position")} allowNegative value={deal.netCash} disabled={off} onCommit={(v) => onPatch({ netCash: v })} /></Field>
      </Section>

      <Section title={t("Closing")} owner="PM">
        <Field label={L("Closing status")} wide><SelectField label={L("Closing status")} value={deal.closingStatus} options={CLOSING_STATUS_OPTIONS} disabled={off} onCommit={(v) => onPatch({ closingStatus: v })} /></Field>
      </Section>

      <Section title={t("Follow-up & notes")} owner={t("Every division")}>
        <Field label={L("Next action")}><TextField label={L("Next action")} value={deal.nextAction} disabled={off} onCommit={(v) => onPatch({ nextAction: v })} /></Field>
        <Field label={L("Next action date")}><DateField label={L("Next action date")} value={deal.nextActionDate} disabled={off} onCommit={(v) => onPatch({ nextActionDate: v })} /></Field>
        <Field label={L("Blocker / issue")} wide><TextField label={L("Blocker / issue")} value={deal.blocker} disabled={off} onCommit={(v) => onPatch({ blocker: v })} /></Field>
        <Field label={L("Notes")} wide><TextField multiline label={L("Notes")} value={deal.notes} maxLength={5000} disabled={off} onCommit={(v) => onPatch({ notes: v })} /></Field>
      </Section>

      <Section title={t("Documents & links")} owner={t("Every division")}>
        <div className="sm:col-span-2"><Links deal={deal} canEdit={canEdit} onPatch={onPatch} /></div>
      </Section>
    </div>
  );
}

function Links({ deal, canEdit, onPatch }: { deal: PipelineDeal; canEdit: boolean; onPatch: (p: PipelineDealPatch) => void }) {
  const { t } = useLang();
  const labels = useVocabLabels();
  const [type, setType] = useState<string>("SPK");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const add = () => {
    let u = url.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
    onPatch({ links: [...deal.links, { id: `lnk${Date.now().toString(36)}`, type, label: label.trim(), url: u }] });
    setUrl("");
    setLabel("");
  };
  return (
    <div className="space-y-2">
      {deal.links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("No SPK, contract, MOU or invoice linked yet.")}</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {deal.links.map((l) => (
            <li key={l.id} className="flex items-center gap-2 px-3 py-2">
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-2xs font-semibold">{labels.link(l.type)}</span>
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-w-0 flex-1 items-center gap-1 truncate text-sm font-medium text-primary underline-offset-2 hover:underline">
                <span className="truncate">{l.label || l.url}</span>
                <ExternalLink aria-hidden className="h-3 w-3 shrink-0" />
              </a>
              {canEdit && (
                <button type="button" aria-label={t("Remove link")} onClick={() => onPatch({ links: deal.links.filter((x) => x.id !== l.id) })} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[44px]">
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="grid gap-2 sm:grid-cols-[8.5rem_1fr]">
          <select aria-label={t("Link type")} value={type} onChange={(e) => setType(e.target.value)} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm pointer-coarse:min-h-[44px]">
            {LINK_TYPES.map((k) => <option key={k} value={k}>{labels.link(k)}</option>)}
          </select>
          <div className="relative">
            <Link2 aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input aria-label={t("Link")} value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("Paste a link (https://…)")} className="w-full rounded-lg border border-border bg-background py-1.5 pl-8 pr-2.5 text-sm pointer-coarse:min-h-[44px]" />
          </div>
          <input aria-label={t("Document name")} value={label} onChange={(e) => setLabel(e.target.value)} placeholder={t("Document name (optional)")} className="rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm sm:col-start-2 pointer-coarse:min-h-[44px]" />
          <button type="submit" disabled={!url.trim()} className="inline-flex items-center justify-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground transition-opacity disabled:opacity-40 sm:col-start-2 sm:justify-self-start pointer-coarse:min-h-[44px]">
            <Plus className="h-3.5 w-3.5" /> {t("Add link")}
          </button>
        </form>
      )}
    </div>
  );
}

function HistoryList({ projectId, deal, people }: { projectId: string; deal: PipelineDeal; people: PersonOption[] }) {
  const { t, lang, locale } = useLang();
  const labels = useVocabLabels();
  const q = useQuery({ queryKey: dealKey(projectId, deal.id), queryFn: () => pipelineApi.detail(projectId, deal.id), staleTime: 10_000 });
  const nameOf = (id: unknown) => (typeof id === "string" ? people.find((p) => p.id === id)?.name ?? t("someone") : null);
  const show = (field: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return t("empty");
    if (MONEY.has(field) && typeof v === "number") return fmtIdrFull(v, lang);
    if (DATES.has(field) && typeof v === "string") return fmtDay(v, locale);
    if (field === "probability" && typeof v === "number") return fmtPct(v);
    if (field === "bdUserId" || field === "pmUserId") return nameOf(v) ?? t("empty");
    if (field === "stage" && typeof v === "string") return labels.stage(v);
    if (field === "deliverableRisk" && typeof v === "string") return labels.risk(v);
    if (field === "links" && Array.isArray(v)) return t("{n} links", { n: v.length });
    return String(v);
  };
  if (q.isLoading) {
    return <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}</div>;
  }
  if (q.isError) return <p className="text-sm text-red-700 dark:text-red-300">{t("The history didn't load. Close the deal and open it again.")}</p>;
  const rows: PipelineChange[] = q.data?.history ?? [];
  return (
    <ol className="space-y-3">
      {rows.map((h) => (
        <li key={h.id} className="flex gap-3">
          <AvatarFace name={h.user?.name ?? "?"} avatar={h.user?.avatar ?? null} size={26} decorative className="mt-0.5 ring-0" />
          <div className="min-w-0 flex-1 text-sm">
            <p>
              <span className="font-semibold">{h.user?.name ?? t("Someone")}</span>{" "}
              <span className="text-muted-foreground">{t("changed")}</span>{" "}
              <span className="font-medium">{t(FIELD_LABEL[h.field] ?? h.field)}</span>
            </p>
            {h.field === "notes" ? (
              <p className="mt-0.5 line-clamp-3 text-muted-foreground">{show(h.field, h.after)}</p>
            ) : (
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                <span className="line-through decoration-muted-foreground/50">{show(h.field, h.before)}</span>
                <ArrowRight aria-label={t("to")} className="h-3 w-3" />
                <span className="text-foreground">{show(h.field, h.after)}</span>
              </p>
            )}
            <time dateTime={h.createdAt} className="text-xs text-muted-foreground">
              {new Date(h.createdAt).toLocaleString(locale, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </time>
          </div>
        </li>
      ))}
      <li className="flex gap-3 text-sm text-muted-foreground">
        <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-border" style={{ marginLeft: 9, marginRight: 7 }} />
        <span>
          {deal.createdBy?.name
            ? t("Created by {name}, {when}", { name: deal.createdBy.name, when: new Date(deal.createdAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) })
            : t("Created {when}", { when: new Date(deal.createdAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" }) })}
        </span>
      </li>
    </ol>
  );
}
