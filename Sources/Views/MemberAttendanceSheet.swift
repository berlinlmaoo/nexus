import SwiftUI

/// Per-member attendance admin: personal shift (default + per-weekday) and day-off quota/grant.
/// Mirrors the web Control Room ShiftCell + DayoffModal. BoD+ gated by the backend.
struct MemberAttendanceSheet: View {
    let member: WorkspaceRoster.Member
    let workspaceId: String?
    let month: String
    @Environment(AuthStore.self) private var auth

    // shift
    @State private var useCustom = false
    @State private var startTime = ShiftClock.date("09:00")
    @State private var endTime = ShiftClock.date("18:00")
    @State private var dayEnabled: [Int: Bool] = [:]
    @State private var dayStart: [Int: Date] = [:]
    @State private var dayEnd: [Int: Date] = [:]
    @State private var savingShift = false
    @State private var shiftSaved = false

    // day-off
    @State private var dayoff: DayoffsResponse?
    @State private var quotaText = ""
    @State private var grantDate = Date()
    @State private var busyDayoff = false

    private var overnight: Bool { ShiftClock.hhmm(startTime) > ShiftClock.hhmm(endTime) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                shiftCard
                dayoffCard
            }
            .padding(16)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle("Atur Absensi").navigationBarTitleDisplayMode(.inline)
        .onAppear(perform: hydrate)
        .task { await loadDayoff() }
    }

    private var header: some View {
        HStack(spacing: 12) {
            AvatarView(url: member.avatarURL, initial: member.initial, size: 46)
            VStack(alignment: .leading, spacing: 3) {
                Text(member.displayName).font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                if let e = member.emailText { Text(e).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
            }
            Spacer()
            RoleChip(role: member.role ?? "STAFF")
        }
    }

    // MARK: shift

    private var shiftCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("SHIFT KERJA")
            Toggle(isOn: $useCustom) {
                VStack(alignment: .leading, spacing: 1) {
                    Text("Pakai shift khusus").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    Text(useCustom ? T("Different from the team/office shift") : "Ikut shift default tim/kantor").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }.tint(NX.violet)

            if useCustom {
                HStack(spacing: 12) {
                    timeField("Masuk", $startTime)
                    timeField("Keluar", $endTime)
                }
                if overnight {
                    Label("Shift lewat tengah malam 🌙", systemImage: "moon.stars.fill")
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.blue)
                }
                weekdaySection
            }

            if let wsId = workspaceId, !wsId.isEmpty {
                Button { Task { await saveShift(workspaceId: wsId) } } label: {
                    Text(savingShift ? "Menyimpan…" : (shiftSaved ? "Tersimpan ✓" : T("Save shift"))).font(NXFont.text(14, .bold))
                }.buttonStyle(NexusPrimaryButton()).disabled(savingShift)
            } else {
                Text(T("Workspace not loaded yet — try reopening.")).font(NXFont.text(11)).foregroundStyle(NX.warning)
            }
        }
        .padding(16)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
    }

    private func timeField(_ label: String, _ binding: Binding<Date>) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
            DatePicker("", selection: binding, displayedComponents: .hourAndMinute)
                .labelsHidden().datePickerStyle(.compact)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }

    private var weekdaySection: some View {
        DisclosureGroup {
            VStack(spacing: 8) {
                ForEach(1...7, id: \.self) { d in
                    HStack(spacing: 10) {
                        Text(weekdayNames[d - 1]).font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground).frame(width: 34, alignment: .leading)
                        Toggle("", isOn: Binding(get: { dayEnabled[d] ?? false }, set: { dayEnabled[d] = $0 })).labelsHidden().tint(NX.violet)
                        if dayEnabled[d] == true {
                            DatePicker("", selection: Binding(get: { dayStart[d] ?? startTime }, set: { dayStart[d] = $0 }), displayedComponents: .hourAndMinute).labelsHidden().datePickerStyle(.compact)
                            DatePicker("", selection: Binding(get: { dayEnd[d] ?? endTime }, set: { dayEnd[d] = $0 }), displayedComponents: .hourAndMinute).labelsHidden().datePickerStyle(.compact)
                        } else {
                            Text("ikut default").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            Spacer()
                        }
                    }
                }
            }.padding(.top, 6)
        } label: {
            Text(T("Per-day override (optional)")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.violet)
        }
    }

    // MARK: day-off

    private var dayoffCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel("\(T("DAY-OFF ALLOWANCE")) — \(MonthKey.label(month))")
            if let d = dayoff {
                HStack {
                    Text(T("Used this month")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    Spacer()
                    Text("\(d.used ?? 0) / \(d.quota ?? 0) \(T("days"))").font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                }
                quotaEditor(d)
                Divider().overlay(NX.border)
                grantRow
                ForEach(d.dayoffs ?? []) { dayoffRow($0) }
            } else {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity).padding(.vertical, 10)
            }
        }
        .padding(16)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
    }

    private func quotaEditor(_ d: DayoffsResponse) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(T("Allowance / month")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            HStack(spacing: 10) {
                TextField("\(d.defaultQuota ?? 4)", text: $quotaText).keyboardType(.numberPad).font(NXFont.text(15, .bold))
                    .frame(width: 64).padding(8).background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                Button { Task { await saveQuota(Int(quotaText)) } } label: { Text(T("Save")).font(NXFont.text(13, .bold)) }
                    .buttonStyle(NexusPrimaryButton(fullWidth: false)).disabled(busyDayoff)
                if d.quotaOverride != nil {
                    Button { Task { await saveQuota(nil) } } label: {
                        Text("Reset (\(d.defaultQuota ?? 4))").font(NXFont.text(12, .semibold)).foregroundStyle(NX.violet)
                    }.disabled(busyDayoff)
                }
            }
            Text(d.quotaOverride != nil ? "\(T("Custom")): \(d.quotaOverride!) \(T("days")) (default \(d.defaultQuota ?? 4))." : "\(T("Using the workspace default")) (\(d.defaultQuota ?? 4) \(T("days"))).")
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
    }

    private var grantRow: some View {
        HStack(spacing: 10) {
            DatePicker("", selection: $grantDate, displayedComponents: .date).labelsHidden().datePickerStyle(.compact)
            Spacer()
            Button { Task { await grant() } } label: {
                Label(busyDayoff ? "…" : "Kasih day-off", systemImage: "gift.fill").font(NXFont.text(13, .bold))
            }.buttonStyle(NexusPrimaryButton(fullWidth: false)).disabled(busyDayoff)
        }
    }

    private func dayoffRow(_ d: Dayoff) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "calendar.badge.checkmark").font(.system(size: 13)).foregroundStyle(NX.success)
                .frame(width: 30, height: 30).background(NX.success.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(AgendaRange.dayLabel(AgendaRange.dayKey(d.startDate ?? ""))).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                if let r = d.reason, !r.isEmpty { Text(r).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            Spacer(minLength: 4)
            NexusChip(text: (d.status ?? "").capitalized, tone: d.status == "APPROVED" ? .success : .neutral)
            Button { Task { await removeDayoff(d) } } label: {
                Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(NX.danger)
            }.disabled(busyDayoff)
        }
        .padding(.vertical, 3)
    }

    // MARK: logic

    private func hydrate() {
        if let s = member.attendanceShiftStartTime, let e = member.attendanceShiftEndTime, !s.isEmpty, !e.isEmpty {
            useCustom = true; startTime = ShiftClock.date(s); endTime = ShiftClock.date(e)
        }
        for (k, v) in member.attendanceShiftByDay ?? [:] {
            guard let d = Int(k), (1...7).contains(d) else { continue }
            dayEnabled[d] = true
            if let st = v.start { dayStart[d] = ShiftClock.date(st) }
            if let en = v.end { dayEnd[d] = ShiftClock.date(en) }
        }
    }

    private func saveShift(workspaceId wsId: String) async {
        guard let memberId = member.id else { return }
        savingShift = true; shiftSaved = false
        var byDay: [String: [String: String]] = [:]
        for d in 1...7 where dayEnabled[d] == true {
            byDay[String(d)] = ["start": ShiftClock.hhmm(dayStart[d] ?? startTime), "end": ShiftClock.hhmm(dayEnd[d] ?? endTime)]
        }
        let ok = (try? await APIClient.shared.setAttendanceShift(
            memberId: memberId, workspaceId: wsId,
            start: useCustom ? ShiftClock.hhmm(startTime) : nil,
            end: useCustom ? ShiftClock.hhmm(endTime) : nil,
            byDay: byDay)) != nil
        savingShift = false; shiftSaved = ok
    }

    private func loadDayoff() async {
        guard let uid = member.userId else { return }
        dayoff = try? await APIClient.shared.dayoffs(userId: uid, month: month)
        quotaText = dayoff?.quotaOverride.map(String.init) ?? ""
    }
    private func saveQuota(_ q: Int?) async {
        guard let uid = member.userId, let wsId = workspaceId else { return }
        busyDayoff = true
        try? await APIClient.shared.setDayoffQuota(userId: uid, quota: q, workspaceId: wsId)
        await loadDayoff(); busyDayoff = false
    }
    private func grant() async {
        guard let uid = member.userId else { return }
        busyDayoff = true
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        try? await APIClient.shared.grantDayoff(userId: uid, date: f.string(from: grantDate), reason: nil)
        await loadDayoff(); busyDayoff = false
    }
    private func removeDayoff(_ d: Dayoff) async {
        busyDayoff = true
        try? await APIClient.shared.deleteDayoff(id: d.id)
        await loadDayoff(); busyDayoff = false
    }
}
