import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Templates (owner, 14 Oct 2026; web LegalTemplates): a .docx with {{PLACEHOLDERS}} uploaded here; the
// server finds the fields, and each upload of the same template is a new version. Documents keep the
// version they were made from.
// ─────────────────────────────────────────────────────────────────────────────

struct LegalTemplatesPane: View {
    let gutter: CGFloat
    @Environment(\.horizontalSizeClass) private var hSize

    @State private var showArchived = false
    @State private var templates: [LegalTemplate]?
    @State private var companies: [LegalCompany] = []
    @State private var error: String?
    @State private var uploading = false
    @State private var open: LegalOpenID?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                LegalSectionHeader(title: T("Templates"),
                                   subtitle: T("Word files with {{PLACEHOLDERS}}. The form for a new document is made from them.")) {
                    // iPad / Mac: "Show archived" beside Upload, as on the web (UI tour run 15, Q-IB24); the
                    // upload arrow, not a document glyph.
                    if hSize == .regular {
                        LegalToggle(label: T("Show archived"), isOn: $showArchived).fixedSize()
                    }
                    Button { uploading = true } label: { Label(T("Upload template"), systemImage: "tray.and.arrow.up") }
                        .buttonStyle(.nxPrimary)
                }
                // On a phone the switch sits at the list's right edge (F-29 / M-23).
                if hSize != .regular {
                    LegalToggle(label: T("Show archived"), isOn: $showArchived)
                }
                list
                LegalPlaceholderHelp()
            }
            .padding(.horizontal, gutter)
            .padding(.vertical, 16)
        }
        .refreshable { await load() }
        .task(id: showArchived) { await load() }
        .task { companies = (try? await APIClient.shared.legalCompanies()) ?? companies }
        .sheet(isPresented: $uploading) {
            LegalUploadTemplateSheet(companies: companies) { id in
                Task { await load() }
                open = LegalOpenID(id: id)
            }
        }
        .navigationDestination(item: $open) { o in LegalTemplateDetailView(templateId: o.id, companies: companies) }
        .onChange(of: open) { _, now in if now == nil { Task { await load() } } }
    }

    @ViewBuilder private var list: some View {
        if templates == nil && error == nil {
            LegalLoadingRow()
        } else if let error, templates == nil {
            Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger)
        } else if let templates, templates.isEmpty {
            EmptyState(icon: "doc.text", title: T("No templates yet"),
                       subtitle: T("Upload a Word file with {{PLACEHOLDERS}} to start making documents."))
                .padding(.vertical, 20).frame(maxWidth: .infinity)
        } else if let templates {
            LegalListCard {
                ForEach(Array(templates.enumerated()), id: \.element.id) { i, tpl in
                    if i > 0 { Divider().overlay(NX.border) }
                    Button { open = LegalOpenID(id: tpl.id) } label: { row(tpl) }
                        .buttonStyle(.plain)
                        .hoverEffect(.highlight)
                }
            }
        }
    }

    private func row(_ tpl: LegalTemplate) -> some View {
        HStack(spacing: 12) {
            Image(systemName: "doc.text").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(tpl.name).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(2)
                        .multilineTextAlignment(.leading)
                    if tpl.archived { NexusChip(text: T("Archived")) }
                }
                // The web's order: type · company · version · fields (UI tour run 15, Q-IB24). One line where it
                // fits, else two lines split at a separator, never with a "·" at a line's edge (R15-I-23).
                let kind = [LegalLabels.docType(tpl.docType), tpl.company?.name ?? T("Any company")].joined(separator: " · ")
                let size = ["v\(tpl.currentVersion)", String(format: T("%d fields"), tpl.fields.count)].joined(separator: " · ")
                ViewThatFits(in: .horizontal) {
                    Text("\(kind) · \(size)").lineLimit(1)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(kind).fixedSize(horizontal: false, vertical: true)
                        Text(size).lineLimit(1)
                    }
                }
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 4)
            Text(LegalLabels.date(tpl.updatedAt)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
        .contentShape(Rectangle())
    }

    private func load() async {
        do {
            templates = try await APIClient.shared.legalTemplates(archived: showArchived)
            error = nil
        } catch {
            if templates == nil { self.error = error.legalMessage } else { LegalToasts.shared.failure(error) }
        }
    }
}

