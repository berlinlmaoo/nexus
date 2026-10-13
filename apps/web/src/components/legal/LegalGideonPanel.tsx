import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Loader2, MessageCircleQuestion, X } from "lucide-react";
import { GideonMark } from "@/components/gideon/GideonMark";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { SegmentsView } from "@/components/legal/LegalDiffView";
import { legalGideonApi, type LegalDocument, type LegalProposal } from "@/lib/legal-api";
import { useLang } from "@/lib/lang";

/**
 * GIDEON's precise edit (owner, 14 Oct 2026): tick the paragraphs, say what to change; GIDEON proposes
 * before → after for those paragraphs only, and nothing changes until you approve. An unclear request gets a
 * question back.
 */
export function LegalGideonPanel({ doc, selected, onClearSelection }: { doc: LegalDocument; selected: Set<number>; onClearSelection: () => void }) {
  const { t } = useLang();
  const qc = useQueryClient();
  const [instruction, setInstruction] = useState("");
  const proposals = useQuery({ queryKey: ["legal", "proposals", doc.id], queryFn: () => legalGideonApi.list(doc.id) });
  const latest = proposals.data?.proposals[0];
  const show = latest && (latest.status === "PENDING" || latest.status === "CLARIFY" || latest.status === "FAILED") && latest.baseVersion === doc.currentVersion ? latest : null;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ["legal", "proposals", doc.id] });
    void qc.invalidateQueries({ queryKey: ["legal", "document", doc.id] });
    void qc.invalidateQueries({ queryKey: ["legal", "documents"] });
  };
  const ask = useMutation({
    mutationFn: (input: { replyTo?: string; answer?: string }) =>
      legalGideonApi.ask(doc.id, { baseVersion: doc.currentVersion, instruction: input.replyTo ? "" : instruction.trim(), targets: [...selected].sort((a, b) => a - b), ...input }),
    onSuccess: ({ proposal }) => {
      qc.setQueryData(["legal", "proposals", doc.id], (cur: { proposals: LegalProposal[] } | undefined) => ({ proposals: [proposal, ...(cur?.proposals ?? []).filter((p) => p.id !== proposal.id)] }));
      if (proposal.status === "PENDING") setInstruction("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex items-center gap-2 text-sm font-medium"><GideonMark className="h-4 w-4" /> {t("Ask GIDEON to change it")}</div>
      <p className="text-xs text-muted-foreground">
        {selected.size
          ? t("GIDEON may change only the {n} paragraphs you ticked.", { n: selected.size })
          : t("Tick the paragraphs to change, or describe the clause and GIDEON picks the fewest paragraphs.")}
        {selected.size > 0 && <button className="ml-1.5 underline-offset-2 hover:underline" onClick={onClearSelection}>{t("Clear")}</button>}
      </p>
      <Textarea rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={t("e.g. Change the term to 6 months and the fee to Rp 2.000.000")} />
      <Button size="sm" className="gap-1.5" disabled={!instruction.trim() || ask.isPending} onClick={() => ask.mutate({})}>
        {ask.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <GideonMark className="h-4 w-4" />} {ask.isPending ? t("GIDEON is reading…") : t("Propose a change")}
      </Button>
      {show && <ProposalCard key={show.id} doc={doc} p={show} onDone={refresh} onAnswer={(answer) => ask.mutate({ replyTo: show.id, answer })} answering={ask.isPending} />}
    </div>
  );
}

function ProposalCard({ doc, p, onDone, onAnswer, answering }: { doc: LegalDocument; p: LegalProposal; onDone: () => void; onAnswer: (a: string) => void; answering: boolean }) {
  const { t } = useLang();
  const [chosen, setChosen] = useState<Set<number>>(new Set(p.changes.map((c) => c.index)));
  const [answer, setAnswer] = useState("");
  useEffect(() => { setChosen(new Set(p.changes.map((c) => c.index))); }, [p]);
  const decide = useMutation({
    mutationFn: (decision: "approve" | "discard") => legalGideonApi.decide(doc.id, p.id, decision, decision === "approve" ? [...chosen] : undefined),
    onSuccess: (res, decision) => {
      if (decision === "approve") toast.success(t("Applied as version {n}", { n: res.version ?? 0 }));
      if (res.pdfError) toast.warning(t("The PDF couldn't be made yet: {reason}", { reason: res.pdfError }));
      onDone();
    },
    onError: (e: Error) => { toast.error(e.message); onDone(); },
  });

  if (p.status === "CLARIFY") {
    return (
      <div className="space-y-2 rounded-md border border-primary/30 bg-background p-3 text-sm">
        <div className="flex items-start gap-2"><MessageCircleQuestion className="mt-0.5 h-4 w-4 shrink-0 text-primary" /> <span>{p.question}</span></div>
        <div className="flex gap-2">
          <Input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder={t("Your answer")} onKeyDown={(e) => { if (e.key === "Enter" && answer.trim()) onAnswer(answer.trim()); }} />
          <Button size="sm" disabled={!answer.trim() || answering} onClick={() => onAnswer(answer.trim())}>{answering ? <Loader2 className="h-4 w-4 animate-spin" /> : t("Reply")}</Button>
        </div>
      </div>
    );
  }
  if (p.status === "FAILED") {
    return <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{t("GIDEON's proposal was refused: {reason}", { reason: p.summary || "—" })}</div>;
  }
  return (
    <div className="space-y-2 rounded-md border border-amber-500/40 bg-background p-3 text-sm">
      <div className="font-medium">{p.summary || p.instruction}</div>
      <ul className="space-y-2">
        {p.changes.map((c) => (
          <li key={c.index} className="flex gap-2">
            <input type="checkbox" className="mt-1 h-3.5 w-3.5 shrink-0 accent-primary" checked={chosen.has(c.index)} aria-label={t("Apply the change to paragraph {n}", { n: c.index + 1 })}
              onChange={() => setChosen((cur) => { const n = new Set(cur); if (n.has(c.index)) n.delete(c.index); else n.add(c.index); return n; })} />
            <div className="min-w-0 flex-1 leading-relaxed">
              <div className="mb-0.5 text-[11px] text-muted-foreground">{t("Paragraph {n}", { n: c.index + 1 })}</div>
              <SegmentsView segments={c.segments} />
            </div>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2 pt-1">
        <Button size="sm" className="gap-1.5" disabled={!chosen.size || decide.isPending} onClick={() => decide.mutate("approve")}>
          {decide.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />} {chosen.size === p.changes.length ? t("Approve") : t("Approve {n} of {total}", { n: chosen.size, total: p.changes.length })}
        </Button>
        <Button size="sm" variant="ghost" className="gap-1.5" disabled={decide.isPending} onClick={() => decide.mutate("discard")}><X className="h-4 w-4" /> {t("Discard")}</Button>
      </div>
    </div>
  );
}
