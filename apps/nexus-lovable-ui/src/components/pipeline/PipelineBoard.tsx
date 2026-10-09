import { memo, useState, type DragEvent } from "react";
import { AlertTriangle, ArrowRightLeft, Check, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { AvatarFace } from "@/components/Avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PIPELINE_STAGES, stageGroupOf } from "@/lib/pipeline";
import type { PipelineDeal } from "@/lib/pipeline-api";
import { GROUP_TONE, HealthPill, PhaseTrack, fmtIdr, personName, useVocabLabels } from "./pipeline-ui";

const DRAG_TYPE = "application/x-nexus-deal";

/** Inside a column: the most urgent first, then the biggest — the GM's order. */
const SEVERITY: Record<string, number> = { CRITICAL: 0, ATTENTION: 1, HEALTHY: 2, NOT_STARTED: 3, NONE: 4 };
export function bySeverity(a: PipelineDeal, b: PipelineDeal): number {
  return (SEVERITY[a.health.key] ?? 9) - (SEVERITY[b.health.key] ?? 9) || (b.netValue || 0) - (a.netValue || 0);
}

/**
 * The phase board: one column per stage, left to right from first contact to closed. Drag a card to
 * another column to move the deal there; the card's "Move" button does the same from a keyboard or a
 * phone, where dragging is not available. The columns scroll sideways as one strip.
 */
export function PipelineBoard({
  deals, onOpen, onMove, onAdd, canEdit,
}: {
  deals: PipelineDeal[];
  onOpen: (id: string) => void;
  onMove: (id: string, stage: string) => void;
  onAdd: (stage: string) => void;
  canEdit: boolean;
}) {
  const { t, lang } = useLang();
  const labels = useVocabLabels();
  const [over, setOver] = useState<string | null>(null);
  const byStage = new Map<string, PipelineDeal[]>(PIPELINE_STAGES.map((s) => [s, []]));
  for (const d of deals) {
    if (!byStage.has(d.stage)) byStage.set(d.stage, []);
    byStage.get(d.stage)!.push(d);
  }
  const drop = (stage: string) => (e: DragEvent) => {
    e.preventDefault();
    setOver(null);
    const id = e.dataTransfer.getData(DRAG_TYPE);
    const deal = deals.find((d) => d.id === id);
    if (deal && deal.stage !== stage) onMove(id, stage);
  };
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8 [scrollbar-width:thin]">
      <div className="flex min-w-max gap-3">
        {[...byStage.entries()].map(([stage, list]) => {
          const total = list.reduce((sum, d) => sum + (d.netValue || 0), 0);
          const sorted = [...list].sort(bySeverity);
          const group = stageGroupOf(stage);
          return (
            <section
              key={stage}
              aria-label={labels.stage(stage)}
              onDragOver={canEdit ? (e) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setOver(stage); } } : undefined}
              onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(null); }}
              onDrop={canEdit ? drop(stage) : undefined}
              className={cn(
                "flex w-[17.5rem] shrink-0 flex-col rounded-2xl border bg-muted/40 transition-colors",
                over === stage ? "border-primary/60 bg-accent/60" : "border-border",
              )}
            >
              <header className="flex items-start justify-between gap-2 px-3 pb-2 pt-3">
                <div className="min-w-0">
                  <h3 className="flex items-center gap-1.5 text-sm font-semibold">
                    <span aria-hidden className={cn("h-2 w-2 shrink-0 rounded-full", GROUP_TONE[group])} />
                    <span className="truncate">{labels.stage(stage)}</span>
                  </h3>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{total > 0 ? fmtIdr(total, lang) : " "}</p>
                </div>
                <span className="rounded-full bg-background px-2 py-0.5 text-xs font-semibold tabular-nums text-muted-foreground ring-1 ring-border">{list.length}</span>
              </header>
              <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
                {sorted.map((d) => (
                  <DealCard key={d.id} deal={d} onOpen={onOpen} onMove={onMove} canEdit={canEdit} />
                ))}
                {sorted.length === 0 && (
                  <p className="grid flex-1 place-items-center rounded-xl border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground">
                    {canEdit ? t("Drop a deal here") : t("No deals")}
                  </p>
                )}
                {canEdit && stage !== "Lost / Cancelled" && (
                  <button
                    type="button"
                    onClick={() => onAdd(stage)}
                    className="mt-auto inline-flex items-center justify-center gap-1 rounded-xl px-2 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-[44px]"
                  >
                    <Plus className="h-3.5 w-3.5" /> {t("Add in this stage")}
                  </button>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

const DealCard = memo(function DealCard({
  deal, onOpen, onMove, canEdit,
}: { deal: PipelineDeal; onOpen: (id: string) => void; onMove: (id: string, stage: string) => void; canEdit: boolean }) {
  const { t, lang } = useLang();
  const labels = useVocabLabels();
  const [dragging, setDragging] = useState(false);
  const pm = personName(deal.pm, deal.pmName);
  return (
    <article
      draggable={canEdit}
      onDragStart={(e) => { e.dataTransfer.setData(DRAG_TYPE, deal.id); e.dataTransfer.effectAllowed = "move"; setDragging(true); }}
      onDragEnd={() => setDragging(false)}
      className={cn(
        "group relative rounded-xl border border-border bg-card p-3 shadow-soft transition-[box-shadow,opacity,transform] hover:shadow-pop",
        canEdit && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-50",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-2xs font-medium tabular-nums text-muted-foreground">{deal.code}</p>
          {/* The whole card opens the deal: the title's button is stretched over it (after:absolute). */}
          <h4 className="mt-0.5 text-sm font-semibold leading-snug">
            <button
              type="button"
              onClick={() => onOpen(deal.id)}
              className="text-left after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-ring"
            >
              {deal.name || t("Untitled deal")}
            </button>
          </h4>
        </div>
        {deal.health.key !== "NONE" && <HealthPill health={deal.health.key} />}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate text-muted-foreground">{deal.brand || "–"}</span>
        {/* No value yet (a fresh lead): a quiet dash, not "Rp0" in bold. */}
        {deal.netValue ? <span className="shrink-0 font-semibold tabular-nums">{fmtIdr(deal.netValue, lang)}</span> : <span className="shrink-0 text-muted-foreground" aria-label={t("No value yet")}>–</span>}
      </div>
      <PhaseTrack deal={deal} className="mt-2.5" />
      {deal.blocker && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle aria-hidden className="mt-px h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2">{deal.blocker}</span>
        </p>
      )}
      <div className="mt-2.5 flex items-center justify-between gap-2 text-xs">
        {pm ? (
          <span className="inline-flex min-w-0 items-center gap-1.5 text-muted-foreground">
            <AvatarFace name={pm} avatar={deal.pm?.avatar ?? null} size={18} decorative className="ring-1" />
            <span className="truncate">{pm}</span>
          </span>
        ) : stageGroupOf(deal.stage) === "Pipeline" || stageGroupOf(deal.stage) === "Lost" ? (
          <span className="text-muted-foreground">{deal.service}</span>
        ) : (
          <span className="font-medium text-red-700 dark:text-red-300">{t("No PM yet")}</span>
        )}
        {canEdit && (
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("Move {name} to another stage", { name: deal.name })}
                className="relative z-10 grid h-7 w-7 shrink-0 place-items-center rounded-lg text-muted-foreground opacity-70 transition hover:bg-muted hover:text-foreground hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-ring group-hover:opacity-100 pointer-coarse:size-[44px] pointer-coarse:opacity-100"
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-60 p-1">
              <p className="px-2 py-1.5 text-2xs font-semibold uppercase tracking-wider text-muted-foreground">{t("Move to stage")}</p>
              {PIPELINE_STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={s === deal.stage}
                  onClick={() => onMove(deal.id, s)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:cursor-default disabled:font-semibold disabled:hover:bg-transparent pointer-coarse:min-h-[44px]"
                >
                  <span className="inline-flex items-center gap-2">
                    <span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", GROUP_TONE[stageGroupOf(s)])} />
                    {labels.stage(s)}
                  </span>
                  {s === deal.stage && <Check aria-hidden className="h-3.5 w-3.5" />}
                </button>
              ))}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </article>
  );
});
