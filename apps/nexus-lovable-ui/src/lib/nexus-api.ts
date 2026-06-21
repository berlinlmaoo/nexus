export type NexusUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  avatar?: string | null;
  phoneNumber?: string | null;
  role?: string | null;
  onboardedAt?: string | null;
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
  reason: string;
  status: PeerReportStatus;
  reviewNote: string | null;
  reviewedAt: string | null;
  reporterBountyXp: number;
  reportedPenaltyXp: number;
  xpApplied: boolean;
  createdAt: string;
  reporter: PeerReportUser;
  reportedUser: PeerReportUser;
  reviewer: { id: string; name: string } | null;
  isMine: boolean;
  canDecide: boolean;
  canWithdraw: boolean;
};
export type PeerReportList = { reports: PeerReport[]; counts: Record<string, number> };

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
  totalTasks?: number;
  completedTasks?: number;
  progress?: number;
  // Customize-project settings (shared with core NEXUS — same DB columns).
  enableTaskBatchDuplicate?: boolean;
  autoAssignEnabled?: boolean;
  autoAssignAssigneeIds?: string[];
  enablePnlDashboard?: boolean;
  _count?: { members?: number; taskLists?: number; tasks?: number };
  members?: Array<{ userId?: string; role?: string; user?: NexusUser }>;
  taskLists?: Array<{ id: string; name: string; position?: number; tasks?: NexusTask[]; taskProjects?: Array<{ id: string; position?: number; task: NexusTask }> }>;
};

export type NexusAttendanceToday = {
  attendanceDateKey?: string;
  activeOfficeCount?: number;
  canManageAttendance?: boolean;
  canReviewAttendanceRequests?: boolean;
  dayOffUsedThisMonth?: number;
  dayOffQuota?: number;
  redDateUsedThisMonth?: number;
  redDateQuota?: number;
  myShift?: { startTime: string; endTime: string; source: string } | null;
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
    officeLocation?: { name?: string | null } | null;
  } | null;
  // A previous day's check-in that was never checked out — must be closed before a new check-in.
  pendingCheckout?: {
    id: string;
    attendanceDate?: string | null;
    checkInAt?: string | null;
    officeLocation?: { name?: string | null } | null;
  } | null;
  todayRequest?: {
    id: string;
    type?: string | null;
    status?: string | null;
    reason?: string | null;
  } | null;
};

export type NexusAttendanceHistory = {
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
    checkOutLat?: number | null;
    checkOutLng?: number | null;
    checkOutAddress?: string | null;
    checkOutPhotoUrl?: string | null;
    checkOutDistanceMeters?: number | null;
    checkOutOffsite?: boolean | null;
    checkOutReason?: string | null;
    checkOutApproval?: string | null;
    user?: NexusUser | null;
  }>;
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

export type NexusMessage = {
  id: string;
  conversationId?: string;
  userId?: string;
  content: string;
  createdAt?: string | null;
  user?: NexusUser | null;
};