/// The company a template is for ("Any company") and its numbering series, filtered by company and type.
private struct LegalCompanySeriesPickers: View {
    let companies: [LegalCompany]
    let docType: String?
    @Binding var companyId: String?
    @Binding var seriesId: String?

    private var company: LegalCompany? { companies.first { $0.id == companyId } }
    private var series: [LegalSeries] {
        (company?.series ?? []).filter { $0.active && (docType == nil || $0.docType == docType) }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            LegalFormRow(label: T("Company")) {
                LegalMenuPicker(options: companies.filter(\.active).map { ($0.id, $0.name) },
                                selection: Binding(get: { companyId }, set: { companyId = $0; seriesId = nil }),
                                noneLabel: T("Any company"))
            }
            LegalFormRow(label: T("Numbering")) {
                LegalMenuPicker(options: series.map { ($0.id, "\($0.label) — \($0.format)") }, selection: $seriesId,
                                noneLabel: T("The company's series for this type"))
                    .disabled(company == nil)
                    .opacity(company == nil ? 0.5 : 1)
            }
        }
    }
}

// MARK: - Upload template

private struct LegalUploadTemplateSheet: View {
    let companies: [LegalCompany]
    let onCreated: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var file: URL?
    @State private var name = ""
    @State private var docType: String?
    @State private var companyId: String?
    @State private var seriesId: String?
    @State private var description = ""
    @State private var problems: [String] = []
    @State private var error: String?
    @State private var route: LegalFileRoute?
    @State private var sending = false

    private var canUpload: Bool { file != nil && !name.trimmingCharacters(in: .whitespaces).isEmpty && docType != nil && !sending }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(T("A .docx with {{PLACEHOLDERS}} where the values go. The fields are found automatically."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    LegalFormRow(label: T("Word file")) {
                        LegalPickFileField(file: file) { route = .pick([LegalFileTypes.docx], tag: "tpl") }
                    }
                    LegalFormRow(label: T("Name")) { TextField("", text: $name).font(NXFont.text(14)).legalInput() }
                    LegalFormRow(label: T("Document type")) {
                        LegalMenuPicker(options: LegalLabels.docTypes.map { ($0, LegalLabels.docType($0)) },
                                        selection: Binding(get: { docType }, set: { docType = $0; seriesId = nil }),
                                        placeholder: T("Pick a type"))
                    }
                    LegalCompanySeriesPickers(companies: companies, docType: docType, companyId: $companyId, seriesId: $seriesId)
                    LegalFormRow(label: T("Description (optional)")) {
                        TextField("", text: $description, axis: .vertical).lineLimit(2...4).font(NXFont.text(14)).padding(.vertical, 8).legalInput()
                    }
                    LegalProblemList(title: T("Fix these in the Word file and upload again:"), lines: problems)
                    if let error { Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger) }
                }
                .padding(20)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Upload template"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if sending { ProgressView() } else { Button(T("Upload")) { Task { await upload() } }.disabled(!canUpload) }
                }
            }
            .legalFileSheet($route) { _, url in
                file = url
                problems = []
                if name.isEmpty {
                    name = url.deletingPathExtension().lastPathComponent.replacingOccurrences(of: "_", with: " ")
                }
            }
        }
        .interactiveDismissDisabled(sending)
    }

    private func upload() async {
        guard let file, let docType else { return }
        sending = true
        defer { sending = false }
        error = nil
        do {
            let tpl = try await APIClient.shared.legalCreateTemplate(
                file: file, name: name.trimmingCharacters(in: .whitespacesAndNewlines), docType: docType,
                companyId: companyId, seriesId: seriesId, description: description.trimmingCharacters(in: .whitespacesAndNewlines))
            LegalToasts.shared.success(String(format: T("Template uploaded: %d fields found"), tpl.fields.count))
            dismiss()
            onCreated(tpl.id)
        } catch {
            problems = error.legalProblems
            if problems.isEmpty { self.error = error.legalMessage }
        }
    }
}

