import SwiftUI

/// Indonesian-rupiah currency string.
func idr(_ n: Double) -> String {
    let f = NumberFormatter(); f.numberStyle = .currency; f.currencyCode = "IDR"
    f.maximumFractionDigits = 0; f.locale = Locale(identifier: "id_ID")
    return f.string(from: NSNumber(value: n)) ?? "Rp0"
}

// ============================================================================
// MARK: - Sprints
// ============================================================================

struct SprintsResponse: Decodable, Sendable { let sprints: [Sprint]? }
struct Sprint: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let status: String?
    let startDate: String?
    let endDate: String?
    let tasks: [SprintTask]?
    struct SprintTask: Decodable, Sendable { let task: TaskRef? }
    struct TaskRef: Decodable, Identifiable, Sendable { let id: String; let title: String?; let status: String? }

    var taskRefs: [TaskRef] { (tasks ?? []).compactMap { $0.task } }
    var doneCount: Int { taskRefs.filter { ($0.status ?? "").uppercased() == "DONE" }.count }
    var progress: Double { taskRefs.isEmpty ? 0 : Double(doneCount) / Double(taskRefs.count) }
    var nextStatus: String? {
        switch (status ?? "PLANNING").uppercased() { case "PLANNING": return "ACTIVE"; case "ACTIVE": return "COMPLETED"; default: return nil }
    }
    var nextLabel: String? {
        switch (status ?? "PLANNING").uppercased() { case "PLANNING": return "Mulai"; case "ACTIVE": return "Selesaikan"; default: return nil }
    }
}

struct SprintsTab: View {
    let projectId: String
    let onOpen: (String) -> Void
    @Environment(AuthStore.self) private var auth
    @State private var sprints: [Sprint] = []
    @State private var loading = true
    @State private var expanded: String?
    @State private var showCreate = false

    private var active: Int { sprints.filter { ($0.status ?? "").uppercased() == "ACTIVE" }.count }
    private var planning: Int { sprints.filter { ($0.status ?? "").uppercased() == "PLANNING" }.count }
    private var shipped: Int { sprints.filter { ($0.status ?? "").uppercased() == "COMPLETED" }.count }

    var body: some View {
        Group {
            if loading {
                ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header
                        if sprints.isEmpty {
                            TabEmpty(icon: "target", text: "Belum ada sprint. Bikin cycle buat fokusin eksekusi.")
                        } else {
                            ForEach(sprints) { sprintCard($0) }
                        }
                    }.padding(16)
                }
            }
        }
        .task { await load() }
        .sheet(isPresented: $showCreate) { CreateSprintSheet(projectId: projectId) { await load() } }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Label("Sprint Arena", systemImage: "target").font(NXFont.text(11, .bold)).foregroundStyle(NX.violet)
                    Text("Jalanin mission per cycle.").font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
                }
                Spacer()
                Button { showCreate = true } label: {
                    Label("Sprint", systemImage: "plus").font(NXFont.text(12, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 8).background(NX.violet, in: Capsule())
                }.buttonStyle(.plain)
            }
            HStack(spacing: 10) {
                metric("Active", active); metric("Planning", planning); metric("Shipped", shipped)
            }
        }.nexusCard()
    }
    private func metric(_ label: String, _ v: Int) -> some View {
        VStack(spacing: 2) {
            Text("\(v)").font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(10, .medium)).foregroundStyle(NX.mutedFg)
        }.frame(maxWidth: .infinity).padding(.vertical, 10).background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private func sprintCard(_ s: Sprint) -> some View {
        let isOpen = expanded == s.id
        return VStack(alignment: .leading, spacing: 10) {
            Button { expanded = isOpen ? nil : s.id } label: {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(s.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                        sprintChip(s.status)
                        Spacer()
                        Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).foregroundStyle(NX.mutedFg).rotationEffect(.degrees(isOpen ? 90 : 0))
                    }
                    Text("\(dateLabel(s.startDate)) → \(dateLabel(s.endDate))").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(NX.muted)
                            Capsule().fill(NX.success).frame(width: geo.size.width * s.progress)
                        }
                    }.frame(height: 6)
                    Text("\(s.doneCount)/\(s.taskRefs.count) card kelar · \(Int(s.progress * 100))%").font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                }
            }.buttonStyle(.plain)

            if isOpen {
                if s.taskRefs.isEmpty {
                    Text("Belum ada card di sprint ini.").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                } else {
                    ForEach(s.taskRefs) { t in
                        Button { onOpen(t.id) } label: {
                            HStack(spacing: 8) {
                                Image(systemName: (t.status ?? "").uppercased() == "DONE" ? "checkmark.circle.fill" : "circle")
                                    .foregroundStyle((t.status ?? "").uppercased() == "DONE" ? NX.success : NX.mutedFg.opacity(0.5))
                                Text(t.title ?? "Untitled").font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1)
                                Spacer()
                            }.padding(.vertical, 4)
                        }.buttonStyle(.plain)
                    }
                }
                if let next = s.nextStatus, let label = s.nextLabel {
                    Button { Task { try? await APIClient.shared.updateSprint(id: s.id, status: next); await load() } } label: {
                        Text(label).font(NXFont.text(13, .bold)).foregroundStyle(.white)
                            .frame(maxWidth: .infinity).padding(.vertical, 10).background(NX.violet, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                    }.buttonStyle(.plain)
                }
            }
        }.nexusCard()
    }

    private func sprintChip(_ status: String?) -> some View {
        let s = (status ?? "PLANNING").uppercased()
        let tone: ChipTone = s == "ACTIVE" ? .success : s == "COMPLETED" ? .info : .neutral
        return NexusChip(text: s.capitalized, tone: tone)
    }
    private func dateLabel(_ iso: String?) -> String { ProjDate.parse(iso).map { ProjDate.dayLabel($0) } ?? "—" }

    private func load() async {
        do { sprints = (try await APIClient.shared.sprints(projectId)).sprints ?? [] }
        catch APIError.unauthorized { auth.logout() } catch { sprints = [] }
        loading = false
    }
}

