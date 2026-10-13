import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Legal (owner, 14 Oct 2026): documents made from templates with automatic numbering, reviewed and
// versioned, and the archive of every legal document. Mirrors the web's routes/_app/legal.tsx: four tabs
// (Documents · Templates · Companies & numbering · Members). Invitation only: the nav entry is drawn when
// the roster's canAccessLegal is true, and the server refuses every /api/legal call for everyone else, so
// a deep link lands on the "by invitation" state below.
// ─────────────────────────────────────────────────────────────────────────────

/// A document or template to push, by id.
struct LegalOpenID: Hashable, Identifiable {
    let id: String
}

struct LegalView: View {
    enum Tab: String, Hashable { case documents, templates, settings, members }
    private enum Phase { case loading, notInvited, failed(String), ready }

    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var tab: Tab = .documents
    @State private var me: LegalMe?
    @State private var phase: Phase = .loading

    private var isRoot: Bool { NXSidebarPage.isRoot(.legal, hSize: hSize, router: router) }
    private var subtitle: String { T("Contracts, letters and invoices of every company, numbered and archived.") }
    private var ready: Bool { if case .ready = phase { return true } else { return false } }

    private var tabs: [NXTabItem<Tab>] {
        [NXTabItem(id: .documents, label: T("Documents"), icon: "archivebox"),
         NXTabItem(id: .templates, label: T("Templates"), icon: "doc.text"),
         NXTabItem(id: .settings, label: T("Companies & numbering"), icon: "slider.horizontal.3"),
         NXTabItem(id: .members, label: T("Members"), icon: "person.2")]
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .nxSidebarPageChrome(isRoot, phoneSubtitle: subtitle) {
            VStack(spacing: 0) {
                NXPageHeader(title: T("Legal"), subtitle: subtitle)
                if ready {
                    NXPageTabsRow(items: tabs, selection: $tab, accessibilityName: T("Legal sections"))
                }
            }
        }
        .navigationTitle(T("Legal"))
        .navigationBarTitleDisplayMode(.inline)
        .task { if me == nil { await load() } }
        .legalToasts()
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .notInvited:
            EmptyState(icon: "lock", title: T("Legal is by invitation only"),
                       subtitle: T("Ask the owner or a BoD member with Legal access to invite you."))
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .failed(let message):
            EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't open Legal"), subtitle: message,
                       actionTitle: T("Try again"), actionIcon: "arrow.clockwise") { Task { await load() } }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .ready:
            VStack(spacing: 0) {
                if !isRoot {
                    NXUnderlineTabs(items: tabs, selection: $tab, accessibilityName: T("Legal sections"))
                }
                pane
            }
        }
    }

    @ViewBuilder private var pane: some View {
        let gutter = NXSidebarPage.gutter(isRoot)
        switch tab {
        case .documents: LegalDocumentsPane(gutter: gutter, wide: hSize == .regular)
        case .templates: LegalTemplatesPane(gutter: gutter)
        case .settings: LegalSettingsPane(gutter: gutter, canEdit: me?.invitePower.canInvite ?? false)
        case .members: LegalMembersPane(gutter: gutter)
        }
    }

    private func load() async {
        phase = .loading
        do {
            me = try await APIClient.shared.legalMe()
            phase = .ready
        } catch let e as LegalAPIError where e.status == 403 {
            phase = .notInvited
        } catch {
            phase = .failed(error.legalMessage)
        }
    }
}

// MARK: - Documents (the archive)

/// Every legal document — made here or uploaded — searchable by number, title and counterparty, and
/// filtered by company, type, status, where it came from, date and what it belongs to (web LegalDocuments).
struct LegalDocumentsPane: View {
    let gutter: CGFloat
    let wide: Bool

    private enum Sheet: String, Identifiable { case new, upload, dates; var id: String { rawValue } }

