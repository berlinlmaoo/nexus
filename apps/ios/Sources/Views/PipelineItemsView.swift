import SwiftUI

// MARK: - The v8 deal lists

/// Item endpoints return the whole deal. Keep the server's derived totals and budget balances together
/// with their rows, then refresh the board KPIs using the existing store reload.
extension PipelineStore {
    @discardableResult
    func addItem(_ dealId: String, kind: String, clientRequestId: String) async -> Bool {
        guard canEdit else { return false }
        return await itemWrite {
            try await APIClient.shared.pipelineAddItem(projectId: self.projectId, dealId: dealId,
                                                       kind: kind, clientRequestId: clientRequestId)
        }
    }

    @discardableResult
    func updateItem(_ dealId: String, itemId: String, fields: [String: Any]) async -> Bool {
        guard canEdit else { return false }
        return await itemWrite {
            try await APIClient.shared.pipelineUpdateItem(projectId: self.projectId, dealId: dealId,
                                                          itemId: itemId, fields: fields)
        }
    }

    @discardableResult
    func deleteItem(_ dealId: String, itemId: String, name: String) async -> Bool {
        guard canEdit else { return false }
        let saved = await itemWrite {
            try await APIClient.shared.pipelineDeleteItem(projectId: self.projectId, dealId: dealId, itemId: itemId)
        }
        if saved { notice = String(format: T("%@ deleted. Control Room → Audit can restore it."), name) }
        return saved
    }

    private func itemWrite(_ call: () async throws -> PipelineItemResponse) async -> Bool {
        do {
            let response = try await call()
            if let deal = response.deal { replaceDeal(deal) }
            await load()
            return true
        } catch {
            reportFailure(error, fallback: T("That change wasn't saved. Try again."))
            return false
        }
    }
}

enum PipelineMoneyItemKind: String {
    case cashback, budget

    var title: String { self == .cashback ? T("Cashback") : T("Budget expenses") }
    var addTitle: String { self == .cashback ? T("Add recipient") : T("Add category") }
    var nameLabel: String { self == .cashback ? T("Recipient name") : T("Budget category") }
    var totalLabel: String { self == .cashback ? T("Total cashback") : T("Total budget") }
    var deleteLabel: String { self == .cashback ? T("Delete recipient") : T("Delete category") }
    var identifier: String { self == .cashback ? "pipeline.cashback" : "pipeline.budgets" }
    var empty: String { self == .cashback ? T("No cashback recorded.") : T("No budget recorded.") }
    var explanation: String {
        self == .cashback
            ? T("No cashback. Add who receives a cashback from this deal and how much.")
            : T("No budget yet. Add categories (venue, talent, production) and book real costs against them.")
    }
}

/// Cashback and budget rows share editable name + amount; only budgets have used/remaining figures.
struct PipelineMoneyItemsEditor: View {
    let store: PipelineStore
    let deal: PipelineDeal
    let kind: PipelineMoneyItemKind

    @State private var adding = false
    @State private var requestId: String?
    @State private var deleting: Set<String> = []
    @State private var itemToDelete: Row?

    private struct Row: Identifiable {
        let id: String
        let name: String
        let amount: Double
        let spent: Double?
        let remaining: Double?
    }

