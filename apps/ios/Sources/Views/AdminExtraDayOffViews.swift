import SwiftUI

// MARK: - Extra day off models
//
// Wire shapes of /api/attendance/day-off-bonus (server lib/day-off-bonus-serialize.ts). Everything
// the screen can live without is optional, so a field the server stops sending costs a label, not
// the whole list.

struct DayOffBonusGrant: Decodable, Identifiable, Sendable {
    let id: String
    let userId: String
    let user: Person?
    let periodKey: String?
    let days: Int
    let reason: String?
    let createdAt: String?
    let grantedBy: Actor?
    let revokedAt: String?
    let revokedBy: Actor?
    let active: Bool?

    struct Person: Decodable, Sendable { let id: String?; let name: String?; let email: String?; let avatar: String? }
    struct Actor: Decodable, Sendable { let id: String?; let name: String? }

    /// `active` is the server's word; a revoke timestamp is the fallback for a body without it.
    var isActive: Bool { active ?? (revokedAt == nil) }
    var displayName: String {
        if let n = user?.name, !n.isEmpty { return n }
        return user?.email ?? "—"
    }
    var initial: String { String(displayName.first ?? "?").uppercased() }
}

/// GET /api/attendance/day-off-bonus?periodKey=
struct DayOffBonusList: Decodable, Sendable {
    let periodKey: String
    let periodLabel: String?
    let currentPeriodKey: String?
    let canManage: Bool?
    let grantablePeriods: [Period]?
    let grants: [DayOffBonusGrant]?

    struct Period: Decodable, Sendable, Identifiable {
        let periodKey: String
        let periodLabel: String?
        var id: String { periodKey }
    }
}

/// POST /api/attendance/day-off-bonus → 201
struct DayOffBonusCreated: Decodable, Sendable {
    let periodKey: String?
    let periodLabel: String?
    let days: Int?
    let notified: Int?
    let grants: [DayOffBonusGrant]?
}

/// DELETE /api/attendance/day-off-bonus/:id
struct DayOffBonusRevoked: Decodable, Sendable {
    let grant: DayOffBonusGrant?
    let alreadyRevoked: Bool?
}

// MARK: - Control Room → Extra day off

/// Extra day off (owner, 28 Sep 2026): the BoD gives selected people X extra day-off days that count
/// in ONE attendance period (28th → 27th) only — e.g. after working a 3-day event. Unused days expire
/// with the period, each person gets a push, and a grant can be revoked while its period is open.
/// Mirrors ExtraDayOffAdmin on the web Control Room. BoD / One Above All only; the server re-checks.
struct AdminExtraDayOffSection: View {
    @Environment(AuthStore.self) private var auth
    @State private var viewer = Viewer.shared

    @State private var list: DayOffBonusList?
    @State private var loading = true
    @State private var loadError: String?
    @State private var periodKey: String?
    @State private var members: [WorkspaceRoster.Member] = []

    @State private var search = ""
    @State private var selected: Set<String> = []
    @State private var days = 1
    @State private var reason = ""
    @FocusState private var searchFocused: Bool

    @State private var busy = false
    @State private var notice: String?
    @State private var problem: String?
    /// The ONE confirmation this view presents. Grant and revoke share it on purpose: two
    /// presentations attached to the same view is the pattern that leaves one of them dead.
    @State private var pending: Pending?

    private enum Pending: Identifiable {
        case grant
        case revoke(DayOffBonusGrant)
        var id: String {
            switch self {
            case .grant: return "grant"
            case .revoke(let g): return "revoke-\(g.id)"
            }
        }
    }

    private static let reasonMax = 200

