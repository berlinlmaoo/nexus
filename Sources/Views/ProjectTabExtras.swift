import SwiftUI

// ============================================================================
// MARK: - Sprints
// ============================================================================

struct SprintsResponse: Decodable, Sendable { let sprints: [Sprint]? }
struct Sprint: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let status: String?
    let startDate: String?
    let endDate: String?
    let tasks: [SprintTask]?
    struct SprintTask: Decodable, Sendable { let task: TaskRef? }
    struct TaskRef: Decodable, Identifiable, Sendable { let id: String; let title: String?; let status: String? }

    var taskRefs: [TaskRef] { (tasks ?? []).compactMap { $0.task } }
    var doneCount: Int { taskRefs.filter { ($0.status ?? "").uppercased() == "DONE" }.count }
    var progress: Double { taskRefs.isEmpty ? 0 : Double(doneCount) / Double(taskRefs.count) }
    var nextStatus: String? {
        switch (status ?? "PLANNING").uppercased() { case "PLANNING": return "ACTIVE"; case "ACTIVE": return "COMPLETED"; default: return nil }
    }
    var nextLabel: String? {
        switch (status ?? "PLANNING").uppercased() { case "PLANNING": return "Mulai"; case "ACTIVE": return "Selesaikan"; default: return nil }
    }
}

struct SprintsTab: View {
    let projectId: String
    let onOpen: (String) -> Void
    @Environment(AuthStore.self) private var auth
    @State private var sprints: [Sprint] = []
    @State private var loading = true
    @State private var expanded: String?
    @State private var showCreate = false

    private var active: Int { sprints.filter { ($0.status ?? "").uppercased() == "ACTIVE" }.count }
    private var planning: Int { sprints.filter { ($0.status ?? "").uppercased() == "PLANNING" }.count }
    private var shipped: Int { sprints.filter { ($0.status ?? "").uppercased() == "COMPLETED" }.count }

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header
                        if sprints.isEmpty {
                            TabEmpty(icon: "target", text: T("No sprints yet. Create a cycle to focus execution."))
                        } else {
                            ForEach(sprints) { sprintCard($0) }
                        }
                    }.padding(16)
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showCreate) { CreateSprintSheet(projectId: projectId) { await load() } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Sprint Arena", systemImage: "target").font(NXFont.text(11, .bold)).foregroundStyle(NX.violetText)
                    Text("Jalanin mission per cycle.").font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                }
                Spacer()
                Button { showCreate = true } label: {
                    Label("Sprint", systemImage: "plus").font(NXFont.text(12, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 8).background(NX.violet, in: Capsule())
                }.buttonStyle(.plain)
            }
            HStack(spacing: 10) {
                metric("Active", active); metric("Planning", planning); metric("Shipped", shipped)
            }
        }.nexusCard()
    }
    private func metric(_ label: String, _ v: Int) -> some View {
        VStack(spacing: 2) {
            Text("\(v)").font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(10, .medium)).foregroundStyle(NX.mutedFg)
        }.frame(maxWidth: .infinity).padding(.vertical, 10).background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func sprintCard(_ s: Sprint) -> some View {
        let isOpen = expanded == s.id
        return VStack(alignment: .leading, spacing: 10) {
            Button { expanded = isOpen ? nil : s.id } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(s.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                        sprintChip(s.status)
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg).rotationEffect(.degrees(isOpen ? 90 : 0))
                    }
                    Text("\(dateLabel(s.startDate)) → \(dateLabel(s.endDate))").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NX.muted)
                            Capsule().fill(NX.success).frame(width: geo.size.width * s.progress)
                        }
                    }.frame(height: 6)
                    Text("\(s.doneCount)/\(s.taskRefs.count) card kelar · \(Int(s.progress * 100))%").font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                }
            }.buttonStyle(.plain)

            if isOpen {
                if s.taskRefs.isEmpty {
                    Text(T("No cards in this sprint yet.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                } else {
                    ForEach(s.taskRefs) { t in
                        Button { onOpen(t.id) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: (t.status ?? "").uppercased() == "DONE" ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle((t.status ?? "").uppercased() == "DONE" ? NX.success : NX.mutedFg.opacity(0.5))
                                Text(t.title ?? "Untitled").font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1)
                                Spacer()
                            }.padding(.vertical, 4)
                        }.buttonStyle(.plain)
                    }
                }
                if let next = s.nextStatus, let label = s.nextLabel {
                    Button { Task { try? await APIClient.shared.updateSprint(id: s.id, status: next); await load() } } label: {
                        Text(label).font(NXFont.text(13, .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 10).background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }.buttonStyle(.plain)
                }
            }
        }.nexusCard()
    }

    private func sprintChip(_ status: String?) -> some View {
        let s = (status ?? "PLANNING").uppercased()
        let tone: ChipTone = s == "ACTIVE" ? .success : s == "COMPLETED" ? .info : .neutral
        return NexusChip(text: s.capitalized, tone: tone)
    }
    private func dateLabel(_ iso: String?) -> String { ProjDate.parse(iso).map { ProjDate.dayLabel($0) } ?? "—" }

    private func load() async {
        do { sprints = (try await APIClient.shared.sprints(projectId)).sprints ?? [] }
        catch APIError.unauthorized { auth.logout() } catch { sprints = [] }
        loading = false
    }
}