/// "Choose a file" / the picked file's name, as a field.
struct LegalPickFileField: View {
    let file: URL?
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: file == nil ? "paperclip" : "doc.fill").foregroundStyle(NX.mutedFg)
                Text(file?.lastPathComponent ?? T("Choose a file")).font(NXFont.text(14))
                    .foregroundStyle(file == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                Spacer(minLength: 0)
            }
            .legalInput()
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Template detail

struct LegalTemplateDetailView: View {
    let templateId: String
    let companies: [LegalCompany]

    private struct Draft: Equatable {
        var name: String
        var description: String
        var docType: String?
        var companyId: String?
        var seriesId: String?
        var fields: [LegalField]
        init(_ t: LegalTemplate) {
            name = t.name; description = t.description; docType = t.docType
            companyId = t.company?.id; seriesId = t.series?.id; fields = t.fields
        }
    }

    @Environment(\.horizontalSizeClass) private var hSize
    @State private var template: LegalTemplate?
    @State private var draft: Draft?
    @State private var error: String?
    @State private var saving = false
    @State private var archiving = false
    @State private var versionFile: URL?
    @State private var versionNote = ""
    @State private var versionProblems: [String] = []
    @State private var addingVersion = false
    @State private var downloading: Int?
    @State private var route: LegalFileRoute?
    @State private var loadedCompanies: [LegalCompany] = []

    private var allCompanies: [LegalCompany] { companies.isEmpty ? loadedCompanies : companies }
    private var dirty: Bool { template.map { Draft($0) } != draft }

    var body: some View {
        Group {
            if let template, draft != nil {
                content(template)
            } else if let error {
                EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't open this template"), subtitle: error)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(template?.name ?? T("Template"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            await load()
            if companies.isEmpty { loadedCompanies = (try? await APIClient.shared.legalCompanies()) ?? [] }
        }
        .legalFileSheet($route) { _, url in versionFile = url; versionProblems = [] }
        .legalToasts()
    }

    private func content(_ tpl: LegalTemplate) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(tpl.name).font(NXFont.text(hSize == .regular ? 24 : 21, .semibold)).foregroundStyle(NX.foreground)
                    Text("\(LegalLabels.docType(tpl.docType)) · v\(tpl.currentVersion)" + (tpl.archived ? " · \(T("Archived"))" : ""))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                detailsCard
                fieldsCard
                HStack(spacing: 8) {
                    Button { Task { await save() } } label: {
                        HStack(spacing: 5) { if saving { ProgressView().tint(NX.background) }; Text(T("Save")) }
                    }
                    .buttonStyle(.nxPrimary)
                    .disabled(!dirty || (draft?.name.trimmingCharacters(in: .whitespaces).isEmpty ?? true) || saving)
                    Button { Task { await setArchived(!tpl.archived) } } label: {
                        Label(tpl.archived ? T("Restore") : T("Archive"), systemImage: tpl.archived ? "tray.and.arrow.up" : "archivebox")
                    }
                    .buttonStyle(.nxBordered)
                    .disabled(archiving)
                }
                versionsCard(tpl)
                LegalPlaceholderHelp()
            }
            .padding(.horizontal, hSize == .regular ? 32 : 16)
            .padding(.vertical, 18)
            .frame(maxWidth: 900, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var detailsCard: some View {
        NXCard(padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                LegalFormRow(label: T("Name")) {
                    TextField("", text: Binding(get: { draft?.name ?? "" }, set: { draft?.name = $0 })).font(NXFont.text(14)).legalInput()
                }
                LegalFormRow(label: T("Document type")) {
                    LegalMenuPicker(options: LegalLabels.docTypes.map { ($0, LegalLabels.docType($0)) },
                                    selection: Binding(get: { draft?.docType }, set: { draft?.docType = $0; draft?.seriesId = nil }))
                }
                LegalCompanySeriesPickers(companies: allCompanies, docType: draft?.docType,
                                          companyId: Binding(get: { draft?.companyId }, set: { draft?.companyId = $0 }),
                                          seriesId: Binding(get: { draft?.seriesId }, set: { draft?.seriesId = $0 }))
                LegalFormRow(label: T("Description (optional)")) {
                    TextField("", text: Binding(get: { draft?.description ?? "" }, set: { draft?.description = $0 }), axis: .vertical)
                        .lineLimit(2...4).font(NXFont.text(14)).padding(.vertical, 8).legalInput()
                }
            }
        }
    }

