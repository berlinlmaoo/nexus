import SwiftUI
import UniformTypeIdentifiers

// ─────────────────────────────────────────────────────────────────────────────
// New document (owner, 14 Oct 2026; web NewDocumentDialog + LegalFieldInput): pick a template (and the
// company, when the template is for any company) → the form made from its {{PLACEHOLDERS}} → the number
// is taken only when it is generated. And Upload document (web UploadDocumentDialog): a document made
// elsewhere into the archive, keeping its own number.
// ─────────────────────────────────────────────────────────────────────────────

struct LegalNewDocumentSheet: View {
    /// Create addendum: the signed document it amends. Only addendum templates are offered; company, kop and
    /// number follow the parent, and the form starts filled from it (owner, 14 Oct 2026).
    struct Parent: Equatable { let id: String; let number: String; let title: String }
    var parent: Parent? = nil
    /// "Create document" from a Legal request (owner, 14 Oct 2026): its template and company are picked, the
    /// form starts with what the requester filled, and the document is linked to the request.
    struct FromRequest: Equatable {
        let requestId: String
        let templateId: String?
        let companyId: String
        let values: [String: LegalValue]
        let link: LegalLink?
    }
    var fromRequest: FromRequest? = nil
    let onCreated: (String) -> Void

    private enum Step { case pick, form }

    @Environment(\.dismiss) private var dismiss
    @State private var step: Step = .pick
    @State private var templates: [LegalTemplate]?
    @State private var companies: [LegalCompany] = []
    @State private var listError: String?
    @State private var templateId: String?
    @State private var companyId: String?

    @State private var prepared: LegalPrepared?
    @State private var prepareError: String?
    @State private var values: [String: LegalValue] = [:]
    @State private var title = ""
    @State private var counterparty = ""
    @State private var link: LegalLink?
    @State private var preview: String?
    @State private var errors: [String: String] = [:]
    @State private var problems: [String] = []
    @State private var formError: String?
    @State private var generating = false

    private var template: LegalTemplate? { templates?.first { $0.id == templateId } }
    private var effectiveCompany: String? { template?.company?.id ?? companyId }
    private var canContinue: Bool { template != nil && (parent != nil || effectiveCompany != nil) }
    /// Addendum templates only from a signed document; the rest only from New document.
    private var offered: [LegalTemplate]? { templates?.filter { ($0.docType == LegalLabels.addendumType) == (parent != nil) } }
    private var fields: [LegalField] { prepared?.fields ?? [] }

