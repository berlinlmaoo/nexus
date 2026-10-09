import { getLang } from "@/lib/lang";
import type { CalItem, CalItemsResponse, CalRules, CalStructure } from "@/lib/calendar/core";

export type NexusUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  /** Company Google account a BoD linked in Control Room. null is normal — most people have none. */
  googleWorkspaceEmail?: string | null;
  phoneNumber?: string | null;
  role?: string | null;
  onboardedAt?: string | null;
  /** Set when the person was offboarded (left the company). Task detail marks them "Left". */
  deactivatedAt?: string | null;
};

// --- Z Vault ---
export type VaultPerson = { id: string; name: string; avatar?: string | null };
export type VaultItem = {
  id: string;
  kind: "FOLDER" | "FILE";
  name: string;
  position: number;
  icon: string | null;
  color: string | null;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  parentId: string | null;
  /** Always an item URL, never a path. The vault has no client-visible storage layout. */
  url: string | null;
  downloadUrl: string | null;
  /** `/api/vault/items/<id>/thumb?v=…` for a picture the server can shrink; add `&w=`. Absent from
   *  servers before 9 Oct 2026, and null for everything that is not such a picture. */
  thumbUrl?: string | null;
  uploader: VaultPerson | null;
  owner: VaultPerson | null;
  childCount: number;
  shareCount: number;
  minReadRole: string | null;
  minWriteRole: string | null;
  trashed: boolean;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  canModify: boolean;
  /** Content version carried in `url`/`thumbUrl` as `?v=`; changes on Replace file… (since 9 Oct 2026). */
  fileVersion?: string | null;
  /** Search results only: the folders it sits in, from the top, without the item (since 9 Oct 2026). */
  path?: { id: string; name: string }[];
};
export type VaultListing = {
  items: VaultItem[];
  breadcrumb: { id: string; name: string }[];
  parentId: string | null;
  canWrite: boolean;
  canManageAccess: boolean;
  quota: { usedBytes: number; totalBytes: number };
};
export type VaultShareExpiry = "3d" | "7d" | "14d" | "30d" | "permanent";
export type VaultShare = {
  id: string;
  slug: string;
  itemId: string;
  url: string;
  requireAuth: boolean;
  allowDownload: boolean;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "expired" | "revoked";
  viewCount: number;
  lastViewedAt: string | null;
  createdAt: string;
  createdBy: { id: string; name: string | null } | null;
  /** Whether this viewer may revoke it (its maker, the item's owner, BoD). Absent from older servers. */
  canRevoke?: boolean;
};
/** What a picture/film/sound/PDF behind a link can be shown as; null = nothing a browser can show. */
export type VaultPreviewKind = "image" | "video" | "audio" | "pdf";
/** One file or folder as a share link's page sees it (since 9 Oct 2026). Every URL points back at the link. */
export type VaultPublicItem = {
  id: string;
  kind: "FILE" | "FOLDER";
  name: string;
  mimeType: string | null;
  size: number | null;
  width: number | null;
  height: number | null;
  childCount: number;
  previewKind: VaultPreviewKind | null;
  /** Null on a view-only link for a file nothing can preview. */
  previewUrl: string | null;
  downloadUrl: string | null;
  thumbUrl: string | null;
  fileVersion: string | null;
};
export type VaultPublicFile = {
  slug: string;
  /** "FOLDER" since 9 Oct 2026; absent (a file) from older servers. */
  kind?: "FILE" | "FOLDER";
  requireAuth: boolean;
  allowDownload: boolean;
  expiresAt?: string | null;
  sharedBy?: { name: string } | null;
  file: { name: string; mimeType: string | null; size: number | null; width: number | null; height: number | null };
  previewUrl: string;
  downloadUrl: string | null;
  previewKind?: VaultPreviewKind | null;
  thumbUrl?: string | null;
  item?: VaultPublicItem;
  folder?: { id: string; name: string } | null;
  zipUrl?: string | null;
};
export type VaultPublicListing = {
  folder: { id: string; name: string };
  /** From the shared folder down to this one — never above what the link opens. */
  breadcrumb: { id: string; name: string }[];
  allowDownload: boolean;
  items: VaultPublicItem[];
};

// --- The Wire (Feed) ---
export type FeedAuthor = { id: string; name: string; avatar?: string | null };
export type FeedImage = { id: string; url: string; width?: number | null; height?: number | null; position: number };
export type FeedMention = { userId: string; name: string | null };
export type FeedPost = {
  id: string;
  text: string;
  createdAt: string;
  editedAt?: string | null;
  likeCount: number;
  commentCount: number;
  author: FeedAuthor;
  images: FeedImage[];
  mentions: FeedMention[];
  likedByMe: boolean;
  canDelete: boolean;
  canEdit: boolean;
};
export type FeedPage = { posts: FeedPost[]; nextCursor: string | null; hasMore: boolean };
export type FeedComment = { id: string; text: string; createdAt: string; author: FeedAuthor };

// --- Integrity (Peer Reports / "cepu") — BoD-and-above beta ---
export type PeerReportUser = { id: string; name: string; avatar?: string | null };
export type PeerReportStatus = "PENDING" | "VERIFIED" | "REJECTED" | "WITHDRAWN";
export type PeerReport = {
  id: string;
  category: string;
  reason: string | null;
  evidenceUrl: string | null;
  status: PeerReportStatus;
  rebuttal: string | null;
  rebuttalAt: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  reportedPenaltyXp: number;
  xpApplied: boolean;
  createdAt: string;
  reporter: PeerReportUser | null;   // null when anonymized (non-BoD viewer)
  reporterHidden: boolean;
  reportedUser: PeerReportUser;
  reviewer: { id: string; name: string } | null;
  isMine: boolean;
  isAgainstMe: boolean;
  canDecide: boolean;
  canWithdraw: boolean;
  canRebut: boolean;
};
export type PeerReportList = { reports: PeerReport[]; counts: Record<string, number>; viewerIsBod: boolean };
export type HallOfShameEntry = { id: string; category: string; at: string; reportedUser: PeerReportUser };
export type HallOfShameOffender = { user: PeerReportUser; count: number };
export type HallOfShame = { entries: HallOfShameEntry[]; offenders: HallOfShameOffender[] };

// --- Project spreadsheet ---
export type NexusSheetColumnType = "text" | "number" | "currency" | "date" | "select" | "multiselect" | "checkbox" | "task" | "link";
export type NexusSheetRuleOp = "gt" | "lt" | "gte" | "lte" | "eq" | "neq" | "contains" | "empty" | "notEmpty";
export type NexusSheetRuleStyle = "red" | "amber" | "green" | "blue" | "grey" | "bold";
export type NexusSheetRule = { op: NexusSheetRuleOp; value?: string; style: NexusSheetRuleStyle };
export type NexusSheetComment = {
  id: string; rowId: string; columnId: string; body: string;
  resolvedAt: string | null; createdAt: string; authorId: string;
  author: { id: string; name: string | null; avatar: string | null };
};
/** One cell change, written by the `sheet_row_revisions` Postgres trigger — never by the app. */
export type NexusSheetRevision = {
  id: string; rowId: string; columnId: string;
  oldValue: NexusSheetCellValue | null; newValue: NexusSheetCellValue | null;
  createdAt: string;
  /** Null when the person who made the edit has since been deleted (the FK is SET NULL). */
  author: { id: string; name: string | null; avatar: string | null } | null;
};
export type NexusSheetColumnColor = "rose" | "amber" | "green" | "blue" | "violet" | "slate";
export type NexusSheetColumn = {
  id: string; name: string; type: NexusSheetColumnType;
  width?: number; options?: string[];
  /** Header tint; undefined = the default grey header. */
  color?: NexusSheetColumnColor;
  /** Per-choice chip colours, keyed by the choice itself. */
  optionColors?: Record<string, NexusSheetColumnColor>;
  rules?: NexusSheetRule[];
};
/** A clickable cell: `u` is the URL, `t` the label rendered in its place. */
export type NexusSheetLink = { t: string; u: string };
export type NexusSheetCellValue = string | number | boolean;
export type NexusSheetRow = {
  id: string; position: number; cells: Record<string, NexusSheetCellValue>;
  /** Pixels; null means the grid's default. */
  height: number | null;
  updatedAt: string;
};
export type NexusSheet = {
  id: string; projectId: string; name: string;
  columns: NexusSheetColumn[];
  rows: NexusSheetRow[];
  /** Resolved server-side — never re-derive role rules in the client. */
  canEdit: boolean;
  canManage: boolean;
};

// --- Complaint & Escalation channel ---
// AWAITING_DECISION ("Menunggu keputusan") = GIDEON has answered, and/or an attendance correction is
// sitting on the ticket undecided. It is NOT IN_REVIEW: nobody has taken the ticket on yet, so it is
// still in the BoD work queue and the inbox filter asks for it by name (see complaints.tsx). A
// status no query includes is a ticket nobody sees.
export type ComplaintStatusKey = "OPEN" | "AWAITING_DECISION" | "IN_REVIEW" | "RESOLVED" | "CLOSED";
export type ComplaintPerson = { id: string; name: string; avatar: string | null };
export type ComplaintAttachment = { id: string; url: string; mimeType: string; size: number };
export type Complaint = {
  id: string;
  category: string;
  subject: string;
  evidenceUrl: string | null;        // legacy single photo = attachments[0]; prefer `attachments`
  attachments: ComplaintAttachment[];
  status: ComplaintStatusKey;
  lastMessageAt: string;
  resolvedAt: string | null;
  createdAt: string;
  reporter: ComplaintPerson | null;   // null only for a non-reporter non-BoD viewer (who can't open it)
  messageCount: number;
  /** GIDEON has written in this thread. Deliberately independent of `status`: a ticket a director
   *  already took on (IN_REVIEW) still needs to show it. Derived server-side in the list query. */
  gideonReplied: boolean;
  /** An attendance correction on this ticket is still PENDING — a tap is waiting on a BoD. At most
   *  one is ever live per ticket, which is why this is a boolean and not a count. */
  pendingCorrection: boolean;
  isMine: boolean;
  canReply: boolean;
  canManage: boolean;                  // BoD: can change status
};
export type ComplaintMessage = {
  id: string;
  body: string;
  fromReviewer: boolean;
  /** Written by GIDEON, not by a person. Reviewer replies are otherwise anonymised to "BoD". */
  fromGideon?: boolean;               // true = BoD side, false = reporter side
  createdAt: string;
  author: ComplaintPerson | null;
  mine: boolean;
};
// --- Attendance correction proposed on a ticket ---
// A proposal only; nothing about attendance moves until a BoD decides it at
// POST /api/complaints/[id]/correction — that route is the only writer of the AttendanceRecord.
export type AttendanceCorrectionStatus = "PENDING" | "APPROVED" | "REJECTED";
/**
 * Which remedy the proposal asks for. Two kinds on ONE model so a ticket can only ever carry one live
 * proposal, decided on one card:
 *   TIME_CORRECTION      — the recorded times are wrong; approval rewrites the AttendanceRecord.
 *   PENALTY_CANCELLATION — the times are right and the penalty is not: a leave/permit/sick request
 *                          covers the day, or NEXUS was down. Approval reverses the XP and changes no
 *                          time at all, so the before/after clock the card draws for the other kind
 *                          would be actively misleading here.
 */
export type AttendanceCorrectionKind = "TIME_CORRECTION" | "PENALTY_CANCELLATION";
export type AttendanceCorrection = {
  id: string;
  complaintId: string;
  status: AttendanceCorrectionStatus;
  kind: AttendanceCorrectionKind;
  /** Attendance date key "YYYY-MM-DD" (Asia/Jakarta), not a timestamp — never re-zone it. */
  date: string;
  user: ComplaintPerson;               // whose attendance this would rewrite
  /** null = "leave the recorded time alone", NOT "clear it". Approval merges nulls with the record.
   *  Always null on a PENALTY_CANCELLATION — that is the whole point of that kind. */
  proposedCheckInAt: string | null;
  proposedCheckOutAt: string | null;
  reason: string;
  proposedBy: ComplaintPerson;         // GIDEON, usually
  /** What the record held when the proposal was written — the snapshot the server optimistic-locks on. */
  before: { recordId: string | null; checkInAt: string | null; checkOutAt: string | null; status: string | null };
  /** What the day had actually cost when the proposal was written (negative XP, or 0). The "before"
   *  of a PENALTY_CANCELLATION — the ledger rows are deleted by the refund, so this is the only
   *  surviving record of what approving it undid. */
  beforePenaltyXp: number | null;
  beforeAutoDayOffs: number | null;
  restoredDayOffs: number | null;
  /** Filled in on APPROVE: XP handed back (positive), and whether the pardon was made permanent (a
   *  waiver). Permanent only when nothing else holds the nightly cron off — see resolvePardonPersistence. */
  refundedXp: number | null;
  waiverGranted: boolean;
  decidedBy: ComplaintPerson | null;
  decidedAt: string | null;
  decisionNote: string | null;
  createdAt: string;
  canApprove: boolean;                 // row-level: still PENDING. NOT the viewer's permission.
};
/** `canDecide` is the VIEWER's capability, so a reporter gets the card without the buttons. */
export type AttendanceCorrectionList = { corrections: AttendanceCorrection[]; canDecide: boolean };
export type AttendanceCorrectionDecision = { correction: AttendanceCorrection; record: unknown | null };

export type ComplaintDetail = Complaint & {
  resolvedBy: { id: string; name: string } | null;
  messages: ComplaintMessage[];
  corrections: AttendanceCorrection[];
};
export type ComplaintList = { complaints: Complaint[]; counts: Record<string, number>; viewerIsBod: boolean };

export type NexusDashboardProject = {
  id: string;
  name: string;
  color?: string | null;
  totalTasks?: number;
  completedTasks?: number;
  progress?: number;
};

export type NexusDashboardTask = {
  id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  project?: { id: string; name: string; color?: string | null } | null;
};

export type NexusDashboardResponse = {
  stats?: {
    totalTasks?: number;
    inProgressTasks?: number;
    overdueTasks?: number;
    completedThisWeek?: number;
  };
  tasks?: NexusDashboardTask[];
  projects?: NexusDashboardProject[];
  goals?: Array<{ id: string; title: string; status?: string; progress?: number; owner?: string }>;
  sprints?: Array<{ id: string; name: string; project?: string; projectColor?: string; totalTasks?: number; completedTasks?: number; progress?: number }>;
  activity?: Array<{ id: string; action?: string; details?: string; createdAt?: string; project?: { name?: string } | null; task?: { title?: string } | null }>;
};

export type NexusProjectFolder = {
  id: string;
  name: string;
  icon?: string | null;
  color?: string | null;
  position?: number;
  workspaceId?: string;
  parentFolderId?: string | null;
  aggregateProjectIds?: string[];
};

export type NexusProject = {
  id: string;
  name: string;
  description?: string | null;
  color?: string | null;
  icon?: string | null;
  status?: string | null;
  workspaceId?: string | null;
  folderId?: string | null;
  position?: number;
  totalTasks?: number;
  completedTasks?: number;
  progress?: number;
  // Customize-project settings (shared with core NEXUS — same DB columns).
  enableTaskBatchDuplicate?: boolean;
  autoAssignEnabled?: boolean;
  autoAssignAssigneeIds?: string[];
  enablePnlDashboard?: boolean;
  requireAttachmentForDone?: boolean;
  /** Calendar-only project: hide the done checkbox, status select and Table status column. */
  disableTaskStatus?: boolean;
  tableColumns?: string[] | null;
  /** "TASK" | "FINANCE" | "CONTENT" | "PIPELINE" (9 Oct 2026). Absent on an older server = TASK. */
  type?: string;
  /** Tab keys this project hides (components/projects/project-tabs.ts). Unknown keys are ignored. */
  hiddenTabs?: string[];
  /** The Finance tab is opt-in, like enablePnlDashboard (9 Oct 2026). */
  financeEnabled?: boolean;
  _count?: { members?: number; taskLists?: number; tasks?: number };
  members?: Array<{ userId?: string; role?: string; user?: NexusUser }>;
  taskLists?: Array<{ id: string; name: string; position?: number; tasks?: NexusTask[]; taskProjects?: Array<{ id: string; position?: number; task: NexusTask }> }>;
};

export type NexusAttendanceToday = {
  attendanceDateKey?: string;
  activeOfficeCount?: number;
  canManageAttendance?: boolean;
  canReviewAttendanceRequests?: boolean;
  /** The signed-in user's own id, for hiding self-review controls. */
  viewerId?: string;
  /** Cuti tahunan: eligibility + how many days are left this calendar year. */
  annualLeave?: {
    eligible: boolean;
    reason: string | null;
    employmentStartDate: string | null;
    eligibleFrom: string | null;
    year: number;
    quota: number;
    used: number;
    remaining: number;
  };
  dayOffUsedThisMonth?: number;
  /** This period's allowance: base + extra days granted for it (servers from 28 Sep 2026). */
  dayOffQuota?: number;
  dayOffAllowance?: { period: string; base: number; bonus: number; grants: { days: number; reason: string }[] };
  redDateUsedThisMonth?: number;
  redDateQuota?: number;
  myShift?: { startTime: string; endTime: string; source: string; flexi?: boolean } | null;
  noGeofence?: boolean;
  workspace?: { id: string; name: string } | null;
  today?: {
    id: string;
    status?: string | null;
    attendanceDate?: string | null;
    checkInAt?: string | null;
    checkOutAt?: string | null;
    checkInStatus?: string | null;
    checkOutStatus?: string | null;
    lateMinutes?: number | null;
    workedMinutes?: number | null;
    checkOutOffsite?: boolean | null;
    checkOutApproval?: string | null; // PENDING | APPROVED | REJECTED
    checkOutReason?: string | null;
    checkOutReflection?: string | null;
    checkOutReflectionAt?: string | null;
    officeLocation?: { name?: string | null; radiusMeters?: number | null } | null;
    /** Where the check-in was made (server reverse geocode) — shown instead of the office when away. */
    checkInAddress?: string | null;
    checkInDistanceMeters?: number | null;
    checkInLat?: number | null;
    checkInLng?: number | null;
    /** Checked in outside the office radius (location-free members). Servers from 28 Sep 2026. */
    checkInAway?: boolean | null;
  } | null;
  // A previous day's check-in that was never checked out — must be closed before a new check-in.
  pendingCheckout?: {
    id: string;
    attendanceDate?: string | null;
    checkInAt?: string | null;
    officeLocation?: { name?: string | null; radiusMeters?: number | null } | null;
    checkInAddress?: string | null;
    checkInDistanceMeters?: number | null;
    checkInAway?: boolean | null;
  } | null;
  todayRequest?: {
    id: string;
    type?: string | null;
    status?: string | null;
    reason?: string | null;
  } | null;
};

export type NexusAttendanceHistory = {
  /** Everyone the board lists (workspace scope), rows or not — servers from 28 Sep 2026. */
  roster?: Array<{ id: string; name: string | null; email?: string | null; avatar?: string | null; dayOffQuota?: number }>;
  rows?: Array<{
    id?: string;
    recordKind?: string;
    attendanceDayType?: string;
    attendanceDate?: string;
    notes?: string | null;
    status?: string | null;
    requestType?: "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF" | "RED_DATE" | null;
    requestStatus?: string | null;
    approvalSource?: string | null;
    reviewedAt?: string | null;
    reviewedBy?: { id?: string; name?: string | null; email?: string | null } | null;
    hasSupportingDocument?: boolean;
    supportingDocumentUrl?: string | null;
  submittedLat?: number | null;
  submittedLng?: number | null;
  submittedAddress?: string | null;
  reportDelayMinutes?: number | null;
    supportingDocumentName?: string | null;
    checkInAt?: string | null;
    checkOutAt?: string | null;
    checkInStatus?: string | null;
    checkOutStatus?: string | null;
    workedMinutes?: number | null;
    // Location + selfie evidence (for the attendance detail/audit view).
    checkInLat?: number | null;
    checkInLng?: number | null;
    checkInAddress?: string | null;
    checkInPhotoUrl?: string | null;
    checkInDistanceMeters?: number | null;
    /** Checked in outside the office radius (location-free); null on synthetic rows. 28 Sep 2026+. */
    checkInAway?: boolean | null;
    /** The office the record is filed under (the nearest one at check-in). */
    officeLocation?: { name?: string | null; radiusMeters?: number | null } | null;
    checkOutLat?: number | null;
    checkOutLng?: number | null;
    checkOutAddress?: string | null;
    checkOutPhotoUrl?: string | null;
    checkOutDistanceMeters?: number | null;
    checkOutOffsite?: boolean | null;
    checkOutReason?: string | null;
    checkOutApproval?: string | null;
    checkOutReflection?: string | null;
    checkOutReflectionAt?: string | null;
    // Live location while checked in (0.1.6): "denied" = the phone refused location, "web" = checked
    // in from a browser (never tracked) — either way there is no trail.
    locationTrackingState?: "on" | "denied" | "web" | null;
    checkInClient?: "ios-app" | "web" | "legacy-app" | null;
    // Set while the person is outside the office radius right now (today's record only).
    outsideSince?: string | null;
    user?: NexusUser | null;
  }>;
};

export type NexusTrailPoint = { lat: number; lng: number; accuracy: number | null; at: string; inside: boolean; event: string | null };
/** One office-clock hour of the shift (server: presenceHours in attendance-outside.ts). */
export type NexusPresenceHour = { from: string; to: string; label: string; status: "inside" | "outside" | "unclear" | "pending" | "gap"; at: string | null };
export type NexusAttendanceTrail = {
  record: {
    id: string;
    userId: string;
    userName: string | null;
    date: string;
    checkInAt: string | null;
    checkOutAt: string | null;
    checkOutOffsite: boolean | null;
    locationTrackingState?: "on" | "denied" | "web" | null;
    /** Servers from 28 Sep 2026: checked in away from the office, and the day's place as text. */
    checkInAway?: boolean | null;
    checkInAddress?: string | null;
    placeLabel?: string | null;
    office: { name: string; lat: number; lng: number; radiusMeters: number } | null;
  };
  points: NexusTrailPoint[];
  outsideSpans: { from: string; to: string | null }[];
  /** Hourly presence checks; absent on a server from before them. */
  presence?: NexusPresenceHour[];
};

export type NexusOffice = {
  id: string;
  name: string;
  address?: string | null;
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  timezone?: string;
  shiftStartTime?: string;
  shiftEndTime?: string;
  lateGraceMinutes?: number;
  isActive?: boolean;
};

export type OfficePayload = {
  name: string;
  address?: string | null;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  shiftStartTime?: string;
  shiftEndTime?: string;
  isActive?: boolean;
};

/**
 * The trimmed shape the server sends for a quoted message: enough to draw a preview and no more,
 * so a reply never carries the body of a message the reader can't already see.
 */
export type NexusReplyPreview = {
  id: string;
  content: string;
  /** The quoted picture, for a thumbnail (servers since 8 Oct 2026). */
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  user?: NexusUser | null;
};

/** One person named in a system line ("Bagas added Mey"). */
export type NexusSystemPerson = { id: string; name: string };

