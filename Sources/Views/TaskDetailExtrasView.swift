import SwiftUI
import UniformTypeIdentifiers

private func taskCardHeader(_ title: String, _ icon: String) -> some View {
    HStack(spacing: 8) {
        Image(systemName: icon).foregroundStyle(NX.mutedFg)
        Text(title).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground)
    }
}

// MARK: - Custom fields (view + edit on an existing task)

struct TaskCustomFieldsCard: View {
    let projectId: String
    let taskId: String
    /// The task's creator was offboarded: the CREATED field marks them "Left".
    var creatorLeft = false
    @State private var fields: [CustomField] = []
    @State private var values: [String: CFVal] = [:]
    @State private var loaded = false

    var body: some View {
        cardBody.task { await load() }
    }

    @ViewBuilder private var cardBody: some View {
        if fields.isEmpty {
            Color.clear.frame(height: 0)   // real (zero-size) view so .task fires even with no fields yet
        } else {
            VStack(alignment: .leading, spacing: 14) {
                taskCardHeader("Custom fields", "slider.horizontal.3")
                ForEach(fields) { f in cfRow(f) }
            }
            .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        }
    }

    @ViewBuilder private func cfRow(_ f: CustomField) -> some View {
        let type = f.type.uppercased()
        let choices = f.choices
        VStack(alignment: .leading, spacing: 6) {
            Text(f.name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            if type == "CREATED" {
                // Who made the task, as on the web, tagged "Left" once they were offboarded.
                if let who = f.createdMeta?.userName, !who.isEmpty {
                    HStack(spacing: 6) {
                        Text(who).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        if creatorLeft { LeftTag() }
                    }
                }
                Text(cfText(f.id).isEmpty ? "—" : cfText(f.id)).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            } else if type == "NUMBER" {
                TextField("0", text: binding(f.id)).keyboardType(.decimalPad).font(NXFont.text(15)).padding(10)
                    .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .onSubmit { Task { await commit(f) } }
            } else if type == "DATE" {
                DatePicker("", selection: dateBinding(f), displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violetText)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else if (type == "SELECT" || type == "STATUS"), !choices.isEmpty {
                Menu {
                    Button("—") { values[f.id] = .text(""); Task { await commit(f) } }
                    ForEach(choices, id: \.self) { c in Button(c) { values[f.id] = .text(c); Task { await commit(f) } } }
                } label: {
                    HStack {
                        Text(cfText(f.id).isEmpty ? "—" : cfText(f.id)).font(NXFont.text(15)).foregroundStyle(cfText(f.id).isEmpty ? NX.mutedFg : NX.foreground)
                        Spacer(); Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
                    }
                    .padding(10).background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            } else if type == "MULTI_SELECT", !choices.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(choices, id: \.self) { c in
                            let on = multiHas(f.id, c)
                            Button { toggleMulti(f.id, c); Task { await commit(f) } } label: {
                                Text(c).font(NXFont.text(12, .semibold)).padding(.horizontal, 12).padding(.vertical, 7)
                                    .foregroundStyle(on ? NX.violetText : NX.mutedFg)
                                    .background(on ? NX.violet.opacity(0.12) : NX.muted.opacity(0.5), in: Capsule())
                                    .overlay(Capsule().strokeBorder(on ? NX.violet : .clear))
                            }.buttonStyle(.plain)
                        }
                    }
                }
            } else if type == "PLACE" {
                VStack(spacing: 6) {
                    TextField(T("Place / location name"), text: placeLabel(f)).font(NXFont.text(15)).padding(10)
                        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous)).onSubmit { Task { await commit(f) } }
                    TextField("Link Google Maps", text: placeMap(f)).font(NXFont.text(15)).keyboardType(.URL).autocorrectionDisabled().padding(10)
                        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous)).onSubmit { Task { await commit(f) } }
                }
            } else {
                TextField("…", text: binding(f.id)).font(NXFont.text(15)).padding(10)
                    .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .onSubmit { Task { await commit(f) } }
            }
        }
    }

    private func load() async {
        guard !loaded else { return }
        fields = (try? await APIClient.shared.taskCustomFields(projectId: projectId, taskId: taskId)) ?? []
        var seed: [String: CFVal] = [:]
        for f in fields {
            switch f.value {
            case .text(let s): seed[f.id] = .text(s)
            case .list(let a): seed[f.id] = .multi(a)
            case .place(let l, let m): seed[f.id] = .place(label: l, mapUrl: m ?? "")
            case .none: break
            }
        }
        values = seed; loaded = true
    }
    private func commit(_ f: CustomField) async {
        guard let v = values[f.id] else { return }
        switch v {
        case .text(let s): try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: s)
        case .multi(let a): try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: a)
        case .place(let l, let m): try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: ["label": l, "mapUrl": m])
        }
    }
    private func placeVal(_ id: String) -> (String, String) { if case let .place(l, m) = values[id] { return (l, m) }; return ("", "") }
    private func placeLabel(_ f: CustomField) -> Binding<String> { Binding(get: { placeVal(f.id).0 }, set: { values[f.id] = .place(label: $0, mapUrl: placeVal(f.id).1) }) }
    private func placeMap(_ f: CustomField) -> Binding<String> { Binding(get: { placeVal(f.id).1 }, set: { values[f.id] = .place(label: placeVal(f.id).0, mapUrl: $0) }) }
    private func cfText(_ id: String) -> String { if case let .text(s) = values[id] { return s }; return "" }
    private func binding(_ id: String) -> Binding<String> { Binding(get: { cfText(id) }, set: { values[id] = .text($0) }) }
    private func dateBinding(_ f: CustomField) -> Binding<Date> {
        Binding(get: { Self.ymdParse(cfText(f.id)) ?? Date() }, set: { values[f.id] = .text(Self.ymd($0)); Task { await commit(f) } })
    }
    private func multiHas(_ id: String, _ c: String) -> Bool { if case let .multi(a) = values[id] { return a.contains(c) }; return false }
    private func toggleMulti(_ id: String, _ c: String) {
        var arr: [String] = { if case let .multi(a) = values[id] { return a }; return [] }()
        if let i = arr.firstIndex(of: c) { arr.remove(at: i) } else { arr.append(c) }
        values[id] = .multi(arr)
    }
    private static func ymd(_ d: Date) -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone; return f.string(from: d) }
    private static func ymdParse(_ s: String) -> Date? { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone; return f.date(from: s) }
}

