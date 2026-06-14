import SwiftUI

// MARK: - models (attendance admin)

struct DayoffsResponse: Decodable, Sendable {
    let month: String?
    let quota: Int?
    let quotaOverride: Int?
    let defaultQuota: Int?
    let used: Int?
    let dayoffs: [Dayoff]?
}
struct Dayoff: Decodable, Identifiable, Sendable {
    let id: String
    let startDate: String?
    let status: String?
    let reason: String?
}
struct RedDateQuotaInfo: Decodable, Sendable {
    let month: String?
    let quota: Int?
    let canManage: Bool?
}
struct HolidaysResponse: Decodable, Sendable {
    let month: String?
    let canManage: Bool?
    let holidays: [Holiday]?
}
struct Holiday: Decodable, Identifiable, Sendable {
    let id: String
    let date: String?
    let name: String?
}

// MARK: - helpers

enum MonthKey {
    private static var fmt: DateFormatter {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM"; f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "Asia/Jakarta"); return f
    }
    static func current() -> String { fmt.string(from: Date()) }
    static func shift(_ key: String, by months: Int) -> String {
        guard let d = fmt.date(from: key) else { return key }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = TimeZone(identifier: "Asia/Jakarta")!
        return fmt.string(from: cal.date(byAdding: .month, value: months, to: d) ?? d)
    }
    static func label(_ key: String) -> String {
        guard let d = fmt.date(from: key) else { return key }
        let out = DateFormatter(); out.dateFormat = "MMMM yyyy"; out.locale = Locale(identifier: "id_ID"); return out.string(from: d)
    }
}

/// "HH:mm" wall-clock ↔ Date (timezone-agnostic; only hour/minute matter).
enum ShiftClock {
    private static var fmt: DateFormatter {
        let f = DateFormatter(); f.dateFormat = "HH:mm"; f.locale = Locale(identifier: "en_US_POSIX"); return f
    }
    static func date(_ hhmm: String?) -> Date { fmt.date(from: hhmm ?? "09:00") ?? fmt.date(from: "09:00")! }
    static func hhmm(_ d: Date) -> String { fmt.string(from: d) }
}

let weekdayNames = ["Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min"]  // ISO 1…7

// MARK: - Absensi section (Control Room segment)

struct AttendanceAdminSection: View {
    let workspaceId: String?
    @Environment(AuthStore.self) private var auth

    @State private var month = MonthKey.current()
    @State private var members: [WorkspaceRoster.Member] = []
    @State private var viewerRole: String?
    @State private var wsId: String?
    @State private var loading = true

