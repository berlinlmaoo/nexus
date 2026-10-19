# Android parity audit ? 19 October 2026

**Overall: PARTIAL parity.** The prioritized implementations below are complete in source and build-tested; live/device QA and the explicitly listed larger feature gaps remain.

Branch: feat/android-parity-19oct. Baseline: 0d0e6e06 plus the merged Android QA work (470bf6ff). Source audit uses this checkout, not a claim about a newer deployment. No server edits, release/version changes, APK publication or changes to the other checkout.

## Scope and evidence

Compared all 148 iOS Views source files, all web route files, their referenced feature contracts, Android navigation/features, and server route availability. The file inventory below is exhaustive for those entrypoints; a matching module means the surface exists, **not** that every behavior has device parity. Inspected iOS API paths against Android to catch absent operations; discarded comment-only endpoints and paths with equivalent Android implementations. Supporting iOS models/APIs are covered with their owning view. This is a source audit, supplemented by the baseline [QA report](QA-FINAL-19OCT.md); prior screenshots are not evidence for this branch's new code.

U-1 through U-13 from the separately assigned UI round are excluded: status, Memory redesign, notification loading, ticket board, Vault toolbar, meeting composer, GIDEON toolbar, message tabs, compact Timeline/Table, spreadsheet zoom, calendar counts, Apply contrast and new-chat suggestion placement. No work is claimed for that session's changes.

## Prioritized findings and delivery

| ID / impact | Baseline gap and user impact | Current disposition | Work remaining / estimate |
|---|---|---|---|
| G1 / high | Social Media Report opens an empty task board; teams cannot read or record daily social performance | Native creation, Overview/Calendar/Chat routing, server engagement/targets, figures/notes, platform configuration, monthly/daily target writes, permissions, future-date restriction and realtime implemented in 383f2186 | Device QA and presentation refinements, 2?4 h; see limitations below |
| G2 / high | Outlet Sales omits custom RSVP/Hosting/Communities, guest overview and daily target settings; custom data cannot be entered | Config-driven form/detail, nested values diffs, guest totals/share bars, Report settings with archive/restore/reorder and daily target editor implemented in d754e6b8 | Device QA, 2?3 h |
| G3 / medium | Crew start dates and deductions endpoint absent; directors cannot establish leave eligibility or review all deductions from the crew screen | Added board-only employment dates, server eligibility, period-based quota/XP summaries, member logs and confirmed date-wide CLEAR_PENALTY | Device QA; no live attendance mutations performed |
| G4 / medium | GIDEON Credits lacked bonus grants/history, per-person overrides and web role defaults | Implemented native Credits tab, role policies, per-person limits and bonus history/grants. Privileged controls appear only after the gated admin read succeeds | Device and multiple-role QA, 1?2 h |
| G5 / high, larger prerequisite | Native Docs is a read-only flattened block renderer; iOS has block editing, collaborative merge/conflict recovery and GIDEON writing actions | Confirmed Docs.kt has only list/read APIs; iOS BlockEditing.swift uses /api/collab/edit, GideonWrite.swift uses /api/gideon/write | Structured page/task-body editing, merge/conflict UI and writing review/apply, 2?4 engineering days plus QA. Do not replace structured content with flattened text |
| G6 / medium | GIDEON personalization/preferences and cross-device review-notice acknowledgement absent; Android stores acknowledgement locally | /api/gideon/prefs exists; toolbar entry overlaps U7 ownership | Coordinate U7; preference editor and server notice persistence, 2?3 h |
| G7 / medium | GIDEON answer Save as page absent | Implemented title/project search, context project shortcut, save/open/error flow. Read-only review transcripts never show the action; server checks write access | Device QA, 1 h |
| G8 / low-medium | Ranking existed without the board-only global XP audit card | Implemented sign/period filters, pagination, localized reasons, hidden zero bookkeeping rows, latest-request guards | Device QA, 1 h; manual XP adjustment still left in G19 |
| G9 / platform | Public web routes: OAuth authorization, agent SSO, room display, downloads, shared forms/docs/Vault | Browser routes, not missing in-app navigation destinations; native link/share handling exists where applicable | Dedicated OAuth consent or room kiosk app only if required; no estimate without product scope |

All endpoints used by G1?G4/G7/G8 exist. G5 has a server read-contract blocker described below. Chat polls/reactions are not counted as gaps: iOS explicitly documents that those server endpoints do not exist and uses text fallback. Approval chart uses Android roster/approver calls rather than iOS's bulk approval-chart endpoint; endpoint-name difference alone is not a feature gap.

## New implementation details and limitations

Social: server engagement = likes + comments + shares; views remain separate. Reads use the server's target-to-date, monthly target, percentages and archived data. One shared ViewModel retains the month across report tabs; latest-request checks reject stale loads. Day PUT sends only changed metrics/notes, preserving null versus zero. Full access controls settings/targets; Edit access records through today (WIB). Config saves before targets, and a target failure retains the editor. New platform ids are omitted so the server assigns them. Used-platform archive asks in a centered AlertDialog. Realtime listener registration includes social-media-changed.

