import SwiftUI
import UniformTypeIdentifiers

func nxBytes(_ b: Int) -> String {
    let units = ["B", "KB", "MB", "GB"]; var v = Double(b); var i = 0
    while v >= 1024 && i < units.count - 1 { v /= 1024; i += 1 }
    return String(format: i == 0 ? "%.0f %@" : "%.1f %@", v, units[i])
}

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
                Text(cfText(f.id).isEmpty ? "—" : cfText(f.id)).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            } else if type == "NUMBER" {
                TextField("0", text: binding(f.id)).keyboardType(.decimalPad).font(NXFont.text(15)).padding(10)
                    .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .onSubmit { Task { await commit(f) } }
            } else if type == "DATE" {
                DatePicker("", selection: dateBinding(f), displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violet)
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
                                    .foregroundStyle(on ? NX.violet : NX.mutedFg)
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

// MARK: - Attachments (list · upload · download · delete)

struct TaskAttachmentsCard: View {
    let taskId: String
    @State private var items: [TaskAttachment] = []
    @State private var loading = true
    @State private var busy = false
    @State private var showImporter = false
    @State private var downloading: String?
    @State private var shareItem: ShareItem?
    @State private var deleteTarget: TaskAttachment?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                taskCardHeader(items.isEmpty ? "Attachments" : "Attachments · \(items.count)", "paperclip")
                Spacer()
                if busy { ProgressView().scaleEffect(0.8) }
                Button { showImporter = true } label: { Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(NX.violet) }.disabled(busy)
            }
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity).padding(.vertical, 8)
            } else if items.isEmpty {
                Text(T("No files yet. Tap + to upload.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ForEach(items) { a in row(a) }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
        .task { await load() }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.item], allowsMultipleSelection: false) { result in
            if case let .success(urls) = result, let url = urls.first { Task { await upload(url) } }
        }
        .sheet(item: $shareItem) { item in ActivityView(items: [item.url]) }
        .confirmationDialog("\(T("Delete")) \"\(deleteTarget?.name ?? "")\"?", isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }), titleVisibility: .visible) {
            Button(T("Delete"), role: .destructive) { if let a = deleteTarget { deleteTarget = nil; Task { await remove(a) } } }
            Button(T("Cancel"), role: .cancel) { deleteTarget = nil }
        }
    }

    private func row(_ a: TaskAttachment) -> some View {
        Button { Task { await download(a) } } label: {
            HStack(spacing: 12) {
                Image(systemName: "doc.fill").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                    .frame(width: 32, height: 32).background(NX.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(a.name ?? "file").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(sub(a)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                Spacer()
                if downloading == a.id { ProgressView().scaleEffect(0.8) }
                else { Image(systemName: "square.and.arrow.down").font(.system(size: 13)).foregroundStyle(NX.mutedFg) }
            }
            .padding(10).background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .contextMenu { Button(role: .destructive) { deleteTarget = a } label: { Label(T("Delete"), systemImage: "trash") } }
    }
    private func sub(_ a: TaskAttachment) -> String {
        var p: [String] = []
        if let s = a.size { p.append(nxBytes(s)) }
        if let n = a.uploader?.name { p.append(n) }
        return p.joined(separator: " · ")
    }

    private func load() async {
        items = (try? await APIClient.shared.taskAttachments(taskId)) ?? []
        loading = false
    }
    private func upload(_ url: URL) async {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }
        guard let data = try? Data(contentsOf: url) else { return }
        busy = true; defer { busy = false }
        try? await APIClient.shared.uploadAttachment(taskId: taskId, fileName: url.lastPathComponent, data: data)
        await load()
    }
    private func download(_ a: TaskAttachment) async {
        guard let url = a.url else { return }
        downloading = a.id; defer { downloading = nil }
        if let local = try? await APIClient.shared.downloadAttachment(url: url, fileName: a.name ?? "file") {
            shareItem = ShareItem(url: local)
        }
    }
    private func remove(_ a: TaskAttachment) async {
        busy = true; defer { busy = false }
        try? await APIClient.shared.deleteAttachment(a.id)
        await load()
    }
}

// MARK: - Dependencies (blocked-by + blocking)

struct TaskDependenciesCard: View {
    let taskId: String
    let projectId: String?
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
                    Button { showPicker = true } label: { Image(systemName: "plus.circle.fill").font(.system(size: 20)).foregroundStyle(NX.violet) }
                }
            }
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity).padding(.vertical, 8)
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
                    Circle().fill((ref.status ?? "").uppercased() == "DONE" ? NX.success : NX.mutedFg.opacity(0.4)).frame(width: 8, height: 8)
                    Text(ref.title).font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1)
                    Spacer()
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
                if loading { ProgressView().tint(NX.violet) }
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
