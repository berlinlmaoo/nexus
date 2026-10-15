import SwiftUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// My Submissions (owner, 12 Oct 2026) — port of the web's routes/_app/submissions.tsx after the redesign.
//
// What I filed through a form, on a board whose columns are the target project's status options: the same
// names and colours the finance / multimedia team sees on their board, grouped To-do / In progress /
// Complete. Read-only: the team moves the cards; it follows live (workspace-changed { kind: "submissions" }
// to my own room). A card opens my answers, the proof of payment, its status history and the comments,
// where I can reply. Older servers send only `statusColumns` (names): those become columns after "New".
// ─────────────────────────────────────────────────────────────────────────────

// MARK: models

/// A column of the board: one status option of the projects my submissions went to.
struct SubmissionColumn: Decodable, Identifiable, Hashable, Sendable {
    let key: String
    let name: String
    let color: String?
    /// "todo" | "in_progress" | "complete".
    let group: String?
    let taskStatus: String?
    /// The projects that have this option (nil = every one, e.g. a column made from an older server).
    let projectIds: [String]?

    var id: String { key }
    var statusGroup: StatusGroup { StatusGroup(rawValue: group ?? "todo") ?? .todo }
    var colorKey: String {
        StatusColor.normalize(color) ?? {
            switch statusGroup { case .todo: return "gray"; case .inProgress: return "blue"; case .complete: return "green" }
        }()
    }
}

struct MySubmissionsResponse: Decodable, Sendable {
    let submissions: [MySubmission]?
    let statusColumns: [String]?
    let columns: [SubmissionColumn]?
}

struct SubmissionPerson: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String?
    let avatar: String?
}

struct MySubmission: Decodable, Identifiable, Sendable {
    let id: String
    let createdAt: String?
    let formName: String?
    let projectId: String?
    let projectName: String?
    let taskId: String?
    let taskTitle: String?
    let status: String?
    let procStatus: String?
    let column: SubmissionColumn?
    /// "finance" | "multimedia" | "other".
    let kind: String?
    let amount: Double?
    let category: String?
    let date: String?
    let handlers: [SubmissionPerson]?
    let needsAction: Bool?
    let commentCount: Int?
    let proofs: [SubmissionProof]?

    var title: String { taskTitle ?? formName ?? T("Submission") }
    /// The column this card sits in: the server's, else the old "Status" field, else New.
    var columnKey: String { column?.key ?? ((procStatus?.trimmingCharacters(in: .whitespaces)).flatMap { $0.isEmpty ? nil : $0 } ?? "new") }
}

/// A submission to open, by id. The row it came from rides along so the sheet has a title to draw while
/// the detail loads — a notification names an id and nothing else.
struct SubmissionRef: Identifiable {
    let id: String
    var preview: MySubmission? = nil
    /// One of my Legal requests (its id) instead of a form submission — one `.sheet(item:)` for both.
    var legalRequestId: String? = nil
}

/// GET /api/forms/my-submissions/{submissionId} — the answers, the proofs, the history and the comments.
struct MySubmissionDetail: Decodable, Sendable {
    let id: String
    let createdAt: String?
    let formName: String?
    let projectName: String?
    let taskId: String?
    let taskTitle: String?
    let status: String?
    let stage: String?
    let procStatus: String?
    let answers: [SubmissionAnswer]?
    let proofs: [SubmissionProof]?
    let column: SubmissionColumn?
    let amount: Double?
    let category: String?
    let date: String?
    let handlers: [SubmissionPerson]?
    let needsAction: Bool?
    let history: [HistoryEntry]?
    let comments: [Comment]?

    struct HistoryEntry: Decodable, Identifiable, Sendable {
        let id: String
        let at: String?
        let by: String?
        let from: String?
        let to: String?
    }
    struct Comment: Decodable, Identifiable, Sendable {
        let id: String
        let content: String?
        let createdAt: String?
        let mine: Bool?
        let user: SubmissionPerson?
    }
}

struct SubmissionAnswer: Decodable, Identifiable, Sendable {
    let id: String
    let label: String?
    let type: String?
    let value: SubmissionAnswerValue?

    var display: String { value?.display ?? "" }

