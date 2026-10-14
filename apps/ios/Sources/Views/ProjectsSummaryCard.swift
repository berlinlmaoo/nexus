import SwiftUI

/// The summary card at the top of the web's Projects page (projects/index.tsx), on the iPhone too (UI tour
/// 13 Oct 2026): "N of M projects", the three numbers (average progress, tasks done, members) and the
/// Filters row (status filter + sort). Was only a "97 projects visible" chip.
/// One choice in the summary card's Filters / Sort menus (English label, translated where drawn).
struct ProjectsMenuOption: Identifiable {
    let value: String
    let label: String
    var id: String { value }
}

struct ProjectsSummaryCard: View {
    let shown: Int
    let total: Int
    let progressText: String
    let doneText: String
    let members: String
    @Binding var statusFilter: String
    @Binding var sortMode: String
    let statusOptions: [ProjectsMenuOption]
    let sortOptions: [ProjectsMenuOption]
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 6) {
                Image(systemName: "sparkles").font(.system(size: 12, weight: .semibold))
                Text(String(format: T(total == 1 ? "%d of %d project" : "%d of %d projects"), shown, total))
                    .font(NXFont.text(13, .semibold))
            }
            .foregroundStyle(NX.foreground)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(NX.muted, in: Capsule())
            // The web's line under the count on a wide screen (it is hidden on the phone there too; UI tour
            // run 14, P-I19).
            if hSize == .regular {
                Text(T("Open a project to see its board, pages, calendar and timeline."))
                    .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }

            HStack(spacing: 8) {
                stat(icon: "target", value: progressText, label: T("Average progress"))
                stat(icon: "checkmark.circle", value: doneText, label: T("Tasks done"))
                stat(icon: "person.2", value: members, label: T("Members"))
            }

            Rectangle().fill(NX.border).frame(height: 1)

            HStack(spacing: 8) {
                Label(T("Filters"), systemImage: "slider.horizontal.3")
                    .font(NXFont.text(13))
                    .foregroundStyle(NX.mutedFg)
                pill(selection: $statusFilter, options: statusOptions, accessibility: T("Filters"))
                pill(selection: $sortMode, options: sortOptions, accessibility: T("Sort by"))
                Spacer(minLength: 0)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(NX.border))
    }

    private func stat(icon: String, value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: icon).font(.system(size: 14, weight: .medium)).foregroundStyle(NX.foreground)
            Text(value).font(NXFont.text(18, .semibold)).foregroundStyle(NX.foreground).monospacedDigit()
            Text(label).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1).minimumScaleFactor(0.8)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.background.opacity(0.8), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
        .accessibilityElement(children: .combine)
    }

    private func pill(selection: Binding<String>, options: [ProjectsMenuOption], accessibility: String) -> some View {
        let current = options.first { $0.value == selection.wrappedValue }?.label ?? options.first?.label ?? ""
        return Menu {
            Picker(accessibility, selection: selection) {
                ForEach(options) { option in
                    Text(T(option.label)).tag(option.value)
                }
            }
        } label: {
            HStack(spacing: 4) {
                Text(T(current)).font(NXFont.text(13)).lineLimit(1)
                Image(systemName: "chevron.down").font(.system(size: 10, weight: .semibold))
            }
            .foregroundStyle(NX.foreground)
            .padding(.horizontal, 10).padding(.vertical, 6)
            .background(NX.background, in: Capsule())
            .overlay(Capsule().strokeBorder(NX.border))
        }
        .accessibilityLabel(accessibility)
    }
}