Social presentation now uses adaptive one/two-column cards, a separate contents-posted card, compact calendar figures, note/target icons, weekday headings, a filled today marker, sparkline fill and grouped numeric entry with caret mapping. Device presentation is not verified. Day/platform drafts survive network failures and refreshes while their sheet remains mounted; process recreation is not verified. Daily target boxes show the monthly-share fallback as a placeholder. Fractional server targets remain fractional in displayed social metrics.

Outlet: server-computed guest totals include archived data; removing a used item confirms and archives it, while unused items are removed. Nested community items keep stable ids. New item/community ids are omitted on PUT. Existing reports retain archived figures and legacy total-only community values. POST/PATCH sends values inside the values map and only changed values on PATCH. Report form and event details use the same generated sections. Server computes daily fallback/percentage; Android never substitutes its own target division.

## Validation and screenshots

- Final **testDebugUnitTest + assembleDebug PASS: 845 tests, zero failures/errors/skips**. Final source head 5263296d; only this report was added afterward. Build log: C:/Users/Berlin/android-parity-19oct-build.log.
- Version remains versionCode 13 / versionName 0.1.6.
- One existing emulator detected (emulator-5556); no second emulator started. It is reserved by the other session. Coordination question sent; no installation, navigation, screenshot or emulator control until availability is established.
- No new screenshots yet. Existing baseline captures: [QA final index](../../../../nexus-shots/qa-final-19oct/index.html). These do not validate G1?G3.
- Build uses JDK 21, two workers, no parallel project execution, 2 GB heap. Checked Java/Gradle processes and free RAM before starting; no other wrapper build was present at those checks. Idle daemons were left running.

## Web route inventory

| Route source | Android counterpart / disposition |
|---|---|
| [__root.tsx](../../web/src/routes/__root.tsx) | Shell/infrastructure |
| [_app.tsx](../../web/src/routes/_app.tsx) | Shell/infrastructure |
| [_app/admin.tsx](../../web/src/routes/_app/admin.tsx) | admin |
| [_app/attendance.tsx](../../web/src/routes/_app/attendance.tsx) | attendance (G3) |
| [_app/calendar.tsx](../../web/src/routes/_app/calendar.tsx) | calendar |
| [_app/complaints.tsx](../../web/src/routes/_app/complaints.tsx) | Shell/infrastructure |
| [_app/dashboard.tsx](../../web/src/routes/_app/dashboard.tsx) | home |
| [_app/docs.$docId.tsx](../../web/src/routes/_app/docs.$docId.tsx) | docs (G5) |
| [_app/docs.tsx](../../web/src/routes/_app/docs.tsx) | docs (G5) |
| [_app/folders.$folderId.tsx](../../web/src/routes/_app/folders.$folderId.tsx) | projects |
| [_app/forms.tsx](../../web/src/routes/_app/forms.tsx) | forms |
| [_app/gideon.tsx](../../web/src/routes/_app/gideon.tsx) | gideon (G4/G6/G7) |
| [_app/inbox.tsx](../../web/src/routes/_app/inbox.tsx) | inbox |
| [_app/index.tsx](../../web/src/routes/_app/index.tsx) | home/projects |
| [_app/leaderboard.tsx](../../web/src/routes/_app/leaderboard.tsx) | people/XpAudit.kt (G8) |
| [_app/legal.tsx](../../web/src/routes/_app/legal.tsx) | legal |
| [_app/master-calendar.tsx](../../web/src/routes/_app/master-calendar.tsx) | calendar |
| [_app/meetings.$meetingId.tsx](../../web/src/routes/_app/meetings.$meetingId.tsx) | meetings |
| [_app/meetings.index.tsx](../../web/src/routes/_app/meetings.index.tsx) | meetings |
| [_app/messages.$conversationId.tsx](../../web/src/routes/_app/messages.$conversationId.tsx) | chat |
| [_app/messages.tsx](../../web/src/routes/_app/messages.tsx) | chat |
| [_app/my-tasks.tsx](../../web/src/routes/_app/my-tasks.tsx) | tasks |
| [_app/people.$userId.tsx](../../web/src/routes/_app/people.$userId.tsx) | people |
| [_app/projects/$projectId.tsx](../../web/src/routes/_app/projects/$projectId.tsx) | Shell/infrastructure |
| [_app/projects/index.tsx](../../web/src/routes/_app/projects/index.tsx) | Shell/infrastructure |
| [_app/reminders.tsx](../../web/src/routes/_app/reminders.tsx) | gideon |
| [_app/reports.$userId.tsx](../../web/src/routes/_app/reports.$userId.tsx) | reports |
| [_app/reports.tsx](../../web/src/routes/_app/reports.tsx) | reports |
| [_app/room-booking.tsx](../../web/src/routes/_app/room-booking.tsx) | agenda |
| [_app/settings.tsx](../../web/src/routes/_app/settings.tsx) | auth |
| [_app/submissions.tsx](../../web/src/routes/_app/submissions.tsx) | forms |
| [_app/tasks.$taskId.tsx](../../web/src/routes/_app/tasks.$taskId.tsx) | tasks |
| [_app/teams.tsx](../../web/src/routes/_app/teams.tsx) | admin/Teams.kt |
| [_app/threads.tsx](../../web/src/routes/_app/threads.tsx) | threads |
| [_app/vault.tsx](../../web/src/routes/_app/vault.tsx) | vault |
| [download.android.tsx](../../web/src/routes/download.android.tsx) | Browser/platform route (G9) |
| [f.$formId.tsx](../../web/src/routes/f.$formId.tsx) | Browser/platform route (G9) |
| [forgot-password.tsx](../../web/src/routes/forgot-password.tsx) | auth |
| [login.tsx](../../web/src/routes/login.tsx) | auth |
| [oauth.authorize.tsx](../../web/src/routes/oauth.authorize.tsx) | Browser/platform route (G9) |
| [phaethon.tsx](../../web/src/routes/phaethon.tsx) | Browser/platform route (G9) |
| [register.tsx](../../web/src/routes/register.tsx) | auth |
| [room-display.$room.tsx](../../web/src/routes/room-display.$room.tsx) | Browser/platform route (G9) |
| [s.$slug.tsx](../../web/src/routes/s.$slug.tsx) | Browser/platform route (G9) |
| [sso.agents.$state.tsx](../../web/src/routes/sso.agents.$state.tsx) | Browser/platform route (G9) |
| [v.$slug.tsx](../../web/src/routes/v.$slug.tsx) | Browser/platform route (G9) |

