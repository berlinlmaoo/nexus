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
        if gideonLauncherHomeOnly && !onHome {
            EmptyView()
        } else {
            launcher
        }
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
        // Handed over explicitly: on Mac Catalyst the sheet did not inherit them and opening the
        // panel trapped on "No Observable object of type AuthStore found".
        .sheet(isPresented: $open) { GideonPanel().environment(auth).environment(router) }
    }
}

struct GideonPanel: View {
    /// Opened from a project or a task ("Ask GIDEON"): a new chat about it (web, 12 Oct 2026).
    var openContext: GideonContext? = nil
    /// GIDEON's own page in the iPad / Mac sidebar: no Close button (it is not a sheet).
    var embedded = false
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
    @AppStorage("gideon.tier") private var tierRaw = GideonTier.fallback.rawValue
    /// A source or card tapped in an answer: opened inside this sheet's own stack.
    @State private var openRef: GideonRef?
    @State private var showChats = false
    /// Apply / Discard asks first, in a centred alert (house rule).
    @State private var decision: GideonDecision?
    @State private var showPersonalize = false
    @State private var saveRequest: GideonSaveRequest?
    @State private var savedDocId: String?
    /// The name the person gave GIDEON (Personalize); empty = "GIDEON".
    @State private var assistantName = ""

    private var tier: GideonTier { GideonTier(rawValue: tierRaw) ?? .fallback }
    private var displayName: String {
        let n = assistantName.trimmingCharacters(in: .whitespaces)
        return n.isEmpty ? "GIDEON" : n
    }

