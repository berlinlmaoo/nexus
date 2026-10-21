import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { CONTACT_ROLES, summarize } from "@/lib/pipeline";
import {
  dealKey, pipelineApi, pipelineKey, type PipelineDeal, type PipelineItemKind, type PipelineItemPatch, type PipelineResponse,
} from "@/lib/pipeline-api";
import { useMoneyFmt } from "./presentation";
import { MoneyField, SelectField, TextField } from "./fields";
import { Section } from "./drawer-parts";
import { useVocabLabels } from "./pipeline-ui";

/**
 * Control Tower v8 (21 Oct 2026): a deal's open lists — cashback recipients, project contacts, budget
 * categories. Each entry is its own row on the server (POST / PATCH / DELETE …/pipeline/:dealId/items), so two
 * people editing the same deal never overwrite each other's entries; a delete is restorable from Control Room →
 * Audit. Every answer carries the whole deal, which replaces the board's copy (totals and budget remaining move).
 */

/** Error text from a refused write: the server's field message when it sent one. */
function errorText(error: unknown, fallback: string): string {
  const payload = (error as { payload?: { error?: unknown } } | null)?.payload;
  return typeof payload?.error === "string" ? payload.error : fallback;
}

export function useDealItems(projectId: string, deal: PipelineDeal) {
  const { t } = useLang();
  const qc = useQueryClient();
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
    onError: (e: unknown) => toast.error(errorText(e, t("That change wasn't saved. Try again."))),
  });
  return {
    pending: run.isPending,
    // One key per press (as "Add term"): a retried or doubled request stores one row.
    add: (kind: PipelineItemKind, init: PipelineItemPatch = {}) =>
      run.mutate(() => pipelineApi.addItem(projectId, deal.id, { kind, ...init, clientRequestId: crypto.randomUUID() })),
    patch: (itemId: string, p: PipelineItemPatch) => run.mutate(() => pipelineApi.updateItem(projectId, deal.id, itemId, p)),
    remove: (itemId: string, name: string) =>
      run.mutate(() => pipelineApi.removeItem(projectId, deal.id, itemId).then((r) => {
        toast.success(t("{name} deleted. Control Room → Audit can restore it.", { name: name || t("Item") }));
        return r;
      })),
  };
}

type Items = ReturnType<typeof useDealItems>;

const addButton =
  "inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-60 pointer-coarse:min-h-[44px]";
const deleteButton =
  "grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-destructive/10 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-ring dark:hover:text-red-300 pointer-coarse:size-[44px]";