## iOS screen/source inventory

| iOS view source | Android module | Finding / scope |
|---|---|---|
| [AccountFooterSidebar.swift](../../ios/Sources/Views/AccountFooterSidebar.swift) | ../ui | Shared/platform infrastructure |
| [ActiveSessionsCard.swift](../../ios/Sources/Views/ActiveSessionsCard.swift) | auth | Present |
| [AdaptiveRoot.swift](../../ios/Sources/Views/AdaptiveRoot.swift) | ../ui | Shared/platform infrastructure |
| [AddProjectMembersSheet.swift](../../ios/Sources/Views/AddProjectMembersSheet.swift) | projects | Present; U9/U10 excluded |
| [AddProjectPeopleSheet.swift](../../ios/Sources/Views/AddProjectPeopleSheet.swift) | projects | Present; U9/U10 excluded |
| [AdminAuditViews.swift](../../ios/Sources/Views/AdminAuditViews.swift) | admin | Present |
| [AdminEditViews.swift](../../ios/Sources/Views/AdminEditViews.swift) | admin | Present |
| [AdminExtraDayOffViews.swift](../../ios/Sources/Views/AdminExtraDayOffViews.swift) | admin | Present |
| [AdminSocialViews.swift](../../ios/Sources/Views/AdminSocialViews.swift) | admin | Present |
| [AdminSuspectViews.swift](../../ios/Sources/Views/AdminSuspectViews.swift) | admin | Present |
| [AdminUserDetailView.swift](../../ios/Sources/Views/AdminUserDetailView.swift) | admin | Present |
| [AgendaViews.swift](../../ios/Sources/Views/AgendaViews.swift) | agenda | Present |
| [AnnouncementModal.swift](../../ios/Sources/Views/AnnouncementModal.swift) | inbox | Present |
| [ApprovalChartView.swift](../../ios/Sources/Views/ApprovalChartView.swift) | admin | Present |
| [AttachmentViewerView.swift](../../ios/Sources/Views/AttachmentViewerView.swift) | chat | Present; U8 excluded |
| [AttendanceAdminView.swift](../../ios/Sources/Views/AttendanceAdminView.swift) | attendance | Present; crew deductions added here |
| [AttendanceAllowanceLog.swift](../../ios/Sources/Views/AttendanceAllowanceLog.swift) | attendance | Present; crew deductions added here |
| [AttendanceOfficesView.swift](../../ios/Sources/Views/AttendanceOfficesView.swift) | attendance | Present; crew deductions added here |
| [AttendanceRequestsView.swift](../../ios/Sources/Views/AttendanceRequestsView.swift) | attendance | Present; crew deductions added here |
| [AttendanceView.swift](../../ios/Sources/Views/AttendanceView.swift) | attendance | Present; crew deductions added here |
| [AuthFormPieces.swift](../../ios/Sources/Views/AuthFormPieces.swift) | auth | Present |
| [AutomationBuilder.swift](../../ios/Sources/Views/AutomationBuilder.swift) | ../ui | Shared component; source family reviewed |
| [AutomationsViews.swift](../../ios/Sources/Views/AutomationsViews.swift) | ../ui | Shared component; source family reviewed |
| [BlockDocView.swift](../../ios/Sources/Views/BlockDocView.swift) | docs/Docs.kt | Read-only native reader; G5 |
| [BlockEditorView.swift](../../ios/Sources/Views/BlockEditorView.swift) | docs/Docs.kt | Gap G5: native page editor / writing |
| [BoardRedesign.swift](../../ios/Sources/Views/BoardRedesign.swift) | projects | Present; U9/U10 excluded |
| [CalendarParts.swift](../../ios/Sources/Views/CalendarParts.swift) | calendar | Present; U11 excluded |
| [CalendarTaskReadOnly.swift](../../ios/Sources/Views/CalendarTaskReadOnly.swift) | calendar | Present; U11 excluded |
| [CalendarView.swift](../../ios/Sources/Views/CalendarView.swift) | calendar | Present; U11 excluded |
| [ChangeEmailSheet.swift](../../ios/Sources/Views/ChangeEmailSheet.swift) | auth | Present |
| [ChatDocument.swift](../../ios/Sources/Views/ChatDocument.swift) | core/files, chat | Platform document sharing |
| [ChatInfoView.swift](../../ios/Sources/Views/ChatInfoView.swift) | chat | Present; U8 excluded |
| [ChatPhoto.swift](../../ios/Sources/Views/ChatPhoto.swift) | chat | Present; U8 excluded |
| [CreateProjectExtras.swift](../../ios/Sources/Views/CreateProjectExtras.swift) | projects | Present; U9/U10 excluded |
| [CustomFieldChips.swift](../../ios/Sources/Views/CustomFieldChips.swift) | projects | Present; U9/U10 excluded |
| [CustomFieldNumberViews.swift](../../ios/Sources/Views/CustomFieldNumberViews.swift) | projects | Present; U9/U10 excluded |
| [DashboardView.swift](../../ios/Sources/Views/DashboardView.swift) | home | Present |
| [DeleteAccountSheet.swift](../../ios/Sources/Views/DeleteAccountSheet.swift) | auth | Present |
| [DocsView.swift](../../ios/Sources/Views/DocsView.swift) | docs/Docs.kt | Read-only native reader; G5 |
| [EmploymentStartCard.swift](../../ios/Sources/Views/EmploymentStartCard.swift) | admin/AttendanceCrew.kt | Implemented here |
| [FormBuilderView.swift](../../ios/Sources/Views/FormBuilderView.swift) | forms | Present |
| [FormFillView.swift](../../ios/Sources/Views/FormFillView.swift) | forms | Present |
| [FormResponsesView.swift](../../ios/Sources/Views/FormResponsesView.swift) | forms | Present |
| [FormStudioViews.swift](../../ios/Sources/Views/FormStudioViews.swift) | forms | Present |
| [FormsView.swift](../../ios/Sources/Views/FormsView.swift) | forms | Present |
| [GideonActionCard.swift](../../ios/Sources/Views/GideonActionCard.swift) | gideon | Present; G6/G7 exceptions below; U2/U7/U13 excluded |
| [GideonBookingChangeCard.swift](../../ios/Sources/Views/GideonBookingChangeCard.swift) | gideon | Present; G6/G7 exceptions below; U2/U7/U13 excluded |
| [GideonBookRoomCard.swift](../../ios/Sources/Views/GideonBookRoomCard.swift) | gideon | Present; G6/G7 exceptions below; U2/U7/U13 excluded |
| [GideonMarkdown.swift](../../ios/Sources/Views/GideonMarkdown.swift) | gideon | Present; G6/G7 exceptions below; U2/U7/U13 excluded |
| [GideonMemoryView.swift](../../ios/Sources/Views/GideonMemoryView.swift) | gideon | Present; G6/G7 exceptions below; U2/U7/U13 excluded |
| [GideonPageParts.swift](../../ios/Sources/Views/GideonPageParts.swift) | gideon | Present; G6/G7 exceptions below; U2/U7/U13 excluded |
| [GideonPanel.swift](../../ios/Sources/Views/GideonPanel.swift) | gideon | Present; G6/G7 exceptions below; U2/U7/U13 excluded |
| [GideonPanelExtras.swift](../../ios/Sources/Views/GideonPanelExtras.swift) | gideon | Present; G6/G7 exceptions below; U2/U7/U13 excluded |
| [GideonPerformanceView.swift](../../ios/Sources/Views/GideonPerformanceView.swift) | admin/GideonPerformance.kt | Present |
| [GideonPersonReview.swift](../../ios/Sources/Views/GideonPersonReview.swift) | admin/GideonPeople.kt | G4 implemented; device QA pending |
| [GideonTaskCards.swift](../../ios/Sources/Views/GideonTaskCards.swift) | gideon | Present; G6/G7 exceptions below; U2/U7/U13 excluded |
| [GideonWrite.swift](../../ios/Sources/Views/GideonWrite.swift) | docs/Docs.kt | Gap G5: native page editor / writing |
| [HomeWideCards.swift](../../ios/Sources/Views/HomeWideCards.swift) | home | Present |
| [InboxView.swift](../../ios/Sources/Views/InboxView.swift) | inbox | Present |
| [JoinWorkspaceCard.swift](../../ios/Sources/Views/JoinWorkspaceCard.swift) | auth | Present |
| [KeyboardDoneBar.swift](../../ios/Sources/Views/KeyboardDoneBar.swift) | ../ui | Shared/platform infrastructure |
| [KeyboardShortcutsHelp.swift](../../ios/Sources/Views/KeyboardShortcutsHelp.swift) | ../ui | Shared/platform infrastructure |
| [LeaderboardView.swift](../../ios/Sources/Views/LeaderboardView.swift) | people | G8 implemented; device QA pending |
| [LeftTag.swift](../../ios/Sources/Views/LeftTag.swift) | people | Present |
| [LegalArchiveTitle.swift](../../ios/Sources/Views/LegalArchiveTitle.swift) | legal | Present |
| [LegalDocumentView.swift](../../ios/Sources/Views/LegalDocumentView.swift) | legal | Present |
| [LegalMembersView.swift](../../ios/Sources/Views/LegalMembersView.swift) | legal | Present |
| [LegalNewDocumentView.swift](../../ios/Sources/Views/LegalNewDocumentView.swift) | legal | Present |
| [LegalRequestViews.swift](../../ios/Sources/Views/LegalRequestViews.swift) | legal | Present |
| [LegalReviewView.swift](../../ios/Sources/Views/LegalReviewView.swift) | legal | Present |
| [LegalSettingsView.swift](../../ios/Sources/Views/LegalSettingsView.swift) | legal | Present |
| [LegalShared.swift](../../ios/Sources/Views/LegalShared.swift) | legal | Present |
| [LegalTemplatesView.swift](../../ios/Sources/Views/LegalTemplatesView.swift) | projects | Present; U9/U10 excluded |
| [LegalView.swift](../../ios/Sources/Views/LegalView.swift) | legal | Present |
| [LivenessCaptureView.swift](../../ios/Sources/Views/LivenessCaptureView.swift) | attendance | Present; crew deductions added here |
| [LiveRefresh.swift](../../ios/Sources/Views/LiveRefresh.swift) | ../ui | Shared/platform infrastructure |
| [LocationTrailView.swift](../../ios/Sources/Views/LocationTrailView.swift) | attendance | Present; crew deductions added here |
| [LoginView.swift](../../ios/Sources/Views/LoginView.swift) | auth | Present |
| [MacPagesChrome.swift](../../ios/Sources/Views/MacPagesChrome.swift) | docs/Docs.kt | Read-only native reader; G5 |
| [MeetingSpeakers.swift](../../ios/Sources/Views/MeetingSpeakers.swift) | meetings | Present; U6 excluded |
| [MeetingViews.swift](../../ios/Sources/Views/MeetingViews.swift) | meetings | Present; U6 excluded |
| [MemberAttendanceSheet.swift](../../ios/Sources/Views/MemberAttendanceSheet.swift) | attendance | Present; crew deductions added here |
| [MemberProfileView.swift](../../ios/Sources/Views/MemberProfileView.swift) | people | Present |
| [MessagesView.swift](../../ios/Sources/Views/MessagesView.swift) | chat | Present; U8 excluded |
| [NewConversationSheet.swift](../../ios/Sources/Views/NewConversationSheet.swift) | chat | Present; U8 excluded |
| [NewMeetingSheet.swift](../../ios/Sources/Views/NewMeetingSheet.swift) | meetings | Present; U6 excluded |
| [NotificationMark.swift](../../ios/Sources/Views/NotificationMark.swift) | inbox | Present |
| [NXMonthGrid.swift](../../ios/Sources/Views/NXMonthGrid.swift) | calendar | Present; U11 excluded |
| [NXPageChrome.swift](../../ios/Sources/Views/NXPageChrome.swift) | ../ui | Shared/platform infrastructure |
| [NXTabs.swift](../../ios/Sources/Views/NXTabs.swift) | ../ui | Shared/platform infrastructure |
| [OfflineCard.swift](../../ios/Sources/Views/OfflineCard.swift) | ../ui | Shared/platform infrastructure |
| [OfflineNotice.swift](../../ios/Sources/Views/OfflineNotice.swift) | ../ui | Shared/platform infrastructure |
| [OrgChartView.swift](../../ios/Sources/Views/OrgChartView.swift) | admin | Present |
| [OutletSalesCalendarForm.swift](../../ios/Sources/Views/OutletSalesCalendarForm.swift) | outlet | Implemented here; visual QA pending |
| [OutletSalesCustom.swift](../../ios/Sources/Views/OutletSalesCustom.swift) | outlet | Implemented here; visual QA pending |
| [OutletSalesView.swift](../../ios/Sources/Views/OutletSalesView.swift) | outlet | Implemented here; visual QA pending |
| [PersonReportView.swift](../../ios/Sources/Views/PersonReportView.swift) | reports | Present |
| [PipelineDealView.swift](../../ios/Sources/Views/PipelineDealView.swift) | pipeline | Present |
| [PipelineDocumentsView.swift](../../ios/Sources/Views/PipelineDocumentsView.swift) | pipeline | Present |
| [PipelineView.swift](../../ios/Sources/Views/PipelineView.swift) | pipeline | Present |
| [ProjectBoardView.swift](../../ios/Sources/Views/ProjectBoardView.swift) | projects | Present; U9/U10 excluded |
| [ProjectListRows.swift](../../ios/Sources/Views/ProjectListRows.swift) | projects | Present; U9/U10 excluded |
| [ProjectMacChrome.swift](../../ios/Sources/Views/ProjectMacChrome.swift) | projects | Present; U9/U10 excluded |
| [ProjectMark.swift](../../ios/Sources/Views/ProjectMark.swift) | projects | Present; U9/U10 excluded |
| [ProjectOverviewView.swift](../../ios/Sources/Views/ProjectOverviewView.swift) | projects | Present; U9/U10 excluded |
| [ProjectSettingsExtras.swift](../../ios/Sources/Views/ProjectSettingsExtras.swift) | projects | Present; U9/U10 excluded |
| [ProjectSettingsView.swift](../../ios/Sources/Views/ProjectSettingsView.swift) | projects | Present; U9/U10 excluded |
| [ProjectsSummaryCard.swift](../../ios/Sources/Views/ProjectsSummaryCard.swift) | projects | Present; U9/U10 excluded |
| [ProjectsView.swift](../../ios/Sources/Views/ProjectsView.swift) | projects | Present; U9/U10 excluded |
| [ProjectTabExtras.swift](../../ios/Sources/Views/ProjectTabExtras.swift) | projects | Present; U9/U10 excluded |
| [ProjectTabsView.swift](../../ios/Sources/Views/ProjectTabsView.swift) | projects | Present; U9/U10 excluded |
| [ReflectionsView.swift](../../ios/Sources/Views/ReflectionsView.swift) | attendance | Present; crew deductions added here |
| [RemindersView.swift](../../ios/Sources/Views/RemindersView.swift) | ../ui | Shared component; source family reviewed |
| [ReportsView.swift](../../ios/Sources/Views/ReportsView.swift) | reports | Present |
| [ResetPasswordView.swift](../../ios/Sources/Views/ResetPasswordView.swift) | auth | Present |
| [RoomBookingComposer.swift](../../ios/Sources/Views/RoomBookingComposer.swift) | agenda | Present |
| [RootView.swift](../../ios/Sources/Views/RootView.swift) | ../ui | Shared/platform infrastructure |
| [SearchView.swift](../../ios/Sources/Views/SearchView.swift) | search | Present |
| [ServerSwitchViews.swift](../../ios/Sources/Views/ServerSwitchViews.swift) | ../ui/components/ServerSwitch.kt | Platform component |
| [SettingsExtras.swift](../../ios/Sources/Views/SettingsExtras.swift) | auth | Present |
| [SettingsView.swift](../../ios/Sources/Views/SettingsView.swift) | auth | Present |
| [SidebarFolderTree.swift](../../ios/Sources/Views/SidebarFolderTree.swift) | projects | Present; U9/U10 excluded |
| [SidebarToggle.swift](../../ios/Sources/Views/SidebarToggle.swift) | ../ui | Shared/platform infrastructure |
| [SignUpView.swift](../../ios/Sources/Views/SignUpView.swift) | auth | Present |
| [SocialMediaView.swift](../../ios/Sources/Views/SocialMediaView.swift) | social | Implemented here; visual QA pending |
| [SubmissionsView.swift](../../ios/Sources/Views/SubmissionsView.swift) | forms | Present |
| [TaskBatchDuplicate.swift](../../ios/Sources/Views/TaskBatchDuplicate.swift) | tasks | Present |
| [TaskDetailExtrasView.swift](../../ios/Sources/Views/TaskDetailExtrasView.swift) | tasks | Present |
| [TaskDetailView.swift](../../ios/Sources/Views/TaskDetailView.swift) | tasks | Present |
| [TaskPageActions.swift](../../ios/Sources/Views/TaskPageActions.swift) | tasks | Present |
| [TasksView.swift](../../ios/Sources/Views/TasksView.swift) | tasks | Present |
| [TeamDetailView.swift](../../ios/Sources/Views/TeamDetailView.swift) | admin | Present |
| [TeamsView.swift](../../ios/Sources/Views/TeamsView.swift) | admin | Present |
| [TemplateGallery.swift](../../ios/Sources/Views/TemplateGallery.swift) | projects | Present; U9/U10 excluded |
| [ThreadsView.swift](../../ios/Sources/Views/ThreadsView.swift) | threads | Present |
| [TicketsView.swift](../../ios/Sources/Views/TicketsView.swift) | tickets | Present; U4 excluded |
| [TouchTarget.swift](../../ios/Sources/Views/TouchTarget.swift) | ../ui | Shared/platform infrastructure |
| [UnitTreePicker.swift](../../ios/Sources/Views/UnitTreePicker.swift) | projects | Present; U9/U10 excluded |
| [UpdateRequiredView.swift](../../ios/Sources/Views/UpdateRequiredView.swift) | update | Present |
| [VaultAccessSheet.swift](../../ios/Sources/Views/VaultAccessSheet.swift) | vault | Present; U5 excluded |
| [VaultMediaViewer.swift](../../ios/Sources/Views/VaultMediaViewer.swift) | vault | Present; U5 excluded |
| [VaultMovePicker.swift](../../ios/Sources/Views/VaultMovePicker.swift) | vault | Present; U5 excluded |
| [VaultSharedFileView.swift](../../ios/Sources/Views/VaultSharedFileView.swift) | vault | Present; U5 excluded |
| [VaultShareSheet.swift](../../ios/Sources/Views/VaultShareSheet.swift) | vault | Present; U5 excluded |
| [VaultUploadPanel.swift](../../ios/Sources/Views/VaultUploadPanel.swift) | vault | Present; U5 excluded |
| [VaultView.swift](../../ios/Sources/Views/VaultView.swift) | vault | Present; U5 excluded |
| [XpAuditLogCard.swift](../../ios/Sources/Views/XpAuditLogCard.swift) | people/XpAudit.kt | Present ranking; G8 XP log gap |
| [ZoomableAvatar.swift](../../ios/Sources/Views/ZoomableAvatar.swift) | people | Present |