struct CreateSprintSheet: View {
    let projectId: String
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(13 * 86400)
    @State private var busy = false
    @State private var err: String?

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        field(T("SPRINT NAME")) {
                            TextField("mis. Launch Week 01", text: $name).font(NXFont.text(16)).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        HStack(spacing: 12) {
                            field("MULAI") { DatePicker("", selection: $start, displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violetText) }
                            field(T("END")) { DatePicker("", selection: $end, in: start..., displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violetText) }
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await create() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text(T("Create sprint")) }
                        }.buttonStyle(NexusPrimaryButton()).disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }.padding(20)
                }
            }
            .navigationTitle("Sprint baru").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Cancel")) { dismiss() } } }
        }
    }
    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) { SectionLabel(label); content() }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func create() async {
        busy = true; err = nil; defer { busy = false }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
        do {
            try await APIClient.shared.createSprint(projectId: projectId, name: name.trimmingCharacters(in: .whitespaces), startDate: f.string(from: start), endDate: f.string(from: end))
            await onCreated(); dismiss()
        } catch { err = (error as? LocalizedError)?.errorDescription ?? T("Couldn't create the sprint.") }
    }
}

// ============================================================================
// MARK: - Automations
// ============================================================================

struct AutomationsResponse: Decodable, Sendable { let automations: [Automation]? }
struct Automation: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let enabled: Bool?
    let trigger: Rule?
    let action: Rule?
    struct Rule: Decodable, Sendable { let type: String?; let field: String?; let value: String? }
    func ruleText(_ r: Rule?) -> String {
        guard let r else { return "—" }
        var s = humanizeEnum(r.type ?? "")
        if let f = r.field, !f.isEmpty { s += " · \(humanizeEnum(f))" }
        if let v = r.value, !v.isEmpty { s += " = \(v)" }
        return s
    }
}

struct AutomationsTab: View {
    let projectId: String
    @Environment(AuthStore.self) private var auth
    @State private var rules: [Automation] = []
    @State private var loading = true

    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if rules.isEmpty { TabEmpty(icon: "bolt.slash", text: T("No automations yet. Set up rules from the web app (desktop).")) }
            else {
                ScrollView {
                    VStack(spacing: 12) { ForEach(rules) { card($0) } }.padding(16)
                }
            }
        }
        .task { await load() }
    }

    private func card(_ a: Automation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "bolt.fill").font(.system(size: 13)).foregroundStyle((a.enabled ?? false) ? NX.warning : NX.mutedFg)
                Text(a.name).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer()
                Toggle("", isOn: Binding(get: { a.enabled ?? false }, set: { on in Task { try? await APIClient.shared.updateAutomation(id: a.id, enabled: on); await load() } }))
                    .labelsHidden().tint(NX.violetText)
            }
            HStack(alignment: .top, spacing: 8) {
                badge(T("IF"), a.ruleText(a.trigger), NX.blue)
                Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg).padding(.top, 6)
                badge("MAKA", a.ruleText(a.action), NX.violetText)
            }
        }.nexusCard()
    }
    private func badge(_ label: String, _ text: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(NXFont.text(9, .bold)).foregroundStyle(tint)
            Text(text).font(NXFont.text(12)).foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(8)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
    private func load() async {
        do { rules = (try await APIClient.shared.automations(projectId)).automations ?? [] }
        catch APIError.unauthorized { auth.logout() } catch { rules = [] }
        loading = false
    }
}

// ============================================================================
// Spreadsheet — the web's `sheet` project tab. A flat grid of every card (subtasks
// merged in) with the project's custom fields as extra columns. Needs NO new API:
// it reuses the tasks already loaded for the board plus /api/custom-fields.
// ============================================================================