    private var allowed: Bool { viewerRole == "BOD" || viewerRole == "ONE_ABOVE_ALL" }
    private var effectiveWsId: String? { workspaceId ?? wsId }

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if !allowed {
                EmptyState(icon: "lock.fill", title: "Khusus BoD ke atas",
                           subtitle: "Pengaturan shift, jatah libur & tanggal merah cuma bisa diatur BoD / One Above All.")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        monthBar
                        RedDateCard(month: month)
                        membersCard
                    }
                    .padding(16)
                }
            }
        }
        .task { await load() }
    }

    private var monthBar: some View {
        HStack {
            Button { month = MonthKey.shift(month, by: -1) } label: { Image(systemName: "chevron.left").font(.system(size: 14, weight: .bold)) }
            Spacer()
            Text(MonthKey.label(month)).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
            Spacer()
            Button { month = MonthKey.shift(month, by: 1) } label: { Image(systemName: "chevron.right").font(.system(size: 14, weight: .bold)) }
        }
        .foregroundStyle(NX.violet)
        .padding(.horizontal, 14).frame(height: 44)
        .background(NX.card, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
    }

    private var membersCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("SHIFT & JATAH LIBUR").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg).padding(.leading, 4)
            VStack(spacing: 0) {
                ForEach(Array(members.enumerated()), id: \.element.idv) { idx, m in
                    if idx > 0 { Divider().overlay(NX.border) }
                    NavigationLink {
                        MemberAttendanceSheet(member: m, workspaceId: effectiveWsId, month: month)
                    } label: { memberRow(m) }.buttonStyle(.plain)
                }
            }
            .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
        }
    }

    private func memberRow(_ m: WorkspaceRoster.Member) -> some View {
        HStack(spacing: 12) {
            AvatarView(url: m.avatarURL, initial: m.initial, size: 38)
            VStack(alignment: .leading, spacing: 2) {
                Text(m.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                HStack(spacing: 6) {
                    if let s = m.shiftLabel {
                        Label(s, systemImage: "clock.fill").font(NXFont.text(11, .semibold)).foregroundStyle(NX.violet)
                    } else {
                        Text("Shift default").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                    if let bd = m.attendanceShiftByDay, !bd.isEmpty {
                        Text("· \(bd.count) hari custom").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                }
            }
            Spacer(minLength: 6)
            RoleChip(role: m.role ?? "STAFF")
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg.opacity(0.5))
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
    }

    private func load() async {
        do {
            let r = try await APIClient.shared.roster()
            members = r.members ?? []
            viewerRole = r.role
            wsId = r.workspaceId
        } catch APIError.unauthorized { auth.logout() } catch {}
        loading = false
    }
}

// MARK: - Tanggal Merah (red-date quota + holidays, workspace-wide for the month)

struct RedDateCard: View {
    let month: String
    @State private var quota = 0
    @State private var holidays: [Holiday] = []
    @State private var canManage = false
    @State private var loading = true
    @State private var savingQuota = false
    @State private var adding = false
    @State private var newDate = Date()
    @State private var newName = ""
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("TANGGAL MERAH — \(MonthKey.label(month))").font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)

            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity).padding(.vertical, 12)
            } else {
                quotaRow
                Divider().overlay(NX.border)
                holidaysList
            }
        }
        .padding(16)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
        .task(id: month) { await load() }
    }

    private var quotaRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Jatah / staff bulan ini").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            Stepper(value: $quota, in: 0...31) {
                Text("\(quota) hari").font(NXFont.text(15, .bold)).foregroundStyle(NX.violet)
            }
            Button { Task { await saveQuota() } } label: {
                Text(savingQuota ? "Menyimpan…" : "Simpan jatah").font(NXFont.text(14, .bold))
            }.buttonStyle(NexusPrimaryButton()).disabled(savingQuota)
            if quota == 0 {
                Text("Jatah masih 0 — staff belum bisa ajuin tanggal merah bulan ini sampai diisi.")
                    .font(NXFont.text(11)).foregroundStyle(NX.warning)
            }
        }
    }

    private var holidaysList: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Hari libur / tanggal merah").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                Spacer()
                Button { withAnimation { adding.toggle() } } label: {
                    Label(adding ? "Tutup" : "Tambah", systemImage: adding ? "xmark" : "plus")
                        .font(NXFont.text(12, .bold)).foregroundStyle(NX.violet)
                }
            }
            if adding { addForm }
            if holidays.isEmpty && !adding {
                Text("Belum ada tanggal merah di bulan ini.").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            ForEach(holidays) { h in holidayRow(h) }
        }
    }

    private var addForm: some View {
        VStack(alignment: .leading, spacing: 8) {
            DatePicker("Tanggal", selection: $newDate, displayedComponents: .date)
                .datePickerStyle(.compact).font(NXFont.text(13))
            TextField("Nama (mis. Hari Raya Idul Adha)", text: $newName).font(NXFont.text(14))
                .padding(10).background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            Button { Task { await addHoliday() } } label: {
                Text(busy ? "Menyimpan…" : "Simpan tanggal merah").font(NXFont.text(13, .bold))
            }.buttonStyle(NexusPrimaryButton()).disabled(busy || newName.trimmingCharacters(in: .whitespaces).isEmpty)
        }
        .padding(12).background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func holidayRow(_ h: Holiday) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "calendar").font(.system(size: 13)).foregroundStyle(NX.danger)
                .frame(width: 30, height: 30).background(NX.danger.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text(h.name ?? "—").font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                Text(AgendaRange.dayLabel(h.date ?? "")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 4)
            Button { Task { await deleteHoliday(h) } } label: {
                Image(systemName: "trash").font(.system(size: 13)).foregroundStyle(NX.danger)
            }.disabled(busy)
        }
        .padding(.vertical, 4)
    }

    private func load() async {
        loading = true
        async let q = try? APIClient.shared.redDateQuota(month: month)
        async let h = try? APIClient.shared.holidays(month: month)
        if let q = await q { quota = q.quota ?? 0; canManage = q.canManage ?? false }
        if let h = await h { holidays = h.holidays ?? [] }
        loading = false
    }
    private func saveQuota() async {
        savingQuota = true
        try? await APIClient.shared.setRedDateQuota(month: month, quota: quota)
        savingQuota = false
    }
    private func addHoliday() async {
        busy = true
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.locale = Locale(identifier: "en_US_POSIX")
        let ds = f.string(from: newDate)
        if (try? await APIClient.shared.addHoliday(date: ds, name: newName.trimmingCharacters(in: .whitespaces))) != nil {
            newName = ""; adding = false; await load()
        }
        busy = false
    }
    private func deleteHoliday(_ h: Holiday) async {
        busy = true
        try? await APIClient.shared.deleteHoliday(id: h.id)
        await load()
        busy = false
    }
}
