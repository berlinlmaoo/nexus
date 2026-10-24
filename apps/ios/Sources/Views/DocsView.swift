import SwiftUI

/// Port of docs.tsx ("Knowledge Library"): searchable doc list → reader.
struct DocsView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    @Environment(\.horizontalSizeClass) private var hSize
    @State private var docs: [Doc] = []
    @State private var query = ""
    @State private var loading = true
    @State private var error: String?

    private var filtered: [Doc] {
        query.trimmingCharacters(in: .whitespaces).isEmpty ? docs
            : docs.filter { $0.title.lowercased().contains(query.lowercased()) }
    }

    /// The sidebar's Pages screen on an iPad or Mac: the web's page header instead of the nav bar.
    private var isRoot: Bool { NXSidebarPage.isRoot(.docs, hSize: hSize, router: router) }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .nxSidebarPageChrome(isRoot) {
            // Web docs.tsx PageHeader. Its "New page" is not here: a page is made from a project's Pages tab.
            NXPageHeader(title: T("Pages"), subtitle: T("SOPs, meeting notes, briefs and reference pages from every project you're in.")) {
                NXHeaderSearchField(prompt: T("Search pages…"), text: $query, width: 224)
            }
        }
        .navigationTitle(T("Pages"))
        .navigationBarTitleDisplayMode(.inline)
        // The bar's search field only where the bar is shown; the page header carries its own.
        .modifier(DocsBarSearch(enabled: !isRoot, query: $query))
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            EmptyState(icon: "doc.text", title: T("Couldn't load pages"), subtitle: error,
                       actionTitle: T("Try again"), actionIcon: "arrow.clockwise") { Task { await load() } }
        } else if filtered.isEmpty {
            EmptyState(icon: "doc.text", title: query.isEmpty ? T("No pages yet") : T("No pages match"),
                       subtitle: query.isEmpty ? T("SOPs, meeting notes, briefs and reference pages from every project you're in show up here. Add one from a project's Pages tab.") : T("Try another word."))
        } else {
            ScrollView {
                NXCardGrid(spacing: 12) {
                    ForEach(filtered) { d in
                        NavigationLink { DocReaderView(docId: d.id, title: d.title) } label: { DocCard(doc: d) }
                            .buttonStyle(.plain)
                            .hoverEffect(.highlight)
                    }
                }
                .padding(.horizontal, NXSidebarPage.gutter(isRoot))
                .padding(.vertical, isRoot ? 24 : 16)
            }
            .refreshable { await load() }
        }
    }

    private func load() async {
        error = nil
        do { docs = try await APIClient.shared.docs() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Check your connection and try again.") }
        loading = false
    }
}

/// `.searchable` in the navigation bar, only while `enabled` (the iPad / Mac page hides that bar).
private struct DocsBarSearch: ViewModifier {
    let enabled: Bool
    @Binding var query: String

    func body(content: Content) -> some View {
        if enabled {
            content.searchable(text: $query, prompt: T("Search pages…"))
        } else {
            content
        }
    }
}

struct DocCard: View {
    let doc: Doc
    var body: some View {
        HStack(spacing: 14) {
            Text(doc.emoji).font(.system(size: 22))
                .frame(width: 44, height: 44).background(NX.muted, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                // Long titles wrap between words on two lines, then shrink, before "…" (visual QA 24 Oct 2026).
                WordWrapText(text: UntitledText.any(doc.title), size: 15) { NXFont.display($0, .bold) }
                    .foregroundStyle(NX.foreground)
                if let preview = doc.contentText.map(Self.plainPreview), !preview.isEmpty {
                    Text(preview).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).lineLimit(2)
                } else if let pname = doc.project?.name {
                    Text(pname).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg.opacity(0.5))
        }
        .nexusCard(padding: 14)
    }