    private var rows: [Row] {
        if kind == .cashback {
            return deal.cashback.map { Row(id: $0.id, name: $0.name, amount: $0.amount, spent: nil, remaining: nil) }
        }
        return deal.budgets.map { Row(id: $0.id, name: $0.name, amount: $0.amount, spent: $0.spent, remaining: $0.remaining) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if rows.isEmpty {
                EmptyState(icon: kind == .cashback ? "arrow.uturn.backward.circle" : "chart.pie",
                           title: kind.empty, subtitle: store.canEdit ? kind.explanation : "",
                           compact: true, quietTitle: true)
            } else {
                ForEach(rows) { row in itemRow(row) }
            }
            if store.canEdit {
                Button { add() } label: {
                    HStack(spacing: 6) {
                        if adding { ProgressView().tint(NX.violetText) }
                        Label(kind.addTitle, systemImage: "plus")
                            .font(NXFont.text(14, .semibold))
                    }
                }
                .buttonStyle(.bordered)
                .disabled(adding || rows.count >= 100)
                .accessibilityIdentifier(kind.identifier + ".add")
            }
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(kind.totalLabel).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 4)
                Text(PipelineFormat.idrFull(kind == .cashback ? deal.cashbackTotal : deal.budgetTotal))
                    .font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground).monospacedDigit()
            }
            .padding(12)
            .background(NX.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier(kind.identifier + ".total")
            if kind == .budget {
                Text(T("Book each real cost line against a category below. Budget does not change the margin."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .alert(itemToDelete.map { String(format: T("Delete %@?"), $0.name.isEmpty ? kind.title : $0.name) } ?? "",
               isPresented: Binding(get: { itemToDelete != nil }, set: { if !$0 { itemToDelete = nil } }),
               presenting: itemToDelete) { item in
            Button(T("Cancel"), role: .cancel) { itemToDelete = nil }
            Button(T("Delete"), role: .destructive) {
                itemToDelete = nil
                remove(item)
            }
        } message: { _ in
            Text(T("It leaves this deal for everyone. Control Room → Audit can restore it."))
        }
    }

    private func itemRow(_ row: Row) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            if store.canEdit {
                HStack(spacing: 8) {
                    PipelineTextInput(label: kind.nameLabel, value: row.name,
                                      placeholder: kind == .cashback ? T("Recipient name") : T("e.g. Venue")) {
                        edit(row.id, ["name": $0])
                    }
                    .accessibilityIdentifier(kind.identifier + ".name." + row.id)
                    PipelineMoneyInput(label: kind.title, value: row.amount, rejectNegative: true,
                                       onInvalid: { store.actionError = $0 }) { edit(row.id, ["amount": $0]) }
                        .frame(width: 150)
                        .accessibilityIdentifier(kind.identifier + ".amount." + row.id)
                    Button(role: .destructive) { itemToDelete = row } label: {
                        Image(systemName: "trash").frame(width: 36, height: 40)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(kind.deleteLabel)
                }
                .disabled(deleting.contains(row.id))
            } else {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(row.name.isEmpty ? (kind == .budget ? T("Untitled category") : "–") : row.name)
                    Spacer(minLength: 4)
                    Text(PipelineFormat.idrFull(row.amount)).monospacedDigit()
                }
                .font(NXFont.text(14)).foregroundStyle(NX.foreground)
            }
            if let spent = row.spent, let remaining = row.remaining {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { used(spent); balance(remaining) }
                    VStack(alignment: .leading, spacing: 3) { used(spent); balance(remaining) }
                }
                .accessibilityElement(children: .combine)
                .accessibilityIdentifier("pipeline.budgets.balance." + row.id)
            }
        }
    }

    private func used(_ amount: Double) -> some View {
        Text(String(format: T("Used %@"), PipelineFormat.idrFull(amount)))
            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
    }

    private func balance(_ amount: Double) -> some View {
        Text(String(format: T(amount < 0 ? "Over by %@" : "Remaining %@"), PipelineFormat.idrFull(abs(amount))))
            .font(NXFont.text(12, .semibold))
            .foregroundStyle(amount < 0 ? ChipTone.danger.fg : ChipTone.success.fg).monospacedDigit()
    }

    private func edit(_ id: String, _ fields: [String: Any]) {
        guard !deleting.contains(id) else { return }
        Task { await store.updateItem(deal.id, itemId: id, fields: fields) }
    }

    private func add() {
        guard !adding else { return }
        adding = true
        let key = requestId ?? UUID().uuidString
        requestId = key
        Task {
            if await store.addItem(deal.id, kind: kind.rawValue, clientRequestId: key) { requestId = nil }
            adding = false
        }
    }

    private func remove(_ row: Row) {
        guard !deleting.contains(row.id) else { return }
        deleting.insert(row.id)
        Task {
            await store.deleteItem(deal.id, itemId: row.id, name: row.name.isEmpty ? kind.title : row.name)
            deleting.remove(row.id)
        }
    }
}

