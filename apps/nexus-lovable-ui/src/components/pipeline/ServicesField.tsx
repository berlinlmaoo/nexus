import { useId, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useLang } from "@/lib/lang";
import { SERVICE_OPTIONS } from "@/lib/pipeline";
import { pipelineKey, servicesOf, type PipelineResponse } from "@/lib/pipeline-api";

/** Same ceilings as the server (lib/pipeline-server.ts normalizeServices). */
const SERVICES_MAX = 20;
const SERVICE_MAX = 60;

/**
 * A deal's services (owner, 9 Oct 2026: "gw mau bisa select multiple services dan ngetik service sendiri,
 * takutnya ada deal yg bisa kita kerjain tpi diluar services ini"): the presets as toggles, anything else
 * typed and added as a chip. The typing suggests services other deals of this board already use, so
 * "KOL" is not spelled three ways. Each change saves the whole list at once, like every other field.
 */
export function ServicesField({
  value, projectId, disabled, onCommit,
}: {
  value: string[];
  projectId: string;
  disabled?: boolean;
  onCommit: (services: string[]) => void;
}) {
  const { t } = useLang();
  const qc = useQueryClient();
  const listId = useId();
  const [draft, setDraft] = useState("");
  const has = (s: string) => value.some((v) => v.toLowerCase() === s.toLowerCase());

  // Typed services the board's other deals use, most used first.
  const board = qc.getQueryData<PipelineResponse>(pipelineKey(projectId));
  const suggestions = useMemo(() => {
    const presets = new Set(SERVICE_OPTIONS.map((s) => s.toLowerCase()));
    const count = new Map<string, number>();
    for (const d of board?.deals ?? []) {
      for (const s of servicesOf(d)) if (!presets.has(s.toLowerCase())) count.set(s, (count.get(s) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([s]) => s);
  }, [board]);

  const toggle = (s: string) => onCommit(has(s) ? value.filter((v) => v.toLowerCase() !== s.toLowerCase()) : [...value, s]);
  const add = () => {
    const s = draft.trim().replace(/\s+/g, " ").slice(0, SERVICE_MAX);
    setDraft("");
    if (!s || has(s) || value.length >= SERVICES_MAX) return;
    // A preset typed by hand is the preset, spelled as the list spells it.
    onCommit([...value, SERVICE_OPTIONS.find((p) => p.toLowerCase() === s.toLowerCase()) ?? s]);
  };
  const custom = value.filter((v) => !SERVICE_OPTIONS.some((p) => p.toLowerCase() === v.toLowerCase()));

  return (
    <div className="space-y-2">
      <div role="group" aria-label={t("Services")} className="flex flex-wrap gap-1.5">
        {SERVICE_OPTIONS.map((s) => {
          const on = has(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => toggle(s)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-ring disabled:cursor-default pointer-coarse:min-h-[36px]",
                on ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {on && <Check aria-hidden className="h-3 w-3" />}
              {s}
            </button>
          );
        })}
        {custom.map((s) => (
          <span key={s} className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/10 py-1 pl-2.5 pr-1 text-xs font-medium">
            {s}
            {!disabled && (
              <button
                type="button"
                aria-label={t("Remove {name}", { name: s })}
                onClick={() => toggle(s)}
                className="grid h-4 w-4 place-items-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:size-[28px]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ))}
      </div>
      {!disabled && value.length < SERVICES_MAX && (
        <form onSubmit={(e) => { e.preventDefault(); add(); }} className="flex gap-2">
          <input
            aria-label={t("Add a service that isn't listed")}
            value={draft}
            maxLength={SERVICE_MAX}
            list={suggestions.length ? listId : undefined}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={t("Another service, e.g. KOL")}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm pointer-coarse:min-h-[44px]"
          />
          {suggestions.length > 0 && (
            <datalist id={listId}>
              {suggestions.filter((s) => !has(s)).map((s) => <option key={s} value={s} />)}
            </datalist>
          )}
          <button
            type="submit"
            disabled={!draft.trim()}
            className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-40 pointer-coarse:min-h-[44px]"
          >
            <Plus className="h-3.5 w-3.5" /> {t("Add")}
          </button>
        </form>
      )}
    </div>
  );
}