// MARK: - Attachments (list · open · upload · download · delete)

struct TaskAttachmentsCard: View {
    let taskId: String
    @State private var items: [TaskAttachment] = []
    @State private var loading = true
    @State private var busy = false
    @State private var showImporter = false
    /// The row whose bytes are being fetched, and the row currently swiped open. At most one of
    /// each, which is what makes them ids rather than sets.
    @State private var fetching: String?
    @State private var swiped: String?
    @State private var shareItem: ShareItem?
    @State private var preview: AttachmentPreview?
    @State private var deleteTarget: TaskAttachment?
    /// What went wrong, shown rather than swallowed. Every call here used to be `try?`, so a 140 MB
    /// upload that Cloudflare refused at the edge — see APIClient.uploadAttachment — looked exactly
    /// like one that worked, right up to the list refreshing without it.
    @State private var problem: String?
    /// Handed to the client for the length of one transfer. The bar is a separate view because it is
    /// the only thing that may read the fraction: read here, every byte would rebuild this card and
    /// the list of files in it. Two of them, so a download started while an upload is still going
    /// cannot overwrite its numbers. See UploadProgress.swift.
    @State private var uploadProgress = UploadProgress()
    @State private var fetchProgress = UploadProgress()

    /// How far a row slides to uncover the delete action behind it.
    private static let swipeReveal: CGFloat = 76
    private static let slide = Animation.spring(response: 0.28, dampingFraction: 0.86)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                taskCardHeader(items.isEmpty ? "Attachments" : "Attachments · \(items.count)", "paperclip")
                Spacer()
                if busy { ProgressView().scaleEffect(0.8) }
                Button { showImporter = true } label: { Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(NX.violetText) }.disabled(busy)
            }
            if uploadProgress.isActive { meter(T("Uploading"), uploadProgress) }
            if fetchProgress.isActive { meter(T("Downloading"), fetchProgress) }
            if let problem { complaint(problem) }
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if items.isEmpty {
                Text(T("No files yet. Tap + to upload.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(items) { a in row(a) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        .task { await load() }
        .sheet(isPresented: $showImporter) {
            DocumentPicker(types: [.item], multiple: false) { urls in
                let result: Result<[URL], Error> = .success(urls)
                if case let .success(urls) = result, let url = urls.first { Task { await upload(url) } }
            }
            .ignoresSafeArea()
        }
        .sheet(item: $shareItem) { item in ActivityView(items: [item.url]) }
        .fullScreenCover(item: $preview) { AttachmentViewerView(preview: $0) }
        .alert("\(T("Delete")) \"\(deleteTarget?.name ?? "")\"?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } })) {
            Button(T("Delete"), role: .destructive) { if let a = deleteTarget { deleteTarget = nil; Task { await remove(a) } } }
            Button(T("Cancel"), role: .cancel) { deleteTarget = nil }
        }
    }

    /// The bar says how far. This says which way: `UploadProgressBar` draws the same capsule over a
    /// file going out and one coming in, on purpose, so the word beside it is what distinguishes them.
    private func meter(_ what: String, _ progress: UploadProgress) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(what).font(NXFont.text(10, .semibold)).tracking(0.4).foregroundStyle(NX.mutedFg)
            UploadProgressBar(progress: progress)
        }
    }

    private func complaint(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").font(.system(size: 12)).foregroundStyle(NX.danger)
            Text(text).font(NXFont.text(12)).foregroundStyle(NX.danger).lineLimit(4)
            Spacer(minLength: 0)
            Button { problem = nil } label: {
                Image(systemName: "xmark").font(.system(size: 10, weight: .bold)).foregroundStyle(NX.mutedFg)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Close"))
        }
        .padding(10)
        .background(NX.danger.opacity(0.1), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    /// One file: the row itself, the delete action it slides off, and the swipe that moves it.
    ///
    /// `.offset` is a drawing move and not a layout one, so the delete action added underneath it
    /// afterwards is sized to the row and stays where it is while the row travels over it.
    private func row(_ a: TaskAttachment) -> some View {
        let open = swiped == a.id
        return face(a)
            .offset(x: open ? -Self.swipeReveal : 0)
            .background(alignment: .trailing) {
                Button { withAnimation(Self.slide) { swiped = nil }; deleteTarget = a } label: {
                    Image(systemName: "trash.fill").font(.system(size: 15)).foregroundStyle(Color.white)
                        .frame(width: Self.swipeReveal)
                        .frame(maxHeight: .infinity)
                        .background(NX.danger, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Delete"))
                // Hidden AND untappable when closed: an invisible delete button under a row somebody
                // is only trying to open is the worst button in the app.
                .opacity(open ? 1 : 0)
                .allowsHitTesting(open)
                // Neither of those hides it from VoiceOver, which would otherwise find a Delete
                // button under every closed row — and now a second one, since the row itself
                // carries the same action.
                .accessibilityHidden(!open)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .gesture(swipe(a).exclusively(before: tap(a)))
            .contextMenu {
                Button { Task { await show(a) } } label: { Label(T("Open file"), systemImage: "eye") }
                Button { Task { await save(a) } } label: { Label(T("Save or share"), systemImage: "square.and.arrow.up") }
                Button(role: .destructive) { deleteTarget = a } label: { Label(T("Delete"), systemImage: "trash") }
            }
    }

    /// Not a `Button`, and that is the fix rather than a detail of it. A button takes the touch on
    /// the way down and fires on release wherever the finger ended up inside its own bounds; a
    /// full-width row is wide enough that a sideways swipe never leaves them, so the file opened
    /// instead of the delete action appearing. Arbitration could not save it either: the button's
    /// gesture is a descendant of the view carrying the swipe, and a descendant wins by default, so
    /// the drag was never even consulted.
    ///
    /// The tap is a gesture now, beside the swipe and under one arbiter (see `tap`). What the button
    /// was giving away for free is spelled out here instead: the trait VoiceOver announces, the
    /// action it performs on a double tap, and — because a swipe is not a gesture VoiceOver can
    /// make — the delete and the share that the swipe and the long press already offer.
    private func face(_ a: TaskAttachment) -> some View {
        let kind = AttachmentKind(mime: a.mimeType, name: a.name)
        return HStack(spacing: 12) {
            Image(systemName: kind?.glyph ?? "doc.fill").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                .frame(width: 32, height: 32).background(NX.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(a.name ?? "file").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(sub(a)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer()
            if fetching == a.id { ProgressView().scaleEffect(0.8) }
            else if kind != nil { Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg) }
            else { Image(systemName: "square.and.arrow.down").font(.system(size: 13)).foregroundStyle(NX.mutedFg) }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        // The corners the background rounds away are still part of the row as far as a finger is
        // concerned, and the gestures in `row` hit-test through this.
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityAction { tapped(a) }
        .accessibilityAction(named: Text(T("Save or share"))) { Task { await save(a) } }
        .accessibilityAction(named: Text(T("Delete"))) { deleteTarget = a }
    }

    /// Swipe left to uncover delete, right to put it back.
    ///
    /// Only `onEnded`, deliberately. Tracking the finger would rewrite this card's state on every
    /// frame of the drag and rebuild the whole list of rows with it, on a card that lives inside a
    /// scroll view — the one thing today's performance pass was about. The row snaps instead of
    /// following, which costs two state writes per swipe rather than sixty.
    private func swipe(_ a: TaskAttachment) -> some Gesture {
        DragGesture(minimumDistance: 24)
            .onEnded { value in
                // A drag that is mostly vertical belongs to the scroll view behind this card.
                guard abs(value.translation.width) > abs(value.translation.height) else { return }
                withAnimation(Self.slide) { swiped = value.translation.width < 0 ? a.id : nil }
            }
    }

    /// The tap and the swipe over the same row, arbitrated rather than raced.
    ///
    /// The swipe goes first in the pair, and an `ExclusiveGesture` only lets the second gesture
    /// through once the first has failed — which for a drag with a minimum distance is precisely
    /// what a finger that stayed put is. So a finger that travels uncovers delete and cannot also
    /// open the file, and a finger that does not opens the file and cannot also move the row.
    ///
    /// Both go on with `.gesture` rather than `.highPriorityGesture`, so a vertical pan still
    /// belongs to the ScrollView this card sits inside — the same rule `SwipeToReply` follows in
    /// MessagesView, and for the same reason.
    private func tap(_ a: TaskAttachment) -> some Gesture {
        TapGesture().onEnded { _ in tapped(a) }
    }

    /// A row that is already open is closed by tapping it, which is the gesture everybody tries
    /// first and otherwise leaves a row stuck sideways. VoiceOver never has one open, so from there
    /// this only ever opens the file.
    private func tapped(_ a: TaskAttachment) {
        if swiped != nil { withAnimation(Self.slide) { swiped = nil } } else { Task { await show(a) } }
    }

    private func sub(_ a: TaskAttachment) -> String {
        var p: [String] = []
        if let s = a.size { p.append(nxBytes(s)) }
        if let n = a.uploader?.name { p.append(n) }
        return p.joined(separator: " · ")
    }

    private func load() async {
        if let fresh = try? await APIClient.shared.taskAttachments(taskId) {
            items = fresh
        } else if let hit = ResponseCache.decoded("task-attachments-\(taskId)", as: [TaskAttachment].self) {
            // The files are already on this device — the offline pass walked this very list to
            // fetch them. Dropping the list would hide bytes that are sitting right there, which
            // is the most frustrating possible way to be offline.
            items = hit.value
        } else {
            items = []
        }
        loading = false
    }

    /// Tapping a file opens it here when the app can draw it, and hands it to the share sheet when
    /// it cannot — which is the difference between an attachment and a download.
    private func show(_ a: TaskAttachment) async {
        guard let raw = a.url, let kind = AttachmentKind(mime: a.mimeType, name: a.name) else {
            await save(a)
            return
        }
        if kind == .image {
            // Straight at the remote URL. `ImageLoader` fetches it with the session, downsamples it
            // in a single pass and keeps the result, so a picture looked at twice is fetched once —
            // and none of that is true of a copy saved to disk beside it.
            guard let remote = Self.remote(raw) else { return }
            preview = AttachmentPreview(id: a.id, name: a.name ?? "file", kind: kind, source: remote)
            return
        }
        guard let file = await fetch(a) else { return }
        preview = AttachmentPreview(id: a.id, name: a.name ?? "file", kind: kind, source: file)
    }

    private func save(_ a: TaskAttachment) async {
        guard let file = await fetch(a) else { return }
        shareItem = ShareItem(url: file)
    }

    private func fetch(_ a: TaskAttachment) async -> URL? {
        guard let raw = a.url else { return nil }
        fetching = a.id
        defer { fetching = nil }
        do {
            return try await APIClient.shared.downloadAttachment(url: raw, fileName: a.name ?? "file",
                                                                 progress: fetchProgress)
        } catch {
            problem = error.localizedDescription
            return nil
        }
    }

    /// A server path becomes a URL the same way it does everywhere else in the app: the host is
    /// added here rather than stored, so what is held names a file and never the route it took.
    private static func remote(_ raw: String) -> URL? {
        URL(string: raw.hasPrefix("http") ? raw : Config.baseURL.absoluteString + raw)
    }

    private func upload(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        busy = true; defer { busy = false }
        problem = nil
        do {
            // Handed over as a URL and not as bytes. This runs on the main actor, so reading a
            // 140 MB file here to pass it on would freeze the screen for the length of the read and
            // then hold the file twice while a multipart body was built around it. The client slices
            // it off the disk instead — see APIClient.uploadAttachmentInChunks.
            try await APIClient.shared.uploadAttachment(taskId: taskId, file: url,
                                                        fileName: url.lastPathComponent,
                                                        progress: uploadProgress)
        } catch {
            problem = error.localizedDescription
        }
        await load()
    }

    private func remove(_ a: TaskAttachment) async {
        busy = true; defer { busy = false }
        withAnimation(Self.slide) { swiped = nil }
        do { try await APIClient.shared.deleteAttachment(a.id) }
        catch { problem = error.localizedDescription }
        await load()
    }
}

// MARK: - Dependencies (blocked-by + blocking)

struct TaskDependenciesCard: View {
    let taskId: String
    let projectId: String?
    /// Hands the hop back to TaskDetailView, which owns the stack's destination binding — one
    /// push target for parent, subtasks and dependencies alike.
    let onOpen: (String) -> Void
    @State private var blockedBy: [TaskDependency] = []   // this task depends on these (removable)
    @State private var blocking: [TaskDependency] = []    // these depend on this task (read-only)
    @State private var loading = true
    @State private var showPicker = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                taskCardHeader("Dependencies", "arrow.triangle.branch")
                Spacer()
                if projectId != nil {
                    Button { showPicker = true } label: { Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(NX.violetText) }
                }
            }
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if blockedBy.isEmpty && blocking.isEmpty {
                Text(T("No dependencies yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                if !blockedBy.isEmpty {
                    group("BLOCKED BY", blockedBy.compactMap { d in d.dependsOnTask.map { ($0, d.id) } }, removable: true)
                }
                if !blocking.isEmpty {
                    group("BLOCKING", blocking.compactMap { d in d.task.map { ($0, d.id) } }, removable: false)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        .task { await load() }
        .sheet(isPresented: $showPicker) {
            if let pid = projectId {
                DependencyPicker(projectId: pid, excludeId: taskId, existing: Set(blockedBy.compactMap { $0.dependsOnTask?.id })) { pickedId in
                    try? await APIClient.shared.addDependency(taskId: taskId, dependsOnTaskId: pickedId)
                    await load()
                }
            }
        }
    }

    private func group(_ label: String, _ rows: [(TaskDependency.TaskRef, String)], removable: Bool) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label).font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            ForEach(rows, id: \.1) { ref, depId in
                HStack(spacing: 10) {
                    Button { onOpen(ref.id) } label: {
                        HStack(spacing: 10) {
                            Circle().fill((ref.status ?? "").uppercased() == "DONE" ? NX.success : NX.mutedFg.opacity(0.4)).frame(width: 8, height: 8)
                            Text(ref.title).font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if removable {
                        Button { Task { try? await APIClient.shared.removeDependency(taskId: taskId, id: depId); await load() } } label: {
                            Image(systemName: "xmark.circle.fill").font(.system(size: 15)).foregroundStyle(NX.mutedFg.opacity(0.6))
                        }.buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 4)
            }
        }
    }

    private func load() async {
        let r = try? await APIClient.shared.taskDependencies(taskId)
        blockedBy = r?.dependencies ?? []
        blocking = r?.dependedOnBy ?? []
        loading = false
    }
}

// MARK: - Time tracking

struct TaskTimeCard: View {
    let taskId: String
    @State private var entries: [TimeEntry] = []
    @State private var loading = true
    @State private var minutes = ""
    @State private var busy = false
    private var total: Int { entries.reduce(0) { $0 + ($1.duration ?? 0) } }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            taskCardHeader(total > 0 ? "Time tracked · \(fmtDur(total))" : "Time tracked", "clock")
            HStack(spacing: 8) {
                TextField("Menit", text: $minutes).keyboardType(.numberPad).font(NXFont.text(14)).padding(10)
                    .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous)).frame(width: 110)
                Button { Task { await log() } } label: {
                    HStack(spacing: 4) { if busy { ProgressView().scaleEffect(0.7).tint(.white) }; Text("Log time") }
                        .font(NXFont.text(13, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 14).padding(.vertical, 9).background(NX.violet, in: Capsule())
                }.buttonStyle(.plain).disabled(busy || (Int(minutes) ?? 0) <= 0)
                Spacer()
            }
            if !loading && !entries.isEmpty {
                ForEach(entries.prefix(6)) { e in
                    HStack(spacing: 8) {
                        Text("\(e.duration ?? 0)m").font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground)
                        Text(e.description ?? e.user?.name ?? "").font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        Spacer()
                        Text(ProjDate.parse(e.startTime).map { ProjDate.dayLabel($0) } ?? "").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard().task { await load() }
    }
    private func fmtDur(_ m: Int) -> String { m >= 60 ? "\(m / 60)j \(m % 60)m" : "\(m)m" }
    private func log() async {
        let m = Int(minutes) ?? 0; guard m > 0 else { return }
        busy = true; defer { busy = false }; minutes = ""
        try? await APIClient.shared.logTime(taskId: taskId, duration: m)
        await load()
    }
    private func load() async { entries = (try? await APIClient.shared.timeEntries(taskId)) ?? []; loading = false }
}

// MARK: - Activity (read-only; comes with the task)

struct TaskActivityCard: View {
    let logs: [TaskDetail.ActivityLog]
    var body: some View {
        if !logs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                taskCardHeader("Activity", "waveform.path.ecg")
                ForEach(logs.prefix(12)) { a in
                    HStack(alignment: .top, spacing: 8) {
                        Text(a.user?.name ?? "Someone").font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground)
                        Text(humanizeEnum(a.action ?? "") + (a.details.map { " — \($0)" } ?? "")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        Spacer(minLength: 6)
                        Text(ProjDate.parse(a.createdAt).map { ProjDate.dayLabel($0) } ?? "").font(NXFont.text(11)).foregroundStyle(NX.mutedFg.opacity(0.8))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        }
    }
}

/// Pick a task in the same project to depend on.
struct DependencyPicker: View {
    let projectId: String
    let excludeId: String
    let existing: Set<String>
    let onPick: (String) async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var tasks: [BoardTask] = []
    @State private var loading = true
    @State private var query = ""

    private var filtered: [BoardTask] {
        tasks.filter { $0.id != excludeId && !existing.contains($0.id) && (query.isEmpty || $0.title.localizedCaseInsensitiveContains(query)) }
    }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                if loading { ProgressView().tint(NX.violetText) }
                else {
                    List {
                        ForEach(filtered) { t in
                            Button { Task { await onPick(t.id); dismiss() } } label: {
                                HStack(spacing: 10) {
                                    Image(systemName: t.isDone ? "checkmark.circle.fill" : "circle").foregroundStyle(t.isDone ? NX.success : NX.mutedFg.opacity(0.5))
                                    Text(t.title).font(NXFont.text(15)).foregroundStyle(NX.foreground).lineLimit(2)
                                }
                            }.buttonStyle(.plain)
                        }
                        if filtered.isEmpty { Text(T("No other tasks.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
                    }
                    .scrollContentBackground(.hidden)
                    .searchable(text: $query, prompt: T("Search tasks…"))
                }
            }
            .navigationTitle(T("Add dependency"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
            .task {
                tasks = (try? await APIClient.shared.project(projectId).taskLists?.flatMap { $0.tasks ?? [] }) ?? []
                loading = false
            }
        }
    }
}
