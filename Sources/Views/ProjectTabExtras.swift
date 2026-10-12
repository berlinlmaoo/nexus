import SwiftUI

// Automations moved to AutomationsViews.swift (rebuilt 12 Oct 2026, When / If / Do).

// ============================================================================
// Spreadsheet — the web's `sheet` project tab. A flat grid of every card (subtasks
// merged in) with the project's custom fields as extra columns. Needs NO new API:
// it reuses the tasks already loaded for the board plus /api/custom-fields.
// ============================================================================

/// A Table row can be picked up and dropped on only when the board passes `onDrop`, which it does for
/// Can edit and up (ProjectBoardView.tableDrop). Below that the row is a plain button: a drag that lifts
/// and then lands nowhere reads as a broken move (QA 13 Oct 2026).
private struct SheetRowDrag: ViewModifier {
    let taskId: String
    let laneId: String
    let onDrop: (([String], String, String?) -> Void)?

    @ViewBuilder func body(content: Content) -> some View {
        if let onDrop {
            content
                .draggable(taskId)
                .dropDestination(for: String.self) { (ids: [String], _: CGPoint) -> Bool in
                    guard !ids.isEmpty, !ids.contains(taskId) else { return false }
                    onDrop(ids, laneId, taskId)
                    return true
                }
        } else {
            content
        }
    }
}

struct SpreadsheetTab: View {
    let projectId: String
    let lanes: [ProjectDetail.Lane]
    let onOpen: (String) -> Void
    /// Rows dropped on a row (ids, that row's section, that row): a move like the List's (touch long-press drag).
    var onDrop: (([String], String, String?) -> Void)? = nil
    @State private var fields: [CustomField] = []
    @State private var loading = true

    private struct SheetRow: Identifiable {
        let id: String
        let lane: String
        let laneId: String
        let task: BoardTask
    }
    private var rows: [SheetRow] {
        lanes.flatMap { l in (l.tasks ?? []).map { SheetRow(id: $0.id, lane: l.name, laneId: l.id, task: $0) } }
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
                                        .modifier(SheetRowDrag(taskId: r.task.id, laneId: r.laneId, onDrop: onDrop))
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