    private var fieldsCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            LegalSectionHeader(title: T("Form fields"),
                               subtitle: T("Found in the file. Change how each is asked; adding or removing a field means uploading a new version."))
            LegalFieldEditorList(fields: draft?.fields ?? [], path: []) { path, change in
                guard var d = draft else { return }
                LegalFieldEditorList.update(&d.fields, path: path, change)
                draft = d
            }
        }
    }

    private func versionsCard(_ tpl: LegalTemplate) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            LegalSectionHeader(title: T("Versions"))
            LegalListCard {
                ForEach(Array(tpl.versions.enumerated()), id: \.element.id) { i, v in
                    if i > 0 { Divider().overlay(NX.border) }
                    HStack(spacing: 10) {
                        Text(verbatim: "v\(v.version)").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).frame(minWidth: 30, alignment: .leading)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(v.fileName).font(NXFont.text(14)).foregroundStyle(NX.foreground).lineLimit(1)
                            Text(([LegalLabels.bytes(v.size), String(format: T("%d fields"), v.fieldCount), v.createdBy?.name ?? "—",
                                   LegalLabels.date(v.createdAt)] + (v.note.isEmpty ? [] : [v.note])).joined(separator: " · "))
                                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
                        }
                        Spacer(minLength: 0)
                        Button { Task { await download(v) } } label: {
                            if downloading == v.version { ProgressView() } else {
                                Image(systemName: "tray.and.arrow.down").font(.system(size: 17)).foregroundStyle(NX.mutedFg)
                            }
                        }
                        .buttonStyle(.plain)
                        .touchTarget44(drawn: 20)
                        .disabled(downloading != nil)
                        .accessibilityLabel(T("Download"))
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                }
            }
            VStack(alignment: .leading, spacing: 10) {
                Text(T("Upload a new version")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                LegalPickFileField(file: versionFile) { route = .pick([LegalFileTypes.docx], tag: "tplv") }
                TextField(T("What changed (optional)"), text: $versionNote).font(NXFont.text(14)).legalInput()
                LegalProblemList(title: T("Fix these in the Word file and upload again:"), lines: versionProblems)
                Button { Task { await addVersion() } } label: {
                    HStack(spacing: 5) {
                        if addingVersion { ProgressView() } else { Image(systemName: "tray.and.arrow.up") }
                        Text(T("Upload"))
                    }
                }
                .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                .disabled(versionFile == nil || addingVersion)
            }
            .padding(14)
            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
        }
    }

    private func apply(_ t: LegalTemplate) {
        template = t
        draft = Draft(t)
    }

    private func load() async {
        do { apply(try await APIClient.shared.legalTemplate(id: templateId)); error = nil }
        catch { if template == nil { self.error = error.legalMessage } else { LegalToasts.shared.failure(error) } }
    }

    private func save() async {
        guard let draft, let template else { return }
        saving = true
        defer { saving = false }
        let body: [String: Any] = [
            "name": draft.name.trimmingCharacters(in: .whitespacesAndNewlines),
            "description": draft.description,
            "docType": draft.docType ?? template.docType,
            "companyId": draft.companyId ?? NSNull(),
            "seriesId": draft.seriesId ?? NSNull(),
            "fields": LegalField.jsonArray(draft.fields),
        ]
        do {
            apply(try await APIClient.shared.legalUpdateTemplate(id: template.id, fields: body))
            LegalToasts.shared.success(T("Saved"))
        } catch {
            LegalToasts.shared.failure(error)
        }
    }

    private func setArchived(_ archived: Bool) async {
        guard let template else { return }
        archiving = true
        defer { archiving = false }
        do {
            let t = try await APIClient.shared.legalUpdateTemplate(id: template.id, fields: ["archived": archived])
            apply(t)
            LegalToasts.shared.success(t.archived ? T("Template archived") : T("Template restored"))
        } catch {
            LegalToasts.shared.failure(error)
        }
    }

    private func addVersion() async {
        guard let template, let versionFile else { return }
        addingVersion = true
        defer { addingVersion = false }
        do {
            let t = try await APIClient.shared.legalAddTemplateVersion(id: template.id, file: versionFile,
                                                                      note: versionNote.trimmingCharacters(in: .whitespacesAndNewlines))
            apply(t)
            self.versionFile = nil
            versionNote = ""
            versionProblems = []
            LegalToasts.shared.success(String(format: T("Version %d uploaded"), t.currentVersion))
        } catch {
            versionProblems = error.legalProblems
            if versionProblems.isEmpty { LegalToasts.shared.failure(error) }
        }
    }

    private func download(_ v: LegalTemplateVersion) async {
        guard let template else { return }
        downloading = v.version
        defer { downloading = nil }
        do {
            route = .share(try await APIClient.shared.legalDownloadTemplate(id: template.id, version: v.version,
                                                                            fallbackName: v.fileName.isEmpty ? "template.docx" : v.fileName))
        } catch {
            LegalToasts.shared.failure(error)
        }
    }
}