    // A–Z, locale-aware, like the Users tab. Rows without a userId cannot be granted anything.
    private var sortedMembers: [WorkspaceRoster.Member] {
        members.filter { $0.userId != nil }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
    }
    private var shownMembers: [WorkspaceRoster.Member] {
        let q = search.trimmingCharacters(in: .whitespaces).lowercased()
        guard !q.isEmpty else { return sortedMembers }
        return sortedMembers.filter { $0.displayName.lowercased().contains(q) || ($0.emailText ?? "").lowercased().contains(q) }
    }
    private var periods: [DayOffBonusList.Period] { list?.grantablePeriods ?? [] }
    private var trimmedReason: String { reason.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var reasonValid: Bool { (3...Self.reasonMax).contains(trimmedReason.count) }
    private var canSubmit: Bool { periodKey != nil && !selected.isEmpty && selected.count <= 200 && (1...31).contains(days) && reasonValid && !busy }
    private var grants: [DayOffBonusGrant] {
        let all = list?.grants ?? []
        // Active first, then revoked — each keeps the server's newest-first order.
        return all.filter(\.isActive) + all.filter { !$0.isActive }
    }

    private func periodLabel(_ key: String?) -> String {
        guard let key else { return "" }
        return periods.first { $0.periodKey == key }?.periodLabel
            ?? (list?.periodKey == key ? list?.periodLabel : nil) ?? key
    }
    /// "YYYY-MM" sorts as text, so a plain comparison says which side of today a period sits on.
    private func periodTag(_ key: String) -> String {
        guard let current = list?.currentPeriodKey else { return "" }
        if key == current { return T("current") }
        return key < current ? T("previous") : T("next")
    }
    private static func dayWord(_ n: Int) -> String { n == 1 ? T("day") : T("days") }
    private static func peopleWord(_ n: Int) -> String { n == 1 ? T("person") : T("people") }

    var body: some View {
        Group {
            if loading && list == nil {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if list?.canManage == false || (list == nil && !viewer.isBoD) {
                EmptyState(icon: "lock.fill", title: T("Board and above only"),
                           subtitle: T("Only the board and One Above All can give extra day off. Ask one of them if someone has earned it."))
            } else if list == nil, let loadError {
                EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't load extra day off"), subtitle: loadError,
                           tint: NX.warning, actionTitle: T("Try again"), actionIcon: "arrow.clockwise",
                           action: { Task { await load() } })
            } else {
                content
            }
        }
        .task { await viewer.loadIfNeeded(); await load() }
        .alert(dialogTitle, isPresented: Binding(get: { pending != nil }, set: { if !$0 { pending = nil } }), presenting: pending) { p in
            switch p {
            case .grant:
                Button(T("Give extra day off")) { pending = nil; Task { await grant() } }
            case .revoke(let g):
                Button(T("Revoke"), role: .destructive) { pending = nil; Task { await revoke(g) } }
            }
            Button(T("Cancel"), role: .cancel) { pending = nil }
        } message: { p in
            Text(dialogMessage(p))
        }
    }

    private var dialogTitle: String {
        switch pending {
        case .grant: return T("Give extra day off?")
        case .revoke(let g): return String(format: T("Revoke %@'s extra day off?"), g.displayName)
        case nil: return ""
        }
    }

    private func dialogMessage(_ p: Pending) -> String {
        switch p {
        case .grant:
            let who: String
            if selected.count == 1, let m = sortedMembers.first(where: { selected.contains($0.userId ?? "") }) {
                who = m.displayName
            } else {
                who = "\(selected.count) \(Self.peopleWord(selected.count))"
            }
            return String(format: T("%@ · %d extra %@ off · period %@\n\nReason: %@\n\nEach person gets a notification. Unused days expire when the period ends."),
                          who, days, Self.dayWord(days), periodLabel(periodKey), trimmedReason)
        case .revoke(let g):
            return String(format: T("+%d %@ · %@\n\nDays already taken are not undone."), g.days, Self.dayWord(g.days), g.reason ?? "")
        }
    }

    // MARK: layout

    private var content: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(T("Give extra day off")).font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                        Text(T("Adds day-off days for one attendance period (28th → 27th) on top of each person's quota — e.g. after working an event. Unused days expire when the period ends. Missed check-ins are still deducted as usual."))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                    }

                    if let notice { banner(notice, tone: NX.success, icon: "checkmark.circle.fill") }
                    if let problem { banner(problem, tone: NX.danger, icon: "exclamationmark.triangle.fill") }

                    periodPicker
                    peoplePicker.id("picker")
                    daysAndReason
                    summaryBar

