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
    /// Bumped by the task screen when the task changed elsewhere (realtime): the values are read again,
    /// except a field that is being edited here and not saved yet.
    var refreshToken = 0
    @State private var fields: [CustomField] = []
    @State private var values: [String: CFVal] = [:]
    @State private var loaded = false
    /// Typed but not sent yet. Text and number fields save when focus leaves them and when the task
    /// closes (bughunt C-BUG-1: a typed Rupiah amount was lost when the screen closed before the field
    /// lost focus — and the number pad has no Return key, so it never saved at all).
    @State private var dirty: Set<String> = []
    @State private var problem: String?
    @FocusState private var focused: String?

    var body: some View {
        cardBody
            .task { await load() }
            .onChange(of: refreshToken) { _, _ in Task { await reload() } }
            .onChange(of: focused) { old, _ in
                if let old, dirty.contains(old), let f = fields.first(where: { $0.id == old }) { Task { await commit(f) } }
            }
            // Leaving the task saves what was typed, as the web popup does on close.
            .onDisappear { flushAll() }
    }

    @ViewBuilder private var cardBody: some View {
        if fields.isEmpty {
            Color.clear.frame(height: 0)   // real (zero-size) view so .task fires even with no fields yet
        } else {
            VStack(alignment: .leading, spacing: 14) {
                if let problem {
                    Text(problem).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                }
                ForEach(fields) { f in cfRow(f) }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    @ViewBuilder private func cfRow(_ f: CustomField) -> some View {
        let type = f.type.uppercased()
        let choices = f.choices
        HStack(alignment: .top, spacing: 12) {
            Text(f.name).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).frame(width: 115, alignment: .leading).padding(.top, 10)
            VStack(alignment: .leading, spacing: 6) {
            if type == "CREATED" {
                // Who made the task, as on the web, tagged "Left" once they were offboarded.
                if let who = f.createdMeta?.userName, !who.isEmpty {
                    HStack(spacing: 6) {
                        // The system user signs automation-made tasks with its English name.
                        Text(who == "Automation" ? T("Automation") : who).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                        if creatorLeft { LeftTag() }
                    }
                }
                Text(cfText(f.id).isEmpty ? "—" : cfText(f.id)).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            } else if type == "NUMBER" {
                NumberFieldInput(text: binding(f.id), style: f.options?.numberStyle ?? .plain, focus: $focused, focusId: f.id)
                    .padding(10)

                    .onSubmit { Task { await commit(f) } }
            } else if type == "DATE", !cfText(f.id).isEmpty, Self.ymdParse(String(cfText(f.id).prefix(10))) == nil {
                // A date field holding a name or a timestamp (Notion's created-by / created-time import,
                // "Request by"): plain text with a person icon, not a date picker showing today (UI tour run 11).
                Label(cfText(f.id), systemImage: "person").font(NXFont.text(14)).foregroundStyle(NX.foreground)
                    .labelStyle(.titleAndIcon).lineLimit(2)
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
                    .padding(10).frame(minHeight: 44)
                }
            } else if type == "MULTI_SELECT", !choices.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(choices, id: \.self) { c in
                            let on = multiHas(f.id, c)
                            Button { Task { await changeMulti(f.id, c) } } label: {
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
                        .focused($focused, equals: f.id)
                        .onSubmit { Task { await commit(f) } }
                    TextField(T("Google Maps link"), text: placeMap(f)).font(NXFont.text(15)).keyboardType(.URL).autocorrectionDisabled().padding(10)
                        .focused($focused, equals: f.id + "#map")
                        .onSubmit { Task { await commit(f) } }
                }
            } else {
                TextField("…", text: binding(f.id)).font(NXFont.text(15)).padding(10)
                    .focused($focused, equals: f.id)

                    .onSubmit { Task { await commit(f) } }
            }
            }.frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func load() async {
        guard !loaded else { return }
        fields = (try? await APIClient.shared.taskCustomFields(projectId: projectId, taskId: taskId)) ?? []
        values = Self.seed(fields); loaded = true
    }

    /// The values as the server has them now; a field with unsaved typing keeps what was typed.
    private func reload() async {
        guard loaded, let fresh = try? await APIClient.shared.taskCustomFields(projectId: projectId, taskId: taskId) else { return }
        let seeded = Self.seed(fresh)
        var merged = values
        for f in fresh where !dirty.contains(f.id) && focused != f.id && focused != f.id + "#map" { merged[f.id] = seeded[f.id] }
        fields = fresh
        values = merged
    }

    private static func seed(_ fields: [CustomField]) -> [String: CFVal] {
        var seed: [String: CFVal] = [:]
        for f in fields {
            switch f.value {
            case .text(let s): seed[f.id] = .text(s)
            case .list(let a): seed[f.id] = .multi(a)
            case .place(let l, let m): seed[f.id] = .place(label: l, mapUrl: m ?? "")
            case .none: break
            }
        }
        return seed
    }

    private func commit(_ f: CustomField) async {
        dirty.remove(f.id)
        guard let v = values[f.id] else { return }
        do {
            switch v {
            case .text(let s):
                // A number is stored as a plain machine number ("369.000" Rupiah → "369000").
                let out = f.type.uppercased() == "NUMBER" ? CustomFieldNumber.normalize(s, style: f.options?.numberStyle ?? .plain) : s
                try await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: out)
            case .multi(let a): try await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: a)
            case .place(let l, let m): try await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: taskId, value: ["label": l, "mapUrl": m])
            }
            problem = nil
        } catch {
            // Kept on screen and marked unsaved, so the next focus change or close tries again.
            dirty.insert(f.id)
            problem = String(format: T("“%@” wasn't saved. Check your connection and try again."), f.name)
        }
    }

    /// Sends every field that was typed into and not saved yet. Runs as the task closes, so it does not
    /// wait for the answers.
    private func flushAll() {
        let pending = fields.filter { dirty.contains($0.id) }
        guard !pending.isEmpty else { return }
        let snapshot = values, task = taskId
        Task {
            for f in pending {
                guard case .some(let v) = snapshot[f.id] else { continue }
                switch v {
                case .text(let s):
                    let out = f.type.uppercased() == "NUMBER" ? CustomFieldNumber.normalize(s, style: f.options?.numberStyle ?? .plain) : s
                    try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: task, value: out)
                case .multi(let a): try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: task, value: a)
                case .place(let l, let m): try? await APIClient.shared.setCustomFieldValue(fieldId: f.id, taskId: task, value: ["label": l, "mapUrl": m])
                }
            }
        }
    }

    private func placeVal(_ id: String) -> (String, String) { if case let .place(l, m) = values[id] { return (l, m) }; return ("", "") }
    private func placeLabel(_ f: CustomField) -> Binding<String> { Binding(get: { placeVal(f.id).0 }, set: { values[f.id] = .place(label: $0, mapUrl: placeVal(f.id).1); dirty.insert(f.id) }) }
    private func placeMap(_ f: CustomField) -> Binding<String> { Binding(get: { placeVal(f.id).1 }, set: { values[f.id] = .place(label: placeVal(f.id).0, mapUrl: $0); dirty.insert(f.id) }) }
    private func cfText(_ id: String) -> String { if case let .text(s) = values[id] { return s }; return "" }
    private func binding(_ id: String) -> Binding<String> { Binding(get: { cfText(id) }, set: { values[id] = .text($0); dirty.insert(id) }) }
    private func dateBinding(_ f: CustomField) -> Binding<Date> {
        Binding(get: { Self.ymdParse(cfText(f.id)) ?? Date() }, set: { values[f.id] = .text(Self.ymd($0)); Task { await commit(f) } })
    }
    private func multiHas(_ id: String, _ c: String) -> Bool { if case let .multi(a) = values[id] { return a.contains(c) }; return false }
    private func changeMulti(_ id: String, _ choice: String) async {
        let removing = multiHas(id, choice)
        do {
            try await APIClient.shared.changeCustomFieldValues(fieldId: id, taskId: taskId,
                add: removing ? [] : [choice], remove: removing ? [choice] : [])
            problem = nil
        } catch {
            problem = error.localizedDescription
        }
        await reload()
    }
    private static func ymd(_ d: Date) -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone; return f.string(from: d) }
    private static func ymdParse(_ s: String) -> Date? { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone; return f.date(from: s) }
}