/**
 * What a SYSTEM message records (server since 8 Oct 2026). `targets`: the people added or removed (and
 * the leaver for member_left); `name`: the group name (created / renamed); `previousName`: before a rename.
 */
export type NexusSystemEvent = {
  type: "members_added" | "member_removed" | "member_left" | "group_created" | "group_renamed" | string;
  actor: NexusSystemPerson;
  targets?: NexusSystemPerson[];
  name?: string;
  previousName?: string;
};

export type NexusMessage = {
  id: string;
  conversationId?: string;
  userId?: string;
  content: string;
  createdAt?: string | null;
  user?: NexusUser | null;
  /** Set when the message carries a picture. Always a /api/files/chat/ path the server issued. */
  attachmentUrl?: string | null;
  attachmentType?: string | null;
  /** Set when this message replies to another one in the same conversation; null otherwise. */
  replyTo?: NexusReplyPreview | null;
  /**
   * "SYSTEM" for a group's log line ("Bagas added Mey"): drawn as a centred pill from `event`, never
   * replied to, never unread. "USER" (or missing, on servers before 8 Oct 2026) for a person's message.
   */
  kind?: "USER" | "SYSTEM" | string;
  event?: NexusSystemEvent | null;
};

export type NexusConversation = {
  id: string;
  type: "DM" | "GROUP" | "PROJECT";
  name?: string | null;
  projectId?: string | null;
  members?: Array<{ userId?: string; user?: NexusUser | null }>;
  lastMessage?: NexusMessage | null;
  unreadCount?: number;
  /**
   * Until when this member silenced the room (no push except @mentions); null or missing = not muted.
   * "Always" is stored as a far-future date. Servers before the chat contract of 8 Oct 2026 omit it.
   */
  mutedUntil?: string | null;
  /**
   * Whether you may add or remove people here: GROUP rooms only, Manager and above (owner, 8 Oct
   * 2026). Anyone may still leave. Missing = a server from before the rule; keep showing the controls.
   */
  canManageMembers?: boolean;
  /** Group description (≤ 500 characters); only on GET /api/conversations/:id and PATCH. */
  description?: string | null;
};

/** GET /api/conversations/:id/info — the group info screen (server since 8 Oct 2026). */
export type NexusConversationInfo = {
  conversation: {
    id: string;
    type: "DM" | "GROUP" | "PROJECT";
    name: string | null;
    description: string | null;
    projectId: string | null;
    createdAt: string;
    createdBy: { id: string; name: string } | null;
    memberCount: number;
    mutedUntil: string | null;
    /** May add or remove people (GROUP, Manager and above). */
    canManageMembers: boolean;
    /** May change the name and the description (any member of a GROUP). */
    canEdit: boolean;
    /**
     * May delete the group (servers since 9 Oct 2026): canManageMembers, or being its only member left.
     * Missing = a server without DELETE /api/conversations/:id — offer no Delete.
     */
    canDelete?: boolean;
  };
  /** Admins first, then A–Z. */
  members: Array<{ userId: string; name: string; avatar: string | null; isMe: boolean; isAdmin: boolean; deactivatedAt: string | null }>;
  /** Each capped at 999. */
  counts: { photos: number; links: number; docs: number };
};

export type NexusChatMediaType = "photos" | "links" | "docs";

/** One page of GET /api/conversations/:id/media, newest first. */
export type NexusChatMediaPage = {
  items: Array<{
    messageId: string;
    createdAt: string;
    sender: { id: string; name: string };
    url: string;
    attachmentType?: string | null;
    title?: string;
  }>;
  nextCursor: string | null;
};

/** One page of GET /api/conversations/:id/search, newest first. */
export type NexusChatSearchPage = {
  results: Array<{ messageId: string; createdAt: string; sender: { id: string; name: string }; snippet: string }>;
  nextCursor: string | null;
};

/**
 * One page of a conversation's messages, oldest first.
 * `hasMore`: with `before` (or none) = older ones exist; with `after` = newer ones exist.
 * `nextCursor`: pass back as `before` for the page above. Only servers since 8 Oct 2026 send it;
 * older ones paginate on the oldest message's createdAt instead.
 */
export type NexusMessagePage = {
  messages: NexusMessage[];
  hasMore?: boolean;
  nextCursor?: string | null;
  /** `around=` pages only: newer messages exist; `newerCursor` (an id) is the `after` that loads them. */
  hasMoreNewer?: boolean;
  newerCursor?: string | null;
  anchorId?: string;
};

export type NexusXp = {
  totalXp: number;
  level: number;
  levelName?: string;
  floor?: number;
  nextFloor?: number | null;
  pct?: number;
};

export type NexusQuest = {
  key: string;
  title: string;
  description?: string | null;
  progress: number;
  target: number;
  xpReward: number;
  claimable?: boolean;
  claimed?: boolean;
  source?: "auto" | "admin";
  deadline?: string | null;
  kind?: "count" | "tasks"; // "tasks" = a specific-tasks bundle quest
  eligible?: boolean;        // specific_tasks: is the viewer a doer (assignee) who can claim XP
};

export type NexusGamification = {
  xp: NexusXp;
  streak?: { current?: number; longest?: number };
  quests?: NexusQuest[];
};

export type OrgRole = "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF";
export const ORG_ROLE_LABEL: Record<string, string> = { ONE_ABOVE_ALL: "One Above All", BOD: "BoD", MANAGER: "Manager", STAFF: "Staff" };
export const ORG_ROLE_TONE: Record<string, string> = {
  ONE_ABOVE_ALL: "bg-rose-100 text-rose-700",
  BOD: "bg-violet-100 text-violet-700",
  MANAGER: "bg-sky-100 text-sky-700",
  STAFF: "bg-muted text-muted-foreground",
};
export const ORG_HIERARCHY: Record<string, number> = { ONE_ABOVE_ALL: 4, BOD: 3, MANAGER: 2, STAFF: 1 };
export const ORG_ROLES: OrgRole[] = ["ONE_ABOVE_ALL", "BOD", "MANAGER", "STAFF"];
// Roles a viewer of `viewerRole` is allowed to assign (strictly below them; One Above All can assign any).
export function assignableRoles(viewerRole?: string | null): OrgRole[] {
  const t = ORG_HIERARCHY[viewerRole ?? ""] ?? 0;
  if (t < 3) return [];
  return ORG_ROLES.filter((r) => t === 4 || t > ORG_HIERARCHY[r]);
}
// Can the viewer edit a member who currently holds `targetRole`? (not equal/above, unless One Above All)
export function canEditTier(viewerRole: string | null | undefined, targetRole: string | null | undefined): boolean {
  const t = ORG_HIERARCHY[viewerRole ?? ""] ?? 0;
  if (t < 3) return false;
  return t === 4 || ORG_HIERARCHY[targetRole ?? ""] < t;
}

export type NexusWorkspaceMember = {
  id: string;
  userId: string;
  name: string;
  email: string;
  avatar: string | null;
  phoneNumber?: string | null;
  role: string;
  attendanceRole: string;
  attendanceShiftStartTime?: string | null;
  attendanceShiftEndTime?: string | null;
  attendanceShiftByDay?: Record<string, { start: string; end: string }> | null;
  flexiTimeEnabled?: boolean;
  /** Fixed weekly rest days, ISO 1=Mon..7=Sun. Empty = works every office day. */
  restDays?: number[];
  noGeofenceMode?: boolean;
  /** Atasan langsung di Bagan Approval. null = belum ditaruh (request-nya jatuh ke BoD). */
  approverId?: string | null;
  approver?: { id: string; name: string | null; avatar: string | null } | null;
  joinedAt: string;
};

/** Satu orang di Bagan Approval (Control Room). */
export type ApprovalChartPerson = {
  userId: string; memberId: string; name: string | null; email: string; avatar: string | null; role: string; approverId: string | null;
  /** Jam kerja per orang; null = ikut jam kantor/tim. */
  shiftStart?: string | null; shiftEnd?: string | null; flexi?: boolean; mobile?: boolean;
};
/** Rantai bebas: setiap orang punya paling banyak satu atasan (`approverId`), apa pun perannya.
 *  Klien menyusun pohonnya; akar = orang tanpa atasan. */
export type ApprovalChart = {
  workspaceId: string;
  people: ApprovalChartPerson[];
  stats: { total: number; withApprover: number; unassigned: number; bod: number };
};

/** Bagan IP & Divisi (30 Sep 2026): IP/Team units, free depth; a person may be in several units.
 *  Grants nothing — project access stays with direct project invites. */
export type OrgUnit = { id: string; name: string; kind: "IP" | "DIVISION" | "GROUP"; logoUrl: string | null; parentId: string | null; position: number; leadUserId?: string | null; layoutX?: number | null; layoutY?: number | null; boxLayout?: Record<string, { x: number; y: number }> | null };
export type OrgChartPerson = { userId: string; name: string | null; email: string; avatar: string | null; role: string; unitIds: string[]; titles?: Record<string, string>; reportsTo?: Record<string, string> };
export type OrgChart = {
  workspaceId: string;
  units: OrgUnit[];
  people: OrgChartPerson[];
  stats: { units: number; groups?: number; people: number; placed: number };
};

export type NexusHoliday = {
  id: string;
  date: string; // "YYYY-MM-DD"
  name: string;
};

export type NexusDayoff = {
  id: string;
  startDate: string;
  endDate: string;
  status: string;
  reason: string;
  approvalSource?: string | null;
  reviewedBy?: { id: string; name: string | null } | null;
};

/** One "extra day off" grant — GET/POST /api/attendance/day-off-bonus, DELETE …/:id. */
export type NexusDayOffBonus = {
  id: string;
  userId: string;
  user: { id: string; name: string | null; email: string | null; avatar: string | null } | null;
  periodKey: string;
  days: number;
  reason: string;
  createdAt: string;
  grantedBy: { id: string; name: string | null } | null;
  revokedAt: string | null;
  revokedBy: { id: string; name: string | null } | null;
  active: boolean;
};
export type NexusDayOffBonusList = {
  periodKey: string; periodLabel: string; periodStart: string; periodEnd: string;
  currentPeriodKey: string; canManage: boolean;
  grantablePeriods: { periodKey: string; periodLabel: string }[];
  mine: { base: number; bonus: number; quota: number };
  grants: NexusDayOffBonus[];
};
/** How a day-off allowance is made up: quota = baseQuota + bonus.days. */
export type NexusDayOffBonusBreakdown = { days: number; grants: { days: number; reason: string }[] };

export type WorkspaceMembersResponse = {
  /** Member of the company workspace (Z Networks): Z Vault and Threads are shown only then. */
  isCompany?: boolean;
  /** May pick "Pipeline Dashboard" in New project: a member of the board, or anyone of the company while none
   *  exists (owner, 9 Oct 2026 evening — the board is an ordinary project for access). Servers since 9 Oct. */
  canAccessPipeline?: boolean;
  /** The company's one Pipeline board, for the "Pipeline" nav entry; only for its project members, else null. */
  pipelineProjectId?: string | null;
  workspaceId: string;
  /** Nama workspace si pemanggil — untuk label tombol "Masukkan ke …". */
  workspaceName?: string;
  role: string; // caller's own org role
  members: NexusWorkspaceMember[];
  availableUsers?: Array<{ id: string; name: string; email: string; avatar: string | null }>;
};

export type NexusLeaderboardRow = {
  userId: string;
  name?: string | null;
  avatar?: string | null;
  totalXp: number;
  allTimeXp?: number;
  level: number;
  levelName?: string;
};

export type NexusLeaderboardPeriod = {
  start: string;
  end: string;
  resetDay: number;
  timezone: string;
};

export type NexusXpAuditRow = {
  id: string;
  userId: string;
  userName?: string | null;
  userAvatar?: string | null;
  amount: number;
  reason: string;
  createdAt: string;
  // Exact (uncapped) late minutes for attendance:late rows — the XP caps at -120, this doesn't.
  // Sourced from the checked-in record's lateMinutes, or computed live (now − shift start) if not yet checked in.
  lateMinutes?: number | null;
};

export type NexusXpAuditResponse = {
  rows: NexusXpAuditRow[];
  hasMore: boolean;
  nextOffset: number;
  scope?: "period" | "all";
  sign?: "all" | "pos" | "neg";
};

// Public per-user XP log (click a person on the leaderboard → see their gains + penalties).
export type NexusUserXpLogRow = { id: string; amount: number; reason: string; createdAt: string; lateMinutes?: number | null };
export type NexusUserXpLog = {
  rows: NexusUserXpLogRow[];
  hasMore: boolean;
  nextOffset: number;
  user: { id: string; name?: string | null; avatar?: string | null } | null;
  scope?: "period" | "all";
};

/** One XP ledger row on a member record (GET /api/members/:id/record). `label` is ready to show; an
 *  attendance penalty carries the day it is about in `dateKey`. A removed deduction keeps its
 *  `originalAmount`, reads `amount` 0 and names who removed it. */
export type NexusRecordXpEntry = {
  id: string;
  amount: number;
  originalAmount: number;
  createdAt: string;
  reason: string;
  kind: string;
  label: string;
  dateKey: string | null;
  detail: string | null;
  lateMinutes: number | null;
  attendance: boolean;
  removed: { at: string; by: { id: string; name: string | null } | null; note: string | null } | null;
  canRemove: boolean;
};
export type NexusRecordXpTotals = { gained: number; lost: number; net: number; removed: number };
export type NexusRecordXp = { entries: NexusRecordXpEntry[]; totals?: NexusRecordXpTotals; hasOlder: boolean; olderPeriod: string | null };
export type NexusMemberRecord = {
  person: { id: string; name: string | null; email: string | null; avatar: string | null; role: string; joinedAt: string; isSelf: boolean };
  viewer: { scope: "ALL" | "DIRECT_REPORTS" | "SELF"; canManageAttendance: boolean; canRemoveXp: boolean };
  period: { key: string; from: string; to: string; label: string; isCurrent: boolean; days: number; daysElapsed: number; previousKey: string; nextKey: string | null };
  summary: {
    score: { worked: number; working: number; surplus: number; totalWorked: number };
    counts: { present: number; permit: number; leave: number; sick: number; dayOff: number; absent: number; lateDays: number; lateMinutes: number };
    dayOff: { quota: number; baseQuota: number; bonusDays: number; bonusGrants: { days: number; reason: string }[]; used: number; usedRaw: number; remaining: number };
    xp: NexusRecordXpTotals;
  };
  days: { date: string; day: number; weekday: string; tone: string; isToday: boolean; isFuture: boolean; lateMinutes: number; penaltyXp: number }[];
  xp: NexusRecordXp;
  requests: {
    id: string; type: "LEAVE" | "SICK" | "PERMIT" | "DAY_OFF" | "RED_DATE"; status: string; startDate: string; endDate: string; days: number;
    reason: string; reviewNote: string | null; createdAt: string; reviewedAt: string | null; reviewedBy: { id: string; name: string | null } | null; isAuto: boolean;
  }[];
};

// Self "you lost XP" popup feed — the current user's own recent negative XP transactions.
export type NexusXpPenalty = {
  id: string;
  amount: number;
  reason: string;
  kind: "late" | "nocheckout" | "alpha" | "admin" | "other";
  createdAt: string;
  lateMinutes?: number | null;
};

export type NexusAdminQuest = {
  id: string;
  title: string;
  description?: string | null;
  requirementType: string;
  requiredCount: number;
  xpReward: number;
  isActive?: boolean;
  teamIds?: string[];
  deadline?: string | null;
};

export type NexusAttendanceRequest = {
  id: string;
  type?: string | null;
  status?: string | null;
  reason?: string | null;
  /** The reviewer's decision note — mandatory on a reject, optional on an approve. */
  reviewNote?: string | null;
  reviewedAt?: string | null;
  reviewedBy?: NexusUser | null;
  /** When it was filed. The Submissions list falls back to it for rows nobody has decided. */
  createdAt?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  submittedLat?: number | null;
  submittedLng?: number | null;
  submittedAddress?: string | null;
  reportDelayMinutes?: number | null;
  supportingDocumentUrl?: string | null;
  supportingDocumentName?: string | null;
  user?: NexusUser | null;
};

export type DirectLoginResponse = {
  ok: boolean;
  redirectTo?: string;
  error?: string;
};

export type NexusTask = {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  tags?: string[] | null;
  taskListId?: string | null;
  parentId?: string | null;
  /** Parent task (for subtask cards shown on the board) — title used for the "↳ Subtask · <parent>" marker. */
  parent?: { id: string; title: string } | null;
  position?: number | null;
  /** Active task-bundle quests this task is in (board/list/detail "🏆 +X XP" badge). total/done only on detail. */
  quests?: Array<{ id: string; title: string; xpReward: number; total?: number; done?: number }>;
  taskList?: { id?: string; name?: string; position?: number; projectId?: string; project?: { id?: string; name?: string } | null } | null;
  assignees?: Array<{ user?: NexusUser | null }>;
  _count?: { subtasks?: number; comments?: number };
  /** Subtask rows. The project payload sends minimal {id,status} (for the card's "done/total"
   *  chip); the task-detail payload sends the full rows — hence every field but id is optional. */
  subtasks?: NexusSubtask[];
  customFieldValues?: Array<{
    customFieldId: string;
    value: string;
    customField?: { name?: string; type?: string; options?: NexusCustomFieldOptions | { choices?: string[] } | string[] | null };
  }>;
};

export type NexusGoal = {
  id: string;
  title: string;
  description?: string | null;
  status?: string | null;
  progress?: number | null;
  dueDate?: string | null;
  owner?: NexusUser | null;
  milestones?: unknown[];
  parentId?: string | null;
};

export type NexusSprintTask = {
  id: string;
  task: Pick<NexusTask, "id" | "title" | "status" | "priority"> & {
    assignees?: Array<{ user?: Pick<NexusUser, "id" | "name" | "email"> | null }>;
  };
};

export type NexusSprint = {
  id: string;
  name: string;
  status?: "PLANNING" | "ACTIVE" | "COMPLETED" | string;
  startDate: string;
  endDate: string;
  projectId?: string;
  tasks?: NexusSprintTask[];
};

export type NexusDoc = {
  id: string;
  title: string;
  contentText?: string | null;
  updatedAt?: string | null;
  parentId?: string | null;
  icon?: string | null;
  author?: NexusUser | null;
  owner?: NexusUser | null;
  project?: { id?: string; name?: string; color?: string | null } | null;
};

export type NexusDocTemplate = {
  id: string;
  name: string;
  content?: unknown;
};

export type NexusNotification = {
  id: string;
  title?: string | null;
  message?: string | null;
  type?: string | null;
  read?: boolean;
  createdAt?: string | null;
  link?: string | null;
  taskId?: string | null;
  projectId?: string | null;
};

/** Hide notifications that have been READ for more than `maxAgeDays` (default 7);
 *  unread always stay. Mirrors the my-tasks done-expiry — keeps the inbox / bell
 *  focused on what's still relevant. (No readAt field, so createdAt is the proxy.) */
export function activeNotifications(list: NexusNotification[], maxAgeDays = 7): NexusNotification[] {
  const max = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();
  return list.filter((n) => {
    if (!n.read) return true;
    const ts = n.createdAt ? new Date(n.createdAt).getTime() : 0;
    return ts > 0 && now - ts <= max;
  });
}

/* ── Notification filtering ────────────────────────────────────────────────
   There are ~30 distinct `type` strings in the wild and nobody reading their
   inbox thinks in them: `attendance_request_reviewed`, `offsite_checkout_pending`
   and `attendance_override` are all just "Attendance" to a human. These are the
   buckets the filter offers; the raw type stays visible on the row itself. */

export type NotificationGroupId =
  | "all" | "tasks" | "attendance" | "messages" | "submissions" | "tickets" | "announcements" | "other";

export const NOTIFICATION_GROUPS: { id: NotificationGroupId; label: string }[] = [
  { id: "all", label: "All" },
  { id: "tasks", label: "Tasks" },
  { id: "attendance", label: "Attendance" },
  { id: "messages", label: "Messages" },
  { id: "submissions", label: "Submissions" },
  { id: "tickets", label: "Tickets" },
  { id: "announcements", label: "Announcements" },
  { id: "other", label: "Other" },
];

/** Which bucket a raw notification `type` belongs to. Unknown types land in "Other"
 *  rather than disappearing — a new type must never become invisible. */
export function notificationGroup(type?: string | null): Exclude<NotificationGroupId, "all"> {
  const t = (type ?? "").toLowerCase();
  if (t.startsWith("attendance") || t.startsWith("offsite") || t === "dayoff_quota_low" || t === "dayoff_bonus_granted" || t === "red_date_quota_low") return "attendance";
  if (t === "submission_status") return "submissions";
  if (t.startsWith("complaint")) return "tickets";
  if (t.includes("announcement")) return "announcements";
  // Every Threads signal (feed_post, feed_like, feed_mention, feed_comment) is conversation, not "Other".
  if (t.startsWith("message") || t.startsWith("feed_")) return "messages";
  if (t.startsWith("task") || t.startsWith("comment") || t.startsWith("quest") || t === "project_invite" || t === "status_update" || t === "streak_at_risk") return "tasks";
  return "other";
}

/** Tabs worth drawing for THIS list: "All", plus only the buckets that actually have
 *  something in them, each with its count. No dead tabs. */
