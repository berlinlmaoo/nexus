import SwiftUI

struct GideonPersonReview: View {
    let userId: String
    @Environment(\.dismiss) private var dismiss
    @State private var data: GideonPersonReviewData?
    @State private var tab = "overview"
    @State private var failure: Error?
    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let data {
                    HStack(spacing: 10) {
                        AvatarView(url: data.person.avatar, initial: String((data.person.name ?? "?").prefix(1)), size: 38, userId: data.person.id, name: data.person.name)
                        VStack(alignment: .leading) {
                            Text(data.person.name ?? data.person.email ?? "—").font(NXFont.display(20, .bold))
                            Text(data.person.email ?? "").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                        Spacer()
                        if data.person.offboarded == true { Text(T("Offboarded")).font(NXFont.text(11, .semibold)).padding(6).background(NX.muted, in: Capsule()) }
                    }.padding(16)
                    HStack(spacing: 16) {
                        tabButton("Overview", id: "overview")
                        if data.viewer.canReadChats { tabButton("Chats", id: "chats") }
                        tabButton("Credits", id: "credits")
                        Spacer()
                    }.padding(.horizontal, 16).padding(.bottom, 12)
                    Divider()
                    if tab == "chats" && data.viewer.canReadChats { GideonPersonChats(userId: userId) }
                    else if tab == "credits" { GideonPersonCredits(userId: userId, data: data) { await load() } }
                    else { overview(data) }
                } else if let failure { LoadErrorView(error: failure, what: T("GIDEON usage"), retry: { Task { await load() } }) }
                else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
            }
            .background(NX.background)
            .navigationTitle("GIDEON").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
            .task { await load() }
        }
        .accessibilityIdentifier("gideon.personReview")
    }
    private func tabButton(_ title: String, id: String) -> some View {
        Button(T(title)) { tab = id }.buttonStyle(.plain).font(NXFont.text(13, .semibold))
            .foregroundStyle(tab == id ? NX.violetText : NX.mutedFg)
            .accessibilityIdentifier("gideon.person." + id)
    }
    private func overview(_ data: GideonPersonReviewData) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if data.stats.questions == 0 {
                    EmptyState(icon: "sparkles", title: T("No GIDEON use yet"), subtitle: T("Questions, chats and credits show up here once they ask GIDEON something."))
                } else {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 165))], spacing: 12) {
                        stat("Questions", AppNumber.int(data.stats.questions))
                        stat("Tool calls", AppNumber.int(data.stats.toolCalls))
                        stat("Chats", data.stats.deletedChats.map { String(format: T("%@ · %@ deleted by them"), AppNumber.int(data.stats.chats), AppNumber.int($0)) } ?? AppNumber.int(data.stats.chats))
                        stat("Credits this period", AppNumber.int(data.credits.used))
                        stat("Credits today", AppNumber.int(data.credits.todayUsed))
                        stat("Most-used tier", data.topTier.map { "GIDEON " + (GideonTier(rawValue: $0.tier)?.label ?? $0.tier) } ?? "—")
                        stat("First used", date(data.stats.firstUsed)); stat("Last used", date(data.stats.lastUsed))
                    }
                }
                if data.viewer.canReadChats { Button(T("Read their chats")) { tab = "chats" }.buttonStyle(.nxPrimary) }
            }.padding(16)
        }
    }
    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 6) { Text(T(label)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg); Text(value).font(NXFont.display(18, .bold)).fixedSize(horizontal: false, vertical: true) }.frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }
    private func date(_ value: String?) -> String { NativeDate.parse(value).map { AppDateLocale.formatter("d MMM yyyy HH:mm").string(from: $0) } ?? "—" }
    private func load() async {
        do { data = try await NativeAPI.request("/api/gideon/people/" + NativeAPI.escape(userId)); failure = nil
            if data?.viewer.canReadChats != true && tab == "chats" { tab = "overview" }
        } catch { failure = error }
    }
}

