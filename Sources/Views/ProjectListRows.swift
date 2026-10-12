import SwiftUI

// The project List as on the dev web (routes/_app/projects/$projectId.tsx ListRow + views/view-layouts.tsx):
// flat rows on hairlines, the task's properties on the right (custom fields, due, priority, status,
// people), group headers with a chevron, the option's coloured pill and "done/total". Small typed views,
// each one plain, so the type checker never sees a long expression.

/// A task's status as its row shows it: the status option (section) when the project has options,
/// else the plain status in its default colour.
struct RowStatus: Equatable {
    let name: String
    let colorKey: String

    static func plain(_ task: BoardTask) -> RowStatus {
        let s = (task.status ?? "TODO").uppercased()
        return RowStatus(name: TaskStatusName.label(s), colorKey: StatusColor.forStatus[s] ?? "gray")
    }
}

/// A group's header: chevron, the label (a coloured pill for status options), done / total.
struct ListGroupHeader: View {
    let lane: ProjectDetail.Lane
    let statusStyle: Bool
    let collapsed: Bool
    let onToggle: () -> Void

    private var tasks: [BoardTask] { lane.tasks ?? [] }
    private var doneCount: Int { tasks.filter(\.isDone).count }

    var body: some View {
        Button(action: onToggle) {
            HStack(spacing: 6) {
                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(NX.mutedFg)
                    .rotationEffect(.degrees(collapsed ? 0 : 90))
                label
                Text("\(doneCount)/\(tasks.count)")
                    .font(NXFont.text(12))
                    .foregroundStyle(statusStyle ? StatusColor.swatch(lane.colorKey).fg : NX.mutedFg)
                    .monospacedDigit()
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(lane.name), \(doneCount)/\(tasks.count)")
        .accessibilityValue(collapsed ? T("Collapsed") : T("Expanded"))
    }

    @ViewBuilder private var label: some View {
        if statusStyle {
            StatusPill(name: lane.name, colorKey: lane.colorKey, size: 13)
        } else {
            Text(lane.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
        }
    }
}

/// The properties on the right of a row (wide) or under its title (compact).
struct ListPropLine: View {
    let task: BoardTask
    let status: RowStatus?
    /// Compact width: the properties wrap under the title instead of running off the edge.
    var wrap = false

    private var customChips: [CFChip] { Array((task.customFieldValues ?? []).compactMap(customFieldChip).prefix(3)) }

    private var overdue: Bool {
        guard !task.isDone, let due = ProjDate.parse(task.dueDate) else { return false }
        return due < ProjDate.cal.startOfDay(for: Date())
    }

    var body: some View {
        let layout = wrap ? AnyLayout(FlowLayout(spacing: 6)) : AnyLayout(HStackLayout(spacing: 8))
        layout {
            ForEach(customChips) { chip in customValue(chip) }
            if let due = ProjDate.parse(task.dueDate) {
                Label(ProjDate.dayLabel(due), systemImage: "clock")
                    .labelStyle(.titleAndIcon)
                    .font(NXFont.text(11, overdue ? .semibold : .regular))
                    .foregroundStyle(overdue ? NX.danger : NX.mutedFg)
                    .lineLimit(1).fixedSize()
            }
            if let p = task.priority, p.uppercased() != "NONE" { PriorityPill(priority: p) }
            if let status { StatusPill(name: status.name, colorKey: status.colorKey, size: 11).fixedSize() }
            people
        }
    }

    @ViewBuilder private func customValue(_ chip: CFChip) -> some View {
        if chip.colorKey != nil {
            CFChipView(chip: chip).fixedSize()
        } else {
            Text(chip.label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                .monospacedDigit().lineLimit(1).fixedSize()
        }
    }

    @ViewBuilder private var people: some View {
        let avatars = task.assigneeAvatars
        if !avatars.isEmpty {
            HStack(spacing: -6) {
                ForEach(avatars, id: \.id) { a in
                    AvatarView(url: a.url, initial: a.initial, size: 20)
                        .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                }
            }
        }
    }
}

/// One flat List row: the done circle, the title, the properties, a hairline underneath.
struct ListTaskRow: View {
    let task: BoardTask
    let status: RowStatus?
    let wide: Bool
    let onOpen: (String) -> Void
    var selection: TaskSelection? = nil
    var order: () -> [String] = { [] }

    private var selecting: Bool { selection?.active ?? false }
    private var selected: Bool { selection?.contains(task.id) ?? false }

    var body: some View {
        if let selection {
            row.contextMenu { TaskSelectionMenuItems(taskId: task.id, selection: selection) }
        } else {
            row
        }
    }

    private var row: some View {
        Button {
            if selecting, let selection { selection.toggle(task.id) } else { onOpen(task.id) }
        } label: {
            content
                .padding(.horizontal, 8).padding(.vertical, 8)
                .padding(.leading, task.isSubtask ? 20 : 0)
                .frame(maxWidth: .infinity, minHeight: 38, alignment: .leading)
                .background(selecting && selected ? NX.violet.opacity(0.10) : Color.clear)
                .overlay(alignment: .bottom) { Rectangle().fill(NX.border.opacity(0.7)).frame(height: 0.5) }
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityAddTraits(selecting && selected ? .isSelected : [])
        .taskModifierClicks(task.id, selection: selection, order: order)
    }

    @ViewBuilder private var content: some View {
        if wide {
            HStack(spacing: 10) {
                leading
                titleLine
                Spacer(minLength: 8)
                ListPropLine(task: task, status: status)
            }
        } else {
            HStack(alignment: .top, spacing: 10) {
                leading.padding(.top, 1)
                VStack(alignment: .leading, spacing: 5) {
                    titleLine
                    ListPropLine(task: task, status: status, wrap: true)
                }
            }
        }
    }

    @ViewBuilder private var leading: some View {
        if selecting { TaskSelectionMark(selected: selected) }
        Image(systemName: task.isDone ? "checkmark.circle.fill" : "circle")
            .font(.system(size: 15))
            .foregroundStyle(task.isDone ? NX.success : NX.mutedFg.opacity(0.55))
    }

    private var titleLine: some View {
        HStack(spacing: 6) {
            if task.isSubtask {
                Image(systemName: "arrow.turn.down.right").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
            }
            Text(task.title)
                .font(NXFont.text(14))
                .foregroundStyle(task.isDone ? NX.mutedFg : NX.foreground)
                .strikethrough(task.isDone)
                .lineLimit(wide ? 1 : 2)
                .multilineTextAlignment(.leading)
            if task.isSubtask, wide, let parent = task.parent?.title, !parent.isEmpty {
                Text("· \(parent)").font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            if task.hasQuest { QuestXPChip(xp: task.questXP) }
        }
    }
}

// MARK: - Project page chrome

/// A header action: an icon on the phone, icon + words on iPad / Mac (web "Project settings", "Add task").
/// `prominent` is the web's dark filled button.
struct ProjectHeaderButton: View {
    let title: String
    let icon: String
    var labelled = false
    var prominent = false
    var enabled = true
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            face
                .foregroundStyle(prominent ? NX.background : NX.foreground)
                .background(prominent ? NX.foreground : NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(prominent ? Color.clear : NX.border))
                .opacity(enabled ? 1 : 0.45)
                .frame(minWidth: 44, minHeight: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.lift)
        .disabled(!enabled)
        .accessibilityLabel(title)
    }

    @ViewBuilder private var face: some View {
        if labelled {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 13, weight: .semibold))
                Text(title).font(NXFont.text(14, .semibold)).lineLimit(1)
            }
            .padding(.horizontal, 12).frame(height: 36)
        } else {
            Image(systemName: icon).font(.system(size: 15, weight: .semibold)).frame(width: 36, height: 36)
        }
    }
}

/// One tab of the project's tab row: icon + label, a soft fill when it is the one on screen.
struct ProjectTabChip: View {
    let title: String
    let icon: String
    let on: Bool
    var filtered = false
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon).font(.system(size: 12, weight: .medium))
                Text(title).font(NXFont.text(14, on ? .semibold : .regular)).lineLimit(1)
                if filtered {
                    Circle().fill(NX.violet).frame(width: 5, height: 5)
                }
            }
            .foregroundStyle(on ? NX.foreground : NX.mutedFg)
            .padding(.horizontal, 10).frame(height: 32)
            .background(on ? NX.muted : Color.clear, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .hoverEffect(.highlight)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