struct PipelineContactsEditor: View {
    let store: PipelineStore
    let deal: PipelineDeal

    @State private var adding = false
    @State private var requestId: String?
    @State private var deleting: Set<String> = []
    @State private var itemToDelete: PipelineContact?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if deal.contacts.isEmpty {
                EmptyState(icon: "person.2", title: T("No contacts recorded."),
                           subtitle: store.canEdit ? T("No contacts yet. Add the client, vendor, broker or finance people for this project.") : "",
                           compact: true, quietTitle: true)
            } else {
                ForEach(deal.contacts) { contact in row(contact) }
            }
            if store.canEdit {
                Button { add() } label: {
                    HStack(spacing: 6) {
                        if adding { ProgressView().tint(NX.violetText) }
                        Label(T("Add contact"), systemImage: "plus").font(NXFont.text(14, .semibold))
                    }
                }
                .buttonStyle(.bordered)
                .disabled(adding || deal.contacts.count >= 100)
                .accessibilityIdentifier("pipeline.contacts.add")
            }
        }
        .alert(itemToDelete.map { String(format: T("Delete %@?"), $0.name.isEmpty ? PipelineText.contactRole($0.role) : $0.name) } ?? "",
               isPresented: Binding(get: { itemToDelete != nil }, set: { if !$0 { itemToDelete = nil } }),
               presenting: itemToDelete) { item in
            Button(T("Cancel"), role: .cancel) { itemToDelete = nil }
            Button(T("Delete"), role: .destructive) {
                itemToDelete = nil
                remove(item)
            }
        } message: { _ in
            Text(T("It leaves this deal for everyone. Control Room → Audit can restore it."))
        }
    }

    private func row(_ contact: PipelineContact) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if store.canEdit {
                HStack(spacing: 8) {
                    PipelineMenuInput(label: T("Role"), value: contact.role, options: store.vocab.contactRoles,
                                      text: PipelineText.contactRole) { edit(contact.id, ["role": $0]) }
                        .accessibilityIdentifier("pipeline.contacts.role." + contact.id)
                    Button(role: .destructive) { itemToDelete = contact } label: {
                        Image(systemName: "trash").frame(width: 36, height: 40)
                    }
                    .buttonStyle(.borderless)
                    .accessibilityLabel(T("Delete contact"))
                }
                PipelineTextInput(label: T("Name"), value: contact.name, placeholder: T("Name")) { edit(contact.id, ["name": $0]) }
                    .accessibilityIdentifier("pipeline.contacts.name." + contact.id)
                PipelineTextInput(label: T("Phone"), value: contact.phone, placeholder: T("Phone")) { edit(contact.id, ["phone": $0]) }
                    .accessibilityIdentifier("pipeline.contacts.phone." + contact.id)
            } else {
                Text(PipelineText.contactRole(contact.role)).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                if !contact.name.isEmpty { Text(contact.name).font(NXFont.text(14)).foregroundStyle(NX.foreground) }
                if !contact.phone.isEmpty { Text(contact.phone).font(NXFont.text(14)).foregroundStyle(NX.foreground) }
            }
        }
        .padding(10)
        .background(NX.background, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
        .disabled(deleting.contains(contact.id))
    }

    private func edit(_ id: String, _ fields: [String: Any]) {
        guard !deleting.contains(id) else { return }
        Task { await store.updateItem(deal.id, itemId: id, fields: fields) }
    }

    private func add() {
        guard !adding else { return }
        adding = true
        let key = requestId ?? UUID().uuidString
        requestId = key
        Task {
            if await store.addItem(deal.id, kind: "contact", clientRequestId: key) { requestId = nil }
            adding = false
        }
    }

    private func remove(_ contact: PipelineContact) {
        guard !deleting.contains(contact.id) else { return }
        deleting.insert(contact.id)
        Task {
            let name = contact.name.isEmpty ? PipelineText.contactRole(contact.role) : contact.name
            await store.deleteItem(deal.id, itemId: contact.id, name: name)
            deleting.remove(contact.id)
        }
    }
}