private struct GideonPersonChats: View {
    let userId: String
    @State private var query = ""
    @State private var deleted = "all"
    @State private var from: Date?; @State private var to: Date?
    @State private var chats: [GideonReviewedChats.Chat] = []
    @State private var cursor: String?; @State private var total = 0
    @State private var loading = false; @State private var loaded = false
    @State private var failure: Error?
    @State private var selected: GideonReviewedChats.Chat?
    private var filterKey: String { [query, deleted, from.map(CalDays.key) ?? "", to.map(CalDays.key) ?? ""].joined(separator: "|") }
    private var filtering: Bool { !query.isEmpty || deleted != "all" || from != nil || to != nil }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let selected {
                Button { self.selected = nil } label: { Label(T("Back to chats"), systemImage: "chevron.left") }.padding(.horizontal, 16)
                GideonReadOnlyChat(userId: userId, chat: selected)
            } else {
                VStack(spacing: 10) {
                    TextField(T("Search their chats"), text: $query).textFieldStyle(.roundedBorder)
                    HStack {
                        NativeOptionalDay(label: "From", value: $from)
                        NativeOptionalDay(label: "To", value: $to)
                    }
                    HStack {
                        Picker(T("Show"), selection: $deleted) {
                            Text(T("All")).tag("all"); Text(T("Kept")).tag("none"); Text(T("Deleted by user")).tag("only")
                        }.pickerStyle(.menu)
                        Spacer()
                        if filtering { Button(T("Clear filters")) { query = ""; deleted = "all"; from = nil; to = nil } }
                    }
                }.padding(.horizontal, 16).padding(.top, 12)
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 12) {
                        if let failure { LoadErrorView(error: failure, what: T("Chats"), retry: { Task { await load() } }, compact: true) }
                        if loaded && chats.isEmpty && failure == nil {
                            EmptyState(icon: "bubble.left", title: T(filtering ? "No chat matches these filters" : "No GIDEON chats"), subtitle: T(filtering ? "Try other words or dates." : "They haven't chatted with GIDEON yet."))
                        }
                        ForEach(chats) { chat in
                            Button { selected = chat } label: {
                                VStack(alignment: .leading, spacing: 5) {
                                    Text(chat.title?.isEmpty == false ? chat.title! : T("Untitled chat")).font(NXFont.text(14, .semibold))
                                    Text(LegalLabels.date(chat.createdAt) + " · " + String(format: T("%@ credits"), AppNumber.int(chat.credits)) + " · " + (chat.tier.flatMap { GideonTier(rawValue: $0)?.label } ?? "—"))
                                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                                    if chat.deleted { Text(T("Deleted by user")).font(NXFont.text(11, .semibold)).foregroundStyle(NX.danger) }
                                    if let match = chat.match { Text(match).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(3) }
                                }.frame(maxWidth: .infinity, alignment: .leading).nexusCard()
                            }.buttonStyle(.plain)
                        }
                        if loading { ProgressView().frame(maxWidth: .infinity) }
                        if cursor != nil && !loading { Button(T("Load more")) { Task { await load(more: true) } }.buttonStyle(.nxBordered) }
                        if loaded { Text(String(format: T("%@ chats"), AppNumber.int(total))).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                    }.padding(16)
                }
                Text(T("Read-only. They aren't notified.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).padding(16)
            }
        }
        .task(id: filterKey) {
            try? await Task.sleep(for: .milliseconds(300)); if !Task.isCancelled { await load() }
        }
    }
    private func load(more: Bool = false) async {
        let key = filterKey; loading = true; defer { if key == filterKey { loading = false } }
        var path = "/api/gideon/people/" + NativeAPI.escape(userId) + "/chats?limit=30&q=" + NativeAPI.escape(query) + "&deleted=" + deleted
        if let from { path += "&from=" + CalDays.key(from) }; if let to { path += "&to=" + CalDays.key(to) }
        if more, let cursor { path += "&cursor=" + NativeAPI.escape(cursor) }
        do {
            let page: GideonReviewedChats = try await NativeAPI.request(path)
            guard key == filterKey && !Task.isCancelled else { return }
            let known = more ? Set(chats.map(\.id)) : []
            chats = (more ? chats : []) + page.chats.filter { !known.contains($0.id) }
            cursor = page.nextCursor; if page.total >= 0 { total = page.total }; loaded = true; failure = nil
        } catch { if key == filterKey && !Task.isCancelled { failure = error; loaded = true } }
    }
}

struct NativeOptionalDay: View {
    let label: String
    @Binding var value: Date?
    var controlID: String? = nil
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Toggle(T(label), isOn: Binding(get: { value != nil }, set: { value = $0 ? CalDays.date(CalDays.wibToday()) : nil })).font(NXFont.text(12)).accessibilityIdentifier(controlID ?? "native.day." + label)
            if value != nil { DatePicker(T(label), selection: Binding(get: { value ?? Date() }, set: { value = $0 }), displayedComponents: .date).labelsHidden().environment(\.timeZone, TimeZone(secondsFromGMT: 0)!) }
        }.padding(8).overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(NX.border))
    }
}

