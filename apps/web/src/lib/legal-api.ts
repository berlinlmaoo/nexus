import { apiFetch } from "@/lib/nexus-api";

/**
 * The Legal API (owner, 14 Oct 2026): invitation-only document assembly + archive. Every route answers 403
 * (code LEGAL_NOT_INVITED) for someone who was not invited. Server: src/lib/legal/*.
 */

export type LegalPerson = { id: string; name: string; avatar: string | null };
export type InvitePower = "ANY" | "STAFF" | "NONE";

export type LegalMe = { access: true; isRoot: boolean; invitePower: InvitePower };

export type LegalMember = {
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  orgRole: string | null;
  isRoot: boolean;
  active: boolean;
  invitedAt: string | null;
  invitedBy: LegalPerson | null;
  revokedAt: string | null;
  revokedBy: LegalPerson | null;
  canRevoke: boolean;
  invitePower: InvitePower;
};

export type LegalInviteCandidate = { userId: string; name: string; email: string; avatar: string | null; orgRole: string };

export const legalApi = {
  me: () => apiFetch<LegalMe>("/api/legal/me"),

  members: () => apiFetch<{ members: LegalMember[]; invitePower: InvitePower }>("/api/legal/members"),
  inviteCandidates: (q: string) =>
    apiFetch<{ candidates: LegalInviteCandidate[] }>(`/api/legal/members/candidates?q=${encodeURIComponent(q)}`),
  invite: (userId: string) =>
    apiFetch<{ ok: true; userId: string }>("/api/legal/members", { method: "POST", body: JSON.stringify({ userId }) }),
  revoke: (userId: string) =>
    apiFetch<{ ok: true }>(`/api/legal/members/${encodeURIComponent(userId)}`, { method: "DELETE" }),
};

// ── Companies & numbering series ──
export type LegalSeries = { id: string; key: string; docType: string; label: string; format: string; resetPeriod: "YEAR" | "MONTH"; active: boolean };
export type LegalCompany = {
  id: string;
  code: string;
  name: string;
  legalName: string;
  address: string;
  hasKop: boolean;
  kopFileName: string | null;
  kopUpdatedAt: string | null;
  active: boolean;
  documentCount: number;
  series: LegalSeries[];
};

// ── Templates ──
export const LEGAL_DOC_TYPES = ["SURAT", "SP", "SK", "PKS", "SPK", "NDA", "MOU", "INVOICE", "PJM", "PGB", "OTHER"] as const;
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];

export type FieldType = "text" | "longtext" | "date" | "number" | "money" | "select" | "boolean" | "list";
export type TemplateField = {
  name: string;
  label: string;
  type: FieldType;
  required: boolean;
  help?: string;
  options?: string[];
  columns?: TemplateField[];
};

export type LegalTemplateVersion = { version: number; fileName: string; size: number; note: string; fieldCount: number; createdBy: LegalPerson | null; createdAt: string };
export type LegalTemplate = {
  id: string;
  name: string;
  description: string;
  docType: LegalDocType;
  company: { id: string; code: string; name: string } | null;
  series: { id: string; key: string; label: string; format: string } | null;
  currentVersion: number;
  archived: boolean;
  fields: TemplateField[];
  createdBy: LegalPerson | null;
  createdAt: string;
  updatedAt: string;
  versions: LegalTemplateVersion[];
};

/** A 422 from a template upload carries one line per problem in the file. */
export function templateProblems(error: unknown): string[] {
  const payload = (error as { payload?: { problems?: unknown } })?.payload;
  return Array.isArray(payload?.problems) ? payload.problems.map(String) : [];
}

