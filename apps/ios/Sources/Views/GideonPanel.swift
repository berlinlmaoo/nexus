import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import UIKit

/// The one place that decides WHERE the launcher may be drawn. `true` = the Home screen itself,
/// `false` = the every-screen behaviour it shipped with.
///
/// The owner asked for Home only: hung above the whole app, the circle covered whatever scrolled
/// underneath it — a row's text on Attendance, a card's title on My Submissions, the composer's own
/// buttons on a chat. Home is the one screen laid out around it. Nothing else in the app reads the
/// current screen for this, so putting the button back everywhere is this constant and nothing more.
private let gideonLauncherHomeOnly = true

/// The floating GIDEON button, and the chat it opens.
///
/// Bottom-LEFT on purpose. The right-hand side of a phone screen is where thumbs already live —
/// send buttons, compose buttons, the scroll edge — and a permanent circle parked there gets pressed
/// by accident. On the web the panel sits bottom-right because a cursor does not have that problem.
struct GideonLauncher: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var open = false
    /// ⌘O does nothing while a sheet is up over the screen (focus stays in the top-most sheet, QA BoD R2).
    @State private var cover = SheetCover()

    var body: some View {
        // Home in both shapes: the phone's first tab, and the sidebar's Dashboard row. Read here in
        // `body` rather than in a computed property of its own, because the router is main-actor
        // isolated and `body` is the only member of a View that is guaranteed to be too.
        //
        // The tab is not enough on its own. Six screens are reached from Home's quick tiles and are
        // pushed onto Home's own stack, so the tab stays `.dashboard` on every one of them — which
        // is how the button ended up sitting on top of a chat composer. `homeIsRoot` is the second
        // half: is Home the screen, or only the tab.
        let onHomeTab = hSize == .regular ? router.sidebarScreen == .dashboard : router.tab == .dashboard
        let onHome = onHomeTab && router.homeIsRoot
        // GIDEON's own page (iPad / Mac sidebar) binds ⌘O itself: one binding at a time.
        let onGideonPage = hSize == .regular && router.sidebarScreen == .gideon
        Group {
            // iPad / Mac: Home carries the GIDEON button in its search row, beside the search field as on
            // the web, so nothing floats over the page's cards (UI tour run 17, iPad R17-I-01 / R17-M-01:
            // the floating circle covered the agenda's last day and a leaderboard row).
            if hSize == .regular || (gideonLauncherHomeOnly && !onHome) {
                Color.clear.frame(width: 0, height: 0).allowsHitTesting(false)
            } else {
                launcher
            }
        }
        // ⌘O anywhere = a new GIDEON chat (web launcher, QA 13 Oct 2026). A text field keeps the key only
        // where it has a meaning of its own; none here does.
        .background {
            if !onGideonPage {
                Button("") {
                    guard !cover.isCovered else { return }
                    // A new chat about the page on screen (web: ⌘O opens a new chat; the panel's chip is
                    // the page you're on), never the context of an earlier "Ask GIDEON".
                    GideonChat.shared.startChat(page: GideonPages.shared.current)
                    open = true
                }
                .keyboardShortcut("o", modifiers: .command)
                .background(SheetCover.Anchor(cover: cover))
                .opacity(0).accessibilityHidden(true)
            }
        }
        // Handed over explicitly: on Mac Catalyst the sheet did not inherit them and opening the
        // panel trapped on "No Observable object of type AuthStore found".
        .sheet(isPresented: $open) { GideonPanel().environment(auth).environment(router) }
    }

    private var launcher: some View {
        Button {
            open = true
        } label: {
            // The GIDEON mark on the app's own card surface — the same material as every other
            // raised thing in NEXUS. A tinted gradient blob would announce itself louder than
            // anything it sits on top of, and look like every other assistant button ever drawn.
            Image("GideonLogo")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 26, height: 26)
                .foregroundStyle(NX.foreground)
                .frame(width: 52, height: 52)
                .background(NX.card, in: Circle())
                .overlay(Circle().strokeBorder(NX.border))
                .shadow(color: .black.opacity(0.22), radius: 12, y: 5)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("GIDEON")
        // Phone: bottom-left, clear of the tab bar. iPad and Mac: bottom-right of the window, so it
        // sits over Home's content instead of on top of the sidebar's rows (owner, 29 Sep 2026).
        .padding(hSize == .regular ? .trailing : .leading, hSize == .regular ? 28 : 20)
        .padding(.bottom, hSize == .regular ? 28 : 76)
        .frame(maxWidth: .infinity, maxHeight: .infinity,
               alignment: hSize == .regular ? .bottomTrailing : .bottomLeading)
    }
}

struct GideonPanel: View {
    /// Opened from a project or a task ("Ask GIDEON"): a new chat about it (web, 12 Oct 2026).
    var openContext: GideonContext? = nil
    /// GIDEON's own page in the iPad / Mac sidebar (or pushed in More on a phone): no Close button (it is
    /// not a sheet), and — like the web's /gideon — a new chat with no page context when it opens.
    var embedded = false
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var hSize

    /// The conversation, the composer's draft and the queue — all of it outside this view, because
    /// this view is a sheet and a sheet is destroyed when it is dismissed. See `GideonChat`.
    @State private var chat = GideonChat.shared
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var showFilePicker = false
    /// An attachment being looked at, and one being handed to the share sheet. Both driven by
    /// tapping a chip in the transcript — see `open`. View state on purpose: what is on the screen
    /// when the screen goes away is nothing to keep.
    @State private var preview: AttachmentPreview?
    @State private var shareItem: ShareItem?
    @FocusState private var composerFocused: Bool
    /// Remembered on the device: somebody who picks Terra for quick questions should not have to
    /// pick it again every time the panel opens.
    @State private var showReviewNotice = false
    @AppStorage("gideon.tier") private var tierRaw = GideonTier.fallback.rawValue
    /// "Review before writing ▾" in the composer (web gideon-approval), remembered on the device.
    @AppStorage("gideon.approval") private var approvalRaw = GideonApprovalMode.fallback.rawValue
    /// A source or card tapped in an answer: opened inside this sheet's own stack.
    @State private var openRef: GideonRef?
    @State private var showChats = false
    /// Apply / Discard asks first, in a centred alert (house rule).
    @State private var decision: GideonDecision?
    @State private var showPersonalize = false
    @State private var saveRequest: GideonSaveRequest?
    @State private var savedDocId: String?
    @State private var confirmDeleteChat = false
    @State private var confirmClearAll = false
    /// The answer whose Copy was just pressed ("Copied" for a moment).
    @State private var copiedId: String?
    /// Set once this view has decided which conversation and context it opens on. View identity, not
    /// onAppear: coming back from a source opened in this stack must not start another chat.
    @State private var didOpen = false
    /// The name the person gave GIDEON (Personalize); empty = "GIDEON".
    @State private var assistantName = ""

    private var tier: GideonTier { GideonTier(rawValue: tierRaw) ?? .fallback }
    private var approvalMode: GideonApprovalMode { GideonApprovalMode(rawValue: approvalRaw) ?? .fallback }
    private var displayName: String {
        let n = assistantName.trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? "GIDEON" : n
    }
    /// The web's full page (chat list column + header) on iPad landscape and Mac; a sheet, and every
    /// phone, keeps the compact panel.
    private var wide: Bool { embedded && hSize == .regular }

    @ViewBuilder private func refDestination(_ ref: GideonRef) -> some View {
        switch ref.kind {
        case "project": ProjectDetailView(projectId: ref.id, projectName: ref.title ?? "")
        case "doc": DocReaderView(docId: ref.id, title: DocTitle.display(ref.title))
        default: TaskDetailView(taskId: ref.id)
        }
    }