private struct GideonReadOnlyChat: View {
    let userId: String
    let chat: GideonReviewedChats.Chat
    @State private var turns: [GideonTurn] = []
    @State private var older: String?
    @State private var loaded = false
    @State private var failure: Error?
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(T("Viewed as One Above All · read-only")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
            Text(String(format: T("Started %@"), LegalLabels.date(chat.createdAt))).font(NXFont.text(11))
            if let at = chat.deletedAt { Text(String(format: T("Deleted %@"), LegalLabels.date(at))).font(NXFont.text(11)).foregroundStyle(NX.danger) }
            if older != nil { Button(T("Show earlier messages")) { Task { await load(more: true) } } }
            if let failure { LoadErrorView(error: failure, what: T("Chats"), retry: { Task { await load() } }, compact: true) }
            if loaded && turns.isEmpty { EmptyState(icon: "bubble.left", title: T("This chat has no messages"), subtitle: T("Read-only. They aren't notified.")) }
            GideonPanel(embedded: true, reviewTurns: turns)
        }.padding(.horizontal, 16).task(id: chat.id) { await load() }
    }
    private func load(more: Bool = false) async {
        var path = "/api/gideon/people/" + NativeAPI.escape(userId) + "/chats/" + NativeAPI.escape(chat.id) + "?limit=50"
        if more, let older { path += "&before=" + NativeAPI.escape(older) }
        do {
            let page: GideonReviewedTranscript = try await NativeAPI.request(path)
            let next = GideonClient.historyTurns(page.messages)
            let ids = Set(turns.map(\.id)); turns = more ? next.filter { !ids.contains($0.id) } + turns : next
            older = page.olderBefore; loaded = true; failure = nil
        } catch { failure = error }
    }
}