export type NexusConversation = {
  id: string;
  type: "DM" | "GROUP" | "PROJECT";
  name?: string | null;
  projectId?: string | null;
  members?: Array<{ userId?: string; user?: NexusUser | null }>;
  lastMessage?: NexusMessage | null;
  unreadCount?: number;
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
  joinedAt: string;
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

export type WorkspaceMembersResponse = {
  workspaceId: string;
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
  atBottom?: boolean; // BoD+ are forced to the bottom (not competing with staff)
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
  startDate?: string | null;
  endDate?: string | null;
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
};

export type NexusSubmissionDetail = NexusMySubmission & {
  answers?: Array<{ id: string; label: string; type: string; value: unknown }>;
};

export type NexusAnnouncement = { id: string; title: string; body: string; tone: "info" | "success" | "warning"; createdAt: string };
export type NexusAdminAnnouncement = NexusAnnouncement & { active: boolean; seenCount: number };

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
export const CUSTOM_FIELD_TYPES = ["SELECT", "MULTI_SELECT", "STATUS", "NUMBER", "DATE", "PLACE", "CREATED"] as const;
export type NexusCustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export type NexusCustomField = {
  id: string;
  projectId?: string;
  name: string;
  type: string; // NUMBER | SELECT | MULTI_SELECT | STATUS | DATE | PLACE | CREATED
  position?: number;
  options?: NexusCustomFieldOptions | { choices?: string[] } | string[] | null;
  value?: string | string[] | { label?: string; mapUrl?: string } | null;
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
};

export type NexusAuditLog = {
  id: string;
  action?: string | null;
  entityType?: string | null;
  entityName?: string | null;
  ipAddress?: string | null;
  createdAt?: string | null;
  user?: NexusUser | null;
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

export type OracleNode = {
  id: string;
  kind: "task" | "project" | "person";
  title: string;
  subtitle?: string;
  status: "completed" | "in-progress" | "pending";
  energy: number;
  date?: string;
  detail?: string;
  href?: string;
  meta?: Record<string, string | number | null>;
};
export type OracleResult = {
  intent: string;
  answer: string;
  subject: string;
  nodes: OracleNode[];
  truncated?: number;
  needsLlm?: boolean;
  usedLlm?: boolean;
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

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    credentials: "include",
    headers: {
      Accept: "application/json",
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
    const message = payload && typeof payload === "object" && "error" in payload ? String((payload as { error?: unknown }).error) : `Download gagal (${res.status})`;
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

export function loginWithCredentials(email: string, password: string, callbackUrl = "/dashboard") {
  return apiFetch<DirectLoginResponse>("/api/auth/direct-login", {
    method: "POST",
    body: JSON.stringify({ email, password, callbackUrl }),
  });
}

export type CreateProjectPayload = {
  name: string;
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

export type AttendanceActionPayload = {
  lat: number;
  lng: number;
  selfie: File;
  notes?: string;
  offsite?: boolean; // checkout: confirm checking out beyond the office geofence
  reason?: string; // checkout: mandatory reason when offsite
};

function attendanceFormData(payload: AttendanceActionPayload) {
  const formData = new FormData();
  formData.set("lat", String(payload.lat));
  formData.set("lng", String(payload.lng));
  if (payload.notes) formData.set("notes", payload.notes);
  if (payload.offsite) formData.set("offsite", "1");
  if (payload.reason) formData.set("reason", payload.reason);
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
  updateProject: (projectId: string, payload: Partial<Pick<NexusProject, "name" | "description" | "color" | "icon" | "status" | "enableTaskBatchDuplicate" | "autoAssignEnabled" | "autoAssignAssigneeIds" | "enablePnlDashboard">> & { folderId?: string | null }) => apiFetch<NexusProject>(`/api/projects/${projectId}`, { method: "PATCH", body: JSON.stringify(payload) }),
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
  removeProjectMember: (projectId: string, userId: string) => apiFetch<{ success?: boolean }>(`/api/projects/${projectId}/members`, { method: "DELETE", body: JSON.stringify({ userId }) }),
  inviteToProject: (projectId: string, email: string, role = "GUEST") => apiFetch<{ success?: boolean; invite?: unknown }>(`/api/projects/${projectId}/invite`, { method: "POST", body: JSON.stringify({ email, role }) }),
  projectRollups: (projectId: string) => apiFetch<{ totalTasks?: number; completedTasks?: number; completionRate?: number; avgCompletionDays?: number; byStatus?: Record<string, number>; byPriority?: Record<string, number> }>(`/api/projects/${projectId}/rollups`),
  statusUpdates: (projectId: string) => apiFetch<NexusStatusUpdate[]>(`/api/status-updates?projectId=${encodeURIComponent(projectId)}`),
  createStatusUpdate: (projectId: string, text: string, status?: string) => apiFetch<NexusStatusUpdate>("/api/status-updates", { method: "POST", body: JSON.stringify({ projectId, text, status }) }),
  generateStatusUpdate: (projectId: string) => apiFetch<{ content: string }>(`/api/projects/${projectId}/status-updates/generate`, { method: "POST" }),
  createSection: (projectId: string, name: string) => apiFetch<{ id: string; name: string }>(`/api/projects/${projectId}/sections`, { method: "POST", body: JSON.stringify({ name }) }),
  updateSection: (projectId: string, payload: { id: string; name?: string; position?: number }) => apiFetch<{ id: string; name: string }>(`/api/projects/${projectId}/sections`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteSection: (projectId: string, id: string) => apiFetch<{ success?: boolean }>(`/api/projects/${projectId}/sections`, { method: "DELETE", body: JSON.stringify({ id }) }),
  attendanceToday: () => apiFetch<NexusAttendanceToday>("/api/attendance/today"),
  // Backend returns { scope, records: [...] }; older callers expect { rows }. Normalize both → { rows }.
  attendanceHistory: async (query = "scope=workspace"): Promise<NexusAttendanceHistory> => {
    const data = await apiFetch<{ records?: NexusAttendanceHistory["rows"]; rows?: NexusAttendanceHistory["rows"] }>(`/api/attendance/history?${query}`);
    return { rows: data?.records ?? data?.rows ?? [] };
  },
  attendanceCheckIn: (payload: AttendanceActionPayload) => apiFetch<{ record: NexusAttendanceToday["today"] }>("/api/attendance/check-in", { method: "POST", body: attendanceFormData(payload) }),
  attendanceCheckOut: (payload: AttendanceActionPayload) => apiFetch<{ record: NexusAttendanceToday["today"]; pendingApproval?: boolean }>("/api/attendance/check-out", { method: "POST", body: attendanceFormData(payload) }),
  // Offsite checkout approval (BoD)
  offsiteCheckouts: (status?: string) => apiFetch<{ items: NexusOffsiteCheckout[]; pendingCount: number }>(`/api/attendance/offsite-checkouts${status ? `?status=${encodeURIComponent(status)}` : ""}`),
  reviewOffsiteCheckout: (recordId: string, action: "approve" | "reject") => apiFetch<{ ok?: boolean; approval?: string }>(`/api/attendance/offsite-checkouts/${recordId}`, { method: "PATCH", body: JSON.stringify({ action }) }),
  deductAbsences: (payload?: { from?: string; to?: string }) => apiFetch<{ from: string; to: string; processedDates: string[]; created: number; skipped: number }>("/api/attendance/deduct-absences", { method: "POST", body: JSON.stringify(payload ?? {}) }),
  attendanceOutageRefund: (payload: { date: string; dryRun?: boolean }) => apiFetch<{ ok: boolean; date: string; dryRun: boolean; refundedMembers: number; excludedMembers: number; totalXpRefunded: number; totalDayOffsRestored: number; failed: number; entries: Array<{ userId: string; name: string | null; lateXp: number; noCheckoutXp: number; alphaXp: number; autoDayOffs: number; xpRefund: number; excludedReason: string | null }> }>("/api/attendance/outage-refund", { method: "POST", body: JSON.stringify(payload) }),
  attendanceRequests: (query = "scope=workspace") => apiFetch<{ requests?: NexusAttendanceRequest[] } | NexusAttendanceRequest[]>(`/api/attendance/requests?${query}`),
  createAttendanceRequest: (payload: { type: string; startDate: string; endDate: string; reason: string; targetUserId?: string; supportingDocument?: File | null }) => {
    const fd = new FormData();
    fd.set("type", payload.type); fd.set("startDate", payload.startDate); fd.set("endDate", payload.endDate); fd.set("reason", payload.reason);
    if (payload.targetUserId) fd.set("targetUserId", payload.targetUserId);
    if (payload.supportingDocument) fd.set("supportingDocument", payload.supportingDocument);
    return apiFetch<{ request?: NexusAttendanceRequest }>("/api/attendance/requests", { method: "POST", body: fd });
  },
  attendanceOverride: (payload: { userId: string; date: string; action: "PRESENT" | "LEAVE" | "SICK" | "DAY_OFF" | "CLEAR_PENALTY"; note?: string; checkInAt?: string | null; checkOutAt?: string | null }) =>
    apiFetch<{ ok: boolean; action: string; date: string; refunded: boolean; alreadyCovered?: boolean; canceledRequests?: number; replacedRequests?: number; multiDayRequestsLeft?: number }>("/api/attendance/override", { method: "POST", body: JSON.stringify(payload) }),
  reviewAttendanceRequest: (requestId: string, action: "approve" | "reject" | "cancel") => apiFetch<{ request?: NexusAttendanceRequest }>(`/api/attendance/requests/${requestId}`, { method: "PATCH", body: JSON.stringify({ action }) }),
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
  updateOffice: (officeId: string, payload: Partial<OfficePayload>) => apiFetch<{ office?: NexusOffice }>(`/api/attendance/offices/${officeId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  tasks: (query = "") => apiFetch<NexusTask[]>(`/api/tasks${query ? `?${query}` : ""}`),
  createTask: (payload: CreateTaskPayload) => apiFetch<NexusTask>("/api/tasks", { method: "POST", body: JSON.stringify(payload) }),
  updateTask: (taskId: string, payload: Partial<Pick<NexusTask, "title" | "status" | "priority" | "dueDate">> & { description?: string | null; taskListId?: string; position?: number; projectContextId?: string }) => apiFetch<NexusTask>(`/api/tasks/${taskId}`, { method: "PATCH", body: JSON.stringify(payload) }),
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
  conversations: () => apiFetch<{ conversations: NexusConversation[] }>("/api/conversations"),
  conversation: (id: string) => apiFetch<{ conversation: NexusConversation }>(`/api/conversations/${id}`),
  conversationMessages: (id: string, before?: string) => apiFetch<{ messages: NexusMessage[]; hasMore?: boolean }>(`/api/conversations/${id}/messages${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  sendMessage: (id: string, content: string) => apiFetch<{ message: NexusMessage }>(`/api/conversations/${id}/messages`, { method: "POST", body: JSON.stringify({ content }) }),
  createConversation: (payload: { type: "DM" | "GROUP"; userIds: string[]; name?: string }) => apiFetch<{ conversation: NexusConversation }>("/api/conversations", { method: "POST", body: JSON.stringify(payload) }),
  markConversationRead: (id: string) => apiFetch<{ success?: boolean }>(`/api/conversations/${id}/read`, { method: "POST" }),

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
  duplicateTask: (taskId: string, dueDate?: string | null) => apiFetch<NexusTask>(`/api/tasks/${taskId}/duplicate`, { method: "POST", body: JSON.stringify(dueDate !== undefined ? { dueDate } : {}) }),
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
  likePost: (id: string) => apiFetch<{ liked: boolean; likeCount: number }>(`/api/feed/posts/${id}/like`, { method: "POST" }),
  postComments: (id: string) => apiFetch<{ comments: FeedComment[] }>(`/api/feed/posts/${id}/comments`),
  addPostComment: (id: string, payload: { text: string; mentions: string[] }) => apiFetch<FeedComment>(`/api/feed/posts/${id}/comments`, { method: "POST", body: JSON.stringify(payload) }),

  // --- Integrity (Peer Reports) ---
  peerReports: (status?: string) => apiFetch<PeerReportList>(`/api/peer-reports${status && status !== "ALL" ? `?status=${status}` : ""}`),
  createPeerReport: (payload: { reportedUserId: string; category: string; reason: string }) => apiFetch<PeerReport>("/api/peer-reports", { method: "POST", body: JSON.stringify(payload) }),
  peerReportVerdict: (id: string, payload: { action: "verify" | "reject"; reviewNote?: string }) => apiFetch<PeerReport>(`/api/peer-reports/${id}/verdict`, { method: "POST", body: JSON.stringify(payload) }),
  withdrawPeerReport: (id: string) => apiFetch<PeerReport>(`/api/peer-reports/${id}/withdraw`, { method: "POST" }),

  // --- Workspace members (org roles: BoD / Manager / Staff) ---
  workspaceMembers: (workspaceId?: string, includeRegistered = false) => {
    const qs = new URLSearchParams();
    if (workspaceId) qs.set("workspaceId", workspaceId);
    if (includeRegistered) qs.set("includeRegistered", "1");
    const s = qs.toString();
    return apiFetch<WorkspaceMembersResponse>(`/api/workspaces/members${s ? `?${s}` : ""}`);
  },
  inviteWorkspaceMember: (payload: { email: string; role?: OrgRole; attendanceRole?: string; workspaceId?: string }) =>
    apiFetch<{ member: NexusWorkspaceMember }>("/api/workspaces/members", { method: "POST", body: JSON.stringify(payload) }),
  updateWorkspaceMember: (payload: { memberId: string; role?: OrgRole; attendanceRole?: string; workspaceId?: string; attendanceShiftStartTime?: string | null; attendanceShiftEndTime?: string | null; attendanceShiftByDay?: Record<string, { start: string; end: string }> | null; phoneNumber?: string | null }) =>
    apiFetch<{ member: NexusWorkspaceMember }>("/api/workspaces/members", { method: "PATCH", body: JSON.stringify(payload) }),
  removeWorkspaceMember: (memberId: string, workspaceId?: string) =>
    apiFetch<{ success?: boolean }>(`/api/workspaces/members?memberId=${encodeURIComponent(memberId)}${workspaceId ? `&workspaceId=${encodeURIComponent(workspaceId)}` : ""}`, { method: "DELETE" }),
  // Per-user day-off management (BoD only) for Control Room → Members.
  userDayoffs: (userId: string, month?: string) =>
    apiFetch<{ month: string; quota: number; quotaOverride: number | null; defaultQuota: number; used: number; dayoffs: NexusDayoff[] }>(`/api/attendance/dayoffs?userId=${encodeURIComponent(userId)}${month ? `&month=${encodeURIComponent(month)}` : ""}`),
  grantDayoff: (payload: { userId: string; date: string; reason?: string }) =>
    apiFetch<{ dayoff: NexusDayoff }>("/api/attendance/dayoffs", { method: "POST", body: JSON.stringify(payload) }),
  deleteDayoff: (id: string) =>
    apiFetch<{ message: string }>(`/api/attendance/dayoffs?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
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

  // --- Attachments ---
  taskAttachments: (taskId: string) => apiFetch<NexusAttachment[]>(`/api/attachments?taskId=${encodeURIComponent(taskId)}`),
  uploadAttachment: (taskId: string, file: File) => {
    const fd = new FormData();
    fd.set("taskId", taskId); fd.set("file", file);
    return apiFetch<NexusAttachment>("/api/attachments", { method: "POST", body: fd });
  },
  // XHR variant so we can report upload progress (fetch can't). onProgress gets 0..100.
  // Files over CHUNK_THRESHOLD go through /api/attachments/chunk, which STREAMS the raw body to disk at
  // constant memory (and nginx request-buffering is off for that path). Each chunk is ≤CHUNK_SIZE so it
  // stays under Cloudflare's ~100MB cap. Only genuinely small files use the single-shot path (which
  // buffers the whole file in memory + gets spooled to an nginx temp file), so we keep that band small.
  uploadAttachmentProgress: (taskId: string, file: File, onProgress: (pct: number) => void): Promise<NexusAttachment> => {
    const CHUNK_SIZE = 80 * 1024 * 1024; // 80MB max per chunk — comfortably under Cloudflare's 100MB cap
    const CHUNK_THRESHOLD = 20 * 1024 * 1024; // >20MB → stream via the chunk endpoint instead of buffering

    // ---- small file: single request, native upload progress ----
    if (file.size <= CHUNK_THRESHOLD) {
      return new Promise<NexusAttachment>((resolve, reject) => {
        const fd = new FormData();
        fd.set("taskId", taskId); fd.set("file", file);
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/attachments");
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try { resolve(JSON.parse(xhr.responseText) as NexusAttachment); } catch { resolve({} as NexusAttachment); }
          } else reject(new ApiError(xhr.status, "Upload gagal.", null));
        };
        xhr.onerror = () => reject(new Error("Upload gagal."));
        xhr.send(fd);
      });
    }

    // ---- large file: chunked, sequential, per-chunk retry, aggregated progress ----
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = ((typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`
    ).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

    const sendChunk = (index: number, baseBytes: number) =>
      new Promise<{ status: number; body: { error?: string; id?: string } | null }>((resolve, reject) => {
        const start = index * CHUNK_SIZE;
        const blob = file.slice(start, Math.min(start + CHUNK_SIZE, file.size));
        // Metadata travels in the query string; the chunk bytes are the RAW body so the server can stream
        // them straight to disk (no multipart buffering).
        const qs = new URLSearchParams({
          uploadId,
          chunkIndex: String(index),
          totalChunks: String(totalChunks),
          totalSize: String(file.size),
          taskId,
          filename: file.name,
          mime: file.type || "application/octet-stream",
        });
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `/api/attachments/chunk?${qs.toString()}`);
        xhr.withCredentials = true;
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.min(99, Math.round(((baseBytes + e.loaded) / file.size) * 100)));
        };
        xhr.onload = () => {
          let body: { error?: string; id?: string } | null = null;
          try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON body */ }
          resolve({ status: xhr.status, body });
        };
        xhr.onerror = () => reject(new Error("network"));
        xhr.send(blob);
      });

    return (async () => {
      let last: { error?: string; id?: string } | null = null;
      for (let i = 0; i < totalChunks; i++) {
        const baseBytes = i * CHUNK_SIZE;
        for (let attempt = 1; ; attempt++) {
          try {
            const res = await sendChunk(i, baseBytes);
            if (res.status >= 200 && res.status < 300) { last = res.body; break; }
            // 409 (finalize busy) / 429 (too many sessions) are transient → back off and retry.
            if (res.status === 409 || res.status === 429) throw new Error(`retry ${res.status}`);
            // other 4xx = permanent (bad request / task gone / too big) → surface, don't retry.
            if (res.status >= 400 && res.status < 500) throw new ApiError(res.status, res.body?.error || "Upload ditolak server.", null);
            throw new Error(`server ${res.status}`); // 5xx → retryable
          } catch (err) {
            if (err instanceof ApiError) throw err;
            if (attempt >= 3) throw new ApiError(0, "Upload gagal (koneksi putus). Coba lagi.", null);
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
        }
      }
      onProgress(100);
      if (!last || !last.id) throw new ApiError(0, "Upload selesai tapi attachment tidak kembali dari server.", null);
      return last as NexusAttachment;
    })();
  },
  deleteAttachment: (attachmentId: string) => apiFetch<{ success?: boolean }>(`/api/attachments/${attachmentId}`, { method: "DELETE" }),

  // --- Image uploads (avatar / project icon) ---
  uploadAvatar: (file: File) => {
    const fd = new FormData();
    fd.set("file", file);
    return apiFetch<{ user: NexusUser; url: string }>("/api/upload/avatar", { method: "POST", body: fd });
  },
  deleteAvatar: () => apiFetch<{ ok?: boolean; success?: boolean }>("/api/upload/avatar", { method: "DELETE" }),
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
  updateUserRole: (userId: string, role: string) => apiFetch<{ user?: NexusAdminUser }>(`/api/admin/users/${userId}`, { method: "PATCH", body: JSON.stringify({ role }) }),
  deleteUser: (userId: string) => apiFetch<{ ok: boolean; deletedUser: { id: string; name: string; email: string }; reassigned: Record<string, number>; purged: Record<string, number> }>(`/api/admin/users/${userId}`, { method: "DELETE" }),
  oracleAsk: (query: string) => apiFetch<OracleResult>("/api/oracle", { method: "POST", body: JSON.stringify({ query }) }),
  bufferDrafts: () => apiFetch<BufferDraftsResponse>("/api/buffer/drafts"),
  bufferApprove: (postId: string, mode: "queue" | "schedule" | "now", dueAt?: string) => apiFetch<{ ok: boolean }>("/api/buffer/approve", { method: "POST", body: JSON.stringify({ postId, mode, dueAt }) }),
  bufferReject: (postId: string) => apiFetch<{ ok: boolean }>("/api/buffer/reject", { method: "POST", body: JSON.stringify({ postId }) }),
  updateProfile: (payload: { name?: string; phoneNumber?: string | null; dndUntil?: string | null; markOnboarded?: boolean }) => apiFetch<{ user?: NexusUser }>("/api/user/profile", { method: "PATCH", body: JSON.stringify(payload) }),
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
  dismissAnnouncement: (id: string) => apiFetch<{ ok?: boolean }>(`/api/announcements/${id}/seen`, { method: "POST" }),
  announcements: () => apiFetch<{ announcements: NexusAdminAnnouncement[] }>("/api/announcements"),
  createAnnouncement: (payload: { title: string; body: string; tone?: string }) => apiFetch<{ announcement: NexusAdminAnnouncement }>("/api/announcements", { method: "POST", body: JSON.stringify(payload) }),
  updateAnnouncement: (id: string, payload: { title?: string; body?: string; tone?: string; active?: boolean }) => apiFetch<{ announcement: NexusAdminAnnouncement }>(`/api/announcements/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteAnnouncement: (id: string) => apiFetch<{ ok?: boolean }>(`/api/announcements/${id}`, { method: "DELETE" }),

  // --- Finance dashboard (per Finance project, monthly OPEX/Revenue) ---
  financeDashboard: (projectId: string, year: number) => apiFetch<NexusFinanceDashboard>(`/api/finance/dashboard?projectId=${encodeURIComponent(projectId)}&year=${year}`),
  setFinanceValue: (payload: { projectId: string; lineItemId: string; year: number; month: number; amount: number }) => apiFetch<{ value: unknown }>("/api/finance/value", { method: "PATCH", body: JSON.stringify(payload) }),

  // --- P&L dashboard (standalone, BoD-only) ---
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

  // --- Teams + Master Calendar ---
  teams: () => apiFetch<NexusTeam[]>("/api/teams"),
  createTeam: (name: string, color?: string) => apiFetch<NexusTeam>("/api/teams", { method: "POST", body: JSON.stringify(color ? { name, color } : { name }) }),
  deleteTeam: (teamId: string) => apiFetch<{ deleted?: boolean }>("/api/teams", { method: "POST", body: JSON.stringify({ action: "delete-team", teamId }) }),
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
  setTeamMemberRole: (teamId: string, userId: string, role: "LEAD" | "MEMBER") => apiFetch<{ updated?: boolean }>("/api/teams", { method: "POST", body: JSON.stringify({ action: "set-member-role", teamId, userId, role }) }),
  updateTeamShift: (teamId: string, payload: { attendanceShiftOverrideEnabled: boolean; attendanceShiftStartTime?: string | null; attendanceShiftEndTime?: string | null }) => apiFetch<{ team?: NexusTeam }>("/api/teams", { method: "POST", body: JSON.stringify({ action: "update-attendance-shift", teamId, ...payload }) }),
  masterCalendar: (teamId: string, rangeStart: string, rangeEnd: string) => apiFetch<{ events: NexusCalendarEvent[] }>(`/api/master-calendar?teamId=${encodeURIComponent(teamId)}&rangeStart=${encodeURIComponent(rangeStart)}&rangeEnd=${encodeURIComponent(rangeEnd)}`),
  createCalendarEvent: (payload: CalendarEventPayload) => apiFetch<{ event: NexusCalendarEvent }>("/api/master-calendar", { method: "POST", body: JSON.stringify(payload) }),
  updateCalendarEvent: (eventId: string, payload: Partial<CalendarEventPayload>) => apiFetch<{ event: NexusCalendarEvent }>(`/api/master-calendar/${eventId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteCalendarEvent: (eventId: string) => apiFetch<{ success?: boolean }>(`/api/master-calendar/${eventId}`, { method: "DELETE" }),
  // --- Room bookings ---
  roomBookings: (rangeStart: string, rangeEnd: string, room?: string) => apiFetch<{ bookings: NexusRoomBooking[] }>(`/api/room-bookings?rangeStart=${encodeURIComponent(rangeStart)}&rangeEnd=${encodeURIComponent(rangeEnd)}${room ? `&room=${encodeURIComponent(room)}` : ""}`),
  createRoomBooking: (payload: RoomBookingPayload) => apiFetch<{ booking: NexusRoomBooking }>("/api/room-bookings", { method: "POST", body: JSON.stringify(payload) }),
  updateRoomBooking: (bookingId: string, payload: Partial<RoomBookingPayload> & { status?: string }) => apiFetch<{ booking: NexusRoomBooking }>(`/api/room-bookings/${bookingId}`, { method: "PATCH", body: JSON.stringify(payload) }),
  deleteRoomBooking: (bookingId: string) => apiFetch<{ success?: boolean }>(`/api/room-bookings/${bookingId}`, { method: "DELETE" }),

  // --- Project files (NAS-backed) ---
  projectFiles: (projectId: string, path = "") =>
    apiFetch<ProjectFilesResponse>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`),
  uploadProjectFile: (projectId: string, file: File, path = "") => {
    const fd = new FormData();
    fd.set("file", file);
    if (path) fd.set("path", path);
    return apiFetch<NexusProjectFile & { uploaded: boolean }>(`/api/projects/${projectId}/files`, { method: "POST", body: fd });
  },
  createProjectFolder: (projectId: string, name: string, path = "") =>
    apiFetch<{ created: boolean; path: string }>(`/api/projects/${projectId}/files`, { method: "POST", body: JSON.stringify({ name, path }) }),
  deleteProjectFile: (projectId: string, path: string) =>
    apiFetch<{ deleted: boolean }>(`/api/projects/${projectId}/files?path=${encodeURIComponent(path)}`, { method: "DELETE" }),
  projectFileDownloadUrl: (projectId: string, path: string, inline = false) =>
    `/api/projects/${projectId}/files/download?path=${encodeURIComponent(path)}${inline ? "&inline=1" : ""}`,

  login: loginWithCredentials,
  // Clears all auth cookies server-side (NextAuth session/csrf/callback).
  logout: () => apiFetch<{ ok?: boolean }>("/api/auth/clear-session", { method: "POST" }),

  // --- Self-registration (OTP email verification) ---
  register: (payload: { name: string; email: string; password: string }) =>
    apiFetch<{ ok?: boolean; email?: string; expiresInSeconds?: number; resendCooldownSeconds?: number }>("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  verifyRegister: (payload: { email: string; code: string }) =>
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

export type NexusProjectFile = {
  name: string;
  path: string;
  relPath: string;
  isdir: boolean;
  size: number;
  modified: string;
  type: string;
};

export type ProjectFilesResponse = {
  path: string;
  files: NexusProjectFile[];
  total: number;
  offset: number;
  hasMore: boolean;
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
  return date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
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
    if (text) lines.push(text);
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
