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
    enum Tab: String, Hashable { case documents, requests, templates, settings, members }
    private enum Phase { case loading, notInvited, failed(String), ready }

    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var tab: Tab = .documents
    @State private var me: LegalMe?
    @State private var phase: Phase = .loading
    /// A request a notification pointed at (`/legal?tab=requests&request=<id>`).
    @State private var requestFocus: String?

    private var isRoot: Bool { NXSidebarPage.isRoot(.legal, hSize: hSize, router: router) }
    private var subtitle: String { T("Contracts, letters and invoices of every company, numbered and archived.") }
    private var ready: Bool { if case .ready = phase { return true } else { return false } }

    private var tabs: [NXTabItem<Tab>] {
        [NXTabItem(id: .documents, label: T("Documents"), icon: "archivebox"),
         NXTabItem(id: .requests, label: T("Requests"), icon: "tray"),
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
        .task(id: router.focus) { claimFocus() }
        .legalToasts()
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
        case .notInvited:
            EmptyState(icon: "lock", title: T("Legal is by invitation only"),
                       subtitle: T("Ask the owner or a board member with Legal access to invite you."))
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
        case .requests: LegalRequestsPane(gutter: gutter, wide: hSize == .regular, focus: $requestFocus)
        case .templates: LegalTemplatesPane(gutter: gutter)
        case .settings: LegalSettingsPane(gutter: gutter, canEdit: me?.invitePower.canInvite ?? false)
        case .members: LegalMembersPane(gutter: gutter)
        }
    }

    /// A legal_request_new push / Inbox row: the Requests tab, opened on that request.
    private func claimFocus() {
        guard case .legalBoard(let id) = router.focus else { return }
        router.focus = nil
        tab = .requests
        requestFocus = id
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
    @State private var filtersOpen = false
    @State private var sheet: Sheet?
    @State private var open: LegalOpenID?
    /// The pane's width. The table's fixed columns need ~720 pt before the Title column gets any room:
    /// on an iPad in portrait beside the sidebar they overflowed, pushed the whole page off both edges and
    /// squeezed Title out (UI tour run 10, IPD-1). Narrower than `tableWidth` reads the phone's cards.
    @State private var width: CGFloat = 0
    /// The page scroll's top inset and the table card's height: the column heads stay pinned under the page top
    /// while its rows scroll (Mac / iPad; UI tour run 18, R18-M-09: pages 2+ had no column labels).
    @State private var pageTop: CGFloat = 0
    @State private var tableH: CGFloat = 0
    @State private var headH: CGFloat = 0
    /// The web's table from 680 pt, so a portrait iPad gets it too, without the Counterparty column below
    /// 860 pt (UI tour run 16, R16-I-27 iPad: a card list where the web has a table).
    /// 620 since run 17: beside the open sidebar a portrait 13" iPad has ~665 pt, so 680 was never reached and
    /// the iPad kept the cards (UI tour run 17, iPad R17-I-09).
    private static let tableWidth: CGFloat = 620
    private var table: Bool { wide && width - 2 * gutter >= Self.tableWidth }
    /// Every table width, as the web and the Mac (UI tour run 20, iPad R20-I-02: the iPad table had none).
    private var showCounterparty: Bool { table }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                toolbar
                // Phone: one "Filters" control with the count, the pills under it when opened. Seven pills wrapped
                // to three rows and pushed the first document to mid-screen (UI tour run 19, iPhone R19-I-34).
                if wide {
                    filters
                } else {
                    filtersToggle
                    if filtersOpen { filters }
                }
                list
            }
            .padding(.horizontal, gutter)
            .padding(.vertical, 16)
        }
        .onGeometryChange(for: CGFloat.self) { $0.size.width } action: { width = $0 }
        .modifier(PageTopInsetReader(inset: $pageTop))
        .environment(\.pageScrollTopInset, pageTop)
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

    // Both icons in one 16 pt box, so the two labels share a baseline: the taller glyph lifted "New
    // document" ~5 pt above "Upload document" (UI tour run 16, R16-I-20). Upload is the web's tray (R16-B-16).
    private var uploadButton: some View {
        Button { sheet = .upload } label: { actionLabel(T("Upload document"), icon: "tray.and.arrow.up") }
            .buttonStyle(.nxBordered)
    }

    private var newButton: some View {
        Button { sheet = .new } label: { actionLabel(T("New document"), icon: "doc.badge.plus") }
            .buttonStyle(.nxPrimary)
    }

    private func actionLabel(_ title: String, icon: String) -> some View {
        HStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 13, weight: .medium)).frame(width: 16, height: 16)
            Text(title).lineLimit(1)
        }
    }

    // The filters wrap onto a second line instead of scrolling under an edge fade: every pill stays
    // whole and visible ("Any deadlin…", "Signed…", the project filter off-screen; run 14 N-25 / N-26 /
    // P-I20).
    private var filters: some View {
        FlowLayout(spacing: 8) {
            LegalMenuPicker(options: companies.map { ($0.id, $0.name) }, selection: binding(\.companyId),
                            noneLabel: T("All companies"), compact: true)
            LegalMenuPicker(options: LegalLabels.docTypes.map { ($0, LegalLabels.docType($0)) }, selection: binding(\.docType),
                            noneLabel: T("All types"), compact: true)
            LegalMenuPicker(options: LegalLabels.statuses.map { ($0, LegalLabels.status($0)) }, selection: binding(\.status),
                            noneLabel: T("All statuses"), compact: true)
            LegalMenuPicker(options: [("1", T("Signed copy uploaded"))], selection: binding(\.signed),
                            noneLabel: T("Signed or not"), compact: true)
            LegalMenuPicker(options: [("GENERATED", T("Made here")), ("UPLOADED", T("Uploaded"))], selection: binding(\.source),
                            noneLabel: T("Made or uploaded"), compact: true)
            if query.parentId != nil {
                Button { query.parentId = nil; query.page = 1 } label: {
                    Label(T("One document and its addenda"), systemImage: "xmark.circle.fill")
                }
                .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                .accessibilityHint(T("Clear filters"))
            }
            // iPad / Mac: the web's two date fields, "From – To" (UI tour run 20, iPad R20-I-02); the phone keeps
            // the one control that opens both.
            if wide {
                LegalDateRangeFields(from: binding(\.from), to: binding(\.to))
            } else {
                Button { sheet = .dates } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                        Text(dateLabel).font(NXFont.text(13, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                    }
                    .legalInput()
                }
                .buttonStyle(.plain)
            }
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

    private var activeFilters: Int {
        [query.companyId, query.docType, query.status, query.signed, query.source, query.parentId]
            .filter { !($0 ?? "").isEmpty }.count
            + ((query.from ?? query.to) != nil ? 1 : 0) + ((query.projectId ?? query.dealId) != nil ? 1 : 0)
    }

    private var filtersToggle: some View {
        Button { withAnimation(.snappy) { filtersOpen.toggle() } } label: {
            HStack(spacing: 6) {
                Image(systemName: "line.3.horizontal.decrease").font(.system(size: 13, weight: .semibold))
                Text(T("Filters")).font(NXFont.text(14, .semibold))
                if activeFilters > 0 {
                    Text(AppNumber.int(activeFilters)).font(NXFont.text(12, .bold)).monospacedDigit()
                        .foregroundStyle(NX.background)
                        .padding(.horizontal, 7).padding(.vertical, 1)
                        .background(NX.foreground, in: Capsule())
                }
                Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    .rotationEffect(.degrees(filtersOpen ? 180 : 0))
            }
            .foregroundStyle(NX.foreground)
            .padding(.horizontal, 12).frame(minHeight: 36)
            .background(NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(NX.border))
            .frame(minHeight: 44).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityValue(filtersOpen ? T("Expanded") : T("Collapsed"))
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
                if table {
                    // Opaque and above the rows, so a row scrolling under it is clipped by it: no row is blanked into
                    // an empty band (decision 29 of run 20, R20-B-04).
                    VStack(spacing: 0) { wideHeader; Divider().overlay(NX.border) }
                        .background(NX.card)
                        .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { headH = $0 }
                        .modifier(StickyInPageScroll(limit: max(0, tableH - 120)))
                        .zIndex(1)
                }
                ForEach(Array(result.documents.enumerated()), id: \.element.id) { i, d in
                    if i > 0 { Divider().overlay(NX.border) }
                    VStack(alignment: .leading, spacing: 0) {
                        Button { open = LegalOpenID(id: d.id) } label: {
                            if table { wideRow(d) } else { phoneRow(d) }
                        }
                        .buttonStyle(.plain)
                        .hoverEffect(.highlight)
                        .contextMenu {
                            if hasChain(d) {
                                Button { showChain(d) } label: {
                                    Label(T("Show the chain"), systemImage: "arrow.triangle.branch")
                                }
                            }
                        }
                        // The web's "Show the chain" link on a document with addenda or a parent, not only in
                        // the context menu (run 14, P-I20). Its own button, under the row's.
                        if hasChain(d) && query.parentId == nil {
                            Button { showChain(d) } label: {
                                Label(T("Show the chain"), systemImage: "arrow.triangle.branch")
                                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                                    .frame(minHeight: 32).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .hoverEffect(.highlight)
                            .padding(.leading, table ? 14 + numberW + 12 : 14)
                            .padding(.bottom, 6)
                        }
                    }
                }
            }
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { tableH = $0 }
            .opacity(loading ? 0.6 : 1)
            pager(result)
        }
    }

    private func hasChain(_ d: LegalDocumentSummary) -> Bool { d.parent != nil || d.addendaCount > 0 }

    private func showChain(_ d: LegalDocumentSummary) {
        query.parentId = d.parent?.id ?? d.id
        query.page = 1
    }

    private var wideHeader: some View {
        HStack(spacing: narrowTable ? 8 : 12) {
            Text(T("Number")).frame(width: numberW, alignment: .leading)
            Text(T("Title")).frame(maxWidth: .infinity, alignment: .leading)
            if showCounterparty { Text(T("Counterparty")).frame(width: counterpartyW, alignment: .leading) }
            Text(T("Company")).frame(width: companyW, alignment: .leading)
            Text(T("Date")).frame(width: dateW, alignment: .leading)
            Text(T("Status")).frame(width: statusW, alignment: .leading)
        }
        .font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg)
        .padding(.horizontal, 14).padding(.vertical, 9)
        .background(NX.muted.opacity(0.5))
        // Opaque, so pinned it hides the rows passing under it.
        .background(NX.card)
    }

    /// The archive table's columns (UI tour run 16, R16-M-01 / R16-M-13): a folded number, a narrower
    /// Counterparty (mostly "—"), a Company wide enough for "The Z Networks" on one line; Title takes the rest.
    /// 170 since run 17: the folded number needs at most ~170 pt ("PATS/PKS-UNIV/…/2026/005"), and the 40 pt
    /// spare went to Title, which still stopped at "…University" after two lines (UI tour run 17, R17-M-09).
    private var counterpartyW: CGFloat { narrowTable ? 84 : 130 }
    /// A wide table (a Mac window, an iPad in landscape) gives the number the web's width: "SPK/CH/PATS-UNIV/…/2027/001"
    /// rather than "SPK/CH/…/2027/001" (UI tour run 20, R20-B-23).
    private var wideTable: Bool { width - 2 * gutter >= 1000 }
    /// A narrow table (a portrait iPad beside the sidebar, ~665 pt) gives its spare width to Title: with the
    /// wide columns Title had ~130 pt and ended "[TEST] seq 03_SPK_City_…", while "PATS" and "14 Oct" sat in
    /// ~150 pt of empty room each (UI tour run 18, iPad R18-I-02).
    private var narrowTable: Bool { width - 2 * gutter < 760 }
    private var numberW: CGFloat { narrowTable ? 124 : wideTable ? 230 : 170 }
    // "The Z Networks" whole with room before the Date column (iPad R20-I-07: it butted against it).
    private var companyW: CGFloat { narrowTable ? 92 : 124 }
    private var dateW: CGFloat { narrowTable ? 56 : 90 }
    private var statusW: CGFloat { narrowTable ? 74 : 80 }

    /// A person's name kept on one line: "Signed 14 Oct by QA / Dev 5" broke it (UI tour run 20, R20-I-14).
    static func glued(_ name: String) -> String { name.replacingOccurrences(of: " ", with: "\u{00A0}") }

    private func subtitle(_ d: LegalDocumentSummary) -> String {
        // An addendum says "Addendum to …" on its own line below, so the type isn't repeated (run 14, N-26).
        var parts: [String] = d.parent != nil && d.docType == "ADD" ? [] : [LegalLabels.docType(d.docType)]
        if d.source == "UPLOADED" { parts.append(T("Uploaded")) }
        if let deal = d.deal { parts.append(deal.code) } else if let p = d.project { parts.append(p.name) }
        var s = parts.joined(separator: " · ")
        // "1 addendum" / "2 addenda" (F-28).
        if d.addendaCount > 0 { s += (s.isEmpty ? "" : " · ") + (d.addendaCount == 1 ? T("1 addendum") : String(format: T("%d addenda"), d.addendaCount)) }
        if let at = d.signedAt { s += (s.isEmpty ? "" : " · ") + String(format: T("Signed %@ by %@"), LegalLabels.date(at), Self.glued(d.signedBy?.name ?? "—")) }
        return s
    }

    /// "Addendum to" / "Number reused by" and the whole number under it: a number is never broken across
    /// lines or cut ("…/OKT/ ⏎ 2026/002", "PKS/PATS-U...YAKARTA"; run 11 IP-12, run 14 N-26 / P-M16). It
    /// shrinks a little on a narrow phone instead.
    private func numberLine(_ label: String, _ number: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            // Folded in the middle rather than shrunk to an unreadable ~6 pt (UI tour run 16, R16-M-01).
            Text(LegalLabels.shortNumber(number)).font(.system(size: 11, design: .monospaced)).foregroundStyle(NX.mutedFg)
                .lineLimit(1).minimumScaleFactor(0.85)
        }
        .accessibilityElement(children: .combine)
        .help(number)
    }

    @ViewBuilder private func parentLine(_ d: LegalDocumentSummary) -> some View {
        if let parent = d.parent { numberLine(T("Addendum to"), parent.number) }
    }

    @ViewBuilder private func reusedLine(_ d: LegalDocumentSummary) -> some View {
        if d.status == "VOID", let by = d.numberReusedBy { numberLine(T("Number reused by"), by.number) }
    }

    private func wideRow(_ d: LegalDocumentSummary) -> some View {
        HStack(spacing: narrowTable ? 8 : 12) {
            // Numbers run long ("SPK/CH/PATS-UNIV/YOGYAKARTA/JAN/2027/001"): cut in the middle so the series
            // prefix and the sequence both stay readable, with the full number on hover (UI tour run 11, MC-2).
            // The whole number in a wider column (run 14, P-M16: "SPK/CH/PATS-UNI…TA/JAN/2027/001" with a 180 pt
            // Company column for "PATS"); a number longer still shrinks a little rather than being cut.
            // An addendum is marked "↳" under its parent, as on the web (UI tour run 15, Q-IB30).
            HStack(spacing: 4) {
                if d.parent != nil { Text("↳").font(NXFont.text(13)).foregroundStyle(NX.mutedFg).accessibilityLabel(T("Addendum")) }
                // The middle of a long number folds ("PKS/PATS-UNIV/…/2026/005"), as the web's, so Title gets
                // the width (UI tour run 16, R16-M-01); the whole number on hover.
                // Folded only at "/", never cut at its end: the sequence stays (UI tour run 19, iPad R19-I-03).
                if d.number.isEmpty {
                    Text("—").font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.foreground)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        LegalNumberText(number: d.number).foregroundStyle(NX.foreground).strikethrough(d.numberReleased)
                        // Under the number it is about, as the web (iPad R20-I-02: it sat in the title column).
                        reusedLine(d)
                    }
                }
            }
            .frame(width: numberW, alignment: .leading)
            .help(d.number)
            VStack(alignment: .leading, spacing: 2) {
                // The whole title, as the web's archive (UI tour run 19, iPad R19-I-04: two lines and "…").
                if narrowTable {
                    LegalArchiveTitle(text: LegalLabels.title(d.title))
                        .font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground)
                } else {
                    Text(LegalLabels.title(d.title)).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true).multilineTextAlignment(.leading)
                }
                let sub = subtitle(d)
                // The whole meta line, wrapped ("4 addenda · Signed 14 Oct by QA…" was cut; iPad R20-I-07).
                if !sub.isEmpty { Text(sub).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true) }
                parentLine(d)
            }
            .frame(minWidth: narrowTable ? 180 : nil, maxWidth: .infinity, alignment: .leading)
            if showCounterparty {
                Text(d.counterparty.isEmpty ? "—" : d.counterparty).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                    .lineLimit(2).frame(width: counterpartyW, alignment: .leading)
            }
            // One line, a size smaller where it must: "The Z / Networks" broke over two (R19-I-04).
            Text(d.company?.name ?? "—").font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1).minimumScaleFactor(0.75)
                .frame(width: companyW, alignment: .leading)
            Text(LegalLabels.shortDay(d.docDate)).font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1)
                .minimumScaleFactor(0.8).frame(width: dateW, alignment: .leading)
            LegalStatusChip(status: d.status).frame(width: statusW, alignment: .leading)
        }
        .padding(.horizontal, 14).padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private func phoneRow(_ d: LegalDocumentSummary) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 8) {
                if d.parent != nil { Text("↳").font(NXFont.text(13)).foregroundStyle(NX.mutedFg).accessibilityLabel(T("Addendum")) }
                Text(d.number.isEmpty ? T("No number") : d.number).font(.system(size: 12, design: .monospaced))
                    .foregroundStyle(NX.mutedFg).strikethrough(d.numberReleased).lineLimit(1).minimumScaleFactor(0.7)
                Spacer(minLength: 4)
                LegalStatusChip(status: d.status)
            }
            Text(LegalLabels.unbroken(d.title)).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(2).multilineTextAlignment(.leading)
            Text([d.counterparty.isEmpty ? nil : d.counterparty, d.company?.name, LegalLabels.shortDay(d.docDate)].compactMap { $0 }.joined(separator: " · "))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            let sub = subtitle(d)
            if !sub.isEmpty { Text(sub).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2) }
            parentLine(d)
            reusedLine(d)
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
/// The web archive's DateRange (LegalDocuments.tsx): "From" and "To" fields, each empty until picked, From never
/// after To and To never before From, each with its own clear button.
private struct LegalDateRangeFields: View {
    @Binding var from: String?
    @Binding var to: String?

