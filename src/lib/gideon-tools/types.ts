import type { User } from "@/generated/prisma/client"
import type { GideonDiffRow } from "@/lib/gideon-runs"

export type Input = Record<string, unknown>

/**
 * What a proposal card shows and stores. `store`: facts resolved now that Apply needs exactly as shown (merged into
 * the proposal's input). `preview`: a long text the card shows in full (a message, a doc section, an announcement).
 */
export type ExtraDescription = {
  summary: string
  diff: GideonDiffRow[]
  projectId?: string | null
  taskId?: string | null
  store?: Record<string, unknown>
  preview?: string | null
  /** Short reply hint for the model ("NOT sent yet …"). */
  note?: string
}

/**
 * An Apply that runs through the person's OWN web session (the proposals route forwards their cookie to this
 * endpoint), so it is literally the request the app would send: every rule, permission check, lock, realtime
 * event and notification of that endpoint applies and nothing is reimplemented. Built only from the stored
 * proposal, never from the model or the Apply body.
 */
export type WebCall = {
  method: "POST" | "PATCH" | "PUT" | "DELETE"
  path: string
  json?: unknown
  /** multipart/form-data fields (endpoints that only read formData, e.g. attendance requests). */
  form?: Record<string, string>
}

export type WebReply = { status: number; ok: boolean; body: Record<string, any> | null } // eslint-disable-line @typescript-eslint/no-explicit-any
export type WebCaller = (c: WebCall) => Promise<WebReply>

/** The endpoint's own refusal text, or a fallback. */
export function webError(r: WebReply, fallback = "Failed"): string {
  const e = r.body?.error
  return typeof e === "string" && e ? e : `${fallback} (${r.status})`
}

export type WebOutcome = { ok: boolean; message?: string | null; link?: string | null; result?: Record<string, unknown> }

export type ExtraTool = {
  /** A read: runs directly as the person (actor-scoped), returns a compact result. */
  read?: (actor: User, input: Input) => Promise<unknown>
  /** A write: check what can be checked now and describe it for the card. */
  describe?: (actor: User, input: Input) => Promise<ExtraDescription>
  /** A write applied in-process as the person (approval "modes" in "don't ask", or Apply via the tools route). */
  apply?: (actor: User, input: Input) => Promise<unknown>
  /**
   * A write applied through the person's own session (proposals route): gets the stored proposal input and `call`,
   * which sends one request to a NEXUS endpoint as the person, and says how it went.
   */
  web?: (input: Input, call: WebCaller) => Promise<WebOutcome>
  /** The human handle for the step row (a name, a title), never an id. */
  stepArg?: (input: Input) => Promise<string | null> | string | null
}