// MARK: - Attachments (list · open · upload · download · delete)

struct TaskAttachmentsCard: View {
    let taskId: String
    /// Can edit or more in the task's project (access levels round 2): false = files open and share, but
    /// no add and no delete.
    var canEdit = true
    /// Bumped by the task screen when the task changed elsewhere (R-19 `project-changed` "task": a file
    /// added or removed on another device): the list is read again.
    var refreshToken = 0
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
                taskCardHeader(items.isEmpty ? T("Attachments") : "\(T("Attachments")) · \(items.count)", "paperclip")
                Spacer()
                if busy { ProgressView().scaleEffect(0.8) }
                if canEdit {
                    Button { showImporter = true } label: {
                        Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(NX.violetText)
                            .frame(width: 44, height: 44).contentShape(Rectangle())
                    }
                    .accessibilityLabel(T("Add files"))
                    .disabled(busy)
                }
            }
            if uploadProgress.isActive { meter(T("Uploading"), uploadProgress) }
            if fetchProgress.isActive { meter(T("Downloading"), fetchProgress) }
            if let problem { complaint(problem) }
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if items.isEmpty {
                Text(canEdit ? PlatformWording.tapOrClick(tap: "No files yet. Tap + to add receipts, proofs or documents.", click: "No files yet. Click + to add receipts, proofs or documents.") : T("No files yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(items) { a in row(a) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        .task { await load() }
        .onChange(of: refreshToken) { _, _ in Task { await load() } }
        .sheet(isPresented: $showImporter) {
            // Several files in one pick, uploaded one after another (bughunt C-BUG-31).
            DocumentPicker(types: [.item], multiple: true) { urls in
                guard !urls.isEmpty else { return }
                Task { for url in urls { await upload(url) } }
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
                    .touchTarget44(drawn: 11)
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
                if canEdit {
                    Button(role: .destructive) { deleteTarget = a } label: { Label(T("Delete"), systemImage: "trash") }
                }
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
                HStack(spacing: 6) {
                    Text(a.name ?? "file").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    // A proof from an older app or the old Payout proof section keeps a small tag so
                    // finance can tell it apart (web, 12 Oct 2026).
                    if a.isPayoutProof {
                        Text(T("Payout proof")).font(NXFont.text(10, .semibold)).foregroundStyle(NX.success)
                            .padding(.horizontal, 6).padding(.vertical, 2)
                            .background(NX.success.opacity(0.12), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .fixedSize()
                    }
                }
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
        .accessibilityAction(named: Text(T("Delete"))) { if canEdit { deleteTarget = a } }
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
                guard canEdit, abs(value.translation.width) > abs(value.translation.height) else { return }
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

// Dependencies ("Blocked by") and Time tracked were removed from the task (owner, 12 Oct 2026), as on
// the web. The server keeps the data and its endpoints for the released apps.

// MARK: - Activity (read-only; comes with the task)

struct TaskActivityCard: View {
    let logs: [TaskDetail.ActivityLog]
    var body: some View {
        if !logs.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                taskCardHeader(T("Activity"), "waveform.path.ecg")
                ForEach(logs.prefix(12)) { a in
                    HStack(alignment: .top, spacing: 8) {
                        Text(SystemUsers.name(a.user?.name, avatar: a.user?.avatar, fallback: "Someone")).font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground)
                        // In the app's language, without the action repeated before it (web activityText).
                        Text(ServerText.activity(a.details, fallback: humanizeEnum(a.action ?? ""))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        Spacer(minLength: 6)
                        Text(ProjDate.parse(a.createdAt).map { ProjDate.dayLabel($0) } ?? "").font(NXFont.text(11)).foregroundStyle(NX.mutedFg.opacity(0.8))
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        }
    }
}

// MARK: - Description (block editor)

/// The task's description as a block document (headings, lists, to-dos, toggles…), edited in place. Saved
/// when the task closes and with Save; kept on the phone when offline (BlockEditOutbox).
struct TaskBodyCard: View {
    let taskId: String
    let projectId: String?
    let title: String
    /// Bumped when the task changed elsewhere: the document is read again unless it is being edited.
    var refreshToken = 0
    @State private var model: BlockEditorModel
    @State private var aiRequest: GideonWriteRequest?

    init(taskId: String, projectId: String?, title: String, refreshToken: Int = 0) {
        self.taskId = taskId
        self.projectId = projectId
        self.title = title
        self.refreshToken = refreshToken
        _model = State(initialValue: BlockEditorModel(ref: BlockBodyRef(kind: "taskbody", id: taskId)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            if let note = model.note {
                Label(note, systemImage: "icloud.slash").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            if model.loaded {
                BlockEditorView(model: model, fontSize: 14, onAI: model.canEdit ? { aiRequest = $0 } : nil)
                    .disabled(!model.canEdit)
            } else {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 8)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task { await model.load() }
        .onChange(of: refreshToken) { _, _ in
            if !model.isDirty && !model.saving { Task { await model.load() } }
        }
        .onDisappear { model.saveOnClose() }
        .sheet(item: $aiRequest) { r in aiSheet(r) }
        .alert(T("Someone changed the same part"), isPresented: conflictShown) {
            Button(T("Keep both")) { Task { await model.save(keepBoth: true) } }
            Button(T("Use their version"), role: .destructive) { model.discardMine() }
            Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("While you were editing, someone else changed a block you also changed. Keep both versions, or drop yours.")) }
    }

    private var header: some View {
        HStack {
            Spacer()
            if model.saving { ProgressView().scaleEffect(0.7) }
            else if model.isDirty && model.canEdit {
                Button(T("Save")) { Task { await model.save() } }
                    .font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
                    .frame(minHeight: 32)
            }
        }
    }

    private var conflictShown: Binding<Bool> {
        // Cancel only closes the alert: the edit stays on the phone and is asked about again next time.
        Binding(get: { model.conflictDoc != nil }, set: { if !$0 { model.conflictDoc = nil } })
    }

    private func aiSheet(_ r: GideonWriteRequest) -> GideonWriteSheet {
        GideonWriteSheet(request: r, docTitle: title, docId: nil, taskId: taskId, projectId: projectId,
                         onReplace: { text, result in BlockEditorApply.replace(model, r.blockId, text: text, doc: result) },
                         onInsert: { result, text in BlockEditorApply.insert(model, after: r.blockId, doc: result, text: text) })
    }
}
