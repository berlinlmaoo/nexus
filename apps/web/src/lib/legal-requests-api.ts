import { apiFetch } from "@/lib/nexus-api";
import type { LegalPerson, TemplateField } from "@/lib/legal-api";

/**
 * Legal requests (owner, 14 Oct 2026). Two sides:
 *   - the requester: the form behind a link (/f/legal-<token>), and their own requests in My Submissions
 *     (/api/legal-requests/*, any signed-in person, only their own);
 *   - Legal: the board and the links (/api/legal/requests, /api/legal/request-links; invited members only).
 * Contract: docs/legal-api.md "Requests".
 */

/** "/f/legal-<24 letters/digits>" is a Legal request link; anything else under /f/ is a form. */
export const isLegalLinkId = (id: string) => /^legal-[A-Za-z0-9]{24}$/.test(id);

export type RequestStage = "RECEIVED" | "IN_PROGRESS" | "REVISION" | "FINAL" | "SIGNED" | "DONE" | "REJECTED";
export type RequestColumn = "TODO" | "IN_PROGRESS" | "DONE";
export const REQUEST_COLUMNS: RequestColumn[] = ["TODO", "IN_PROGRESS", "DONE"];

export type RequestFormTemplate = {
  id: string;
  name: string;
  description: string;
  docType: string;
  companyId: string | null;
  isAddendum: boolean;
  /** The template's fields, all optional for the requester. */
  fields: TemplateField[];
};

export type RequestFormInfo = {
  link: { company: { id: string; name: string } | null; accepting: boolean };
  signedIn: boolean;
  companies?: { id: string; code: string; name: string }[];
  templates?: RequestFormTemplate[];
};

export type RequestAttachment = { id: string; fileName: string; mimeType: string; size: number };

export type MyLegalRequest = {
  id: string;
  createdAt: string;
  updatedAt: string;
  company: { id: string; name: string };
  templateName: string;
  docType: string;
  isAddendum: boolean;
  parentNumberText: string;
  /** YYYY-MM-DD */
  deadline: string | null;
  stage: RequestStage;
  rejectReason: string | null;
  pic: LegalPerson | null;
  /** The document this request produced (only that one). */
  document: { number: string; title: string; status: string } | null;
  canDownload: boolean;
  purpose: string;
  attachments: RequestAttachment[];
  project: { id: string; name: string } | null;
  deal: { id: string; code: string; name: string } | null;
  answers?: { name: string; label: string; type: string; value: unknown; columns?: { name: string; label: string; type: string }[] }[];
};

export type BoardRequest = {
  id: string;
  createdAt: string;
  updatedAt: string;
  requester: LegalPerson | null;
  company: { id: string; code: string; name: string };
  templateId: string | null;
  templateName: string;
  docType: string;
  isAddendum: boolean;
  parentNumberText: string;
  parent: { id: string; number?: string; title?: string; status?: string; docType?: string } | null;
  deadline: string | null;
  column: RequestColumn;
  stage: RequestStage;
  rejected: boolean;
  rejectedAt: string | null;
  rejectReason: string;
  pic: LegalPerson | null;
  document: { id: string; number: string; title: string; status: string; docType: string; signedAt: string | null } | null;
  doneAt: string | null;
  purpose: string;
  attachments: RequestAttachment[];
  project: { id: string; name: string } | null;
  deal: { id: string; code: string; name: string; projectId: string } | null;
  linkHidden?: boolean;
  fieldValues?: Record<string, unknown>;
  fields?: TemplateField[];
};

export type RequestPrefill = {
  requestId: string;
  templateId: string | null;
  companyId: string;
  isAddendum: boolean;
  parentDocumentId: string | null;
  values: Record<string, unknown>;
  projectId: string | null;
  dealId: string | null;
};

export type RequestLink = {
  scope: string;
  company: { id: string; code: string; name: string } | null;
  /** "/f/legal-<token>" */
  path: string;
  accepting: boolean;
  rotatedAt: string | null;
  updatedAt: string;
};

export type BoardQuery = { docType?: string; companyId?: string; picId?: string; deadline?: string; q?: string; column?: string };

const enc = encodeURIComponent;

export const legalRequestsApi = {
  // ── Requester ──
  form: (linkId: string) => apiFetch<RequestFormInfo>(`/api/legal-requests/form/${enc(linkId)}`),
  send: (linkId: string, input: Record<string, unknown>, files: File[], idempotencyKey: string) => {
    const fd = new FormData();
    fd.set("data", JSON.stringify(input));
    for (const f of files) fd.append("file", f);
    return apiFetch<{ ok: true; id: string }>(`/api/legal-requests/form/${enc(linkId)}`, { method: "POST", body: fd, headers: { "Idempotency-Key": idempotencyKey } });
  },
  links: (q: string) => apiFetch<{ projects: { id: string; name: string }[]; deals: { id: string; code: string; name: string; brand: string; projectId: string }[] }>(`/api/legal-requests/links?q=${enc(q)}`),
  mine: () => apiFetch<{ requests: MyLegalRequest[] }>("/api/legal-requests/mine"),
  mineOne: (id: string) => apiFetch<{ request: MyLegalRequest }>(`/api/legal-requests/mine/${enc(id)}`),
  mineFileUrl: (id: string, opts: { inline?: boolean; docx?: boolean } = {}) =>
    `/api/legal-requests/mine/${enc(id)}/file${opts.docx ? "?format=docx" : opts.inline ? "?inline=1" : ""}`,
  mineAttachmentUrl: (id: string, attachmentId: string) => `/api/legal-requests/mine/${enc(id)}/attachments/${enc(attachmentId)}`,

  // ── Legal ──
  board: (q: BoardQuery) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v) qs.set(k, v);
    return apiFetch<{ requests: BoardRequest[] }>(`/api/legal/requests${qs.toString() ? `?${qs}` : ""}`);
  },
  get: (id: string) => apiFetch<{ request: BoardRequest; prefill: RequestPrefill }>(`/api/legal/requests/${enc(id)}`),
  update: (id: string, patch: Partial<{ column: RequestColumn; picId: string | null; parentDocumentId: string | null }>) =>
    apiFetch<{ request: BoardRequest }>(`/api/legal/requests/${enc(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  reject: (id: string, reason: string) =>
    apiFetch<{ request: BoardRequest }>(`/api/legal/requests/${enc(id)}/reject`, { method: "POST", body: JSON.stringify({ reason }) }),
  attachmentUrl: (id: string, attachmentId: string) => `/api/legal/requests/${enc(id)}/attachments/${enc(attachmentId)}`,
  requestLinks: () => apiFetch<{ links: RequestLink[] }>("/api/legal/request-links"),
  setAccepting: (scope: string, accepting: boolean) =>
    apiFetch<{ link: RequestLink }>(`/api/legal/request-links/${enc(scope)}`, { method: "PATCH", body: JSON.stringify({ accepting }) }),
  regenerate: (scope: string) => apiFetch<{ link: RequestLink }>(`/api/legal/request-links/${enc(scope)}/regenerate`, { method: "POST" }),
};