struct CreateSprintSheet: View {
    let projectId: String
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var start = Date()
    @State private var end = Date().addingTimeInterval(13 * 86400)
    @State private var busy = false
    @State private var err: String?

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        field("NAMA SPRINT") {
                            TextField("mis. Launch Week 01", text: $name).font(NXFont.text(16)).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        HStack(spacing: 12) {
                            field("MULAI") { DatePicker("", selection: $start, displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violet) }
                            field("SELESAI") { DatePicker("", selection: $end, in: start..., displayedComponents: .date).datePickerStyle(.compact).labelsHidden().tint(NX.violet) }
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await create() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text("Bikin sprint") }
                        }.buttonStyle(NexusPrimaryButton()).disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }.padding(20)
                }
            }
            .navigationTitle("Sprint baru").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Batal") { dismiss() } } }
        }
    }
    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) { SectionLabel(label); content() }
            .frame(maxWidth: .infinity, alignment: .leading)
    }
    private func create() async {
        busy = true; err = nil; defer { busy = false }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = ProjDate.cal.timeZone
        do {
            try await APIClient.shared.createSprint(projectId: projectId, name: name.trimmingCharacters(in: .whitespaces), startDate: f.string(from: start), endDate: f.string(from: end))
            await onCreated(); dismiss()
        } catch { err = (error as? LocalizedError)?.errorDescription ?? "Gagal bikin sprint." }
    }
}

// ============================================================================
// MARK: - Automations
// ============================================================================

struct AutomationsResponse: Decodable, Sendable { let automations: [Automation]? }
struct Automation: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let enabled: Bool?
    let trigger: Rule?
    let action: Rule?
    struct Rule: Decodable, Sendable { let type: String?; let field: String?; let value: String? }
    func ruleText(_ r: Rule?) -> String {
        guard let r else { return "—" }
        var s = humanizeEnum(r.type ?? "")
        if let f = r.field, !f.isEmpty { s += " · \(humanizeEnum(f))" }
        if let v = r.value, !v.isEmpty { s += " = \(v)" }
        return s
    }
}

