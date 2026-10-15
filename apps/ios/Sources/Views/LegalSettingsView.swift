import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Companies & numbering (owner, 14 Oct 2026; web LegalSettings): each issuing company's legal name and
// address as printed in contracts, its kop, and its numbering series. Only the owner and the BoD members
// he invited (invitePower ANY / STAFF) change these; everyone else reads them.
// ─────────────────────────────────────────────────────────────────────────────

struct LegalSettingsPane: View {
    let gutter: CGFloat
    let canEdit: Bool

    @State private var companies: [LegalCompany]?
    @State private var error: String?
    /// The company card at the top of the scroll: the jump chip it lights up, and where a chip scrolls to.
    @State private var current: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if !canEdit {
                    Text(T("Only the owner or a board member with Legal can change these."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                if companies == nil && error == nil {
                    LegalLoadingRow()
                } else if let error, companies == nil {
                    Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger)
                } else {
                    ForEach(companies ?? []) { c in
                        LegalCompanyCard(company: c, canEdit: canEdit) { await load() }
                            .id(c.id)
                    }
                }
                LegalTokenHelp()
            }
            .scrollTargetLayout()
            .padding(.horizontal, gutter)
            .padding(.vertical, 16)
        }
        .scrollPosition(id: $current, anchor: .top)
        // The web's company jump chips, pinned above the cards, the one in view lit up: The Z Networks sat
        // five pages down with no way to it but scrolling (UI tour run 15, Q-IB26 / R15-WB-7).
        .safeAreaInset(edge: .top, spacing: 0) {
            if let list = companies, list.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(list) { c in
                            let on = (current ?? list.first?.id) == c.id
                            Button { withAnimation(.snappy) { current = c.id } } label: {
                                // The code beside the name when it says something more ("Intoo INTOO" stays
                                // "Intoo", "Z" beside "The Z Networks"), as the web's chips (UI tour run 16, R16-B-22).
                                HStack(spacing: 5) {
                                    Text(c.name).font(NXFont.text(13, .medium)).lineLimit(1)
                                    if !c.code.isEmpty && c.code.caseInsensitiveCompare(c.name) != .orderedSame {
                                        Text(verbatim: c.code).font(.system(size: 11, design: .monospaced)).foregroundStyle(NX.mutedFg)
                                    }
                                }
                                    .padding(.horizontal, 12).padding(.vertical, 6)
                                    .nxChoiceChip(on: on)
                                    .frame(minHeight: 44).contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(on ? .isSelected : [])
                        }
                    }
                    .padding(.horizontal, gutter)
                }
                .nxEdgeFade()
                .background(NX.background)
            }
        }
        .refreshable { await load() }
        .task { await load() }
    }

    private func load() async {
        do { companies = try await APIClient.shared.legalCompanies(); error = nil }
        catch { if companies == nil { self.error = error.legalMessage } else { LegalToasts.shared.failure(error) } }
    }
}

private struct LegalCompanyCard: View {
    let company: LegalCompany
    let canEdit: Bool
    let reload: () async -> Void

    @Environment(\.horizontalSizeClass) private var hSize
    @State private var name = ""
    @State private var code = ""
    @State private var legalName = ""
    @State private var address = ""
    @State private var saving = false
    @State private var kopBusy = false
    @State private var route: LegalFileRoute?
    @State private var adding = false

    private var dirty: Bool {
        name != company.name || code != company.code || legalName != company.legalName || address != company.address
    }