    /// The page's text as a reader sees it: the preview showed the raw Markdown ("# MOM:",
    /// "**Tanggal:**", visual QA 24 Oct 2026). Drops heading / quote / list markers, emphasis and code
    /// marks, and keeps a link's text without its address.
    static func plainPreview(_ raw: String) -> String {
        var s = raw
        let rules: [(String, String)] = [
            (#"\[([^\]]*)\]\([^)]*\)"#, "$1"),          // [text](url) → text
            (#"(^|\s)#{1,6}\s+"#, "$1"),                  // # Heading
            (#"(^|\s)>\s+"#, "$1"),                       // > quote
            (#"(^|\n)\s*(?:[-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?"#, "$1"), // list items, task boxes
            (#"\*\*|__|~~|`"#, ""),                      // bold, strike, code marks
        ]
        for (pattern, template) in rules {
            s = s.replacingOccurrences(of: pattern, with: template, options: .regularExpression)
        }
        return s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

struct DocReaderView: View {
    let docId: String
    let title: String
    @Environment(AuthStore.self) private var auth
    @State private var doc: Doc?
    @State private var loading = true
    @State private var failed = false
    /// Why the page did not load: 403 (not a member of its project, page read follows project access since
    /// 13 Oct 2026) and 404 get their own state.
    @State private var loadFailure: Error?
    /// Whether this person may edit the page: Can edit and up in its project (access levels round 2).
    /// nil until known (and for a page without a project); Edit shows until then, as before.
    @State private var pageEditable: Bool?
    /// Editing (owner, 12 Oct 2026): the page's blocks, merged into the live document on the server.
    @State private var editing = false
    @State private var model: BlockEditorModel
    @State private var aiRequest: GideonWriteRequest?

    init(docId: String, title: String) {
        self.docId = docId
        self.title = title
        _model = State(initialValue: BlockEditorModel(ref: BlockBodyRef(kind: "doc", id: docId)))
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading { ProgressView().tint(NX.violetText) }
            else if let doc { page(doc) }
            else if failed, let loadFailure, FailureText.loadKind(loadFailure) == .forbidden || FailureText.loadKind(loadFailure) == .notFound {
                LoadErrorView(error: loadFailure, what: T("this page"),
                              notFoundTitle: T("This page doesn't exist any more"),
                              forbiddenTitle: T("You can't open this page"),
                              forbiddenMessage: T("It's in a project you're not a member of. Ask its Project Owner to add you."))
            }
            else if failed {
                EmptyState(icon: "doc.questionmark", title: T("Couldn't load the doc."),
                           subtitle: T("Check your connection and try again."),
                           actionTitle: T("Try again"), actionIcon: "arrow.clockwise") { Task { await load() } }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbar }
        .task { await load() }
        // The page on screen is GIDEON's context (web pushGideonPage "doc"): ⌘O / the launcher ask about it.
        .gideonPage(doc.flatMap { d in
            d.projectId.map { GideonContext(projectId: $0, projectName: d.project?.name, docId: d.id, docTitle: DocTitle.display(d.title)) }
        })
        // Live: someone edits the page on the web (or another device): it re-reads, unless this person is
        // editing it here (their edit is merged on save instead).
        .realtimeRoom(doc?.projectId.map { "project:\($0)" })
        .liveRefresh(every: 60, on: [.nexusDocChanged], projectId: doc?.projectId) { if !editing { await load() } }
        // Leaving the page saves what was typed (sent in the background; kept on the phone if offline).
        .onDisappear { if editing { model.saveOnClose() } }
        .sheet(item: $aiRequest) { r in aiSheet(r) }
        .alert(T("Someone changed the same part"), isPresented: conflictShown) {
            Button(T("Keep both")) { Task { await model.save(keepBoth: true) } }
            Button(T("Use their version"), role: .destructive) { model.discardMine() }
            Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("While you were editing, someone else changed a block you also changed. Keep both versions, or drop yours.")) }
    }

    private var conflictShown: Binding<Bool> {
        // Cancel only closes the alert: the edit stays on the phone and is asked about again next time.
        Binding(get: { model.conflictDoc != nil }, set: { if !$0 { model.conflictDoc = nil } })
    }

    @ToolbarContentBuilder private var toolbar: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            if doc != nil && model.canEdit && pageEditable != false {
                if editing {
                    Button { Task { await finishEditing() } } label: {
                        if model.saving { ProgressView() } else { Text(T("Done")).bold() }
                    }
                    .keyboardShortcut(.return, modifiers: .command)
                } else {
                    Button { startEditing() } label: { Label(T("Edit"), systemImage: "pencil") }
                        .keyboardShortcut("e", modifiers: .command)
                }
            }
        }
    }

    private func page(_ doc: Doc) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 10) {
                    Text(doc.emoji).font(.system(size: 30))
                    Text(UntitledText.any(doc.title)).font(NXFont.display(26, .bold)).foregroundStyle(NX.foreground)
                }
                if let note = model.note {
                    Label(note, systemImage: "icloud.slash").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                if editing && model.loaded {
                    BlockEditorView(model: model, onAI: { aiRequest = $0 })
                } else if let node = doc.content?.node, node.hasContent {
                    BlockDocView(doc: node)
                } else if let body = doc.contentText, !body.isEmpty {
                    Text(body).font(NXFont.text(15)).foregroundStyle(NX.foreground.opacity(0.92))
                        .fixedSize(horizontal: false, vertical: true).lineSpacing(4)
                } else {
                    Text(T("This doc is still empty.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                }
            }
            .frame(maxWidth: 760, alignment: .leading)
            .padding(20)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func aiSheet(_ r: GideonWriteRequest) -> GideonWriteSheet {
        GideonWriteSheet(request: r, docTitle: doc?.title ?? title, docId: docId, taskId: nil, projectId: doc?.projectId,
                         onReplace: { text, result in BlockEditorApply.replace(model, r.blockId, text: text, doc: result) },
                         onInsert: { result, text in BlockEditorApply.insert(model, after: r.blockId, doc: result, text: text) })
    }

    private func startEditing() {
        editing = true
        if !model.loaded { Task { await model.load() } }
    }

    private func finishEditing() async {
        if await model.save() || !model.isDirty {
            editing = false
            await load()
        }
    }

    private func load() async {
        do { doc = try await APIClient.shared.doc(docId); failed = false; loadFailure = nil }
        catch APIError.unauthorized { auth.logout() }
        catch { failed = doc == nil; loadFailure = error }
        loading = false
        // Can view / Can comment: no Edit button (the server refuses the save with NEEDS_EDIT_ACCESS).
        // The page's own GET has no `canEdit`, so the project's level decides (nil = an older server: shown).
        if let pid = doc?.projectId, pageEditable == nil, !editing,
           let project = try? await APIClient.shared.project(pid) {
            pageEditable = project.canEditProject
        }
        // An edit made offline earlier: open straight into the editor so it is sent and seen.
        if BlockEditOutbox.shared.hasPending(model.ref) && !editing { startEditing() }
    }
}

/// Puts a GIDEON writing result into the editor.
enum BlockEditorApply {
    @MainActor static func replace(_ model: BlockEditorModel, _ blockId: UUID?, text: String, doc: RawJSON?) {
        guard let blockId, let i = model.rows.firstIndex(where: { $0.id == blockId }) else {
            insert(model, after: nil, doc: doc, text: text)
            return
        }
        let newRows = rows(doc: doc, text: text)
        if newRows.count == 1, newRows[0].kind == .paragraph {
            model.rows[i].text = newRows[0].text   // one paragraph: inline, the block keeps its kind
        } else {
            model.rows.remove(at: i)
            model.rows.insert(contentsOf: newRows, at: i)
        }
    }

    @MainActor static func insert(_ model: BlockEditorModel, after blockId: UUID?, doc: RawJSON?, text: String) {
        let newRows = rows(doc: doc, text: text)
        var at = model.rows.count
        if let blockId, let i = model.rows.firstIndex(where: { $0.id == blockId }) {
            // An empty line is replaced rather than left above the result.
            if model.rows[i].text.isEmpty && model.rows[i].kind == .paragraph { model.rows.remove(at: i); at = i } else { at = i + 1 }
        }
        model.rows.insert(contentsOf: newRows, at: min(at, model.rows.count))
    }

    /// The result's blocks as NEW rows (sent as new blocks), or its text as paragraphs.
    private static func rows(doc: RawJSON?, text: String) -> [BlockRow] {
        let blocks = (doc?["content"] as? [Any] ?? []).compactMap { $0 as? RawJSON }
        if !blocks.isEmpty {
            return BlockConvert.rows(from: blocks).map { r in
                var fresh = BlockRow.new(r.kind, r.text)
                fresh.checked = r.checked
                if r.kind == .other { fresh.raw = r.raw; fresh.originalKind = .other; fresh.originalText = "" }
                return fresh
            }
        }
        return text.components(separatedBy: "\n").map { BlockRow.new(.paragraph, $0) }
    }
}