// MARK: - Field editor

/// The template's fields: label, type (a scalar field, among text/longtext/date/number/money/select),
/// required, choices for a select, and the columns of a table field. The document date's type and
/// required flag are fixed.
struct LegalFieldEditorList: View {
    let fields: [LegalField]
    let path: [Int]
    let onChange: ([Int], (inout LegalField) -> Void) -> Void

    static func update(_ list: inout [LegalField], path: [Int], _ change: (inout LegalField) -> Void) {
        guard let i = path.first, list.indices.contains(i) else { return }
        if path.count == 1 {
            change(&list[i])
        } else {
            var cols = list[i].columns ?? []
            update(&cols, path: Array(path.dropFirst()), change)
            list[i].columns = cols
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(fields.enumerated()), id: \.element.name) { i, f in
                row(f, at: path + [i])
            }
        }
    }

    private func row(_ f: LegalField, at p: [Int]) -> some View {
        let locked = f.name == LegalField.documentDate
        let scalar = f.type != "list" && f.type != "boolean"
        return VStack(alignment: .leading, spacing: 8) {
            Text(verbatim: "{{\(f.name)}}").font(.system(size: 11, design: .monospaced)).foregroundStyle(NX.mutedFg)
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) {
                    labelField(f, p)
                    typeControl(f, p, scalar: scalar, locked: locked).frame(width: 180)
                    requiredToggle(f, p, locked: locked).frame(width: 150)
                }
                VStack(alignment: .leading, spacing: 8) {
                    labelField(f, p)
                    HStack(spacing: 8) {
                        typeControl(f, p, scalar: scalar, locked: locked)
                        requiredToggle(f, p, locked: locked).frame(width: 150)
                    }
                }
            }
            if f.type == "select" {
                TextField(T("Choices, separated by commas"), text: Binding(
                    get: { (f.options ?? []).joined(separator: ", ") },
                    set: { v in onChange(p) { $0.options = v.split(separator: ",", omittingEmptySubsequences: false).map { String($0).trimmingLeading() } } }))
                    .font(NXFont.text(14)).legalInput()
            }
            if let cols = f.columns {
                VStack(alignment: .leading, spacing: 6) {
                    Text(T("Columns of each row")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    AnyView(LegalFieldEditorList(fields: cols, path: p, onChange: onChange))
                }
                .padding(.leading, 12)
                .overlay(alignment: .leading) { Rectangle().fill(NX.border).frame(width: 2) }
            }
        }
        .padding(12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
    }

    private func labelField(_ f: LegalField, _ p: [Int]) -> some View {
        TextField(T("Label"), text: Binding(get: { f.label }, set: { v in onChange(p) { $0.label = v } }))
            .font(NXFont.text(14)).legalInput()
            .accessibilityLabel(T("Label"))
    }

    @ViewBuilder private func typeControl(_ f: LegalField, _ p: [Int], scalar: Bool, locked: Bool) -> some View {
        if scalar && !locked {
            LegalMenuPicker(options: LegalField.scalarTypes.map { ($0, LegalLabels.fieldType($0)) },
                            selection: Binding(get: { f.type }, set: { v in if let v { onChange(p) { $0.type = v } } }))
                .accessibilityLabel(T("Type"))
        } else {
            Text(LegalLabels.fieldType(f.type)).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
        }
    }

    private func requiredToggle(_ f: LegalField, _ p: [Int], locked: Bool) -> some View {
        Toggle(isOn: Binding(get: { f.required }, set: { v in onChange(p) { $0.required = v } })) {
            Text(T("Required")).font(NXFont.text(14)).foregroundStyle(NX.foreground)
        }
        .tint(NX.violet)
        .disabled(locked)
    }
}

