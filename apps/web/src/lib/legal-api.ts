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
