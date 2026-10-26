import { useState } from "react";
import { ProjectMarkFor, ProjectPageIcon } from "@/components/projects/ProjectIcon";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, CalendarDays, ChevronDown, CircleCheck, Folder, FolderKanban, History, ListChecks, Loader2, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { AvatarFace } from "@/components/Avatar";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  CLOSING_STATUS_OPTIONS, CONTRACT_STATUS_OPTIONS, DELIVERABLE_RISK_OPTIONS, DELIVERABLE_STATUS_OPTIONS,
  PAYMENT_STATUS_OPTIONS, PIPELINE_STAGES, PROBABILITY_OPTIONS, READINESS_OPTIONS, VREG_STATUS_OPTIONS,
  marginOf, pipelineToday, summarize, type PipelineCostItem,
} from "@/lib/pipeline";
import {
  dealKey, pipelineApi, pipelineKey, servicesOf, type PipelineChange, type PipelineDeal, type PipelineDealPatch, type PipelineResponse,
  type PipelineTerm, type PipelineTermPatch,
} from "@/lib/pipeline-api";
import { DealDocuments } from "./DealDocuments";
import { BudgetSection, CashbackSection, ContactsSection, useDealItems } from "./DealLists";
import { Field, Section } from "./drawer-parts";
import { useMoneyFmt } from "./presentation";
import { usePipelineV8 } from "@/lib/meetings";
import { ServicesField } from "./ServicesField";
import { DateField, MoneyField, NumberField, PersonField, SelectField, TextField, type PersonOption } from "./fields";
import {
  BlockerBanner, HealthPill, PhaseStepper, StagePill, TERM_TONE, fmtDay, fmtMarginPct, fmtPct, marginTone, useReasonText, useVocabLabels,
} from "./pipeline-ui";

/** English names of the fields, for the history ("Budi changed Stage …"). Translated with t(). */
const FIELD_LABEL: Record<string, string> = {
  name: "Name", brand: "Brand / client", service: "Service", services: "Services", bdUserId: "BD / account owner", bdName: "BD / account owner",
  pmUserId: "PM", pmName: "PM", stage: "Stage", probability: "Probability", contractValue: "Contract value",
  netValue: "Net project value", invoiceValue: "Invoice value", contractStatus: "Contract status",
  vregStatus: "Vendor registration", readiness: "Execution readiness", deliverableStatus: "Deliverable status",
  deliverableRisk: "Deliverable risk", paymentStatus: "Payment status", outstandingReceivable: "Outstanding receivable",
  paymentDueDate: "Payment due date", maxDaysOverdue: "Days overdue (typed)", netCash: "Net cash position",
  closingStatus: "Closing status", mainDate: "Event / main date", nextAction: "Next action", nextActionDate: "Next action date",
  blocker: "Blocker / issue", notes: "Notes", links: "Documents & links", costs: "Real cost",
  barterValue: "Barter value", barterCompensation: "Barter compensation form",
};
/** Cashback / contact / budget rows (v8): "<kind>.<field>" and "<kind>.created|deleted|restored". */
const ITEM_KIND_LABEL: Record<string, string> = { cashback: "Cashback", contact: "Project contact", budget: "Budget category" };
const ITEM_FIELD_LABEL: Record<string, string> = { name: "Name", amount: "Amount", role: "Role", phone: "Phone" };
const ITEM_EVENT: Record<string, string> = { created: "added", deleted: "deleted", restored: "restored" };
/** A payment term's fields, for history rows "term.<field>" (owner, 9 Oct 2026). */
const TERM_FIELD_LABEL: Record<string, string> = {
  label: "Term name", amount: "Amount", dueDate: "Due date", invoiceNo: "Invoice no.", invoiceDate: "Invoice date",
  paidAmount: "Amount paid", paidAt: "Paid on", note: "Term note",
};
const MONEY = new Set(["contractValue", "netValue", "invoiceValue", "outstandingReceivable", "netCash", "term.amount", "term.paidAmount", "barterValue", "cashback.amount", "budget.amount"]);
const STATUS_FIELDS = new Set(["contractStatus", "vregStatus", "readiness", "deliverableStatus", "paymentStatus", "closingStatus"]);
const DATES = new Set(["paymentDueDate", "mainDate", "nextActionDate", "term.dueDate", "term.invoiceDate", "term.paidAt"]);

/**
 * One deal, every field, grouped by the division that owns it — the GM's drawer: Commercial (BD),
 * Contract (Legal), Vendor registration, Readiness & deliverable (PM), Billing & payment (Finance),
 * Closing, Follow-up. Each field saves on its own when you leave it. History shows who changed what.
 * Right-hand sheet on a computer, full screen on a phone.
 */