private struct GideonPersonCredits: View {
    let userId: String
    let data: GideonPersonReviewData
    let onSaved: () async -> Void
    @State private var person: GideonAdminCredits.Person?
    @State private var bonuses: [GideonBonusHistory.Bonus] = []
    @State private var roleDefault = true; @State private var unlimited = false
    @State private var daily = ""; @State private var monthly = ""; @State private var note = ""
    @State private var bonus = ""; @State private var reason = ""
    @State private var failure: String?; @State private var busy = false
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                Text(data.credits.period.startKey + " – " + data.credits.period.endKey).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                ForEach(data.credits.tiers) { tier in
                    HStack { Text("GIDEON " + (GideonTier(rawValue: tier.tier)?.label ?? tier.tier)); Spacer(); Text(String(format: T("%@ credits · %@ answers"), AppNumber.int(tier.credits), AppNumber.int(tier.answers))) }.font(NXFont.text(13))
                }
                if let person {
                    Text(T("Limits")).font(NXFont.display(18, .bold))
                    Text(person.limits.unlimited ? T("Unlimited") : AppNumber.int(person.limits.daily) + " / " + T("day") + " · " + AppNumber.int(person.limits.monthly) + " / " + T("period")).font(NXFont.text(13))
                    Toggle(T("Role default"), isOn: $roleDefault)
                    if !roleDefault {
                        Toggle(T("Unlimited"), isOn: $unlimited)
                        if !unlimited { TextField(T("Daily limit"), text: $daily).textFieldStyle(.roundedBorder); TextField(T("Period pool"), text: $monthly).textFieldStyle(.roundedBorder) }
                        TextField(T("Note"), text: $note).textFieldStyle(.roundedBorder)
                    }
                    Button(T("Save limits")) { Task { await save() } }.buttonStyle(.nxPrimary).disabled(busy || (!roleDefault && !unlimited && (number(daily) == nil || number(monthly) == nil)))
                    Divider()
                    Text(T("Bonus credits")).font(NXFont.display(18, .bold))
                    TextField(T("Credits"), text: $bonus).textFieldStyle(.roundedBorder)
                    TextField(T("Reason"), text: $reason).textFieldStyle(.roundedBorder)
                    Button(T("Grant bonus")) { Task { await grant() } }.buttonStyle(.nxBordered).disabled(busy || (number(bonus) ?? 0) <= 0)
                    ForEach(bonuses) { b in HStack { Text("+" + AppNumber.int(b.credits)); Text(b.reason ?? "—"); Spacer(); Text(LegalLabels.date(b.createdAt)) }.font(NXFont.text(12)) }
                }
                if let failure { Text(failure).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }.padding(16)
        }.task { await load() }
    }
    private func number(_ text: String) -> Int? {
        let value = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.range(of: "^[0-9]+(?:\\.[0-9]{3})*$", options: .regularExpression) != nil else { return nil }
        return Int(value.replacingOccurrences(of: ".", with: ""))
    }
    private func load() async {
        do {
            let admin: GideonAdminCredits = try await NativeAPI.request("/api/gideon/credits/admin")
            person = admin.people.first { $0.id == userId }
            if let person {
                roleDefault = person.override == nil; unlimited = person.override?.unlimited ?? person.limits.unlimited
                daily = AppNumber.int(person.override?.dailyLimit ?? person.limits.daily); monthly = AppNumber.int(person.override?.monthlyLimit ?? person.limits.monthly); note = person.override?.note ?? ""
            }
            let history: GideonBonusHistory = try await NativeAPI.request("/api/gideon/credits/admin/bonus?userId=" + NativeAPI.escape(userId)); bonuses = history.bonuses; failure = nil
        } catch { failure = error.localizedDescription }
    }
    private func save() async {
        busy = true; defer { busy = false }
        do {
            let body: [String: Any] = ["userId": userId, "dailyLimit": roleDefault ? NSNull() : number(daily) as Any? ?? NSNull(), "monthlyLimit": roleDefault ? NSNull() : number(monthly) as Any? ?? NSNull(), "unlimited": roleDefault ? NSNull() : unlimited as Any, "note": roleDefault ? NSNull() : note as Any]
            let _: NativeAPI.Empty = try await NativeAPI.request("/api/gideon/credits/admin/override", method: "PUT", body: body)
            await load(); await onSaved()
        } catch { failure = error.localizedDescription }
    }
    private func grant() async {
        guard let credits = number(bonus), credits > 0 else { return }; busy = true; defer { busy = false }
        do {
            let _: NativeAPI.Empty = try await NativeAPI.request("/api/gideon/credits/admin/bonus", method: "POST", body: ["userId": userId,"credits": credits,"reason": reason])
            bonus = ""; reason = ""; await load(); await onSaved()
        } catch { failure = error.localizedDescription }
    }
}

struct GideonPersonPresentation: ViewModifier {
    @Binding var person: String?
    @Environment(\.horizontalSizeClass) private var hSize
    @ViewBuilder func body(content: Content) -> some View {
        if hSize == .regular {
            content.sheet(isPresented: Binding(get: { person != nil }, set: { if !$0 { person = nil } })) {
                if let person { GideonPersonReview(userId: person).frame(idealWidth: 1024, idealHeight: 760).presentationDetents([.fraction(0.86)]) }
            }
        } else {
            content.fullScreenCover(isPresented: Binding(get: { person != nil }, set: { if !$0 { person = nil } })) {
                if let person { GideonPersonReview(userId: person) }
            }
        }
    }
}

struct GideonControlRoomView: View {
    @Environment(AppRouter.self) private var router
    @State private var tab = "people"
    @State private var perfAllowed = true
    var body: some View {
        VStack(spacing: 0) {
            HStack(spacing: 16) {
                Button(T("People")) { tab = "people" }.foregroundStyle(tab == "people" ? NX.violetText : NX.mutedFg)
                if perfAllowed && Viewer.shared.isBoD {
                    Button(T("Performance")) { tab = "performance" }.foregroundStyle(tab == "performance" ? NX.violetText : NX.mutedFg)
                        .accessibilityIdentifier("gideon.admin.performance")
                }
                Spacer()
            }.font(NXFont.text(13, .semibold)).buttonStyle(.plain).padding(16)
            Divider()
            if tab == "performance" && perfAllowed {
                GideonPerformanceView { perfAllowed = false; tab = "people" }
            } else { AdminGideonUsageSection() }
        }
        .task { claimTab() }
        .onChange(of: router.gideonAdminTab) { _, _ in claimTab() }
    }
    private func claimTab() {
        if router.gideonAdminTab == "performance" && Viewer.shared.isBoD { tab = "performance"; router.gideonAdminTab = nil }
    }
}
