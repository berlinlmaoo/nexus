import { apiFetch, downloadFile } from "@/lib/nexus-api";
import type { DealHealth, DealPhase, PipelineSummary, StageGroup, TermStatus, TermSummary } from "@/lib/pipeline";

/**
 * The Pipeline Dashboard API (owner, 9 Oct 2026): GET/POST /api/projects/:id/pipeline,
 * GET/PATCH/DELETE …/pipeline/:dealId, GET …/pipeline/export. Server: src/lib/pipeline-server.ts.
 */

export type PipelinePerson = { id: string; name: string | null; avatar: string | null };

export type PipelineLink = { id: string; type: string; label: string; url: string };

/**
 * One payment term of a deal (owner, 9 Oct 2026: "perlu per termin"). status / outstanding / daysOverdue
 * are the server's (lib/pipeline.ts termStatusOf), so every client says the same.
 */
export type PipelineTerm = {
  id: string;
  dealId: string;
  position: number;
  label: string;
  amount: number;
  dueDate: string | null;
  invoiceNo: string;
  invoiceDate: string | null;
  paidAmount: number;
  paidAt: string | null;
  note: string;
  createdAt: string;
  updatedAt: string;
  status: TermStatus;
  outstanding: number;
  daysOverdue: number;
};

/** What a term POST/PATCH may carry. */
export type PipelineTermPatch = Partial<Pick<PipelineTerm, "label" | "amount" | "dueDate" | "invoiceNo" | "invoiceDate" | "paidAmount" | "paidAt" | "note" | "position">>;

export type PipelineDeal = {
  id: string;
  projectId: string;
  code: string;
  position: number;
  name: string;
  brand: string;
  service: string;
  bdUserId: string | null;
  bdName: string | null;
  bd: PipelinePerson | null;
  pmUserId: string | null;
  pmName: string | null;
  pm: PipelinePerson | null;
  stage: string;
  probability: number;
  contractValue: number;
  netValue: number;
  invoiceValue: number;
  contractStatus: string;
  vregStatus: string;
  readiness: string;
  deliverableStatus: string;
  deliverableRisk: string;
  paymentStatus: string;
  outstandingReceivable: number;
  paymentDueDate: string | null;
  maxDaysOverdue: number;
  netCash: number;
  closingStatus: string;
  mainDate: string | null;
  nextAction: string;
  nextActionDate: string | null;
  blocker: string;
  notes: string;
  links: PipelineLink[];
  /** The Task project made when the deal was won (owner/GM, 9 Oct 2026); null = none (yet). Older servers omit it. */
  executionProjectId?: string | null;
  executionProject?: { id: string; name: string } | null;
  createdAt: string;
  createdBy: PipelinePerson | null;
  updatedAt: string;
  updatedBy: PipelinePerson | null;
  stageGroup: StageGroup;
  daysOverdue: number;
  health: DealHealth;
  phases: DealPhase[];
  /** Payments per term (9 Oct 2026). With any, termSummary's receivable / status / next due date are the
   *  deal's and the manual payment fields above are only a fallback. Older servers omit both. */
  terms?: PipelineTerm[];
  termSummary?: TermSummary | null;
};

/** The fields a PATCH may carry (and `position`). */
export type PipelineDealPatch = Partial<Omit<PipelineDeal,
  "id" | "projectId" | "code" | "bd" | "pm" | "executionProjectId" | "executionProject" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "stageGroup" | "daysOverdue" | "health" | "phases" | "terms" | "termSummary">>;

export type PipelineResponse = {
  project: { id: string; name: string; type: string; workspaceId: string };
  deals: PipelineDeal[];
  summary: PipelineSummary;
  today: string;
};

export type PipelineChange = {
  id: string;
  field: string;
  before: unknown;
  after: unknown;
  createdAt: string;
  user: PipelinePerson | null;
  /** A payment-term change ("term.amount", "term.created", …): which term, named as it was then. */
  termId?: string | null;
  termLabel?: string | null;
};

const base = (projectId: string) => `/api/projects/${encodeURIComponent(projectId)}/pipeline`;

export const pipelineApi = {
  list: (projectId: string) => apiFetch<PipelineResponse>(base(projectId)),
  create: (projectId: string, payload: PipelineDealPatch) =>
    apiFetch<PipelineDeal>(base(projectId), { method: "POST", body: JSON.stringify(payload) }),
  detail: (projectId: string, dealId: string) =>
    apiFetch<{ deal: PipelineDeal; history: PipelineChange[] }>(`${base(projectId)}/${encodeURIComponent(dealId)}`),
  update: (projectId: string, dealId: string, payload: PipelineDealPatch) =>
    apiFetch<PipelineDeal>(`${base(projectId)}/${encodeURIComponent(dealId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  remove: (projectId: string, dealId: string) =>
    apiFetch<{ success: boolean }>(`${base(projectId)}/${encodeURIComponent(dealId)}`, { method: "DELETE" }),
  /** "Create execution project" on a won deal; a deal that has one gets that one back. */
  createExecution: (projectId: string, dealId: string) =>
    apiFetch<{ projectId: string; created: boolean; deal: PipelineDeal }>(`${base(projectId)}/${encodeURIComponent(dealId)}/execution`, { method: "POST" }),
  /** Payment terms (9 Oct 2026). Every answer carries the whole deal: its receivable and health moved. */
  addTerm: (projectId: string, dealId: string, payload: PipelineTermPatch) =>
    apiFetch<{ deal: PipelineDeal; term: PipelineTerm }>(`${base(projectId)}/${encodeURIComponent(dealId)}/terms`, { method: "POST", body: JSON.stringify(payload) }),
  updateTerm: (projectId: string, dealId: string, termId: string, payload: PipelineTermPatch) =>
    apiFetch<{ deal: PipelineDeal; term: PipelineTerm }>(`${base(projectId)}/${encodeURIComponent(dealId)}/terms/${encodeURIComponent(termId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  removeTerm: (projectId: string, dealId: string, termId: string) =>
    apiFetch<{ deal: PipelineDeal }>(`${base(projectId)}/${encodeURIComponent(dealId)}/terms/${encodeURIComponent(termId)}`, { method: "DELETE" }),
  exportXlsx: (projectId: string, lang: "id" | "en") =>
    downloadFile(`${base(projectId)}/export?lang=${lang}`, "pipeline.xlsx"),
};

/** Query keys: the list, and one deal's detail (history). Realtime invalidates both by prefix. */
export const pipelineKey = (projectId: string) => ["nexus", "pipeline", projectId] as const;
export const dealKey = (projectId: string, dealId: string) => ["nexus", "pipeline", projectId, "deal", dealId] as const;