    /// The values the number reads: the document date plus every field the series format names.
    private var numberInputs: [String: LegalValue] {
        let names = [LegalField.documentDate] + LegalText.formatFields(prepared?.series?.format ?? "")
        return values.filter { names.contains($0.key) }
    }
    private var numberKey: String {
        numberInputs.sorted { $0.key < $1.key }.map { "\($0.key)=\($0.value.string)" }.joined(separator: "|")
    }
    /// Errors the server gave for something that is not one of the form's fields.
    private var extraErrors: [(String, String)] {
        errors.filter { e in !fields.contains { e.key == $0.name || e.key.hasPrefix("\($0.name).") } }
            .sorted { $0.key < $1.key }.map { ($0.key, $0.value) }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text(step == .pick
                         ? (parent.map { String(format: T("Addendum to %@. Pick the addendum template."), $0.number) } ?? T("Pick the template and the company that issues it."))
                         : "\(template?.name ?? "") · \(prepared?.company?.name ?? "")")
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    if step == .pick { pickStep } else { formStep }
                }
                .padding(20)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(parent == nil ? T("New document") : T("Create addendum"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                if step == .form {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { step = .pick; errors = [:]; problems = []; formError = nil } label: { Label(T("Back"), systemImage: "chevron.left") }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    if step == .pick {
                        Button(T("Continue")) { startForm() }.disabled(!canContinue)
                    } else if generating {
                        ProgressView()
                    } else {
                        Button(T("Generate")) { Task { await generate() } }.disabled(prepared == nil)
                    }
                }
            }
            .task {
                async let t = APIClient.shared.legalTemplates()
                async let c = APIClient.shared.legalCompanies()
                do { templates = try await t } catch { listError = error.legalMessage; templates = [] }
                companies = (try? await c) ?? []
                if parent != nil, templateId == nil, let only = offered, only.count == 1 { templateId = only[0].id }
                // From a request: its template and company, straight to the form (an archived template stays on Pick).
                if let fr = fromRequest, step == .pick, let tpl = templates?.first(where: { $0.id == fr.templateId }) {
                    templateId = tpl.id
                    companyId = tpl.company?.id ?? fr.companyId
                    startForm()
                    link = fr.link
                } else if let fr = fromRequest, companyId == nil {
                    companyId = fr.companyId
                    link = fr.link
                }
            }
            .task(id: numberKey) { await refreshPreview() }
        }
        .interactiveDismissDisabled(generating)
        .legalToasts()
    }

    // MARK: Step 1

    @ViewBuilder private var pickStep: some View {
        if templates == nil {
            LegalLoadingRow()
        } else if let listError {
            Text(listError).font(NXFont.text(13)).foregroundStyle(NX.danger)
        } else if let templates = offered, templates.isEmpty {
            Text(parent == nil ? T("No templates yet. Upload one in the Templates tab first.")
                               : T("No addendum template yet. Upload one with the type Addendum in the Templates tab first."))
                .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
        } else if let templates = offered {
            LegalListCard {
                ForEach(Array(templates.enumerated()), id: \.element.id) { i, tpl in
                    if i > 0 { Divider().overlay(NX.border) }
                    Button {
                        templateId = tpl.id
                        companyId = tpl.company?.id
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "doc.text").font(.system(size: 15)).foregroundStyle(NX.mutedFg)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(tpl.name).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                                Text("\(LegalLabels.docType(tpl.docType)) · \(tpl.company?.name ?? T("Any company"))")
                                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                            }
                            Spacer(minLength: 0)
                            if templateId == tpl.id {
                                Image(systemName: "checkmark.circle.fill").foregroundStyle(NX.violetText)
                            }
                        }
                        .padding(.horizontal, 14).padding(.vertical, 11)
                        .background(templateId == tpl.id ? NX.accentBg : Color.clear)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(templateId == tpl.id ? .isSelected : [])
                }
            }
            if let template, template.company == nil, parent == nil {
                LegalFormRow(label: T("Issuing company")) {
                    LegalMenuPicker(options: companies.filter(\.active).map { ($0.id, $0.name) }, selection: $companyId,
                                    placeholder: T("Pick a company"))
                }
            }
        }
    }

    private func startForm() {
        guard canContinue else { return }
        step = .form
        prepared = nil
        prepareError = nil
        preview = nil
        values = [:]
        errors = [:]
        problems = []
        formError = nil
        Task { await prepare() }
    }

    // MARK: Step 2

    @ViewBuilder private var formStep: some View {
        if let prepareError {
            Text(prepareError).font(NXFont.text(13)).foregroundStyle(NX.danger)
        } else if let prepared {
            numberCard(prepared)
            if prepared.company?.hasKop == false {
                Label(T("This company has no letterhead yet: the document will be printed without one."), systemImage: "exclamationmark.triangle.fill")
                    .font(NXFont.text(12)).foregroundStyle(ChipTone.warning.fg)
            }
            NXCard(padding: 16) {
                VStack(alignment: .leading, spacing: 14) {
                    LegalFormRow(label: T("Title in the archive")) {
                        TextField(template?.name ?? "", text: $title).font(NXFont.text(14)).legalInput()
                    }
                    LegalFormRow(label: T("Counterparty")) {
                        TextField(T("Who the document is with"), text: $counterparty).font(NXFont.text(14)).legalInput()
                    }
                    LegalFormRow(label: T("Belongs to")) {
                        LegalLinkButton(value: link) { link = $0 }
                    }
                }
            }
            NXCard(padding: 16) {
                VStack(alignment: .leading, spacing: 16) {
                    ForEach(fields) { f in
                        LegalFieldInput(field: f, value: values[f.name], errors: errors, path: f.name) { v in
                            values[f.name] = v
                            errors[f.name] = nil
                        }
                    }
                }
            }
            LegalProblemList(lines: problems + extraErrors.map { "\($0.0): \(T($0.1))" })
            if let formError {
                Text(formError).font(NXFont.text(13)).foregroundStyle(NX.danger)
            }
            Button { Task { await generate() } } label: {
                HStack(spacing: 6) {
                    if generating { ProgressView().tint(NX.background) }
                    Text(T("Generate"))
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.nxPrimary)
            .disabled(generating)
        } else {
            LegalLoadingRow()
        }
    }

    private func numberCard(_ p: LegalPrepared) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "number").font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.mutedFg).padding(.top, 2)
            VStack(alignment: .leading, spacing: 3) {
                Text(preview ?? p.numberPreview).font(.system(size: 15, weight: .medium, design: .monospaced))
                    .foregroundStyle(NX.foreground).textSelection(.enabled)
                Text(p.parent.map { String(format: T("Addendum %d to %@. The number is taken only when you generate."), $0.addendumNo, $0.number) }
                     ?? String(format: T("Next number in %@. It is taken only when you generate."), p.series?.label ?? ""))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(NX.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
    }

    private func prepare() async {
        guard let templateId else { return }
        do {
            let p = try await APIClient.shared.legalPrepare(templateId: templateId, companyId: effectiveCompany, parentDocumentId: parent?.id)
            prepared = p
            preview = p.numberPreview
            // What the requester filled wins; an addendum's parties then start from its parent.
            for (k, v) in fromRequest?.values ?? [:] where values[k] == nil { values[k] = v }
            for (k, v) in p.prefill where values[k] == nil { values[k] = .text(v) }
            // The document date defaults to today in Jakarta.
            if values[LegalField.documentDate] == nil { values[LegalField.documentDate] = .text(LegalText.todayJakarta()) }
        } catch {
            prepareError = error.legalMessage
        }
    }

    /// Re-asked (debounced) when the document date or a field the number format reads changes.
    private func refreshPreview() async {
        guard step == .form, prepared != nil, let templateId else { return }
        try? await Task.sleep(nanoseconds: 400_000_000)
        guard !Task.isCancelled else { return }
        if let p = try? await APIClient.shared.legalPrepare(templateId: templateId, companyId: effectiveCompany, values: numberInputs, parentDocumentId: parent?.id),
           !Task.isCancelled {
            preview = p.numberPreview
        }
    }

    private func generate() async {
        guard let templateId, !generating else { return }
        generating = true
        defer { generating = false }
        formError = nil
        do {
            let res = try await APIClient.shared.legalGenerate(
                templateId: templateId, companyId: effectiveCompany, values: values,
                title: title.trimmingCharacters(in: .whitespacesAndNewlines),
                counterparty: counterparty.trimmingCharacters(in: .whitespacesAndNewlines),
                projectId: link?.projectId, dealId: link?.dealId, parentDocumentId: parent?.id, requestId: fromRequest?.requestId)
            LegalToasts.shared.success(String(format: T("Document %@ made"), res.number))
            LegalToasts.shared.pdfWarning(res.pdfError)
            dismiss()
            onCreated(res.id)
        } catch {
            errors = error.legalFieldErrors
            problems = error.legalProblems
            if errors.isEmpty && problems.isEmpty {
                formError = error.legalMessage
                LegalToasts.shared.failure(error)
            } else {
                LegalToasts.shared.failure(T("Some fields need attention"))
            }
        }
    }
}