private extension String {
    func trimmingLeading() -> String { String(drop { $0.isWhitespace }) }
}

// MARK: - Placeholder help

/// "How to write placeholders" — the web's table, row for row.
struct LegalPlaceholderHelp: View {
    @State private var open = false

    private var rows: [(String, String)] {
        [("{{NAMA_PIHAK_KEDUA}}", T("A value from the form")),
         ("{{TANGGAL_TTD | hari}}", "Rabu"),
         ("{{TANGGAL_TTD | tanggal}}", "30 September 2026"),
         ("{{TANGGAL_TTD | tgl}} {{TANGGAL_TTD | bulan}}", "30 September"),
         ("{{TANGGAL_TTD | tahun_terbilang}}", "Dua Ribu Dua Puluh Enam"),
         ("{{HONOR | rupiah}}", "Rp. 25.000.000,00"),
         ("{{HONOR | terbilang_rupiah | upper}}", "DUA PULUH LIMA JUTA RUPIAH"),
         ("{{#BARANG}} … {{NAMA_BARANG}} … {{/BARANG}}", T("Repeats for each row (e.g. a table row)")),
         ("{{#PAKAI_MATERAI}} … {{/PAKAI_MATERAI}}", T("Shown only when ticked")),
         ("{{NOMOR}}", T("The document number, filled automatically")),
         ("{{TANGGAL_DOKUMEN}}", T("The document date (asked in every form)")),
         ("{{PT_PERUSAHAAN}} {{ALAMAT_PERUSAHAAN}}", T("The issuing company's legal name and address"))]
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Button { withAnimation(.easeOut(duration: 0.15)) { open.toggle() } } label: {
                HStack {
                    Text(T("How to write placeholders")).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground)
                    Spacer()
                    Image(systemName: "chevron.down").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg)
                        .rotationEffect(.degrees(open ? 180 : 0))
                }
                .padding(.horizontal, 14).padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if open {
                LegalHelpTable(rows: rows)
            }
        }
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
    }
}

/// Code → meaning rows, the code monospaced.
struct LegalHelpTable: View {
    let rows: [(String, String)]
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                Divider().overlay(NX.border)
                ViewThatFits(in: .horizontal) {
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        code(r.0).frame(width: 300, alignment: .leading)
                        meaning(r.1)
                        Spacer(minLength: 0)
                    }
                    VStack(alignment: .leading, spacing: 3) { code(r.0); meaning(r.1) }
                }
                .padding(.horizontal, 14).padding(.vertical, 8)
            }
        }
    }
    private func code(_ s: String) -> some View {
        Text(verbatim: s).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.foreground).textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
    }
    private func meaning(_ s: String) -> some View {
        Text(s).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
    }
}