                    grantsList { withAnimation { proxy.scrollTo("picker", anchor: .top) }; searchFocused = true }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func banner(_ text: String, tone: Color, icon: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: icon).foregroundStyle(tone)
            Text(text).font(NXFont.text(13)).foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(tone.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var periodPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            SectionLabel(T("Period"))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(periods) { p in
                        let on = p.periodKey == periodKey
                        Button {
                            guard p.periodKey != periodKey else { return }
                            periodKey = p.periodKey
                            notice = nil; problem = nil
                            Task { await load() }
                        } label: {
                            Text("\(p.periodLabel ?? p.periodKey) · \(periodTag(p.periodKey))")
                                .font(NXFont.text(12, on ? .bold : .semibold))
                                .padding(.horizontal, 12).padding(.vertical, 7)
                                .nxChoiceChip(on: on)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var peoplePicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                SectionLabel(String(format: T("People · %d selected"), selected.count))
                Spacer()
                Button(T("Select shown")) {
                    selected.formUnion(shownMembers.compactMap(\.userId))
                }
                .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText).disabled(shownMembers.isEmpty)
                Button(T("Clear")) { selected.removeAll() }
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).disabled(selected.isEmpty)
            }
            .buttonStyle(.plain)

            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                TextField(T("Search name or email…"), text: $search)
                    .font(NXFont.text(14)).textInputAutocapitalization(.never).autocorrectionDisabled()
                    .focused($searchFocused)
                if !search.isEmpty {
                    Button { search = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg).touchTarget44(drawn: 20) }.buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 12).padding(.vertical, 9)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))

            // The chosen people stay visible while the search narrows the list below.
            if !selected.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(sortedMembers.filter { selected.contains($0.userId ?? "") }, id: \.idv) { m in
                            Button { toggle(m.userId) } label: {
                                HStack(spacing: 4) {
                                    Text(m.displayName).lineLimit(1)
                                    Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
                                }
                                .font(NXFont.text(11, .semibold)).foregroundStyle(NX.violetText)
                                .padding(.horizontal, 9).padding(.vertical, 5)
                                .background(NX.violet.opacity(0.12), in: Capsule())
                                .touchTarget44(drawn: 44, drawnHeight: 24)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(String(format: T("Remove %@"), m.displayName))
                        }
                    }
                }
            }

            // A bounded inner list, so fifty names do not push the grants off the bottom of the page.
            ScrollView {
                LazyVStack(spacing: 0) {
                    if shownMembers.isEmpty {
                        Text(String(format: T("No one matches “%@”."), search))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(14)
                    }
                    ForEach(Array(shownMembers.enumerated()), id: \.element.idv) { idx, m in
                        if idx > 0 { Divider().overlay(NX.border) }
                        memberRow(m)
                    }
                }
            }
            .frame(maxHeight: 300)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))
        }
    }

    private func memberRow(_ m: WorkspaceRoster.Member) -> some View {
        let on = selected.contains(m.userId ?? "")
        return Button { toggle(m.userId) } label: {
            HStack(spacing: 10) {
                Image(systemName: on ? "checkmark.circle.fill" : "circle")
                    .font(.system(size: 18)).foregroundStyle(on ? NX.violet : NX.mutedFg)
                AvatarView(url: m.avatarURL, initial: m.initial, size: 28)
                Text(m.displayName).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer(minLength: 6)
                if let r = m.role { RoleChip(role: r) }
            }
            .padding(.horizontal, 12).padding(.vertical, 8)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private var daysAndReason: some View {
        VStack(alignment: .leading, spacing: 10) {
            Stepper(value: $days, in: 1...31) {
                HStack(spacing: 6) {
                    SectionLabel(T("Days"))
                    Text("\(days)").font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                SectionLabel(T("Reason (required)"))
                TextField(T("e.g. Worked the 3-day Jakarta event"), text: $reason, axis: .vertical)
                    .font(NXFont.text(14)).lineLimit(1...4)
                    .padding(.horizontal, 12).padding(.vertical, 9)
                    .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                    .onChange(of: reason) { _, new in
                        if new.count > Self.reasonMax { reason = String(new.prefix(Self.reasonMax)) }
                    }
                HStack {
                    if !reason.isEmpty && trimmedReason.count < 3 {
                        Text(T("At least 3 characters.")).font(NXFont.text(11)).foregroundStyle(NX.warning)
                    }
                    Spacer()
                    Text("\(reason.count)/\(Self.reasonMax)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
        }
        .nexusCard(padding: 14, radius: 16)
    }

    private var summaryBar: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text("\(selected.count) \(Self.peopleWord(selected.count)) × \(days) \(Self.dayWord(days))")
                    .font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground)
                if periodKey != nil {
                    Text(periodLabel(periodKey)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
            Spacer(minLength: 8)
            Button {
                notice = nil; problem = nil
                pending = .grant
            } label: {
                HStack(spacing: 6) {
                    if busy { ProgressView().tint(.white) } else { Image(systemName: "calendar.badge.plus") }
                    Text(T("Give")).font(NXFont.text(13, .bold))
                }
                .foregroundStyle(.white)
                .padding(.horizontal, 14).padding(.vertical, 10)
                .background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .opacity(canSubmit ? 1 : 0.4)
            }
            .buttonStyle(.plain)
            .disabled(!canSubmit)
        }
        .padding(12)
        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private func grantsList(pickPeople: @escaping () -> Void) -> some View {
        let active = grants.filter(\.isActive).count
        let revoked = grants.count - active
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                SectionLabel(String(format: T("Grants · %@"), periodLabel(periodKey)))
                Spacer()
                Text(revoked > 0 ? String(format: T("%d active · %d revoked"), active, revoked) : String(format: T("%d active"), active))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            .padding(.top, 8)
            if grants.isEmpty {
                EmptyState(icon: "calendar.badge.plus", title: T("No extra day off in this period yet"),
                           subtitle: T("Pick people above, set the days and a reason — they'll see it in their day-off quota right away."),
                           actionTitle: T("Pick people"), actionIcon: "person.2", action: pickPeople, compact: true)
                    .nexusCard(padding: 0, radius: 16)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(grants.enumerated()), id: \.element.id) { idx, g in
                        if idx > 0 { Divider().overlay(NX.border) }
                        grantRow(g)
                    }
                }
                .nexusCard(padding: 0, radius: 16)
            }
        }
    }

    private func grantRow(_ g: DayOffBonusGrant) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: g.user?.avatar, initial: g.initial, size: 32)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(g.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    NexusChip(text: "+\(g.days) DO", tone: g.isActive ? .success : .neutral)
                }
                if let r = g.reason, !r.isEmpty {
                    Text(r).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(3)
                }
                Text(g.isActive
                     ? String(format: T("by %@ · %@"), g.grantedBy?.name ?? "—", Self.day(g.createdAt))
                     : String(format: T("Revoked by %@ · %@"), g.revokedBy?.name ?? "—", Self.day(g.revokedAt)))
                    .font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 6)
            if g.isActive {
                Button {
                    notice = nil; problem = nil
                    pending = .revoke(g)
                } label: {
                    Text(T("Revoke")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .overlay(Capsule().strokeBorder(NX.border))
                }
                .buttonStyle(.plain)
                .disabled(busy)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .opacity(g.isActive ? 1 : 0.5)
    }

    private static func day(_ iso: String?) -> String {
        guard let iso, let d = ProjDate.parse(iso) else { return "" }
        return dayFormatter.string(from: d)
    }
    private static let dayFormatter: DateFormatter = {
        let f = DateFormatter(); f.dateFormat = "d MMM yyyy"; f.timeZone = TimeZone(identifier: "Asia/Jakarta"); return f
    }()

    // MARK: actions

    private func toggle(_ id: String?) {
        guard let id else { return }
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    private func load() async {
        loadError = nil
        do {
            let l = try await APIClient.shared.dayOffBonuses(periodKey: periodKey)
            list = l
            // Default to the period today is in, once the server has said which that is.
            if periodKey == nil { periodKey = l.periodKey }
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            loadError = FailureText.text(error)
            // With a list already on screen the full-page error never shows, so say it inline —
            // otherwise a failed period switch would leave the old period's grants looking current.
            if list != nil { problem = loadError }
        }
        // The roster only feeds the picker; a failure there leaves an empty list, not a dead screen.
        if members.isEmpty, let r = try? await APIClient.shared.roster() { members = r.members ?? [] }
        loading = false
    }

    private func grant() async {
        guard canSubmit, let periodKey else { return }
        busy = true
        defer { busy = false }
        do {
            let r = try await APIClient.shared.grantDayOffBonus(userIds: Array(selected), periodKey: periodKey,
                                                                 days: days, reason: trimmedReason)
            let n = r.grants?.count ?? selected.count
            let d = r.days ?? days
            let notified = r.notified ?? n
            // Only the people who got the days are notified; "Everyone" read as if the whole office was.
            let who = notified < n ? String(format: T("%d of %d notified."), notified, n)
                : n == 1 ? T("They were notified.") : String(format: T("All %d were notified."), n)
            notice = String(format: T("%d %@ got %d extra %@ off · %@. %@"),
                            n, Self.peopleWord(n), d, Self.dayWord(d), r.periodLabel ?? periodLabel(periodKey), who)
            selected.removeAll(); reason = ""; days = 1
            await load()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't give extra day off.")
        }
    }

    private func revoke(_ g: DayOffBonusGrant) async {
        busy = true
        defer { busy = false }
        do {
            let r = try await APIClient.shared.revokeDayOffBonus(id: g.id)
            notice = (r.alreadyRevoked ?? false)
                ? T("Already revoked.")
                : String(format: T("Revoked %@'s extra day off."), r.grant?.displayName ?? g.displayName)
            await load()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't revoke.")
        }
    }
}
