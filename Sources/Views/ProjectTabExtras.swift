import SwiftUI

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
