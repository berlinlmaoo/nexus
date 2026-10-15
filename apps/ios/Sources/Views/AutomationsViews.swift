import SwiftUI
import UIKit

// A project's Automations tab (DEV server, rebuilt 12 Oct 2026, owner: "like Notion's When / If / Do").
// The web's AutomationsView.tsx + AutomationBuilder.tsx: a list of rules with what each one does in one
// readable line, its last run and run count, on/off for the people who may change it (`canEdit`: project
// leads), a run log, "Run now", and the When / If / Do builder. Live through `automations-changed`.

extension AutomationContext {
    init(detail: ProjectDetail?, fields: [CustomField], forms: [NexusForm]) {
        self.init()
        sections = (detail?.taskLists ?? []).map { (id: $0.id, name: $0.name) }
        members = (detail?.members ?? []).filter { !$0.uid.isEmpty }
            .map { (id: $0.uid, name: $0.displayName) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
        self.fields = fields.map { (id: $0.id, name: $0.name, type: $0.type, choices: $0.choices) }
        self.forms = forms.map { (id: $0.id, name: $0.name) }
        tasks = Array((detail?.allTasks ?? []).prefix(300)).map { (id: $0.id, title: $0.title) }
    }
}

enum AutoTime {
    private static var locale: Locale { Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_US") }

    static func relative(_ iso: String?) -> String {
        guard let d = ProjDate.parse(iso) else { return "" }
        if Date().timeIntervalSince(d) < 45 { return T("just now") }
        let f = RelativeDateTimeFormatter()
        f.locale = locale
        f.unitsStyle = .short
        return f.localizedString(for: min(d, Date()), relativeTo: Date())
    }

    /// "12 Oct, 09:00 WIB".
    static func stamp(_ iso: String?, seconds: Bool = false) -> String {
        guard let d = ProjDate.parse(iso) else { return "" }
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = ProjDate.cal.timeZone
        f.dateFormat = seconds ? "d MMM HH:mm:ss" : "EEE d MMM HH:mm"
        return f.string(from: d) + " WIB"
    }
}

/// Run status as a coloured dot, as on the web.
struct AutomationRunDot: View {
    let status: String?
    var body: some View {
        Circle().fill(color).frame(width: 8, height: 8).accessibilityHidden(true)
    }
    private var color: Color {
        switch status {
        case "SUCCESS": return NX.success
        case "PARTIAL": return NX.warning
        case "FAILED": return NX.danger
        case "RUNNING": return NX.violet
        default: return NX.mutedFg.opacity(0.5)
        }
    }
}

// MARK: - The tab

struct AutomationsTab: View {
    let projectId: String
    @Environment(AuthStore.self) private var auth
    @State private var rules: [Automation] = []
    @State private var canEdit = false
    @State private var loading = true
    @State private var failed = false
    @State private var ctx = AutomationContext()
    /// Optimistic on/off while the PATCH is in flight.
    @State private var toggled: [String: Bool] = [:]
    @State private var sheet: AutomationSheetRoute?
    @State private var deleting: Automation?
    @State private var problem: String?

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if failed && rules.isEmpty {
                ErrorState(message: T("Couldn't load the automations of this project."), icon: "bolt.slash") { Task { await load() } }
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header
                        if rules.isEmpty {
                            EmptyState(icon: "bolt", title: T("No automations yet"),
                                       subtitle: canEdit ? T("Set one up: pick what starts it, filter which tasks, then what NEXUS should do.") : T("People with Full access can set up automations here."),
                                       actionTitle: canEdit ? T("New automation") : nil,
                                       action: canEdit ? { sheet = .new } : nil)
                                .padding(.top, 20)
                        } else {
                            VStack(spacing: 10) { ForEach(rules) { row($0) } }
                        }
                    }
                    .padding(16)
                    .frame(maxWidth: 820)
                    .frame(maxWidth: .infinity)
                }
                .refreshable { await load() }
            }
        }
        .task { await load() }
        // Rules edited, toggled or run anywhere (a colleague, the web, the clock) show here at once.
        .liveRefresh(every: 120, on: [.nexusAutomationsChanged], projectId: projectId) { await load(quiet: true) }
        .sheet(item: $sheet) { route in
            AutomationSheet(route: route, projectId: projectId, rules: rules, ctx: ctx, canEdit: canEdit) {
                await load(quiet: true)
            }
        }
        .alert(String(format: T("Delete “%@”?"), deleting?.name ?? ""), isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button(T("Cancel"), role: .cancel) { deleting = nil }
            Button(T("Delete"), role: .destructive) {
                if let a = deleting { Task { await delete(a) } }
                deleting = nil
            }
        } message: {
            Text(T("It stops running right away. Its run log goes with it. You can restore it from Control Room → Audit."))
        }
        .alert(T("Automations"), isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
            Button("OK") { problem = nil }
        } message: { Text(problem ?? "") }
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Label(T("Automations"), systemImage: "bolt.fill").font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
                Text(T("When something happens in this project, NEXUS does the next step for you."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 6)
            if canEdit {
                Button { sheet = .new } label: {
                    Label(T("New automation"), systemImage: "plus").font(NXFont.text(13, .semibold))
                        .foregroundStyle(.white).padding(.horizontal, 12).padding(.vertical, 8)
                        .background(NX.violet, in: Capsule())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func isOn(_ a: Automation) -> Bool { toggled[a.id] ?? a.enabled ?? false }

    private func row(_ a: Automation) -> some View {
        let on = isOn(a)
        return HStack(alignment: .top, spacing: 12) {
            if canEdit {
                Toggle("", isOn: Binding(get: { on }, set: { v in Task { await toggle(a, v) } }))
                    .labelsHidden().tint(NX.violetText)
                    .accessibilityLabel(String(format: T("Turn %@ on or off"), a.name))
            } else {
                Image(systemName: "bolt.fill").font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(on ? NX.warning : NX.mutedFg)
                    .frame(width: 30, height: 30)
                    .background((on ? NX.warning : NX.mutedFg).opacity(0.12), in: Circle())
                    .accessibilityLabel(on ? T("On") : T("Off"))
            }
            Button { sheet = .detail(a.id, .rule) } label: {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(spacing: 6) {
                        Text(a.name).font(NXFont.text(15, .bold)).foregroundStyle(on ? NX.foreground : NX.mutedFg).lineLimit(1)
                        if !canEdit { NexusChip(text: on ? T("On") : T("Off"), tone: on ? .success : .neutral) }
                    }
                    Text(ctx.summary(a)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                    lastRunLine(a)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Menu {
                Button { sheet = .detail(a.id, .rule) } label: { Label(canEdit ? T("Edit") : T("View"), systemImage: "bolt") }
                Button { sheet = .detail(a.id, .runs) } label: { Label(T("Run log"), systemImage: "clock.arrow.circlepath") }
                if canEdit {
                    Button(role: .destructive) { deleting = a } label: { Label(T("Delete"), systemImage: "trash") }
                }
            } label: {
                Image(systemName: "ellipsis").font(.system(size: 14, weight: .bold)).foregroundStyle(NX.mutedFg)
                    .frame(width: 32, height: 32).contentShape(Rectangle())
            }
            .accessibilityLabel(String(format: T("More for %@"), a.name))
        }
        .nexusCard(padding: 14, radius: 18)
    }

    @ViewBuilder private func lastRunLine(_ a: Automation) -> some View {
        HStack(spacing: 6) {
            if a.lastRunAt != nil {
                AutomationRunDot(status: a.lastRunStatus)
                Text("\(AutomationVocab.runStatusLabel(a.lastRunStatus)) · \(AutoTime.relative(a.lastRunAt))")
                if let n = a.runCount, n > 0 {
                    Text("· " + String(format: n == 1 ? T("%d run") : T("%d runs"), n))
                }
            } else {
                Text(T("Never ran"))
            }
            if let next = a.nextRunAt, isOn(a) {
                Text("· " + String(format: T("Next run: %@"), AutoTime.stamp(next)))
            }
        }
        .font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg)
        .lineLimit(1)
    }

    private func load(quiet: Bool = false) async {
        do {
            let r = try await APIClient.shared.automations(projectId)
            rules = r.automations ?? []
            canEdit = r.canEdit ?? false
            toggled = [:]
            failed = false
        }
        catch APIError.unauthorized { auth.logout() }
        catch { if !quiet { failed = true } }
        loading = false
        // The names a summary needs; each optional, the list draws without them.
        let detail = try? await APIClient.shared.project(projectId)
        let fields = (try? await APIClient.shared.projectCustomFields(projectId)) ?? []
        let forms = (try? await APIClient.shared.forms(projectId: projectId)) ?? []
        ctx = AutomationContext(detail: detail, fields: fields, forms: forms)
    }

    private func toggle(_ a: Automation, _ on: Bool) async {
        toggled[a.id] = on
        do { try await APIClient.shared.updateAutomation(id: a.id, enabled: on) }
        catch {
            toggled[a.id] = nil
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't change it.")
        }
        await load(quiet: true)
    }

    private func delete(_ a: Automation) async {
        do { try await APIClient.shared.deleteAutomation(id: a.id) }
        catch { problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete it.") }
        await load(quiet: true)
    }
}

enum AutomationSheetRoute: Identifiable, Hashable {
    enum Pane: Hashable { case rule, runs }
    case new
    case detail(String, Pane)
    var id: String {
        switch self {
        case .new: return "new"
        case .detail(let id, _): return id
        }
    }
}

// MARK: - One rule: read, edit, run, run log

struct AutomationSheet: View {
    let route: AutomationSheetRoute
    let projectId: String
    let rules: [Automation]
    let ctx: AutomationContext
    let canEdit: Bool
    let onChange: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pane: AutomationSheetRoute.Pane = .rule
    @State private var editing = false
    @State private var runTaskId = ""
    @State private var running = false
    @State private var runMessage: String?
    @State private var runLogVersion = 0

    private var automation: Automation? {
        if case .detail(let id, _) = route { return rules.first { $0.id == id } }
        return nil
    }

    var body: some View {
        NavigationStack {
            Group {
                if automation == nil || editing {
                    AutomationBuilder(projectId: projectId, automation: automation, ctx: ctx) {
                        await onChange()
                        if automation == nil { dismiss() } else { editing = false }
                    }
                } else if let a = automation {
                    detailPane(a)
                }
            }
            .navigationTitle(automation?.name ?? T("New automation"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { sheetToolbar }
        }
        .onAppear { if case .detail(_, let p) = route { pane = p } }
        .alert(T("Run now"), isPresented: Binding(get: { runMessage != nil }, set: { if !$0 { runMessage = nil } })) {
            Button("OK") { runMessage = nil }
        } message: { Text(runMessage ?? "") }
    }

    // Split out of `body` so the type checker gets small expressions (Xcode gave up on the whole body).
    private func detailPane(_ a: Automation) -> some View {
        VStack(spacing: 0) {
            Picker("", selection: $pane) {
                Text(T("Rule")).tag(AutomationSheetRoute.Pane.rule)
                Text(runLogTitle(a)).tag(AutomationSheetRoute.Pane.runs)
            }
            .pickerStyle(.segmented)
            .padding(.horizontal, 16).padding(.vertical, 10)
            if pane == .rule {
                AutomationReadView(automation: a, ctx: ctx, canEdit: canEdit)
            } else {
                AutomationRunLog(automationId: a.id, projectId: projectId).id(runLogVersion)
            }
            if canEdit { runBar(a) }
        }
        .background(NX.background)
    }

    private func runLogTitle(_ a: Automation) -> String {
        let count: Int = a.runCount ?? 0
        return count > 0 ? T("Run log") + " · \(count)" : T("Run log")
    }

    private var closeTitle: String {
        if editing || automation == nil { return T("Cancel") }
        return T("Close")
    }

    @ToolbarContentBuilder
    private var sheetToolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            Button(closeTitle) {
                if editing { editing = false } else { dismiss() }
            }
        }
        if canEdit, automation != nil, !editing {
            ToolbarItem(placement: .topBarTrailing) { Button(T("Edit")) { editing = true } }
        }
    }

    /// "Run now", once, optionally on one task (project leads; the run lands in the log as "manual").
    private func runBar(_ a: Automation) -> some View {
        VStack(spacing: 0) {
            Divider().overlay(NX.border)
            HStack(spacing: 10) {
                Picker(T("Task to run on"), selection: $runTaskId) {
                    Text(T("No task")).tag("")
                    ForEach(ctx.tasks, id: \.id) { Text($0.title).lineLimit(1).tag($0.id) }
                }
                .pickerStyle(.menu)
                .tint(NX.foreground)
                Spacer(minLength: 0)
                Button { Task { await runNow(a) } } label: {
                    HStack(spacing: 6) {
                        if running { ProgressView().tint(.white).scaleEffect(0.8) } else { Image(systemName: "play.fill") }
                        Text(T("Run now"))
                    }
                    .font(NXFont.text(13, .semibold)).foregroundStyle(.white)
                    .padding(.horizontal, 14).padding(.vertical, 9)
                    .background(NX.violet, in: Capsule())
                }
                .buttonStyle(.plain)
                .disabled(running)
            }
            .padding(.horizontal, 16).padding(.vertical, 10)
        }
        .background(NX.card)
    }

    private func runNow(_ a: Automation) async {
        running = true; defer { running = false }
        do {
            let r = try await APIClient.shared.runAutomation(id: a.id, taskId: runTaskId.isEmpty ? nil : runTaskId)
            if let run = r.run {
                runMessage = String(format: T("Ran: %@"), AutomationVocab.runStatusLabel(run.status))
                pane = .runs
                runLogVersion += 1
            } else {
                runMessage = T("Nothing ran: the task doesn't meet the conditions.")
            }
            await onChange()
        } catch {
            runMessage = (error as? LocalizedError)?.errorDescription ?? T("Couldn't run it.")
        }
    }
}

/// The rule as sentences: When, If, Do, with the trigger's details (schedule).
struct AutomationReadView: View {
    let automation: Automation
    let ctx: AutomationContext
    let canEdit: Bool

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 12) {
                if !canEdit {
                    Label(T("View only: people with Full access edit automations"), systemImage: "lock")
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                block(T("When"), icon: AutomationVocab.trigger(automation.trigger?.type)?.symbol ?? "bolt") {
                    Text(ctx.triggerText(automation.trigger)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    if let next = automation.nextRunAt, automation.enabled ?? false {
                        Text(String(format: T("Next run: %@"), AutoTime.stamp(next))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    }
                }
                block(T("If (optional)"), icon: "line.3.horizontal.decrease") {
                    if let c = automation.conditions, !c.rules.isEmpty {
                        ForEach(Array(c.rules.enumerated()), id: \.offset) { i, r in
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                if i > 0 { Text(c.match == "any" ? T("or") : T("and")).font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg) }
                                Text(ctx.conditionText(r)).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                            }
                        }
                    } else {
                        Text(T("No conditions: every matching event runs it.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    }
                }
                block(T("Do"), icon: "bolt.fill") {
                    ForEach(Array(automation.allActions.enumerated()), id: \.offset) { i, a in
                        HStack(alignment: .firstTextBaseline, spacing: 8) {
                            Text("\(i + 1)").font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg)
                                .frame(width: 18, height: 18).background(NX.muted, in: Circle())
                            Image(systemName: AutomationVocab.action(a.type)?.symbol ?? "bolt").font(.system(size: 12)).foregroundStyle(NX.violetText)
                            Text(ctx.actionText(a)).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .padding(16)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
    }

    private func block<C: View>(_ title: String, icon: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(title, systemImage: icon).font(NXFont.text(12, .bold)).foregroundStyle(NX.violetText)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14, radius: 16)
    }
}

// MARK: - Run log

struct AutomationRunLog: View {
    let automationId: String
    let projectId: String
    @State private var runs: [AutomationRun] = []
    @State private var hasMore = false
    @State private var loading = true
    @State private var loadingMore = false
    @State private var failed = false

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if failed && runs.isEmpty {
                ErrorState(message: T("Couldn't load the run log."), icon: "clock.arrow.circlepath") { Task { await load() } }
            } else if runs.isEmpty {
                EmptyState(icon: "bolt", title: T("No runs yet"), subtitle: T("Each time this automation fires, it shows up here with what it did."))
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(runs) { r in
                        DisclosureGroup {
                            steps(r)
                        } label: {
                            runLabel(r)
                        }
                    }
                    if hasMore {
                        Button { Task { await loadMore() } } label: {
                            HStack { Spacer(); Text(loadingMore ? T("Loading…") : T("Load older runs")); Spacer() }
                                .font(NXFont.text(13, .semibold))
                        }
                        .disabled(loadingMore)
                    }
                }
                .listStyle(.insetGrouped)
                .refreshable { await load() }
            }
        }
        .task { await load() }
        .liveRefresh(every: 120, on: [.nexusAutomationsChanged], projectId: projectId) { await load() }
    }

    // Plain functions instead of inline ternary/optional chains: Xcode's type checker gave up on them.
    private func runTitle(_ r: AutomationRun) -> String {
        let event: String = AutomationVocab.eventLabel(r.event)
        if let title = r.task?.title { return event + " · " + title }
        if r.taskId != nil { return event + " · " + T("(task deleted)") }
        return event
    }

    private func runSubtitle(_ r: AutomationRun) -> String {
        let stamp: String = AutoTime.stamp(r.createdAt, seconds: true)
        if let name = r.actor?.name { return stamp + " · " + name }
        return stamp
    }

    private func stepIcon(_ s: AutomationRun.Step) -> String {
        if s.ok == false { return "exclamationmark.triangle.fill" }
        if s.skipped == true { return "circle" }
        return "checkmark"
    }

    private func stepTint(_ s: AutomationRun.Step) -> Color {
        if s.ok == false { return NX.danger }
        if s.skipped == true { return NX.mutedFg }
        return NX.success
    }

    private func stepTitle(_ s: AutomationRun.Step) -> String {
        if let label = AutomationVocab.action(s.type)?.label { return T(label) }
        return humanizeEnum(s.type ?? "")
    }

    private func runLabel(_ r: AutomationRun) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(runTitle(r))
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(2)
                Text(runSubtitle(r))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 4)
            HStack(spacing: 5) {
                AutomationRunDot(status: r.status)
                Text(AutomationVocab.runStatusLabel(r.status)).font(NXFont.text(11, .semibold)).foregroundStyle(NX.foreground)
            }
        }
    }

    @ViewBuilder private func steps(_ r: AutomationRun) -> some View {
        let list = r.steps ?? []
        if list.isEmpty {
            Text(T("No actions ran.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        ForEach(Array(list.enumerated()), id: \.offset) { _, s in
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: stepIcon(s))
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(stepTint(s))
                VStack(alignment: .leading, spacing: 1) {
                    Text(stepTitle(s))
                        .font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
                    Text(s.message ?? "").font(NXFont.text(12)).foregroundStyle(s.ok == false ? NX.danger : NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        if let ms = r.durationMs {
            Text(String(format: T("%d ms"), ms)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
    }

    private func load() async {
        do {
            let r = try await APIClient.shared.automationRuns(automationId: automationId)
            runs = r.runs ?? []
            hasMore = r.hasMore ?? false
            failed = false
        } catch { failed = true }
        loading = false
    }

    private func loadMore() async {
        guard let last = runs.last?.createdAt else { return }
        loadingMore = true; defer { loadingMore = false }
        if let r = try? await APIClient.shared.automationRuns(automationId: automationId, before: last) {
            runs += r.runs ?? []
            hasMore = r.hasMore ?? false
        }
    }
}

// MARK: - Automation-authored comments

/// The ⚡ avatar of the system actor "Automation" (a comment an automation wrote). Not a person, so it
/// opens no profile.
struct AutomationAvatar: View {
    var size: CGFloat = 20
    var body: some View {
        Image(systemName: "bolt.fill")
            .font(.system(size: size * 0.5, weight: .bold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(NX.warning, in: Circle())
            .accessibilityLabel(T("Automation"))
    }
}
