import SwiftUI

/// Switches between login and the authenticated app. The authenticated shape itself lives in
/// AdaptiveRoot, which picks a tab bar or a sidebar from the horizontal size class.
struct RootView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @State private var appearance = AppAppearance.shared
    @StateObject private var sync = OfflineSync.shared
    /// Covers the app while the cache is read and the warm-up runs.
    ///
    /// Shown on a first sign-in, and again when the app has been closed long enough that everything
    /// on screen would otherwise be a spinner. NOT on every launch: a splash somebody sees twenty
    /// times a day is a tax, not a welcome.
    @State private var showSplash = false
    /// WHO was warmed, not whether anybody was. A plain flag survives a logout, so signing in as
    /// somebody else on the same launch skipped the warm-up entirely and left the new person
    /// looking at whatever the previous one had not wiped.
    @State private var warmedUserId: String?

    var body: some View {
        @Bindable var router = router
        if auth.isAuthenticated {
            // In-app light/dark override. nil = follow the iOS setting.
            AdaptiveRoot()
                .preferredColorScheme(appearance.theme.colorScheme)
                .task(id: auth.session?.userId) {
                    guard let userId = auth.session?.userId, warmedUserId != userId else { return }
                    warmedUserId = userId
                    // Nothing to show yet, or nothing shown for a while: stand in front. Otherwise
                    // refresh underneath and let the person straight in.
                    let cold = sync.isCold
                    let stale = sync.lastDataSync.map { Date().timeIntervalSince($0) > 30 * 60 } ?? true
                    if cold || stale { withAnimation(.easeOut(duration: 0.25)) { showSplash = true } }
                    // The mark takes about a second to draw itself; dismissing before it finishes
                    // would look like a glitch rather than a greeting.
                    // `Void?`, not `Void`: `try?` on a throwing call that returns nothing still
                    // produces an optional, and the mismatch is a compile error rather than a
                    // warning.
                    async let floor: Void? = try? await Task.sleep(for: .milliseconds(cold ? 1400 : 900))
                    await sync.syncData(userId: userId)
                    _ = await floor
                    withAnimation(.easeOut(duration: 0.3)) { showSplash = false }
                    // The files carry on behind the app, and stop themselves on mobile data.
                    // Not for the UI screenshot tour: its QA account sits in ~95 projects, and their
                    // files have no business filling the disk of the Mac the tour runs on.
                    if !TourMode.isActive { sync.syncMedia(userId: userId) }
                    // Page / description edits made offline go out now (a conflict waits for its page).
                    await BlockEditOutbox.shared.flush()
                }
                // GIDEON first, announcements second: the overlay added last draws on top, and an
                // announcement must never end up behind a floating button.
                .overlay(alignment: .bottomLeading) { GideonLauncher() }
                // Z Vault uploads (owner, 9 Oct 2026): the centred card, or its pill above the tab bar,
                // over whatever screen the person has moved on to. An overlay, not a sheet, so the app
                // underneath stays usable; above GIDEON, below an announcement.
                .overlay { VaultUploadOverlay() }
                // Above the whole app rather than inside a tab: an announcement is not a screen you
                // navigate to, and it must reach somebody wherever they happen to be standing.
                // Not during the UI screenshot tour, which photographs the screens underneath.
                .overlay { if !TourMode.isActive { AnnouncementModal() } }
                // The splash LAST, because the overlay added last draws on top. It used to sit first,
                // and the GIDEON button floated over the logo while the warm-up ran — an
                // announcement would have done the same.
                .overlay {
                    if showSplash {
                        SplashView(status: sync.status, progress: sync.progress)
                            .transition(.opacity)
                            .zIndex(50)
                    }
                }
                // A form link tapped outside the app, drawn over whichever shape is mounted.
                //
                // It sits here rather than in NexusApp for two reasons that both have teeth. First,
                // it is INSIDE the authenticated branch, so a link that arrives while signed out
                // cannot open a form on top of the login screen — the request waits in the router
                // and this sheet appears by itself the moment sign-in finishes, which means the
                // login the link provoked does not throw the link away. Second, it is after
                // `preferredColorScheme`, so the form obeys the app's own light/dark setting rather
                // than the phone's; presented from outside that modifier it would not be covered.
                //
                // A sheet rather than a push, because a form reached from a link is a task and not
                // a place: there is no list behind it to go back to, and the same code has to work
                // under the phone's tab bar and the iPad's sidebar, which share no navigation
                // stack for anything to be pushed onto.
                .sheet(item: $router.formRequest) { request in
                    NavigationStack {
                        // FormFillView brings no bar of its own — every other way in is a
                        // NavigationLink, which supplies the back button. Here nothing does, and a
                        // sheet whose only exit is a drag is a trap on a form long enough to
                        // scroll, so the way out is added from this side.
                        //
                        // The placeholder title shows for as long as the fetch takes and is then
                        // replaced by the form's real name. "Form" is deliberately not in
                        // Localization.swift: T() falls back to the English literal, and the
                        // Indonesian for this one is the same word.
                        Group {
                            // `/f/legal-<token>`: the Legal request form (owner, 14 Oct 2026).
                            if LegalRequestLinks.isLinkId(request.id) {
                                LegalRequestFormView(linkId: request.id)
                            } else {
                                FormFillView(formId: request.id, title: T("Form"))
                            }
                        }
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    // A form to fill: "Cancel", as on every other sheet that edits (F-30).
                                    Button(T("Cancel")) { router.formRequest = nil }
                                }
                            }
                    }
                    // Page sized on iPad / Mac: the form sheet was half the screen and its pinned Send bar cut
                    // "Needed by" mid-line, with Related project and Attachments out of sight (run 15, Q-IB5).
                    .tallSheet()
                    // Passed explicitly: a sheet on Mac Catalyst does not always inherit the environment.
                    .environment(auth).environment(router)
                }
                // A vault link tapped outside the app. Inside the authenticated branch for the same
                // reason the form sheet is: a link that arrives while signed out waits in the router
                // and opens by itself once sign-in finishes, instead of being thrown away by the
                // login it provoked.
                .sheet(item: $router.vaultRequest) { request in
                    NavigationStack {
                        VaultSharedFileView(slug: request.id)
                            .toolbar {
                                ToolbarItem(placement: .cancellationAction) {
                                    Button(T("Close")) { router.vaultRequest = nil }
                                }
                            }
                    }
                    // Passed explicitly: a sheet on Mac Catalyst does not always inherit the environment.
                    .environment(auth).environment(router)
                }
                // A task, project or submission a notification pointed at. A sheet for the same
                // reason the form is one: it arrives from outside, it has no list behind it, and it
                // has to work under the tab bar and the sidebar alike.
                .sheet(item: $router.detail) { request in
                    NavigationStack {
                        Group {
                            switch request.target {
                            case .task(let id):       TaskDetailView(taskId: id)
                            case .project(let id):    ProjectDetailView(projectId: id, projectName: "")
                            case .submission(let id): SubmissionDetailSheet(submissionId: id)
                            case .legalRequest(let id): MyLegalRequestSheet(requestId: id, standalone: false)
                            default:                  EmptyView()
                            }
                        }
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) {
                                Button(T("Close")) { router.detail = nil }
                            }
                        }
                    }
                    // Passed explicitly: a sheet on Mac Catalyst does not always inherit the environment.
                    .environment(auth).environment(router)
                }
        } else {
            // LoginView forces `.light` itself, and MUST stay outside that modifier.
            // `preferredColorScheme` is a preference, and a preference written by an ancestor
            // replaces whatever the subtree wrote — so wrapping the whole app in it silently
            // cancelled LoginView's choice, nil ("Follow system") included. Login then followed
            // iOS dark: worse than before the theme setting existed.
            LoginView()
        }
    }

}