export function notificationFilterTabs(list: NexusNotification[]): { id: NotificationGroupId; label: string; count: number }[] {
  const counts = new Map<NotificationGroupId, number>();
  for (const n of list) {
    const g = notificationGroup(n.type);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  return NOTIFICATION_GROUPS
    .filter((g) => g.id === "all" || (counts.get(g.id) ?? 0) > 0)
    .map((g) => ({ ...g, count: g.id === "all" ? list.length : counts.get(g.id) ?? 0 }));
}

export type NexusCommentReaction = {
  id: string;
  emoji: string;
  user?: { id: string; name?: string | null } | null;
};

export type NexusComment = {
  id: string;
  content: string;
  createdAt?: string | null;
  updatedAt?: string | null;
  parentId?: string | null;
  user?: NexusUser | null;
  reactions?: NexusCommentReaction[];
  replies?: NexusComment[];
};

export type NexusActivityLog = {
  id: string;
  action?: string | null;
  details?: string | null;
  createdAt?: string | null;
  user?: NexusUser | null;
};

export type NexusSubtask = {
  id: string;
  title?: string;
  status?: string | null;
  priority?: string | null;
  position?: number | null;
  dueDate?: string | null;
  assignees?: Array<{ user?: Pick<NexusUser, "id" | "name" | "avatar"> | null }>;
};

export type NexusTaskDetail = NexusTask & {
  description?: string | null;
  estimatedHours?: number | null;
  creator?: NexusUser | null;
  comments?: NexusComment[];
  parent?: { id: string; title: string } | null;
  subtasks?: NexusSubtask[];
  activityLogs?: NexusActivityLog[];
  taskList?: {
    id?: string;
    name?: string;
    projectId?: string;
    project?: { id: string; name: string; color?: string | null; icon?: string | null } | null;
  } | null;
  likeCount?: number;
  liked?: boolean;
  taskProjects?: Array<{
    id: string;
    project?: { id: string; name: string; color?: string | null; icon?: string | null } | null;
    taskList?: { id: string; name: string } | null;
  }>;
};

export type NexusReports = {
  metrics?: {
    totalTasks?: number;
    completedTasks?: number;
    overdueTasks?: number;
    completionRate?: number;
    completionTrend?: number;
    avgCompletionDays?: number;
  };
  tasksByStatus?: Array<{ status: string; count: number }>;
  tasksByPriority?: Array<{ priority: string; count: number }>;
  completionTimeline?: Array<{ date: string; count: number }>;
  tasksByAssignee?: Array<{ name?: string; userId?: string; total?: number; completed?: number }>;
  projectHealth?: Array<{ id?: string; name?: string; color?: string | null; total?: number; completed?: number; completionRate?: number; overdue?: number }>;
  projects?: Array<{ id: string; name: string; color?: string | null }>;
};

// --- Reports per crew (/api/reports/people) ---------------------------------------------------------
// Multi-assignee tasks are split between assignees, so task counts can be fractional (2.5).
export type ReportRatio = { num: number; den: number };
export type ReportWorkspaceRole = "ONE_ABOVE_ALL" | "BOD" | "MANAGER" | "STAFF";
export type ReportPriority = "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
export type ReportViewerScope = "ALL" | "DIRECT_REPORTS" | "SELF";
export type ReportPeriod = { key: string | null; from: string; to: string; timezone: string; isCurrent: boolean; days: number; daysElapsed: number };
export type ReportHeadline = {
  assigned: number; completed: number; onTime: ReportRatio; overdue: number; medianCycleDays: number | null;
  present: number; late: number; lateMinutes: number; earlyLeave: number; absent: number; leave: number; sick: number; permit: number; dayOff: number;
  avgWorkedMinutes: number | null; attendanceRate: ReportRatio; lateRate: ReportRatio; reflectionRate: ReportRatio; xpScore: number; xpPenalty: number;
};
export type ReportOverdueTask = { id: string; title: string; projectId: string; projectName: string; dueDate: string; dueKey: string; daysOverdue: number; priority: ReportPriority; assigneeCount: number; share: number };
export type ReportPersonWork = {
  assigned: number; completed: number; onTime: ReportRatio; dueWithDate: number; overdueNow: number; overdueList: ReportOverdueTask[];
  openTotal: number; openByPriority: Record<ReportPriority, number>; dueNext7: number;
  medianCycleDays: number | null; cycleSample: number; weekly: { from: string; to: string; completed: number; onTime: number }[];
  perProject: { projectId: string; projectName: string; completed: number; open: number; overdue: number }[];
};
export type ReportPersonAttendance = {
  present: number; late: number; lateMinutes: number; earlyLeave: number; absent: number; leave: number; sick: number; permit: number; dayOff: number;
  avgWorkedMinutes: number | null; workedDays: number; reflections: number; checkouts: number; attendanceRate: ReportRatio; lateRate: ReportRatio; reflectionRate: ReportRatio;
};
export type ReportPenaltyKind = "late" | "nocheckout" | "alpha" | "peer" | "penalty" | "admin" | "other";
export type ReportPersonXp = {
  periodScore: number; baseline: number;
  level: { level: number; name: string; floor: number; nextFloor: number | null; pct: number; isMax: boolean };
  streak: { current: number; longest: number };
  penalties: { kind: ReportPenaltyKind; count: number; xp: number }[]; penaltyTotal: number;
};
export type ReportTeamRef = { id: string; name: string };
export type PersonReportResponse = {
  person: { id: string; name: string; email: string; avatar: string | null; role: ReportWorkspaceRole | null; approverId: string | null; teams: ReportTeamRef[]; isSelf: boolean };
  viewerScope: ReportViewerScope; period: ReportPeriod; previousPeriod: ReportPeriod; headline: ReportHeadline; previous: ReportHeadline;
  work: ReportPersonWork; attendance: ReportPersonAttendance; xp: ReportPersonXp; generatedAt: string;
};
export type ReportRosterRow = {
  userId: string; name: string; email: string; avatar: string | null; role: ReportWorkspaceRole | null; approverId: string | null; teams: ReportTeamRef[];
  headline: ReportHeadline; previous: ReportHeadline; flags: { overdue3: boolean; late3: boolean; lowReflections: boolean }; flagCount: number;
};
export type ReportRosterResponse = { scope: ReportViewerScope; period: ReportPeriod; previousPeriod: ReportPeriod; team: ReportTeamRef | null; rows: ReportRosterRow[]; generatedAt: string };
/** "YYYY-MM" attendance period (28→27), or an explicit day range. Omitted = the current period. */
export type ReportPeriodQuery = string | { from: string; to: string };

function reportPeriodParams(period?: ReportPeriodQuery | null): URLSearchParams {
  const qs = new URLSearchParams();
  if (typeof period === "string" && period) qs.set("period", period);
  else if (period && typeof period === "object") { qs.set("from", period.from); qs.set("to", period.to); }
  return qs;
}
function withQuery(path: string, qs: URLSearchParams): string {
  const s = qs.toString();
  return s ? `${path}?${s}` : path;
}

export type NexusAutomationRule = {
  type: string;
  field?: string;
  value?: string;
};

export type NexusAutomation = {
  id: string;
  name: string;
  enabled?: boolean;
  trigger?: NexusAutomationRule | null;
  action?: NexusAutomationRule | null;
  projectId?: string;
};

export type NexusFormField = {
  id: string;
  name?: string;
  label: string;
  type: string; // text | textarea | email | number | date | select | checkbox
  required?: boolean;
  placeholder?: string;
  options?: string[] | { choices?: string[] } | null;
};

export type NexusWorkflowBundle = {
  id: string;
  name: string;
  description?: string | null;
  createdAt?: string | null;
  createdBy?: { id?: string; name?: string | null } | null;
};

export type NexusMySubmission = {
  id: string;
  createdAt: string;
  formId?: string | null;
  formName?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  taskId?: string | null;
  taskTitle?: string | null;
  status?: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED" | null;
  stage?: string | null;
  procStatus?: string | null; // "Status" custom field value (null = belum diproses)
  proofs?: Array<{ id: string; name?: string | null; url?: string | null; mimeType?: string | null; size?: number | null }>; // Bukti Pencairan from the finance team
};

export type NexusSubmissionDetail = NexusMySubmission & {
  answers?: Array<{ id: string; label: string; type: string; value: unknown }>;
};

// kind: "announcement" (Control Room) | "warning" (personal, from Absen Monitor) | "sp" (surat
// peringatan with a PDF attached). targeted = addressed to the viewer personally, not to everyone.
export type NexusAnnouncementKind = "announcement" | "warning" | "sp";
export type NexusAnnouncement = { id: string; title: string; body: string; tone: "info" | "success" | "warning"; imageUrl?: string | null; createdAt: string; kind?: NexusAnnouncementKind; attachmentUrl?: string | null; attachmentName?: string | null; targeted?: boolean };
// repeatUntil/repeatAtTime: while set, the notice goes out again every day until that date.
// seenCount is per REPEAT — a repeat clears the seen rows so the pop-up comes back, which
// makes the number mean "seen since it last went out" rather than an all-time total.
export type NexusAdminAnnouncement = NexusAnnouncement & { active: boolean; seenCount: number; targetUserIds?: string[]; targetCount?: number; targets?: Array<{ id: string; name: string | null }>; repeatUntil?: string | null; repeatAtTime?: string | null; lastRepeatedAt?: string | null };

export type NexusFinanceLineItem = { id: string; name: string; order: number; monthly: number[]; total: number };
export type NexusFinanceCategory = { id: string; kind: "OPEX" | "REVENUE"; name: string; order: number; lineItems: NexusFinanceLineItem[]; subtotalByMonth: number[]; subtotal: number };
export type NexusFinanceDashboard = {
  year: number;
  categories: NexusFinanceCategory[];
  totals: { opexByMonth: number[]; revenueByMonth: number[]; profitByMonth: number[]; opexTotal: number; revenueTotal: number; profitTotal: number };
};

// --- P&L dashboard (standalone per-project: transaction expenses + income pipeline, BoD-only) ---
export type PnlAttachment = { id: string; filename: string; url: string; mimeType: string; size: number };
export type PnlExpense = { id: string; date: string; amount: number; description?: string | null; categoryId?: string | null; recurringId?: string | null; attachments: PnlAttachment[] };
export type PnlPayment = { id: string; date: string; amount: number; note?: string | null };
export type PnlIncome = { id: string; title: string; totalAmount: number; stageId?: string | null; expectedDate?: string | null; notes?: string | null; createdAt?: string; paid: number; outstanding: number; payments: PnlPayment[] };
export type PnlCategory = { id: string; name: string; color: string; order: number; total: number; byMonth: number[] };
export type PnlStage = { id: string; name: string; color: string; order: number; count: number; outstanding: number };
export type PnlRecurring = { id: string; description: string; amount: number; categoryId?: string | null; dayOfMonth: number; active: boolean };
export type PnlMonthDetail = {
  month: number;
  days: { day: number; income: number; expense: number }[];
  expenses: PnlExpense[];
  payments: (PnlPayment & { incomeId: string; incomeTitle: string })[];
};
export type PnlDashboard = {
  year: number;
  months: { income: number[]; expense: number[]; budget: (number | null)[] };
  totals: { income: number; expense: number; profit: number; pipelineTotal: number; pipelineOutstanding: number; paidAllTime: number };
  categories: PnlCategory[];
  stages: PnlStage[];
  incomes: PnlIncome[];
  recurring: PnlRecurring[];
  monthDetail: PnlMonthDetail | null;
};

export type NexusForm = {
  id: string;
  name: string;
  description?: string | null;
  fields: NexusFormField[];
  isPublic?: boolean;
  requireAuth?: boolean;
  slug?: string | null;
  projectId?: string;
  _count?: { submissions?: number };
};

export type NexusTeam = {
  id: string;
  name: string;
  color?: string | null;
  position?: number;
  members?: Array<{ userId?: string; role?: string; user?: NexusUser | null; isAttendancePrimary?: boolean }>;
  projects?: Array<{ project?: { id: string; name: string; color?: string | null; icon?: string | null; status?: string | null } | null }>;
  workspace?: { name?: string; slug?: string } | null;
  divisionId?: string | null;
  division?: { id: string; name: string; color?: string | null } | null;
  canManage?: boolean;
  canManageAttendanceSettings?: boolean;
  attendanceShiftOverrideEnabled?: boolean;
  attendanceShiftStartTime?: string | null;
  attendanceShiftEndTime?: string | null;
};


/** Keanggotaan tim + project satu orang, untuk dropdown di Control Room -> Users. */
export type NexusUserMemberships = {
  projects: Array<{
    id: string;
    name: string;
    icon?: string | null;
    color?: string | null;
    status?: string | null;
    role: string;
    /** null = ditambahkan langsung ke project; berisi nama tim = ikut lewat tim itu. */
    viaTeam: string | null;
  }>;
  teams: Array<{ id: string; name: string; color?: string | null; role: string; division: string | null }>;
};

/** Grouping layer above teams (divisi / perusahaan). */
export type NexusDivision = {
  id: string;
  name: string;
  color?: string | null;
  position?: number;
  workspaceId?: string;
};

/** Structured option config matching core-NEXUS `CustomFieldOptionConfig`. */
export type NexusCustomFieldOptions = {
  options?: string[];
  optionTemplates?: Record<string, string>;
  defaultSource?: string;
  editable?: boolean;
  format?: string; // "currency-idr" | "name-and-map-link"
};

/** Supported field types (uppercase enum from core NEXUS). */
export const CUSTOM_FIELD_TYPES = ["TEXT", "SELECT", "MULTI_SELECT", "STATUS", "NUMBER", "DATE", "URL", "FILE", "PLACE", "CREATED"] as const;
export type CustomFieldFile = { url: string; name: string; size?: number; type?: string };
export type NexusCustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type NexusCustomField = {
  id: string;
  projectId?: string;
  name: string;
  type: string; // TEXT | URL | FILE | NUMBER | SELECT | MULTI_SELECT | STATUS | DATE | PLACE | CREATED
  position?: number;
  options?: NexusCustomFieldOptions | { choices?: string[] } | string[] | null;
  value?: string | string[] | { label?: string; mapUrl?: string } | CustomFieldFile[] | null;
  // CREATED-type fields: who created/submitted + when (backend fills userName = task creator).
  createdMeta?: { userName?: string | null; timestamp?: string | null } | null;
  libraryId?: string | null;
};

export type NexusDependency = {
  id: string;
  type?: string | null;
  dependsOnTask?: { id: string; title: string; status?: string | null } | null;
  task?: { id: string; title: string; status?: string | null } | null;
};

export type NexusTimeEntry = {
  id: string;
  duration?: number | null;
  description?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  user?: NexusUser | null;
};

export type NexusAttachment = {
  id: string;
  name?: string | null;
  url?: string | null;
  size?: number | null;
  mimeType?: string | null;
  kind?: string | null; // "GENERAL" | "PROOF" (Bukti Pencairan)
  createdAt?: string | null;
  uploader?: NexusUser | null;
};

export type NexusSearchResults = {
  tasks?: Array<{ id: string; title: string; taskList?: { projectId?: string } | null }>;
  projects?: Array<{ id: string; name: string; color?: string | null }>;
  docs?: Array<{ id: string; title: string }>;
  goals?: Array<{ id: string; title: string }>;
  members?: Array<{ id: string; name?: string | null; email?: string | null }>;
  forms?: Array<{ id: string; name: string }>;
  sprints?: Array<{ id: string; name: string }>;
};

export type NexusFavorite = {
  id: string;
  type?: string;
  targetId?: string;
};

export type NexusWebhook = {
  id: string;
  url: string;
  events?: string[];
  active?: boolean;
  createdAt?: string | null;
  project?: { id: string; name: string } | null;
};

export type NexusSession = {
  id: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: string | null;
  expiresAt?: string | null;
};

/** A WebAuthn credential registered to this account. `label` is whatever the user typed when enrolling. */
export type NexusPasskey = {
  id: string;
  label?: string | null;
  createdAt: string;
  lastUsedAt?: string | null;
};

export type NexusApiToken = {
  id: string;
  name: string;
  scopes?: string[];
  lastUsedAt?: string | null;
  expiresAt?: string | null;
  createdAt?: string | null;
};

// POST response includes the plaintext token exactly once.
export type NexusApiTokenCreated = NexusApiToken & { token: string };

export type NexusAdminUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role?: string | null;
  avatar?: string | null;
  workspaceCount?: number;
  joinedAt?: string | null;
  /** Akun Google Workspace yang ditautkan BoD dari Control Room. null = belum punya/belum ditautkan. */
  googleWorkspaceEmail?: string | null;
  /** Earliest workspace join (any workspace). */
  firstJoinedAt?: string | null;
  /** Offboarded (left the company): can't sign in. null = active. */
  deactivatedAt?: string | null;
  /** The workspaces they left, newest first. Empty for active people. */
  formerMemberships?: NexusFormerMembership[];
};

export type OffboardReason = "RESIGNED" | "CONTRACT_ENDED" | "DISMISSED" | "OTHER";
export type NexusFormerMembership = {
  workspaceId: string;
  workspaceName: string;
  /** Last working day, 00:00 UTC of that Jakarta date: format it in UTC. */
  leftAt: string;
  reason: OffboardReason | string;
};
/** POST /api/admin/users/:id/offboard. Refusals carry `code` in ApiError.payload. */
export type NexusOffboardResult = {
  ok: true;
  user: { id: string; name: string };
  leftAt: string;
  lastWorkingDay: string;
  workspaces: string[];
  /** People whose approver was the leaver; they fall back to the BoD until a new one is set. */
  approverEdgesCleared: Array<{ id: string; name: string }>;
  pendingRequests: number;
  autoDeductionsCanceled: number;
  openTasks: number;
};
export type NexusReinstateResult = {
  ok: true;
  user: { id: string; name: string };
  workspaces: string[];
  alreadyMember: string[];
  approverDropped: number;
};

/** Satu akun di Google Workspace, apa adanya dari Admin SDK. */
export type GoogleWorkspaceAccount = {
  email: string;
  fullName: string;
  suspended: boolean;
  isAdmin: boolean;
  /** Workspace ini memuat tiga domain: znetworks.id, pats.group, intoo.id. */
  domain: string;
  /** Profil NEXUS yang sudah memakai akun ini, atau null. */
  linkedTo: { id: string; name: string } | null;
};
export type GoogleWorkspaceAccounts = {
  configured: boolean;
  /** Domain yang bisa dipakai saat membuat akun baru, diturunkan dari akun yang ada. */
  domains?: string[];
  accounts: GoogleWorkspaceAccount[];
  error?: string;
};

export type CreatedGoogleAccount = {
  created: boolean;
  linked: boolean;
  account: { email: string; fullName: string; temporaryPassword: string };
  /** Sandi TIDAK ikut notifikasi — ia hanya lewat email pribadi. Lihat route pembuatannya. */
  notified?: { inApp: boolean; email: boolean; emailTo?: string | null };
  error?: string;
};

export type NexusAuditLog = {
  id: string;
  action?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  entityName?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  createdAt?: string | null;
  /** A readable one-line sentence written by the server. Optional: older rows/servers don't send it. */
  summary?: string;
  metadata?: unknown;
  user?: NexusUser | null;
  /** On an entry that kept a copy (projects/tasks since 8 Oct 2026, every delete since later that day); null/absent = can't be restored. */
  restore?: NexusAuditRestoreInfo | null;
};

/**
 * What comes back. The first six are what project/task copies always had; `items` is every row the
 * copy holds ("N items" for a kind the client doesn't know); the rest only appear when non-zero.
 * Never counts the thing itself: a task's `tasks` are subtasks, a comment's `comments` its replies.
 */
export type NexusRestoreCounts = {
  lists: number; tasks: number; files: number; comments: number; sheets: number; members: number;
  items?: number; rows?: number; cells?: number; submissions?: number; values?: number; receipts?: number;
  payments?: number; milestones?: number; pages?: number; people?: number; projects?: number; folders?: number;
  units?: number; points?: number;
  /** A group chat's messages (servers since 9 Oct 2026). */
  messages?: number;
};

/** Where "Open …" goes once it's back. `type`: project, task, doc, folder, sheet, page, form, pnl, vault, attendance_request, attendance_record, attendance_office, room_booking, calendar, calendar_event, post, goal, portfolio, announcement, org_chart, chat (a group chat: `id` is the conversation). */
export type NexusRestoreOpen = { type: string; id: string; projectId?: string; date?: string };

export type NexusAuditRestoreInfo = {
  available: boolean;
  restoredAt: string | null;
  /** When the copy is from: the delete itself, or the nightly backup it was taken from. */
  dataAsOf: string;
  fromBackup: boolean;
  /** Servers since 8 Oct 2026 (all kinds): the delete only flipped a flag, restoring switches it back. */
  soft?: boolean;
  /** English noun ("comment", "sheet rows"). */
  entityLabel?: string;
  counts?: NexusRestoreCounts;
  open?: NexusRestoreOpen | null;
};

/** POST /api/audit/{id}/restore. Failures are 404/409 with `code`: NOT_RESTORABLE, ALREADY_RESTORED, ALREADY_EXISTS, PARENT_MISSING (+ `parent`: "task", "project"…), CONFLICT. */
export type NexusAuditRestoreResult = {
  ok: true;
  entityType: string;
  entityId: string;
  entityLabel?: string;
  projectId: string | null;
  open?: NexusRestoreOpen | null;
  restored: { lists: number; tasks: number; files: number; comments: number; folders: number; items?: number };
};

export type NexusAuditLink = { type: "task" | "project" | "user" | "attendance" | "form"; id: string };

/** GET /api/audit/{id}: one entry, with its metadata turned into a title, field changes and details. */
export type NexusAuditEntryDetail = {
  entry: {
    id: string;
    action: string;
    entityType: string;
    entityId: string | null;
    entityName: string | null;
    createdAt: string;
    ipAddress: string | null;
    userAgent: string | null;
    user: { id: string; name: string; email: string | null; avatar: string | null } | null;
    metadata: unknown;
  };
  title: string;
  changes: { field: string; label: string; from: string | null; to: string | null }[];
  details: { label: string; value: string; link?: NexusAuditLink }[];
  /** An entry that kept a copy: what comes back, and whether it already did. Absent on older servers. */
  restore?: (NexusAuditRestoreInfo & {
    restoredBy: { id: string; name: string | null } | null;
    counts: NexusRestoreCounts;
  }) | null;
};

export type NexusNotificationPrefs = {
  emailEnabled?: boolean;
  slackEnabled?: boolean;
  desktopEnabled?: boolean;
  desktopSoundEnabled?: boolean;
  slackWebhook?: string | null;
};

export type NexusPortfolio = {
  id: string;
  name: string;
  description?: string | null;
  owner?: NexusUser | null;
  projects?: Array<{ project?: { id: string; name: string; status?: string | null; color?: string | null } | null }>;
};

export type NexusCalendarEvent = {
  id: string;
  title: string;
  startsAt: string;
  endsAt?: string | null;
  isAllDay?: boolean;
  location?: string | null;
  description?: string | null;
  attendees?: Array<{ userId?: string; user?: NexusUser | null }>;
};

export const ROOM_BOOKING_ROOMS = ["Ruang Meeting VIP", "Ruang Meeting", "Studio"] as const;
export type NexusRoomName = (typeof ROOM_BOOKING_ROOMS)[number];
// DISPLAY-only English labels. The stored/matched values above stay Indonesian (existing bookings +
// the backend's ROOM_BOOKING_ROOMS validate against them) — only the rendered text is localized.
export const ROOM_LABEL: Record<string, string> = {
  "Ruang Meeting VIP": "VIP Meeting Room",
  "Ruang Meeting": "Meeting Room",
  "Studio": "Studio",
};
export const roomLabel = (room?: string | null) => (room ? (ROOM_LABEL[room] ?? room) : "");

export type NexusRoomBooking = {
  id: string;
  room: NexusRoomName | string;
  title: string;
  description?: string | null;
  startsAt: string;
  endsAt: string;
  status?: string;
  createdBy?: NexusUser | null;
};

export type RoomBookingPayload = {
  room: string;
  title: string;
  startsAt: string;
  endsAt: string;
  description?: string | null;
};

export type CalendarEventPayload = {
  teamId: string;
  title: string;
  date: string;
  isAllDay?: boolean;
  startTime?: string | null;
  endTime?: string | null;
  attendeeIds?: string[];
  location?: string | null;
  description?: string | null;
};

export type NexusCalendar = {
  id: string;
  name: string;
  color?: string | null;
  projectIds: string[];
  /** Room Booking sources on this calendar — canonical room names (see ROOM_SOURCES). */
  roomSources?: string[];
  position?: number;
  workspaceId: string;
  createdById: string;
  createdAt?: string;
  createdBy?: { id: string; name?: string | null } | null;
};