## Additional component-level web audit

These findings come from referenced web components and API call sites, including controls inside routes. Unused legacy API exports are not counted as active screens.

| ID / impact | Feature and source evidence | Disposition / estimate |
|---|---|---|
| G10 / medium | Control Room GIDEON Insights: runs, completion/failures/active people, trigger/status filters and run steps (GideonInsights.tsx) | Implemented. Private titles and hidden steps are explicitly suppressed even if present in a malformed payload. Device QA pending, 1 h |
| G11 / medium | Control Room Calendar project privacy (CalendarSettingsAdmin.tsx) | Implemented gated project search/toggles using single-project PATCH; server response controls state. Device QA pending, 1 h |
| G12 / high | FILE custom-field upload/view/remove (TaskDetailPanel.tsx); Android treated FILE as plain text | Implemented native task-detail and new-task file fields, multiple selection, one streamed multipart request per file, 250 MiB size gate, progress, authenticated viewing, removal confirmation and read-only access. No chunk endpoint is invented. Device/files QA pending, 1?2 h; Table/Gallery attachment previews remain limited |
| G13 / high | AutomationBuilder.swift and web AutomationsView.tsx can create/edit rules and add suggestions; Android AutomationsTab.kt can list/toggle/run and view logs, but sends users to web to edit | Left: native trigger/action/condition builder and suggestions, 1?2 days. Server GET and POST /api/automations/suggestions both exist (POST aliases GET); no endpoint blocker |
| G14 / medium | Web project GIDEON card has scheduled digests and project-scoped run history (GideonProjectCard.tsx, /api/gideon/schedules and /api/gideon/runs) | Left: native schedule list/create/edit/delete, timing/project/task delivery and project run card, 1?2 days. Admin run history is implemented separately as G10 |
| G15 / medium | Web AutofillPanel is called from table/task/form surfaces (/api/gideon/autofill and /run) | Left: field configuration, preview, accept/error states, 1?2 days; normal field editing is already native |
| G16 / low-medium | Project settings workflow-bundle picker (ProjectSettingsDrawer.tsx) | Left: list bundles, apply saved lists/rules, refresh and error flow, 2?3 h. Endpoints /api/workflow-bundles and /api/projects/:id/apply-bundle exist |
| G17 / medium | Docs template gallery, create/delete/nesting and page metadata; Android Docs.kt only lists/reads | Left with G5: native page management and structured editor, 2?4 days total. Templates GET exists, but canonical Android page-body read is unavailable |
| G18 / low-medium | Settings MCP access-token create/revoke and browser OAuth consent (settings.tsx/oauth.authorize.tsx) | Left: native token management with one-time secret display, 3?5 h. Browser OAuth consent can continue to open in the browser; no server changes needed |
| G19 / low-medium | Web XP audit manual adjustments (/api/gamification/xp-adjust) and automatic personal penalty popup (/api/gamification/my-penalties) | Left: guarded person/amount/reason adjustment and personal penalty acknowledgement, 3?5 h. Native personal XP ledger and penalty refunds already exist; G8 adds global viewing |
| G20 / medium | Web attendance manual absence processing and outage-day refund preview/apply | Implemented under crew deductions: explicit confirmations, read-only dry-run preview, separate apply, server result/failure counts. No live attendance mutations tested. Device QA pending, 1 h |
| G21 / low | Vault selected-file ZIP export (/api/vault/zip) | Left: native archive download/share with progress and permission errors, 2?3 h. Individual authenticated file viewing/sharing already exists |