/// "More" — app-launcher grid mirroring the web sidebar groups (Home / Work / Team / System, the plain
/// names since 12 Oct 2026) + account footer.
struct MoreView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @State private var viewer = Viewer.shared
    @State private var badge = InboxBadge.shared
    private let cols = [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)]

    var body: some View {
        @Bindable var router = router
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        MoreSection(T("Home")) {
                            LazyVGrid(columns: cols, spacing: 12) {
                                // Chat has a tab of its own and My Tasks lives here (owner, 9 Oct 2026).
                                MoreTile(T("My Tasks"), "checklist", NX.success) { TasksView(providesOwnStack: false) }
                                if viewer.isCompanyMember {
                                    MoreTile(T("Threads"), "text.bubble.fill", NX.violetText) { ThreadsView() }
                                }
                                MoreTile(T("My Submissions"), "tray.full.fill", NX.warning) { SubmissionsView() }
                                // The Calendar has a tab of its own now and Inbox lives here, with the
                                // unread count the More tab carries (owner, 8 Oct 2026). While the
                                // server's `flags.calendar` holds the Calendar back, Inbox keeps its
                                // tab and neither has a tile.
                                if RemoteConfig.shared.calendar {
                                    MoreTile(T("Notifications"), "tray.fill", NX.blue, badge: badge.count) {
                                        InboxView(providesOwnStack: false)
                                    }
                                }
                                MoreTile(T("Room Booking"), "door.left.hand.open", NX.coral) { RoomBookingView() }
                                if viewer.isCompanyMember {
                                    MoreTile(T("Z Vault"), "externaldrive.fill", NX.violetText) { VaultView() }
                                }
                            }
                        }
                        MoreSection(T("Work")) {
                            LazyVGrid(columns: cols, spacing: 12) {
                                // Invitation only (owner, 14 Oct 2026): the roster's canAccessLegal.
                                if viewer.canAccessLegal {
                                    MoreTile(T("Legal"), NX.legalSymbol, NX.blue) { LegalView() }
                                }
                                MoreTile(T("Leaderboard"), "trophy.fill", NX.warning) { LeaderboardView() }
                                MoreTile(T("Reports"), "chart.bar.fill", NX.success) { ReportsView() }
                                MoreTile(T("Forms"), "doc.text.fill", NX.blue) { FormsView() }
                                // No "Pipeline" tile (owner, 9 Oct 2026): the board opens from Projects
                                // like any project.
                            }
                        }
                        MoreSection(T("Team")) {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile(T("Attendance"), "clock.badge.checkmark.fill", NX.success) { AttendanceView() }
                            }
                        }
                        MoreSection(T("System")) {
                            LazyVGrid(columns: cols, spacing: 12) {
                                MoreTile(T("Tickets"), "ticket.fill", NX.blue) { TicketsView() }
                                // Tile Teams dilepas: halaman daftar-tim sudah tidak ada juga di web.
                                // Pengaturan tim dibuka dari chip tim di Control Room > Users, yaitu
                                // di baris orang yang timnya sedang dibicarakan.
                                MoreTile(T("What's new"), "sparkles", NX.violetText) { WhatsNewScreen() }
                                MoreTile(T("Settings"), "gearshape.fill", NX.mutedFg) { SettingsView() }
                                if viewer.canAdminister {
                                    MoreTile(T("Control Room"), "shield.fill", NX.danger) { AdminView() }
                                }
                            }
                        }

                        AccountFooter { router.morePush = .settings }
                    }
                    .padding(16)
                }
            }
            .task { await viewer.loadIfNeeded() }
            .navigationTitle(T("More"))
            .navigationBarTitleDisplayMode(.inline)
            // A launcher screen is not a tab, so reaching one from outside the app — Siri, a
            // widget, a tapped notification — means pushing it here. Bound rather than
            // fired-and-forgotten, so swiping back clears it and a second request works like the
            // first.
            .navigationDestination(item: $router.morePush) { screen in
                pushed(screen)
            }
        }
    }

    /// The launcher screens are written to be pushed INTO this stack, so Messages gets its
    /// no-stack form here rather than the self-contained one the sidebar asks for: a
    /// NavigationStack nested inside another one loses the back button on everything above it.
    @ViewBuilder private func pushed(_ screen: NXScreen) -> some View {
        switch screen {
        case .messages: MessagesView()
        // Inbox and Tasks build their own stack as tab roots; pushed here they must not (see above).
        case .inbox:    InboxView(providesOwnStack: false)
        case .tasks:    TasksView(providesOwnStack: false)
        default:        screen.view
        }
    }
}