// MARK: - One form field

/// One form field of a template, by its type. `errors` is keyed like the server's ("ROWS.0.CELL").
struct LegalFieldInput: View {
    let field: LegalField
    let value: LegalValue?
    let errors: [String: String]
    let path: String
    /// The request form: people outside Legal see the label only, not the placeholder's name.
    var hideName = false
    let onChange: (LegalValue?) -> Void

    private var error: String? { errors[path] }
    private var str: String { value?.string ?? "" }

    var body: some View {
        switch field.type {
        case "boolean":
            VStack(alignment: .leading, spacing: 4) {
                LegalToggle(label: field.label, isOn: Binding(get: { value == .bool(true) }, set: { onChange(.bool($0)) }))
                if let error { Text(T(error)).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
        case "list":
            listInput
        default:
            LegalFormRow(label: field.label, required: field.required, mono: hideName ? nil : field.name, hint: field.help, error: error) {
                scalar
            }
        }
    }

    @ViewBuilder private var scalar: some View {
        switch field.type {
        case "longtext":
            TextEditor(text: Binding(get: { str }, set: { onChange(.text($0)) }))
                .font(NXFont.text(14))
                .scrollContentBackground(.hidden)
                .frame(minHeight: 84)
                .padding(.horizontal, 6).padding(.vertical, 4)
                .background(NX.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(error != nil ? NX.danger.opacity(0.7) : NX.border))
        case "date":
            dateInput
        case "money":
            HStack(spacing: 6) {
                Text(verbatim: "Rp").font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                TextField("", text: Binding(
                    get: { LegalText.groupDigits(str.replacingOccurrences(of: ".", with: ",")) },
                    set: { onChange(.text(LegalText.ungroup(LegalText.groupDigits($0)))) }))
                    .font(NXFont.text(14)).keyboardType(.decimalPad)
            }
            .legalInput(invalid: error != nil)
        case "number":
            TextField("", text: Binding(get: { str }, set: { v in onChange(.text(v.filter { $0.isNumber || ".,-".contains($0) })) }))
                .font(NXFont.text(14)).keyboardType(.numbersAndPunctuation).legalInput(invalid: error != nil)
        case "select":
            LegalMenuPicker(options: (field.options ?? []).map { ($0, $0) },
                            selection: Binding(get: { str.isEmpty ? nil : str }, set: { onChange($0.map { LegalValue.text($0) }) }),
                            placeholder: T("Pick one"), invalid: error != nil)
        default:
            TextField("", text: Binding(get: { str }, set: { onChange(.text($0)) }))
                .font(NXFont.text(14)).legalInput(invalid: error != nil)
        }
    }

    @ViewBuilder private var dateInput: some View {
        if let day = LegalText.date(fromDay: str) {
            HStack(spacing: 8) {
                DatePicker("", selection: Binding(get: { day }, set: { onChange(.text(LegalText.dayString($0))) }), displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.locale, AppDateLocale.current)
                    .environment(\.timeZone, LegalText.jakarta)
                Spacer(minLength: 0)
                if field.name != LegalField.documentDate {
                    Button { onChange(nil) } label: { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg) }
                        .buttonStyle(.plain).accessibilityLabel(T("Clear"))
                }
            }
        } else {
            Button { onChange(.text(LegalText.todayJakarta())) } label: {
                HStack(spacing: 6) {
                    Image(systemName: "calendar").foregroundStyle(NX.mutedFg)
                    Text(T("Pick a date")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    Spacer(minLength: 0)
                }
                .legalInput(invalid: error != nil)
            }
            .buttonStyle(.plain)
        }
    }

    private var listInput: some View {
        let rows = value?.rows ?? []
        let cols = field.columns ?? []
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text(field.label).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                if field.required { Text(verbatim: "*").font(NXFont.text(13, .bold)).foregroundStyle(NX.danger) }
                if !hideName { Text(verbatim: field.name).font(.system(size: 10, design: .monospaced)).foregroundStyle(NX.mutedFg) }
            }
            ForEach(Array(rows.indices), id: \.self) { i in
                VStack(alignment: .leading, spacing: 10) {
                    HStack {
                        Text(String(format: T("Row %d"), i + 1)).font(NXFont.text(12, .medium)).foregroundStyle(NX.mutedFg)
                        Spacer()
                        Button {
                            var next = rows
                            next.remove(at: i)
                            onChange(.rows(next))
                        } label: {
                            Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(NX.mutedFg).touchTarget44(drawn: 14)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(T("Remove row"))
                    }
                    ForEach(cols) { c in
                        AnyView(LegalFieldInput(field: c, value: rows[i][c.name], errors: errors, path: "\(path).\(i).\(c.name)", hideName: hideName) { v in
                            var next = rows
                            guard next.indices.contains(i) else { return }
                            next[i][c.name] = v
                            onChange(.rows(next))
                        })
                    }
                }
                .padding(12)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
            }
            Button { onChange(.rows(rows + [[:]])) } label: { Label(T("Add row"), systemImage: "plus") }
                .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
            if let error = errors[path] {
                Text(T(error)).font(NXFont.text(12)).foregroundStyle(NX.danger)
            } else if let help = field.help, !help.isEmpty {
                Text(T(help)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
        }
    }
}

// MARK: - Upload document

/// Put a document made elsewhere into the archive: a signed contract, an outside invoice, a scan.
struct LegalUploadDocumentSheet: View {
    let companies: [LegalCompany]
    let onCreated: (String) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var loadedCompanies: [LegalCompany] = []
    @State private var file: URL?
    @State private var companyId: String?
    @State private var docType: String?
    @State private var title = ""
    @State private var number = ""
    @State private var counterparty = ""
    @State private var docDate: String?
    @State private var status: String? = "SIGNED"
    @State private var link: LegalLink?
    @State private var route: LegalFileRoute?
    @State private var uploading = false
    @State private var error: String?

    private var allCompanies: [LegalCompany] { companies.isEmpty ? loadedCompanies : companies }
    private var canUpload: Bool {
        file != nil && companyId != nil && docType != nil && !title.trimmingCharacters(in: .whitespaces).isEmpty && !uploading
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text(T("A document made elsewhere — a signed contract, an outside invoice. It keeps its own number."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    LegalFormRow(label: T("File (PDF, Word or photo)")) {
                        Button { route = .pick(LegalFileTypes.documents, tag: "doc") } label: {
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
                    LegalFormRow(label: T("Company")) {
                        LegalMenuPicker(options: allCompanies.map { ($0.id, $0.name) }, selection: $companyId, placeholder: T("Pick a company"))
                    }
                    LegalFormRow(label: T("Document type")) {
                        LegalMenuPicker(options: LegalLabels.docTypes.map { ($0, LegalLabels.docType($0)) }, selection: $docType, placeholder: T("Pick a type"))
                    }
                    LegalFormRow(label: T("Title")) {
                        TextField("", text: $title).font(NXFont.text(14)).legalInput()
                    }
                    LegalFormRow(label: T("Number on the document")) {
                        TextField("", text: $number).font(NXFont.text(14)).textInputAutocapitalization(.characters).autocorrectionDisabled().legalInput()
                    }
                    LegalFormRow(label: T("Counterparty")) {
                        TextField("", text: $counterparty).font(NXFont.text(14)).legalInput()
                    }
                    LegalFormRow(label: T("Date")) {
                        LegalOptionalDay(day: $docDate)
                    }
                    LegalFormRow(label: T("Status")) {
                        LegalMenuPicker(options: LegalLabels.statuses.map { ($0, LegalLabels.status($0)) }, selection: $status)
                    }
                    LegalFormRow(label: T("Belongs to")) {
                        LegalLinkButton(value: link) { link = $0 }
                    }
                    if let error { Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger) }
                }
                .padding(20)
                .frame(maxWidth: 640, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(T("Upload document"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if uploading { ProgressView() } else { Button(T("Upload")) { Task { await upload() } }.disabled(!canUpload) }
                }
            }
            .legalFileSheet($route) { _, url in
                file = url
                if title.isEmpty { title = url.deletingPathExtension().lastPathComponent }
            }
            .task { if companies.isEmpty { loadedCompanies = (try? await APIClient.shared.legalCompanies()) ?? [] } }
        }
        .interactiveDismissDisabled(uploading)
    }

    private func upload() async {
        guard let file, let companyId, let docType else { return }
        uploading = true
        defer { uploading = false }
        error = nil
        var fields: [String: String] = [
            "companyId": companyId, "docType": docType, "title": title.trimmingCharacters(in: .whitespacesAndNewlines),
            "number": number.trimmingCharacters(in: .whitespacesAndNewlines),
            "counterparty": counterparty.trimmingCharacters(in: .whitespacesAndNewlines),
            "status": status ?? "SIGNED",
        ]
        if let docDate { fields["docDate"] = docDate }
        if let p = link?.projectId { fields["projectId"] = p }
        if let d = link?.dealId { fields["dealId"] = d }
        do {
            let res = try await APIClient.shared.legalUploadDocument(file: file, fields: fields)
            LegalToasts.shared.success(T("Added to the archive"))
            LegalToasts.shared.pdfWarning(res.pdfError)
            dismiss()
            onCreated(res.id)
        } catch {
            self.error = error.legalMessage
        }
    }
}

/// A calendar day that may be empty: "Pick a date" until one is set, then a picker and ✕.
struct LegalOptionalDay: View {
    @Binding var day: String?
    var body: some View {
        if let d = day.flatMap({ LegalText.date(fromDay: $0) }) {
            HStack(spacing: 8) {
                DatePicker("", selection: Binding(get: { d }, set: { day = LegalText.dayString($0) }), displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.locale, AppDateLocale.current)
                    .environment(\.timeZone, LegalText.jakarta)
                Spacer(minLength: 0)
                Button { day = nil } label: { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg) }
                    .buttonStyle(.plain).accessibilityLabel(T("Clear"))
            }
        } else {
            Button { day = LegalText.todayJakarta() } label: {
                HStack(spacing: 6) {
                    Image(systemName: "calendar").foregroundStyle(NX.mutedFg)
                    Text(T("Pick a date")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                    Spacer(minLength: 0)
                }
                .legalInput()
            }
            .buttonStyle(.plain)
        }
    }
}