    var body: some View {
        HStack(spacing: 6) {
            field(T("From"), $from, lower: nil, upper: to)
            Text(verbatim: "–").foregroundStyle(NX.mutedFg).accessibilityHidden(true)
            field(T("To"), $to, lower: from, upper: nil)
        }
    }

    @ViewBuilder private func field(_ label: String, _ value: Binding<String?>, lower: String?, upper: String?) -> some View {
        if let day = value.wrappedValue {
            let lo = lower.flatMap { LegalText.date(fromDay: $0) } ?? .distantPast
            let hi = upper.flatMap { LegalText.date(fromDay: $0) } ?? .distantFuture
            HStack(spacing: 2) {
                DatePicker(label, selection: Binding(get: { LegalText.date(fromDay: day) ?? Date() },
                                                     set: { value.wrappedValue = LegalText.dayString($0) }),
                           in: lo...max(lo, hi), displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.locale, AppDateLocale.current)
                    .environment(\.timeZone, LegalText.jakarta)
                    .accessibilityLabel(label)
                Button { value.wrappedValue = nil } label: {
                    Image(systemName: "xmark.circle.fill").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
                        .frame(width: 28, height: 28).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(String(format: T("Clear %@"), label))
            }
        } else {
            Button {
                // Starts on today, kept inside the other end of the range.
                var start = LegalText.todayJakarta()
                if let upper, start > upper { start = upper }
                if let lower, start < lower { start = lower }
                value.wrappedValue = start
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "calendar").font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                    Text(label).font(NXFont.text(13, .medium)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
                .frame(minWidth: 84, alignment: .leading)
                .legalInput()
            }
            .buttonStyle(.plain)
            .accessibilityLabel(label)
        }
    }
}

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