    /// An amount-looking answer that is a bare number shows as Rupiah (web: harga / nominal / amount …).
    var displayFormatted: String {
        let text = display.trimmingCharacters(in: .whitespaces)
        let lbl = (label ?? "").lowercased()
        let money = ["harga", "nominal", "amount", "biaya", "total", "jumlah"].contains { lbl.contains($0) }
        if money, !text.isEmpty, text.allSatisfy({ $0.isNumber || $0 == "-" }) { return CustomFieldNumber.formatIDR(text) }
        return text
    }
}

/// One answer, flattened to display text as it is decoded (string, number, multi-select, file, place).
struct SubmissionAnswerValue: Decodable, Sendable {
    let text: String
    /// A checkbox stays a boolean here: the wording is picked where a language switch is observed.
    let flag: Bool?

    var display: String { flag.map { $0 ? T("Yes") : T("No") } ?? text }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { text = s; flag = nil }
        else if let b = try? c.decode(Bool.self) { text = ""; flag = b }
        // Int before Double, or a whole number comes out as "1000.0".
        else if let i = try? c.decode(Int.self) { text = String(i); flag = nil }
        else if let d = try? c.decode(Double.self) { text = String(d); flag = nil }
        else if let list = try? c.decode([SubmissionAnswerValue].self) {
            text = list.map(\.text).filter { !$0.isEmpty }.joined(separator: ", "); flag = nil
        }
        else if let o = try? c.decode(NamedValue.self) { text = o.name ?? o.label ?? ""; flag = nil }
        else { text = ""; flag = nil }
    }

    private struct NamedValue: Decodable { let name: String?; let label: String? }
}

/// Proof from the team: legacy PROOF files plus anything someone else attached (server lib/my-submissions.ts).
struct SubmissionProof: Decodable, Identifiable, Sendable {
    let id: String
    let name: String?
    let url: String?
    let mimeType: String?
    let size: Int?

    var isImage: Bool { (mimeType ?? "").hasPrefix("image/") }

    /// The server hands out an app-relative path behind the session cookie: only the app can fetch it.
    var absoluteURL: URL? {
        guard let path = url, !path.isEmpty else { return nil }
        return URL(string: path.hasPrefix("http") ? path : Config.baseURL.absoluteString + path)
    }
}

private func subDateText(_ iso: String?, time: Bool = false) -> String {
    guard let d = ProjDate.parse(iso) else { return "" }
    let f = DateFormatter()
    f.dateFormat = time ? "d MMM yyyy, HH:mm" : "d MMM yyyy"
    f.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_GB")
    f.timeZone = ProjDate.cal.timeZone
    return f.string(from: d)
}

private func subMoney(_ amount: Double?) -> String? {
    guard let amount else { return nil }
    return CustomFieldNumber.formatIDR(String(Int64(amount.rounded())))
}

private func subStatusWord(_ s: String?) -> String { TaskStatusName.label((s ?? "").uppercased()) }

// MARK: board

