/**
 * The person on a task card, a project member row or a task's creator, as list payloads send it
 * (perf pass, 12 Oct 2026). `include: { user: true }` sent every User column to every project member —
 * phone number, WhatsApp id, Google Workspace email, session version, timestamps — about 500 bytes per
 * assignee, a quarter of a big project's payload, and more about colleagues than a board should carry.
 *
 * Kept: everything a client reads from these objects. The released iOS/Android apps decode
 * {id, name, email, avatar} (UserRef / AppUser, all optional); the web also reads deactivatedAt (the
 * "Left" tag) and role. Anything else stays available from the endpoints made for it (profile, admin).
 */
export const USER_CARD_SELECT = {
  id: true,
  name: true,
  email: true,
  avatar: true,
  role: true,
  deactivatedAt: true,
} as const