    var body: some View {
        NXCard(padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(company.name).font(NXFont.text(17, .semibold)).foregroundStyle(NX.foreground)
                    // No "PATS PATS": the code only when it differs from the name (web; UI tour run 16).
                    if company.code.caseInsensitiveCompare(company.name) != .orderedSame {
                        Text(verbatim: company.code).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.mutedFg)
                    }
                    Spacer(minLength: 0)
                    if company.legalName.isEmpty {
                        Label(T("Legal name (PT) not filled in"), systemImage: "exclamationmark.triangle.fill")
                            .font(NXFont.text(12)).foregroundStyle(ChipTone.warning.fg)
                    }
                }
                fields
                if canEdit {
                    Button { Task { await save() } } label: {
                        HStack(spacing: 5) { if saving { ProgressView().tint(NX.background) }; Text(T("Save")) }
                    }
                    .buttonStyle(NXButtonStyle(kind: .primary, compact: true))
                    .disabled(!dirty || saving)
                }
                kopRow
                seriesSection
            }
        }
        .onAppear(perform: sync)
        .onChange(of: company) { _, _ in sync() }
        .legalFileSheet($route) { _, url in Task { await uploadKop(url) } }
    }

    private func sync() {
        name = company.name; code = company.code; legalName = company.legalName; address = company.address
    }

    @ViewBuilder private var fields: some View {
        let nameRow = LegalFormRow(label: T("Name")) {
            TextField("", text: $name).font(NXFont.text(14)).legalInput().disabled(!canEdit)
        }
        let codeRow = LegalFormRow(label: T("Code in numbers ({CO})")) {
            TextField("", text: Binding(get: { code }, set: { code = $0.uppercased() }))
                .font(NXFont.text(14)).textInputAutocapitalization(.characters).autocorrectionDisabled().legalInput().disabled(!canEdit)
        }
        if hSize == .regular {
            HStack(alignment: .top, spacing: 12) { nameRow; codeRow }
        } else {
            nameRow
            codeRow
        }
        LegalFormRow(label: T("Legal name, as printed in contracts")) {
            TextField("PT …", text: $legalName).font(NXFont.text(14)).legalInput().disabled(!canEdit)
        }
        LegalFormRow(label: T("Address")) {
            TextField("", text: $address, axis: .vertical).lineLimit(2...4).font(NXFont.text(14)).padding(.vertical, 8)
                .legalInput().disabled(!canEdit)
        }
    }

    /// iPad / Mac: the buttons always on the right, a long file name cut in the middle. Fitting the row
    /// to its text put one company's buttons under a long name while the others sat beside it (I-26).
    @ViewBuilder private var kopRow: some View {
        Group {
            if hSize == .regular {
                HStack(spacing: 10) { kopText; Spacer(minLength: 0); kopButtons.fixedSize() }
            } else {
                VStack(alignment: .leading, spacing: 8) { kopText; kopButtons }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private var kopText: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(T("Letterhead")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).fixedSize()
            if company.hasKop {
                // The file name on its line and "Uploaded 14 Oct" on the next, as on the web: one sentence
                // left "14 Oct" hanging under the name (UI tour run 15, Q-IB25). The whole name, wrapping when
                // it must ("Kop_Surat_Suwara_Lo….docx", run 14, P-I27).
                VStack(alignment: .leading, spacing: 2) {
                    Text(company.kopFileName ?? "kop.docx").fixedSize(horizontal: false, vertical: true)
                    Text(T("Uploaded {date}").replacingOccurrences(of: "{date}", with: LegalLabels.date(company.kopUpdatedAt)))
                }
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                Text(T("Not uploaded: documents get no letterhead."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var kopButtons: some View {
        HStack(spacing: 6) {
            if company.hasKop {
                // Bordered like Replace beside it: one button style in the row (N-40).
                Button { Task { await downloadKop() } } label: { Label(T("Download"), systemImage: "tray.and.arrow.down") }
                    .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                    .disabled(kopBusy)
            }
            if canEdit {
                Button { route = .pick([LegalFileTypes.docx], tag: "kop") } label: {
                    HStack(spacing: 5) {
                        if kopBusy { ProgressView() } else { Image(systemName: "tray.and.arrow.up") }
                        Text(company.hasKop ? T("Replace") : T("Upload letterhead"))
                    }
                }
                .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                .disabled(kopBusy)
            }
        }
    }

    private var seriesSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(T("Numbering series")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Spacer()
                if canEdit && !adding {
                    Button { adding = true } label: { Label(T("Add numbering series"), systemImage: "plus") }
                        .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
                }
            }
            VStack(spacing: 0) {
                ForEach(Array(company.series.enumerated()), id: \.element.id) { i, s in
                    if i > 0 { Divider().overlay(NX.border) }
                    LegalSeriesRow(series: s, canEdit: canEdit, reload: reload)
                }
                if adding {
                    if !company.series.isEmpty { Divider().overlay(NX.border) }
                    LegalNewSeriesRow(companyId: company.id) { added in
                        adding = false
                        if added { await reload() }
                    }
                }
            }
            .background(NX.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
        }
    }

    private func save() async {
        saving = true
        defer { saving = false }
        do {
            _ = try await APIClient.shared.legalUpdateCompany(id: company.id, fields: [
                "name": name, "code": code, "legalName": legalName, "address": address,
            ])
            LegalToasts.shared.success(T("Saved"))
            await reload()
        } catch {
            LegalToasts.shared.failure(error)
        }
    }

    private func uploadKop(_ file: URL) async {
        kopBusy = true
        defer { kopBusy = false }
        do {
            _ = try await APIClient.shared.legalUploadKop(companyId: company.id, file: file)
            LegalToasts.shared.success(T("Letterhead uploaded"))
            await reload()
        } catch {
            LegalToasts.shared.failure(error)
        }
    }

    private func downloadKop() async {
        kopBusy = true
        defer { kopBusy = false }
        do { route = .share(try await APIClient.shared.legalDownloadKop(companyId: company.id)) }
        catch { LegalToasts.shared.failure(error) }
    }
}

private struct LegalSeriesRow: View {
    let series: LegalSeries
    let canEdit: Bool
    let reload: () async -> Void

    @State private var editing = false
    @State private var label = ""
    @State private var format = ""
    @State private var resetPeriod: String? = "YEAR"
    @State private var info: LegalSeriesInfo?
    @State private var saving = false
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        if editing { editor } else { summary }
    }

    /// Web-mobile's compact row (UI tour run 10, IP-5), one line each (UI tour run 12, IP10: the meta wrapped
    /// an orphan "· Yearly" line and the pattern broke mid-token): the name; the type · period, where the
    /// type gives way and the period is never cut (run 11, PD-10); the pattern, ellipsized, whole in its
    /// VoiceOver label and pointer tooltip and in the editor. On a phone the switch has no "In use" words
    /// (still its VoiceOver label).
    private var summary: some View {
        HStack(spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(series.label).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                HStack(spacing: 0) {
                    // The full type where it fits ("Warning letter (SP)", as on the web; UI tour run 15, Q-IB26), the
                    // short one ("MoU", "PKS") where it would be cut inside its brackets (N-40).
                    ViewThatFits(in: .horizontal) {
                        Text(LegalLabels.docType(series.docType)).lineLimit(1).fixedSize()
                        Text(LegalLabels.docTypeShort(series.docType)).lineLimit(1)
                    }
                    // One space each side of the dot, as every other meta line (UI tour run 15, R15-I-24).
                    Text(" · \(LegalLabels.resetPeriod(series.resetPeriod))").lineLimit(1).fixedSize()
                }
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                Text(verbatim: series.format).font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.mutedFg)
                    .lineLimit(1).truncationMode(.tail)
                    .help(series.format)
                    .accessibilityLabel(series.format)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if canEdit {
                inUseToggle
                Button {
                    label = series.label; format = series.format; resetPeriod = series.resetPeriod
                    editing = true
                } label: {
                    Image(systemName: "pencil").font(.system(size: 14)).foregroundStyle(NX.mutedFg).touchTarget44(drawn: 16)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(T("Edit"))
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 10)
        .opacity(series.active ? 1 : 0.6)
    }

    @ViewBuilder private var inUseToggle: some View {
        // The web's switch: dark, its words on the right (UI tour run 16, R16-B-22).
        let toggle = Toggle(isOn: Binding(get: { series.active }, set: { v in Task { await patch(["active": v]) } })) {
            Text(T("In use")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        .labelsHidden()
        .tint(NX.onyx)
        .accessibilityLabel(T("In use"))
        if hSize == .regular {
            HStack(spacing: 6) {
                toggle.fixedSize()
                Text(T("In use")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).accessibilityHidden(true)
            }
        } else {
            toggle.fixedSize()
        }
    }

    private var editor: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField(T("Name"), text: $label).font(NXFont.text(14)).legalInput()
            TextField(T("Format"), text: $format).font(.system(size: 13, design: .monospaced))
                .textInputAutocapitalization(.characters).autocorrectionDisabled().legalInput()
            LegalMenuPicker(options: [("YEAR", T("Yearly")), ("MONTH", T("Monthly"))], selection: $resetPeriod)
            if let info {
                Text(String(format: T("%d numbers issued. Next today: %@"), info.issued, info.next)
                     + (info.issued > 0 ? " " + T("A new format applies only to numbers issued from now on.") : ""))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                Button {
                    Task {
                        saving = true
                        if await patch(["label": label, "format": format, "resetPeriod": resetPeriod ?? "YEAR"]) { editing = false }
                        saving = false
                    }
                } label: { Label(T("Save"), systemImage: "checkmark") }
                    .buttonStyle(NXButtonStyle(kind: .primary, compact: true))
                    .disabled(saving)
                Button { editing = false } label: { Label(T("Cancel"), systemImage: "xmark") }
                    .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
            }
        }
        .padding(12)
        .task { info = try? await APIClient.shared.legalSeries(id: series.id) }
    }

    @discardableResult
    private func patch(_ fields: [String: Any]) async -> Bool {
        do {
            _ = try await APIClient.shared.legalUpdateSeries(id: series.id, fields: fields)
            LegalToasts.shared.success(T("Saved"))
            await reload()
            return true
        } catch {
            LegalToasts.shared.failure(error)
            return false
        }
    }
}

private struct LegalNewSeriesRow: View {
    let companyId: String
    let onDone: (Bool) async -> Void

    @State private var docType: String? = "SURAT"
    @State private var label = ""
    @State private var format = "{SEQ:3}/{CO}/{ROMAWI}/{YYYY}"
    @State private var resetPeriod: String? = "YEAR"
    @State private var adding = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            LegalMenuPicker(options: LegalLabels.docTypes.map { ($0, LegalLabels.docType($0)) },
                            selection: Binding(get: { docType }, set: { docType = $0; if $0 == "INVOICE" { resetPeriod = "MONTH" } }))
            TextField(T("Name, e.g. SPK Talent"), text: $label).font(NXFont.text(14)).legalInput()
            TextField(T("Format"), text: $format).font(.system(size: 13, design: .monospaced))
                .textInputAutocapitalization(.characters).autocorrectionDisabled().legalInput()
            LegalMenuPicker(options: [("YEAR", T("Yearly")), ("MONTH", T("Monthly"))], selection: $resetPeriod)
            HStack(spacing: 8) {
                Button { Task { await add() } } label: { Text(T("Add")) }
                    .buttonStyle(NXButtonStyle(kind: .primary, compact: true))
                    .disabled(label.trimmingCharacters(in: .whitespaces).isEmpty || adding)
                Button(T("Cancel")) { Task { await onDone(false) } }
                    .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
            }
        }
        .padding(12)
        .background(NX.muted.opacity(0.4))
    }

    private func add() async {
        adding = true
        defer { adding = false }
        do {
            _ = try await APIClient.shared.legalAddSeries(companyId: companyId, docType: docType ?? "SURAT",
                                                         label: label.trimmingCharacters(in: .whitespacesAndNewlines),
                                                         format: format, resetPeriod: resetPeriod ?? "YEAR")
            LegalToasts.shared.success(T("Series added"))
            await onDone(true)
        } catch {
            LegalToasts.shared.failure(error)
        }
    }
}

/// The number format's tokens (web TokenHelp).
private struct LegalTokenHelp: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(T("Number format")).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground)
                .padding(.horizontal, 14).padding(.vertical, 12)
            LegalHelpTable(rows: [
                ("{SEQ:3}", T("Running number, 3 digits (001). Required.")),
                ("{ROMAWI}", T("Month in Roman numerals (X)")),
                ("{BLN} / {MM}", T("Month: OKT / 10")),
                ("{YYYY} / {YY}", T("Year: 2026 / 26. Required.")),
                ("{CO}", T("The company's code")),
                ("{KOTA}", T("Any form field by its name, e.g. the city")),
            ])
        }
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
    }
}