    /// The @ picker over the composer while the draft ends in "@…".
    @ViewBuilder private var mentionPicker: some View {
        if let q = GideonMention.query(in: chat.draft) {
            GideonMentionPicker(query: q) { ref in addRef(ref) }
        }
    }

    private func addRef(_ ref: GideonRef) {
        chat.draft = GideonMention.strip(chat.draft)
        guard !chat.context.refs.contains(where: { $0.kind == ref.kind && $0.id == ref.id }), chat.context.refs.count < 8 else { return }
        chat.context.refs.append(ref)
    }

    /// "+ → Add a page, task or project": starts an "@" at the end of the draft (web startMention).
    private func startMention() {
        let d = chat.draft
        chat.draft = d + ((d.isEmpty || d.hasSuffix(" ") || d.hasSuffix("\n")) ? "@" : " @")
        composerFocused = true
    }

    private func newChat() {
        chat.startChat(page: embedded ? nil : chat.pageContext)
        composerFocused = true
    }

    /// Its own NavigationStack as a sheet; as a page (sidebar, or pushed inside More on a phone) it lives in
    /// the stack it is shown in — a stack inside a stack loses the back button.
    @ViewBuilder private func stackIfNeeded<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        if embedded { content() } else { NavigationStack { content() } }
    }

    var body: some View {
        stackIfNeeded {
            screen
                .navigationDestination(item: $openRef) { ref in refDestination(ref) }
                // ⌘O = a new chat (web GideonPanel). A hidden button: a key on a menu item only works while
                // that menu is open.
                .background {
                    Button("") { newChat() }
                        .keyboardShortcut("o", modifiers: .command)
                        .opacity(0).accessibilityHidden(true)
                }
                // One presentation per host view: every sheet / alert after the first gets its own anchor.
                .background { Color.clear.sheet(isPresented: $showPersonalize) {
                    GideonPersonalizeSheet { p in assistantName = p.assistantName ?? "" }
                } }
                .sheet(item: $saveRequest) { r in
                    GideonSaveDocSheet(title: r.title, markdown: r.markdown, contextProjectId: saveProjectId,
                                       contextProjectName: chat.context.projectName) { id in savedDocId = id }
                }
                .background { Color.clear.alert(T("Saved as a doc"), isPresented: Binding(get: { savedDocId != nil }, set: { if !$0 { savedDocId = nil } })) {
                    Button(T("Open page")) { if let id = savedDocId { openRef = GideonRef(kind: "doc", id: id, title: nil, projectId: nil) } }
                    Button("OK", role: .cancel) {}
                } }
                .background { Color.clear.sheet(isPresented: $showChats) {
                    GideonChatsSheet { id in Task { await chat.openChat(id) } }
                } }
                .alert(decision?.title ?? "", isPresented: Binding(get: { decision != nil }, set: { if !$0 { decision = nil } }), presenting: decision) { d in
                    Button(d.apply ? T("Apply") : T("Discard"), role: d.apply ? nil : .destructive) {
                        Task { await chat.decide(d.proposal, apply: d.apply, booking: d.booking) }
                    }
                    Button(T("Cancel"), role: .cancel) {}
                } message: { d in Text(d.message) }
                .background { Color.clear.alert(T("Delete this chat?"), isPresented: $confirmDeleteChat) {
                    Button(T("Delete"), role: .destructive) { Task { await chat.deleteCurrent() } }
                    Button(T("Cancel"), role: .cancel) {}
                } message: { Text(T("Removed from your chats. It's kept for 90 days for review by the Board of Directors, then deleted.")) } }
                .background { Color.clear.alert(T("Clear every GIDEON chat?"), isPresented: $confirmClearAll) {
                    Button(T("Clear history"), role: .destructive) { Task { await chat.clearAll() } }
                    Button(T("Cancel"), role: .cancel) {}
                } message: { Text(T("Removed from your chats. They're kept for 90 days for review by the Board of Directors, then deleted.")) } }
        }
        .task {
            if let p = try? await GideonClient.prefs() {
                assistantName = p.assistantName ?? ""
                showReviewNotice = p.reviewNotice
            }
        }
        .onAppear { openOnce() }
        // GIDEON answered a 401 while the panel was closed, or answers one now. The store has no
        // AuthStore and deliberately does not go looking for one — this is where the two meet, and
        // `initial` is what makes a refusal that landed while nobody was watching still count.
        .onChange(of: chat.sessionExpired, initial: true) { _, expired in
            guard expired else { return }
            chat.clearSessionExpiry()
            auth.logout()
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $pickedPhoto,
                      matching: .images, photoLibrary: .shared())
        .fullScreenCover(isPresented: $showCamera) {
            // Rear lens: this one is pointed at whiteboards and documents, not at faces.
            CameraPicker(cameraDevice: .rear) { data in
                chat.attachment = Self.shrink(data)
                showCamera = false
            }
            .ignoresSafeArea()
        }
        // `.item` rather than the accepted UTTypes: several of them (md, yml, log, ipynb) resolve to
        // dynamic UTIs that a document provider need not advertise, so filtering would hide the very
        // file the owner is looking at. `attach` refuses the wrong ones with the reason instead.
        .sheet(isPresented: $showFilePicker) {
            DocumentPicker(types: [.item], multiple: false) { urls in
                let result: Result<[URL], Error> = .success(urls)
                if case let .success(urls) = result, let url = urls.first { attach(url) }
            }
            .ignoresSafeArea()
        }
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    chat.attachment = Self.shrink(data)
                }
                pickedPhoto = nil
            }
        }
        // The same two the rest of the app opens an attachment with — a task's files use this exact
        // pair. Nothing new is drawn for GIDEON: a picture, a PDF and a film already have viewers
        // here, and what none of them can draw goes where a download goes.
        .sheet(item: $shareItem) { item in ActivityView(items: [item.url]) }
        .fullScreenCover(item: $preview) { AttachmentViewerView(preview: $0) }
    }

    /// Which conversation and which page context this panel opens on — the web's rules, once per view:
    /// - GIDEON's own page (/gideon): a new chat, no page context (the project page is gone from the
    ///   screen, so "here" means nothing).
    /// - "Ask GIDEON" on a project / task: a new chat about it (web openGideon(ctx, {newChat: true})).
    /// - The launcher: the latest chat, with the chip following the page on screen (none on Home).
    private func openOnce() {
        guard !didOpen else { return }
        didOpen = true
        if embedded {
            // A question asked from a sheet may still be in flight: let it finish, but nothing it was
            // about follows the person onto this page.
            if chat.sending { chat.leavePage() } else { chat.startChat(page: nil) }
        } else if let openContext {
            chat.startChat(page: openContext)
        } else {
            chat.follow(page: GideonPages.shared.current)
        }
    }

    /// Where "Save as doc" offers "This project" (web: the page's project, else the first @ project).
    private var saveProjectId: String? {
        chat.context.projectId ?? chat.context.refs.first(where: { $0.kind == "project" })?.id
    }

    // MARK: - screen

    @ViewBuilder private var screen: some View {
        if wide {
            VStack(spacing: 0) {
                pageHeader
                HStack(spacing: 0) {
                    GideonChatListColumn(activeId: chat.chatId, reloadKey: "\(chat.chatId ?? "-")|\(chat.sending)|\(chat.chatTitle ?? "")",
                                         onPick: { id in Task { await chat.openChat(id) } },
                                         onNew: { newChat() })
                        .frame(width: 288)
                    Rectangle().fill(NX.border).frame(width: 1)
                    conversation
                }
            }
            .background(NX.card.ignoresSafeArea())
            // The page draws the web's header itself; the sidebar is this screen's way back.
            .toolbar(.hidden, for: .navigationBar)
        } else {
            ZStack {
                NX.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    // The phone's bar drops its title for the tier, history, new chat and ⋯ group, so the name
                    // and the web's "Acts in NEXUS as you" (what GIDEON may do) sit at the top of the page
                    // (UI tour run 19, R19-I-11).
                    if GideonSystemTitle.available && hSize == .compact {
                        title.frame(maxWidth: .infinity).padding(.vertical, 6)
                    }
                    conversation
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .modifier(GideonSystemTitle(title: displayName, subtitle: subtitleText))
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    // Esc closes the panel (hardware keyboard, Mac — web QA 13 Oct 2026).
                    if !embedded { Button(T("Close")) { dismiss() }.keyboardShortcut(.cancelAction) }
                }
                if !GideonSystemTitle.available {
                    ToolbarItem(placement: .principal) { title }
                }
                ToolbarItem(placement: .topBarTrailing) { tierChip }
                // Chat history and New chat as their own buttons, as web's header (UI tour run 7);
                // the rest stays in ⋯.
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { showChats = true } label: { Image(systemName: "clock.arrow.circlepath") }
                        .accessibilityLabel(T("Chat history"))
                    Button { newChat() } label: { Image(systemName: "square.and.pencil") }
                        .accessibilityLabel(T("New chat"))
                    Menu {
                        Button { showPersonalize = true } label: { Label(T("Personalize"), systemImage: "person.crop.circle.badge.checkmark") }
                        Divider()
                        moreDestructiveItems
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel(T("Chat options"))
                }
            }
        }
    }

    @ViewBuilder private var moreDestructiveItems: some View {
        if chat.chatId != nil && !chat.turns.isEmpty {
            Button(role: .destructive) { confirmDeleteChat = true } label: { Label(T("Delete this chat"), systemImage: "trash") }
                .disabled(chat.sending)
        }
        Button(role: .destructive) { confirmClearAll = true } label: { Label(T("Clear all chat history"), systemImage: "trash") }
            .disabled(chat.sending)
    }

    /// The transcript and the composer: one column, capped to the web's reading width on the page.
    private var conversation: some View {
        VStack(spacing: 0) {
            transcript
            VStack(spacing: 0) {
                Rectangle().fill(NX.border).frame(height: 1)
                composerArea
                    .frame(maxWidth: wide ? 768 : .infinity)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, wide ? 24 : 12)
                    .padding(.vertical, wide ? 14 : 10)
            }
            .background(wide ? NX.card : NX.background)
        }
    }

    // MARK: - header (regular width)

    /// The web's page header: the mark, the name and "Acts in NEXUS as you" (or the chat's title), then
    /// the tier chip and ⋯ at the right.
    private var pageHeader: some View {
        VStack(spacing: 0) {
            HStack(spacing: 10) {
                SidebarReopenButton()
                Image("GideonLogo")
                    .renderingMode(.template).resizable().scaledToFit()
                    .frame(width: 16, height: 16)
                    .foregroundStyle(NX.foreground)
                    .frame(width: 34, height: 34)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 1) {
                    Button { showChats = true } label: {
                        HStack(spacing: 5) {
                            Text(displayName).font(NXFont.text(16, .bold)).lineLimit(1)
                            Image(systemName: "chevron.down").font(.system(size: 10))
                        }.foregroundStyle(NX.foreground)
                    }.buttonStyle(.plain).accessibilityLabel(T("Chat history"))
                    Text(chat.chatTitle.flatMap { GideonChatTitle.text($0) } ?? T("Acts in NEXUS as you"))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 12)
                // No New chat here: the chats column beside the conversation always has one, and two
                // identical buttons a few points apart read as two different actions (UI tour run 11, PD-15).
                tierChip
                Menu {
                    Button { showPersonalize = true } label: { Label(T("Personalize"), systemImage: "person.crop.circle") }
                    Divider()
                    moreDestructiveItems
                } label: {
                    Image(systemName: "ellipsis").font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(NX.mutedFg)
                        .frame(width: 34, height: 34).contentShape(Rectangle())
                }
                .menuIndicator(.hidden)
                .buttonStyle(.plain)
                .accessibilityLabel(T("More"))
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            Rectangle().fill(NX.border).frame(height: 1)
        }
        .background(NX.card)
    }

    /// "Luna ▾" (web SelectPicker): the tier, with each one's blurb in the menu.
    private var tierChip: some View {
        Menu {
            Picker(T("GIDEON tier"), selection: $tierRaw) {
                ForEach(GideonTier.allCases) { option in
                    Text(option.label).tag(option.rawValue)
                }
            }
            .pickerStyle(.inline)
            Text(tier.blurb)
        } label: {
            HStack(spacing: 4) {
                Text(tier.label).font(NXFont.text(13, .semibold))
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(NX.mutedFg)
            .padding(.horizontal, 10)
            .frame(height: 30)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
            .contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
        .disabled(chat.sending)
        .accessibilityLabel(T("GIDEON tier"))
        .accessibilityIdentifier("gideon.tier")
    }

    // MARK: - title (compact)

    /// "GIDEON" over "Acts in NEXUS as you" (or the chat's title), as web's header (UI tour run 9, I9). The
    /// tier is its own "Luna ▾" chip beside it, so the title's width no longer changes with the tier (the
    /// old "GIDEON Luna ▾" title animated between widths and clipped its first letters).
    private var subtitleText: String { chat.chatTitle.flatMap { GideonChatTitle.text($0) } ?? T("Acts in NEXUS as you") }

    private var title: some View {
        VStack(spacing: 0) {
            Button { showChats = true } label: {
                HStack(spacing: 5) {
                    Text(displayName).font(NXFont.display(15, .bold)).lineLimit(1)
                    Image(systemName: "chevron.down").font(.system(size: 9))
                }.foregroundStyle(NX.foreground)
            }.buttonStyle(.plain).accessibilityLabel(T("Chat history"))
            Text(subtitleText)
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
        }
        .frame(maxWidth: 260)
        .accessibilityElement(children: .combine)
    }

    // MARK: - transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    if chat.turns.isEmpty && !chat.sending {
                        GideonEmptyPrompt(assistant: displayName, page: chat.context.hasPage ? chat.context : nil, wide: wide) { s in
                            chat.draft = s
                            submit()
                        }
                    }
                    ForEach(chat.turns) { turn in
                        bubble(turn).id(turn.id).transition(appear)
                    }
                    if let error = chat.error {
                        errorLine(error).id("error")
                    }
                    // A fixed anchor rather than the last turn's id: the newest thing on screen is
                    // sometimes the error line or an answer that has not been given an id yet.
                    Color.clear.frame(height: 1).id("bottom")
                }
                .frame(maxWidth: wide ? 768 : .infinity)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, wide ? 24 : 16)
                .padding(.vertical, 16)
            }
            // Everything that can leave the newest message under the fold: history arriving, a turn
            // being added, the answer landing inside it, and the keyboard taking half the screen.
            .onChange(of: chat.turns.count) { _, _ in toBottom(proxy) }
            .onChange(of: chat.turns.last?.content) { _, _ in toBottom(proxy) }
            .onChange(of: chat.error) { _, _ in toBottom(proxy) }
            .onChange(of: composerFocused) { _, focused in
                guard focused else { return }
                toBottom(proxy)
                // The scroll view's keyboard inset lands with the keyboard, a beat after the focus
                // changes, so the scroll above is aimed at the old content height; this one is not.
                Task { try? await Task.sleep(for: .milliseconds(350)); toBottom(proxy) }
            }
            .task {
                // Decide what this panel opens on BEFORE reading history. The `.onAppear` that also does it
                // sits on the outer view, and on the phone this inner task ran first, so the read below
                // still saw the old conversation (UI tour 13 Oct 2026). openOnce runs once per view.
                openOnce()
                // Every open, not only the first. The thread lives on the server, so this picks up
                // whatever was said on the web — and it is what swaps a just-sent attachment's
                // bytes for the url the server kept, once there is one. `refresh` leaves the
                // transcript alone while a question is in flight, when a new chat was asked for, and
                // when the fetch fails, which is what makes running it on every open safe.
                await chat.refresh()
                // The stack is lazy, so the last row does not exist on the pass that sets `turns`;
                // one hop later it does. Unanimated on purpose — opening the panel should START at
                // the newest message, not scroll there through history nobody asked to re-read.
                await Task.yield()
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
    }

    /// The last failure, in words, with Try again when asking again can help (GIDEON busy or unreachable,
    /// an answer that never came, a conversation that failed to load).
    private func errorLine(_ error: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(error)
                .font(NXFont.text(13))
                .foregroundStyle(NX.danger)
                .fixedSize(horizontal: false, vertical: true)
            if chat.canRetry {
                Button { chat.retry() } label: {
                    Label(T("Try again"), systemImage: "arrow.clockwise")
                        .font(NXFont.text(13, .semibold))
                        .foregroundStyle(NX.foreground)
                        .frame(minHeight: 32)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// One place that decides what "show me the newest message" means, so opening the panel, a new
    /// bubble, an error and the keyboard all land in the same spot.
    private func toBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo("bottom", anchor: .bottom) }
    }

    /// A bubble fades and rises the first time it is drawn. An insertion transition only runs inside
    /// an animated transaction, so this belongs to the `withAnimation` that adds a turn — a lazy
    /// stack materialising rows during a scroll leaves it alone.
    private var appear: AnyTransition {
        if reduceMotion { return .identity }
        return AnyTransition.opacity.combined(with: .offset(y: 8))
    }

    @ViewBuilder private func bubble(_ turn: GideonTurn) -> some View {
        if turn.role == .user { userBubble(turn) } else { assistantTurn(turn) }
    }

    /// The question (web): near-black, right-aligned, its attachments above the text.
    private func userBubble(_ turn: GideonTurn) -> some View {
        HStack {
            Spacer(minLength: 44)
            VStack(alignment: .leading, spacing: 6) {
                // Indices rather than the values, because two attachments can be identical in every
                // field a struct has.
                ForEach(turn.attachments.indices, id: \.self) { index in
                    attachmentChip(turn.attachments[index], key: "\(turn.id)-\(index)")
                }
                Text(turn.content)
                    .font(NXFont.text(15))
                    .lineSpacing(2)
                    .foregroundStyle(NX.foreground)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(NX.violet.opacity(0.07), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    /// The answer (web AssistantTurn): what GIDEON did, the answer as Markdown on a soft panel, the
    /// changes waiting for Apply, what it made, the sources, then Copy · Save as doc.
    private func assistantTurn(_ turn: GideonTurn) -> some View {
        let live = chat.answeringId == turn.id
        return VStack(alignment: .leading, spacing: 8) {
            GideonStepsLine(steps: turn.steps, streaming: live)
            if !turn.content.isEmpty {
                GideonMarkdownView(text: turn.content, size: 15) { ref in openRef = ref }
                    .transition(.opacity)
            } else if live && turn.steps.isEmpty {
                Text(T("Thinking…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .modifier(GideonThinkingShimmer())
            }
            if turn.stopped { Text(T("Stopped")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
            if let notice = turn.creditNotice {
                Text(notice.text).font(NXFont.text(12)).foregroundStyle(NX.warning)
            }
            ForEach(turn.proposals) { p in proposalCard(p) }
            ForEach(turn.cards) { card in cardRow(card) }
            if !turn.sources.isEmpty && !live { sourcesBlock(turn.sources) }
            if !turn.content.isEmpty && !live { answerActions(turn) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.trailing, wide ? 0 : 24)
    }

    // MARK: - steps, sources, cards, proposals

    /// The question an answer replies to (its first line), for the page title.
    private func question(before turn: GideonTurn) -> String {
        guard let i = chat.turns.firstIndex(where: { $0.id == turn.id }) else { return "" }
        let prev = chat.turns[..<i].last { $0.role == .user }?.content ?? ""
        return String((prev.components(separatedBy: "\n").first ?? "").prefix(120))
    }

    /// Copy · Save as doc under a finished answer (web).
    private func answerActions(_ turn: GideonTurn) -> some View {
        HStack(spacing: 2) {
            Button {
                UIPasteboard.general.string = turn.content
                copiedId = turn.id
                Task {
                    try? await Task.sleep(for: .milliseconds(1500))
                    if copiedId == turn.id { copiedId = nil }
                }
            } label: {
                actionLabel(copiedId == turn.id ? T("Copied") : T("Copy"), icon: copiedId == turn.id ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            Button {
                let q = question(before: turn)
                saveRequest = GideonSaveRequest(title: q.isEmpty ? T("GIDEON answer") : q, markdown: turn.content)
            } label: {
                actionLabel(T("Save as doc"), icon: "doc.badge.plus")
            }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .disabled(chat.sending)
        }
    }

    private func actionLabel(_ text: String, icon: String) -> some View {
        Label(text, systemImage: icon)
            .font(NXFont.text(12))
            .foregroundStyle(NX.mutedFg)
            .padding(.horizontal, 6)
            .frame(minHeight: 28)
            .contentShape(Rectangle())
    }

    private func sourcesBlock(_ sources: [GideonRef]) -> some View {
        FlowLayout(spacing: 6) {
            Text(T("Sources")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                .padding(.vertical, 4)
            ForEach(sources.prefix(8)) { ref in refChip(ref) }
            if sources.count > 8 {
                Text(String(format: T("+%d more"), sources.count - 8)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .padding(.vertical, 4)
            }
        }
    }

    private func cardRow(_ card: GideonCard) -> some View {
        let kind: String = card.kind == "doc" ? "doc" : "task"
        let sub: String = [cardActionLabel(card.action), card.projectName].compactMap { $0 }.joined(separator: " · ")
        return Button { openRef = GideonRef(kind: kind, id: card.id, title: card.title, projectId: nil) } label: {
            HStack(spacing: 8) {
                Image(systemName: card.action == "created" ? "plus.circle.fill" : "pencil.circle.fill").foregroundStyle(NX.success)
                VStack(alignment: .leading, spacing: 1) {
                    Text(card.title ?? T("Task")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(sub).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(card.kind == "comment")
    }

    private func cardActionLabel(_ a: String?) -> String {
        switch a {
        case "created": return T("Created")
        case "commented": return T("Commented")
        default: return T("Updated")
        }
    }

    private func refChip(_ ref: GideonRef) -> some View {
        Button { openRef = ref } label: {
            HStack(spacing: 4) {
                if ref.kind == "project" { ProjectMark(icon: nil, color: nil, size: 12, projectId: ref.id) }
                else { Image(systemName: Self.icon(ref.kind)).font(.system(size: 10, weight: .semibold)) }
                Text(ref.title ?? "").lineLimit(1)
            }
            .font(NXFont.text(12, .medium)).foregroundStyle(NX.foreground)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(NX.border))
        }
        .buttonStyle(.plain)
        // Only what the app can open; comments, forms and messages are named but not linked here.
        .disabled(!(ref.kind == "task" || ref.kind == "project" || ref.kind == "doc"))
    }

    static func icon(_ kind: String) -> String {
        switch kind {
        case "project": return "folder"
        case "task": return "checklist"
        case "comment": return "text.bubble"
        case "message": return "bubble.left"
        case "form": return "list.clipboard"
        default: return "doc.text"
        }
    }

    /// A room booking has its own card with the room picker (GideonBookRoomCard), and so does moving or cancelling
    /// one (GideonBookingChangeCard, 16 Oct 2026); every other change is a diff.
    @ViewBuilder private func proposalCard(_ p: GideonProposal) -> some View {
        if p.action == "book_room", let b = p.booking {
            GideonBookRoomCard(proposal: p, booking: b,
                               onApply: { choice in decision = GideonDecision(proposal: p, apply: true, booking: choice) },
                               onDiscard: { decision = GideonDecision(proposal: p, apply: false) })
        } else if p.action == "move_room_booking" || p.action == "cancel_room_booking", let c = p.bookingChange {
            GideonBookingChangeCard(proposal: p, change: c,
                                    onApply: { choice in decision = GideonDecision(proposal: p, apply: true, booking: choice) },
                                    onDiscard: { decision = GideonDecision(proposal: p, apply: false) })
        } else {
            changeProposalCard(p)
        }
    }

    private func changeProposalCard(_ p: GideonProposal) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "checkmark.shield").font(.system(size: 12)).foregroundStyle(NX.warning)
                Text(p.summary ?? T("GIDEON wants to make a change")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array((p.diff ?? []).enumerated()), id: \.offset) { _, row in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(row.field ?? "").font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    if let from = row.from?.text, !from.isEmpty { Text(ServerText.enumWord(from)).strikethrough().font(NXFont.text(12)).foregroundStyle(NX.danger) }
                    Image(systemName: "arrow.right").font(.system(size: 8)).foregroundStyle(NX.mutedFg)
                    Text(ServerText.enumWord(row.to?.text ?? "—")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.success)
                }
            }
            if p.isPending {
                Text(T("Waiting for your approval")).font(NXFont.text(12, .medium)).foregroundStyle(NX.warning)
                HStack(spacing: 8) {
                    Spacer(minLength: 0)
                    Button(T("Discard")) { decision = GideonDecision(proposal: p, apply: false) }
                        .buttonStyle(.plain).foregroundStyle(NX.mutedFg)
                    Button { decision = GideonDecision(proposal: p, apply: true) } label: {
                        Label(T("Apply"), systemImage: "checkmark")
                    }
                    .buttonStyle(.nxPrimary)
                }
            } else {
                Text(proposalStatus(p)).font(NXFont.text(12, .semibold))
                    .foregroundStyle(p.status == "APPLIED" ? NX.success : (p.status == "FAILED" ? NX.danger : NX.mutedFg))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.warning.opacity(0.06), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.warning.opacity(0.3)))
    }

    private func proposalStatus(_ p: GideonProposal) -> String {
        switch p.status {
        case "APPLIED": return T("Applied")
        case "DISCARDED": return T("Discarded")
        case "APPLYING": return T("Applying…")
        case "FAILED": return p.error ?? T("Couldn't apply it.")
        default: return p.status.capitalized
        }
    }

    // MARK: - context chips

    /// The page this chat is about ("The page you're on") and the @ pages, each removable — then GIDEON
    /// looks across everything you can see.
    @ViewBuilder private var contextChips: some View {
        let ctx = chat.context
        if ctx.hasPage || !ctx.refs.isEmpty {
            FlowLayout(spacing: 6) {
                if ctx.hasPage {
                    contextChip(icon: ctx.docId != nil ? "doc.text" : (ctx.taskId != nil ? "checklist" : "folder"),
                                projectId: ctx.docId == nil && ctx.taskId == nil ? ctx.projectId : nil,
                                label: ctx.pageLabel ?? T("This project")) { chat.dismissPage() }
                        .help(T("The page you're on"))
                }
                ForEach(ctx.refs, id: \.self) { r in
                    contextChip(icon: Self.icon(r.kind), projectId: r.kind == "project" ? r.id : nil, label: r.title ?? "") {
                        chat.context.refs.removeAll { $0 == r }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func contextChip(icon: String, projectId: String? = nil, label: String, remove: @escaping () -> Void) -> some View {
        HStack(spacing: 5) {
            // A project is drawn with its own mark (photo or page icon), as everywhere else.
            if let projectId { ProjectMark(icon: nil, color: nil, size: 12, projectId: projectId) }
            else { Image(systemName: icon).font(.system(size: 10, weight: .semibold)) }
            Text(label).lineLimit(1).frame(maxWidth: 260, alignment: .leading).fixedSize(horizontal: true, vertical: false)
            Button(action: remove) {
                Image(systemName: "xmark").font(.system(size: 8, weight: .bold))
                    .frame(width: 22, height: 22).touchTarget44(drawn: 22)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Remove this context"))
        }
        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
        .padding(.leading, 10).padding(.trailing, 2)
        .frame(minHeight: 26)
        .background(NX.muted.opacity(0.6), in: Capsule())
        .overlay(Capsule().strokeBorder(NX.border))
    }

    // MARK: - composer

    @ViewBuilder
    private var attachmentStrip: some View {
        if chat.attachment != nil || chat.document != nil {
            VStack(spacing: 6) {
                if let attachment = chat.attachment, let image = UIImage(data: attachment) {
                    attachmentChip(art: .local(image), label: T("Image attached"),
                                   remove: { chat.attachment = nil })
                }
                if let document = chat.document {
                    attachmentChip(art: .glyph("doc.text"), label: document.name,
                                   remove: { chat.document = nil })
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .overlay(alignment: .top) { Rectangle().fill(NX.border.opacity(0.6)).frame(height: 1) }
        }
    }

    /// An attachment that has already been sent: the same chip as below, with no X on it.
    ///
    /// Three ways to fill the square, in the order they are worth having. The bytes are used when
    /// this process still holds them — the question sent a moment ago, whose picture is already
    /// decoded. Otherwise a stored picture is fetched from its url. A document, and a picture whose
    /// file has gone, get the glyph, which is what the chip has always worn.
    ///
    /// Only a PICTURE is offered to the thumbnail cache. A document carries its bytes now too, and
    /// asking ImageIO to make a thumbnail of a PDF would both fail and, sharing a turn with a photo,
    /// hand back the photo's cached tile under a key drawn from the same turn.
    ///
    /// `key` is per attachment and not per turn, so a question carrying both a picture and a file
    /// keeps them apart in the thumbnail cache and on disk.
    private func attachmentChip(_ item: GideonAttachment, key: String) -> some View {
        let isImage = item.kind == .image
        let art: GideonChipArt
        if isImage, let data = item.bytes, let made = GideonThumbnail.image(data, key: key) {
            art = .local(made)
        } else if isImage, let remote = Self.remote(item.url) {
            art = .remote(remote)
        } else {
            art = .glyph(isImage ? "photo" : "doc.text")
        }
        let chip = attachmentChip(art: art,
                                  label: isImage ? T("Image attached") : item.name,
                                  onBubble: true,
                                  remove: nil)
        // A chip is a button once there is a file behind it, and in the minute a question is open
        // the only file there is is the one in this process. That is what the bytes on the turn are
        // for: the server keeps nothing until it has an answer to keep it with, so waiting for a
        // url meant the one attachment somebody actually wanted to check — the one they had just
        // sent — was the one attachment they could not open.
        return Group {
            if item.bytes != nil || item.url != nil {
                Button { Task { await open(item, key: key) } } label: { chip }
                    .buttonStyle(.plain)
            } else {
                chip
            }
        }
    }

    /// The one shape an attachment has, in both places it is drawn: under the composer with an X
    /// while it waits, and inside the bubble of the question it went with. Same chip, so sending
    /// does not change what the file looks like — it only moves it up the screen.
    ///
    /// `remove: nil` is what says "already sent": no X, and no Spacer either, since a Spacer inside
    /// a bubble would stretch it to the full width of the panel.
    private func attachmentChip(art: GideonChipArt, label: String,
                                onBubble: Bool = false,
                                remove: (() -> Void)?) -> some View {
        let tone: Color = onBubble ? NX.foreground.opacity(0.85) : NX.mutedFg
        let plate: Color = onBubble ? NX.violet.opacity(0.08) : NX.muted.opacity(0.6)
        return HStack(spacing: 10) {
            switch art {
            case .local(let image):
                Image(uiImage: image)
                    .resizable().scaledToFill()
                    .frame(width: 38, height: 38)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            case .remote(let url):
                CachedImage(url: url, maxPixel: 120) {
                    $0.resizable().scaledToFill()
                } placeholder: {
                    // Also what is left on screen when the row outlived its file and /api/files
                    // answers 404: the glyph the chip would have worn anyway, rather than a spinner
                    // that never stops or a square of nothing.
                    Image(systemName: "photo").font(.system(size: 15)).foregroundStyle(tone)
                }
                .frame(width: 38, height: 38)
                .background(plate, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            case .glyph(let name):
                Image(systemName: name)
                    .font(.system(size: 15))
                    .foregroundStyle(tone)
                    .frame(width: 38, height: 38)
                    .background(plate, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            }
            Text(label).font(NXFont.text(13)).foregroundStyle(tone).lineLimit(1)
            if let remove {
                Spacer(minLength: 8)
                Button(action: remove) {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(tone).touchTarget44(drawn: 20)
                }
                .buttonStyle(.plain)
            }
        }
    }

    /// Above the composer: the @ picker and the context chips; then the composer card (web): the field,
    /// what is attached, and + · "Review before writing ▾" · send.
    private var composerArea: some View {
        VStack(alignment: .leading, spacing: 8) {
            if showReviewNotice {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "info.circle").foregroundStyle(NX.violetText)
                    Text(T("GIDEON chats can be reviewed by the Board of Directors for work purposes."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 0)
                    Button(T("Got it")) {
                        showReviewNotice = false
                        Task {
                            do { _ = try await GideonClient.acknowledgeReviewNotice() }
                            catch { showReviewNotice = true; chat.error = error.localizedDescription }
                        }
                    }.buttonStyle(.plain).font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                        .accessibilityIdentifier("gideon.reviewNotice.gotIt")
                }
                .padding(12)
                .background(NX.violet.opacity(0.06), in: RoundedRectangle(cornerRadius: 12))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                .accessibilityIdentifier("gideon.reviewNotice")
            }
            mentionPicker
            GideonCreditMeter().padding(.horizontal, 4).padding(.bottom, 4)
            composer
            Text(T("GIDEON is AI and can make mistakes."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .center)
                .multilineTextAlignment(.center)
                .accessibilityIdentifier("gideon.disclaimer")
        }
    }

    private var composer: some View {
        // The draft lives on the store, so the field needs a binding INTO it. Declared here for the
        // same reason RootView declares one for the router: `@Bindable` is a local wrapper, and this
        // is the only member that writes through it.
        @Bindable var chat = chat
        return VStack(alignment: .leading, spacing: 0) {
            contextChips.padding(.horizontal, 12)
            TextField(T("Ask anything. Type @ to add a page"), text: $chat.draft, axis: .vertical)
                .accessibilityLabel(T("Ask anything. Type @ to add a page"))
                .accessibilityIdentifier("gideon.composer")
                .font(NXFont.text(15))
                .lineLimit(wide ? 3...10 : 2...6)
                .textFieldStyle(.plain)
                .focused($composerFocused)
                // Hardware keyboard (iPad, Mac): Enter asks, Shift+Enter is a new line (web panel).
                .onKeyPress(keys: [.return], phases: .down) { press in
                    if press.modifiers.contains(.shift) || press.modifiers.contains(.option) { return .ignored }
                    submit()
                    return .handled
                }
                .padding(.horizontal, 12)
                .padding(.top, 12)
                .padding(.bottom, 4)
            attachmentStrip
            HStack(spacing: 4) {
                plusMenu
                approvalMenu
                Spacer(minLength: 8)
                if chat.sending {
                    Button { chat.stop() } label: {
                        Image(systemName: "stop.fill").font(.system(size: 13, weight: .bold))
                            .foregroundStyle(NX.card).frame(width: 34, height: 34)
                            .background(NX.onyx, in: Circle()).frame(width: 44, height: 44)
                    }.buttonStyle(.plain).accessibilityLabel(T("Stop"))
                } else {
                Button {
                    submit()
                } label: {
                    Image(systemName: "arrow.up")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(NX.card)
                        .frame(width: 34, height: 34)
                        .background(NX.onyx.opacity(canSend ? 1 : 0.35), in: Circle())
                        .frame(width: 44, height: 44)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!canSend)
                .accessibilityLabel(T("Send"))
                }
            }
            .padding(.horizontal, 4)
        }
        .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous)
            .strokeBorder(composerFocused ? NX.onyx.opacity(0.45) : NX.border))
    }

    /// One menu rather than three icons (web "+"). A PhotosPicker nested in a Menu draws its row but never
    /// opens, so the menu only flips flags and the pickers themselves hang off the panel.
    private var plusMenu: some View {
        Menu {
            Button { showPhotoPicker = true } label: { Label(T("Add a photo"), systemImage: "photo") }
            Button { showCamera = true } label: { Label(T("Camera"), systemImage: "camera") }
            Button { showFilePicker = true } label: { Label(T("Add a file (PDF, Word, Excel, text…)"), systemImage: "paperclip") }
            Button { startMention() } label: { Label(T("Add a page, task or project"), systemImage: "at") }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(NX.mutedFg)
                .frame(width: 36, height: 36)
                .contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
        .accessibilityLabel(T("Add photos, files or pages"))
    }

    /// "Review before writing ▾" (web): what has to wait for Apply before GIDEON changes something.
    private var approvalMenu: some View {
        Menu {
            Section(T("Before GIDEON changes something")) {
                ForEach(GideonApprovalMode.allCases) { m in
                    // A Toggle draws the menu's checkmark; two Texts give the row its subtitle.
                    Toggle(isOn: Binding(get: { approvalMode == m }, set: { on in if on { approvalRaw = m.rawValue } })) {
                        Text(m.name)
                        Text(m.blurb)
                    }
                }
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "checkmark.shield").font(.system(size: 12))
                Text(approvalMode.name).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
            }
            .font(NXFont.text(13, .semibold))
            .foregroundStyle(NX.mutedFg)
            .padding(.horizontal, 6)
            .frame(minHeight: 36)
            .contentShape(Rectangle())
        }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
        .accessibilityIdentifier("gideon.approvalMode")
        .help(approvalMode.blurb)
    }

    /// Deliberately does not consult `sending`. The composer stays live while GIDEON is thinking;
    /// what a mid-flight tap does is the store's problem, not the button's.
    private var canSend: Bool {
        !chat.draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - attachments

    private func attach(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let ext = url.pathExtension.lowercased()
        guard GideonDocument.acceptedExtensions.contains(ext) else {
            chat.error = T("GIDEON can't read that kind of file yet.")
            return
        }
        // Asked of the file system rather than of the bytes, and asked first. The picker hands back
        // whatever was tapped, and the old order read the whole thing before measuring it — a 4 GB
        // film locked the main actor for the length of the read purely in order to refuse it.
        let size = APIClient.fileSize(of: url)
        guard size > 0 else {
            chat.error = T("Couldn't read that file.")
            return
        }
        // The server enforces this too, and says so in Indonesian. Checking here saves sending ten
        // megabytes over mobile data to be told they were nine too many.
        guard size <= GideonDocument.maxBytes else {
            chat.error = T("File is over the 10MB limit.")
            return
        }
        guard let data = try? Data(contentsOf: url) else {
            chat.error = T("Couldn't read that file.")
            return
        }
        chat.error = nil
        chat.document = GideonDocument(
            name: url.lastPathComponent,
            type: UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream",
            data: data
        )
    }

    /// Opens an attachment.
    ///
    /// The three viewers the app already has, chosen the way every other attachment in NEXUS is: a
    /// picture goes straight at the remote url, because `ImageLoader` fetches it with the session,
    /// downsamples it once and keeps the result; a PDF or a film has to be a file on disk, because
    /// PDFKit and AVPlayer both want somewhere to seek and neither can be handed a cookie. A .docx
    /// or a .xlsx — which GIDEON accepts and no viewer here draws — goes to the share sheet, which
    /// is the difference between an attachment and a download.
    ///
    /// What this process is holding is preferred over what the server has, and not only because it
    /// is faster: for the length of a question it is the ONLY copy, and after that the two are the
    /// same bytes. The local file is written once and kept beside every other downloaded attachment,
    /// so a second tap costs nothing.
    private func open(_ item: GideonAttachment, key: String) async {
        let label = item.name.isEmpty ? T("Image attached") : item.name
        if let bytes = item.bytes {
            // A photo has no filename of its own, and the bytes ARE the JPEG `shrink` made — so it
            // is given one that says so. `AttachmentKind`, PDFKit and AVPlayer all read an
            // extension before they read anything else.
            let named = item.name.isEmpty ? "image.jpg" : item.name
            guard let file = await Self.spill(bytes, key: key, named: named) else {
                chat.error = T("Couldn't open this file.")
                return
            }
            guard let kind = AttachmentKind(mime: item.mime, name: named) else {
                shareItem = ShareItem(url: file)
                return
            }
            preview = AttachmentPreview(id: file.absoluteString, name: label, kind: kind, source: file)
            return
        }
        guard let raw = item.url, !raw.isEmpty else { return }
        // A photo read back from history has no filename either, so the stored file's name stands
        // in — it is the one thing that still carries the extension.
        let stored = raw.split(separator: "/").last.map(String.init) ?? ""
        guard let kind = AttachmentKind(mime: item.mime, name: item.name.isEmpty ? stored : item.name) else {
            guard let file = await fetch(raw, named: label) else { return }
            shareItem = ShareItem(url: file)
            return
        }
        if kind == .image {
            guard let remote = Self.remote(raw) else { return }
            preview = AttachmentPreview(id: raw, name: label, kind: kind, source: remote)
            return
        }
        guard let file = await fetch(raw, named: label) else { return }
        preview = AttachmentPreview(id: raw, name: label, kind: kind, source: file)
    }

    /// A copy on disk, or a sentence saying why there isn't one.
    ///
    /// The row can outlive the file — a database restored from a backup older than the uploads
    /// beside it, or somebody clearing the directory by hand. /api/files answers that with a 404,
    /// and this is what turns it into something the user can read instead of a viewer opening onto
    /// a blank rectangle.
    private func fetch(_ raw: String, named: String) async -> URL? {
        do {
            return try await APIClient.shared.downloadAttachment(url: raw, fileName: named)
        } catch APIError.unauthorized {
            auth.logout()
            return nil
        } catch {
            chat.error = T("Couldn't open this file.")
            return nil
        }
    }

    /// A server path becomes a URL the same way it does everywhere else in the app: the host is
    /// added here rather than stored, so what is kept names a file and never the route it took.
    private static func remote(_ raw: String?) -> URL? {
        guard let raw, !raw.isEmpty else { return nil }
        return URL(string: raw.hasPrefix("http") ? raw : Config.baseURL.absoluteString + raw)
    }

    // MARK: - work

    /// Hands the question to the store, and decodes its thumbnail before the bubble is drawn.
    ///
    /// The queueing, the request and the transcript all live in `GideonChat` now, because all three
    /// have to outlive this view. What is left here is the one thing that genuinely belongs to the
    /// screen: the decode is done in a tap that is already paying for a layout pass, so the bubble's
    /// first draw and every redraw an arriving answer forces are cache reads and nothing more.
    private func submit() {
        guard let turn = chat.submit(tier: tier, approvalMode: approvalMode) else { return }
        guard let index = turn.attachments.firstIndex(where: { $0.kind == .image }),
              let bytes = turn.attachments[index].bytes else { return }
        _ = GideonThumbnail.image(bytes, key: "\(turn.id)-\(index)")
    }
}

/// What goes in the 38pt square at the head of a chip.
///
/// One type for all three cases so that the chip itself keeps ONE shape, whether its picture is
/// already in memory, still on the server, or was never a picture at all. The alternative — a second
/// chip for stored attachments — is how the composer's chip and the bubble's chip would start to
/// drift apart, which is the thing the shared one was written to prevent.
private enum GideonChipArt {
    /// Already decoded: a photo this process is holding, freshly picked or freshly sent.
    case local(UIImage)
    /// Kept server-side. Fetched through `ImageLoader`, which carries the session, downsamples once
    /// and caches — so a thread full of chips is one fetch per file and no decode per redraw.
    case remote(URL)
    /// Not a picture, or not one that can be shown: an SF Symbol on a plate.
    case glyph(String)
}

/// Thumbnails for attachments already in the thread.
///
/// A bubble is rebuilt every time the transcript changes — once per chunk of an answer — and the
/// picture behind it is the full upload, up to 1568px. Decoding that on each pass is the cost this
/// app spent a day removing everywhere else, so it is decoded once, at the size the chip draws, and
/// kept. The key is the turn's id, which is a UUID minted per message and never reused.
///
/// NSCache rather than a dictionary: it empties itself under memory pressure, and a miss is only a
/// re-decode. `nonisolated(unsafe)` for the same reason `ImageLoader.memory` uses it — NSCache is
/// documented thread-safe but not marked Sendable.
private enum GideonThumbnail {
    nonisolated(unsafe) static let cache: NSCache<NSString, UIImage> = {
        let c = NSCache<NSString, UIImage>()
        c.countLimit = 40
        return c
    }()

    static func image(_ data: Data, key: String) -> UIImage? {
        if let hit = cache.object(forKey: key as NSString) { return hit }
        // 120px for a 38pt chip covers a 3x screen. ImageIO never enlarges, so a picture already
        // smaller than this comes back untouched.
        guard let made = ImageLoader.downsample(data, maxPixel: 120) else { return nil }
        cache.setObject(made, forKey: key as NSString)
        return made
    }
}

/// Three dots that breathe while a question is open.
///
/// One state flip drives all three and each dot's own delay staggers them, so the animation lives in
/// the animation system rather than in a timer writing state per frame — which is the last thing a
/// scrolling chat list can afford.
private struct GideonTypingDots: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var breathing = false

    var body: some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { dot in
                Circle()
                    .fill(NX.mutedFg)
                    .frame(width: 6, height: 6)
                    .opacity(breathing ? 1 : 0.3)
                    .animation(
                        reduceMotion
                            ? nil
                            : Animation.easeInOut(duration: 0.6).repeatForever(autoreverses: true).delay(Double(dot) * 0.18),
                        value: breathing
                    )
            }
        }
        // Roughly one line of body text, so the bubble does not jump when the answer replaces this.
        .frame(height: 18)
        .onAppear { breathing = true }
    }
}

extension GideonPanel {
    /// Shrinks a photo before it leaves the phone.
    ///
    /// The server downscales again on arrival, so this is about the upload, not the model: a full
    /// camera frame is several megabytes over mobile data for no gain — vision stops improving well
    /// before 1568px.
    static func shrink(_ data: Data, maxSide: CGFloat = 1568, quality: CGFloat = 0.8) -> Data {
        guard let image = UIImage(data: data) else { return data }
        let side = max(image.size.width, image.size.height)
        guard side > maxSide else { return image.jpegData(compressionQuality: quality) ?? data }

        let scale = maxSide / side
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: quality) ?? data
    }

    /// Puts bytes the app is holding on disk, so a viewer can be handed a file.
    ///
    /// `AttachmentPreview` carries a URL, and PDFKit and AVPlayer both want somewhere to seek — so
    /// an attachment that exists only as Data has to land somewhere before it can be looked at. It
    /// lands in the same cache every downloaded attachment lands in: one folder per file, named from
    /// a key, swept after a day. A directory of its own would be one more thing nothing tidies.
    ///
    /// Written off the main actor. `async` on a type that is not itself isolated runs on the
    /// cooperative pool, which is what keeps a ten-megabyte document off the frame that tapped it —
    /// the same reason `APIClient.bytes(of:)` is shaped this way.
    /// Off the main actor: a 10 MB document is written to disk without holding up the panel.
    nonisolated static func spill(_ data: Data, key: String, named: String) async -> URL? {
        let file = AttachmentCache.destination(remote: "gideon-outgoing/" + key, fileName: named)
        // Already written by an earlier tap. One key is one attachment — a turn's id is a UUID that
        // is never reused — so what is there is these bytes and not somebody else's.
        if (try? file.checkResourceIsReachable()) == true { return file }
        do {
            try FileManager.default.createDirectory(at: file.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            try data.write(to: file, options: .atomic)
            return file
        } catch {
            return nil
        }
    }
}

/// A proposal waiting for the person's answer in the centred alert.
struct GideonDecision: Identifiable {
    let proposal: GideonProposal
    let apply: Bool
    /// book_room / move_room_booking: the room and slot picked on the card; cancel_room_booking: the booking id.
    var booking: GideonBookingChoice? = nil
    var id: String { proposal.id + (apply ? "-apply" : "-discard") }
    var title: String { apply ? T("Apply this change?") : T("Discard this change?") }
    /// The picked room for a booking (the server's summary was written before the room was chosen).
    var message: String {
        if let booking, !booking.room.isEmpty {
            return [RoomBooking.label(booking.room), proposal.booking?.title ?? proposal.bookingChange?.title].compactMap { $0 }.joined(separator: " · ")
        }
        return proposal.summary ?? ""
    }
}

/// The person's GIDEON conversations, searchable; open one or delete it (asks first).
struct GideonChatsSheet: View {
    let onOpen: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var chats: [GideonChatSummary] = []
    @State private var query = ""
    @State private var loading = true
    @State private var toDelete: GideonChatSummary?
    /// The list failed to load (QA 13 Oct 2026: a failure is not "No chats yet").
    @State private var failure: String?
    @State private var deleteFailure: String?

    var body: some View {
        NavigationStack {
            Group {
                if loading && chats.isEmpty {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let failure, chats.isEmpty {
                    ErrorState(message: failure, icon: "bubble.left.and.text.bubble.right") { Task { await load() } }
                } else if chats.isEmpty {
                    EmptyState(icon: "bubble.left.and.text.bubble.right", title: query.isEmpty ? T("No chats yet") : T("No chats match"),
                               subtitle: query.isEmpty ? T("Every conversation with GIDEON is kept here, on the web and in the app.") : T("Try other words."))
                } else {
                    List {
                        ForEach(chats) { c in
                            Button { onOpen(c.id); dismiss() } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(GideonChatTitle.text(c.title) ?? T("Untitled chat")).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(2)
                                    if let m = c.match, !m.isEmpty {
                                        Text(m).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
                                    }
                                    if let d = ProjDate.parse(c.updatedAt) {
                                        Text(ProjDate.dayLabel(d)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                                    }
                                }
                                .frame(minHeight: 44, alignment: .leading)
                            }
                            .swipeActions {
                                Button(role: .destructive) { toDelete = c } label: { Label(T("Delete"), systemImage: "trash") }
                            }
                        }
                    }
                    .scrollContentBackground(.hidden)
                }
            }
            .background(NX.background.ignoresSafeArea())
            .searchable(text: $query, prompt: T("Search chats"))
            .navigationTitle(T("Chats"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() }.keyboardShortcut(.cancelAction) } }
            .task(id: query) {
                try? await Task.sleep(for: .milliseconds(250))
                await load()
            }
            .alert(T("Delete this chat?"), isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }), presenting: toDelete) { c in
                Button(T("Delete"), role: .destructive) {
                    Task {
                        do { try await GideonClient.deleteChat(c.id) }
                        catch { deleteFailure = GideonProblem.from(error).text }
                        await load()
                    }
                }
                Button(T("Cancel"), role: .cancel) {}
            } message: { _ in Text(T("Removed from your chats. It's kept for 90 days for review by the Board of Directors, then deleted.")) }
            .alert(T("Couldn't delete the chat"), isPresented: Binding(get: { deleteFailure != nil }, set: { if !$0 { deleteFailure = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(deleteFailure ?? "") }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            chats = try await GideonClient.chats(query: query)
            failure = nil
        } catch {
            // The search changed under it (a cancelled request): the next load answers.
            if Task.isCancelled { return }
            // Keeps the last rows it had; with none, the failure is said with Try again.
            failure = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load your chats.")
        }
    }
}

/// "Ask GIDEON" about the project or task on screen (web header button): opens the panel on a new chat
/// with that context. The panel reads only what this account can open.
struct AskGideonButton: View {
    let context: GideonContext
    /// iPad / Mac project header: logo + "Ask GIDEON" in the web's outlined button.
    var labelled = false
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            if labelled {
                HStack(spacing: 6) {
                    logo(15)
                    Text(T("Ask GIDEON")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                        .lineLimit(1).fixedSize()
                }
                .padding(.horizontal, 12).frame(height: 36)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
                .frame(minHeight: 44).contentShape(Rectangle())
            } else {
                logo(17)
                    .frame(width: 36, height: 36).background(NX.card, in: Circle()).overlay(Circle().strokeBorder(NX.border))
                    .frame(width: 44, height: 44).contentShape(Rectangle())
            }
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
        .accessibilityLabel(T("Ask GIDEON"))
        // The screen this button sits on is the page GIDEON is asked about while it shows (web
        // pushGideonPage on the project / task page): ⌘O and the launcher pick it up from there.
        .gideonPage(context)
        .sheet(isPresented: $open) { GideonPanel(openContext: context).environment(auth).environment(router) }
    }

    private func logo(_ size: CGFloat) -> some View {
        Image("GideonLogo").renderingMode(.template).resizable().scaledToFit()
            .frame(width: size, height: size)
            .foregroundStyle(NX.violetText)
    }
}


/// iOS 26+: the bar's own title and subtitle ("GIDEON" / "Acts in NEXUS as you", web's header). A
/// principal item is the first thing the bar drops when the trailing group (tier, history, new chat, ⋯)
/// needs the room, and the iPhone showed no title at all (UI tour runs 9–10); the system title is kept.
/// Earlier systems keep the principal item, which they do not drop.
struct GideonSystemTitle: ViewModifier {
    let title: String
    let subtitle: String

    static var available: Bool {
        if #available(iOS 26.0, *) { return true }
        return false
    }

    func body(content: Content) -> some View {
        if #available(iOS 26.0, *) {
            content.navigationTitle(title).navigationSubtitle(subtitle)
        } else {
            content
        }
    }
}

private struct GideonThinkingShimmer: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var bright = false
    func body(content: Content) -> some View {
        content.opacity(reduceMotion ? 1 : (bright ? 1 : 0.4))
            .animation(reduceMotion ? nil : .easeInOut(duration: 0.8).repeatForever(autoreverses: true), value: bright)
            .onAppear { bright = true }
    }
}