Not active parity gaps: legacy Goals/Portfolios/Sprints, calendar collection CRUD, master-calendar CRUD and period-rewards API exports have no active route/component caller in this web checkout. Android's current Calendar/leaderboard are compared to the active routes instead. Web /api/legacy-ids and socket initialization are transport/legacy-link infrastructure, not screens. Approval chart and dashboard have Android-specific equivalent APIs. Admin org-chart layout writes are deliberately web-only per the existing native contract; native reads the layout and supports navigation.

## Server contract needed for G5

The missing capability is **a canonical, lossless Docs body read for an authenticated Android client**. The route exists, but src/lib/block-bodies.ts contentForClient unconditionally detects the Android X-Nexus-Client tag and calls docToBlockNote. That conversion flattens marks, list structure, details and unknown blocks (src/lib/blockdoc.ts docToBlockNote). There is no capability/version opt-in in that function. Therefore GET /api/docs/:id cannot provide the base needed for safe POST /api/collab/edit. Spoofing another platform or using a mutation as a read was not introduced. Server follow-up: expose the canonical document through an opt-in read contract, retaining compatibility for released Android clients. No server file was changed here.

Task-body GET /api/tasks/:id/body already returns canonical JSON and canEdit. Rich task-body editing and GIDEON writing still require native structured editing/merge UI (G5), but have no missing read endpoint. Existing guarded plain-text description editing remains the current Android behavior.