function Total({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2 sm:col-span-2">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

/** Cashback (v8): right after Commercial. Money only — not rendered at all in presentation mode. */
export function CashbackSection({ deal, canEdit, items }: { deal: PipelineDeal; canEdit: boolean; items: Items }) {
  const { t, lang } = useLang();
  const { fmtIdrFull, hidden } = useMoneyFmt();
  const list = deal.cashback ?? [];
  if (hidden) return null;
  return (
    <Section title={t("Cashback")} owner={t("BD / account")}>
      <div className="space-y-2 sm:col-span-2" data-pl="cashback">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{canEdit ? t("No cashback. Add who receives a cashback from this deal and how much.") : t("No cashback recorded.")}</p>
        ) : (
          <ul className="space-y-1.5" aria-label={t("Cashback recipients")}>
            {list.map((c, i) => (
              <li key={c.id} className="flex items-center gap-2">
                <TextField label={t("Recipient {n}", { n: i + 1 })} placeholder={t("Recipient name")} value={c.name} maxLength={120} disabled={!canEdit} onCommit={(v) => items.patch(c.id, { name: v })} className="min-w-0 flex-1" />
                <MoneyField label={t("Cashback {n} amount", { n: i + 1 })} value={c.amount} disabled={!canEdit} onCommit={(v) => items.patch(c.id, { amount: v })} className="w-36 shrink-0 sm:w-44" />
                {canEdit && (
                  <button type="button" aria-label={t("Delete cashback {n}", { n: i + 1 })} onClick={() => items.remove(c.id, c.name)} className={deleteButton}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <button type="button" onClick={() => items.add("cashback")} disabled={items.pending || list.length >= 100} className={addButton}>
            {items.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t("Add recipient")}
          </button>
        )}
      </div>
      <Total label={t("Total cashback")} value={fmtIdrFull(deal.cashbackTotal ?? 0, lang)} />
    </Section>
  );
}

/** Project contacts (v8): below Contract. No money: shown in presentation mode too. */
export function ContactsSection({ deal, canEdit, items }: { deal: PipelineDeal; canEdit: boolean; items: Items }) {
  const { t } = useLang();
  const labels = useVocabLabels();
  const list = deal.contacts ?? [];
  return (
    <Section title={t("Project contacts")} owner={t("Every division")}>
      <div className="space-y-2 sm:col-span-2" data-pl="contacts">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{canEdit ? t("No contacts yet. Add the client, vendor, broker or finance people for this project.") : t("No contacts recorded.")}</p>
        ) : (
          <ul className="space-y-2" aria-label={t("Project contacts")}>
            {list.map((c, i) => (
              <li key={c.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-lg border border-border p-2 sm:grid-cols-[10rem_minmax(0,1fr)_10rem_auto] sm:border-0 sm:p-0">
                <SelectField label={t("Contact {n} role", { n: i + 1 })} value={c.role} options={CONTACT_ROLES} labelOf={labels.contactRole} disabled={!canEdit} onCommit={(v) => items.patch(c.id, { role: v })} className="min-w-0" />
                {canEdit ? (
                  <button type="button" aria-label={t("Delete contact {n}", { n: i + 1 })} onClick={() => items.remove(c.id, c.name)} className={cn(deleteButton, "sm:order-last")}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                ) : <span className="sm:order-last" />}
                <TextField label={t("Contact {n} name", { n: i + 1 })} placeholder={t("Name")} value={c.name} maxLength={120} disabled={!canEdit} onCommit={(v) => items.patch(c.id, { name: v })} className="col-span-2 min-w-0 sm:col-span-1" />
                <TextField label={t("Contact {n} phone", { n: i + 1 })} placeholder={t("Phone")} value={c.phone} maxLength={40} disabled={!canEdit} onCommit={(v) => items.patch(c.id, { phone: v })} className="col-span-2 min-w-0 sm:col-span-1" />
              </li>
            ))}
          </ul>
        )}
        {canEdit && (
          <button type="button" onClick={() => items.add("contact", { role: "Client" })} disabled={items.pending || list.length >= 100} className={addButton}>
            {items.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t("Add contact")}
          </button>
        )}
      </div>
    </Section>
  );
}

/**
 * Budget expenses (v8, the Strategist's): categories with an amount and what the cost lines booked against
 * each have used — remaining in green, over budget in red. Budget never changes margin or real profit. Money
 * only: not rendered in presentation mode.
 */
export function BudgetSection({ deal, canEdit, items }: { deal: PipelineDeal; canEdit: boolean; items: Items }) {
  const { t, lang } = useLang();
  const { fmtIdrFull, hidden } = useMoneyFmt();
  const list = deal.budgets ?? [];
  if (hidden) return null;
  return (
    <Section title={t("Budget expenses")} owner={t("Strategist")}>
      <div className="space-y-2 sm:col-span-2" data-pl="budget">
        {list.length === 0 ? (
          <p className="text-sm text-muted-foreground">{canEdit ? t("No budget yet. Add categories (venue, talent, production) and book real costs against them.") : t("No budget recorded.")}</p>
        ) : (
          <ul className="space-y-2" aria-label={t("Budget categories")}>
            {list.map((b, i) => {
              const over = b.remaining < 0;
              return (
                <li key={b.id} className="space-y-1">
                  <div className="flex items-center gap-2">
                    <TextField label={t("Budget category {n}", { n: i + 1 })} placeholder={t("e.g. Venue")} value={b.name} maxLength={120} disabled={!canEdit} onCommit={(v) => items.patch(b.id, { name: v })} className="min-w-0 flex-1" />
                    <MoneyField label={t("Budget {n} amount", { n: i + 1 })} value={b.amount} disabled={!canEdit} onCommit={(v) => items.patch(b.id, { amount: v })} className="w-36 shrink-0 sm:w-44" />
                    {canEdit && (
                      <button type="button" aria-label={t("Delete budget category {n}", { n: i + 1 })} onClick={() => items.remove(b.id, b.name)} className={deleteButton}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <p className="flex flex-wrap gap-x-3 px-0.5 text-xs tabular-nums text-muted-foreground" data-budget-state={over ? "over" : "ok"}>
                    <span>{t("Used {amount}", { amount: fmtIdrFull(b.spent, lang) })}</span>
                    <span className={cn("font-medium", over ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300")}>
                      {over ? t("Over by {amount}", { amount: fmtIdrFull(-b.remaining, lang) }) : t("Remaining {amount}", { amount: fmtIdrFull(b.remaining, lang) })}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {canEdit && (
          <button type="button" onClick={() => items.add("budget")} disabled={items.pending || list.length >= 100} className={addButton}>
            {items.pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />} {t("Add category")}
          </button>
        )}
      </div>
      <Total label={t("Total budget")} value={fmtIdrFull(deal.budgetTotal ?? 0, lang)} />
      <p className="text-xs text-muted-foreground sm:col-span-2">{t("Book each real cost line against a category below. Budget does not change the margin.")}</p>
    </Section>
  );
}