export type CalendarTaskItem = {
  id: string;
  title: string;
  status?: string | null;
  priority?: string | null;
  dueDate?: string | null;
  startDate?: string | null;
  projectId: string;
  projectName: string;
  projectColor?: string | null;
  projectIcon?: string | null;
};

/** A room booking plotted on a calendar, returned alongside tasks by /api/calendar-tasks. */
export type CalendarBookingItem = {
  id: string;
  title: string;
  room: string;
  startsAt: string;
  endsAt: string;
  bookedByName?: string | null;
};

/** The rooms a calendar can pull from — must match ROOM_BOOKING_ROOMS on the backend. */
export const ROOM_SOURCES = ["Ruang Meeting VIP", "Ruang Meeting", "Studio"] as const;

export type NexusMilestone = {
  id: string;
  title: string;
  completed?: boolean;
  dueDate?: string | null;
};

export type NexusGoalDetail = Omit<NexusGoal, "milestones"> & {
  milestones?: NexusMilestone[];
  totalTasks?: number;
  completedTasks?: number;
  linkedProjects?: Array<{ id: string; name: string; color?: string | null }>;
  linkedTasks?: Array<{ id: string; title: string; status?: string | null; project?: { id?: string; name?: string; color?: string | null } | null }>;
};

export type NexusStatusUpdate = {
  id: string;
  text: string;
  status?: string | null;
  createdAt?: string | null;
  author?: NexusUser | null;
};

export type BufferChannel = { id: string; name: string; service: string; avatar?: string | null };
export type BufferDraft = {
  id: string;
  text: string;
  status: string;
  createdAt?: string | null;
  dueAt?: string | null;
  channel: BufferChannel | null;
  media: string[];
};
export type BufferDraftsResponse = { configured: boolean; drafts: BufferDraft[]; channels: BufferChannel[]; error?: string; stale?: boolean; rateLimited?: boolean; cached?: boolean };

/** GET /api/app/android/release — the sideloaded Android build the /download/android page offers. */
export type AndroidReleaseInfo =
  | { available: false; minSupported: string; latest: string | null }
  | {
      available: true;
      versionName: string;
      versionCode: number;
      sizeBytes: number;
      sha256: string | null;
      releasedAt: string | null;
      notes: string | null;
      fileName: string;
      downloadUrl: string;
      minSupported: string;
      latest: string | null;
    };

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(status: number, message: string, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

async function parseResponse(res: Response) {
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return res.text();
}

/** GET /api/attendance/suspects — Absen Monitor (BoD). FAKE = proof of fake GPS, NOFACE = a selfie with no face, CHECK = weak signal. */
export type NexusSuspectLevel = "FAKE" | "NOFACE" | "CHECK";
export type NexusSuspectSide = {
  at: string | null; lat: number | null; lng: number | null; accuracyM: number | null
  simulated: boolean; suspect: boolean; reason: string | null; impliedKmh: number | null
  photoUrl: string | null; address: string | null; offline: boolean
  /** Faces found in the selfie; null = not checked yet. */
  faceCount: number | null
  level: NexusSuspectLevel | null; signals: string[]
};
export type NexusSuspectItem = {
  recordId: string; date: string; state: "open" | "valid" | "invalid"; level: NexusSuspectLevel | null
  user: { id: string; name: string | null; image: string | null }
  place: string | null
  checkIn: NexusSuspectSide | null; checkOut: NexusSuspectSide | null
  review: { verdict: "VALID" | "INVALID"; note: string | null; reviewedAt: string; reviewedBy: { id: string; name: string | null } } | null
  /** Warnings sent from Absen Monitor, latest first. */
  warnings?: Array<{ at: string; by: { name: string | null }; message: string }>
};
export type NexusSuspectList = {
  periodKey: string; periodLabel: string; periodStart: string; periodEnd: string; currentPeriodKey: string
  counts: { fakeOpen: number; noFaceOpen?: number; checkOpen: number; valid: number; invalid: number }
  items: NexusSuspectItem[]
};

// --- Calendar ---
export type CalOverdueResponse = {
  v: number; tz: string; today: string; now: string; access: CalStructure["access"]
  structureVersion: string | null; rules: CalRules | null; items: CalItem[]
  people: Record<string, { name: string | null; avatar: string | null }>; truncated: boolean
};
/** AppSetting "calendar" (server lib/calendar/core.ts CalendarSettings). */
export type CalendarSettings = {
  audience: "bod" | "managers" | "all"; audienceUserIds: string[]
  visibility: "all" | "all_except_private" | "masked_foreign" | "projects"
  privateProjectIds: string[]; notPrivateProjectIds: string[]; privateNamePrefixes: string[]
  overdueWindowDays: number; urgentDays: number
  folderUnits: Record<string, string>; projectUnits: Record<string, string>
};
export type CalendarSettingsPayload = {
  settings: CalendarSettings
  units: { id: string; name: string; depth: number }[]
  folders: { id: string; name: string; parentFolderId: string | null; unitId: string | null }[]
  projects: {
    id: string; name: string; color: string; folderId: string | null
    private: boolean; privateBy: "list" | "prefix" | null
    unitId: string | null; unitBy: "project" | "folder" | "folder-name" | "project-name" | "top" | null
  }[]
};

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
      // The interface language (lib/lang.ts). Only some routes read it (api/teams); most server error
      // text is Indonesian, so a bilingual screen must not show error.message as-is in English.
      "Accept-Language": getLang(),
      // Who is calling. The attendance-request route reads it to decide which rules this caller
      // can actually obey — see clientCanObeyRequestPolicy.
      "X-Nexus-Client": "web/1",
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers || {}),
    },
  });
  const payload = await parseResponse(res);
  if (!res.ok) {
    const message = typeof payload === "object" && payload && "error" in payload
      ? String((payload as { error?: unknown }).error)
      : `Request failed (${res.status})`;
    throw new ApiError(res.status, message, payload);
  }
  return payload as T;
}

// Download a server-generated file (xlsx/csv export). Uses a raw fetch (not apiFetch, which forces
// JSON parsing) and streams the blob to a temporary <a download>. Carries the session cookie.
export async function downloadFile(path: string, fallbackName: string) {
  const res = await fetch(path, { credentials: "include", headers: { Accept: "*/*" } });
  if (!res.ok) {
    let payload: unknown = null;
    try { payload = await res.json(); } catch { /* non-json error body */ }
    const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : `Download failed (${res.status})`;
    throw new ApiError(res.status, message, payload);
  }
  const blob = await res.blob();
  const cd = res.headers.get("Content-Disposition") || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------------------------------------------------------------------------
// Shared chunked-upload transport.
//
// Task attachments and Z Vault both use this. The retry policy, the back-off, the "4xx is permanent
// / 5xx is retryable" split and the aggregated progress were all tuned against how Cloudflare
// actually behaves on this tunnel; a second copy for the vault would be tuned against nothing, and
// would be the copy that quietly stops retrying.
//
// 16MB per chunk, NOT "as large as Cloudflare allows". Bodies anywhere near the ~100MB cap fail in a
// way that looks like a hang rather than an error: a 90MB body 502s after 30s, and an 80MB chunk
// uploads to the edge and then never receives a response, so progress freezes at a chunk boundary.
// 16MB transmits in seconds and stays far below that. It was raised from 10MB so the web ceiling
// (64 chunks) reaches the same 1GB as iOS — a file that uploads from the phone but not from the
// browser is exactly the kind of split Berlin asked to stop happening.
const UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;
const UPLOAD_CHUNK_THRESHOLD = 20 * 1024 * 1024; // below this, one request is simpler and faster

/** What an upload can be told besides the file: a way to stop it, and progress in bytes rather than
 *  percent (the Vault's upload panel shows "12.4 MB of 40.1 MB"). Both optional. */
export type UploadControl = {
  signal?: AbortSignal;
  /** Bytes of the FILE sent so far (not of the multipart body around it). */
  onBytes?: (sent: number) => void;
};

/** The error a stopped upload rejects with; `isAbort` recognises it. */
function abortError(): DOMException {
  return new DOMException("Upload cancelled", "AbortError");
}
export function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === "AbortError";
}

/** One XHR upload that a signal can stop. Shared by the single-shot Vault upload and replace. */
function xhrUpload<T>(url: string, fd: FormData, file: File, onProgress: (pct: number) => void, control?: UploadControl): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (control?.signal?.aborted) { reject(abortError()); return; }
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      onProgress(Math.round((e.loaded / e.total) * 100));
      control?.onBytes?.(Math.min(file.size, Math.round((e.loaded / e.total) * file.size)));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText) as T); } catch { reject(new ApiError(0, "Upload failed.", null)); }
      } else {
        let msg = "Upload failed.";
        let payload: unknown = null;
        try { payload = JSON.parse(xhr.responseText); msg = String((payload as { error?: string }).error || msg); } catch { /* non-JSON */ }
        reject(new ApiError(xhr.status, msg, payload));
      }
    };
    xhr.onerror = () => reject(new Error("Upload failed."));
    xhr.onabort = () => reject(abortError());
    control?.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(fd);
  });
}

