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