## Coverage limits for the new surfaces

No live fixtures, account roles, attendance, credit policy, bonus grants, project privacy or shared settings were changed. MockWebServer tests verify report read/write routes, null/zero/diff behavior, employment clearing, period queries, date-wide penalty refund payloads, bonus/override endpoints, page-save markdown and malformed-success handling, and single-project calendar privacy writes. Dedicated unit cases cover hidden run data and grouped-number cursor offsets. UI and lifecycle behavior still need emulator/device checks; passing JVM tests does not substitute for that QA.

## Handoff

Bundle target: C:/Users/Berlin/android-parity-19oct.bundle, containing 0d0e6e06..feat/android-parity-19oct. The requested range bundle was created and git bundle verify passed. It names prerequisites 0d0e6e06 and 7d4eecc1; the latter is already an ancestor of the former, so a repository containing the requested baseline has both. The bundle is regenerated after the report commit so the report travels with it. Overall status: partial parity; G1?G4/G7/G8 and additional admin/file surfaces implemented in source, remaining gaps and QA explicitly listed above.

## Implementation commits

All commits below have author and committer Berlin &lt;bagasputro.bp@gmail.com&gt;, with no attribution trailers. No version change or APK publication.

| Commit | Delivered source |
|---|---|
| 383f2186 | Social Media Report type, routing, screens and API |
| d754e6b8 | Outlet custom fields, guest overview, report settings and daily targets |
| f1ec1c24 | Crew dates, deductions, absence processing and outage refunds |
| b51699d7 | Credit role defaults, individual limits and bonus grants/history |
| 63cce1a0 | Calendar privacy and private-aware run Insights |
| 3b70037e | Answer Save as page and privileged API contract tests |
| bba3d14a | Global XP audit card |
| 37a2eff7 | File custom properties, streamed uploads and viewer permissions |
| 5263296d | Report presentation, localization, stale loads and unsaved-sheet dismissal guards |

