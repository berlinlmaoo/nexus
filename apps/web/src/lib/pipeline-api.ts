import { apiFetch, downloadFile, uploadChunked, type UploadControl } from "@/lib/nexus-api";
import type { DealHealth, DealPhase, PipelineCostItem, PipelineSummary, StageGroup, TermStatus, TermSummary } from "@/lib/pipeline";

/**
 * The Pipeline Dashboard API (owner, 9 Oct 2026): GET/POST /api/projects/:id/pipeline,
 * GET/PATCH/DELETE …/pipeline/:dealId, GET …/pipeline/export. Server: src/lib/pipeline-server.ts.
 */

export type PipelinePerson = { id: string; name: string | null; avatar: string | null };

/**
 * A deal's document: a pasted link, or (owner, 9 Oct 2026) an attached file — then `url` is its
 * members-only download route and fileName / mimeType / size describe it. Older servers send links only
 * (no `kind`). A file goes back in a PATCH of `links` as it came (the server keeps it by id).
 */
export type PipelineLink = {
  id: string;
  type: string;
  label: string;
  url: string;
  kind?: "link" | "file";
  fileName?: string;
  mimeType?: string;
  size?: number;
  uploadedAt?: string;
};

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
  /** Received above the amount; absent from servers before 19 Oct 2026. */
  overpaid?: number;
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
  /** Every service, presets and typed ones (owner, 9 Oct 2026); `service` is the first. Older servers omit it. */
  services?: string[];
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
  /** "Create execution project" (owner, 10 Oct 2026): the deal's folder and its Master Calendar project.
   *  executionProject above is that folder's Master Task. Null on deals made before 10 Oct. */
  executionCalendarProjectId?: string | null;
  executionCalendarProject?: { id: string; name: string } | null;
  executionFolderId?: string | null;
  executionFolder?: { id: string; name: string } | null;
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
  /** Real cost lines (Control Tower v4, 14 Oct 2026); a PATCH sends the whole list. Older servers omit them.
   *  costTotal / margin / marginPct are derived on the net value; margin is null without a net value. */
  costs?: PipelineCostItem[];
  costTotal?: number;
  margin?: number | null;
  marginPct?: number | null;
  /** Control Tower v8 (21 Oct 2026). Older servers omit all of these (read as empty / 0 / null). */
  barterValue?: number;
  barterCompensation?: string;
  cashback?: PipelineCashback[];
  cashbackTotal?: number;
  contacts?: PipelineContact[];
  budgets?: PipelineBudget[];
  budgetTotal?: number;
  eventYear?: number | null;
  /** All Pipelines only: the board the deal is on. */
  source?: { projectId: string; name: string };
};

/** A cashback recipient (v8): POST/PATCH/DELETE …/pipeline/:dealId/items. */
export type PipelineCashback = { id: string; dealId: string; position: number; name: string; amount: number; createdAt: string; updatedAt: string };
/** A project contact (v8). `role` is one of CONTACT_ROLES. */
export type PipelineContact = { id: string; dealId: string; position: number; role: string; name: string; phone: string; createdAt: string; updatedAt: string };
/** A budget category (v8): spent = Σ cost lines booked against it; remaining < 0 = over budget. */
export type PipelineBudget = PipelineCashback & { spent: number; remaining: number };
export type PipelineItemKind = "cashback" | "contact" | "budget";
export type PipelineItemPatch = { name?: string; amount?: number; role?: string; phone?: string; position?: number };

/** The lists a list PATCH started from (race audit 16 Oct 2026, M6): with them the server merges the edit
 *  into the deal as it is NOW — a cost line or link someone else added meanwhile stays. */
export type PipelineListBases = { costsBase?: readonly PipelineCostItem[]; linksBase?: readonly PipelineLink[] };

/** The fields a PATCH may carry (and `position`). */
export type PipelineDealPatch = Partial<Omit<PipelineDeal,
  "id" | "projectId" | "code" | "bd" | "pm" | "executionProjectId" | "executionProject" | "executionCalendarProjectId" | "executionCalendarProject" | "executionFolderId" | "executionFolder" | "createdAt" | "createdBy" | "updatedAt" | "updatedBy" | "stageGroup" | "daysOverdue" | "health" | "phases" | "terms" | "termSummary" | "costTotal" | "margin" | "marginPct" | "cashback" | "cashbackTotal" | "contacts" | "budgets" | "budgetTotal" | "eventYear" | "source">>;

export type PipelineResponse = {
  project: { id: string; name: string; type: string; workspaceId: string };
  deals: PipelineDeal[];
  summary: PipelineSummary;
  today: string;
  /** The viewer's level in the board (14 Oct 2026): FULL / EDIT may change deals, COMMENT / VIEW only read.
   *  Older servers omit both (then everyone who reads may write, as before). */
  viewerAccessLevel?: "FULL" | "EDIT" | "COMMENT" | "VIEW";
  canEdit?: boolean;
  /** v8: every year with a deal (newest first). */
  years?: number[];
};

/** A Pipeline board, as All Pipelines lists it (BoD / One Above All only). */
export type PipelineBoardRef = { id: string; name: string; icon: string; color: string; status: string; dealCount: number };

