import SwiftUI

struct GideonActionCard: View {
    let proposal: GideonProposal
    let action: GideonToolAction
    var readOnly = false
    let onApply: () -> Void
    let onDiscard: () -> Void
    private var pending: Bool { proposal.isPending && !readOnly }
    @Environment(AppRouter.self) private var router
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(T(action.title), systemImage: action.icon).font(NXFont.text(14, .semibold))
            if let summary = proposal.summary { Text(summary).font(NXFont.text(13)).textSelection(.enabled) }
            if pending { Label(T("Waiting for your approval"), systemImage: "circle.fill").font(NXFont.text(12)).foregroundStyle(NX.warning) }
            ForEach(Array((proposal.diff ?? []).enumerated()), id: \.offset) { _, row in
                if row.to?.text != proposal.extra?.preview || proposal.extra?.preview == nil {
                    HStack(alignment: .top, spacing: 10) {
                        Text(T(row.field ?? "")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).frame(width: 96, alignment: .leading)
                        VStack(alignment: .leading, spacing: 4) {
                            if let from = row.from?.text, !from.isEmpty {
                                Text(value(from, day: row.fromDay)).strikethrough().foregroundStyle(NX.danger)
                            }
                            Text(value(row.to?.text ?? "—", day: row.toDay)).foregroundStyle(NX.foreground)
                        }.font(NXFont.text(13)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                }
            }
            if let preview = proposal.extra?.preview, !preview.isEmpty {
                ScrollView { Text(preview).font(NXFont.text(13)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(10) }
                    .frame(maxHeight: 256).background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
            }
            if let edit = proposal.extra?.sheetEdit { sheetDiff(edit) }
            if let error = proposal.error, !error.isEmpty { Text(error).font(NXFont.text(12)).foregroundStyle(NX.danger).textSelection(.enabled) }
            if pending {
                Text(String(format: T("Nothing happens until you tap %@. Times are WIB."), T(action.apply))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                HStack {
                    Spacer()
                    Button(T("Discard"), action: onDiscard).buttonStyle(.nxBordered)
                    Button(T(action.apply), action: onApply).buttonStyle(.borderedProminent).tint(action.destructive ? NX.danger : NX.onyx)
                }
            } else {
                Text(proposal.status == "APPLIED" && !readOnly ? T(action.done) : gideonProposalState(proposal, readOnly: readOnly))
                    .font(NXFont.text(12, .medium)).foregroundStyle(proposal.status == "FAILED" ? NX.danger : NX.mutedFg)
                if proposal.status == "APPLIED" {
                    if let link = proposal.extra?.link {
                        Button(T("Open")) { if let url = URL(string: link, relativeTo: Config.baseURL)?.absoluteURL { router.open(url) } }
                    }
                    if let note = proposal.extra?.note { Text(note).font(NXFont.text(12)).textSelection(.enabled) }
                }
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(pending ? NX.warning.opacity(0.5) : NX.border))
        .accessibilityIdentifier("gideon.action." + proposal.id)
    }
    private func value(_ text: String, day: String?) -> String {
        guard let day, NotificationTarget.calendarDay(day) != nil else { return ServerText.enumWord(T(text)) }
        let date = AppDateLocale.formatter("EEE d MMM", timeZone: TimeZone(secondsFromGMT: 0)).string(from: CalDays.date(day))
        // to may contain either a human clock or an ISO instant. Interpret ISO clocks in WIB.
        if text.contains("T"), let instant = TaskDates.parse(text) {
            return date + " · " + AppDateLocale.formatter("HH:mm", timeZone: TimeZone(identifier: "Asia/Jakarta")).string(from: instant)
        }
        if let range = text.range(of: #"\b\d{2}:\d{2}\b"#, options: .regularExpression) { return date + " · " + text[range] }
        return date
    }
    private func sheetDiff(_ edit: GideonActionExtra.SheetEdit) -> some View {
        ScrollView([.vertical, .horizontal]) {
            Grid(alignment: .leading, horizontalSpacing: 14, verticalSpacing: 8) {
                GridRow { Text(T("Cell")); Text(T("Before")); Text(T("After")) }.font(NXFont.text(12, .semibold))
                ForEach(Array((edit.cells ?? []).enumerated()), id: \.offset) { _, cell in
                    GridRow {
                        Text(cell.ref)
                        Text(cell.from?.text ?? "—").strikethrough().foregroundStyle(NX.danger)
                        Text(cell.to?.text ?? "—").foregroundStyle(NX.success)
                    }.font(NXFont.text(13)).textSelection(.enabled)
                }
            }.padding(10)
        }.frame(maxHeight: 256).background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
    }
}