Remaining estimates are engineering time, not promises that those items were QA-verified or will fit the release cutoff. The separate UI-round checkout/branch was not modified. No screenshots are claimed for this pass.

## Round 2 progress (19 October)

Baseline: fetched owner bundle and fast-forward merged hub/dev at 5e989d35. Round-2 bundle range is hub/dev..feat/android-parity-19oct.

Round-1 device QA is **in progress**. Installed the DEV-configured build on emulator-5556 during an idle window. EN/light screenshots under C:/Users/Berlin/Documents/Dev/nexus-shots/parity2 show Social overview, platform targets and day editor, Outlet overview/settings/form, and leaderboard XP entry. Isolated owned fixtures read back Social engagement 865 and Outlet sales 6,000,000/pax 45 with RSVP 40. Active Social platforms now hide the inapplicable Restore control. Crew/credits navigation needs a corrected pass. The UI-round session reinstalled its build during the ID/dark pass; those captures are invalid for parity and are not counted. Requested a reserved emulator window; remaining EN/ID/light/dark, G7 and mutation QA remains outstanding. No shared crew, attendance or credit policy records were changed. Restored the previous UI APK after the first collision; later UI install is left in place.

G13: native create/edit/delete builder, searchable type/field/value selectors, optional all/any conditions, ordered actions (up to ten), scheduling, notification recipients and suggestions. Full-access server capability gates editing. Drafts survive failed saves; dismissal and deletion require confirmation. Untouched config survives editing. Existing run log and Run now remain. DEV isolated disabled-rule create/edit/readback, suggestions GET and cleanup DELETE all passed. No rule was executed. Remaining refinement: richer typed custom-field/form selectors and full device QA.

