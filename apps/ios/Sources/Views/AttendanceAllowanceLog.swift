import SwiftUI

/// The web's DayOffLogModal (attendance.tsx): what the Days off and Public holidays cards counted this
/// period, opened from the cards' "See how your days off were used" / "See public holidays used" line
/// (decision 11 of run 20, R20-I-11 / R20-B-18). The cron's own late penalties belong here, because the
/// "N/4 used" on the card counts them: the list asks for them (`includeAutoDeductions=1`).
struct AttendanceAllowanceLogSheet: View {
    enum Kind: String, Identifiable {
        case dayOff = "DAY_OFF", holiday = "RED_DATE"
        var id: String { rawValue }
    }

    let kind: Kind
    @Environment(\.dismiss) private var dismiss
    @State private var rows: [AttendanceRequest]?
    @State private var failed = false

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    Text(kind == .dayOff ? T("Days off and deductions (late >120 min) this period") : T("Public holidays used this period"))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                    (Text(T("Current period:")) + Text(verbatim: " ") + Text(Self.periodLabel).bold())
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    content
                }
                .padding(20)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(kind == .dayOff ? T("Day-off log") : T("Public holiday log"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Close")) { dismiss() }
                }
                .nxPlainOnMac()
            }
        }
        .presentationDetents([.medium, .large])
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if let rows {
            if rows.isEmpty {
                EmptyState(icon: kind == .dayOff ? "sparkles" : "calendar",
                           title: kind == .dayOff ? T("No days off used yet") : T("No public holidays used yet"),
                           subtitle: String(format: kind == .dayOff ? T("Days off you take from %@ show up here.") : T("Public holidays you use from %@ show up here."), Self.periodLabel),
                           compact: true)
            } else {
                ForEach(rows) { r in row(r) }
            }
        } else if failed {
            ErrorState(message: T("Couldn't load the attendance record.")) { Task { await load() } }
        } else {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 24)
        }
    }

    private func row(_ r: AttendanceRequest) -> some View {
        let start = AgendaRange.dayKey(r.startDate ?? "")
        let end = AgendaRange.dayKey(r.endDate ?? "")
        let range = !end.isEmpty && end != start ? "\(AgendaRange.dayLabel(start)) – \(AgendaRange.dayLabel(end))" : AgendaRange.dayLabel(start)
        let auto = (r.reason ?? "").hasPrefix("Auto:")
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 8) {
                Text(range).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Spacer(minLength: 8)
                if kind == .dayOff {
                    NexusChip(text: auto ? T("Auto · late >120m") : T("Manual"), tone: auto ? .danger : .success)
                }
            }
            if let reason = r.reason, !reason.isEmpty {
                Text(Self.reasonText(reason)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Text("\(T("Status")): \(AttendanceView.humanize(r.status ?? ""))")
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
        .accessibilityElement(children: .combine)
    }

    private func load() async {
        failed = false
        do {
            let all = try await APIClient.shared.attendanceRequests(scope: "me", includeAutoDeductions: true)
            let (from, to) = Self.periodKeys
            rows = all.filter { ($0.type ?? "").uppercased() == kind.rawValue }
                .filter { let d = AgendaRange.dayKey($0.startDate ?? ""); return d >= from && d <= to }
                .sorted { ($0.startDate ?? "") > ($1.startDate ?? "") }
        } catch {
            if rows == nil { failed = true }
        }
    }

    /// The current payroll period, 28th of last month to the 27th (past the 27th it is next month's), as the web.
    static var periodKeys: (String, String) {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "Asia/Jakarta") ?? .current
        let now = Date()
        let c = cal.dateComponents([.year, .month, .day], from: now)
        let endMonth = cal.date(from: DateComponents(year: c.year, month: (c.month ?? 1) + ((c.day ?? 1) > 27 ? 1 : 0), day: 27)) ?? now
        let start = cal.date(byAdding: DateComponents(month: -1, day: 1), to: endMonth) ?? now
        let f = DateFormatter()
        f.calendar = cal; f.timeZone = cal.timeZone; f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
        return (f.string(from: start), f.string(from: endMonth))
    }

    static var periodLabel: String {
        let (from, to) = periodKeys
        return "\(AgendaRange.dayLabel(from)) – \(AgendaRange.dayLabel(to))"
    }

    /// The nightly job's Indonesian reason in the app's language (web attendanceReasonText).
    static func reasonText(_ reason: String) -> String {
        let r = reason.trimmingCharacters(in: .whitespaces)
        for (pattern, key) in [(#"^Auto: telat >120 menit pada (\d{4}-\d{2}-\d{2}) \(potong jatah day-off\)$"#,
                                "Automatic: more than 120 min late on %@ (taken from the day-off allowance)"),
                               (#"^Auto: tidak check-in/out pada (\d{4}-\d{2}-\d{2}) \(potong jatah day-off\)$"#,
                                "Automatic: no check-in or check-out on %@ (taken from the day-off allowance)")] {
            if let re = try? NSRegularExpression(pattern: pattern),
               let m = re.firstMatch(in: r, range: NSRange(r.startIndex..., in: r)),
               let g = Range(m.range(at: 1), in: r) {
                return String(format: T(key), AgendaRange.dayLabel(String(r[g])))
            }
        }
        if r == "Auto: telat >120 menit" { return T("Automatic: more than 120 min late") }
        return reason
    }
}