struct SubmissionsView: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @Environment(AuthStore.self) private var auth
    @State private var subs: [MySubmission] = []
    @State private var serverColumns: [SubmissionColumn] = []
    @State private var statusColumns: [String] = []
    @State private var loading = true
    @State private var loadError = false
    @State private var cachedFrom: Date?
    @State private var opened: SubmissionRef?
    /// What I asked Legal for (owner, 14 Oct 2026), above the form board.
    @State private var legal: [MyLegalRequest] = []
    /// "all" | "finance" | "multimedia".
    @State private var kindFilter = "all"
    @State private var needsMine = false
    /// Per-project filter (owner, 12 Oct 2026), remembered on this device.
    @AppStorage("nexus.submissions.project") private var projectFilter = ""

    private struct ProjectOption: Identifiable, Hashable { let id: String; let name: String; let count: Int }

    private var projectOptions: [ProjectOption] {
        var byId: [String: ProjectOption] = [:]
        for s in subs {
            guard let pid = s.projectId, !pid.isEmpty else { continue }
            let cur = byId[pid]
            byId[pid] = ProjectOption(id: pid, name: cur?.name ?? (s.projectName ?? T("Untitled project")), count: (cur?.count ?? 0) + 1)
        }
        return byId.values.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// The remembered project, while it still has a submission.
    private var activeProject: String? {
        projectFilter.isEmpty || !projectOptions.contains(where: { $0.id == projectFilter }) ? nil : projectFilter
    }

    private func inFilters(_ s: MySubmission) -> Bool {
        (kindFilter == "all" || s.kind == kindFilter) && (activeProject == nil || s.projectId == activeProject)
    }
    private var shown: [MySubmission] { subs.filter { inFilters($0) && (!needsMine || $0.needsAction == true) } }
    private var needCount: Int { subs.filter { inFilters($0) && $0.needsAction == true }.count }

    /// The projects' status options; an older server's names become columns after "New".
    private var columns: [SubmissionColumn] {
        let base = !serverColumns.isEmpty ? serverColumns
            : [SubmissionColumn(key: "new", name: T("New"), color: nil, group: "todo", taskStatus: nil, projectIds: nil)]
                + statusColumns.map { SubmissionColumn(key: $0, name: $0, color: nil, group: "in_progress", taskStatus: nil, projectIds: nil) }
        // A submission whose column the list doesn't have (a status renamed or removed on its project, or
        // "New" on a form without a status) gets a column of its own, as on the web (W-B7). Without it the
        // board showed three empty lanes while four requests sat in "New" (run 14, P-M28 / P-I35 / N-16).
        var known = Set(base.map(\.key))
        var extra: [SubmissionColumn] = []
        for sub in subs where !known.contains(sub.columnKey) {
            known.insert(sub.columnKey)
            let status = sub.procStatus?.trimmingCharacters(in: .whitespaces) ?? ""
            extra.append(sub.column ?? SubmissionColumn(key: sub.columnKey, name: status.isEmpty ? T("New") : status, color: nil,
                                                        group: sub.columnKey == "new" ? "todo" : "in_progress", taskStatus: nil, projectIds: nil))
        }
        // Each extra column joins its own group (stable within a group), as on the web: appended after Done,
        // "New" with the only cards sat past the right edge (UI tour run 15, Q-IA1 / Q-M4).
        let rank: (SubmissionColumn) -> Int = { c in
            switch c.statusGroup { case .todo: return 0; case .inProgress: return 1; case .complete: return 2 }
        }
        return (base + extra).enumerated()
            .sorted { a, b in rank(a.element) != rank(b.element) ? rank(a.element) < rank(b.element) : a.offset < b.offset }
            .map(\.element)
    }

    /// The columns of the filtered requests' projects (empty ones too, as on their board).
    private var visibleColumns: [SubmissionColumn] {
        let projects = Set(subs.filter(inFilters).compactMap(\.projectId))
        let cards = shown
        return columns.filter { c in
            (c.projectIds.map { $0.contains(where: projects.contains) } ?? true) || cards.contains { $0.columnKey == c.key }
        }
    }

    /// The sidebar's My Submissions page on an iPad or Mac: the web's page header instead of the nav bar.
    private var isRoot: Bool { NXSidebarPage.isRoot(.submissions, hSize: hSize, router: router) }
    private var gutter: CGFloat { NXSidebarPage.gutter(isRoot) }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading {
                ProgressView().tint(NX.mutedFg).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if loadError {
                EmptyState(icon: "wifi.exclamationmark", title: T("Couldn't load your submissions."),
                           subtitle: T("Check your connection and try again."),
                           actionTitle: T("Try again"), actionIcon: "arrow.clockwise") { Task { await load() } }
            } else if subs.isEmpty && legal.isEmpty {
                EmptyState(icon: "tray", title: T("No submissions yet"),
                           subtitle: T("Everything you send through a form (a payment request, a design request, a report) shows up here with where it stands, so you never have to ask."),
                           actionTitle: T("Open forms"), actionIcon: "doc.text") { router.go(.forms) }
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    if let cachedFrom { OfflineNotice(savedAt: cachedFrom).padding(.horizontal, gutter).padding(.top, 8) }
                    if !legal.isEmpty && kindFilter == "all" {
                        MyLegalRequestsStrip(requests: legal, gutter: gutter) { id in opened = SubmissionRef(id: "legal-" + id, legalRequestId: id) }
                            .padding(.top, 6)
                    }
                    if subs.isEmpty {
                        Spacer(minLength: 0)
                    } else {
                    filterBar
                    if shown.isEmpty {
                        EmptyState(icon: "doc.text.magnifyingglass",
                                   title: needsMine ? T("Nothing needs your action") : T("No submissions here"),
                                   subtitle: needsMine ? T("When the team asks for a revision or replies to you, the request shows up here.") : T("Try another filter."),
                                   actionTitle: T("Show all"), actionIcon: "line.3.horizontal.decrease.circle") {
                            kindFilter = "all"; needsMine = false; projectFilter = ""
                        }
                    } else {
                        board
                    }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .padding(.top, isRoot ? 14 : 0)
            }
        }
        .nxSidebarPageChrome(isRoot, phoneSubtitle: T("Requests you sent through a form. The team that handles them moves them along; this board follows.")) {
            NXPageHeader(title: T("My Submissions"),
                         subtitle: T("Requests you sent through a form. The team that handles them moves them along; this board follows."))
        }
        .navigationTitle(T("My Submissions"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        // Live: the team moved, answered or attached something (workspace-changed { kind: "submissions" }
        // to my own room); the timer covers the time the connection is down.
        .liveRefresh(every: 60, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.submissions]) { await load(quiet: true) }
        .sheet(item: $opened, onDismiss: { Task { await load(quiet: true) } }) { ref in
            if let lid = ref.legalRequestId {
                MyLegalRequestSheet(requestId: lid)
            } else {
                SubmissionDetailSheet(submissionId: ref.id, preview: ref.preview)
            }
        }
    }

    // MARK: filters

    private var filterBar: some View {
        let kinds = Set(subs.compactMap(\.kind))
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                chip(T("All"), on: kindFilter == "all") { kindFilter = "all" }
                if kinds.contains("finance") { chip(T("Finance"), on: kindFilter == "finance") { kindFilter = "finance" } }
                if kinds.contains("multimedia") { chip(T("Multimedia"), on: kindFilter == "multimedia") { kindFilter = "multimedia" } }
                if !projectOptions.isEmpty {
                    Menu {
                        Button { projectFilter = "" } label: {
                            if activeProject == nil { Label(T("All projects"), systemImage: "checkmark") } else { Text(T("All projects")) }
                        }
                        Divider()
                        ForEach(projectOptions) { p in
                            Button { projectFilter = p.id } label: {
                                if activeProject == p.id { Label("\(p.name) · \(p.count)", systemImage: "checkmark") } else { Text("\(p.name) · \(p.count)") }
                            }
                        }
                    } label: {
                        chipLabel(HStack(spacing: 4) {
                            ProjectMark(icon: nil, color: nil, size: 13, projectId: activeProject)
                            Text(projectOptions.first { $0.id == activeProject }?.name ?? T("All projects")).lineLimit(1)
                            Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                        }, on: activeProject != nil)
                    }
                    .accessibilityLabel(T("Filter by project"))
                }
                Divider().frame(height: 20)
                chip(needCount > 0 ? "\(T("Needs my action")) · \(needCount)" : T("Needs my action"), on: needsMine, icon: "exclamationmark.circle") { needsMine.toggle() }
                // Wide (web header row): the note sits at the end of the filters.
                if isRoot { readOnlyNote.padding(.leading, 4) }
            }
            .padding(.horizontal, gutter).padding(.top, 10)
        }
        // Phone: the filter row scrolls sideways, so the note got pushed off screen (UI tour run 7);
        // it gets its own line under the filters instead.
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if !isRoot {
                readOnlyNote.frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, gutter).padding(.top, 2)
            }
        }
    }

    private var readOnlyNote: some View {
        HStack(spacing: 4) {
            Image(systemName: "lock").font(.system(size: 10))
            Text(T("Read-only. The team moves the cards.")).font(NXFont.text(13))
        }
        .foregroundStyle(NX.mutedFg)
    }

    private func chip(_ text: String, on: Bool, icon: String? = nil, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            chipLabel(HStack(spacing: 4) {
                if let icon { Image(systemName: icon).font(.system(size: 11, weight: .semibold)) }
                Text(text).lineLimit(1)
            }, on: on)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }

    private func chipLabel<V: View>(_ content: V, on: Bool) -> some View {
        content
            .font(NXFont.text(13, .semibold))
            .foregroundStyle(on ? NX.foreground : NX.mutedFg)
            .padding(.horizontal, 12).padding(.vertical, 7)
            .background(on ? NX.accentBg : NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(on ? NX.foreground.opacity(0.25) : NX.border))
            .frame(minHeight: 44)
            .contentShape(Rectangle())
    }

    // MARK: board

    private var board: some View {
        let cols = visibleColumns
        // Each column scrolls on its own; swipe sideways between columns (non-lazy, the same structure
        // as before — proven on device).
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(cols, id: \.key) { col in
                    column(col)
                }
            }
            .padding(.horizontal, gutter).padding(.bottom, 16)
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        // The column peeking in at the edge fades, so it reads as "more this way" (F-35); wide enough to
        // read as a fade, not a cut (run 14, N-16).
        .nxEdgeFade(40)
    }

    private func column(_ col: SubmissionColumn) -> some View {
        let items = shown.filter { $0.columnKey == col.key }
        let sw = StatusColor.swatch(col.colorKey)
        return VStack(alignment: .leading, spacing: 4) {
            // One label per column — its own stage name; the status-group label above it doubled it
            // ("Complete" over "Done", UI tour run 11).
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    StatusPill(name: col.name, colorKey: col.colorKey)
                    Text("\(items.count)").font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg).monospacedDigit()
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10).padding(.top, 10)
                ScrollView(.vertical, showsIndicators: false) {
                    VStack(spacing: 8) {
                        ForEach(items) { s in
                            Button { opened = SubmissionRef(id: s.id, preview: s) } label: { card(s) }
                                .buttonStyle(.plain)
                                .hoverEffect(.highlight)
                        }
                        if items.isEmpty {
                            // The web's reason per group, and the first empty To-do lane links to the forms,
                            // the way a request gets here (UI tour run 15, Q-IA4 / Q-M4).
                            VStack(spacing: 8) {
                                Text(emptyText(col))
                                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                                    .multilineTextAlignment(.center)
                                    .fixedSize(horizontal: false, vertical: true)
                                if col.key == firstEmptyTodo {
                                    Button(T("Open forms")) { router.go(.forms) }
                                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                                        .buttonStyle(.plain)
                                }
                            }
                            .frame(maxWidth: .infinity).padding(.horizontal, 6).padding(.vertical, 22)
                        }
                    }
                    .padding(.horizontal, 8).padding(.bottom, 8)
                }
            }
            .frame(maxHeight: .infinity, alignment: .top)
            .background(sw.lane, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .frame(maxHeight: .infinity, alignment: .top)
        // One column plus a hint of the next on a phone, at most 320 wide (sized to the container,
        // not the device screen, so Split View / a resized Mac window / a folding phone all fit).
        // An empty column is narrower, so it doesn't push the cards of the next one off screen
        // (UI tour run 7: an empty To Do took most of the phone's width).
        .containerRelativeFrame(.horizontal, alignment: .leading) { width, _ in
            // iPad / Mac: the lanes share the page's width when they fit (run 14, P-M28: the board stopped at
            // ~1490 px with 500 px empty beside it), 260 pt at least.
            if hSize == .regular {
                let n = CGFloat(max(1, visibleColumns.count))
                let fair = (width - 2 * gutter - 12 * (n - 1)) / n
                if fair >= 260 { return fair }
                // Too narrow to share: an empty lane is narrow, as on the web (w-48), so the lanes with cards
                // stay on screen (UI tour run 15, Q-IA1: "New" with the only 4 cards sat past a cut "Done").
                return items.isEmpty ? 200 : 300
            }
            // Two empty columns used to fill a phone exactly, so the third sat just off screen with no hint
            // of it (UI tour run 9, I8): an empty one is now narrow enough that the next always peeks in.
            return items.isEmpty ? min(200, width * 0.4) : min(320, width * 0.85)
        }
    }

    private func emptyText(_ col: SubmissionColumn) -> String {
        switch col.statusGroup {
        case .todo: return T("New requests wait here until the team picks them up.")
        case .complete: return T("Finished requests end up here.")
        default: return T("Requests the team is working on move here.")
        }
    }

    /// The first To-do lane without cards: the one that links to the forms.
    private var firstEmptyTodo: String? {
        let cards = shown
        return visibleColumns.first { c in c.statusGroup == .todo && !cards.contains { $0.columnKey == c.key } }?.key
    }

    private func card(_ s: MySubmission) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(nxUnbreakableParentheses(s.title)).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(3)
                .multilineTextAlignment(.leading)
            if let money = subMoney(s.amount) {
                Text(money).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).monospacedDigit()
            }
            HStack(spacing: 8) {
                if let cat = s.category, !cat.isEmpty {
                    Label(cat, systemImage: "tag").lineLimit(1)
                        .padding(.horizontal, 6).padding(.vertical, 2)
                        .background(NX.muted, in: RoundedRectangle(cornerRadius: 5, style: .continuous))
                }
                if let d = s.date, !d.isEmpty { Label(subDateText(d), systemImage: "calendar").lineLimit(1) }
                if (s.commentCount ?? 0) > 0 { Label("\(s.commentCount ?? 0)", systemImage: "bubble.left") }
                if !(s.proofs ?? []).isEmpty { Label(T("Proof"), systemImage: "paperclip").foregroundStyle(NX.success) }
            }
            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            HStack(spacing: 6) {
                Text(s.projectName ?? s.formName ?? "").font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1)
                Spacer(minLength: 0)
                HStack(spacing: -6) {
                    ForEach((s.handlers ?? []).prefix(3)) { p in
                        AvatarView(url: p.avatar, initial: String((p.name ?? "?").prefix(1)).uppercased(), size: 20)
                            .overlay(Circle().strokeBorder(NX.card, lineWidth: 1.5))
                    }
                }
            }
            if s.needsAction == true {
                Label(T("Needs your reply"), systemImage: "exclamationmark.circle")
                    .font(NXFont.text(11, .semibold)).foregroundStyle(NX.warning)
                    .padding(.horizontal, 6).padding(.vertical, 2)
                    .background(NX.warning.opacity(0.14), in: RoundedRectangle(cornerRadius: 5, style: .continuous))
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
        .contentShape(Rectangle())
    }

    private func load(quiet: Bool = false) async {
        if !quiet { loadError = false }
        // Best effort: an older server has no Legal requests; the board loads either way.
        if let mine = try? await APIClient.shared.myLegalRequests() { legal = mine }
        do {
            let r = try await APIClient.shared.mySubmissions()
            subs = r.submissions ?? []
            serverColumns = r.columns ?? []
            statusColumns = r.statusColumns ?? []
            cachedFrom = nil
            loadError = false
        } catch APIError.unauthorized { auth.logout() }
        catch {
            if quiet && !subs.isEmpty { return }
            if let hit = ResponseCache.decoded("my-submissions", as: MySubmissionsResponse.self) {
                subs = hit.value.submissions ?? []
                serverColumns = hit.value.columns ?? []
                statusColumns = hit.value.statusColumns ?? []
                cachedFrom = hit.savedAt
            } else {
                loadError = true
            }
        }
        loading = false
    }
}