struct SpreadsheetTab: View {
    let projectId: String
    let lanes: [ProjectDetail.Lane]
    let onOpen: (String) -> Void
    @State private var fields: [CustomField] = []
    @State private var loading = true

    private struct SheetRow: Identifiable {
        let id: String
        let lane: String
        let task: BoardTask
    }
    private var rows: [SheetRow] {
        lanes.flatMap { l in (l.tasks ?? []).map { SheetRow(id: $0.id, lane: l.name, task: $0) } }
    }

    private let wTitle: CGFloat = 210
    private let wLane: CGFloat = 130
    private let wSmall: CGFloat = 105
    private let wField: CGFloat = 140
    private let rowH: CGFloat = 44

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if rows.isEmpty {
                TabEmpty(icon: "tablecells", text: T("No tasks to show in the spreadsheet yet."))
            } else {
                ScrollView(.horizontal, showsIndicators: true) {
                    VStack(alignment: .leading, spacing: 0) {
                        headerRow
                        Divider().overlay(NX.border)
                        ScrollView(.vertical, showsIndicators: true) {
                            LazyVStack(alignment: .leading, spacing: 0) {
                                ForEach(rows) { r in
                                    Button { onOpen(r.task.id) } label: { bodyRow(r) }
                                        .buttonStyle(.plain)
                                    Divider().overlay(NX.border.opacity(0.6))
                                }
                            }
                        }
                    }
                }
            }
        }
        .task { await load() }
    }

    private var headerRow: some View {
        HStack(spacing: 0) {
            headerCell(T("Task"), wTitle)
            headerCell(T("Section"), wLane)
            headerCell(T("Status"), wSmall)
            headerCell(T("Priority"), wSmall)
            headerCell(T("Due"), wSmall)
            headerCell(T("Assignee"), wLane)
            ForEach(fields) { f in headerCell(f.name, wField) }
        }
        .background(NX.muted.opacity(0.5))
    }

    private func headerCell(_ text: String, _ w: CGFloat) -> some View {
        Text(text.uppercased()).font(NXFont.text(10, .bold)).tracking(0.4).foregroundStyle(NX.mutedFg)
            .lineLimit(1)
            .frame(width: w, height: 34, alignment: .leading)
            .padding(.horizontal, 10)
            .overlay(alignment: .trailing) { Rectangle().fill(NX.border).frame(width: 1) }
    }

    private func bodyRow(_ r: SheetRow) -> some View {
        let t = r.task
        return HStack(spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: t.isDone ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 13)).foregroundStyle(t.isDone ? NX.success : NX.mutedFg.opacity(0.5))
                Text(t.isSubtask ? "↳ \(t.title)" : t.title)
                    .font(NXFont.text(13, .semibold))
                    .foregroundStyle(t.isDone ? NX.mutedFg : NX.foreground)
                    .strikethrough(t.isDone).lineLimit(1)
            }
            .frame(width: wTitle, height: rowH, alignment: .leading).padding(.horizontal, 10)
            .overlay(alignment: .trailing) { Rectangle().fill(NX.border.opacity(0.6)).frame(width: 1) }

            textCell(r.lane, wLane)
            textCell(humanizeEnum(t.status ?? "TODO"), wSmall)
            textCell((t.priority ?? "NONE").capitalized, wSmall)
            textCell(ProjDate.parse(t.dueDate).map { ProjDate.dayLabel($0) } ?? "—", wSmall)
            textCell(t.assignees?.compactMap { $0.user?.name }.joined(separator: ", ") ?? "—", wLane)
            ForEach(fields) { f in textCell(cfText(t, f), wField) }
        }
    }

    private func textCell(_ s: String, _ w: CGFloat) -> some View {
        Text(s.isEmpty ? "—" : s).font(NXFont.text(12)).foregroundStyle(NX.foreground.opacity(0.9))
            .lineLimit(1)
            .frame(width: w, height: rowH, alignment: .leading).padding(.horizontal, 10)
            .overlay(alignment: .trailing) { Rectangle().fill(NX.border.opacity(0.6)).frame(width: 1) }
    }

    /// Reuses the board's chip formatter so currency / multi-select / place values read the same
    /// here as they do on a card.
    private func cfText(_ t: BoardTask, _ f: CustomField) -> String {
        guard let cfv = (t.customFieldValues ?? []).first(where: { $0.customFieldId == f.id }) else { return "—" }
        return customFieldChip(cfv)?.label ?? (cfv.value ?? "—")
    }

    private func load() async {
        fields = (try? await APIClient.shared.projectCustomFields(projectId)) ?? []
        loading = false
    }
}