struct AutomationsTab: View {
    let projectId: String
    @Environment(AuthStore.self) private var auth
    @State private var rules: [Automation] = []
    @State private var loading = true

    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if rules.isEmpty { TabEmpty(icon: "bolt.slash", text: "Belum ada automation. Atur rule otomatis lewat web (desktop).") }
            else {
                ScrollView {
                    VStack(spacing: 12) { ForEach(rules) { card($0) } }.padding(16)
                }
            }
        }
        .task { await load() }
    }

    private func card(_ a: Automation) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "bolt.fill").font(.system(size: 13)).foregroundStyle((a.enabled ?? false) ? NX.warning : NX.mutedFg)
                Text(a.name).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer()
                Toggle("", isOn: Binding(get: { a.enabled ?? false }, set: { on in Task { try? await APIClient.shared.updateAutomation(id: a.id, enabled: on); await load() } }))
                    .labelsHidden().tint(NX.violet)
            }
            HStack(alignment: .top, spacing: 8) {
                badge("KALAU", a.ruleText(a.trigger), NX.blue)
                Image(systemName: "arrow.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg).padding(.top, 6)
                badge("MAKA", a.ruleText(a.action), NX.violet)
            }
        }.nexusCard()
    }
    private func badge(_ label: String, _ text: String, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(NXFont.text(9, .bold)).foregroundStyle(tint)
            Text(text).font(NXFont.text(12)).foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(8)
        .background(tint.opacity(0.08), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
    private func load() async {
        do { rules = (try await APIClient.shared.automations(projectId)).automations ?? [] }
        catch APIError.unauthorized { auth.logout() } catch { rules = [] }
        loading = false
    }
}

// ============================================================================
// MARK: - Finance dashboard (read-only)
// ============================================================================

struct FinanceDashboard: Decodable, Sendable {
    let year: Int
    let categories: [FinCategory]?
    let totals: FinTotals?
    struct FinCategory: Decodable, Identifiable, Sendable {
        let id: String; let kind: String; let name: String; let lineItems: [FinLine]?; let subtotal: Double?
    }
    struct FinLine: Decodable, Identifiable, Sendable { let id: String; let name: String; let total: Double? }
    struct FinTotals: Decodable, Sendable { let opexTotal: Double?; let revenueTotal: Double?; let profitTotal: Double? }
}

struct FinanceTab: View {
    let projectId: String
    @Environment(AuthStore.self) private var auth
    @State private var data: FinanceDashboard?
    @State private var year = Calendar.current.component(.year, from: Date())
    @State private var loading = true

    private var revenue: [FinanceDashboard.FinCategory] { (data?.categories ?? []).filter { $0.kind.uppercased() == "REVENUE" } }
    private var opex: [FinanceDashboard.FinCategory] { (data?.categories ?? []).filter { $0.kind.uppercased() == "OPEX" } }

    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if data == nil { TabEmpty(icon: "banknote", text: "Finance belum tersedia buat project ini.") }
            else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        yearRow
                        let cols = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
                        LazyVGrid(columns: cols, spacing: 10) {
                            total("Revenue", data?.totals?.revenueTotal ?? 0, NX.success)
                            total("OPEX", data?.totals?.opexTotal ?? 0, NX.danger)
                            total("Profit", data?.totals?.profitTotal ?? 0, NX.violet)
                        }
                        if !revenue.isEmpty { categoryGroup("REVENUE", revenue, NX.success) }
                        if !opex.isEmpty { categoryGroup("OPEX", opex, NX.danger) }
                    }.padding(16)
                }
            }
        }
        .task { await load() }
    }

    private var yearRow: some View {
        HStack {
            Button { year -= 1; Task { await load() } } label: { Image(systemName: "chevron.left").foregroundStyle(NX.foreground) }
            Spacer(); Text(String(year)).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground); Spacer()
            Button { year += 1; Task { await load() } } label: { Image(systemName: "chevron.right").foregroundStyle(NX.foreground) }
        }
    }
    private func total(_ label: String, _ v: Double, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(idr(v)).font(NXFont.text(14, .bold)).foregroundStyle(tint).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(NXFont.text(10, .medium)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))
    }
    private func categoryGroup(_ label: String, _ cats: [FinanceDashboard.FinCategory], _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(label).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(tint)
            ForEach(cats) { c in
                VStack(alignment: .leading, spacing: 6) {
                    HStack { Text(c.name).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground); Spacer(); Text(idr(c.subtotal ?? 0)).font(NXFont.text(13, .bold)).foregroundStyle(tint) }
                    ForEach(c.lineItems ?? []) { li in
                        HStack { Text(li.name).font(NXFont.text(12)).foregroundStyle(NX.mutedFg); Spacer(); Text(idr(li.total ?? 0)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                    }
                }
                .padding(12).background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }.nexusCard()
    }
    private func load() async {
        do { data = try await APIClient.shared.financeDashboard(projectId: projectId, year: year) }
        catch APIError.unauthorized { auth.logout() } catch { data = nil }
        loading = false
    }
}

// ============================================================================
// MARK: - P&L dashboard (read-only)
// ============================================================================

