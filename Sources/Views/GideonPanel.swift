import SwiftUI
import PhotosUI
import UniformTypeIdentifiers
import UIKit

/// The one place that decides WHERE the launcher may be drawn. `true` = Home only, `false` = the
/// every-screen behaviour it shipped with.
///
/// The owner asked for Home only: hung above the whole app, the circle covered whatever scrolled
/// underneath it — a row's text on Attendance, a card's title on My Submissions. Home is the one
/// screen laid out around it. Nothing else in the app reads the current screen for this, so putting
/// the button back everywhere is this constant and nothing more.
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
        let onHome = hSize == .regular ? router.sidebarScreen == .dashboard : router.tab == .dashboard
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
        .padding(.leading, 20)
        // Clears the tab bar on a phone. On the iPad sidebar layout there is no bar, so this is
        // simply a comfortable margin.
        .padding(.bottom, 76)
        .sheet(isPresented: $open) { GideonPanel() }
    }
}

struct GideonPanel: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var turns: [GideonTurn] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var loaded = false
    /// JPEG bytes, held only until the next message is sent.
    @State private var attachment: Data?
    /// A picked document, held only until the next message is sent.
    @State private var document: GideonDocument?
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var showPhotoPicker = false
    @State private var showCamera = false
    @State private var showFilePicker = false
    /// A kept attachment being looked at, and one being handed to the share sheet. Both driven by
    /// tapping a chip in the transcript — see `open`.
    @State private var preview: AttachmentPreview?
    @State private var shareItem: ShareItem?
    /// Questions the composer has accepted but the network has not taken yet. See `submit()`.
    @State private var outbox: [Outgoing] = []
    @FocusState private var composerFocused: Bool
    /// Remembered on the device: somebody who picks Terra for quick questions should not have to
    /// pick it again every time the panel opens.
    @AppStorage("gideon.tier") private var tierRaw = GideonTier.fallback.rawValue

    private var tier: GideonTier { GideonTier(rawValue: tierRaw) ?? .fallback }

    /// One accepted-but-not-yet-sent question, paired with the transcript turn already drawn for it.
    /// The tier is captured here rather than read at dispatch: a queued question is answered by the
    /// model that was selected when it was written, not by whatever the picker says a minute later.
    private struct Outgoing {
        let turnId: String
        let text: String
        let model: String
        let image: Data?
        let document: GideonDocument?
    }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    transcript
                    attachmentStrip
                    composer
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Close")) { dismiss() }
                }
                ToolbarItem(placement: .principal) { title }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button(T("Clear chat"), role: .destructive) {
                            Task { await clear() }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .disabled(sending || turns.isEmpty)
                }
            }
        }
        .photosPicker(isPresented: $showPhotoPicker, selection: $pickedPhoto,
                      matching: .images, photoLibrary: .shared())
        .fullScreenCover(isPresented: $showCamera) {
            // Rear lens: this one is pointed at whiteboards and documents, not at faces.
            CameraPicker(cameraDevice: .rear) { data in
                attachment = Self.shrink(data)
                showCamera = false
            }
            .ignoresSafeArea()
        }
        // `.item` rather than the accepted UTTypes: several of them (md, yml, log, ipynb) resolve to
        // dynamic UTIs that a document provider need not advertise, so filtering would hide the very
        // file the owner is looking at. `attach` refuses the wrong ones with the reason instead.
        .fileImporter(isPresented: $showFilePicker, allowedContentTypes: [.item],
                      allowsMultipleSelection: false) { result in
            if case let .success(urls) = result, let url = urls.first { attach(url) }
        }
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self) {
                    attachment = Self.shrink(data)
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
                        Text("GIDEON \(option.label)")
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
        .disabled(sending)
    }

    // MARK: - transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if turns.isEmpty && !sending {
                        empty
                    }
                    ForEach(turns) { turn in
                        bubble(turn).id(turn.id).transition(appear)
                    }
                    if let error {
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
            .onChange(of: turns.count) { _, _ in toBottom(proxy) }
            .onChange(of: turns.last?.content) { _, _ in toBottom(proxy) }
            .onChange(of: error) { _, _ in toBottom(proxy) }
            .onChange(of: composerFocused) { _, focused in
                guard focused else { return }
                toBottom(proxy)
                // The scroll view's keyboard inset lands with the keyboard, a beat after the focus
                // changes, so the scroll above is aimed at the old content height; this one is not.
                Task { try? await Task.sleep(for: .milliseconds(350)); toBottom(proxy) }
            }
            .task {
                guard !loaded else { return }
                loaded = true
                // The thread lives on the server, so this picks up whatever was said on the web.
                turns = (try? await GideonClient.history()) ?? []
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
                    attachmentChip(turn.attachments[index], key: turn.id)
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

    // MARK: - composer

    @ViewBuilder
    private var attachmentStrip: some View {
        if attachment != nil || document != nil {
            VStack(spacing: 6) {
                if let attachment, let image = UIImage(data: attachment) {
                    attachmentChip(art: .local(image), label: T("Image attached"),
                                   remove: { self.attachment = nil })
                }
                if let document {
                    attachmentChip(art: .glyph("doc.text"), label: document.name,
                                   remove: { self.document = nil })
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
    private func attachmentChip(_ item: GideonAttachment, key: String) -> some View {
        let isImage = item.kind == .image
        let art: GideonChipArt
        if let data = item.preview, let made = GideonThumbnail.image(data, key: key) {
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
        // A chip becomes a button only once there is a file behind it. While the question is still
        // in flight the attachment exists nowhere but in this process, and a tap that opened nothing
        // would be a worse promise than a chip that plainly is not tappable.
        return Group {
            if item.url != nil {
                Button { Task { await open(item) } } label: { chip }
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
        HStack(spacing: 10) {
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
            TextField(T("Ask anything about NEXUS…"), text: $draft, axis: .vertical)
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
    /// what a mid-flight tap does is `submit()`'s problem, not the button's.
    private var canSend: Bool {
        !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - attachments

    private func attach(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let ext = url.pathExtension.lowercased()
        guard GideonDocument.acceptedExtensions.contains(ext) else {
            error = T("GIDEON can't read that kind of file yet.")
            return
        }
        // Asked of the file system rather than of the bytes, and asked first. The picker hands back
        // whatever was tapped, and the old order read the whole thing before measuring it — a 4 GB
        // film locked the main actor for the length of the read purely in order to refuse it.
        let size = APIClient.fileSize(of: url)
        guard size > 0 else {
            error = T("Couldn't read that file.")
            return
        }
        // The server enforces this too, and says so in Indonesian. Checking here saves sending ten
        // megabytes over mobile data to be told they were nine too many.
        guard size <= GideonDocument.maxBytes else {
            error = T("File is over the 10MB limit.")
            return
        }
        guard let data = try? Data(contentsOf: url) else {
            error = T("Couldn't read that file.")
            return
        }
        error = nil
        document = GideonDocument(
            name: url.lastPathComponent,
            type: UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream",
            data: data
        )
    }

    /// Opens a kept attachment.
    ///
    /// The three viewers the app already has, chosen the way every other attachment in NEXUS is: a
    /// picture goes straight at the remote url, because `ImageLoader` fetches it with the session,
    /// downsamples it once and keeps the result; a PDF or a film has to be a file on disk, because
    /// PDFKit and AVPlayer both want somewhere to seek and neither can be handed a cookie. A .docx
    /// or a .xlsx — which GIDEON accepts and no viewer here draws — goes to the share sheet, which
    /// is the difference between an attachment and a download.
    private func open(_ item: GideonAttachment) async {
        guard let raw = item.url, !raw.isEmpty else { return }
        // A photo has no filename of its own, so the stored file's name stands in — it is the one
        // thing that still carries the extension `AttachmentKind` reads first.
        let stored = raw.split(separator: "/").last.map(String.init) ?? ""
        let label = item.name.isEmpty ? T("Image attached") : item.name
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
            self.error = T("Couldn't open this file.")
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

    /// Takes a question off the composer and puts it in the outbox.
    ///
    /// The composer stays live while an answer is in flight, so a second question can arrive before
    /// the first is answered. It is QUEUED rather than sent alongside: the conversation is stored
    /// server-side as one thread, so two requests in flight would both append to it and the second
    /// answer would be written against a transcript missing the first. Either way the user's bubble
    /// is drawn at the moment of the tap — text that leaves the composer and appears nowhere is the
    /// one outcome worth ruling out.
    private func submit() {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        draft = ""
        error = nil

        // The attachment is recorded ON the turn as well as posted with it. A question about a file
        // that draws as bare text leaves nothing in the thread saying which file was meant, so the
        // answer under it reads as if it came from nowhere. Image first, then document: the order
        // the composer strip lists them in, so nothing appears to move when the message is sent.
        var carried: [GideonAttachment] = []
        if let attachment {
            carried.append(GideonAttachment(kind: .image, name: "", preview: attachment))
        }
        if let document {
            carried.append(GideonAttachment(kind: .document, name: document.name, preview: nil))
        }

        let turn = GideonTurn(role: .user, content: text, attachments: carried)
        // Decoded here, in a tap that is already paying for a layout pass, so the bubble's first
        // draw and every redraw an arriving answer forces are cache reads and nothing more.
        if let attachment { _ = GideonThumbnail.image(attachment, key: turn.id) }
        withAnimation(reduceMotion ? nil : Animation.easeOut(duration: 0.22)) { turns.append(turn) }
        outbox.append(Outgoing(turnId: turn.id, text: text, model: tier.rawValue,
                               image: attachment, document: document))
        // Cleared with the draft, not after the request: an attachment silently riding along on the
        // NEXT question would be baffling, and re-attaching is one tap.
        attachment = nil
        document = nil

        // A drain already running will reach this on its next lap. The flag is raised HERE and not
        // inside `drain`, because a Task's first line runs on a later turn of the main actor and two
        // taps inside that gap would each start a drain competing for the same outbox.
        guard !sending else { return }
        sending = true
        Task { await drain() }
    }

    private func drain() async {
        defer { sending = false }
        while !outbox.isEmpty {
            await send(outbox.removeFirst())
        }
    }

    private func send(_ item: Outgoing) async {
        // History is cut at this question. Anything queued behind it is already in `turns`, and
        // sending that as context would have the server answer the wrong message.
        let messages = history(upTo: item)
        // The empty assistant turn goes in directly after its question rather than at the end of the
        // list, which with a queue is somebody else's place. It is what the dots are drawn in and
        // where the answer lands.
        let answer = GideonTurn(role: .assistant, content: "")
        let at = turns.firstIndex(where: { $0.id == item.turnId }).map { $0 + 1 } ?? turns.count
        withAnimation(reduceMotion ? nil : Animation.easeOut(duration: 0.22)) { turns.insert(answer, at: at) }

        do {
            for try await chunk in GideonClient.stream(messages: messages, model: item.model,
                                                       image: item.image, document: item.document) {
                guard let index = turns.firstIndex(where: { $0.id == answer.id }) else { continue }
                // Only the first chunk is animated, and only to cross-fade the dots out. Animating
                // every chunk would put an animation on the path a token-by-token backend takes.
                if turns[index].content.isEmpty {
                    withAnimation(.easeOut(duration: 0.18)) { turns[index].content += chunk }
                } else {
                    turns[index].content += chunk
                }
            }
            // A stream that ends without a word is a failure the user can see but not explain.
            if let index = turns.firstIndex(where: { $0.id == answer.id }), turns[index].content.isEmpty {
                turns.remove(at: index)
                error = T("GIDEON didn't answer. Try again.")
            }
        } catch APIError.unauthorized {
            // Drop the queue as well: the session is gone, so replaying it would only produce the
            // same 401 once per queued message.
            turns.removeAll { $0.id == answer.id }
            outbox.removeAll()
            auth.logout()
        } catch {
            turns.removeAll { $0.id == answer.id }
            // The server writes its own sentence for a refused attachment — which file, and what to
            // do about it. Replacing that with "GIDEON failed." would throw the useful half away.
            self.error = (error as? LocalizedError)?.errorDescription ?? T("GIDEON failed.")
        }
    }

    /// Everything up to and including this question, minus assistant turns still waiting to be
    /// filled in. Cutting there is what keeps a queued question out of the context of the one in
    /// front of it — the server answers the LAST message it is given.
    private func history(upTo item: Outgoing) -> [GideonTurn] {
        guard let end = turns.firstIndex(where: { $0.id == item.turnId }) else {
            // The transcript was replaced under us. Ask the question on its own rather than posting
            // an empty `messages`, which the route reads the last element of.
            return [GideonTurn(id: item.turnId, role: .user, content: item.text)]
        }
        return turns[...end].filter { !($0.role == .assistant && $0.content.isEmpty) }
    }

    private func clear() async {
        do {
            try await GideonClient.clearHistory()
            turns = []
            error = nil
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Failed.")
        }
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
}