    @ViewBuilder private func refDestination(_ ref: GideonRef) -> some View {
        switch ref.kind {
        case "project": ProjectDetailView(projectId: ref.id, projectName: ref.title ?? "")
        case "doc": DocReaderView(docId: ref.id, title: ref.title ?? "")
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

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    transcript
                    contextStrip
                    mentionPicker
                    attachmentStrip
                    composer
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if !embedded { Button(T("Close")) { dismiss() } }
                }
                ToolbarItem(placement: .principal) { title }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button { chat.startChat(context: chat.context) } label: { Label(T("New chat"), systemImage: "square.and.pencil") }
                            .disabled(chat.sending)
                        Button { showChats = true } label: { Label(T("Chats"), systemImage: "clock.arrow.circlepath") }
                        Button { showPersonalize = true } label: { Label(T("Personalize"), systemImage: "person.crop.circle.badge.checkmark") }
                        Divider()
                        Button(T("Clear chat"), role: .destructive) {
                            Task { await chat.clear() }
                        }
                        .disabled(chat.sending || chat.turns.isEmpty)
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .accessibilityLabel(T("Chat options"))
                }
            }
            .navigationDestination(item: $openRef) { ref in refDestination(ref) }
            .sheet(isPresented: $showPersonalize) {
                GideonPersonalizeSheet { p in assistantName = p.assistantName ?? "" }
            }
            .sheet(item: $saveRequest) { r in
                GideonSaveDocSheet(title: r.title, markdown: r.markdown, contextProjectId: chat.context.projectId,
                                   contextProjectName: chat.context.projectName) { id in savedDocId = id }
            }
            .alert(T("Saved as a doc"), isPresented: Binding(get: { savedDocId != nil }, set: { if !$0 { savedDocId = nil } })) {
                Button(T("Open page")) { if let id = savedDocId { openRef = GideonRef(kind: "doc", id: id, title: nil, projectId: nil) } }
                Button("OK", role: .cancel) {}
            }
            .sheet(isPresented: $showChats) {
                GideonChatsSheet { id in Task { await chat.openChat(id) } }
            }
            .alert(decision?.title ?? "", isPresented: Binding(get: { decision != nil }, set: { if !$0 { decision = nil } }), presenting: decision) { d in
                Button(d.apply ? T("Apply") : T("Discard"), role: d.apply ? nil : .destructive) {
                    Task { await chat.decide(d.proposal, apply: d.apply) }
                }
                Button(T("Cancel"), role: .cancel) {}
            } message: { d in Text(d.proposal.summary ?? "") }
        }
        .task { if let p = try? await GideonClient.prefs() { assistantName = p.assistantName ?? "" } }
        .onAppear {
            // "Ask GIDEON" from a project/task: a new chat about it, unless that is already the one open.
            if let openContext, openContext != chat.context {
                chat.startChat(context: openContext)
            }
        }
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

    // MARK: - title

    /// Every tier name is laid out; only the chosen one is drawn.
    ///
    /// The navigation bar sizes its centre view and animates between widths when that view changes,
    /// and a centre view that is briefly narrower than its own text is CLIPPED rather than
    /// truncated — clipped symmetrically, so it eats the first characters: switching to Experimental
    /// showed "EON Experimental" for a moment. Reserving the widest name up front means the width
    /// never changes, so there is nothing left to animate. `minimumScaleFactor` is the backstop for
    /// the bar genuinely running out of room next to Close and the ⋯ menu, and it shrinks the whole
    /// name rather than dropping either end of it.
    private var title: some View {
        Menu {
            Picker(T("Model"), selection: $tierRaw) {
                ForEach(GideonTier.allCases) { option in
                    Text(option.label).tag(option.rawValue)
                }
            }
        } label: {
            HStack(spacing: 4) {
                ZStack {
                    ForEach(GideonTier.allCases) { option in
                        Text("\(displayName) \(option.label)")
                            .font(NXFont.display(15, .bold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.75)
                            .opacity(option == tier ? 1 : 0)
                            .accessibilityHidden(option != tier)
                    }
                }
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .bold))
            }
            .foregroundStyle(NX.foreground)
        }
        .disabled(chat.sending)
    }

    // MARK: - transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if chat.turns.isEmpty && !chat.sending {
                        empty
                    }
                    ForEach(chat.turns) { turn in
                        bubble(turn).id(turn.id).transition(appear)
                    }
                    if let error = chat.error {
                        Text(error)
                            .font(NXFont.text(12))
                            .foregroundStyle(NX.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("error")
                    }
                    // A fixed anchor rather than the last turn's id: the newest thing on screen is
                    // sometimes the error line or an answer that has not been given an id yet.
                    Color.clear.frame(height: 1).id("bottom")
                }
                .padding(16)
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
                // Every open, not only the first. The thread lives on the server, so this picks up
                // whatever was said on the web — and it is what swaps a just-sent attachment's
                // bytes for the url the server kept, once there is one. `refresh` leaves the
                // transcript alone while a question is in flight and when the fetch fails, which is
                // what makes running it on every open safe rather than destructive.
                await chat.refresh()
                // The stack is lazy, so the last row does not exist on the pass that sets `turns`;
                // one hop later it does. Unanimated on purpose — opening the panel should START at
                // the newest message, not scroll there through history nobody asked to re-read.
                await Task.yield()
                proxy.scrollTo("bottom", anchor: .bottom)
            }
        }
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

    private var empty: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image("GideonLogo")
                .renderingMode(.template)
                .resizable()
                .scaledToFit()
                .frame(width: 28, height: 28)
                .foregroundStyle(NX.foreground)
            Text(T("Ask GIDEON about NEXUS"))
                .font(NXFont.display(16, .bold))
                .foregroundStyle(NX.foreground)
            Text(T("Projects, tasks, who is busy, what is overdue."))
                .font(NXFont.text(13))
                .foregroundStyle(NX.mutedFg)
            Text(tier.blurb)
                .font(NXFont.text(11))
                .foregroundStyle(NX.mutedFg.opacity(0.8))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 40)
    }

    private func bubble(_ turn: GideonTurn) -> some View {
        HStack {
            if turn.role == .user { Spacer(minLength: 44) }
            VStack(alignment: .leading, spacing: 6) {
                // Above the text, the way a chat puts a picture above its caption: the question
                // reads as being about the thing directly over it. Indices rather than the values,
                // because two attachments can be identical in every field a struct has.
                ForEach(turn.attachments.indices, id: \.self) { index in
                    attachmentChip(turn.attachments[index], key: "\(turn.id)-\(index)")
                }
                if turn.role == .assistant && turn.content.isEmpty {
                    // The answer arrives whole — there is no token stream behind this — so the dots
                    // claim only that the request is still open, and they are replaced the instant
                    // the real text lands. A typewriter here would be inventing progress.
                    GideonTypingDots()
                        .accessibilityLabel(T("GIDEON is typing…"))
                        .transition(.opacity)
                } else {
                    Text(turn.content)
                        .font(NXFont.text(14))
                        .foregroundStyle(turn.role == .user ? .white : NX.foreground)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                        .transition(.opacity)
                }
                if !turn.tools.isEmpty {
                    Text(turn.tools.joined(separator: " · "))
                        .font(NXFont.text(10))
                        .foregroundStyle(turn.role == .user ? .white.opacity(0.7) : NX.mutedFg)
                }
                if turn.role == .assistant { answerExtras(turn) }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                turn.role == .user ? AnyShapeStyle(NX.violet) : AnyShapeStyle(NX.card),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(turn.role == .user ? .clear : NX.border)
            )
            if turn.role == .assistant { Spacer(minLength: 44) }
        }
    }

    // MARK: - steps, sources, cards, proposals

    /// Under an answer: one quiet line of what GIDEON did, the sources it cites (tap to open), what it
    /// made, and the changes waiting for Apply.
    /// The question an answer replies to (its first line), for the page title.
    private func question(before turn: GideonTurn) -> String {
        guard let i = chat.turns.firstIndex(where: { $0.id == turn.id }) else { return "" }
        let prev = chat.turns[..<i].last { $0.role == .user }?.content ?? ""
        return String((prev.components(separatedBy: "\n").first ?? "").prefix(120))
    }

    /// Under an answer, each piece its own small function (type-checks fast): Save as doc, what GIDEON
    /// did, the sources, what it made, and changes waiting for Apply.
    @ViewBuilder private func answerExtras(_ turn: GideonTurn) -> some View {
        if !turn.content.isEmpty && !chat.sending { saveAsDocButton(turn) }
        stepsLine(turn)
        if !turn.sources.isEmpty { sourcesBlock(turn.sources) }
        ForEach(turn.cards) { card in cardRow(card) }
        ForEach(turn.proposals) { p in proposalCard(p) }
    }

    private func saveAsDocButton(_ turn: GideonTurn) -> some View {
        Button {
            let q = question(before: turn)
            saveRequest = GideonSaveRequest(title: q.isEmpty ? T("GIDEON answer") : q, markdown: turn.content)
        } label: {
            Label(T("Save as doc"), systemImage: "doc.badge.plus").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                .frame(minHeight: 28).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder private func stepsLine(_ turn: GideonTurn) -> some View {
        let shownSteps: [GideonStep] = turn.steps.filter { $0.status != "error" }
        if let last = shownSteps.last, let label = last.label, !label.isEmpty {
            HStack(spacing: 5) {
                if last.status == "running" && turn.content.isEmpty {
                    ProgressView().scaleEffect(0.55)
                } else {
                    Image(systemName: "checkmark.circle").font(.system(size: 10))
                }
                Text(shownSteps.count > 1 ? "\(label) · \(shownSteps.count)" : label).lineLimit(1)
            }
            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
    }

    private func sourcesBlock(_ sources: [GideonRef]) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(T("Sources")).font(NXFont.text(10, .semibold)).foregroundStyle(NX.mutedFg)
            FlowLayout(spacing: 5) {
                ForEach(sources) { ref in refChip(ref) }
            }
        }
    }

    private func cardRow(_ card: GideonCard) -> some View {
        let kind: String = card.kind == "doc" ? "doc" : "task"
        let sub: String = [cardActionLabel(card.action), card.projectName].compactMap { $0 }.joined(separator: " · ")
        return Button { openRef = GideonRef(kind: kind, id: card.id, title: card.title, projectId: nil) } label: {
            HStack(spacing: 6) {
                Image(systemName: card.action == "created" ? "plus.circle.fill" : "pencil.circle.fill").foregroundStyle(NX.success)
                VStack(alignment: .leading, spacing: 1) {
                    Text(card.title ?? T("Task")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(sub).font(NXFont.text(10)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(8).background(NX.success.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
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
                Image(systemName: ref.kind == "project" ? "folder" : (ref.kind == "task" ? "checklist" : "doc.text")).font(.system(size: 9, weight: .semibold))
                Text(ref.title ?? "").lineLimit(1)
            }
            .font(NXFont.text(11, .semibold)).foregroundStyle(NX.violetText)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(NX.violet.opacity(0.10), in: Capsule())
        }
        .buttonStyle(.plain)
        // Only what the app can open; comments, forms and messages are named but not linked here.
        .disabled(!(ref.kind == "task" || ref.kind == "project" || ref.kind == "doc"))
    }

    private func proposalCard(_ p: GideonProposal) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "hand.raised.fill").font(.system(size: 11)).foregroundStyle(NX.warning)
                Text(p.summary ?? T("GIDEON wants to make a change")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array((p.diff ?? []).enumerated()), id: \.offset) { _, row in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(row.field ?? "").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                    if let from = row.from?.text, !from.isEmpty { Text(ServerText.enumWord(from)).strikethrough().font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                    Image(systemName: "arrow.right").font(.system(size: 8)).foregroundStyle(NX.mutedFg)
                    Text(ServerText.enumWord(row.to?.text ?? "—")).font(NXFont.text(11, .semibold)).foregroundStyle(NX.foreground)
                }
            }
            if p.isPending {
                HStack(spacing: 8) {
                    Button { decision = GideonDecision(proposal: p, apply: true) } label: {
                        Text(T("Apply")).font(NXFont.text(13, .bold)).foregroundStyle(.white)
                            .padding(.horizontal, 14).frame(minHeight: 36)
                            .background(NX.violetFill, in: Capsule())
                    }
                    .buttonStyle(.plain)
                    Button { decision = GideonDecision(proposal: p, apply: false) } label: {
                        Text(T("Discard")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                            .padding(.horizontal, 12).frame(minHeight: 36)
                    }
                    .buttonStyle(.plain)
                }
            } else {
                Text(proposalStatus(p)).font(NXFont.text(11, .semibold))
                    .foregroundStyle(p.status == "APPLIED" ? NX.success : (p.status == "FAILED" ? NX.danger : NX.mutedFg))
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.warning.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
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

    /// The project / task this chat is about, removable (then GIDEON looks across everything you can see).
    @ViewBuilder private var contextStrip: some View {
        let ctx = chat.context
        if !ctx.refs.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(ctx.refs, id: \.self) { r in
                        HStack(spacing: 4) {
                            Image(systemName: r.kind == "project" ? "folder" : (r.kind == "task" ? "checklist" : "doc.text")).font(.system(size: 10, weight: .semibold))
                            Text(r.title ?? "").lineLimit(1)
                            Button { chat.context.refs.removeAll { $0 == r } } label: {
                                Image(systemName: "xmark").font(.system(size: 8, weight: .bold)).frame(width: 24, height: 24).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(T("Remove context"))
                        }
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.violetText)
                        .padding(.leading, 8)
                        .background(NX.violet.opacity(0.10), in: Capsule())
                    }
                }
                .padding(.horizontal, 16).padding(.top, 4)
            }
        }
        if ctx.projectId != nil || ctx.taskId != nil {
            HStack(spacing: 6) {
                Image(systemName: ctx.taskId != nil ? "checklist" : "folder").font(.system(size: 11, weight: .semibold))
                Text(ctx.taskTitle ?? ctx.projectName ?? T("This project")).lineLimit(1)
                Button { chat.context = GideonContext(refs: chat.context.refs) } label: {
                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                        .frame(width: 28, height: 28).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Remove context"))
                Spacer(minLength: 0)
            }
            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
            .padding(.horizontal, 16).padding(.top, 4)
        }
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
            .padding(.horizontal, 16)
            .padding(.bottom, 6)
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
        // In a bubble the chip sits on violet, where the muted grey it wears under the composer is
        // nearly gone. The same white the tools line already uses for a user turn.
        let tone: Color = onBubble ? .white.opacity(0.85) : NX.mutedFg
        let plate: Color = onBubble ? .white.opacity(0.18) : NX.muted.opacity(0.6)
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
            Text(label).font(NXFont.text(12)).foregroundStyle(tone).lineLimit(1)
            if let remove {
                Spacer(minLength: 8)
                Button(action: remove) {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(tone)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var composer: some View {
        // The draft lives on the store, so the field needs a binding INTO it. Declared here for the
        // same reason RootView declares one for the router: `@Bindable` is a local wrapper, and this
        // is the only member that writes through it.
        @Bindable var chat = chat
        return HStack(spacing: 10) {
            // One menu rather than three icons: a third button left the field too narrow to read
            // back what you typed. A PhotosPicker nested in a Menu draws its row but never opens, so
            // the menu only flips flags and the pickers themselves hang off the panel.
            Menu {
                Button { showPhotoPicker = true } label: { Label(T("Photo"), systemImage: "photo") }
                Button { showCamera = true } label: { Label(T("Camera"), systemImage: "camera") }
                Button { showFilePicker = true } label: { Label(T("File"), systemImage: "doc") }
            } label: {
                Image(systemName: "plus.circle").font(.system(size: 20)).foregroundStyle(NX.mutedFg)
            }
            TextField(T("Ask anything about NEXUS…"), text: $chat.draft, axis: .vertical)
                .font(NXFont.text(14))
                .lineLimit(1...5)
                .focused($composerFocused)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))

            Button {
                submit()
            } label: {
                Image(systemName: "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(canSend ? NX.violet : NX.muted, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(NX.background)
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
        guard let turn = chat.submit(tier: tier) else { return }
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
    static func spill(_ data: Data, key: String, named: String) async -> URL? {
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
    var id: String { proposal.id + (apply ? "-apply" : "-discard") }
    var title: String { apply ? T("Apply this change?") : T("Discard this change?") }
}

/// The person's GIDEON conversations, searchable; open one or delete it (asks first).
struct GideonChatsSheet: View {
    let onOpen: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var chats: [GideonChatSummary] = []
    @State private var query = ""
    @State private var loading = true
    @State private var toDelete: GideonChatSummary?

    var body: some View {
        NavigationStack {
            Group {
                if loading && chats.isEmpty {
                    ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if chats.isEmpty {
                    EmptyState(icon: "bubble.left.and.text.bubble.right", title: query.isEmpty ? T("No chats yet") : T("No chats match"),
                               subtitle: query.isEmpty ? T("Every conversation with GIDEON is kept here, on the web and in the app.") : T("Try other words."))
                } else {
                    List {
                        ForEach(chats) { c in
                            Button { onOpen(c.id); dismiss() } label: {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(c.title ?? T("Untitled chat")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(2)
                                    if let d = ProjDate.parse(c.updatedAt) {
                                        Text(ProjDate.dayLabel(d)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
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
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
            .task(id: query) {
                try? await Task.sleep(for: .milliseconds(250))
                await load()
            }
            .alert(T("Delete this chat?"), isPresented: Binding(get: { toDelete != nil }, set: { if !$0 { toDelete = nil } }), presenting: toDelete) { c in
                Button(T("Delete"), role: .destructive) {
                    Task { try? await GideonClient.deleteChat(c.id); await load() }
                }
                Button(T("Cancel"), role: .cancel) {}
            } message: { _ in Text(T("Its messages are deleted for you on every device.")) }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        if let list = try? await GideonClient.chats(query: query) { chats = list }
    }
}

/// "Ask GIDEON" about the project or task on screen (web header button): opens the panel on a new chat
/// with that context. The panel reads only what this account can open.
struct AskGideonButton: View {
    let context: GideonContext
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @State private var open = false

    var body: some View {
        Button { open = true } label: {
            Image("GideonLogo").renderingMode(.template).resizable().scaledToFit()
                .frame(width: 17, height: 17)
                .foregroundStyle(NX.violetText)
                .frame(width: 36, height: 36).background(NX.card, in: Circle()).overlay(Circle().strokeBorder(NX.border))
                .frame(width: 44, height: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
        .accessibilityLabel(T("Ask GIDEON"))
        .sheet(isPresented: $open) { GideonPanel(openContext: context).environment(auth).environment(router) }
    }
}