struct PnlDashboard: Decodable, Sendable {
    let year: Int
    let totals: Totals?
    let stages: [Stage]?
    let incomes: [Income]?
    let categories: [Cat]?
    struct Totals: Decodable, Sendable { let income: Double?; let expense: Double?; let profit: Double?; let pipelineTotal: Double?; let pipelineOutstanding: Double?; let paidAllTime: Double? }
    struct Stage: Decodable, Identifiable, Sendable { let id: String; let name: String; let color: String?; let count: Int?; let outstanding: Double? }
    struct Income: Decodable, Identifiable, Sendable { let id: String; let title: String; let totalAmount: Double?; let paid: Double?; let outstanding: Double? }
    struct Cat: Decodable, Identifiable, Sendable { let id: String; let name: String; let color: String?; let total: Double? }
}

struct PnlTab: View {
    let projectId: String
    @Environment(AuthStore.self) private var auth
    @State private var data: PnlDashboard?
    @State private var year = Calendar.current.component(.year, from: Date())
    @State private var loading = true

    var body: some View {
        Group {
            if loading { ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity) }
            else if data == nil { TabEmpty(icon: "dollarsign.circle", text: "P&L belum diaktifin / akses BoD diperlukan.") }
            else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        let cols = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
                        LazyVGrid(columns: cols, spacing: 10) {
                            total("Income", data?.totals?.income ?? 0, NX.success)
                            total("Expense", data?.totals?.expense ?? 0, NX.danger)
                            total("Profit", data?.totals?.profit ?? 0, NX.violet)
                        }
                        if let p = data?.totals?.pipelineOutstanding, p > 0 {
                            HStack {
                                Label("Pipeline outstanding", systemImage: "hourglass").font(NXFont.text(12, .semibold)).foregroundStyle(NX.warning)
                                Spacer(); Text(idr(p)).font(NXFont.text(13, .bold)).foregroundStyle(NX.warning)
                            }.padding(12).background(NX.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                        if let stages = data?.stages, !stages.isEmpty { section("PIPELINE STAGE") { ForEach(stages) { stageRow($0) } } }
                        if let incomes = data?.incomes, !incomes.isEmpty { section("INCOME") { ForEach(incomes) { incomeRow($0) } } }
                        if let cats = data?.categories, !cats.isEmpty { section("EXPENSE CATEGORY") { ForEach(cats) { catRow($0) } } }
                    }.padding(16)
                }
            }
        }
        .task { await load() }
    }

    private func total(_ label: String, _ v: Double, _ tint: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(idr(v)).font(NXFont.text(14, .bold)).foregroundStyle(tint).lineLimit(1).minimumScaleFactor(0.6)
            Text(label).font(NXFont.text(10, .medium)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading).padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous)).overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(NX.border))
    }
    private func section<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) { Text(label).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violet); content() }.nexusCard()
    }
    private func stageRow(_ s: PnlDashboard.Stage) -> some View {
        HStack(spacing: 8) {
            Circle().fill(Color(hex: s.color ?? "#7b68ee")).frame(width: 9, height: 9)
            Text(s.name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            Text("\(s.count ?? 0)").font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg).padding(.horizontal, 6).padding(.vertical, 1).background(NX.muted, in: Capsule())
            Spacer()
            if let o = s.outstanding, o > 0 { Text(idr(o)).font(NXFont.text(12)).foregroundStyle(NX.warning) }
        }
    }
    private func incomeRow(_ i: PnlDashboard.Income) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack { Text(i.title).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1); Spacer(); Text(idr(i.totalAmount ?? 0)).font(NXFont.text(12, .bold)).foregroundStyle(NX.foreground) }
            HStack(spacing: 8) {
                Text("Dibayar \(idr(i.paid ?? 0))").font(NXFont.text(11)).foregroundStyle(NX.success)
                if let o = i.outstanding, o > 0 { Text("Sisa \(idr(o))").font(NXFont.text(11)).foregroundStyle(NX.warning) }
            }
        }.padding(.vertical, 4)
    }
    private func catRow(_ c: PnlDashboard.Cat) -> some View {
        HStack(spacing: 8) {
            Circle().fill(Color(hex: c.color ?? "#94a3b8")).frame(width: 9, height: 9)
            Text(c.name).font(NXFont.text(13)).foregroundStyle(NX.foreground); Spacer()
            Text(idr(c.total ?? 0)).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
        }
    }
    private func load() async {
        do { data = try await APIClient.shared.pnlDashboard(projectId: projectId, year: year) }
        catch APIError.unauthorized { auth.logout() } catch { data = nil }
        loading = false
    }
}