export function DealDrawer({
  deal, projectId, people, canEdit, onPatch, onDelete, onClose, boardName, fromAll = false,
}: {
  deal: PipelineDeal | null;
  projectId: string;
  people: PersonOption[];
  canEdit: boolean;
  onPatch: (id: string, patch: PipelineDealPatch) => void;
  onDelete: (deal: PipelineDeal) => void;
  onClose: () => void;
  /** The board's (company's) name; shown on the deal when it was opened from All Pipelines (v8). */
  boardName?: string;
  fromAll?: boolean;
}) {
  const { t, lang } = useLang();
  const [tab, setTab] = useState<"details" | "history">("details");
  const allPipelinesOn = usePipelineV8();
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
                {/* The deals stage up top, with its columns colour (owner, 9 Oct 2026: "stage di board per
                    dealnya jg blm ada"); change it in the Stage field below or by dragging the card. */}
                <div className="flex min-w-0 items-center gap-2">
                  <p className="shrink-0 text-xs tabular-nums text-muted-foreground">{deal.code}</p>
                  <span className="sr-only">{t("Stage")}: </span>
                  <StagePill stage={deal.stage} className="text-xs leading-5" />
                </div>
                <div className="flex items-center gap-1.5">
                  {deal.health.key !== "NONE" && <HealthPill health={deal.health.key} />}
                  <button type="button" onClick={onClose} aria-label={t("Close")} className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[44px]">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {/* Opened from All Pipelines (owner, 21 Oct 2026): which company's board this deal is on, and the way back. */}
              {fromAll && boardName && allPipelinesOn && (
                <div className="mt-2 flex flex-wrap items-center gap-2" data-pl="deal-company">
                  <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    <Building2 aria-hidden className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">{boardName}</span>
                  </span>
                  <Link to="/pipelines" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]">
                    <ArrowLeft aria-hidden className="h-3.5 w-3.5" /> {t("All Pipelines")}
                  </Link>
                </div>
              )}
              <SheetTitle className="sr-only">{deal.name}</SheetTitle>
              <SheetDescription className="sr-only">{t("Every field saves when you leave it.")}</SheetDescription>
              <TextField
                label={t("Deal name")}
                value={deal.name}
                required
                maxLength={200}
                autoGrow
                disabled={!canEdit}
                onCommit={(v) => onPatch(deal.id, { name: v })}
                className="-mx-2.5 mt-1.5 min-h-0 w-[calc(100%+1.25rem)] border-transparent bg-transparent py-1 text-xl font-semibold leading-snug hover:border-border pointer-coarse:min-h-0"
              />
              <ExecutionProject deal={deal} projectId={projectId} canEdit={canEdit} />
              <div role="tablist" aria-label={t("Deal")} className="mt-3 inline-flex gap-0.5 rounded-lg bg-muted p-0.5">
                {(["details", "history"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="tab"
                    aria-selected={tab === k}
                    onClick={() => setTab(k)}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[40px]",
                      tab === k ? "bg-card text-foreground shadow-[0_1px_2px_rgba(15,15,15,0.08)]" : "text-muted-foreground hover:text-foreground",
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
                ? <Details deal={deal} projectId={projectId} people={people} canEdit={canEdit} onPatch={(p) => onPatch(deal.id, p)} />
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

/**
 * Won → execution, by hand (owner, 10 Oct 2026: "jangan dibuat otomatis tpi siapin aja tombol untuk
 * 'Create execution project' … 1 folder di project yg isinya Master Calendar sama Master Task"). Nothing
 * is made when a deal reaches Won; on a won deal this button makes a folder named after the deal (inside
 * its client's folder) with "<deal>: Master Calendar" and "<deal>: Master Task", and the deal's event
 * date goes on that Master Calendar. Once made it opens the folder; a deal from 9 Oct that only has one
 * project opens that project.
 */
function ExecutionProject({ deal, projectId, canEdit }: { deal: PipelineDeal; projectId: string; canEdit: boolean }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const create = useMutation({
    mutationFn: () => pipelineApi.createExecution(projectId, deal.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: pipelineKey(projectId) });
      // The new folder and its two projects show in the sidebar and on Projects right away.
      qc.invalidateQueries({ queryKey: ["nexus", "project-folders"] });
      qc.invalidateQueries({ queryKey: ["nexus", "projects"] });
    },
    onError: (e: unknown) => toast.error(t("Couldn't create the execution project"), { description: e instanceof Error ? e.message : undefined }),
  });
  const won = deal.stageGroup === "Pre-Execution" || deal.stageGroup === "Execution" || deal.stageGroup === "Closed";
  const folder = deal.executionFolder ?? null;
  const calendar = deal.executionCalendarProject ?? null;
  const tasks = deal.executionProject ?? null;
  if (!folder && !tasks && !calendar && !(won && canEdit)) return null;
  const primary =
    "inline-flex min-w-0 items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]";
  const secondary =
    "inline-flex min-w-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]";
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1.5">
      {folder ? (
        <>
          <Link to="/calendar" search={{ folder: folder.id }} className={primary}>
            <Folder className="h-4 w-4 shrink-0" />
            <span className="truncate">{t("Open execution folder")}</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </Link>
          {calendar && (
            <Link to="/projects/$projectId" params={{ projectId: calendar.id }} className={secondary}>
              <CalendarDays className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("Master Calendar")}</span>
            </Link>
          )}
          {tasks && (
            <Link to="/projects/$projectId" params={{ projectId: tasks.id }} className={secondary}>
              <ListChecks className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{t("Master Task")}</span>
            </Link>
          )}
        </>
      ) : tasks || calendar ? (
        <Link to="/projects/$projectId" params={{ projectId: (tasks ?? calendar)!.id }} className={primary}>
          <ProjectMarkFor projectId={(tasks ?? calendar)!.id} icon={((tasks ?? calendar)! as { icon?: string | null }).icon} size={16} />
          <span className="truncate">{t("Open execution project")}</span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        </Link>
      ) : (
        <>
          <button
            type="button"
            onClick={() => create.mutate()}
            disabled={create.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 pointer-coarse:min-h-[44px]"
          >
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {t("Create execution project")}
          </button>
          <p className="text-xs text-muted-foreground">{t("Makes a folder for this deal with its Master Calendar and Master Task. The event date goes on the Master Calendar.")}</p>
        </>
      )}
    </div>
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

function Details({ deal, projectId, people, canEdit, onPatch }: { deal: PipelineDeal; projectId: string; people: PersonOption[]; canEdit: boolean; onPatch: (p: PipelineDealPatch) => void }) {
  const { t, lang, locale } = useLang();
  const { fmtIdrFull, hidden } = useMoneyFmt();
  const labels = useVocabLabels();
  const reason = useReasonText();
  const off = !canEdit;
  const L = (en: string) => t(en);
  const early = deal.stageGroup === "Pipeline" || deal.stageGroup === "Lost";
  // The blocker has its own banner (and sits under its phase in the stepper), so the list skips it.
  const reasons = deal.health.reasons.filter((r) => r.code !== "BLOCKER" || !deal.blocker?.trim());
  // Cashback, contacts and budget (Control Tower v8): one row each on the server.
  const items = useDealItems(projectId, deal);
  // Pipeline v8 sections and fields wait for the web's 0.1.7 launch switch (lib/web-launch.ts).
  const v8 = usePipelineV8();
  // Contract → closing: the same sections whether folded (open / lost deal) or not.
  const later = (
    <>
        <Section title={t("Contract")} owner="Legal">
          <Field label={L("Contract status")} wide><SelectField label={L("Contract status")} value={deal.contractStatus} options={CONTRACT_STATUS_OPTIONS} labelOf={labels.status} disabled={off} onCommit={(v) => onPatch({ contractStatus: v })} /></Field>
        </Section>

        {/* Project contacts (v8): below Contract. */}
        {v8 && <ContactsSection deal={deal} canEdit={canEdit} items={items} />}

        <Section title={t("Vendor registration")} owner={t("PM / admin")}>
          <Field label={L("Vendor registration")} wide><SelectField label={L("Vendor registration")} value={deal.vregStatus} options={VREG_STATUS_OPTIONS} labelOf={labels.status} disabled={off} onCommit={(v) => onPatch({ vregStatus: v })} /></Field>
        </Section>

        <Section title={t("Readiness & deliverable")} owner="PM">
          <Field label={L("Execution readiness")} wide><SelectField label={L("Execution readiness")} value={deal.readiness} options={READINESS_OPTIONS} labelOf={labels.status} disabled={off} onCommit={(v) => onPatch({ readiness: v })} /></Field>
          <Field label={L("Deliverable status")}><SelectField label={L("Deliverable status")} value={deal.deliverableStatus} options={DELIVERABLE_STATUS_OPTIONS} labelOf={labels.status} disabled={off} onCommit={(v) => onPatch({ deliverableStatus: v })} /></Field>
          <Field label={L("Deliverable risk")}><SelectField label={L("Deliverable risk")} value={deal.deliverableRisk} options={DELIVERABLE_RISK_OPTIONS} labelOf={labels.risk} disabled={off} onCommit={(v) => onPatch({ deliverableRisk: v })} /></Field>
        </Section>

        <Section title={t("Billing & payment")} owner="Finance">
          <Field label={L("Invoice value")}><MoneyField label={L("Invoice value")} value={deal.invoiceValue} disabled={off} onCommit={(v) => onPatch({ invoiceValue: v })} /></Field>
          {/* Paid per term (owner, 9 Oct 2026): status, receivable, due date and days overdue come from the
              terms below; the manual fields stay for deals without terms (the GM's imported rows). */}
          {deal.termSummary ? (
            <>
              <Field label={L("Payment status")}><p className="px-0.5 py-1.5 text-sm">{labels.status(deal.termSummary.paymentStatus)}</p></Field>
              <Field label={L("Outstanding receivable")}><p className="px-0.5 py-1.5 text-sm tabular-nums">{fmtIdrFull(deal.termSummary.outstanding, lang)}</p></Field>
              <Field label={L("Next payment due")}><p className="px-0.5 py-1.5 text-sm tabular-nums">{fmtDay(deal.termSummary.nextDueDate, locale)}</p></Field>
              <Field label={L("Days overdue")}>
                <p className="px-0.5 py-1.5 text-sm tabular-nums">{deal.daysOverdue > 0 ? t("{n} days, oldest unpaid term", { n: deal.daysOverdue }) : t("Not overdue")}</p>
              </Field>
              <p className="text-xs text-muted-foreground sm:col-span-2">{t("From the payment terms below.")}</p>
            </>
          ) : (
            <>
          <Field label={L("Payment status")}><SelectField label={L("Payment status")} value={deal.paymentStatus} options={PAYMENT_STATUS_OPTIONS} labelOf={labels.status} disabled={off} onCommit={(v) => onPatch({ paymentStatus: v })} /></Field>
          <Field label={L("Outstanding receivable")}><MoneyField label={L("Outstanding receivable")} value={deal.outstandingReceivable} disabled={off} onCommit={(v) => onPatch({ outstandingReceivable: v })} /></Field>
          <Field label={L("Payment due date")}><DateField label={L("Payment due date")} value={deal.paymentDueDate} disabled={off} onCommit={(v) => onPatch({ paymentDueDate: v })} /></Field>
          {deal.paymentDueDate ? (
            <Field label={L("Days overdue")}>
              <p className="px-0.5 py-1.5 text-sm tabular-nums">{deal.daysOverdue > 0 ? t("{n} days, counted from the due date", { n: deal.daysOverdue }) : t("Not overdue")}</p>
            </Field>
          ) : (
            <Field label={L("Days overdue (typed)")}><NumberField label={L("Days overdue (typed)")} value={deal.maxDaysOverdue} disabled={off} onCommit={(v) => onPatch({ maxDaysOverdue: v })} /></Field>
          )}
            </>
          )}
          <Field label={L("Net cash position")}><MoneyField label={L("Net cash position")} allowNegative value={deal.netCash} disabled={off} onCommit={(v) => onPatch({ netCash: v })} /></Field>
          <div className="sm:col-span-2"><PaymentTerms deal={deal} projectId={projectId} canEdit={canEdit} /></div>
        </Section>

        {/* Budget expenses (v8, Strategist): right before Real cost; both hidden while presenting. */}
        {v8 && <BudgetSection deal={deal} canEdit={canEdit} items={items} />}
        {!hidden && <RealCost deal={deal} canEdit={canEdit} onPatch={onPatch} />}

        <Section title={t("Closing")} owner="PM">
          <Field label={L("Closing status")} wide><SelectField label={L("Closing status")} value={deal.closingStatus} options={CLOSING_STATUS_OPTIONS} labelOf={labels.status} disabled={off} onCommit={(v) => onPatch({ closingStatus: v })} /></Field>
        </Section>

    </>
  );
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <BlockerBanner deal={deal} className="px-3 py-2.5 text-sm" />
        {reasons.length > 0 && (
          <ul className={cn("space-y-1 rounded-lg px-3 py-2.5 text-sm", deal.health.key === "CRITICAL" ? "bg-[var(--st-red-bg)] text-[var(--st-red-fg)]" : "bg-[var(--st-yellow-bg)] text-[var(--st-yellow-fg)]")}>
            {reasons.map((r, i) => <li key={i}>{reason(r)}</li>)}
          </ul>
        )}
        {/* On every deal, open ones too: grey steps say what has not started (owner, 9 Oct 2026). */}
        <PhaseStepper deal={deal} />
      </div>

      <Section title={t("Commercial & pipeline")} owner={t("BD / account")}>
        <Field label={L("Brand / client")}><TextField label={L("Brand / client")} value={deal.brand} maxLength={200} disabled={off} onCommit={(v) => onPatch({ brand: v })} /></Field>
        <Field label={L("Services")} wide><ServicesField value={servicesOf(deal)} projectId={projectId} disabled={off} onCommit={(v) => onPatch({ services: v })} /></Field>
        <Field label={L("BD / account owner")}>
          <PersonField label={L("BD / account owner")} userId={deal.bdUserId} userName={deal.bd?.name} name={deal.bdName} people={people} disabled={off} onCommit={({ userId, name }) => onPatch({ bdUserId: userId, bdName: name })} />
        </Field>
        <Field label="PM">
          <PersonField label="PM" userId={deal.pmUserId} userName={deal.pm?.name} name={deal.pmName} people={people} disabled={off} onCommit={({ userId, name }) => onPatch({ pmUserId: userId, pmName: name })} />
        </Field>
        <Field label={L("Stage")}><SelectField label={L("Stage")} value={deal.stage} options={PIPELINE_STAGES} labelOf={labels.stage} disabled={off} onCommit={(v) => onPatch({ stage: v })} /></Field>
        <Field label={L("Probability")}><SelectField label={L("Probability")} value={deal.probability} options={PROBABILITY_OPTIONS as readonly number[]} labelOf={fmtPct} disabled={off} onCommit={(v) => onPatch({ probability: v })} /></Field>
        <Field label={L("Contract value")}><MoneyField label={L("Contract value")} value={deal.contractValue} disabled={off} onCommit={(v) => onPatch({ contractValue: v })} /></Field>
        <Field label={L("Net project value")}><MoneyField label={L("Net project value")} value={deal.netValue} disabled={off} onCommit={(v) => onPatch({ netValue: v })} /></Field>
        <Field label={L("Event / main date")}><DateField label={L("Event / main date")} value={deal.mainDate} disabled={off} onCommit={(v) => onPatch({ mainDate: v })} /></Field>
        {/* Barter (v8): what the client pays in kind. The value is money (masked while presenting). */}
        {v8 && <Field label={L("Barter value")}><MoneyField label={L("Barter value")} value={deal.barterValue ?? 0} disabled={off} onCommit={(v) => onPatch({ barterValue: v })} /></Field>}
        {v8 && <Field label={L("Barter compensation form")} wide><TextField label={L("Barter compensation form")} placeholder={t("e.g. 2 TV ad slots")} value={deal.barterCompensation ?? ""} maxLength={500} disabled={off} onCommit={(v) => onPatch({ barterCompensation: v })} /></Field>}
      </Section>

      {/* Cashback (v8): right after Net value's section; not rendered at all while presenting. */}
      {v8 && <CashbackSection deal={deal} canEdit={canEdit} items={items} />}

      {/* Contract → closing only start once a deal is won. On an open (or lost) deal they fold away under
          one line instead of five sections of "Not Started" (owner, 9 Oct 2026); one click opens them. */}
      {/* Contract → closing only start once a deal is won. On an open (or lost) deal they fold away under
          one line instead of five sections of "Not Started" (owner, 9 Oct 2026); one click opens them. */}
      {early ? (
        <details className="group/later rounded-lg border border-border">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t("Contract, delivery & payment")}</span>
              <span className="block text-xs text-muted-foreground">{t("Legal, PM and Finance fill these in once the deal is won.")}</span>
            </span>
            <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open/later:rotate-180" />
          </summary>
          <div className="space-y-5 border-t border-border px-3 py-4">{later}</div>
        </details>
      ) : later}

      <Section title={t("Follow-up & notes")} owner={t("Every division")}>
        <Field label={L("Next action")}><TextField label={L("Next action")} value={deal.nextAction} disabled={off} onCommit={(v) => onPatch({ nextAction: v })} /></Field>
        <Field label={L("Next action date")}><DateField label={L("Next action date")} value={deal.nextActionDate} disabled={off} onCommit={(v) => onPatch({ nextActionDate: v })} /></Field>
        <Field label={L("Blocker / issue")} wide><TextField label={L("Blocker / issue")} value={deal.blocker} disabled={off} onCommit={(v) => onPatch({ blocker: v })} /></Field>
        <Field label={L("Notes")} wide><TextField multiline label={L("Notes")} value={deal.notes} maxLength={5000} disabled={off} onCommit={(v) => onPatch({ notes: v })} /></Field>
      </Section>

      <Section title={t("Documents & links")} owner={t("Every division")}>
        <div className="sm:col-span-2"><DealDocuments deal={deal} projectId={projectId} canEdit={canEdit} onPatch={onPatch} /></div>
      </Section>
    </div>
  );
}

