import { NextResponse } from "next/server"

/**
 * A client's key for one submit (race audit 16 Oct 2026): the body field `clientRequestId`, else the
 * `Idempotency-Key` header. Absent = null, which is what every released app sends — the route then keeps
 * its keyless behaviour. Present but malformed = 400, so a client bug is seen instead of silently losing
 * the guarantee. Same rule as the attendance request form (api/attendance/requests).
 */
export const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9._:-]{8,200}$/

export function readIdempotencyKey(
  request: Request | undefined,
  fromBody: unknown,
): { ok: true; key: string | null } | { ok: false; response: NextResponse } {
  const raw = (typeof fromBody === "string" && fromBody.trim() ? fromBody : request?.headers.get("idempotency-key") ?? "").trim()
  if (!raw) return { ok: true, key: null }
  if (!CLIENT_REQUEST_ID_RE.test(raw)) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Idempotency key must be 8–200 characters of letters, digits, . _ : -", code: "BAD_IDEMPOTENCY_KEY" },
        { status: 400 },
      ),
    }
  }
  return { ok: true, key: raw }
}

/** How long a keyless repeat of the very same submit by the same person counts as a double tap. */
export const DOUBLE_TAP_MS = 10_000