/** GET /api/pipelines/all — read-only, BoD / One Above All only (403 otherwise). */
export type AllPipelinesResponse = {
  workspaceId: string;
  boards: PipelineBoardRef[];
  deals: PipelineDeal[];
  summary: PipelineSummary;
  years: number[];
  year: number | null;
  source: string | null;
  today: string;
  canEdit: false;
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
  update: (projectId: string, dealId: string, payload: PipelineDealPatch & PipelineListBases) =>
    apiFetch<PipelineDeal>(`${base(projectId)}/${encodeURIComponent(dealId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  remove: (projectId: string, dealId: string) =>
    apiFetch<{ success: boolean }>(`${base(projectId)}/${encodeURIComponent(dealId)}`, { method: "DELETE" }),
  /** "Create execution project" on a won deal: a folder with its Master Calendar and Master Task. A deal
   *  that has one gets that one back. */
  createExecution: (projectId: string, dealId: string) =>
    apiFetch<{ projectId: string; calendarProjectId: string | null; folderId: string | null; created: boolean; deal: PipelineDeal }>(`${base(projectId)}/${encodeURIComponent(dealId)}/execution`, { method: "POST" }),
  /** Payment terms (9 Oct 2026). Every answer carries the whole deal: its receivable and health moved. */
  addTerm: (projectId: string, dealId: string, payload: PipelineTermPatch & { clientRequestId?: string }) =>
    apiFetch<{ deal: PipelineDeal; term: PipelineTerm }>(`${base(projectId)}/${encodeURIComponent(dealId)}/terms`, { method: "POST", body: JSON.stringify(payload) }),
  updateTerm: (projectId: string, dealId: string, termId: string, payload: PipelineTermPatch) =>
    apiFetch<{ deal: PipelineDeal; term: PipelineTerm }>(`${base(projectId)}/${encodeURIComponent(dealId)}/terms/${encodeURIComponent(termId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  removeTerm: (projectId: string, dealId: string, termId: string) =>
    apiFetch<{ deal: PipelineDeal }>(`${base(projectId)}/${encodeURIComponent(dealId)}/terms/${encodeURIComponent(termId)}`, { method: "DELETE" }),
  /** Attach a file (9 Oct 2026): the shared chunked transport with target=pipeline; the server adds the
   *  entry to the deal and answers the whole deal. */
  uploadDocument: (projectId: string, dealId: string, file: File, meta: { type: string; label: string }, onProgress: (pct: number) => void, control?: UploadControl) =>
    uploadChunked<{ id: string; document: PipelineLink; deal: PipelineDeal | null }>(
      file,
      { target: "pipeline", projectId, dealId, docType: meta.type, ...(meta.label ? { label: meta.label } : {}) },
      onProgress,
      control,
    ),
  /** Take a document (link or file) off the deal; the file itself stays until the 90-day purge. */
  removeDocument: (projectId: string, dealId: string, docId: string) =>
    apiFetch<{ deal: PipelineDeal }>(`${base(projectId)}/${encodeURIComponent(dealId)}/documents/${encodeURIComponent(docId)}`, { method: "DELETE" }),
  /** `legacyColumns`: the pre-v8 columns only (?columns=legacy) — the web while its 0.1.7 features are hidden. */
  exportXlsx: (projectId: string, lang: "id" | "en", year?: number | null, legacyColumns = false) =>
    downloadFile(`${base(projectId)}/export?lang=${lang}${year ? `&year=${year}` : ""}${legacyColumns ? "&columns=legacy" : ""}`, "pipeline.xlsx"),
  /** Cashback recipients, contacts and budget categories (v8). Every answer carries the whole deal. */
  addItem: (projectId: string, dealId: string, payload: PipelineItemPatch & { kind: PipelineItemKind; clientRequestId?: string }) =>
    apiFetch<{ deal: PipelineDeal }>(`${base(projectId)}/${encodeURIComponent(dealId)}/items`, { method: "POST", body: JSON.stringify(payload) }),
  updateItem: (projectId: string, dealId: string, itemId: string, payload: PipelineItemPatch) =>
    apiFetch<{ deal: PipelineDeal }>(`${base(projectId)}/${encodeURIComponent(dealId)}/items/${encodeURIComponent(itemId)}`, { method: "PATCH", body: JSON.stringify(payload) }),
  removeItem: (projectId: string, dealId: string, itemId: string) =>
    apiFetch<{ deal: PipelineDeal }>(`${base(projectId)}/${encodeURIComponent(dealId)}/items/${encodeURIComponent(itemId)}`, { method: "DELETE" }),
};

/** All Pipelines (v8, owner 21 Oct 2026): BoD / One Above All only — the server answers 403 to anyone else. */
export const allPipelinesApi = {
  boards: () => apiFetch<{ workspaceId: string; boards: PipelineBoardRef[] }>("/api/pipelines/boards"),
  list: () => apiFetch<AllPipelinesResponse>("/api/pipelines/all"),
  exportXlsx: (lang: "id" | "en", opts: { year?: number | null; source?: string | null }) => {
    const q = new URLSearchParams({ lang });
    if (opts.year) q.set("year", String(opts.year));
    if (opts.source) q.set("source", opts.source);
    return downloadFile(`/api/pipelines/all/export?${q.toString()}`, "all-pipelines.xlsx");
  },
};
export const allPipelinesKey = ["nexus", "pipelines", "all"] as const;
export const pipelineBoardsKey = ["nexus", "pipelines", "boards"] as const;

/** A deal's services: the list, or the single `service` from an older server. */
export function servicesOf(d: Pick<PipelineDeal, "service" | "services">): string[] {
  return d.services ?? (d.service ? [d.service] : []);
}

/** Query keys: the list, and one deal's detail (history). Realtime invalidates both by prefix. */
export const pipelineKey = (projectId: string) => ["nexus", "pipeline", projectId] as const;
export const dealKey = (projectId: string, dealId: string) => ["nexus", "pipeline", projectId, "deal", dealId] as const;