function uploadChunked<T extends { id?: string }>(
  file: File,
  params: Record<string, string>,
  onProgress: (pct: number) => void,
  control?: UploadControl,
): Promise<T> {
  const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE);
  const uploadId = ((typeof crypto !== "undefined" && "randomUUID" in crypto)
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
  ).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

  const sendChunk = (index: number, baseBytes: number) =>
    new Promise<{ status: number; body: (T & { error?: string }) | null }>((resolve, reject) => {
      const start = index * UPLOAD_CHUNK_SIZE;
      const blob = file.slice(start, Math.min(start + UPLOAD_CHUNK_SIZE, file.size));
      // Metadata travels in the query string; the chunk bytes are the RAW body so the server can
      // stream them straight to disk (no multipart buffering).
      const qs = new URLSearchParams({
        uploadId,
        chunkIndex: String(index),
        totalChunks: String(totalChunks),
        totalSize: String(file.size),
        filename: file.name,
        mime: file.type || "application/octet-stream",
        ...params,
      });
      if (control?.signal?.aborted) { reject(abortError()); return; }
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `/api/attachments/chunk?${qs.toString()}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        onProgress(Math.min(99, Math.round(((baseBytes + e.loaded) / file.size) * 100)));
        control?.onBytes?.(Math.min(file.size, baseBytes + e.loaded));
      };
      xhr.onload = () => {
        let body: (T & { error?: string }) | null = null;
        try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON body */ }
        resolve({ status: xhr.status, body });
      };
      xhr.onerror = () => reject(new Error("network"));
      xhr.onabort = () => reject(abortError());
      control?.signal?.addEventListener("abort", () => xhr.abort(), { once: true });
      xhr.send(blob);
    });

  return (async () => {
    let last: (T & { error?: string }) | null = null;
    for (let i = 0; i < totalChunks; i++) {
      const baseBytes = i * UPLOAD_CHUNK_SIZE;
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await sendChunk(i, baseBytes);
          if (res.status >= 200 && res.status < 300) { last = res.body; break; }
          // 409 (finalize busy) / 429 (too many sessions) are transient → back off and retry.
          if (res.status === 409 || res.status === 429) throw new Error(`retry ${res.status}`);
          // Other 4xx is permanent (bad request / target gone / too big / over quota) → surface it.
          if (res.status >= 400 && res.status < 500) throw new ApiError(res.status, res.body?.error || "Upload rejected by server.", null);
          if (attempt >= 3) throw new ApiError(res.status, res.body?.error || `Server error (${res.status}).`, null);
          throw new Error(`server ${res.status}`); // 5xx → retryable
        } catch (err) {
          if (err instanceof ApiError || isAbort(err)) throw err;
          if (attempt >= 3) throw new ApiError(0, "Upload failed (connection dropped). Try again.", null);
          await new Promise((r) => setTimeout(r, 500 * attempt));
        }
      }
    }
    onProgress(100);
    if (!last || !last.id) throw new ApiError(0, "Upload finished but the server didn't return the file.", null);
    return last as T;
  })();
}

export function loginWithCredentials(email: string, password: string, callbackUrl = "/dashboard") {
  return apiFetch<DirectLoginResponse>("/api/auth/direct-login", {
    method: "POST",
    body: JSON.stringify({ email, password, callbackUrl }),
  });
}

export type CreateProjectPayload = {
  name: string;
  /** "TASK" or "PIPELINE" (9 Oct 2026); FINANCE and CONTENT answer 400 TYPE_COMING_SOON. Omitted = TASK. */
  type?: string;
  description?: string | null;
  color?: string;
  icon?: string;
  workspaceId: string;
  folderId?: string | null;
};

export type CreateTaskPayload = {
  title: string;
  description?: string | null;
  projectId: string;
  taskListId: string;
  status?: "TODO" | "IN_PROGRESS" | "IN_REVIEW" | "DONE" | "CANCELLED";
  priority?: "URGENT" | "HIGH" | "MEDIUM" | "LOW" | "NONE";
  dueDate?: string | null;
  tags?: string[];
  assigneeIds?: string[];
  /** Set to create the task as a SUBTASK of an existing task in the same project. */
  parentId?: string | null;
};

export type NexusReflectionDay = { date: string; reflection: string; summary: string | null };
export type NexusReflectionMonthly = { summary: string; sourceDays: number; updatedAt: string };
export type NexusReflections = { userId: string; month: string; days: NexusReflectionDay[]; monthly: NexusReflectionMonthly | null };

export type AttendanceActionPayload = {
  lat: number;
  lng: number;
  selfie: File;
  notes?: string;
  offsite?: boolean; // checkout: confirm checking out beyond the office geofence
  reason?: string; // checkout: mandatory reason when offsite
  reflection?: string; // checkout: mandatory daily reflection (min 200 chars)
};

function attendanceFormData(payload: AttendanceActionPayload) {
  const formData = new FormData();
  formData.set("lat", String(payload.lat));
  formData.set("lng", String(payload.lng));
  if (payload.notes) formData.set("notes", payload.notes);
  if (payload.offsite) formData.set("offsite", "1");
  if (payload.reason) formData.set("reason", payload.reason);
  if (payload.reflection) formData.set("reflection", payload.reflection);
  formData.set("selfie", payload.selfie);
  return formData;
}

export type NexusOffsiteCheckout = {
  id: string;
  attendanceDate: string;
  checkOutAt: string | null;
  reason: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  distanceMeters: number | null;
  photoUrl: string | null;
  checkOutStatus: string | null;
  approval: string | null;
  approvedAt: string | null;
  approverName?: string | null;
  officeName: string | null;
  user: { id: string; name: string; email: string; avatar: string | null };
};

export const nexusApi = {
  profile: () => apiFetch<{ user: NexusUser }>("/api/user/profile"),
  dashboard: () => apiFetch<NexusDashboardResponse>("/api/dashboard"),
  projects: () => apiFetch<NexusProject[]>("/api/projects"),
  workspaceProjects: (workspaceId: string) => apiFetch<NexusProject[]>(`/api/projects?workspaceId=${encodeURIComponent(workspaceId)}`),
  createProject: (payload: CreateProjectPayload) => apiFetch<NexusProject>("/api/projects", { method: "POST", body: JSON.stringify(payload) }),
  project: (projectId: string) => apiFetch<NexusProject>(`/api/projects/${projectId}`),
  updateProject: (projectId: string, payload: Partial<Pick<NexusProject, "name" | "description" | "color" | "icon" | "status" | "enableTaskBatchDuplicate" | "autoAssignEnabled" | "autoAssignAssigneeIds" | "enablePnlDashboard" | "requireAttachmentForDone" | "disableTaskStatus" | "hiddenTabs" | "financeEnabled">> & { folderId?: string | null; position?: number; tableColumns?: string[] }) => apiFetch<NexusProject>(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteProject: (projectId: string) => apiFetch<{ success?: boolean }>(`/api/projects/${projectId}`, { method: "DELETE" }),
  duplicateProject: (projectId: string) => apiFetch<NexusProject>(`/api/projects/${projectId}/duplicate`, { method: "POST" }),
  workflowBundles: () => apiFetch<{ bundles: NexusWorkflowBundle[] }>("/api/workflow-bundles"),
  createWorkflowBundle: (payload: { name: string; description?: string | null; config?: unknown }) => apiFetch<{ bundle?: NexusWorkflowBundle }>("/api/workflow-bundles", { method: "POST", body: JSON.stringify(payload) }),
  applyWorkflowBundle: (projectId: string, bundleId: string) => apiFetch<{ ok?: boolean }>(`/api/projects/${projectId}/apply-bundle`, { method: "POST", body: JSON.stringify({ bundleId }) }),
  projectFolders: (workspaceId?: string) => apiFetch<NexusProjectFolder[]>(`/api/project-folders${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`),
  projectFolderCreate: (workspaceId: string, payload: { name: string; icon?: string; color?: string; parentFolderId?: string | null }) =>
    apiFetch<NexusProjectFolder>("/api/project-folders", { method: "POST", body: JSON.stringify({ workspaceId, ...payload }) }),
  projectFolderUpdate: (folderId: string, patch: { name?: string; icon?: string; color?: string; position?: number; parentFolderId?: string | null; aggregateProjectIds?: string[] }) =>
    apiFetch<NexusProjectFolder>(`/api/project-folders/${folderId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  projectFolderDelete: (folderId: string) =>
    apiFetch<{ message?: string }>(`/api/project-folders/${folderId}`, { method: "DELETE" }),
  // Per-user pinned projects (sidebar quick-access).
  projectPins: () => apiFetch<{ projectIds: string[] }>("/api/projects/pins"),
  setProjectPin: (projectId: string, pinned: boolean) => apiFetch<{ pinned: boolean }>("/api/projects/pins", { method: "POST", body: JSON.stringify({ projectId, pinned }) }),
  // Per-user pinned FOLDERS (sidebar quick-access).
  folderPins: () => apiFetch<{ folderIds: string[] }>("/api/project-folders/pins"),
  setFolderPin: (folderId: string, pinned: boolean) => apiFetch<{ pinned: boolean }>("/api/project-folders/pins", { method: "POST", body: JSON.stringify({ folderId, pinned }) }),
  projectMembers: (projectId: string) => apiFetch<{ members?: Array<{ userId?: string; role?: string; user?: NexusUser }> } | Array<{ userId?: string; role?: string; user?: NexusUser }>>(`/api/projects/${projectId}/members`),
  addProjectMember: (projectId: string, userId: string, role = "MEMBER") => apiFetch<{ success?: boolean }>(`/api/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ userId, role }) }),
  // Several at once (servers from 9 Oct 2026). People already in are skipped, not an error.
  addProjectMembers: (projectId: string, userIds: string[], role = "MEMBER") => apiFetch<{ success?: boolean; added?: Array<{ userId: string; user?: NexusUser }>; alreadyMembers?: string[]; unknown?: string[] }>(`/api/projects/${projectId}/members`, { method: "POST", body: JSON.stringify({ userIds, role }) }),
  removeProjectMember: (projectId: string, userId: string) => apiFetch<{ success?: boolean }>(`/api/projects/${projectId}/members`, { method: "DELETE", body: JSON.stringify({ userId }) }),
  inviteToProject: (projectId: string, email: string, role = "GUEST") => apiFetch<{ success?: boolean; invite?: unknown }>(`/api/projects/${projectId}/invite`, { method: "POST", body: JSON.stringify({ email, role }) }),
  projectRollups: (projectId: string) => apiFetch<{ totalTasks?: number; completedTasks?: number; completionRate?: number; avgCompletionDays?: number; byStatus?: Record<string, number>; byPriority?: Record<string, number> }>(`/api/projects/${projectId}/rollups`),
  statusUpdates: (projectId: string) => apiFetch<NexusStatusUpdate[]>(`/api/status-updates?projectId=${encodeURIComponent(projectId)}`),
  createStatusUpdate: (projectId: string, text: string, status?: string) => apiFetch<NexusStatusUpdate>("/api/status-updates", { method: "POST", body: JSON.stringify({ projectId, text, status }) }),
  generateStatusUpdate: (projectId: string) => apiFetch<{ content: string }>(`/api/projects/${projectId}/status-updates/generate`, { method: "POST" }),
  createSection: (projectId: string, name: string) => apiFetch<{ id: string; name: string }>(`/api/projects/${projectId}/sections`, { method: "POST", body: JSON.stringify({ name }) }),
  updateSection: (projectId: string, payload: { id: string; name?: string; position?: number }) => apiFetch<{ id: string; name: string }>(`/api/projects/${projectId}/sections`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteSection: (projectId: string, id: string) => apiFetch<{ success?: boolean }>(`/api/projects/${projectId}/sections`, { method: "DELETE", body: JSON.stringify({ id }) }),
  employmentStartDates: () =>
    apiFetch<{ members: { userId: string; name: string | null; email: string | null; avatar: string | null; employmentStartDate: string | null; eligible: boolean; eligibleFrom: string | null }[]; quota: number }>(`/api/attendance/employment-start`),
  setEmploymentStartDate: (userId: string, date: string | null) =>
    apiFetch<{ employmentStartDate: string | null; eligibleFrom: string | null; eligible: boolean }>(`/api/attendance/employment-start`, { method: "PATCH", body: JSON.stringify({ userId, date }) }),
  attendanceToday: () => apiFetch<NexusAttendanceToday>("/api/attendance/today"),
  // Daily check-out reflections + GIDEON's summaries. userId undefined = the viewer's own.
  reflections: (userId: string | undefined, month: string) => apiFetch<NexusReflections>(`/api/attendance/reflections?month=${encodeURIComponent(month)}${userId ? `&userId=${encodeURIComponent(userId)}` : ""}`),
  summarizeReflections: (userId: string | undefined, month: string) => apiFetch<NexusReflectionMonthly & { cached?: boolean }>("/api/attendance/reflections/summarize", { method: "POST", body: JSON.stringify({ userId, month }) }),
  // Backend returns { scope, records: [...] }; older callers expect { rows }. Normalize both → { rows }.
  attendanceHistory: async (query = "scope=workspace"): Promise<NexusAttendanceHistory> => {
    const data = await apiFetch<{ records?: NexusAttendanceHistory["rows"]; rows?: NexusAttendanceHistory["rows"]; roster?: NexusAttendanceHistory["roster"] }>(`/api/attendance/history?${query}`);
    return { rows: data?.records ?? data?.rows ?? [], roster: data?.roster ?? [] };
  },
  // Where someone was while checked in. 403 outside the viewer's scope (manager = direct reports, BoD = all).
  attendanceTrail: (recordId: string) => apiFetch<NexusAttendanceTrail>(`/api/attendance/records/${encodeURIComponent(recordId)}/trail`),
  attendanceCheckIn: (payload: AttendanceActionPayload) => apiFetch<{ record: NexusAttendanceToday["today"] }>("/api/attendance/check-in", { method: "POST", body: attendanceFormData(payload) }),
  attendanceCheckOut: (payload: AttendanceActionPayload) => apiFetch<{ record: NexusAttendanceToday["today"]; pendingApproval?: boolean }>("/api/attendance/check-out", { method: "POST", body: attendanceFormData(payload) }),
  // Offsite checkout approval (BoD)
  offsiteCheckouts: (status?: string) => apiFetch<{ items: NexusOffsiteCheckout[]; pendingCount: number }>(`/api/attendance/offsite-checkouts${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  reviewOffsiteCheckout: (recordId: string, action: "approve" | "reject") => apiFetch<{ ok?: boolean; approval?: string }>(`/api/attendance/offsite-checkouts/${recordId}`, { method: "PATCH", body: JSON.stringify({ action }) }),
  deductAbsences: (payload?: { from?: string; to?: string }) => apiFetch<{ from: string; to: string; processedDates: string[]; created: number; skipped: number }>("/api/attendance/deduct-absences", { method: "POST", body: JSON.stringify(payload ?? {}) }),
  attendanceOutageRefund: (payload: { date: string; dryRun?: boolean }) => apiFetch<{ ok: boolean; date: string; dryRun: boolean; refundedMembers: number; excludedMembers: number; totalXpRefunded: number; totalDayOffsRestored: number; failed: number; entries: Array<{ userId: string; name: string | null; lateXp: number; noCheckoutXp: number; alphaXp: number; autoDayOffs: number; xpRefund: number; excludedReason: string | null }> }>("/api/attendance/outage-refund", { method: "POST", body: JSON.stringify(payload) }),
  attendanceRequests: (query = "scope=workspace") => apiFetch<{ requests?: NexusAttendanceRequest[] } | NexusAttendanceRequest[]>(`/api/attendance/requests?${query}`),
  createAttendanceRequest: (payload: { type: string; startDate: string; endDate: string; reason: string; targetUserId?: string; supportingDocument?: File | null; lat?: number | null; lng?: number | null }) => {
    const fd = new FormData();
    fd.set("type", payload.type); fd.set("startDate", payload.startDate); fd.set("endDate", payload.endDate); fd.set("reason", payload.reason);
    if (payload.targetUserId) fd.set("targetUserId", payload.targetUserId);
    if (payload.supportingDocument) fd.set("supportingDocument", payload.supportingDocument);
    if (payload.lat != null && payload.lng != null) { fd.set("lat", String(payload.lat)); fd.set("lng", String(payload.lng)); }
    return apiFetch<{ request?: NexusAttendanceRequest }>("/api/attendance/requests", { method: "POST", body: fd });
  },
  // Attendance deductions (BoD): no userId = day-off usage for the whole crew (the table's "sisa
  // day off"); with userId = that person's XP + day-off penalty log.
  attendanceDayOffSummary: (month?: string) =>
    apiFetch<{
      month: string; defaultQuota: number; redDateQuota: number;
      members: {
        userId: string; quota: number; used: number; remaining: number;
        baseQuota?: number; bonus?: NexusDayOffBonusBreakdown;
        redDate: { quota: number; used: number; remaining: number };
        xp: { score: number; level: number; levelName: string };
      }[];
    }>(`/api/attendance/deductions${month ? `?month=${month}` : ""}`),
  attendanceDeductions: (userId: string, month?: string) =>
    apiFetch<{
      month: string; userId: string;
      dayOff: { quota: number; used: number; remaining: number; baseQuota?: number; bonus?: NexusDayOffBonusBreakdown };
      totalXpLost: number;
      entries: { id: string; dateKey: string; kind: string; label: string; amount: number; unit: "XP" | "DAY_OFF"; detail: string | null; cleared: boolean }[];
    }>(`/api/attendance/deductions?userId=${encodeURIComponent(userId)}${month ? `&month=${month}` : ""}`),

  attendanceOverride: (payload: { userId: string; date: string; action: "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "PERMIT" | "CLEAR_PENALTY"; note?: string; checkInAt?: string | null; checkOutAt?: string | null }) =>
    apiFetch<{ ok: boolean; action: string; date: string; refunded: boolean; alreadyCovered?: boolean; canceledRequests?: number; replacedRequests?: number; multiDayRequestsLeft?: number }>("/api/attendance/override", { method: "POST", body: JSON.stringify(payload) }),
  // `reviewNote` is required by the server on "reject" (min 3 chars) and optional on "approve".
  reviewAttendanceRequest: (requestId: string, action: "approve" | "reject" | "cancel", reviewNote?: string) => apiFetch<{ request?: NexusAttendanceRequest }>(`/api/attendance/requests/${requestId}`, { method: "PATCH", body: JSON.stringify({ action, reviewNote: reviewNote?.trim() || undefined }) }),
  periodRewards: () => apiFetch<{ rewards: Array<{ periodKey: string; tier: string; perk?: string | null; bonusDayOff: number; zeroAlpha: boolean; finalScore: number }> }>("/api/attendance/xp-rewards"),
  runPeriodRewards: (monthKey?: string) => apiFetch<{ monthKey: string; members: number; rewarded: number }>("/api/attendance/xp-rewards", { method: "POST", body: JSON.stringify(monthKey ? { monthKey } : {}) }),
  correctAttendanceRecord: (recordId: string, payload: { checkInAt?: string | null; checkOutAt?: string | null; notes?: string | null; correctionReason?: string }) => apiFetch<{ record?: unknown }>(`/api/attendance/records/${recordId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  // BoD cleanup for bad data: omit `part` to delete the whole record, or part:"checkout" to clear only the check-out (reopen).
  deleteAttendanceRecord: (recordId: string, opts?: { part?: "checkout"; reason?: string }) => {
    const qs = new URLSearchParams();
    if (opts?.part) qs.set("part", opts.part);
    if (opts?.reason) qs.set("reason", opts.reason);
    const q = qs.toString();
    return apiFetch<{ deleted?: boolean; record?: unknown; date?: string }>(`/api/attendance/records/${recordId}${q ? `?${q}` : ""}`, { method: "DELETE" });
  },
  attendanceOffices: () => apiFetch<{ offices: NexusOffice[] }>("/api/attendance/offices"),
  createOffice: (payload: OfficePayload) => apiFetch<{ office?: NexusOffice }>("/api/attendance/offices", { method: "POST", body: JSON.stringify(payload) }),
  deleteOffice: (officeId: string) => apiFetch<{ ok?: boolean }>(`/api/attendance/offices/${officeId}`, { method: "DELETE" }),
  updateOffice: (officeId: string, payload: Partial<OfficePayload>) => apiFetch<{ office?: NexusOffice }>(`/api/attendance/offices/${officeId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  tasks: (query = "") => apiFetch<NexusTask[]>(`/api/tasks${query ? `?${query}` : ""}`),
  createTask: (payload: CreateTaskPayload) => apiFetch<NexusTask>("/api/tasks", { method: "POST", body: JSON.stringify(payload) }),
  updateTask: (taskId: string, payload: Partial<Pick<NexusTask, "title" | "status" | "priority" | "dueDate" | "tags">> & { description?: string | null; taskListId?: string; position?: number; projectContextId?: string }) => apiFetch<NexusTask>(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  goals: () => apiFetch<{ goals: NexusGoal[] }>("/api/goals"),
  createGoal: (payload: { title: string; description?: string | null; workspaceId: string; dueDate?: string | null; parentId?: string | null }) => apiFetch<{ goal: NexusGoal }>("/api/goals", { method: "POST", body: JSON.stringify(payload) }),
  goal: (goalId: string) => apiFetch<{ goal: NexusGoalDetail }>(`/api/goals/${goalId}`),
  updateGoal: (goalId: string, payload: Partial<Pick<NexusGoal, "title" | "description" | "status" | "progress" | "dueDate">> & { parentId?: string | null }) => apiFetch<{ goal: NexusGoal }>(`/api/goals/${goalId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteGoal: (goalId: string) => apiFetch<{ success?: boolean }>(`/api/goals/${goalId}`, { method: "DELETE" }),
  goalLinkProject: (goalId: string, projectId: string, link: boolean) => apiFetch<{ goal?: NexusGoalDetail }>(`/api/goals/${goalId}`, { method: "PATCH", body: JSON.stringify(link ? { linkProject: projectId } : { unlinkProject: projectId }) }),
  goalLinkTask: (goalId: string, taskId: string, link: boolean) => apiFetch<{ goal?: NexusGoalDetail }>(`/api/goals/${goalId}`, { method: "PATCH", body: JSON.stringify(link ? { linkTask: taskId } : { unlinkTask: taskId }) }),
  goalAddMilestone: (goalId: string, title: string, dueDate?: string | null) => apiFetch<{ goal?: NexusGoalDetail }>(`/api/goals/${goalId}`, { method: "PATCH", body: JSON.stringify({ addMilestone: { title, dueDate } }) }),
  goalToggleMilestone: (goalId: string, id: string, completed: boolean) => apiFetch<{ goal?: NexusGoalDetail }>(`/api/goals/${goalId}`, { method: "PATCH", body: JSON.stringify({ toggleMilestone: { id, completed } }) }),
  sprints: (projectId: string) => apiFetch<{ sprints: NexusSprint[] }>(`/api/sprints?projectId=${encodeURIComponent(projectId)}`),
  createSprint: (payload: { name: string; projectId: string; startDate: string; endDate: string }) => apiFetch<{ sprint: NexusSprint }>("/api/sprints", { method: "POST", body: JSON.stringify(payload) }),
  updateSprint: (payload: { id: string; status?: string; addTaskId?: string; removeTaskId?: string; name?: string; startDate?: string; endDate?: string; moveIncompleteTo?: string }) => apiFetch<{ sprint?: NexusSprint; requiresAction?: boolean; incompleteTasks?: NexusTask[] }>("/api/sprints", { method: "PATCH", body: JSON.stringify(payload) }),
  docs: (query = "") => apiFetch<{ docs: NexusDoc[] }>(`/api/docs${query ? `?${query}` : ""}`),
  doc: (docId: string) => apiFetch<{ doc: NexusDoc & { content?: unknown; contentText?: string | null; parentId?: string | null } }>(`/api/docs/${docId}`),
  duplicateDoc: (docId: string) => apiFetch<{ doc: NexusDoc }>(`/api/docs/${docId}/duplicate`, { method: "POST" }),
  docTemplates: () => apiFetch<{ templates: NexusDocTemplate[] }>("/api/docs/templates"),
  projectDocs: (projectId: string) => apiFetch<{ docs: NexusDoc[] }>(`/api/docs?projectId=${encodeURIComponent(projectId)}`),
  createDoc: (payload: { title: string; content?: unknown; projectId: string; parentId?: string | null }) => apiFetch<{ doc: NexusDoc }>("/api/docs", { method: "POST", body: JSON.stringify(payload) }),
  updateDoc: (docId: string, payload: { title?: string; content?: unknown; parentId?: string | null; position?: number; icon?: string | null }) => apiFetch<{ doc: NexusDoc }>(`/api/docs/${docId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteDoc: (docId: string) => apiFetch<{ success: boolean }>(`/api/docs/${docId}`, { method: "DELETE" }),
  notifications: (unreadOnly = false) => apiFetch<{ notifications?: NexusNotification[]; unreadCount?: number }>(`/api/notifications${unreadOnly ? "?unread=true" : ""}`),
  markNotificationRead: (id: string) => apiFetch<{ success: boolean }>("/api/notifications", { method: "PATCH", body: JSON.stringify({ id }) }),
  deleteNotification: (id: string) => apiFetch<{ success?: boolean; deleted?: number }>("/api/notifications", { method: "DELETE", body: JSON.stringify({ id }) }),
  markAllNotificationsRead: () => apiFetch<{ success: boolean }>("/api/notifications", { method: "PATCH", body: JSON.stringify({ markAllRead: true }) }),

  // --- Messages (DM / group / project chat) ---
  /** `totalUnread` (unmuted rooms only) comes from servers since 8 Oct 2026; sum the rows otherwise. */
  conversations: () => apiFetch<{ conversations: NexusConversation[]; totalUnread?: number }>("/api/conversations"),
  /**
   * Cheap badge count. Servers before 8 Oct 2026 have no such route: the path then lands on
   * /api/conversations/[id] with id "unread" and answers 404 — callers fall back to the list.
   */
  conversationsUnread: () => apiFetch<{ totalUnread: number; mentions?: number }>("/api/conversations/unread"),
  conversation: (id: string) => apiFetch<{ conversation: NexusConversation }>(`/api/conversations/${id}`),
  /**
   * `before` = a `nextCursor` or an ISO date (older page); `after` = a message id (only newer ones,
   * oldest first). Servers before 8 Oct 2026 ignore `after` and return the latest page.
   */
  conversationMessages: (id: string, opts: { before?: string; after?: string; around?: string; limit?: number } = {}) => {
    const q = new URLSearchParams();
    if (opts.before) q.set("before", opts.before);
    if (opts.after) q.set("after", opts.after);
    // A page centred on one message (servers since 8 Oct 2026): a search result or a reply quote.
    if (opts.around) q.set("around", opts.around);
    if (opts.limit) q.set("limit", String(opts.limit));
    const qs = q.toString();
    return apiFetch<NexusMessagePage>(`/api/conversations/${id}/messages${qs ? `?${qs}` : ""}`);
  },
  sendMessage: (
    id: string,
    content: string,
    extra?: { mentionedUserIds?: string[]; attachmentUrl?: string; attachmentType?: string; replyToId?: string },
  ) =>
    apiFetch<{ message: NexusMessage }>(`/api/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, ...extra }),
    }),
  /**
   * One image per message, 8MB cap, images only. Membership is checked server-side before a byte is
   * written, and the returned path is the ONLY form sendMessage will accept as an attachment.
   */
  uploadChatImage: (conversationId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("conversationId", conversationId);
    return apiFetch<{ url: string; type: string }>("/api/upload/chat", { method: "POST", body: fd });
  },
  /**
   * Add people to a GROUP chat. The server refuses DMs (two people is what a DM means) and project
   * rooms (their membership is derived from the project), and silently skips anyone outside your
   * workspace or already in the room.
   */
  addConversationMembers: (id: string, userIds: string[]) =>
    apiFetch<{ conversation: NexusConversation; added?: number }>(`/api/conversations/${id}/members`, {
      method: "POST",
      body: JSON.stringify({ userIds }),
    }),
  /** GROUP rooms only: a DM is named after the other person and a project room after its project. */
  renameConversation: (id: string, name: string) =>
    apiFetch<{ conversation: NexusConversation }>(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  /** GROUP rooms only: the description (≤ 500; null or "" clears it). Any member may change it. */
  setConversationDescription: (id: string, description: string | null) =>
    apiFetch<{ conversation: NexusConversation }>(`/api/conversations/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ description }),
    }),
  /**
   * Take someone out of a GROUP (Manager and above; 403 MANAGER_REQUIRED otherwise) — or yourself,
   * which is leaving and open to every member.
   */
  removeConversationMember: (id: string, userId: string) =>
    apiFetch<{ conversation: NexusConversation | null }>(`/api/conversations/${id}/members`, {
      method: "DELETE",
      body: JSON.stringify({ userId }),
    }),
  /**
   * Delete a GROUP (servers since 9 Oct 2026): Manager and above, or its only member. 400 NOT_A_GROUP
   * for a DM or a project room, 403 MANAGER_REQUIRED otherwise. Restorable from Control Room → Audit.
   */
  deleteConversation: (id: string) =>
    apiFetch<{ ok: boolean; conversationId: string; members: number; messages: number }>(`/api/conversations/${id}`, { method: "DELETE" }),
  /** The group info screen: members, permissions, media counts (servers since 8 Oct 2026). */
  conversationInfo: (id: string) => apiFetch<NexusConversationInfo>(`/api/conversations/${id}/info`),
  conversationMedia: (id: string, type: NexusChatMediaType, cursor?: string | null) => {
    const q = new URLSearchParams({ type });
    if (cursor) q.set("cursor", cursor);
    return apiFetch<NexusChatMediaPage>(`/api/conversations/${id}/media?${q.toString()}`);
  },
  /** In-chat search: people's messages only, case-insensitive, at least 2 characters. */
  searchConversation: (id: string, q: string, cursor?: string | null) => {
    const params = new URLSearchParams({ q });
    if (cursor) params.set("cursor", cursor);
    return apiFetch<NexusChatSearchPage>(`/api/conversations/${id}/search?${params.toString()}`);
  },
  createConversation: (payload: { type: "DM" | "GROUP"; userIds: string[]; name?: string }) => apiFetch<{ conversation: NexusConversation }>("/api/conversations", { method: "POST", body: JSON.stringify(payload) }),
  /**
   * Read up to (and including) `upToMessageId` — never further, so a message that lands while the
   * request is in flight stays unread. Servers before 8 Oct 2026 ignore the body and mark "now".
   */
  markConversationRead: (id: string, upToMessageId?: string) =>
    apiFetch<{ success?: boolean }>(`/api/conversations/${id}/read`, {
      method: "POST",
      body: JSON.stringify(upToMessageId ? { upToMessageId } : {}),
    }),
  /**
   * Silence a room for this member: an ISO date, "forever", or null to unmute. A 404 means the
   * server predates muting (8 Oct 2026) — show "not available yet", not an error.
   */
  muteConversation: (id: string, mutedUntil: string | "forever" | null) =>
    apiFetch<{ mutedUntil: string | null }>(`/api/conversations/${id}/mute`, {
      method: "PATCH",
      body: JSON.stringify({ mutedUntil }),
    }),

  // --- Gamification (XP / levels / quests / leaderboard) ---
  gamificationMe: () => apiFetch<NexusGamification>("/api/gamification/me"),
  myPenalties: () => apiFetch<{ penalties: NexusXpPenalty[] }>("/api/gamification/my-penalties"),
  userXpLog: (userId: string, params?: { scope?: "period" | "all"; offset?: number; limit?: number }) => {
    const qs = new URLSearchParams({ userId });
    if (params?.scope) qs.set("scope", params.scope);
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.limit) qs.set("limit", String(params.limit));
    return apiFetch<NexusUserXpLog>(`/api/gamification/xp-log?${qs.toString()}`);
  },
  adjustUserXp: (payload: { userId: string; amount: number; note?: string }) => apiFetch<{ ok: boolean; totalXp: number | null; currentLevel: number | null }>("/api/gamification/xp-adjust", { method: "POST", body: JSON.stringify(payload) }),
  // Member record (/people/:userId): one attendance period of one person — days, counts, XP log,
  // requests. `userId` may be "me". 403 outside the viewer's scope (staff = self, manager = direct reports).
  memberRecord: (userId: string, period?: string) =>
    apiFetch<NexusMemberRecord>(`/api/members/${encodeURIComponent(userId)}/record${period ? `?period=${encodeURIComponent(period)}` : ""}`),
  memberRecordXp: (userId: string, period: string) =>
    apiFetch<{ period: string; xp: NexusRecordXp }>(`/api/members/${encodeURIComponent(userId)}/record?period=${encodeURIComponent(period)}&only=xp`),
  // BoD: remove ONE XP deduction (409 if removed before, 400 if it is not a deduction).
  removeXpDeduction: (transactionId: string, note?: string) =>
    apiFetch<{ ok: boolean; refund: { id: string; transactionId: string; userId: string; amount: number; refunded: number; label: string; dateKey: string | null }; totalXp: number | null }>(
      `/api/gamification/xp-transactions/${encodeURIComponent(transactionId)}/refund`, { method: "POST", body: JSON.stringify(note ? { note } : {}) }),
  claimQuest: (questKey: string) => apiFetch<{ xp?: NexusXp }>("/api/gamification/quests/claim", { method: "POST", body: JSON.stringify({ questKey }) }),
  leaderboard: () => apiFetch<{ rows: NexusLeaderboardRow[]; period?: NexusLeaderboardPeriod }>("/api/gamification/leaderboard"),
  xpAuditLog: (params?: { sign?: "all" | "pos" | "neg"; scope?: "period" | "all"; userId?: string; offset?: number; limit?: number }) => {
    const qs = new URLSearchParams();
    if (params?.sign && params.sign !== "all") qs.set("sign", params.sign);
    if (params?.scope) qs.set("scope", params.scope);
    if (params?.userId) qs.set("userId", params.userId);
    if (params?.offset) qs.set("offset", String(params.offset));
    if (params?.limit) qs.set("limit", String(params.limit));
    const s = qs.toString();
    return apiFetch<NexusXpAuditResponse>(`/api/gamification/xp-transactions${s ? `?${s}` : ""}`);
  },
  adminQuests: (workspaceId?: string) => apiFetch<{ quests: NexusAdminQuest[] }>(`/api/gamification/quests/admin${workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ""}`),
  createAdminQuest: (payload: { workspaceId?: string; title: string; description?: string | null; requirementType: string; requiredCount?: number; xpReward: number; teamIds?: string[]; taskIds?: string[]; deadline?: string | null }) => apiFetch<{ quest: NexusAdminQuest }>("/api/gamification/quests/admin", { method: "POST", body: JSON.stringify(payload) }),
  deleteAdminQuest: (id: string) => apiFetch<{ success?: boolean }>(`/api/gamification/quests/admin?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  // --- Tasks (detail surface) ---
  taskDetail: (taskId: string) => apiFetch<NexusTaskDetail>(`/api/tasks/${taskId}`),
  deleteTask: (taskId: string) => apiFetch<{ success?: boolean }>(`/api/tasks/${taskId}`, { method: "DELETE" }),
  // Backend accepts an optional { dueDate } to override the copy's due date (used by batch duplicate).
  /**
   * Duplicate a task. Pass `taskListId` to copy it into ANOTHER list — which may belong to a
   * different project; `copiedTo` then reports what couldn't come along (custom fields with no
   * counterpart there, assignees who aren't members). Omit it for the in-place duplicate.
   * (The route has always wrapped its result in `{ task }`; the old `NexusTask` signature was wrong.)
   */
  duplicateTask: (taskId: string, dueDate?: string | null, taskListId?: string) =>
    apiFetch<{ task: NexusTask; copiedTo: { projectId: string; droppedAssignees: number; droppedFields: string[] } | null }>(
      `/api/tasks/${taskId}/duplicate`,
      { method: "POST", body: JSON.stringify({ ...(dueDate !== undefined ? { dueDate } : {}), ...(taskListId ? { taskListId } : {}) }) },
    ),
  taskComments: (taskId: string) => apiFetch<{ comments: NexusComment[]; currentUserId?: string }>(`/api/tasks/${taskId}/comments`),
  addComment: (taskId: string, content: string, opts?: { parentId?: string; mentionedUserIds?: string[] }) => apiFetch<NexusComment>(`/api/tasks/${taskId}/comments`, { method: "POST", body: JSON.stringify({ content, ...(opts?.parentId ? { parentId: opts.parentId } : {}), ...(opts?.mentionedUserIds?.length ? { mentionedUserIds: opts.mentionedUserIds } : {}) }) }),
  updateComment: (taskId: string, commentId: string, content: string) => apiFetch<NexusComment>(`/api/tasks/${taskId}/comments/${commentId}`, { method: "PATCH", body: JSON.stringify({ content }) }),
  deleteComment: (taskId: string, commentId: string) => apiFetch<{ success?: boolean }>(`/api/tasks/${taskId}/comments/${commentId}`, { method: "DELETE" }),
  addCommentReaction: (taskId: string, commentId: string, emoji: string) => apiFetch<{ success?: boolean }>(`/api/tasks/${taskId}/comments/${commentId}/reactions`, { method: "POST", body: JSON.stringify({ emoji }) }),
  removeCommentReaction: (taskId: string, commentId: string, emoji: string) => apiFetch<{ success?: boolean }>(`/api/tasks/${taskId}/comments/${commentId}/reactions`, { method: "DELETE", body: JSON.stringify({ emoji }) }),
  addAssignee: (taskId: string, userId: string) => apiFetch<{ success?: boolean }>(`/api/tasks/${taskId}/assignees`, { method: "POST", body: JSON.stringify({ userId }) }),
  removeAssignee: (taskId: string, userId: string) => apiFetch<{ success?: boolean }>(`/api/tasks/${taskId}/assignees`, { method: "DELETE", body: JSON.stringify({ userId }) }),
  toggleTaskLike: (taskId: string, like: boolean) => apiFetch<{ liked?: boolean; likeCount?: number }>(`/api/tasks/${taskId}/likes`, { method: like ? "POST" : "DELETE" }),
  linkTaskProject: (taskId: string, projectId: string, taskListId: string) => apiFetch<{ success?: boolean }>(`/api/tasks/${taskId}/projects`, { method: "POST", body: JSON.stringify({ projectId, taskListId }) }),
  unlinkTaskProject: (taskId: string, projectId: string) => apiFetch<{ success?: boolean }>(`/api/tasks/${taskId}/projects`, { method: "DELETE", body: JSON.stringify({ projectId }) }),
  taskFollowers: (taskId: string) => apiFetch<{ followers: Array<{ id: string; userId?: string; user?: NexusUser | null }>; isFollowing: boolean }>(`/api/tasks/${taskId}/followers`),
  toggleFollow: (taskId: string) => apiFetch<{ following: boolean }>(`/api/tasks/${taskId}/followers`, { method: "POST" }),
  members: () => apiFetch<{ members?: NexusUser[] } | NexusUser[]>("/api/members"),

  // --- The Wire (Feed) — company-wide firehose ---
  feedPosts: (opts?: { cursor?: string; limit?: number; mentions?: "me" }) => {
    const qs = new URLSearchParams();
    if (opts?.cursor) qs.set("cursor", opts.cursor);
    if (opts?.limit) qs.set("limit", String(opts.limit));
    if (opts?.mentions) qs.set("mentions", opts.mentions);
    const s = qs.toString();
    return apiFetch<FeedPage>(`/api/feed/posts${s ? `?${s}` : ""}`);
  },
  createPost: (payload: { text: string; mentions: string[]; images: File[]; imageMeta?: { w?: number; h?: number }[] }) => {
    const fd = new FormData();
    fd.set("text", payload.text);
    fd.set("mentions", JSON.stringify(payload.mentions));
    if (payload.imageMeta) fd.set("imageMeta", JSON.stringify(payload.imageMeta));
    payload.images.forEach((f) => fd.append("images", f));
    return apiFetch<FeedPost>("/api/feed/posts", { method: "POST", body: fd });
  },
  editPost: (id: string, payload: { text: string; mentions: string[] }) => apiFetch<FeedPost>(`/api/feed/posts/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePost: (id: string) => apiFetch<{ success?: boolean }>(`/api/feed/posts/${id}`, { method: "DELETE" }),
  // One post with the viewer's own likedByMe — what a notification's `/threads?post=<id>` opens.
  feedPost: (id: string) => apiFetch<FeedPost>(`/api/feed/posts/${id}`),
  likePost: (id: string) => apiFetch<{ liked: boolean; likeCount: number }>(`/api/feed/posts/${id}/like`, { method: "POST" }),
  postComments: (id: string) => apiFetch<{ comments: FeedComment[] }>(`/api/feed/posts/${id}/comments`),
  addPostComment: (id: string, payload: { text: string; mentions: string[] }) => apiFetch<FeedComment>(`/api/feed/posts/${id}/comments`, { method: "POST", body: JSON.stringify(payload) }),

  // --- Integrity (Peer Reports) ---
  peerReports: (status?: string) => apiFetch<PeerReportList>(`/api/peer-reports${status && status !== "ALL" ? `?status=${status}` : ""}`),
  createPeerReport: (payload: { reportedUserId: string; category: string; reason: string; evidence: File }) => {
    const fd = new FormData();
    fd.set("reportedUserId", payload.reportedUserId);
    fd.set("category", payload.category);
    fd.set("reason", payload.reason);
    fd.set("evidence", payload.evidence);
    return apiFetch<PeerReport>("/api/peer-reports", { method: "POST", body: fd });
  },
  peerReportVerdict: (id: string, payload: { action: "verify" | "reject"; reviewNote?: string }) => apiFetch<PeerReport>(`/api/peer-reports/${id}/verdict`, { method: "POST", body: JSON.stringify(payload) }),
  withdrawPeerReport: (id: string) => apiFetch<PeerReport>(`/api/peer-reports/${id}/withdraw`, { method: "POST" }),
  rebutPeerReport: (id: string, rebuttal: string) => apiFetch<PeerReport>(`/api/peer-reports/${id}/rebuttal`, { method: "POST", body: JSON.stringify({ rebuttal }) }),
  hallOfShame: () => apiFetch<HallOfShame>("/api/peer-reports/hall-of-shame"),

  // --- Legal document generation (invoice / PKS) ---
  generateLegalDocument: (taskId: string) =>
    apiFetch<{
      number: string; series: string; seriesLabel: string; documentId: string; webViewLink: string;
      attachments: { id: string; filename: string; url: string }[];
    }>("/api/legal/documents/generate", { method: "POST", body: JSON.stringify({ taskId }) }),

  // --- Complaint & Escalation channel ---
  complaints: (status?: string) => apiFetch<ComplaintList>(`/api/complaints${status && status !== "ALL" ? `?status=${status}` : ""}`),
  complaint: (id: string) => apiFetch<ComplaintDetail>(`/api/complaints/${id}`),
  createComplaint: (payload: { category: string; subject: string; body: string; evidence: File[] }) => {
    const fd = new FormData();
    fd.set("category", payload.category);
    fd.set("subject", payload.subject);
    fd.set("body", payload.body);
    // append, not set — every photo rides under the same "evidence" key
    for (const file of payload.evidence) fd.append("evidence", file);
    return apiFetch<Complaint>("/api/complaints", { method: "POST", body: fd });
  },
  replyComplaint: (id: string, body: string) => apiFetch<ComplaintDetail>(`/api/complaints/${id}/messages`, { method: "POST", body: JSON.stringify({ body }) }),
  setComplaintStatus: (id: string, status: string) => apiFetch<ComplaintDetail>(`/api/complaints/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }),
  // The ticket detail already carries `corrections`; this endpoint exists for `canDecide`, which the
  // detail payload has no field for (its `canManage` is about ticket status, not attendance writes).
  complaintCorrections: (id: string) => apiFetch<AttendanceCorrectionList>(`/api/complaints/${id}/correction`),
  decideComplaintCorrection: (id: string, payload: { decision: "APPROVE" | "REJECT"; correctionId?: string; note?: string }) =>
    apiFetch<AttendanceCorrectionDecision>(`/api/complaints/${id}/correction`, { method: "POST", body: JSON.stringify(payload) }),
  // Same route, the other direction: the reporter files the change they are asking for, so a BoD has
  // something to approve even when GIDEON declined to draft one or was down.
  proposeComplaintCorrection: (
    id: string,
    // kind omitted = TIME_CORRECTION, so every existing caller keeps working. A PENALTY_CANCELLATION
    // takes no times: passing one would reopen the mistake that kind exists to end.
    payload: { date: string; checkInAt?: string; checkOutAt?: string; reason: string; kind?: AttendanceCorrectionKind },
  ) =>
    apiFetch<{ correction: AttendanceCorrection }>(`/api/complaints/${id}/correction`, {
      method: "POST",
      body: JSON.stringify({ decision: "PROPOSE", ...payload }),
    }),

  // --- Workspace members (org roles: BoD / Manager / Staff) ---
  workspaceMembers: (workspaceId?: string, includeRegistered = false) => {
    const qs = new URLSearchParams();
    if (workspaceId) qs.set("workspaceId", workspaceId);
    if (includeRegistered) qs.set("includeRegistered", "1");
    const s = qs.toString();
    return apiFetch<WorkspaceMembersResponse>(`/api/workspaces/members${s ? `?${s}` : ""}`);
  },
  /** `absorbPersonalWorkspace`: hapus workspace pribadi kosong yang dibuat saat daftar tanpa kode,
   *  supaya workspace ini benar-benar jadi rumahnya (workspace aktif dipilih dari joinedAt tertua). */
  inviteWorkspaceMember: (payload: { email: string; role?: OrgRole; attendanceRole?: string; workspaceId?: string; absorbPersonalWorkspace?: boolean }) =>
    // emailSent: false = member added but the notification email didn't go out (tell the admin).
    // accountCreated: true = no account existed; the invitee sets a password via /forgot-password.
    apiFetch<{ member: NexusWorkspaceMember; absorbed?: string[]; kept?: string[]; emailSent?: boolean; accountCreated?: boolean }>("/api/workspaces/members", { method: "POST", body: JSON.stringify(payload) }),
  updateWorkspaceMember: (payload: { memberId: string; role?: OrgRole; attendanceRole?: string; workspaceId?: string; attendanceShiftStartTime?: string | null; attendanceShiftEndTime?: string | null; attendanceShiftByDay?: Record<string, { start: string; end: string }> | null; phoneNumber?: string | null; flexiTimeEnabled?: boolean; noGeofenceMode?: boolean; approverId?: string | null; restDays?: number[] }) =>
    apiFetch<{ member: NexusWorkspaceMember; orphaned?: Array<{ id: string; name: string | null }> }>("/api/workspaces/members", { method: "PATCH", body: JSON.stringify(payload) }),
  /** Seluruh Bagan Approval dalam satu panggilan. BoD saja. */
  approvalChart: () => apiFetch<ApprovalChart>("/api/admin/approval-chart"),
  orgChart: () => apiFetch<OrgChart>("/api/admin/org-chart"),
  createOrgUnit: (body: { name: string; parentId?: string | null; kind?: "IP" | "DIVISION" | "GROUP" }) =>
    apiFetch<{ unit: OrgUnit }>("/api/admin/org-chart", { method: "POST", body: JSON.stringify(body) }),
  updateOrgUnit: (id: string, body: { name?: string; kind?: "IP" | "DIVISION" | "GROUP"; parentId?: string | null; position?: number; logoUrl?: string | null; leadUserId?: string | null; layoutX?: number | null; layoutY?: number | null; boxLayout?: Record<string, { x: number; y: number } | null> | null }) =>
    apiFetch<{ unit: OrgUnit }>(`/api/admin/org-chart/units/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(body) }),
  deleteOrgUnit: (id: string) =>
    apiFetch<{ ok: true; movedUp: number; released: number }>(`/api/admin/org-chart/units/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addOrgUnitMember: (userId: string, unitId: string) =>
    apiFetch<{ ok: true }>("/api/admin/org-chart/members", { method: "POST", body: JSON.stringify({ userId, unitId }) }),
  setOrgUnitMemberTitle: (userId: string, unitId: string, title: string | null) =>
    apiFetch<{ ok: true; title: string | null }>("/api/admin/org-chart/members", { method: "PATCH", body: JSON.stringify({ userId, unitId, title }) }),
  setOrgUnitMemberReportsTo: (userId: string, unitId: string, reportsToUserId: string | null) =>
    apiFetch<{ ok: true }>("/api/admin/org-chart/members", { method: "PATCH", body: JSON.stringify({ userId, unitId, reportsToUserId }) }),
  resetOrgChartLayout: () =>
    apiFetch<{ ok: true; reset: number }>("/api/admin/org-chart/layout", { method: "POST", body: JSON.stringify({ action: "reset" }) }),
  removeOrgUnitMember: (userId: string, unitId: string) =>
    apiFetch<{ ok: true; removed: number }>(`/api/admin/org-chart/members?userId=${encodeURIComponent(userId)}&unitId=${encodeURIComponent(unitId)}`, { method: "DELETE" }),
  uploadOrgUnitLogo: (unitId: string, file: File) => {
    const fd = new FormData();
    fd.append("unitId", unitId);
    fd.append("file", file);
    return apiFetch<{ unit: OrgUnit }>("/api/admin/org-chart/logo", { method: "POST", body: fd });
  },
  removeWorkspaceMember: (memberId: string, workspaceId?: string) =>
    apiFetch<{ success?: boolean }>(`/api/workspaces/members?memberId=${encodeURIComponent(memberId)}${workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ""}`, { method: "DELETE" }),
  // Per-user day-off management (BoD only) for Control Room → Members.
  userDayoffs: (userId: string, month?: string) =>
    apiFetch<{ month: string; quota: number; quotaOverride: number | null; defaultQuota: number; used: number; dayoffs: NexusDayoff[]; baseQuota?: number; bonusDays?: number; bonusGrants?: { id: string; days: number; reason: string }[] }>(`/api/attendance/dayoffs?userId=${encodeURIComponent(userId)}${month ? `&month=${encodeURIComponent(month)}` : ""}`),
  grantDayoff: (payload: { userId: string; date: string; reason?: string }) =>
    apiFetch<{ dayoff: NexusDayoff }>("/api/attendance/dayoffs", { method: "POST", body: JSON.stringify(payload) }),
  deleteDayoff: (id: string) =>
    apiFetch<{ message: string }>(`/api/attendance/dayoffs?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Extra day off for one attendance period (BoD grants; everyone can list their own).
  suspectAttendance: (periodKey?: string) =>
    apiFetch<NexusSuspectList>(`/api/attendance/suspects${periodKey ? `?periodKey=${encodeURIComponent(periodKey)}` : ""}`),
  reviewSuspectAttendance: (recordId: string, payload: { verdict: "VALID" | "INVALID"; note: string }) =>
    apiFetch<{ ok: boolean; recordId: string; verdict: string; date: string }>(`/api/attendance/suspects/${encodeURIComponent(recordId)}/review`, { method: "POST", body: JSON.stringify(payload) }),
  warnSuspectAttendance: (recordId: string, message: string) =>
    apiFetch<{ ok: boolean; announcementId: string }>(`/api/attendance/suspects/${encodeURIComponent(recordId)}/warn`, { method: "POST", body: JSON.stringify({ message }) }),
  dayOffBonuses: (periodKey?: string) =>
    apiFetch<NexusDayOffBonusList>(`/api/attendance/day-off-bonus${periodKey ? `?periodKey=${encodeURIComponent(periodKey)}` : ""}`),
  grantDayOffBonus: (payload: { userIds: string[]; periodKey: string; days: number; reason: string }) =>
    apiFetch<{ periodKey: string; periodLabel: string; periodStart: string; periodEnd: string; days: number; notified: number; grants: NexusDayOffBonus[] }>("/api/attendance/day-off-bonus", { method: "POST", body: JSON.stringify(payload) }),
  revokeDayOffBonus: (id: string) =>
    apiFetch<{ grant: NexusDayOffBonus; alreadyRevoked: boolean }>(`/api/attendance/day-off-bonus/${encodeURIComponent(id)}`, { method: "DELETE" }),
  // Set/reset a member's monthly day-off quota (quota = number, or null to reset to default 4).
  setDayoffQuota: (userId: string, quota: number | null) =>
    apiFetch<{ quota: number; quotaOverride: number | null }>("/api/attendance/dayoffs", { method: "PATCH", body: JSON.stringify({ userId, quota }) }),
  // Monthly "tanggal merah" quota (jatah), company-wide, set by BoD per month.
  redDateQuota: (month?: string) =>
    apiFetch<{ month: string; quota: number; canManage: boolean }>(`/api/attendance/red-date-quota${month ? `?month=${encodeURIComponent(month)}` : ""}`),
  setRedDateQuota: (month: string, quota: number) =>
    apiFetch<{ month: string; quota: number; canManage: boolean }>("/api/attendance/red-date-quota", { method: "POST", body: JSON.stringify({ month, quota }) }),
  // Company-wide public holidays (tanggal merah) — read by anyone, write by BoD.
  holidays: (month?: string) =>
    apiFetch<{ month: string; canManage: boolean; holidays: NexusHoliday[] }>(`/api/attendance/holidays${month ? `?month=${encodeURIComponent(month)}` : ""}`),
  addHoliday: (payload: { date: string; name: string }) =>
    apiFetch<{ holiday: NexusHoliday }>("/api/attendance/holidays", { method: "POST", body: JSON.stringify(payload) }),
  deleteHoliday: (id: string) =>
    apiFetch<{ message: string }>(`/api/attendance/holidays?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  resetMemberPassword: (memberId: string, password: string) =>
    apiFetch<{ success?: boolean }>(`/api/workspaces/members/${encodeURIComponent(memberId)}/password`, { method: "POST", body: JSON.stringify({ password }) }),

  // --- Custom fields ---
  taskCustomFields: (projectId: string, taskId: string) => apiFetch<{ fields: NexusCustomField[] }>(`/api/custom-fields?projectId=${encodeURIComponent(projectId)}&taskId=${encodeURIComponent(taskId)}`),
  projectCustomFields: (projectId: string) => apiFetch<{ fields: NexusCustomField[] }>(`/api/custom-fields?projectId=${encodeURIComponent(projectId)}`),
  setCustomFieldValue: (id: string, taskId: string, value: unknown) => apiFetch<{ success?: boolean }>("/api/custom-fields", { method: "PATCH", body: JSON.stringify({ id, taskId, value }) }),
  uploadCustomFieldFile: (projectId: string, file: File) => {
    const fd = new FormData();
    fd.set("projectId", projectId); fd.set("file", file);
    return apiFetch<CustomFieldFile>("/api/custom-fields/upload", { method: "POST", body: fd });
  },
  // --- Custom field DEFINITIONS (manage per-project) ---
  createCustomField: (projectId: string, payload: { name: string; type: string; options?: NexusCustomFieldOptions | null }) => apiFetch<{ field: NexusCustomField }>("/api/custom-fields", { method: "POST", body: JSON.stringify({ projectId, name: payload.name, type: payload.type, options: payload.options ?? undefined, saveToLibrary: false }) }),
  updateCustomField: (id: string, payload: { name?: string; type?: string; options?: NexusCustomFieldOptions | null }) => apiFetch<{ field: NexusCustomField }>("/api/custom-fields", { method: "PATCH", body: JSON.stringify({ id, ...payload }) }),
  deleteCustomField: (id: string) => apiFetch<{ success?: boolean }>(`/api/custom-fields?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  reorderCustomFields: (projectId: string, orderedIds: string[]) => apiFetch<{ success?: boolean }>("/api/custom-fields", { method: "PATCH", body: JSON.stringify({ projectId, reorder: orderedIds.map((id) => ({ id })) }) }),

  // --- Task dependencies + time entries ---
  taskDependencies: (taskId: string) => apiFetch<{ dependencies: NexusDependency[]; dependedOnBy: NexusDependency[] }>(`/api/tasks/${taskId}/dependencies`),
  addDependency: (taskId: string, dependsOnTaskId: string, type = "BLOCKING") => apiFetch<{ dependency: NexusDependency }>(`/api/tasks/${taskId}/dependencies`, { method: "POST", body: JSON.stringify({ dependsOnTaskId, type }) }),
  removeDependency: (taskId: string, id: string) => apiFetch<{ success?: boolean }>(`/api/tasks/${taskId}/dependencies?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  timeEntries: (taskId: string) => apiFetch<{ entries: NexusTimeEntry[] }>(`/api/time-entries?taskId=${encodeURIComponent(taskId)}`),
  logTime: (payload: { taskId: string; duration: number; description?: string | null }) => apiFetch<{ entry: NexusTimeEntry }>("/api/time-entries", { method: "POST", body: JSON.stringify(payload) }),

  // --- Z Vault ---
  vaultList: (opts: { parentId?: string | null; trash?: boolean; q?: string } = {}) => {
    const qs = new URLSearchParams();
    if (opts.parentId) qs.set("parentId", opts.parentId);
    if (opts.trash) qs.set("trash", "1");
    if (opts.q) qs.set("q", opts.q);
    const suffix = qs.toString();
    return apiFetch<VaultListing>(`/api/vault/items${suffix ? `?${suffix}` : ""}`);
  },
  vaultItem: (itemId: string) =>
    apiFetch<{ item: VaultItem; breadcrumb: { id: string; name: string }[] }>(`/api/vault/items/${itemId}`),
  vaultCreateFolder: (name: string, parentId: string | null) =>
    apiFetch<VaultItem>("/api/vault/items", { method: "POST", body: JSON.stringify({ name, parentId }) }),
  vaultUpdateItem: (
    itemId: string,
    body: { name?: string; parentId?: string | null; restore?: boolean; minReadRole?: string | null; minWriteRole?: string | null },
  ) => apiFetch<VaultItem>(`/api/vault/items/${itemId}`, { method: "PATCH", body: JSON.stringify(body) }),
  vaultDeleteItem: (itemId: string, purge = false) =>
    apiFetch<{ trashed?: number; purged?: number; filesUnlinked?: number }>(
      `/api/vault/items/${itemId}${purge ? "?purge=1" : ""}`,
      { method: "DELETE" },
    ),
  vaultEmptyTrash: () =>
    apiFetch<{ purged: number; filesUnlinked: number }>("/api/vault/trash/empty", { method: "POST" }),
  vaultShares: (itemId: string) =>
    apiFetch<{ shares: VaultShare[]; canShareExternally?: boolean }>(`/api/vault/shares?itemId=${encodeURIComponent(itemId)}`),
  vaultCreateShare: (body: { itemId: string; requireAuth: boolean; allowDownload: boolean; expires: VaultShareExpiry }) =>
    apiFetch<VaultShare>("/api/vault/shares", { method: "POST", body: JSON.stringify(body) }),
  vaultRevokeShare: (shareId: string) =>
    apiFetch<VaultShare>(`/api/vault/shares/${shareId}`, { method: "DELETE" }),
  vaultPublic: (slug: string) => apiFetch<VaultPublicFile>(`/api/vault/public/${encodeURIComponent(slug)}`),
  vaultPublicItems: (slug: string, folderId?: string | null) =>
    apiFetch<VaultPublicListing>(
      `/api/vault/public/${encodeURIComponent(slug)}/items${folderId ? `?folderId=${encodeURIComponent(folderId)}` : ""}`,
    ),
  androidRelease: () => apiFetch<AndroidReleaseInfo>("/api/app/android/release"),

  // Small files go single-shot; anything larger rides the shared chunked transport with target=vault,
  // which is what makes the browser ceiling match the phone's instead of stopping at 640MB.
  vaultUpload: (file: File, parentId: string | null, onProgress: (pct: number) => void, control?: UploadControl): Promise<VaultItem> => {
    if (file.size <= UPLOAD_CHUNK_THRESHOLD) {
      const fd = new FormData();
      fd.set("file", file);
      if (parentId) fd.set("parentId", parentId);
      return xhrUpload<VaultItem>("/api/vault/upload", fd, file, onProgress, control);
    }
    return uploadChunked<VaultItem>(file, { target: "vault", ...(parentId ? { parentId } : {}) }, onProgress, control);
  },

  // Replace file… (9 Oct 2026): new bytes for the same item — same id, same links. Small files go to
  // /api/vault/items/<id>/replace; larger ones ride the chunked transport with `replaceItemId`.
  vaultReplace: (itemId: string, file: File, onProgress: (pct: number) => void, control?: UploadControl): Promise<VaultItem> => {
    if (file.size <= UPLOAD_CHUNK_THRESHOLD) {
      const fd = new FormData();
      fd.set("file", file);
      return xhrUpload<VaultItem>(`/api/vault/items/${encodeURIComponent(itemId)}/replace`, fd, file, onProgress, control);
    }
    return uploadChunked<VaultItem>(file, { target: "vault", replaceItemId: itemId }, onProgress, control);
  },

  /** How many files and bytes a multi-item zip would hold, or a 413 ZIP_TOO_BIG — asked before the
   *  download itself, which the browser makes as a plain form post (see vaultZipDownload). */
  vaultZipCheck: (ids: string[]) =>
    apiFetch<{ ok: true; files: number; bytes: number }>("/api/vault/zip?check=1", { method: "POST", body: JSON.stringify({ ids }) }),

  // --- Attachments ---
  taskAttachments: (taskId: string) => apiFetch<NexusAttachment[]>(`/api/attachments?taskId=${encodeURIComponent(taskId)}`),
  uploadAttachment: (taskId: string, file: File, kind: "GENERAL" | "PROOF" = "GENERAL") => {
    const fd = new FormData();
    fd.set("taskId", taskId); fd.set("file", file); fd.set("kind", kind);
    return apiFetch<NexusAttachment>("/api/attachments", { method: "POST", body: fd });
  },
  // XHR variant so we can report upload progress (fetch can't). onProgress gets 0..100.
  // Files over CHUNK_THRESHOLD go through /api/attachments/chunk, which STREAMS the raw body to disk at
  // constant memory (and nginx request-buffering is off for that path). Each chunk is ≤CHUNK_SIZE so it
  // stays under Cloudflare's ~100MB cap. Only genuinely small files use the single-shot path (which
  // buffers the whole file in memory + gets spooled to an nginx temp file), so we keep that band small.
  uploadAttachmentProgress: (taskId: string, file: File, onProgress: (pct: number) => void, kind: "GENERAL" | "PROOF" = "GENERAL"): Promise<NexusAttachment> => {

    // ---- small file: single request, native upload progress ----
    if (file.size <= UPLOAD_CHUNK_THRESHOLD) {
      return new Promise<NexusAttachment>((resolve, reject) => {
        const fd = new FormData();
        fd.set("taskId", taskId); fd.set("file", file); fd.set("kind", kind);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/attachments");
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText) as NexusAttachment); } catch { resolve({} as NexusAttachment); }
          } else reject(new ApiError(xhr.status, "Upload failed.", null));
        };
        xhr.onerror = () => reject(new Error("Upload failed."));
        xhr.send(fd);
      });
    }

    // ---- large file: the shared chunked transport (see uploadChunked above) ----
    return uploadChunked<NexusAttachment>(file, { taskId, kind }, onProgress);
  },
  deleteAttachment: (attachmentId: string) => apiFetch<{ success?: boolean }>(`/api/attachments/${attachmentId}`, { method: "DELETE" }),

  // --- Image uploads (avatar / project icon) ---
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    return apiFetch<{ user: NexusUser; url: string }>("/api/upload/avatar", { method: "POST", body: fd });
  },
  deleteAvatar: () => apiFetch<{ ok?: boolean; success?: boolean }>("/api/upload/avatar", { method: "DELETE" }),
  /** Foto profil orang LAIN, oleh BoD, lewat keanggotaan workspace-nya. Field multipart "file". */
  uploadMemberAvatar: (memberId: string, file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    return apiFetch<{ member?: { avatar?: string | null } }>(`/api/workspaces/members/${encodeURIComponent(memberId)}/avatar`, { method: "POST", body: fd });
  },
  /** Identitas akun orang lain — nama, email login, sandi baru. BoD ke atas; server menolak sisanya. */
  updateAdminAccount: (userId: string, body: { name?: string; email?: string; password?: string }) =>
    apiFetch<{ user?: NexusAdminUser }>(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify(body) }),
  uploadProjectIcon: (projectId: string, file: File) => {
    const fd = new FormData();
    fd.set("file", file); fd.set("projectId", projectId);
    return apiFetch<{ url: string }>("/api/upload/project-icon", { method: "POST", body: fd });
  },
  // Backend persists the url onto folder.icon itself (and returns it).
  uploadFolderIcon: (folderId: string, file: File) => {
    const fd = new FormData();
    fd.set("file", file); fd.set("folderId", folderId);
    return apiFetch<{ url: string }>("/api/upload/folder-icon", { method: "POST", body: fd });
  },

  // --- Search + Favorites ---
  search: (q: string) => apiFetch<NexusSearchResults>(`/api/search?q=${encodeURIComponent(q)}`),
  favorites: () => apiFetch<NexusFavorite[]>("/api/favorites"),
  toggleFavorite: (type: string, targetId: string) => apiFetch<{ favorited: boolean }>("/api/favorites", { method: "POST", body: JSON.stringify({ type, targetId }) }),

  // --- Admin + Settings ---
  adminUsers: (query = "") => apiFetch<{ users: NexusAdminUser[]; pagination?: { total: number; page: number; pageSize: number; totalPages: number } }>(`/api/admin/users${query ? `?${query}` : ""}`),
  // Fetches ALL users across every page (the endpoint caps pageSize at 50).
  adminUsersAll: async () => {
    const first = await apiFetch<{ users: NexusAdminUser[]; pagination?: { total: number; totalPages: number } }>(`/api/admin/users?pageSize=50&page=1`);
    const users = [...first.users];
    const totalPages = first.pagination?.totalPages ?? 1;
    for (let p = 2; p <= totalPages; p++) {
      const r = await apiFetch<{ users: NexusAdminUser[] }>(`/api/admin/users?pageSize=50&page=${p}`);
      users.push(...r.users);
    }
    return { users, total: first.pagination?.total ?? users.length };
  },
  auditLogs: (query = "") => apiFetch<{ logs: NexusAuditLog[]; total: number }>(`/api/audit${query ? `?${query}` : ""}`),
  auditEntry: (id: string) => apiFetch<NexusAuditEntryDetail>(`/api/audit/${encodeURIComponent(id)}`),
  auditRestore: (id: string) => apiFetch<NexusAuditRestoreResult>(`/api/audit/${encodeURIComponent(id)}/restore`, { method: "POST" }),
  updateUserRole: (userId: string, role: string) => apiFetch<{ user?: NexusAdminUser }>(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  googleWorkspaceAccounts: () => apiFetch<GoogleWorkspaceAccounts>("/api/admin/google-workspace/accounts"),
  // Membuat mailbox BARU lalu menautkannya. BoD saja — ini satu-satunya panggilan di NEXUS yang
  // mengisi seat lisensi berbayar.
  createGoogleWorkspaceAccount: (body: { userId: string; localPart: string; domain: string; givenName: string; familyName: string }) =>
    apiFetch<CreatedGoogleAccount>("/api/admin/google-workspace/users", { method: "POST", body: JSON.stringify(body) }),
  // `null` melepas tautan. Server memverifikasi alamatnya benar-benar ada di Google sebelum
  // menyimpan, jadi kegagalan di sini berarti alamatnya tidak ada atau sudah dipakai orang lain
  // — dua hal yang pesannya perlu sampai ke layar apa adanya.
  linkGoogleWorkspace: (userId: string, googleWorkspaceEmail: string | null) =>
    apiFetch<{ user?: NexusAdminUser }>(`/api/admin/users/${userId}`, {
      method: "PATCH",
      body: JSON.stringify({ googleWorkspaceEmail }),
    }),
  offboardUser: (userId: string, body: { lastWorkingDay: string; reason: OffboardReason; note?: string | null }) =>
    apiFetch<NexusOffboardResult>(`/api/admin/users/${userId}/offboard`, { method: "POST", body: JSON.stringify(body) }),
  reinstateUser: (userId: string) => apiFetch<NexusReinstateResult>(`/api/admin/users/${userId}/reinstate`, { method: "POST", body: JSON.stringify({}) }),
  deleteUser: (userId: string) => apiFetch<{ ok: boolean; deletedUser: { id: string; name: string; email: string }; reassigned: Record<string, number>; purged: Record<string, number> }>(`/api/admin/users/${userId}`, { method: "DELETE" }),
  bufferDrafts: () => apiFetch<BufferDraftsResponse>("/api/buffer/drafts"),
  bufferApprove: (postId: string, mode: "queue" | "schedule" | "now", dueAt?: string) => apiFetch<{ ok: boolean }>("/api/buffer/approve", { method: "POST", body: JSON.stringify({ postId, mode, dueAt }) }),
  bufferReject: (postId: string) => apiFetch<{ ok: boolean }>("/api/buffer/reject", { method: "POST", body: JSON.stringify({ postId }) }),
  updateProfile: (payload: { name?: string; phoneNumber?: string | null; dndUntil?: string | null; markOnboarded?: boolean }) => apiFetch<{ user?: NexusUser }>("/api/user/profile", { method: "PATCH", body: JSON.stringify(payload) }),
  requestEmailChange: (email: string, currentPassword: string) => apiFetch<{ ok: boolean; resendInSeconds?: number }>("/api/user/email/request", { method: "POST", body: JSON.stringify({ email, currentPassword }) }),
  verifyEmailChange: (email: string, code: string) => apiFetch<{ ok: boolean; email: string }>("/api/user/email/verify", { method: "POST", body: JSON.stringify({ email, code }) }),
  changePassword: (currentPassword: string, newPassword: string) => apiFetch<{ success?: boolean }>("/api/user/password", { method: "PATCH", body: JSON.stringify({ currentPassword, newPassword }) }),
  notificationPreferences: () => apiFetch<{ preferences?: NexusNotificationPrefs }>("/api/notifications/preferences"),
  updateNotificationPreferences: (payload: Partial<NexusNotificationPrefs>) => apiFetch<{ preferences?: NexusNotificationPrefs }>("/api/notifications/preferences", { method: "PATCH", body: JSON.stringify(payload) }),
  // WhatsApp bot linking (Gideon)
  waLinkStatus: () => apiFetch<{ linked: boolean }>("/api/notifications/wa/link"),
  waLinkGenerate: () => apiFetch<{ code: string; expiresAt: string; deepLink: string | null; botNumber: string | null }>("/api/notifications/wa/link", { method: "POST" }),
  waUnlink: () => apiFetch<{ ok?: boolean }>("/api/notifications/wa/link", { method: "DELETE" }),

  // --- Webhooks + sessions ---
  webhooks: () => apiFetch<NexusWebhook[]>("/api/webhooks"),
  createWebhook: (payload: { url: string; events: string[]; projectId?: string | null }) => apiFetch<NexusWebhook>("/api/webhooks", { method: "POST", body: JSON.stringify(payload) }),
  deleteWebhook: (id: string) => apiFetch<{ success?: boolean }>(`/api/webhooks/${id}`, { method: "DELETE" }),
  userSessions: () => apiFetch<{ sessions: NexusSession[] }>("/api/user/sessions"),
  revokeSession: (id: string) => apiFetch<{ success?: boolean }>(`/api/user/sessions/${id}`, { method: "DELETE" }),

  // --- Passkeys (WebAuthn credentials on this account) ---
  passkeys: () => apiFetch<{ passkeys: NexusPasskey[] }>("/api/auth/passkey"),
  deletePasskey: (id: string) => apiFetch<{ ok?: boolean }>(`/api/auth/passkey/${encodeURIComponent(id)}`, { method: "DELETE" }),

  // --- MCP / API tokens (connect Claude to NEXUS, task-scoped) ---
  mcpTokens: () => apiFetch<{ tokens: NexusApiToken[] }>("/api/mcp/tokens"),
  createMcpToken: (payload: { name?: string; expiresInDays?: number }) => apiFetch<NexusApiTokenCreated>("/api/mcp/tokens", { method: "POST", body: JSON.stringify(payload) }),
  revokeMcpToken: (id: string) => apiFetch<{ revoked?: boolean }>(`/api/mcp/tokens?id=${encodeURIComponent(id)}`, { method: "DELETE" }),

  // --- MCP OAuth consent (backs the /oauth/authorize SPA page) ---
  oauthAuthorizeInfo: (params: { client_id: string; redirect_uri: string }) =>
    apiFetch<{ clientName: string; redirectHost?: string; user: { name: string | null; email: string | null }; scopes: string[] }>(`/api/mcp/oauth/authorize/info?client_id=${encodeURIComponent(params.client_id)}&redirect_uri=${encodeURIComponent(params.redirect_uri)}`),
  oauthAuthorizeDecision: (body: Record<string, unknown>) =>
    apiFetch<{ redirectTo: string }>("/api/mcp/oauth/authorize/decision", { method: "POST", body: JSON.stringify(body) }),

  // --- Portfolios ---
  portfolios: () => apiFetch<NexusPortfolio[]>("/api/portfolios"),
  createPortfolio: (payload: { name: string; description?: string | null; workspaceId: string; projectIds?: string[] }) => apiFetch<NexusPortfolio>("/api/portfolios", { method: "POST", body: JSON.stringify(payload) }),
  updatePortfolio: (portfolioId: string, payload: { name?: string; description?: string | null; projectIds?: string[] }) => apiFetch<NexusPortfolio>(`/api/portfolios/${portfolioId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deletePortfolio: (portfolioId: string) => apiFetch<{ success?: boolean }>(`/api/portfolios/${portfolioId}`, { method: "DELETE" }),

  // --- Reports ---
  reports: (query = "days=30") => apiFetch<NexusReports>(`/api/reports?${query}`),
  // Reports per crew. userId may be "me". Scope is enforced server-side (403 REPORT_OUT_OF_SCOPE / REPORT_SELF_ONLY).
  personReport: (userId: string, period?: ReportPeriodQuery | null) =>
    apiFetch<PersonReportResponse>(withQuery(`/api/reports/people/${encodeURIComponent(userId)}`, reportPeriodParams(period))),
  reportRoster: (opts: { period?: ReportPeriodQuery | null; teamId?: string | null; userIds?: string[] | "me" } = {}) => {
    const qs = reportPeriodParams(opts.period);
    if (opts.teamId) qs.set("teamId", opts.teamId);
    if (opts.userIds) qs.set("userIds", opts.userIds === "me" ? "me" : opts.userIds.join(","));
    return apiFetch<ReportRosterResponse>(withQuery("/api/reports/people", qs));
  },

  // --- Automations ---
  automations: (projectId: string) => apiFetch<{ automations: NexusAutomation[] }>(`/api/automations?projectId=${encodeURIComponent(projectId)}`),
  createAutomation: (payload: { name: string; projectId: string; trigger: NexusAutomationRule; action: NexusAutomationRule }) => apiFetch<{ automation: NexusAutomation }>("/api/automations", { method: "POST", body: JSON.stringify(payload) }),
  updateAutomation: (payload: { id: string; enabled?: boolean; name?: string; trigger?: NexusAutomationRule; action?: NexusAutomationRule }) => apiFetch<{ automation: NexusAutomation }>("/api/automations", { method: "PATCH", body: JSON.stringify(payload) }),
  deleteAutomation: (id: string) => apiFetch<{ success?: boolean }>(`/api/automations?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  automationSuggestions: (projectId: string) => apiFetch<{ suggestions: Array<{ name: string; trigger: NexusAutomationRule; action: NexusAutomationRule }> }>(`/api/automations/suggestions?projectId=${encodeURIComponent(projectId)}`, { method: "POST" }),

  // --- Forms ---
  forms: (projectId: string) => apiFetch<NexusForm[]>(`/api/forms?projectId=${encodeURIComponent(projectId)}`),
  form: (formId: string) => apiFetch<NexusForm>(`/api/forms/${formId}`),
  createForm: (payload: { name: string; description?: string | null; fields: NexusFormField[]; isPublic?: boolean; requireAuth?: boolean; projectId: string; accessSchedule?: unknown }) => apiFetch<NexusForm>("/api/forms", { method: "POST", body: JSON.stringify(payload) }),
  updateForm: (formId: string, payload: { name?: string; description?: string | null; fields?: NexusFormField[]; isPublic?: boolean; requireAuth?: boolean; accessSchedule?: unknown }) => apiFetch<NexusForm>(`/api/forms/${formId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteForm: (formId: string, force?: boolean) => apiFetch<{ success?: boolean }>(`/api/forms/${formId}${force ? "?force=1" : ""}`, { method: "DELETE" }),
  publicForm: (formId: string) => apiFetch<NexusForm>(`/api/forms/${formId}/public`),
  mySubmissions: () => apiFetch<{ submissions: NexusMySubmission[]; statusColumns?: string[] }>(`/api/forms/my-submissions`),
  submissionDetail: (id: string) => apiFetch<NexusSubmissionDetail>(`/api/forms/my-submissions/${id}`),
  deleteSubmission: (id: string) => apiFetch<{ deleted?: boolean }>(`/api/forms/my-submissions/${id}`, { method: "DELETE" }),

  // --- Announcements (BoD pop-ups) ---
  activeAnnouncements: () => apiFetch<{ announcements: NexusAnnouncement[] }>("/api/announcements/active"),
  /** One announcement by id, seen or not — what `?announcement=` on a tapped notification resolves. */
  announcement: (id: string) => apiFetch<{ announcement: NexusAnnouncement & { authorName?: string | null } }>(`/api/announcements/${id}`),
  dismissAnnouncement: (id: string) => apiFetch<{ ok?: boolean }>(`/api/announcements/${id}/seen`, { method: "POST" }),
  announcements: () => apiFetch<{ announcements: NexusAdminAnnouncement[] }>("/api/announcements"),
  uploadAnnouncementAttachment: (file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch<{ url: string; name: string; size: number }>("/api/announcements/attachment", { method: "POST", body: fd });
  },
  createAnnouncement: (payload: { title: string; body: string; tone?: string; targetUserIds?: string[]; repeatDays?: number; repeatAtTime?: string; kind?: "announcement" | "sp"; attachmentUrl?: string; attachmentName?: string }) => apiFetch<{ announcement: NexusAdminAnnouncement }>("/api/announcements", { method: "POST", body: JSON.stringify(payload) }),
  updateAnnouncement: (id: string, payload: { title?: string; body?: string; tone?: string; active?: boolean }) => apiFetch<{ announcement: NexusAdminAnnouncement }>(`/api/announcements/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteAnnouncement: (id: string) => apiFetch<{ ok?: boolean }>(`/api/announcements/${id}`, { method: "DELETE" }),

  // --- Finance dashboard (per Finance project, monthly OPEX/Revenue) ---
  financeDashboard: (projectId: string, year: number) => apiFetch<NexusFinanceDashboard>(`/api/finance/dashboard?projectId=${encodeURIComponent(projectId)}&year=${year}`),
  setFinanceValue: (payload: { projectId: string; lineItemId: string; year: number; month: number; amount: number }) => apiFetch<{ value: unknown }>("/api/finance/value", { method: "PATCH", body: JSON.stringify(payload) }),

  // --- P&L dashboard (standalone, BoD-only) ---
  // --- Project spreadsheet ---
  projectSheets: (projectId: string) =>
    apiFetch<{ sheets: { id: string; name: string; position: number; rowCount: number }[] }>(
      `/api/projects/${projectId}/sheets`),
  sheet: (sheetId: string) => apiFetch<NexusSheet>(`/api/sheets/${sheetId}`),
  createSheet: (projectId: string, name?: string) =>
    apiFetch<{ id: string; name: string; position: number }>(`/api/projects/${projectId}/sheets`, { method: "POST", body: JSON.stringify({ name }) }),
  deleteSheet: (sheetId: string) => apiFetch<{ ok: true }>(`/api/sheets/${sheetId}`, { method: "DELETE" }),
  updateSheet: (sheetId: string, payload: { name?: string; columns?: NexusSheetColumn[] }) =>
    apiFetch<{ id: string; name: string; columns: NexusSheetColumn[] }>(`/api/sheets/${sheetId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteSheetColumn: (sheetId: string, columnId: string) =>
    apiFetch<{ ok: true }>(`/api/sheets/${sheetId}/columns/${columnId}`, { method: "DELETE" }),
  // One shape for a single blur-save AND a pasted block.
  /**
   * Save cells, splitting the write to fit the server's per-request caps.
   *
   * The caps (500 rows / 5.000 cells) bound ONE transaction; they were never meant to bound what a
   * person is allowed to do. Before this, clearing or filling a big selection just failed with
   * "Maksimal 500 baris sekali kirim" and nothing was saved — the limit leaked out as a rule the user
   * had to obey. Chunking here rather than at each call site covers every path at once: typing,
   * paste, fill, clear, undo and redo all funnel through this one function.
   *
   * Batches go one after another, not in parallel: they're separate transactions, and interleaving
   * them would make a mid-way failure land in an order nobody can reason about.
   */
  setSheetCells: async (sheetId: string, edits: { rowId: string; values: Record<string, unknown> }[]) => {
    const MAX_ROWS = 500;
    const MAX_CELLS = 5000;
    const batches: { rowId: string; values: Record<string, unknown> }[][] = [];
    let current: { rowId: string; values: Record<string, unknown> }[] = [];
    let cells = 0;
    for (const edit of edits) {
      const n = Object.keys(edit.values).length;
      if (current.length && (current.length + 1 > MAX_ROWS || cells + n > MAX_CELLS)) {
        batches.push(current);
        current = [];
        cells = 0;
      }
      current.push(edit);
      cells += n;
    }
    if (current.length) batches.push(current);

    let updated = 0;
    const rows: NexusSheetRow[] = [];
    for (const batch of batches) {
      const res = await apiFetch<{ updated: number; rows: NexusSheetRow[] }>(
        `/api/sheets/${sheetId}/cells`,
        { method: "PATCH", body: JSON.stringify({ edits: batch }) },
      );
      updated += res.updated;
      rows.push(...res.rows);
    }
    return { updated, rows };
  },
  /**
   * Add rows, splitting appends that exceed the server's 1.000-row insert cap.
   *
   * Only APPENDS are split. An insert anchored to a row (afterRowId/beforeRowId) always comes from the
   * right-click menu and is a single row; splitting one would also mean recomputing the anchor between
   * batches, which is a good way to scatter rows in the wrong order.
   */
  addSheetRows: async (
    sheetId: string,
    payload: { count?: number; afterRowId?: string; beforeRowId?: string; rows?: Record<string, unknown>[]; positions?: number[] },
  ) => {
    const MAX_INSERT = 1000;
    const anchored = Boolean(payload.afterRowId || payload.beforeRowId || payload.positions);
    const post = (body: typeof payload) =>
      apiFetch<{ rows: NexusSheetRow[] }>(`/api/sheets/${sheetId}/rows`, { method: "POST", body: JSON.stringify(body) });

    if (anchored) return post(payload);

    if (payload.rows && payload.rows.length > MAX_INSERT) {
      const rows: NexusSheetRow[] = [];
      for (let i = 0; i < payload.rows.length; i += MAX_INSERT) {
        const res = await post({ ...payload, rows: payload.rows.slice(i, i + MAX_INSERT) });
        rows.push(...res.rows);
      }
      return { rows };
    }
    if (!payload.rows && (payload.count ?? 0) > MAX_INSERT) {
      const rows: NexusSheetRow[] = [];
      let left = payload.count ?? 0;
      while (left > 0) {
        const res = await post({ ...payload, count: Math.min(left, MAX_INSERT) });
        rows.push(...res.rows);
        left -= MAX_INSERT;
      }
      return { rows };
    }
    return post(payload);
  },
  reorderSheetRow: (sheetId: string, rowId: string, afterRowId: string | null) =>
    apiFetch<{ ok: true; position: number }>(`/api/sheets/${sheetId}/rows`, { method: "PATCH", body: JSON.stringify({ rowId, afterRowId }) }),
  importSheet: (sheetId: string, file: File, mode: "append" | "replace") => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("mode", mode);
    return apiFetch<{ imported: number; columns: number; mode: string; dropdowns?: number; links?: number }>(`/api/sheets/${sheetId}/import`, { method: "POST", body: fd });
  },
  sheetComments: (sheetId: string) =>
    apiFetch<{ comments: NexusSheetComment[]; currentUserId: string }>(`/api/sheets/${sheetId}/comments`),
  addSheetComment: (sheetId: string, payload: { rowId: string; columnId: string; body: string }) =>
    apiFetch<NexusSheetComment>(`/api/sheets/${sheetId}/comments`, { method: "POST", body: JSON.stringify(payload) }),
  updateSheetComment: (sheetId: string, payload: { commentId: string; body?: string; resolved?: boolean }) =>
    apiFetch<NexusSheetComment>(`/api/sheets/${sheetId}/comments`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteSheetComment: (sheetId: string, commentId: string) =>
    apiFetch<{ ok: true }>(`/api/sheets/${sheetId}/comments?commentId=${encodeURIComponent(commentId)}`, { method: "DELETE" }),
  /** Omit rowId/columnId for the sheet's recent activity instead of one cell's history. */
  sheetRevisions: (sheetId: string, cell?: { rowId: string; columnId: string }) =>
    apiFetch<{ revisions: NexusSheetRevision[] }>(
      `/api/sheets/${sheetId}/revisions${cell ? `?rowId=${encodeURIComponent(cell.rowId)}&columnId=${encodeURIComponent(cell.columnId)}` : ""}`,
    ),
  /** Batched so several selected rows resize in one write; height null resets to the default. */
  resizeSheetRows: (sheetId: string, heights: { rowId: string; height: number | null }[]) =>
    apiFetch<{ ok: true; resized: number }>(`/api/sheets/${sheetId}/rows`, {
      method: "PATCH", body: JSON.stringify({ heights }),
    }),
  exportSheet: (sheetId: string, format: "csv" | "xlsx", fallbackName: string) =>
    downloadFile(`/api/sheets/${sheetId}/export?format=${format}`, fallbackName),
  deleteSheetRows: (sheetId: string, rowIds: string[]) =>
    apiFetch<{ deleted: number }>(`/api/sheets/${sheetId}/rows`, { method: "DELETE", body: JSON.stringify({ rowIds }) }),

  pnlDashboard: (projectId: string, year: number, month?: number | null) => apiFetch<PnlDashboard>(`/api/pnl/dashboard?projectId=${encodeURIComponent(projectId)}&year=${year}${month ? `&month=${month}` : ""}`),
  pnlCreateExpense: (payload: { projectId: string; date: string; amount: number; description?: string | null; categoryId?: string | null }) => apiFetch<PnlExpense>("/api/pnl/expenses", { method: "POST", body: JSON.stringify(payload) }),
  pnlUpdateExpense: (expenseId: string, payload: { date?: string; amount?: number; description?: string | null; categoryId?: string | null }) => apiFetch<PnlExpense>(`/api/pnl/expenses/${expenseId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  pnlDeleteExpense: (expenseId: string) => apiFetch<{ success?: boolean }>(`/api/pnl/expenses/${expenseId}`, { method: "DELETE" }),
  pnlUploadExpenseAttachment: (expenseId: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch<PnlAttachment>(`/api/pnl/expenses/${expenseId}/attachments`, { method: "POST", body: fd });
  },
  pnlDeleteAttachment: (attachmentId: string) => apiFetch<{ success?: boolean }>(`/api/pnl/attachments/${attachmentId}`, { method: "DELETE" }),
  pnlCreateIncome: (payload: { projectId: string; title: string; totalAmount: number; stageId?: string | null; expectedDate?: string | null; notes?: string | null }) => apiFetch<PnlIncome>("/api/pnl/incomes", { method: "POST", body: JSON.stringify(payload) }),
  pnlUpdateIncome: (incomeId: string, payload: { title?: string; totalAmount?: number; stageId?: string | null; expectedDate?: string | null; notes?: string | null }) => apiFetch<PnlIncome>(`/api/pnl/incomes/${incomeId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  pnlDeleteIncome: (incomeId: string) => apiFetch<{ success?: boolean }>(`/api/pnl/incomes/${incomeId}`, { method: "DELETE" }),
  pnlCreatePayment: (incomeId: string, payload: { date: string; amount: number; note?: string | null }) => apiFetch<PnlPayment>(`/api/pnl/incomes/${incomeId}/payments`, { method: "POST", body: JSON.stringify(payload) }),
  pnlDeletePayment: (paymentId: string) => apiFetch<{ success?: boolean }>(`/api/pnl/payments/${paymentId}`, { method: "DELETE" }),
  pnlCreateStage: (payload: { projectId: string; name: string; color?: string }) => apiFetch<PnlStage>("/api/pnl/stages", { method: "POST", body: JSON.stringify(payload) }),
  pnlUpdateStage: (stageId: string, payload: { name?: string; color?: string; order?: number }) => apiFetch<PnlStage>(`/api/pnl/stages/${stageId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  pnlDeleteStage: (stageId: string) => apiFetch<{ success?: boolean }>(`/api/pnl/stages/${stageId}`, { method: "DELETE" }),
  pnlCreateCategory: (payload: { projectId: string; name: string; color?: string }) => apiFetch<PnlCategory>("/api/pnl/categories", { method: "POST", body: JSON.stringify(payload) }),
  pnlUpdateCategory: (categoryId: string, payload: { name?: string; color?: string; order?: number }) => apiFetch<PnlCategory>(`/api/pnl/categories/${categoryId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  pnlDeleteCategory: (categoryId: string) => apiFetch<{ success?: boolean }>(`/api/pnl/categories/${categoryId}`, { method: "DELETE" }),
  pnlSetBudget: (payload: { projectId: string; year: number; month: number; amount: number }) => apiFetch<{ success?: boolean }>("/api/pnl/budget", { method: "PUT", body: JSON.stringify(payload) }),
  pnlCreateRecurring: (payload: { projectId: string; description: string; amount: number; categoryId?: string | null; dayOfMonth?: number }) => apiFetch<PnlRecurring>("/api/pnl/recurring", { method: "POST", body: JSON.stringify(payload) }),
  pnlUpdateRecurring: (recurringId: string, payload: { description?: string; amount?: number; categoryId?: string | null; dayOfMonth?: number; active?: boolean }) => apiFetch<PnlRecurring>(`/api/pnl/recurring/${recurringId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  pnlDeleteRecurring: (recurringId: string) => apiFetch<{ success?: boolean }>(`/api/pnl/recurring/${recurringId}`, { method: "DELETE" }),
  pnlExportUrl: (projectId: string, year: number) => `/api/pnl/export?projectId=${encodeURIComponent(projectId)}&year=${year}`,
  submitForm: (formId: string, data: Record<string, unknown>) => apiFetch<{ submission?: unknown }>(`/api/forms/${formId}/submit`, { method: "POST", body: JSON.stringify({ data }) }),

  gideonUsage: () => apiFetch<{
    users: { id: string; name: string; email: string | null; avatar: string | null; asked: number; answered: number; toolCalls: number; firstUsed: string | null; lastUsed: string | null }[];
    totals: { people: number; asked: number; toolCalls: number };
  }>("/api/gideon/usage"),

  appInstalls: () => apiFetch<{
    installs: { id: string; platform?: string; appVersion: string | null; buildNumber: string | null; osVersion: string | null; deviceModel: string | null; environment: string; lastSeenAt: string; user: { id: string; name: string; email: string | null; avatar: string | null };
      /** Every active device of this person, newest first (29 Sep 2026). */
      devices?: { id: string; platform: string; appVersion: string | null; buildNumber: string | null; osVersion: string | null; deviceModel: string | null; lastSeenAt: string }[] }[];
    notInstalled?: { id: string; name: string; email: string | null; avatar: string | null; role: string; joinedAt: string; lastActiveAt: string | null }[];
    totals: { people: number; devices: number; members?: number; notInstalled?: number; versions: { version: string; count: number }[] };
  }>("/api/admin/app-installs"),

  // --- Teams + Master Calendar ---
  /** Satu panggilan untuk SELURUH daftar: 49 baris x satu query akan membuat Control Room
   *  butuh puluhan detik untuk terbuka. Digabungkan di server, dikelompokkan per userId. */
  adminUserMemberships: () => apiFetch<{ byUser: Record<string, NexusUserMemberships> }>("/api/admin/users/memberships"),
  teams: () => apiFetch<NexusTeam[]>("/api/teams"),
  createTeam: (name: string, color?: string) => apiFetch<NexusTeam>("/api/teams", { method: "POST", body: JSON.stringify(color ? { name, color } : { name }) }),
  deleteTeam: (teamId: string) => apiFetch<{ deleted?: boolean }>("/api/teams", { method: "POST", body: JSON.stringify({ action: "delete-team", teamId }) }),
  renameTeam: (teamId: string, name: string) => apiFetch<NexusTeam>("/api/teams", { method: "POST", body: JSON.stringify({ action: "rename-team", teamId, name }) }),
  reorderTeam: (teamId: string, position: number) => apiFetch<NexusTeam>("/api/teams", { method: "POST", body: JSON.stringify({ action: "reorder-team", teamId, position }) }),
  addTeamMember: (teamId: string, userId: string) => apiFetch<unknown>("/api/teams", { method: "POST", body: JSON.stringify({ action: "add-member", teamId, userId }) }),
  removeTeamMember: (teamId: string, userId: string) => apiFetch<unknown>("/api/teams", { method: "POST", body: JSON.stringify({ action: "remove-member", teamId, userId }) }),
  linkTeamProject: (teamId: string, projectId: string) => apiFetch<unknown>("/api/teams", { method: "POST", body: JSON.stringify({ action: "link-project", teamId, projectId }) }),
  unlinkTeamProject: (teamId: string, projectId: string) => apiFetch<unknown>("/api/teams", { method: "POST", body: JSON.stringify({ action: "unlink-project", teamId, projectId }) }),
  // --- Divisions (grouping layer above teams) ---
  divisions: () => apiFetch<NexusDivision[]>("/api/teams?resource=divisions"),
  createDivision: (name: string, color?: string) => apiFetch<NexusDivision>("/api/teams", { method: "POST", body: JSON.stringify({ action: "create-division", name, ...(color ? { color } : {}) }) }),
  updateDivision: (payload: { divisionId: string; name?: string; color?: string; position?: number }) => apiFetch<NexusDivision>("/api/teams", { method: "POST", body: JSON.stringify({ action: "update-division", ...payload }) }),
  deleteDivision: (divisionId: string) => apiFetch<{ deleted?: boolean }>("/api/teams", { method: "POST", body: JSON.stringify({ action: "delete-division", divisionId }) }),
  setTeamDivision: (teamId: string, divisionId: string | null) => apiFetch<{ updated?: boolean }>("/api/teams", { method: "POST", body: JSON.stringify({ action: "set-team-division", teamId, divisionId }) }),
  setTeamAttendancePrimary: (teamId: string, userId: string, isAttendancePrimary: boolean) => apiFetch<{ updated?: boolean }>("/api/teams", { method: "POST", body: JSON.stringify({ action: "set-attendance-primary", teamId, userId, isAttendancePrimary }) }),
  updateTeamShift: (teamId: string, payload: { attendanceShiftOverrideEnabled: boolean; attendanceShiftStartTime?: string | null; attendanceShiftEndTime?: string | null }) => apiFetch<{ team?: NexusTeam }>("/api/teams", { method: "POST", body: JSON.stringify({ action: "update-attendance-shift", teamId, ...payload }) }),
  masterCalendar: (teamId: string, rangeStart: string, rangeEnd: string) => apiFetch<{ events: NexusCalendarEvent[] }>(`/api/master-calendar?teamId=${encodeURIComponent(teamId)}&rangeStart=${encodeURIComponent(rangeStart)}&rangeEnd=${encodeURIComponent(rangeEnd)}`),
  createCalendarEvent: (payload: CalendarEventPayload) => apiFetch<{ event: NexusCalendarEvent }>("/api/master-calendar", { method: "POST", body: JSON.stringify(payload) }),
  updateCalendarEvent: (eventId: string, payload: Partial<CalendarEventPayload>) => apiFetch<{ event: NexusCalendarEvent }>(`/api/master-calendar/${eventId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteCalendarEvent: (eventId: string) => apiFetch<{ success?: boolean }>(`/api/master-calendar/${eventId}`, { method: "DELETE" }),
  // --- Calendars (saved project-task-aggregating views) ---
  calendars: () => apiFetch<{ calendars: NexusCalendar[] }>("/api/calendars"),
  createCalendar: (payload: { name: string; workspaceId: string; color?: string | null; projectIds?: string[]; roomSources?: string[] }) => apiFetch<{ calendar: NexusCalendar }>("/api/calendars", { method: "POST", body: JSON.stringify(payload) }),
  updateCalendar: (calendarId: string, payload: { name?: string; color?: string | null; projectIds?: string[]; roomSources?: string[]; position?: number }) => apiFetch<{ calendar: NexusCalendar }>(`/api/calendars/${calendarId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteCalendar: (calendarId: string) => apiFetch<{ success?: boolean }>(`/api/calendars/${calendarId}`, { method: "DELETE" }),
  calendarTasks: (projectIds: string[], rangeStart: string, rangeEnd: string, rooms: string[] = []) => apiFetch<{ tasks: CalendarTaskItem[]; bookings?: CalendarBookingItem[] }>(`/api/calendar-tasks?projectIds=${encodeURIComponent(projectIds.join(","))}&rooms=${encodeURIComponent(rooms.join(","))}&rangeStart=${encodeURIComponent(rangeStart)}&rangeEnd=${encodeURIComponent(rangeEnd)}`),
  // --- Calendar (master calendar, /api/calendar/**; rules in lib/calendar/core.ts) ---
  calendarStructure: () => apiFetch<CalStructure>("/api/calendar/structure"),
  calendarItems: (from: string, to: string) => apiFetch<CalItemsResponse>(`/api/calendar/items?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  calendarOverdue: () => apiFetch<CalOverdueResponse>("/api/calendar/overdue"),
  /** How the Calendar may open one task it has not loaded (shared link, another month). */
  calendarTask: (id: string) => apiFetch<{ v: number; access: string; found: boolean; masked: boolean; canEdit: boolean; editProjectId: string | null; projectId: string | null }>(`/api/calendar/task?id=${encodeURIComponent(id)}`),
  calendarSettings: () => apiFetch<CalendarSettingsPayload>("/api/admin/calendar-settings"),
  updateCalendarSettings: (body: Partial<CalendarSettings> | { projectId: string; private: boolean }) => apiFetch<CalendarSettingsPayload>("/api/admin/calendar-settings", { method: "PATCH", body: JSON.stringify(body) }),
  // --- Room bookings ---
  roomBookings: (rangeStart: string, rangeEnd: string, room?: string) => apiFetch<{ bookings: NexusRoomBooking[] }>(`/api/room-bookings?rangeStart=${encodeURIComponent(rangeStart)}&rangeEnd=${encodeURIComponent(rangeEnd)}${room ? `&room=${encodeURIComponent(room)}` : ""}`),
  createRoomBooking: (payload: RoomBookingPayload) => apiFetch<{ booking: NexusRoomBooking }>("/api/room-bookings", { method: "POST", body: JSON.stringify(payload) }),
  updateRoomBooking: (bookingId: string, payload: Partial<RoomBookingPayload> & { status?: string }) => apiFetch<{ booking: NexusRoomBooking }>(`/api/room-bookings/${bookingId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteRoomBooking: (bookingId: string) => apiFetch<{ success?: boolean }>(`/api/room-bookings/${bookingId}`, { method: "DELETE" }),

  login: loginWithCredentials,
  // Clears all auth cookies server-side (NextAuth session/csrf/callback).
  // Ends this session on the server first (a copied cookie stops working), then clears the cookies.
  logout: async () => {
    await apiFetch<{ ok?: boolean }>("/api/auth/app-logout", { method: "POST" }).catch(() => null);
    return apiFetch<{ ok?: boolean }>("/api/auth/clear-session", { method: "POST" });
  },
  // Self-service account deletion (deactivate + anonymise). Call logout() after it succeeds.
  deleteMyAccount: () => apiFetch<{ ok: true }>("/api/user/account/delete", { method: "POST", body: JSON.stringify({ confirm: "DELETE" }) }),

  // --- Self-registration (OTP email verification) ---
  register: (payload: { name: string; email: string; password: string; workspaceCode?: string }) =>
    apiFetch<{ ok?: boolean; email?: string; expiresInSeconds?: number; resendCooldownSeconds?: number }>("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  verifyRegister: (payload: { email: string; code: string; workspaceCode?: string }) =>
    apiFetch<{ id?: string; email?: string; name?: string }>("/api/auth/register/verify", { method: "POST", body: JSON.stringify(payload) }),
  resendRegisterOtp: (email: string) =>
    apiFetch<{ ok?: boolean }>("/api/auth/register/resend", { method: "POST", body: JSON.stringify({ email }) }),

  // --- Forgot / reset password (OTP email verification) ---
  passwordResetRequest: (email: string) =>
    apiFetch<{ ok?: boolean; email?: string; expiresInSeconds?: number; resendCooldownSeconds?: number }>("/api/auth/password/reset/request", { method: "POST", body: JSON.stringify({ email }) }),
  passwordResetVerify: (payload: { email: string; code: string; password: string }) =>
    apiFetch<{ ok?: boolean }>("/api/auth/password/reset/verify", { method: "POST", body: JSON.stringify(payload) }),
  passwordResetResend: (email: string) =>
    apiFetch<{ ok?: boolean; resendCooldownSeconds?: number; retryAfterSeconds?: number }>("/api/auth/password/reset/resend", { method: "POST", body: JSON.stringify({ email }) }),
};

export function isAuthError(error: unknown) {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

export function fmtDate(value?: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function fmtTime(value?: string | null) {
  if (!value) return "--:--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "--:--";
  // 24-hour, Jakarta. Everything else in NEXUS says 12:14 and 21:14; this one helper said 09:14 PM,
  // and a BoD read a proposed check-out of 21:14 as nine in the morning (16 Sep 2026).
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Jakarta" });
}

/** Due date for display: "Jun 3" for date-only tasks, "Jun 3, 02:30 PM" when a real time was set.
 *  Date-only tasks land on UTC midnight, so we only append a time when the UTC time isn't 00:00. */
export function fmtDue(value?: string | null) {
  if (!value) return "No due date";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hasTime = date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0;
  return hasTime ? `${fmtDate(value)}, ${fmtTime(value)}` : fmtDate(value);
}

/** Convert a TipTap JSON doc to plain text (paragraphs joined by blank lines). */
export function tiptapToText(content: unknown): string {
  if (!content || typeof content !== "object") return "";
  const root = content as { content?: unknown[] };
  const walk = (node: unknown): string => {
    if (!node || typeof node !== "object") return "";
    const n = node as { type?: string; text?: string; content?: unknown[] };
    if (n.type === "text") return n.text ?? "";
    const inner = (n.content ?? []).map(walk).join("");
    return n.type === "paragraph" ? inner + "\n\n" : inner;
  };
  return (root.content ?? []).map(walk).join("").trim();
}

/** Convert plain text (blank-line separated) into a minimal TipTap JSON doc. */
export function textToTiptap(value: string) {
  const paragraphs = value.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return {
    type: "doc",
    content: (paragraphs.length ? paragraphs : [""]).map((text) => ({
      type: "paragraph",
      content: text ? [{ type: "text", text }] : [],
    })),
  };
}

/**
 * Decode a BlockNote-style description (a JSON array of
 * `{ id, type, content, children, properties }` blocks) into readable plain text.
 * If the value isn't block JSON (already plain text, or unparseable), it's returned as-is.
 */
export function blockText(raw?: string | null): string {
  if (!raw) return "";
  const s = raw.trim();
  if (!(s.startsWith("[") || s.startsWith("{"))) return raw; // plain text already
  let data: unknown;
  try { data = JSON.parse(s); } catch { return raw; }
  if (!data || (typeof data !== "object")) return raw;

  const inline = (content: unknown): string => {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((c) => {
          if (typeof c === "string") return c;
          if (c && typeof c === "object") {
            const o = c as { text?: string; content?: unknown };
            if (typeof o.text === "string") return o.text;
            if (o.content != null) return inline(o.content);
          }
          return "";
        })
        .join("");
    }
    return "";
  };

  const lines: string[] = [];
  const walk = (b: unknown) => {
    if (!b || typeof b !== "object") return;
    const o = b as { content?: unknown; children?: unknown[] };
    const text = inline(o.content);
    // Keep intentional blank lines: textToBlocks stores them as a block with content "" — pushing only
    // non-empty text collapsed them on read-back (the "spacing won't save" bug). Empty arrays/undefined
    // (structural blocks) are still skipped so we don't inject spurious blank lines.
    if (text || o.content === "") lines.push(text);
    if (Array.isArray(o.children)) o.children.forEach(walk);
  };
  (Array.isArray(data) ? data : [data]).forEach(walk);
  return lines.join("\n").trim();
}

/**
 * Re-encode plain text back into the BlockNote block-JSON shape so the description
 * stays compatible with the original NEXUS app (which reads the same DB).
 */
export function textToBlocks(value: string): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  const lines = value.split("\n");
  return JSON.stringify(
    (lines.length ? lines : [""]).map((line, i) => ({
      id: `blk_${rand()}_${i}`,
      type: "text",
      content: line,
      children: [],
      properties: {},
    })),
  );
}

export function statusLabel(value?: string | null) {
  if (!value) return "Queued";
  if (value === "RED_DATE") return "Tanggal Merah";
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