function HistoryList({ projectId, deal, people }: { projectId: string; deal: PipelineDeal; people: PersonOption[] }) {
  const { t, lang, locale } = useLang();
  const { fmtIdrFull } = useMoneyFmt();
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
    if (STATUS_FIELDS.has(field) && typeof v === "string") return labels.status(v);
    if (field === "links" && Array.isArray(v)) return t("{n} links", { n: v.length });
    if (field === "services" && Array.isArray(v)) return v.length ? v.join(", ") : t("empty");
    if (field === "costs" && Array.isArray(v)) {
      if (!v.length) return t("empty");
      const total = v.reduce((sum: number, c) => sum + (typeof c?.amount === "number" ? c.amount : 0), 0);
      return t("{n} cost lines · {amount}", { n: v.length, amount: fmtIdrFull(total, lang) });
    }
    return String(v);
  };
  if (q.isLoading) {
    return <div className="space-y-3" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-muted" />)}</div>;
  }
  if (q.isError) return <p className="text-sm text-red-700 dark:text-red-300">{t("The history didn't load. Close the deal and open it again.")}</p>;
  const rows: PipelineChange[] = q.data?.history ?? [];
  // A payment term's own events (owner, 9 Oct 2026): added / deleted / restored, with its amount.
  const termEvent: Record<string, string> = { "term.created": "added payment term", "term.deleted": "deleted payment term", "term.restored": "restored payment term" };
  // A document added or removed (owner, 9 Oct 2026): its type and name, the file's name when it has no other.
  const docEvent: Record<string, string> = { "document.added": "added a document", "document.removed": "removed a document" };
  const docName = (h: PipelineChange) => {
    const v = (h.field === "document.removed" ? h.before : h.after) as { type?: unknown; label?: unknown; fileName?: unknown; url?: unknown } | null;
    if (!v) return "";
    const name = [v.label, v.fileName, v.url].find((x) => typeof x === "string" && x) as string | undefined;
    return `${typeof v.type === "string" ? labels.link(v.type) : ""}${name ? ` · ${name}` : ""}`;
  };
  // A cashback / contact / budget row (v8): "<kind>.<field|event>", the row's name in termLabel.
  const itemParts = (field: string): [string, string] | null => {
    const [kind, rest] = field.split(".");
    return ITEM_KIND_LABEL[kind] && rest ? [kind, rest] : null;
  };
  const termAmount = (h: PipelineChange) => {
    const v = (h.field === "term.deleted" ? h.before : h.after) as { amount?: unknown } | null;
    return typeof v?.amount === "number" ? fmtIdrFull(v.amount, lang) : null;
  };
  return (
    <ol className="space-y-3">
      {rows.map((h) => (
        <li key={h.id} className="flex gap-3">
          <AvatarFace name={h.user?.name ?? "?"} avatar={h.user?.avatar ?? null} size={26} decorative className="mt-0.5 ring-0" />
          <div className="min-w-0 flex-1 text-sm">
            {itemParts(h.field) ? (() => {
              const [kind, rest] = itemParts(h.field)!;
              const event = ITEM_EVENT[rest];
              const v = (rest === "deleted" ? h.before : h.after) as { amount?: unknown } | null;
              return (
                <>
                  <p>
                    <span className="font-semibold">{h.user?.name ?? t("Someone")}</span>{" "}
                    <span className="text-muted-foreground">{t(event ?? "changed")}</span>{" "}
                    <span className="font-medium">{t(ITEM_KIND_LABEL[kind])}{h.termLabel ? ` · ${h.termLabel}` : ""}{event ? "" : ` · ${t(ITEM_FIELD_LABEL[rest] ?? rest)}`}</span>
                  </p>
                  {event ? (
                    kind !== "contact" && typeof v?.amount === "number" && <p className="mt-0.5 tabular-nums text-muted-foreground">{fmtIdrFull(v.amount, lang)}</p>
                  ) : (
                    <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                      <span className="line-through decoration-muted-foreground/50">{rest === "role" && typeof h.before === "string" ? labels.contactRole(h.before) : show(h.field, h.before)}</span>
                      <ArrowRight aria-label={t("to")} className="h-3 w-3" />
                      <span className="text-foreground">{rest === "role" && typeof h.after === "string" ? labels.contactRole(h.after) : show(h.field, h.after)}</span>
                    </p>
                  )}
                </>
              );
            })() : (<>
            <p>
              <span className="font-semibold">{h.user?.name ?? t("Someone")}</span>{" "}
              <span className="text-muted-foreground">{t(termEvent[h.field] ?? docEvent[h.field] ?? "changed")}</span>{" "}
              <span className="font-medium">
                {docEvent[h.field]
                  ? docName(h)
                  : termEvent[h.field]
                  ? h.termLabel ?? ""
                  : h.field.startsWith("term.")
                    ? `${h.termLabel ?? t("Payment term")} · ${t(TERM_FIELD_LABEL[h.field.slice(5)] ?? h.field.slice(5))}`
                    : t(FIELD_LABEL[h.field] ?? h.field)}
              </span>
            </p>
            {docEvent[h.field] ? null : termEvent[h.field] ? (
              termAmount(h) && <p className="mt-0.5 tabular-nums text-muted-foreground">{termAmount(h)}</p>
            ) : h.field === "notes" || h.field === "term.note" ? (
              <p className="mt-0.5 line-clamp-3 text-muted-foreground">{show(h.field, h.after)}</p>
            ) : (
              <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-muted-foreground">
                <span className="line-through decoration-muted-foreground/50">{show(h.field, h.before)}</span>
                <ArrowRight aria-label={t("to")} className="h-3 w-3" />
                <span className="text-foreground">{show(h.field, h.after)}</span>
              </p>
            )}
            </>)}
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

/** A new cost line's id: the server keeps a well-formed one, so the row stays the same row while it saves. */
function newCostId(): string {
  const rnd = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().replace(/-/g, "") : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `c_${rnd.slice(0, 16)}`;
}

/**
 * Real cost & margin (Control Tower v4, 14 Oct 2026), right after Billing & payment: what the deal really
 * costs, as open lines (vendor, talent, production …), and the margin on its NET value. Totals are live —
 * computed, never stored (lib/pipeline.ts marginOf). The whole list goes back in one PATCH, like documents;
 * each line saves when its field is left. Who sees and edits it is the board's access: Full / Can edit edit,
 * Can comment / Can view read (the server enforces it).
 */
function RealCost({ deal, canEdit, onPatch }: { deal: PipelineDeal; canEdit: boolean; onPatch: (p: PipelineDealPatch) => void }) {
  const { t, lang } = useLang();
  const { fmtIdr, fmtIdrFull, hidden } = useMoneyFmt();
  const costs: PipelineCostItem[] = deal.costs ?? [];
  // Budget category per line (v8), offered once the deal has at least one category. "" = none.
  // Off (web 0.1.7 launch switch): no picker; a category set from the apps stays on the line untouched.
  const v8 = usePipelineV8();
  const budgets = deal.budgets ?? [];
  const budgetName = (id: string) => (id ? budgets.find((b) => b.id === id)?.name || (budgets.some((b) => b.id === id) ? t("Untitled category") : t("Deleted category")) : t("No budget category"));
  const m = marginOf({ netValue: deal.netValue, costs });
  const off = !canEdit;
  const save = (next: PipelineCostItem[]) => onPatch({ costs: next });
  const edit = (id: string, p: Partial<PipelineCostItem>) => save(costs.map((c) => (c.id === id ? { ...c, ...p } : c)));
  if (hidden) return null;
  return (
    <Section title={t("Real cost & margin")} owner="Finance">
      <dl className="grid grid-cols-3 gap-2 sm:col-span-2">
        <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2">
          <dt className="truncate text-xs font-medium text-muted-foreground">{t("Total real cost")}</dt>
          <dd className="mt-0.5 truncate text-sm font-semibold tabular-nums" title={fmtIdrFull(m.totalCost, lang)}>
            {/* Compact on a phone, where three full amounts do not fit side by side. */}
            <span className="sm:hidden">{fmtIdr(m.totalCost, lang)}</span>
            <span className="hidden sm:inline">{fmtIdrFull(m.totalCost, lang)}</span>
          </dd>
        </div>
        <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2">
          <dt className="truncate text-xs font-medium text-muted-foreground">{t("Margin")}</dt>
          <dd className={cn("mt-0.5 truncate text-sm font-semibold tabular-nums", marginTone(m.margin))} title={m.margin === null ? undefined : fmtIdrFull(m.margin, lang)}>
            {m.margin === null ? "–" : (
              <>
                <span className="sm:hidden">{fmtIdr(m.margin, lang)}</span>
                <span className="hidden sm:inline">{fmtIdrFull(m.margin, lang)}</span>
              </>
            )}
          </dd>
        </div>
        <div className="min-w-0 rounded-lg bg-muted/60 px-3 py-2">
          <dt className="truncate text-xs font-medium text-muted-foreground">{t("Margin %")}</dt>
          <dd className={cn("mt-0.5 truncate text-sm font-semibold tabular-nums", marginTone(m.margin))}>{fmtMarginPct(m.marginPct)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground sm:col-span-2">
        {m.margin === null ? t("Fill in the net project value to see the margin.") : t("Margin = net project value − total real cost.")}
      </p>

      <div className="space-y-2 sm:col-span-2">
        {costs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {canEdit
              ? t("No costs yet. Add what this deal really costs (vendors, talent, production) to see its margin.")
              : t("No costs recorded yet.")}
          </p>
        ) : (
          <ul className="space-y-1.5" aria-label={t("Cost lines")}>
            {costs.map((c, i) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2">
                <TextField
                  label={t("Cost {n} description", { n: i + 1 })}
                  placeholder={t("e.g. Sound vendor")}
                  value={c.label}
                  maxLength={120}
                  disabled={off}
                  onCommit={(v) => edit(c.id, { label: v })}
                  className="min-w-0 flex-1"
                />
                <MoneyField
                  label={t("Cost {n} amount", { n: i + 1 })}
                  value={c.amount}
                  disabled={off}
                  onCommit={(v) => edit(c.id, { amount: v })}
                  className="w-36 shrink-0 sm:w-44"
                />
                {canEdit && (
                  <button
                    type="button"
                    aria-label={t("Delete cost {n}", { n: i + 1 })}
                    onClick={() => save(costs.filter((x) => x.id !== c.id))}
                    className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-ring dark:hover:text-red-300 pointer-coarse:size-[44px]"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                {v8 && budgets.length > 0 && (
                  <div className="basis-full">
                    <SelectField
                      label={t("Cost {n} budget category", { n: i + 1 })}
                      value={c.budgetId ?? ""}
                      options={["", ...budgets.map((b) => b.id)]}
                      labelOf={budgetName}
                      disabled={off}
                      onCommit={(v) => edit(c.id, { budgetId: v || null })}
                      className="text-xs text-muted-foreground sm:max-w-[60%]"
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={() => save([...costs, { id: newCostId(), label: "", amount: 0, budgetId: null }])}
            disabled={costs.length >= 100}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 pointer-coarse:min-h-[44px]"
          >
            <Plus className="h-3.5 w-3.5" /> {t("Add cost")}
          </button>
        )}
      </div>
    </Section>
  );
}

/** Error text from a refused write: the server's field message when it sent one. */
function termErrorText(error: unknown, fallback: string): string {
  const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

/**
 * Payments per term (owner, 9 Oct 2026: "perlu per termin"): DP, Termin 1, Pelunasan … each with its
 * amount, due date, invoice and what has been paid. The deal's receivable, payment status and days
 * overdue follow from them (server: lib/pipeline.ts termSummaryOf). Fields save on their own when left,
 * like the rest of the drawer; every answer carries the whole deal, which replaces the board's copy.
 */
function PaymentTerms({ deal, projectId, canEdit }: { deal: PipelineDeal; projectId: string; canEdit: boolean }) {
  const { t, lang } = useLang();
  const { fmtIdrFull, hidden } = useMoneyFmt();
  const qc = useQueryClient();
  const terms = deal.terms ?? [];
  const sum = deal.termSummary ?? null;
  const [confirm, setConfirm] = useState<PipelineTerm | null>(null);

  const apply = (saved: PipelineDeal) => {
    qc.setQueryData<PipelineResponse>(pipelineKey(projectId), (cur) => {
      if (!cur) return cur;
      const next = cur.deals.map((d) => (d.id === saved.id ? saved : d));
      return { ...cur, deals: next, summary: summarize(next, cur.today) };
    });
    qc.invalidateQueries({ queryKey: dealKey(projectId, saved.id) });
  };
  const run = useMutation({
    mutationFn: (call: () => Promise<{ deal: PipelineDeal }>) => call(),
    onSuccess: (r) => apply(r.deal),
    onError: (e: unknown) => toast.error(termErrorText(e, t("That change wasn't saved. Try again."))),
  });
  const patch = (term: PipelineTerm, p: PipelineTermPatch) => run.mutate(() => pipelineApi.updateTerm(projectId, deal.id, term.id, p));

  // What the terms should add up to: the invoice value, or the contract value while there is no invoice.
  const base = deal.invoiceValue > 0 ? deal.invoiceValue : deal.contractValue;
  const baseIsInvoice = deal.invoiceValue > 0;
  const total = sum?.totalAmount ?? 0;
  // One key per press (race audit 16 Oct 2026, M7): a retried or doubled request stores one term, and two
  // quick presses are two terms (the key, not the content, tells them apart).
  const add = () => {
    const clientRequestId = crypto.randomUUID();
    run.mutate(() => pipelineApi.addTerm(projectId, deal.id, { amount: Math.max(0, base - total), clientRequestId }));
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <h4 className="text-sm font-semibold">{t("Payment terms")}</h4>
        {sum && (
          <p className="text-xs tabular-nums text-muted-foreground">
            {t("Paid {paid} of {total}", { paid: fmtIdrFull(sum.totalPaid, lang), total: fmtIdrFull(total, lang) })}
          </p>
        )}
      </div>

      {terms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {t("No terms yet. Split the payment into DP and terms to track each invoice and its due date; until then the fields above count.")}
        </p>
      ) : (
        <ul className="space-y-2">
          {terms.map((term) => (
            <TermRow key={term.id} term={term} canEdit={canEdit} onPatch={(p) => patch(term, p)} onDelete={() => setConfirm(term)} />
          ))}
        </ul>
      )}

      {sum && base > 0 && Math.round(total) !== Math.round(base) && (
        <p role="status" className="flex items-start gap-1.5 rounded-md bg-[var(--st-yellow-bg)] px-2.5 py-2 text-xs text-[var(--st-yellow-fg)]">
          <AlertTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span>
            {baseIsInvoice
              ? t("The terms add up to {terms}; the invoice value is {value}.", { terms: fmtIdrFull(total, lang), value: fmtIdrFull(base, lang) })
              : t("The terms add up to {terms}; the contract value is {value}.", { terms: fmtIdrFull(total, lang), value: fmtIdrFull(base, lang) })}
          </span>
        </p>
      )}

      {/* A new term starts with an amount: not while presenting. */}
      {canEdit && !hidden && (
        <button
          type="button"
          onClick={add}
          disabled={run.isPending}
          className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 pointer-coarse:min-h-[44px]"
        >
          {run.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t("Add term")}
        </button>
      )}

      <AlertDialog open={!!confirm} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
        <AlertDialogContent lang={lang}>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Delete {name}?", { name: confirm?.label ?? "" })}</AlertDialogTitle>
            <AlertDialogDescription>{t("The deal's receivable is counted again without it. Control Room → Audit can bring it back.")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const term = confirm;
                setConfirm(null);
                if (term) run.mutate(() => pipelineApi.removeTerm(projectId, deal.id, term.id));
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("Delete term")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function TermRow({ term, canEdit, onPatch, onDelete }: { term: PipelineTerm; canEdit: boolean; onPatch: (p: PipelineTermPatch) => void; onDelete: () => void }) {
  const { t, lang, locale } = useLang();
  const { fmtIdrFull, hidden } = useMoneyFmt();
  const labels = useVocabLabels();
  const off = !canEdit;
  // "Mark paid": the total received so far (prefilled with the full amount) and the day it came in.
  const [paying, setPaying] = useState(false);
  const [paidDraft, setPaidDraft] = useState(term.amount);
  const [paidOn, setPaidOn] = useState<string | null>(pipelineToday());
  const paid = term.status === "Paid";
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex items-center gap-2">
        <TextField label={t("Term name")} value={term.label} required maxLength={80} disabled={off} onCommit={(v) => onPatch({ label: v })} className="min-w-0 flex-1 font-medium" />
        <span className={cn("shrink-0 whitespace-nowrap rounded-full px-2 text-xs font-medium leading-5", TERM_TONE[term.status] ?? "bg-muted text-muted-foreground")}>
          {labels.status(term.status)}{term.daysOverdue > 0 ? ` · ${t("{n}d", { n: term.daysOverdue })}` : ""}
        </span>
        {canEdit && (
          <button type="button" aria-label={t("Delete term")} onClick={onDelete} className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-ring dark:hover:text-red-300 pointer-coarse:size-[44px]">
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Field label={t("Amount")}><MoneyField label={t("Amount")} value={term.amount} disabled={off} onCommit={(v) => onPatch({ amount: v })} /></Field>
        <Field label={t("Due date")}><DateField label={t("Due date")} value={term.dueDate} disabled={off} onCommit={(v) => onPatch({ dueDate: v })} /></Field>
        <Field label={t("Invoice no.")}><TextField label={t("Invoice no.")} value={term.invoiceNo} maxLength={80} disabled={off} onCommit={(v) => onPatch({ invoiceNo: v })} /></Field>
        <Field label={t("Invoice date")}><DateField label={t("Invoice date")} value={term.invoiceDate} disabled={off} onCommit={(v) => onPatch({ invoiceDate: v })} /></Field>
        {(term.paidAmount > 0 || term.paidAt) && (
          <>
            <Field label={t("Amount paid")}><MoneyField label={t("Amount paid")} value={term.paidAmount} disabled={off} onCommit={(v) => onPatch({ paidAmount: v })} /></Field>
            <Field label={t("Paid on")}><DateField label={t("Paid on")} value={term.paidAt} disabled={off} onCommit={(v) => onPatch({ paidAt: v })} /></Field>
          </>
        )}
        <Field label={t("Term note")} wide><TextField label={t("Term note")} value={term.note} maxLength={1000} disabled={off} onCommit={(v) => onPatch({ note: v })} /></Field>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs tabular-nums text-muted-foreground">
          {paid
            ? t("Paid in full{on}", { on: term.paidAt ? ` · ${fmtDay(term.paidAt, locale)}` : "" })
            : t("Still owed: {amount}", { amount: fmtIdrFull(term.outstanding, lang) })}
          {(term.overpaid ?? 0) > 0 && (
            <span className="ml-1.5 font-medium text-amber-700 dark:text-amber-300">· {t("Overpaid by {amount}", { amount: fmtIdrFull(term.overpaid ?? 0, lang) })}</span>
          )}
        </p>
        {canEdit && !paid && !paying && !hidden && (
          <button
            type="button"
            onClick={() => { setPaidDraft(term.amount); setPaidOn(term.paidAt ?? pipelineToday()); setPaying(true); }}
            className="inline-flex items-center gap-1 rounded-lg border border-border bg-card px-2.5 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
          >
            <CircleCheck className="h-3.5 w-3.5" /> {t("Mark paid")}
          </button>
        )}
      </div>
      {paying && !hidden && (
        <form
          onSubmit={(e) => { e.preventDefault(); setPaying(false); onPatch({ paidAmount: paidDraft, paidAt: paidOn }); }}
          className="mt-2 grid gap-2 rounded-md bg-muted/60 p-2.5 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
        >
          <Field label={t("Total received")}><MoneyField label={t("Total received")} value={paidDraft} onCommit={setPaidDraft} /></Field>
          <Field label={t("Paid on")}><DateField label={t("Paid on")} value={paidOn} onCommit={setPaidOn} /></Field>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setPaying(false)} className="rounded-lg px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted pointer-coarse:min-h-[44px]">{t("Cancel")}</button>
            <button type="submit" className="rounded-lg bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground pointer-coarse:min-h-[44px]">{t("Save")}</button>
          </div>
          {paidDraft > term.amount && (
            <p role="status" className="text-xs font-medium text-amber-700 sm:col-span-3 dark:text-amber-300">
              {t("Overpaid by {amount}. It still counts as paid in full.", { amount: fmtIdrFull(paidDraft - term.amount, lang) })}
            </p>
          )}
        </form>
      )}
    </li>
  );
}