/// Section header + content block for the More grid.
struct MoreSection<Content: View>: View {
    let title: String
    @ViewBuilder let content: () -> Content
    init(_ title: String, @ViewBuilder content: @escaping () -> Content) {
        self.title = title; self.content = content
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(title).padding(.leading, 4)
            content()
        }
    }
}

/// One launcher tile: tinted icon square + title, pushes a destination.
struct MoreTile<Destination: View>: View {
    let title: String
    let systemImage: String
    let tint: Color
    /// An unread count drawn on the tile's corner (Inbox); 0 draws nothing.
    var badge: Int = 0
    @ViewBuilder let destination: () -> Destination
    init(_ title: String, _ systemImage: String, _ tint: Color, badge: Int = 0,
         @ViewBuilder destination: @escaping () -> Destination) {
        self.title = title; self.systemImage = systemImage; self.tint = tint; self.badge = badge
        self.destination = destination
    }
    var body: some View {
        NavigationLink { destination() } label: {
            VStack(alignment: .leading, spacing: 12) {
                Image.nxSymbol(systemImage)
                    .font(.system(size: 20, weight: .semibold)).foregroundStyle(tint)
                    .frame(width: 46, height: 46)
                    .background(tint.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 110, alignment: .topLeading)
            .padding(14)
            .background {
                RoundedRectangle(cornerRadius: 18, style: .continuous).fill(NX.card)
                    .nexusShadowSoft()
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
            }
            .overlay(alignment: .topTrailing) {
                if badge > 0 {
                    // The tab bar's red count, on the tile it is about.
                    Text(badge > 99 ? "99+" : "\(badge)")
                        .font(NXFont.text(11, .bold)).monospacedDigit().foregroundStyle(Color.white)
                        .padding(.horizontal, 6)
                        .frame(minWidth: 22, minHeight: 22)
                        .background(NX.danger, in: Capsule())
                        .padding(12)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityValue(Text(verbatim: badge > 0 ? "\(badge) \(T("unread"))" : ""))
    }
}

/// Account card (avatar + name + email) and logout.
struct AccountFooter: View {
    /// How the host opens the profile. The phone pushes it into the More stack, the sidebar
    /// selects it — the card itself has no way to know which shell it is standing in.
    let onOpenProfile: () -> Void
    @Environment(AuthStore.self) private var auth
    /// The Keychain `Session` only stores id/name/email — no avatar — so the footer could only ever
    /// draw an initial. Fetch the profile for the real photo.
    @State private var avatar: String?
    @State private var signOutBlocked = false

    var body: some View {
        VStack(spacing: 12) {
            if let s = auth.session {
                let name = s.userName.isEmpty ? s.userEmail : s.userName
                Button(action: onOpenProfile) {
                    HStack(spacing: 12) {
                        AvatarView(url: avatar, initial: String(name.first ?? "?").uppercased(), size: 46)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(name).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                            Text(s.userEmail).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        }
                        Spacer()
                    }
                    .padding(14)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Button { if !auth.signOutIfAllowed() { signOutBlocked = true } } label: {
                Label(T("Log out"), systemImage: "rectangle.portrait.and.arrow.right")
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.danger)
                    .frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(NX.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(.top, 4)
        .task { avatar = try? await APIClient.shared.profile().user.avatar }
        .signOutBlockedAlert(isPresented: $signOutBlocked)
    }
}

extension View {
    /// "Check out first": shown when Logout is tapped during a running workday.
    func signOutBlockedAlert(isPresented: Binding<Bool>) -> some View {
        alert(RemoteConfig.shared.text("signout.blocked.title", T("Check out first")), isPresented: isPresented) {
            Button(T("OK"), role: .cancel) {}
        } message: {
            Text(RemoteConfig.shared.text("signout.blocked.body", T("You're checked in, so your workday and live location are still running. You can't sign out until you check out — check out on the Attendance screen, then sign out.")))
        }
    }
}