G14/G15: project Automations now opens digest schedules and Autofill. Digest create/edit/toggle/delete, weekdays/time zone/language/instructions, Run now, next/last run and project-filtered privacy-aware run details are native. Autofill supports eligible fields, modes, instructions, create/update triggers, review/automatic approval, empty/all runs, running polling and result counts; removal/refill confirmations are explicit. Server canManage gates mutations. JVM API tests verify Sunday=0, null instructions, methods/paths, and review/scope payloads. testDebugUnitTest + assembleDebug passed after these changes (849 tests). DEV disabled digest creation/readback/cleanup and Autofill GET passed; generation was not run. Device QA remains outstanding pending the shared emulator window.

G5: the owner canonical-read contract is now live. Docs explicitly opt into ?format=canonical and require its format marker before editing; task bodies use their canonical GET. The shared native editor retains the first merge base, mirrors dirty drafts per account/body on device, edits known text blocks and nested lists/todos/toggles, preserves unknown blocks, supports insertion/reordering/removal, and posts exact base/doc to collab/edit. A 409 offers latest or explicit keep-both; failed saves retain the draft. Docs hide editing when canEdit is false. Task descriptions now enter this editor instead of flattening rich bodies into plain-text writes. GIDEON writing actions preview text before replacing a block or appending it to the draft. JVM preservation/API tests and testDebugUnitTest + assembleDebug passed (854 tests). DEV owned-document canonical read, save, stale conflict, keep-both and nested/unknown preservation all passed; the test doc was deleted. Limits: no live cursors/Yjs client; pending drafts are resumed when the editor is reopened, not automatically sent in background; writing output is inserted as text. Device QA remains pending.