// MARK: detail

/// What a card (or a notification) opens: a centred sheet, as on the web.
struct SubmissionDetailSheet: View {
    let submissionId: String
    var preview: MySubmission? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth
    @State private var detail: MySubmissionDetail?
    @State private var loading = true
    /// nil = fine; 404 = gone; else any other failure.
    @State private var failure: Int?
    @State private var viewingPhoto: PhotoRef?
    @State private var shareItem: ShareItem?
    @State private var fetching: String?
    @State private var reply = ""
    @State private var sending = false
    @State private var confirmDelete = false
    @State private var deleting = false
    @State private var problem: String?

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        header
                        if loading {
                            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else if let failure {
                            if failure == 404 {
                                EmptyState(icon: "questionmark.folder",
                                           title: T("This submission no longer exists, or the link is wrong."),
                                           subtitle: T("It may have been deleted. Your other submissions are on My Submissions."),
                                           compact: true)
                            } else {
                                EmptyState(icon: "wifi.exclamationmark", title: T("Couldn't load the details."),
                                           subtitle: T("Check your connection and try again."),
                                           actionTitle: T("Try again"), actionIcon: "arrow.clockwise",
                                           action: { Task { await load() } }, compact: true)
                            }
                        } else if let d = detail {
                            facts(d)
                            answerList(d)
                            proofList(d)
                            historyList(d)
                            comments(d)
                            // Only for a submission that loaded: an unknown id has nothing to delete (N-BUG-6).
                            deleteRow
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(20)
                }
            }
            .navigationTitle(T("Submission"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Close")) { dismiss() } } }
            .fullScreenCover(item: $viewingPhoto) { PhotoViewer(photo: $0) }
            .sheet(item: $shareItem) { item in ActivityView(items: [item.url]) }
            .alert(T("Delete this submission?"), isPresented: $confirmDelete) {
                Button(T("Delete"), role: .destructive) { Task { await deleteSubmission() } }
                Button(T("Cancel"), role: .cancel) {}
            } message: { Text(T("Its task in the project is deleted too.")) }
            .alert(T("Couldn't do that"), isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
                Button("OK") { problem = nil }
            } message: { Text(problem ?? "") }
        }
        .task { await load() }
        .liveRefresh(every: 60, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.submissions]) { await load(quiet: true) }
    }

    private var header: some View {
        let subtitle = [detail?.formName ?? preview?.formName, detail?.projectName ?? preview?.projectName]
            .compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
        let column = detail?.column ?? preview?.column
        return VStack(alignment: .leading, spacing: 8) {
            Text(detail?.taskTitle ?? preview?.title ?? T("Submission"))
                .font(NXFont.display(19, .bold)).foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
            if !subtitle.isEmpty {
                Text(subtitle).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            HStack(spacing: 8) {
                if let column {
                    HStack(spacing: 4) {
                        StatusPill(name: column.name, colorKey: column.colorKey)
                        Text("· \(column.statusGroup.label)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    }
                }
                if (detail?.needsAction ?? preview?.needsAction) == true {
                    Label(T("Needs your reply"), systemImage: "exclamationmark.circle")
                        .font(NXFont.text(11, .semibold)).foregroundStyle(NX.warning)
                }
            }
            Text(String(format: T("Submitted %@"), subDateText(detail?.createdAt ?? preview?.createdAt, time: true)))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func facts(_ d: MySubmissionDetail) -> some View {
        let handlers = (d.handlers ?? []).compactMap(\.name).filter { !$0.isEmpty }.joined(separator: ", ")
        return LazyVGrid(columns: [GridItem(.flexible(), alignment: .topLeading), GridItem(.flexible(), alignment: .topLeading)], alignment: .leading, spacing: 12) {
            fact(T("Amount"), subMoney(d.amount) ?? "—")
            fact(T("Category"), (d.category ?? "").isEmpty ? "—" : d.category!)
            fact(T("Date"), (d.date ?? "").isEmpty ? "—" : subDateText(d.date))
            fact(T("Handled by"), handlers.isEmpty ? T("Not assigned yet") : handlers)
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
            Text(value).font(NXFont.text(14)).foregroundStyle(NX.foreground).monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
    }

    @ViewBuilder private func answerList(_ d: MySubmissionDetail) -> some View {
        let rows = d.answers ?? []
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(T("Your answers"))
            if rows.isEmpty {
                Text(T("No answers were recorded.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, a in
                        VStack(alignment: .leading, spacing: 3) {
                            Text(a.label ?? a.id).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            Text(a.displayFormatted.isEmpty ? "—" : a.displayFormatted)
                                .font(NXFont.text(14)).foregroundStyle(NX.foreground)
                                .fixedSize(horizontal: false, vertical: true)
                                .textSelection(.enabled)
                        }
                        .padding(.horizontal, 12).padding(.vertical, 9)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        if i < rows.count - 1 { Divider().overlay(NX.border) }
                    }
                }
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
            }
        }
    }

    @ViewBuilder private func proofList(_ d: MySubmissionDetail) -> some View {
        let items = d.proofs ?? []
        if !items.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                sectionTitle(T("Proof of payment"))
                ForEach(items) { proofRow($0) }
            }
        }
    }

    private func proofRow(_ p: SubmissionProof) -> some View {
        Button { Task { await open(p) } } label: {
            HStack(spacing: 10) {
                if p.isImage, let url = p.absoluteURL {
                    CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { NX.muted }
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                } else {
                    Image(systemName: "paperclip").font(.system(size: 13)).foregroundStyle(NX.success)
                        .frame(width: 44, height: 44)
                        .background(NX.success.opacity(0.14), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.name ?? T("Proof")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(p.isImage ? PlatformWording.tapOrClick(tap: "Tap to enlarge", click: "Click to enlarge")
                                    : PlatformWording.tapOrClick(tap: "Tap to open or save", click: "Click to open or save")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 0)
                if fetching == p.id { ProgressView().scaleEffect(0.8) }
                else { Image(systemName: p.isImage ? "arrow.up.left.and.arrow.down.right" : "square.and.arrow.down").font(.system(size: 13)).foregroundStyle(NX.success) }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.success.opacity(0.08), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.success.opacity(0.3)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// A picture opens here; any other file is fetched with the session and handed to the share sheet.
    private func open(_ p: SubmissionProof) async {
        if p.isImage, let url = p.absoluteURL { viewingPhoto = PhotoRef(url: url, name: p.name); return }
        guard let raw = p.url else { return }
        fetching = p.id
        defer { fetching = nil }
        do {
            let file = try await APIClient.shared.downloadAttachment(url: raw, fileName: p.name ?? "proof")
            shareItem = ShareItem(url: file)
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't open the file.")
        }
    }

    @ViewBuilder private func historyList(_ d: MySubmissionDetail) -> some View {
        let rows = d.history ?? []
        if !rows.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                sectionTitle(T("Status history"))
                ForEach(rows) { h in
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(subDateText(h.at, time: true)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        Text(h.to.map { String(format: T("Moved to %@"), subStatusWord($0)) } ?? T("Status changed"))
                            .font(NXFont.text(13)).foregroundStyle(NX.foreground)
                        if let by = h.by, !by.isEmpty { Text("· \(by)").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
                    }
                }
            }
        }
    }

    @ViewBuilder private func comments(_ d: MySubmissionDetail) -> some View {
        let list = d.comments ?? []
        VStack(alignment: .leading, spacing: 8) {
            sectionTitle(T("Comments"))
            if list.isEmpty {
                Text(T("No comments yet. Ask the team here if something is unclear.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
            ForEach(list) { c in
                let mine = c.mine == true
                VStack(alignment: .leading, spacing: 3) {
                    Text("\(mine ? T("You") : (c.user?.name ?? T("Someone"))) · \(subDateText(c.createdAt, time: true))")
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    Text(c.content ?? "").font(NXFont.text(14)).foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true).textSelection(.enabled)
                }
                .padding(.horizontal, 12).padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(mine ? NX.violet.opacity(0.10) : NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .padding(mine ? .leading : .trailing, 32)
            }
            if d.taskId != nil {
                HStack(alignment: .bottom, spacing: 8) {
                    TextField(T("Reply to the team…"), text: $reply, axis: .vertical)
                        .font(NXFont.text(14)).lineLimit(1...5)
                        .padding(10)
                        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
                    Button { Task { await sendReply() } } label: {
                        Group {
                            if sending { ProgressView().tint(.white).scaleEffect(0.7) }
                            else { Image(systemName: "paperplane.fill").font(.system(size: 14, weight: .bold)).foregroundStyle(.white) }
                        }
                        .frame(width: 44, height: 44)
                        .background(NX.violetFill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(T("Send"))
                    .disabled(reply.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || sending)
                }
            }
        }
    }

    private var deleteRow: some View {
        HStack(alignment: .center, spacing: 12) {
            Text(T("Deleting this submission also deletes its task in the project.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            Spacer(minLength: 0)
            Button(role: .destructive) { confirmDelete = true } label: {
                HStack(spacing: 6) {
                    if deleting { ProgressView().scaleEffect(0.7) } else { Image(systemName: "trash") }
                    Text(T("Delete"))
                }
                .font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                .padding(.horizontal, 12).frame(minHeight: 44).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(deleting)
        }
        .padding(.top, 8)
    }

    private func load(quiet: Bool = false) async {
        do {
            detail = try await APIClient.shared.mySubmissionDetail(submissionId)
            failure = nil
        }
        catch APIError.unauthorized { auth.logout() }
        catch APIError.http(let code, _) { if !quiet || detail == nil { failure = code } }
        catch { if !quiet || detail == nil { failure = 0 } }
        loading = false
    }

    /// One reply in flight at a time (bughunt N-BUG-2: a double tap posted it twice). The box is cleared
    /// only after the server has the reply.
    private func sendReply() async {
        let text = reply.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        sending = true
        defer { sending = false }
        do {
            try await APIClient.shared.replyToSubmission(submissionId, content: text)
            if reply.trimmingCharacters(in: .whitespacesAndNewlines) == text { reply = "" }
            await load(quiet: true)
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't send the reply.")
        }
    }

    private func deleteSubmission() async {
        guard !deleting else { return }
        deleting = true
        defer { deleting = false }
        do {
            try await APIClient.shared.deleteSubmission(submissionId)
            dismiss()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete the submission.")
        }
    }
}

/// A title whose parenthesised part never breaks across lines: "(SP I/ II/III)" broke after "I/" on a
/// submissions card (UI tour run 11, MC-15). Inside parentheses, spaces become no-break spaces and a word
/// joiner follows each slash, so the line breaks before "(" instead.
func nxUnbreakableParentheses(_ s: String) -> String {
    var out = ""
    var depth = 0
    for ch in s {
        if ch == "(" { depth += 1 }
        if ch == ")" { depth = max(0, depth - 1) }
        if depth > 0 && ch == " " {
            out.append("\u{00A0}")
        } else {
            out.append(ch)
            if depth > 0 && (ch == "/" || ch == "-") { out.append("\u{2060}") }
        }
    }
    return out
}