export const legalTemplatesApi = {
  companies: () => apiFetch<{ companies: LegalCompany[] }>("/api/legal/companies"),
  list: (opts: { archived?: boolean; docType?: string; companyId?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.archived) qs.set("archived", "1");
    if (opts.docType) qs.set("docType", opts.docType);
    if (opts.companyId) qs.set("companyId", opts.companyId);
    const s = qs.toString();
    return apiFetch<{ templates: LegalTemplate[] }>(`/api/legal/templates${s ? `?${s}` : ""}`);
  },
  get: (id: string) => apiFetch<{ template: LegalTemplate }>(`/api/legal/templates/${encodeURIComponent(id)}`),
  create: (input: { file: File; name: string; docType: string; companyId?: string | null; seriesId?: string | null; description?: string }) => {
    const fd = new FormData();
    fd.set("file", input.file);
    fd.set("name", input.name);
    fd.set("docType", input.docType);
    if (input.companyId) fd.set("companyId", input.companyId);
    if (input.seriesId) fd.set("seriesId", input.seriesId);
    if (input.description) fd.set("description", input.description);
    return apiFetch<{ template: LegalTemplate }>("/api/legal/templates", { method: "POST", body: fd });
  },
  update: (id: string, patch: Partial<{ name: string; description: string; docType: string; companyId: string | null; seriesId: string | null; archived: boolean; fields: TemplateField[] }>) =>
    apiFetch<{ template: LegalTemplate }>(`/api/legal/templates/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  addVersion: (id: string, file: File, note: string) => {
    const fd = new FormData();
    fd.set("file", file);
    if (note) fd.set("note", note);
    return apiFetch<{ template: LegalTemplate }>(`/api/legal/templates/${encodeURIComponent(id)}/versions`, { method: "POST", body: fd });
  },
  fileUrl: (id: string, version: number) => `/api/legal/templates/${encodeURIComponent(id)}/versions/${version}/file`,
};

// ── Documents ──
export const LEGAL_STATUSES = ["DRAFT", "FINAL", "SENT", "SIGNED", "VOID"] as const;
export type LegalStatus = (typeof LEGAL_STATUSES)[number];

export type LegalDocumentSummary = {
  id: string;
  number: string;
  docType: LegalDocType;
  title: string;
  counterparty: string;
  /** YYYY-MM-DD */
  docDate: string | null;
  status: LegalStatus;
  source: "GENERATED" | "UPLOADED";
  company: { id: string; code: string; name: string };
  project: { id: string; name: string } | null;
  deal: { id: string; code: string; name: string; projectId: string } | null;
  currentVersion: number;
  createdBy: LegalPerson | null;
  createdAt: string;
  updatedAt: string;
};

export type LegalDocumentVersion = {
  version: number;
  kind: "GENERATED" | "MANUAL" | "GIDEON" | "UPLOAD" | "RESTORE";
  fileName: string;
  mimeType: string;
  size: number;
  hasDocx: boolean;
  hasPdf: boolean;
  hasFile: boolean;
  note: string;
  changes: unknown;
  author: LegalPerson | null;
  createdAt: string;
};

export type LegalDocument = LegalDocumentSummary & {
  notes: string;
  series: { id: string; key: string; label: string } | null;
  template: { id: string; name: string; version: number } | null;
  fieldValues: Record<string, unknown>;
  finalVersion: number | null;
  hasNumber: boolean;
  updatedBy: LegalPerson | null;
  versions: LegalDocumentVersion[];
};

export type PreparedDocument = {
  template: { id: string; name: string; docType: LegalDocType; version: number };
  company: { id: string; code: string; name: string; hasKop: boolean };
  series: { id: string; key: string; label: string; format: string; resetPeriod: "YEAR" | "MONTH" };
  fields: TemplateField[];
  numberPreview: string;
};

export type ArchiveQuery = {
  q?: string; companyId?: string; docType?: string; status?: string; source?: string;
  projectId?: string; dealId?: string; from?: string; to?: string; sort?: string; page?: number; limit?: number;
};

/** A 422 from generating carries `fieldErrors` by field name ("ROWS.0.CELL" for a table cell). */
export function fieldErrorsOf(error: unknown): Record<string, string> {
  const payload = (error as { payload?: { fieldErrors?: unknown } })?.payload;
  return payload?.fieldErrors && typeof payload.fieldErrors === "object" ? (payload.fieldErrors as Record<string, string>) : {};
}

const docUrl = (id: string) => `/api/legal/documents/${encodeURIComponent(id)}`;

export const legalDocsApi = {
  list: (q: ArchiveQuery) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== "") qs.set(k, String(v));
    return apiFetch<{ documents: LegalDocumentSummary[]; total: number; page: number; pageSize: number }>(`/api/legal/documents?${qs}`);
  },
  get: (id: string) => apiFetch<{ document: LegalDocument }>(docUrl(id)),
  prepare: (input: { templateId: string; companyId?: string | null; values?: Record<string, unknown> }) =>
    apiFetch<PreparedDocument>("/api/legal/documents/prepare", { method: "POST", body: JSON.stringify(input) }),
  generate: (input: { templateId: string; companyId?: string | null; values: Record<string, unknown>; title?: string; counterparty?: string; projectId?: string | null; dealId?: string | null }) =>
    apiFetch<{ id: string; number: string; pdfError: string | null }>("/api/legal/documents", { method: "POST", body: JSON.stringify(input) }),
  update: (id: string, patch: Partial<{ title: string; counterparty: string; status: LegalStatus; notes: string; projectId: string | null; dealId: string | null; finalVersion: number | null; number: string; docType: string; docDate: string | null }>) =>
    apiFetch<{ document: LegalDocument }>(docUrl(id), { method: "PATCH", body: JSON.stringify(patch) }),
  remove: (id: string) => apiFetch<{ ok: true }>(docUrl(id), { method: "DELETE" }),
  fileUrl: (id: string, version: number, format: "docx" | "pdf" | "original", inline = false) =>
    `${docUrl(id)}/versions/${version}/file?format=${format}${inline ? "&inline=1" : ""}`,
  makePdf: (id: string, version: number) => apiFetch<{ ok: true }>(`${docUrl(id)}/versions/${version}/pdf`, { method: "POST" }),
};

// ── Settings ──
export const legalSettingsApi = {
  updateCompany: (id: string, patch: Partial<{ name: string; legalName: string; address: string; code: string; active: boolean }>) =>
    apiFetch<{ company: LegalCompany }>(`/api/legal/companies/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  uploadKop: (id: string, file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    return apiFetch<{ company: LegalCompany }>(`/api/legal/companies/${encodeURIComponent(id)}/kop`, { method: "POST", body: fd });
  },
  kopUrl: (id: string) => `/api/legal/companies/${encodeURIComponent(id)}/kop`,
  addSeries: (companyId: string, input: { docType: string; label: string; format: string; resetPeriod: "YEAR" | "MONTH" }) =>
    apiFetch<{ series: LegalSeries }>(`/api/legal/companies/${encodeURIComponent(companyId)}/series`, { method: "POST", body: JSON.stringify(input) }),
  series: (id: string) => apiFetch<{ series: LegalSeries; issued: number; next: string }>(`/api/legal/series/${encodeURIComponent(id)}`),
  updateSeries: (id: string, patch: Partial<{ label: string; format: string; resetPeriod: "YEAR" | "MONTH"; active: boolean }>) =>
    apiFetch<{ series: LegalSeries }>(`/api/legal/series/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
};

export const legalUploadApi = {
  upload: (input: { file: File; companyId: string; docType: string; title: string; number?: string; counterparty?: string; docDate?: string; status?: LegalStatus; notes?: string; projectId?: string | null; dealId?: string | null }) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(input)) if (v !== undefined && v !== null && v !== "") fd.set(k, v as string | Blob);
    return apiFetch<{ id: string; pdfError: string | null }>("/api/legal/documents/upload", { method: "POST", body: fd });
  },
};

// ── Review & versions ──
export type DocParagraph = { index: number; text: string; editable: boolean; lockReason?: "number" | "complex"; style?: string; inTable: boolean };
export type DiffSegment = { type: "same" | "del" | "ins"; text: string };
export type ParagraphDiff =
  | { type: "same"; a: number; b: number; text: string }
  | { type: "removed"; a: number; text: string }
  | { type: "added"; b: number; text: string }
  | { type: "changed"; a: number; b: number; before: string; after: string; segments: DiffSegment[] };

export const legalVersionsApi = {
  paragraphs: (id: string, version?: number) =>
    apiFetch<{ version: number; current: number; paragraphs: DocParagraph[] }>(`${docUrl(id)}/paragraphs${version ? `?version=${version}` : ""}`),
  saveEdits: (id: string, baseVersion: number, edits: { index: number; text: string }[], note: string) =>
    apiFetch<{ version: number; pdfError: string | null }>(`${docUrl(id)}/versions`, { method: "POST", body: JSON.stringify({ baseVersion, edits, note }) }),
  uploadVersion: (id: string, baseVersion: number, file: File, note: string, status?: LegalStatus) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("baseVersion", String(baseVersion));
    if (note) fd.set("note", note);
    if (status) fd.set("status", status);
    return apiFetch<{ version: number; pdfError: string | null }>(`${docUrl(id)}/versions`, { method: "POST", body: fd });
  },
  restore: (id: string, version: number, baseVersion: number) =>
    apiFetch<{ version: number }>(`${docUrl(id)}/versions/${version}/restore`, { method: "POST", body: JSON.stringify({ baseVersion }) }),
  compare: (id: string, a: number, b: number) => apiFetch<{ a: number; b: number; diff: ParagraphDiff[] }>(`${docUrl(id)}/compare?a=${a}&b=${b}`),
};

// ── GIDEON precise edit ──
export type LegalProposal = {
  id: string;
  status: "PENDING" | "CLARIFY" | "APPLYING" | "APPLIED" | "DISCARDED" | "FAILED";
  baseVersion: number;
  instruction: string;
  question: string | null;
  summary: string;
  changes: { index: number; before: string; after: string; segments: DiffSegment[] }[];
  appliedVersion: number | null;
  createdBy: LegalPerson | null;
  decidedBy: LegalPerson | null;
  decidedAt: string | null;
  createdAt: string;
};

export const legalGideonApi = {
  list: (id: string) => apiFetch<{ proposals: LegalProposal[] }>(`${docUrl(id)}/gideon`),
  ask: (id: string, input: { baseVersion: number; instruction: string; targets: number[]; replyTo?: string; answer?: string }) =>
    apiFetch<{ proposal: LegalProposal }>(`${docUrl(id)}/gideon`, { method: "POST", body: JSON.stringify(input) }),
  decide: (id: string, proposalId: string, decision: "approve" | "discard", indexes?: number[]) =>
    apiFetch<{ proposal: LegalProposal; version: number | null; pdfError: string | null }>(`${docUrl(id)}/proposals/${encodeURIComponent(proposalId)}`, { method: "POST", body: JSON.stringify({ decision, indexes }) }),
};

export type LegalLinkResults = {
  projects: { id: string; name: string }[];
  deals: { id: string; code: string; name: string; brand: string; projectId: string }[];
};
export const legalLinksApi = {
  search: (q: string) => apiFetch<LegalLinkResults>(`/api/legal/links?q=${encodeURIComponent(q)}`),
};