    @State private var text = ""
    @State private var query = LegalArchiveQuery()
    @State private var result: LegalDocumentsPage?
    @State private var loading = true
    @State private var error: String?
    @State private var companies: [LegalCompany] = []
    @State private var link: LegalLink?
    @State private var sheet: Sheet?
    @State private var open: LegalOpenID?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                toolbar
                filters
                list
            }
            .padding(.horizontal, gutter)
            .padding(.vertical, 16)
        }
        .refreshable { await load() }
        .task(id: text) {
            if !text.isEmpty { try? await Task.sleep(nanoseconds: 300_000_000) }
            guard !Task.isCancelled else { return }
            let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if q != query.q { query.q = q; query.page = 1 }
        }
        .task(id: query) { await load() }
        .task { companies = (try? await APIClient.shared.legalCompanies()) ?? companies }
        .sheet(item: $sheet) { s in
            switch s {
            case .new: LegalNewDocumentSheet { id in Task { await load() }; open = LegalOpenID(id: id) }
            case .upload: LegalUploadDocumentSheet(companies: companies) { id in Task { await load() }; open = LegalOpenID(id: id) }
            case .dates: LegalDateRangeSheet(from: $query.from, to: $query.to) { query.page = 1 }
            }
        }
        .navigationDestination(item: $open) { o in
            LegalDocumentView(documentId: o.id)
        }
        .onChange(of: open) { _, now in if now == nil { Task { await load() } } }
    }

    private var toolbar: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) {
                searchField
                uploadButton
                newButton
            }
            VStack(alignment: .leading, spacing: 8) {
                searchField
                HStack(spacing: 8) { uploadButton; newButton; Spacer(minLength: 0) }
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
            TextField(T("Search number, title, counterparty…"), text: $text)
                .font(NXFont.text(14)).textFieldStyle(.plain).autocorrectionDisabled().textInputAutocapitalization(.never)
            if !text.isEmpty {
                Button { text = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg) }
                    .buttonStyle(.plain).accessibilityLabel(T("Clear"))
            }
        }
        .legalInput()
        .frame(minWidth: 220)
    }

    private var uploadButton: some View {
        Button { sheet = .upload } label: { Label(T("Upload document"), systemImage: "arrow.up.doc") }
            .buttonStyle(.nxBordered)
    }

    private var newButton: some View {
        Button { sheet = .new } label: { Label(T("New document"), systemImage: "doc.badge.plus") }
            .buttonStyle(.nxPrimary)
    }

    private var filters: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                LegalMenuPicker(options: companies.map { ($0.id, $0.name) }, selection: binding(\.companyId),
                                noneLabel: T("All companies"), compact: true)
                LegalMenuPicker(options: LegalLabels.docTypes.map { ($0, LegalLabels.docType($0)) }, selection: binding(\.docType),
                                noneLabel: T("All types"), compact: true)
                LegalMenuPicker(options: LegalLabels.statuses.map { ($0, LegalLabels.status($0)) }, selection: binding(\.status),
                                noneLabel: T("All statuses"), compact: true)
                LegalMenuPicker(options: [("GENERATED", T("Made here")), ("UPLOADED", T("Uploaded"))], selection: binding(\.source),
                                noneLabel: T("Made or uploaded"), compact: true)
                Button { sheet = .dates } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                        Text(dateLabel).font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                    }
                    .legalInput()
                }
                .buttonStyle(.plain)
                LegalLinkButton(value: link, placeholder: T("Any project or deal")) { v in
                    link = v
                    query.projectId = v?.projectId
                    query.dealId = v?.dealId
                    query.page = 1
                }
                .frame(maxWidth: 260)
                if query.filtered {
                    Button {
                        let q = query.q
                        query = LegalArchiveQuery()
                        query.q = q
                        link = nil
                    } label: { Label(T("Clear filters"), systemImage: "xmark") }
                        .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
                }
            }
            .padding(.vertical, 1)
        }
    }

    private var dateLabel: String {
        switch (query.from, query.to) {
        case (nil, nil): return T("Any date")
        case (let f?, nil): return "\(T("From")) \(LegalLabels.day(f))"
        case (nil, let t?): return "\(T("To")) \(LegalLabels.day(t))"
        case (let f?, let t?): return "\(LegalLabels.day(f)) – \(LegalLabels.day(t))"
        }
    }

    /// A filter binding that goes back to page 1 when it changes.
    private func binding(_ key: WritableKeyPath<LegalArchiveQuery, String?>) -> Binding<String?> {
        Binding(get: { query[keyPath: key] }, set: { query[keyPath: key] = $0; query.page = 1 })
    }

    @ViewBuilder private var list: some View {
        if loading && result == nil {
            LegalLoadingRow()
        } else if let error, result == nil {
            Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger).padding(.vertical, 12)
        } else if let result, result.documents.isEmpty {
            let searching = !query.q.isEmpty || query.filtered
            EmptyState(icon: "doc.text", title: searching ? T("Nothing matches") : T("No documents yet"),
                       subtitle: searching ? T("Try other words or fewer filters.") : T("Make one from a template, or upload a signed document."))
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity)
        } else if let result {
            LegalListCard {
                if wide { wideHeader; Divider().overlay(NX.border) }
                ForEach(Array(result.documents.enumerated()), id: \.element.id) { i, d in
                    if i > 0 { Divider().overlay(NX.border) }
                    Button { open = LegalOpenID(id: d.id) } label: {
                        if wide { wideRow(d) } else { phoneRow(d) }
                    }
                    .buttonStyle(.plain)
                    .hoverEffect(.highlight)
                }
            }
            .opacity(loading ? 0.6 : 1)
            pager(result)
        }
    }

    private var wideHeader: some View {
        HStack(spacing: 12) {
            Text(T("Number")).frame(width: 170, alignment: .leading)
            Text(T("Title")).frame(maxWidth: .infinity, alignment: .leading)
            Text(T("Counterparty")).frame(width: 160, alignment: .leading)
            Text(T("Company")).frame(width: 120, alignment: .leading)
            Text(T("Date")).frame(width: 100, alignment: .leading)
            Text(T("Status")).frame(width: 80, alignment: .leading)
        }
        .font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(NX.muted.opacity(0.5))
    }

    private func subtitle(_ d: LegalDocumentSummary) -> String {
        var s = LegalLabels.docType(d.docType)
        if d.source == "UPLOADED" { s += " · " + T("Uploaded") }
        if let deal = d.deal { s += " · " + deal.code } else if let p = d.project { s += " · " + p.name }
        return s
    }

    private func wideRow(_ d: LegalDocumentSummary) -> some View {
        HStack(spacing: 12) {
            Text(d.number.isEmpty ? "—" : d.number).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.foreground)
                .lineLimit(1).frame(width: 170, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(d.title).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(subtitle(d)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(d.counterparty.isEmpty ? "—" : d.counterparty).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                .lineLimit(1).frame(width: 160, alignment: .leading)
            Text(d.company?.name ?? "—").font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1).frame(width: 120, alignment: .leading)
            Text(LegalLabels.day(d.docDate)).font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1).frame(width: 100, alignment: .leading)
            LegalStatusChip(status: d.status).frame(width: 80, alignment: .leading)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private func phoneRow(_ d: LegalDocumentSummary) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                Text(d.number.isEmpty ? T("No number") : d.number).font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(NX.mutedFg).lineLimit(1)
                Spacer(minLength: 4)
                LegalStatusChip(status: d.status)
            }
            Text(d.title).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(2).multilineTextAlignment(.leading)
            Text([d.counterparty.isEmpty ? nil : d.counterparty, d.company?.name, LegalLabels.day(d.docDate)].compactMap { $0 }.joined(separator: " · "))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            Text(subtitle(d)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }

    @ViewBuilder private func pager(_ r: LegalDocumentsPage) -> some View {
        let size = query.limit
        if r.total > size {
            HStack {
                Text(String(format: T("%d–%d of %d"), (query.page - 1) * size + 1, min(query.page * size, r.total), r.total))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                Spacer()
                Button(T("Previous")) { query.page -= 1 }.buttonStyle(NXButtonStyle(kind: .bordered, compact: true)).disabled(query.page <= 1)
                Button(T("Next")) { query.page += 1 }.buttonStyle(NXButtonStyle(kind: .bordered, compact: true)).disabled(query.page * size >= r.total)
            }
        }
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            let r = try await APIClient.shared.legalDocuments(query)
            result = r
            error = nil
        } catch {
            if (error as? URLError)?.code == .cancelled || error is CancellationError { return }
            self.error = error.legalMessage
            if result != nil { LegalToasts.shared.failure(error) }
        }
    }
}

/// From / To for the archive (each optional).
private struct LegalDateRangeSheet: View {
    @Binding var from: String?
    @Binding var to: String?
    let onChange: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                dayRow(T("From"), $from)
                dayRow(T("To"), $to)
            }
            .navigationTitle(T("Date"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Clear")) { from = nil; to = nil; onChange(); dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } }
            }
        }
        .presentationDetents([.medium])
    }

    private func dayRow(_ label: String, _ value: Binding<String?>) -> some View {
        let on = Binding<Bool>(get: { value.wrappedValue != nil }, set: { value.wrappedValue = $0 ? LegalText.todayJakarta() : nil; onChange() })
        let date = Binding<Date>(get: { LegalText.date(fromDay: value.wrappedValue ?? "") ?? Date() },
                                 set: { value.wrappedValue = LegalText.dayString($0); onChange() })
        return Section {
            Toggle(label, isOn: on).tint(NX.violet)
            if value.wrappedValue != nil {
                DatePicker(label, selection: date, displayedComponents: .date)
                    .environment(\.locale, AppDateLocale.current)
                    .environment(\.timeZone, LegalText.jakarta)
            }
        }
    }
}
