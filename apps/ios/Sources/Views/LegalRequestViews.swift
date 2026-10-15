import SwiftUI
import UniformTypeIdentifiers

// ─────────────────────────────────────────────────────────────────────────────
// Legal requests (owner, 14 Oct 2026; web: components/legal/LegalRequestForm.tsx, MyLegalRequests.tsx,
// LegalRequests.tsx).
//   - LegalRequestFormView: the form behind a link (/f/legal-<token>), opened in the app from the link.
//   - MyLegalRequestsStrip / MyLegalRequestSheet: my own requests in My Submissions, with the final file.
//   - LegalRequestsPane / LegalRequestDetailView / LegalRequestLinksSheet: Legal's board (invited members).
// Confirmations are centred `.alert`s; every view keeps one `.sheet(item:)`.
// ─────────────────────────────────────────────────────────────────────────────

enum LegalRequestLabels {
    static func stage(_ s: String) -> String {
        switch s {
        case "RECEIVED": return T("Received")
        case "IN_PROGRESS": return T("In progress")
        case "REVISION": return T("Revision")
        case "FINAL": return T("Final")
        case "SIGNED": return T("Signed")
        case "DONE": return T("Done")
        case "REJECTED": return T("Rejected")
        default: return s
        }
    }
    static func stageTone(_ s: String) -> ChipTone {
        switch s {
        case "IN_PROGRESS", "REVISION": return .info
        case "FINAL": return .accent
        case "SIGNED", "DONE": return .success
        case "REJECTED": return .danger
        default: return .neutral
        }
    }
    static let columns = ["TODO", "IN_PROGRESS", "DONE"]
    static func column(_ c: String) -> String {
        switch c {
        case "TODO": return T("To Do")
        case "IN_PROGRESS": return T("In Progress")
        case "DONE": return T("Done")
        default: return c
        }
    }
}

struct LegalChip: View {
    let text: String
    let tone: ChipTone
    /// A glyph before the words (the web's ⊘ on "Rejected"; UI tour run 15, Q-IB23).
    var icon: String? = nil
    var body: some View {
        HStack(spacing: 4) {
            if let icon { Image(systemName: icon).font(.system(size: 10, weight: .bold)) }
            Text(text)
        }
        .font(NXFont.text(11, .bold))
        .padding(.horizontal, 8).padding(.vertical, 4)
        .foregroundStyle(tone.fg).background(tone.bg, in: Capsule())
    }
}

/// A downloaded file, for the share sheet.
struct LegalSharedFile: Identifiable { let url: URL; var id: String { url.path } }

// MARK: - The request form (requester)

struct LegalRequestFormView: View {
    let linkId: String
    @Environment(AppRouter.self) private var router

    private enum Phase { case loading, unknown, failed(String), ready(LegalRequestFormInfo) }
    @State private var phase: Phase = .loading
    @State private var companyId: String?
    @State private var templateId: String?
    @State private var values: [String: LegalValue] = [:]
    @State private var parentNumber = ""
    @State private var purpose = ""
    @State private var deadline: String?
    @State private var link: LegalLink?
    @State private var files: [URL] = []
    @State private var picking = false
    @State private var errors: [String: String] = [:]
    @State private var formError: String?
    @State private var sending = false
    @State private var sentId: String?
    @State private var attempt = UUID().uuidString
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                Image(NX.legalSymbol).font(.system(size: 20)).foregroundStyle(NX.mutedFg)
                    .frame(width: 44, height: 44).background(NX.muted, in: Circle())
                // The navigation bar already says "Legal request"; a second large heading repeated it (UI tour run 11).
                content
            }
            .padding(20)
            .frame(maxWidth: 720, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        // The sheet is shorter than the form on a Mac: Attachments and Send sat below its edge with nothing
        // saying the page went on (UI tour run 12, MC4). The indicator shows once on open, and Send stays
        // pinned under the scrolling fields.
        .scrollIndicatorsFlash(onAppear: true)
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if let info = formInfo {
                sendBar(info)
            }
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(T("Legal request"))
        .navigationBarTitleDisplayMode(.inline)
        .task { if case .loading = phase { await load() } }
        .sheet(isPresented: $picking) {
            DocumentPicker(types: LegalFileTypes.documents, multiple: true) { urls in
                files = Array((files + urls).prefix(5))
            }
            .ignoresSafeArea()
        }
        .interactiveDismissDisabled(sending)
    }

    @ViewBuilder private var content: some View {
        switch phase {
        case .loading:
            LegalLoadingRow()
        case .unknown:
            EmptyState(icon: "link.badge.plus", title: T("This link doesn't work any more"), subtitle: T("Ask Legal for the current link."))
        case .failed(let m):
            EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't open the form"), subtitle: m,
                       actionTitle: T("Try again"), actionIcon: "arrow.clockwise") { Task { await load() } }
        case .ready(let info):
            if !info.accepting {
                EmptyState(icon: "clock", title: T("This link isn't accepting requests right now"), subtitle: T("Ask Legal when it opens again, or for another link."))
            } else if let sentId {
                sent(sentId)
            } else {
                form(info)
            }
        }
    }

    private func subtitle(_ info: LegalRequestFormInfo) -> String {
        if let c = info.lockedCompany { return String(format: T("Ask Legal for a document of %@. Fill in what you know; Legal completes the rest."), c.name) }
        return T("Ask Legal for a document. Fill in what you know; Legal completes the rest.")
    }

    private func templates(_ info: LegalRequestFormInfo) -> [LegalRequestFormTemplate] {
        info.templates.filter { $0.companyId == nil || companyId == nil || $0.companyId == companyId }
    }

    @ViewBuilder private func form(_ info: LegalRequestFormInfo) -> some View {
        let list = templates(info)
        let template = list.first { $0.id == templateId }
        Text(subtitle(info)).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
        // Company and Document type side by side on iPad / Mac, as the web's two columns (UI tour run 16, R16-B-21).
        let pair = hSize == .regular ? AnyLayout(HStackLayout(alignment: .top, spacing: 12))
                                     : AnyLayout(VStackLayout(alignment: .leading, spacing: 14))
        NXCard(padding: 16) {
            pair {
                LegalFormRow(label: T("Company"), required: info.lockedCompany == nil, error: errors["companyId"]) {
                    if let locked = info.lockedCompany {
                        Text(locked.name).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                            .frame(maxWidth: .infinity, alignment: .leading).legalInput()
                    } else {
                        LegalMenuPicker(options: info.companies.map { ($0.id, $0.name) },
                                        selection: Binding(get: { companyId }, set: { companyId = $0; templateId = nil; values = [:] }),
                                        placeholder: T("Pick a company"))
                    }
                }
                LegalFormRow(label: T("Document type"), required: true, error: errors["templateId"]) {
                    if companyId == nil {
                        Text(T("Pick the company first")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                            .frame(maxWidth: .infinity, alignment: .leading).legalInput()
                    } else if list.isEmpty {
                        Text(T("Legal has no document types for this company yet.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    } else {
                        LegalMenuPicker(options: list.map { ($0.id, "\($0.name) · \(LegalLabels.docType($0.docType))") },
                                        selection: Binding(get: { templateId }, set: { templateId = $0; values = [:]; errors = [:] }),
                                        placeholder: T("Pick a document type"))
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        if let template {
            if !template.description.isEmpty {
                Text(template.description).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
            if template.isAddendum {
                NXCard(padding: 16) {
                    LegalFormRow(label: T("Number of the document to amend"), required: true,
                                 hint: T("Type it as printed on the signed document. Legal checks it and finds the document."),
                                 error: errors["parentNumber"]) {
                        TextField(T("As printed on the signed document"), text: $parentNumber)
                            .font(NXFont.text(14)).autocorrectionDisabled().textInputAutocapitalization(.characters).legalInput()
                    }
                }
            }
            if !template.fields.isEmpty {
                NXCard(padding: 16) {
                    VStack(alignment: .leading, spacing: 16) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(T("Details for the document")).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                            Text(T("All optional. Fill in what you know; Legal completes the rest.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                        ForEach(template.fields) { f in
                            LegalFieldInput(field: f, value: values[f.name], errors: errors, path: f.name, hideName: true) { v in
                                values[f.name] = v
                                errors[f.name] = nil
                            }
                        }
                    }
                }
            }
        }
        NXCard(padding: 16) {
            VStack(alignment: .leading, spacing: 14) {
                // The hint inside the empty box, as the web's placeholder (UI tour run 16, R16-B-21: an empty box
                // with the hint under it).
                LegalFormRow(label: T("Purpose and notes")) {
                    TextField(T("What the document is for, who it is with, anything Legal should know"), text: $purpose, axis: .vertical)
                        .lineLimit(4...10)
                        .font(NXFont.text(14))
                        .legalInput()
                }
                // A "Pick a date" field as on the web, cleared with ×, instead of a "No deadline" switch (R16-B-21).
                LegalFormRow(label: T("Needed by"), error: errors["deadline"]) {
                    if deadline == nil {
                        Button { deadline = LegalText.todayJakarta() } label: {
                            HStack(spacing: 8) {
                                Image(systemName: "calendar").foregroundStyle(NX.mutedFg)
                                Text(T("Pick a date")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                                Spacer(minLength: 0)
                            }
                            .legalInput()
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                    } else {
                        HStack(spacing: 8) {
                            DatePicker(T("Needed by"), selection: Binding(get: { LegalText.date(fromDay: deadline ?? "") ?? Date() },
                                                                         set: { deadline = LegalText.dayString($0) }),
                                       displayedComponents: .date)
                                .labelsHidden()
                                .environment(\.locale, AppDateLocale.current)
                                .environment(\.timeZone, LegalText.jakarta)
                            Spacer(minLength: 0)
                            Button { deadline = nil } label: {
                                Image(systemName: "xmark.circle.fill").foregroundStyle(NX.mutedFg).frame(width: 44, height: 44)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(T("Clear"))
                        }
                    }
                }
                LegalFormRow(label: T("Related project or deal")) {
                    LegalLinkButton(value: link, placeholder: T("None"), ownAccess: true) { link = $0 }
                }
                LegalFormRow(label: T("Attachments"), hint: String(format: T("PDF, Word or photos (JPG, PNG). Up to %d files, 50 MB each."), 5)) {
                    VStack(alignment: .leading, spacing: 6) {
                        ForEach(Array(files.enumerated()), id: \.offset) { i, f in
                            HStack(spacing: 8) {
                                Image(systemName: "paperclip").foregroundStyle(NX.mutedFg)
                                Text(f.lastPathComponent).font(NXFont.text(13)).foregroundStyle(NX.foreground).lineLimit(1)
                                Spacer(minLength: 4)
                                Button { files.remove(at: i) } label: { Image(systemName: "xmark").foregroundStyle(NX.mutedFg) }
                                    .buttonStyle(.plain).accessibilityLabel(String(format: T("Remove %@"), f.lastPathComponent))
                            }
                            .legalInput()
                        }
                        if files.count < 5 {
                            Button { picking = true } label: { Label(T("Attach files"), systemImage: "paperclip") }
                                .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
                        }
                    }
                }
            }
        }
    }

    /// The form on screen (ready, accepting, not sent yet): the pinned Send bar shows only then.
    private var formInfo: LegalRequestFormInfo? {
        guard case .ready(let info) = phase, info.accepting, sentId == nil else { return nil }
        return info
    }

    /// Send, pinned under the fields with the form's error above it.
    private func sendBar(_ info: LegalRequestFormInfo) -> some View {
        let template = templates(info).first { $0.id == templateId }
        return VStack(alignment: .leading, spacing: 8) {
            if let formError {
                Text(formError).font(NXFont.text(13)).foregroundStyle(NX.danger)
            }
            let missing = templateId == nil || companyId == nil
                || (template?.isAddendum == true && parentNumber.trimmingCharacters(in: .whitespaces).isEmpty)
            Button { Task { await send() } } label: {
                HStack(spacing: 6) {
                    if sending { ProgressView().tint(NX.background) }
                    Text(T("Send request"))
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.nxPrimary)
            .disabled(sending || missing)
            // Why Send is greyed out (UI tour run 13, F-30 / W-B23).
            if missing && !sending {
                Text(T("Fill in the required fields (*) to send")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 20).padding(.vertical, 12)
        .frame(maxWidth: 720)
        .frame(maxWidth: .infinity)
        .background(NX.background)
        .overlay(alignment: .top) { Rectangle().fill(NX.border).frame(height: 1) }
        // The fields fade into the bar, so a line passing under it ("PDF, Word or photos…") reads as "more
        // below" rather than hidden (UI tour run 16, R16-M-12).
        .background(alignment: .top) {
            LinearGradient(colors: [NX.background.opacity(0), NX.background], startPoint: .top, endPoint: .bottom)
                .frame(height: 24)
                .offset(y: -24)
                .allowsHitTesting(false)
        }
    }

    private func sent(_ id: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 40)).foregroundStyle(ChipTone.success.fg)
            Text(T("Request sent")).font(NXFont.text(18, .semibold)).foregroundStyle(NX.foreground)
            Text(T("Legal has it now. Follow it in My Submissions: you'll get a notification when it moves, and you can download the final document there."))
                .font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            HStack(spacing: 10) {
                Button(T("Open My Submissions")) {
                    router.formRequest = nil
                    router.open(.legalRequest(id))
                }
                .buttonStyle(.nxPrimary)
                Button(T("Send another request")) { reset() }.buttonStyle(.nxBordered)
            }
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    private func reset() {
        attempt = UUID().uuidString
        templateId = nil; values = [:]; parentNumber = ""; purpose = ""; deadline = nil; link = nil; files = []
        errors = [:]; formError = nil; sentId = nil
        if case .ready(let info) = phase, info.lockedCompany == nil { companyId = info.companies.count == 1 ? info.companies[0].id : nil }
    }

    private func load() async {
        phase = .loading
        do {
            let info = try await APIClient.shared.legalRequestForm(linkId: linkId)
            companyId = info.lockedCompany?.id ?? (info.companies.count == 1 ? info.companies[0].id : nil)
            phase = .ready(info)
        } catch let e as LegalAPIError where e.status == 404 {
            phase = .unknown
        } catch {
            phase = .failed(error.legalMessage)
        }
    }

    private func send() async {
        guard !sending, let templateId, let companyId else { return }
        sending = true
        defer { sending = false }
        formError = nil
        var input: [String: Any] = [
            "templateId": templateId, "companyId": companyId, "values": LegalValue.json(values),
            "purpose": purpose.trimmingCharacters(in: .whitespacesAndNewlines),
        ]
        input["deadline"] = deadline ?? NSNull()
        input["projectId"] = link?.projectId ?? NSNull()
        input["dealId"] = link?.dealId ?? NSNull()
        if case .ready(let info) = phase, info.templates.first(where: { $0.id == templateId })?.isAddendum == true {
            input["parentNumber"] = parentNumber.trimmingCharacters(in: .whitespacesAndNewlines)
        }
        do {
            let res = try await APIClient.shared.legalSendRequest(linkId: linkId, input: input, files: files, key: attempt)
            sentId = res.id
        } catch {
            errors = error.legalFieldErrors
            formError = errors.isEmpty ? error.legalMessage : T("Some fields need attention")
        }
    }
}

// MARK: - My requests (requester)

/// My Legal requests above the form submissions board.
struct MyLegalRequestsStrip: View {
    let requests: [MyLegalRequest]
    let gutter: CGFloat
    let onOpen: (String) -> Void
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(NX.legalSymbol).font(.system(size: 12)).foregroundStyle(NX.mutedFg)
                Text(T("Legal requests")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text("\(requests.count)").font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
            }
            .padding(.horizontal, gutter)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 10) {
                    ForEach(requests) { r in
                        Button { onOpen(r.id) } label: { card(r) }.buttonStyle(.plain).hoverEffect(.highlight)
                    }
                }
                .padding(.horizontal, gutter)
            }
        }
    }

    private func card(_ r: MyLegalRequest) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .top) {
                // Never break inside "(SP I/II/III)" (UI tour run 11, MC-15).
                Text(nxUnbreakableParentheses(r.templateName.isEmpty ? LegalLabels.docType(r.docType) : r.templateName))
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                LegalChip(text: LegalRequestLabels.stage(r.stage), tone: LegalRequestLabels.stageTone(r.stage))
            }
            LegalAmendsLine(company: r.company?.name, amends: r.isAddendum && !r.parentNumberText.isEmpty ? r.parentNumberText : nil)
                // Wrapped, not cut: "PATS · Amends PATS/PKS-…" hid the number (UI tour run 15, Q-IB23); the number
                // itself never breaks at its "/" or "-" (UI tour run 16, R16-I-19), and shrinks a little if alone
                // on a line it cannot fill.
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
            // When it was sent, then the deadline and the number, as the web card's meta line (UI tour
            // run 12, IP3: the app left "Sent 14 Oct" out).
            FlowLayout(spacing: 10) {
                if let at = r.createdAt {
                    Text(String(format: T("Sent %@"), LegalLabels.date(at))).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                if let deadline = r.deadline {
                    Label(LegalLabels.day(deadline), systemImage: "calendar").font(NXFont.text(11, overdue(r) ? .semibold : .regular))
                        .foregroundStyle(overdue(r) ? NX.danger : NX.mutedFg)
                }
                if let doc = r.document { Text(doc.number).font(.system(size: 11, design: .monospaced)).foregroundStyle(NX.mutedFg).lineLimit(1) }
            }
            .padding(.top, 2)
            if r.stage == "REJECTED", let reason = r.rejectReason, !reason.isEmpty {
                Text(reason).font(NXFont.text(12)).foregroundStyle(NX.danger).lineLimit(2)
            }
            if r.canDownload {
                Label(r.stage == "SIGNED" ? T("Download signed copy") : T("Download final document"), systemImage: "tray.and.arrow.down")
                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
        // A lone request takes the phone's width (run 14, N-16: half the width, the rest empty); several
        // keep a card width that shows the next one peeking in. iPad / Mac: the web's 360 pt card.
        .containerRelativeFrame(.horizontal, alignment: .leading) { w, _ in
            let inner = w - 2 * gutter
            if hSize == .regular { return min(360, inner) }
            return requests.count == 1 ? inner : min(300, inner * 0.85)
        }
        .contentShape(Rectangle())
    }

    private func overdue(_ r: MyLegalRequest) -> Bool {
        guard let d = r.deadline, !["SIGNED", "DONE", "REJECTED"].contains(r.stage) else { return false }
        return d < LegalRequestDay.today()
    }
}

/// One of my Legal requests: my answers, its stage, Legal's reason when declined, and the file once final.
struct MyLegalRequestSheet: View {
    let requestId: String
    /// false inside a sheet that already brings its NavigationStack and Close (RootView's notification sheet).
    var standalone = true
    @Environment(\.dismiss) private var dismiss
    @State private var request: MyLegalRequest?
    @State private var failure: String?
    @State private var notFound = false
    @State private var downloading = false
    @State private var shared: LegalSharedFile?

    var body: some View {
        if standalone {
            NavigationStack {
                inner.toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
            }
        } else {
            inner
        }
    }

    private var inner: some View {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if let r = request { detail(r) }
                    else if notFound {
                        EmptyState(icon: "questionmark.folder", title: T("This request no longer exists, or the link is wrong."))
                    } else if let failure {
                        EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't load the details."), subtitle: failure,
                                   actionTitle: T("Try again"), actionIcon: "arrow.clockwise") { Task { await load() } }
                    } else { LegalLoadingRow() }
                }
                .padding(20)
                .frame(maxWidth: 720, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle(request?.templateName ?? T("Legal request"))
            .navigationBarTitleDisplayMode(.inline)
            .task { await load() }
            .liveRefresh(every: 60, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.submissions]) { await load() }
            .sheet(item: $shared) { f in ActivityView(items: [f.url]) }
    }

    @ViewBuilder private func detail(_ r: MyLegalRequest) -> some View {
        HStack(spacing: 8) {
            LegalChip(text: LegalRequestLabels.stage(r.stage), tone: LegalRequestLabels.stageTone(r.stage))
            Text("\(LegalLabels.docType(r.docType)) · \(r.company?.name ?? "")").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
        if let at = r.createdAt { Text(String(format: T("Sent %@"), LegalLabels.date(at))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
        if r.stage == "REJECTED" {
            VStack(alignment: .leading, spacing: 4) {
                Text(T("Legal declined this request")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text(r.rejectReason ?? "—").font(NXFont.text(14)).foregroundStyle(NX.foreground)
            }
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(ChipTone.danger.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        if let doc = r.document {
            NXCard(padding: 14) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(doc.title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    Text("\(doc.number) · \(LegalLabels.status(doc.status))").font(.system(size: 12, design: .monospaced)).foregroundStyle(NX.mutedFg)
                    if r.canDownload {
                        Button { Task { await download(r) } } label: {
                            HStack(spacing: 6) {
                                if downloading { ProgressView() }
                                Label(T("Download"), systemImage: "tray.and.arrow.down")
                            }
                        }
                        .buttonStyle(.nxPrimary).disabled(downloading)
                    } else {
                        Text(T("You can download it once it is final.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    }
                }
            }
        }
        NXCard(padding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                row(T("Needed by"), LegalLabels.day(r.deadline))
                row(T("Handled by"), r.pic?.name ?? T("Not assigned yet"))
                row(T("Related to"), r.deal.map { "\($0.code) · \($0.name)" } ?? r.project?.name ?? "—")
                if r.isAddendum { row(T("Number of the document to amend"), r.parentNumberText.isEmpty ? "—" : r.parentNumberText) }
                if !r.purpose.isEmpty { row(T("Purpose and notes"), r.purpose) }
            }
        }
        Text(T("Your answers")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
        if r.answers.isEmpty {
            Text(T("You left the details to Legal.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
        } else {
            NXCard(padding: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(r.answers) { a in row(a.label, LegalRequestText.answer(a.value, type: a.type, columns: a.columns)) }
                }
            }
        }
        if !r.attachments.isEmpty {
            Text(T("Attachments")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
            ForEach(r.attachments) { a in
                Button { Task { await open(r, a) } } label: {
                    HStack { Image(systemName: "paperclip"); Text(a.fileName).lineLimit(1); Spacer(); Text(LegalLabels.bytes(a.size)).foregroundStyle(NX.mutedFg) }
                        .font(NXFont.text(13)).foregroundStyle(NX.foreground).legalInput()
                }
                .buttonStyle(.plain)
            }
        }
    }

    private func row(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            Text(value).font(NXFont.text(14)).foregroundStyle(NX.foreground).textSelection(.enabled)
        }
    }

    private func load() async {
        do { request = try await APIClient.shared.myLegalRequest(id: requestId); failure = nil }
        catch let e as LegalAPIError where e.status == 404 { notFound = true }
        catch { if request == nil { failure = error.legalMessage } }
    }

    private func download(_ r: MyLegalRequest) async {
        downloading = true
        defer { downloading = false }
        do { shared = LegalSharedFile(url: try await APIClient.shared.myLegalRequestFile(id: r.id)) }
        catch { failure = error.legalMessage }
    }

    private func open(_ r: MyLegalRequest, _ a: LegalRequestAttachment) async {
        do { shared = LegalSharedFile(url: try await APIClient.shared.myLegalRequestAttachment(id: r.id, attachment: a)) }
        catch { failure = error.legalMessage }
    }
}

enum LegalRequestText {
    /// A typed answer as one block of text (a table: one line per row).
    static func answer(_ v: LegalJSON, type: String, columns: [LegalField]) -> String {
        switch v {
        case .array(let rows):
            return rows.map { row -> String in
                guard case .object(let o) = row else { return "" }
                return columns.map { c in "\(c.label): \(o[c.name]?.text ?? "—")" }.joined(separator: "\n")
            }.joined(separator: "\n\n")
        case .bool(let b): return b ? T("Yes") : "—"
        case .null: return "—"
        default:
            let t = v.text ?? "—"
            return type == "date" ? LegalLabels.day(t) : t
        }
    }
}

// MARK: - The board (Legal)

struct LegalRequestsPane: View {
    let gutter: CGFloat
    let wide: Bool
    /// A request a notification pointed at: opened once, then cleared.
    @Binding var focus: String?

    private enum Mode: String, Hashable { case board, list }
    private enum Sheet: String, Identifiable { case links; var id: String { rawValue } }

    @State private var mode: Mode = .board
    @State private var phoneColumn = "TODO"
    @State private var text = ""
    @State private var query = LegalBoardQuery()
    @State private var rows: [LegalBoardRequest]?
    @State private var error: String?
    @State private var companies: [LegalCompany] = []
    @State private var members: [LegalMember] = []
    @State private var sheet: Sheet?
    @State private var open: LegalOpenID?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                toolbar
                filters
                content
            }
            .padding(.horizontal, gutter)
            .padding(.vertical, 16)
        }
        .refreshable { await load() }
        .task(id: text) {
            if !text.isEmpty { try? await Task.sleep(nanoseconds: 300_000_000) }
            guard !Task.isCancelled else { return }
            let q = text.trimmingCharacters(in: .whitespacesAndNewlines)
            if q != query.q { query.q = q }
        }
        .task(id: query) { await load() }
        .task {
            companies = (try? await APIClient.shared.legalCompanies()) ?? companies
            members = ((try? await APIClient.shared.legalMembers())?.members ?? []).filter(\.active)
        }
        .task(id: focus) { if let f = focus { open = LegalOpenID(id: f); focus = nil } }
        .liveRefresh(every: 60, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.legal]) { await load() }
        .sheet(item: $sheet) { _ in LegalRequestLinksSheet() }
        .navigationDestination(item: $open) { o in LegalRequestDetailView(requestId: o.id, members: members) }
        .onChange(of: open) { _, now in if now == nil { Task { await load() } } }
    }

    private var toolbar: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 8) { search; modePicker; linksButton }
            VStack(alignment: .leading, spacing: 8) { search; HStack(spacing: 8) { modePicker; linksButton; Spacer(minLength: 0) } }
        }
    }

    private var search: some View {
        HStack(spacing: 6) {
            Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
            TextField(T("Search requester, type, notes…"), text: $text).font(NXFont.text(14)).textFieldStyle(.plain).autocorrectionDisabled()
        }
        .legalInput().frame(minWidth: 220)
    }

    private var modePicker: some View {
        Picker(T("View"), selection: $mode) {
            Text(T("Board")).tag(Mode.board)
            Text(T("List")).tag(Mode.list)
        }
        .pickerStyle(.segmented).frame(maxWidth: 200)
    }

    private var linksButton: some View {
        Button { sheet = .links } label: { Label(T("Request links"), systemImage: "link") }.buttonStyle(.nxBordered)
    }

    // The filters wrap onto a second line instead of scrolling under an edge fade: every pill stays
    // whole and visible ("Any deadlin…", "Signed…", the project filter off-screen; run 14 N-25 / N-26 /
    // P-I20).
    private var filters: some View {
        FlowLayout(spacing: 8) {
            let types = Array(Set((rows ?? []).map(\.docType))).sorted()
            LegalMenuPicker(options: types.map { ($0, LegalLabels.docType($0)) }, selection: $query.docType, noneLabel: T("All types"), compact: true)
            LegalMenuPicker(options: companies.map { ($0.id, $0.name) }, selection: $query.companyId, noneLabel: T("All companies"), compact: true)
            LegalMenuPicker(options: [("none", T("No PIC yet"))] + members.map { ($0.userId, $0.name) }, selection: $query.picId, noneLabel: T("Any PIC"), compact: true)
            LegalMenuPicker(options: [("overdue", T("Overdue")), ("week", T("Due within a week")), ("none", T("No deadline"))],
                            selection: $query.deadline, noneLabel: T("Any deadline"), compact: true)
            if query.filtered {
                Button { let q = query.q; query = LegalBoardQuery(); query.q = q } label: { Label(T("Clear filters"), systemImage: "xmark") }
                    .buttonStyle(NXButtonStyle(kind: .ghost, compact: true))
            }
        }
        .padding(.vertical, 1)
    }

    @ViewBuilder private var content: some View {
        if rows == nil, let error {
            Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger)
        } else if rows == nil {
            LegalLoadingRow()
        } else if let rows, rows.isEmpty {
            let searching = !query.q.isEmpty || query.filtered
            EmptyState(icon: "tray", title: searching ? T("Nothing matches") : T("No requests yet"),
                       subtitle: searching ? T("Try other words or fewer filters.") : T("People ask Legal for a document through a request link. Share one from Request links; their requests land here."),
                       actionTitle: searching ? nil : T("Request links"), actionIcon: "link") { if !searching { sheet = .links } }
                .frame(maxWidth: .infinity).padding(.vertical, 24)
        } else if let rows {
            if mode == .list { list(rows) } else if wide { wideBoard(rows) } else { phoneBoard(rows) }
        }
    }

    private func wideBoard(_ rows: [LegalBoardRequest]) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ForEach(LegalRequestLabels.columns, id: \.self) { col in
                let items = rows.filter { $0.column == col }
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Text(LegalRequestLabels.column(col)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                        Text("\(items.count)").font(NXFont.text(12)).foregroundStyle(NX.mutedFg).monospacedDigit()
                    }
                    ForEach(items) { r in cardButton(r).draggable(r.id) }
                    if items.isEmpty {
                        Text(T("Drag a request here, or let it move by itself as its document goes."))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity).padding(.vertical, 18)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .dropDestination(for: String.self) { ids, _ in
                    guard let id = ids.first, rows.first(where: { $0.id == id })?.column != col else { return false }
                    Task { await move(id, to: col) }
                    return true
                }
            }
        }
    }

    private func phoneBoard(_ rows: [LegalBoardRequest]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Picker(T("Column"), selection: $phoneColumn) {
                ForEach(LegalRequestLabels.columns, id: \.self) { c in
                    Text("\(LegalRequestLabels.column(c)) \(rows.filter { $0.column == c }.count)").tag(c)
                }
            }
            .pickerStyle(.segmented)
            let items = rows.filter { $0.column == phoneColumn }
            if items.isEmpty {
                Text(T("Drag a request here, or let it move by itself as its document goes."))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity).padding(.vertical, 18)
            }
            ForEach(items) { r in cardButton(r) }
        }
    }

    private func list(_ rows: [LegalBoardRequest]) -> some View {
        LegalListCard {
            ForEach(Array(rows.enumerated()), id: \.element.id) { i, r in
                if i > 0 { Divider().overlay(NX.border) }
                Button { open = LegalOpenID(id: r.id) } label: {
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Text(r.templateName.isEmpty ? LegalLabels.docType(r.docType) : r.templateName).font(NXFont.text(14, .medium)).foregroundStyle(NX.foreground).lineLimit(1)
                            Spacer(minLength: 4)
                            if r.rejected { LegalChip(text: T("Rejected"), tone: .danger, icon: "nosign") } else { Text(LegalRequestLabels.column(r.column)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                        }
                        Text([r.requester?.name, r.company?.name, r.pic.map { "PIC · \($0.name)" }].compactMap { $0 }.joined(separator: " · "))
                            .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        HStack(spacing: 8) {
                            if let d = r.deadline { Label(LegalLabels.day(d), systemImage: "calendar").foregroundStyle(r.overdue ? NX.danger : NX.mutedFg) }
                            if let doc = r.document { Text(doc.number).font(.system(size: 11, design: .monospaced)).foregroundStyle(NX.mutedFg); LegalStatusChip(status: doc.status) }
                        }
                        .font(NXFont.text(11))
                    }
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .contextMenu { moveMenu(r) }
            }
        }
    }

    private func cardButton(_ r: LegalBoardRequest) -> some View {
        Button { open = LegalOpenID(id: r.id) } label: { LegalRequestCard(r: r) }
            .buttonStyle(.plain)
            .hoverEffect(.highlight)
            .contextMenu { moveMenu(r) }
    }

    @ViewBuilder private func moveMenu(_ r: LegalBoardRequest) -> some View {
        ForEach(LegalRequestLabels.columns.filter { $0 != r.column }, id: \.self) { c in
            Button { Task { await move(r.id, to: c) } } label: {
                Label(String(format: T("Move to %@"), LegalRequestLabels.column(c)), systemImage: "arrow.right")
            }
        }
    }

    private func move(_ id: String, to column: String) async {
        if let i = rows?.firstIndex(where: { $0.id == id }) {
            // Shown at once; the reload below brings the server's word.
            var copy = rows!
            let moved = copy.remove(at: i)
            rows = copy
            _ = moved
        }
        do { _ = try await APIClient.shared.legalUpdateRequest(id: id, fields: ["column": column]) }
        catch { LegalToasts.shared.failure(error) }
        await load()
    }

    private func load() async {
        do { rows = try await APIClient.shared.legalBoard(query); error = nil }
        catch {
            if (error as? URLError)?.code == .cancelled || error is CancellationError { return }
            self.error = error.legalMessage
            if rows != nil { LegalToasts.shared.failure(error) }
        }
    }
}

struct LegalRequestCard: View {
    let r: LegalBoardRequest
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .top) {
                Text(nxUnbreakableParentheses(r.templateName.isEmpty ? LegalLabels.docType(r.docType) : r.templateName))
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(2).multilineTextAlignment(.leading)
                Spacer(minLength: 4)
                if r.rejected { LegalChip(text: T("Rejected"), tone: .danger, icon: "nosign") }
            }
            LegalAmendsLine(company: r.company?.name, amends: r.isAddendum && !r.parentNumberText.isEmpty ? r.parentNumberText : nil)
                // Wrapped, not cut: "PATS · Amends PATS/PKS-…" hid the number (UI tour run 15, Q-IB23); the number
                // itself never breaks at its "/" or "-" (UI tour run 16, R16-I-19), and shrinks a little if alone
                // on a line it cannot fill.
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                .minimumScaleFactor(0.85)
                .fixedSize(horizontal: false, vertical: true)
            // A narrow board column (iPad portrait) cut "PIC · Q…" and "Sig…" and wrapped the date (UI tour
            // run 10, IPD-3): the date and the count keep their width, the PIC has its own line, and the
            // document's number truncates in the middle beside a status chip that is never squeezed.
            // The requester on a line of their own (I-22: "QA D…" beside the date), then when it was sent and
            // when it is needed (F-31: the card had no date).
            Text(r.requester?.name ?? "—").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            HStack(spacing: 8) {
                if r.createdAt != nil {
                    Text(String(format: T("Sent %@"), LegalLabels.date(r.createdAt))).lineLimit(1).fixedSize()
                }
                if let d = r.deadline {
                    Label(LegalLabels.day(d), systemImage: "calendar").lineLimit(1).fixedSize()
                        .foregroundStyle(r.overdue ? NX.danger : NX.mutedFg).fontWeight(r.overdue ? .semibold : .regular)
                }
                if !r.attachments.isEmpty { Label("\(r.attachments.count)", systemImage: "paperclip").fixedSize() }
            }
            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            Text(r.pic.map { "PIC · \($0.name)" } ?? T("No PIC yet")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
            if let doc = r.document {
                // The status first, then the whole number on a line of its own: beside the chip a narrow
                // column cut it to "0…1" / "001/SP-…/X/2026" (run 14, P-I5 / P-M15).
                // A live request whose earlier number was voided: say so, not a struck "Void" chip
                // that reads as a broken request (M-21 / W-D23).
                if doc.status == "VOID" {
                    Text(T("Previous number voided")).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                } else {
                    LegalStatusChip(status: doc.status)
                }
                Text(doc.number).font(.system(size: 10, design: .monospaced)).foregroundStyle(NX.mutedFg)
                    .lineLimit(1).minimumScaleFactor(0.6)
                    .help(doc.number)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
        .contentShape(Rectangle())
    }
}

/// One request on the board: the requester's answers and files, and what Legal does with it.
struct LegalRequestDetailView: View {
    let requestId: String
    let members: [LegalMember]

    private enum Sheet: Identifiable {
        case create, parent, share(URL)
        var id: String {
            switch self {
            case .create: return "create"
            case .parent: return "parent"
            case .share(let u): return "share-\(u.path)"
            }
        }
    }

    @State private var detail: LegalBoardDetail?
    @State private var error: String?
    @State private var sheet: Sheet?
    @State private var rejecting = false
    @State private var reason = ""
    @State private var openDoc: LegalOpenID?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let r = detail?.request { content(r) }
                else if let error { Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger) }
                else { LegalLoadingRow() }
            }
            .padding(20)
            .frame(maxWidth: 760, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(detail?.request.templateName ?? T("Legal request"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .liveRefresh(every: 60, on: [.nexusWorkspaceChanged], kinds: [RealtimeKind.legal]) { await load() }
        .sheet(item: $sheet) { s in
            switch s {
            case .create:
                if let d = detail { createSheet(d) }
            case .parent:
                LegalSignedDocumentPicker(initialQuery: detail?.request.parentNumberText ?? "") { picked in
                    Task { await update(["parentDocumentId": picked]) }
                }
            case .share(let url):
                ActivityView(items: [url])
            }
        }
        .navigationDestination(item: $openDoc) { o in LegalDocumentView(documentId: o.id) }
        .alert(T("Reject this request?"), isPresented: $rejecting) {
            TextField(T("Reason"), text: $reason)
            Button(T("Cancel"), role: .cancel) { reason = "" }
            Button(T("Reject"), role: .destructive) { Task { await reject() } }
                .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).count < 3)
        } message: {
            Text(T("The requester sees your reason in My Submissions and gets a notification. The request moves to Done as Rejected."))
        }
        .legalToasts()
    }

    @ViewBuilder private func content(_ r: LegalBoardRequest) -> some View {
        Text(String(format: T("%@ asked on %@"), r.requester?.name ?? "—", LegalLabels.date(r.createdAt)) + " · " + (r.company?.name ?? ""))
            .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
        HStack(spacing: 8) {
            if r.rejected { LegalChip(text: T("Rejected"), tone: .danger, icon: "nosign") } else { LegalChip(text: LegalRequestLabels.column(r.column), tone: .neutral) }
            LegalChip(text: LegalRequestLabels.stage(r.stage), tone: LegalRequestLabels.stageTone(r.stage))
            if let doc = r.document {
                Button { openDoc = LegalOpenID(id: doc.id) } label: {
                    HStack(spacing: 4) { Text(doc.number).font(.system(size: 11, design: .monospaced)); LegalStatusChip(status: doc.status) }
                }
                .buttonStyle(.plain)
            }
        }
        if r.rejected {
            VStack(alignment: .leading, spacing: 4) {
                Text(T("Declined")).font(NXFont.text(14, .semibold))
                Text(r.rejectReason).font(NXFont.text(14))
                Text(T("Move it to To Do or In Progress to reopen it.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            .foregroundStyle(NX.foreground)
            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
            .background(ChipTone.danger.bg, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        NXCard(padding: 14) {
            VStack(alignment: .leading, spacing: 12) {
                LegalFormRow(label: T("Column")) {
                    LegalMenuPicker(options: LegalRequestLabels.columns.map { ($0, LegalRequestLabels.column($0)) },
                                    selection: Binding(get: { r.column }, set: { v in if let v { Task { await update(["column": v]) } } }))
                }
                LegalFormRow(label: "PIC") {
                    LegalMenuPicker(options: members.map { ($0.userId, $0.name) },
                                    selection: Binding(get: { r.pic?.id }, set: { v in Task { await update(["picId": v ?? NSNull()]) } }),
                                    noneLabel: T("No PIC yet"))
                }
            }
        }
        if r.isAddendum {
            NXCard(padding: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    LegalFormRow(label: T("Parent number as typed")) {
                        Text(r.parentNumberText.isEmpty ? "—" : r.parentNumberText).font(.system(size: 14, design: .monospaced)).textSelection(.enabled)
                    }
                    LegalFormRow(label: T("Parent document (signed)"), hint: T("Find the signed document the requester means. The addendum is numbered after it.")) {
                        Button { sheet = .parent } label: {
                            HStack {
                                Image(systemName: "doc.text").foregroundStyle(NX.mutedFg)
                                Text(parentLabel(r) ?? T("Pick the signed document")).font(NXFont.text(14))
                                    .foregroundStyle(parentLabel(r) == nil ? NX.mutedFg : NX.foreground).lineLimit(1)
                                Spacer(minLength: 0)
                            }
                            .legalInput().contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(docLive(r))
                    }
                }
            }
        }
        actions(r)
        NXCard(padding: 14) {
            VStack(alignment: .leading, spacing: 10) {
                info(T("Needed by"), LegalLabels.day(r.deadline), danger: r.overdue)
                info(T("Related to"), r.linkHidden ? T("A project you can't open") : r.deal.map { "\($0.code) · \($0.name)" } ?? r.project?.name ?? "—")
                if !r.purpose.isEmpty { info(T("Purpose and notes"), r.purpose) }
            }
        }
        Text(T("What the requester filled in")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
        let answered = r.fields.filter { f in
            guard let v = r.fieldValues[f.name] else { return false }
            switch v {
            case .null: return false
            case .string(let s): return !s.isEmpty
            case .array(let a): return !a.isEmpty
            default: return true
            }
        }
        if answered.isEmpty {
            Text(T("Nothing: they left the details to Legal.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
        } else {
            NXCard(padding: 14) {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(answered) { f in info(f.label, LegalRequestText.answer(r.fieldValues[f.name] ?? .null, type: f.type, columns: f.columns ?? [])) }
                }
            }
        }
        if !r.attachments.isEmpty {
            Text(T("Attachments")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
            ForEach(r.attachments) { a in
                Button { Task { await openAttachment(r, a) } } label: {
                    HStack { Image(systemName: "paperclip"); Text(a.fileName).lineLimit(1); Spacer(); Text(LegalLabels.bytes(a.size)).foregroundStyle(NX.mutedFg) }
                        .font(NXFont.text(13)).foregroundStyle(NX.foreground).legalInput()
                }
                .buttonStyle(.plain)
            }
        }
    }

    @ViewBuilder private func actions(_ r: LegalBoardRequest) -> some View {
        let parentMissing = r.isAddendum && parentLabel(r) == nil
        HStack(spacing: 10) {
            if !docLive(r) {
                Button { sheet = .create } label: { Label(T("Create document"), systemImage: "doc.badge.plus") }
                    .buttonStyle(.nxPrimary)
                    .disabled(r.rejected || parentMissing || busy)
            } else if let doc = r.document {
                Button { openDoc = LegalOpenID(id: doc.id) } label: { Label(T("Open document"), systemImage: "doc.text") }
                    .buttonStyle(.nxBordered)
            }
            if !r.rejected && r.document?.status != "SIGNED" {
                Button { reason = ""; rejecting = true } label: { Label(T("Reject"), systemImage: "nosign") }
                    .buttonStyle(NXButtonStyle(kind: .destructive))
            }
        }
        if parentMissing && !docLive(r) && !r.rejected {
            Text(T("Pick the parent document first.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
        }
    }

    @ViewBuilder private func createSheet(_ d: LegalBoardDetail) -> some View {
        let r = d.request
        let parent: LegalNewDocumentSheet.Parent? = r.isAddendum ? r.parent.flatMap { p in p.number.map { .init(id: p.id, number: $0, title: p.title ?? "") } } : nil
        let link: LegalLink? = d.prefill?.dealId != nil ? r.deal.map { .deal(id: $0.id, label: "\($0.code) · \($0.name)") }
            : d.prefill?.projectId != nil ? r.project.map { .project(id: $0.id, label: $0.name) } : nil
        LegalNewDocumentSheet(
            parent: parent,
            fromRequest: .init(requestId: r.id, templateId: d.prefill?.templateId ?? r.templateId, companyId: d.prefill?.companyId ?? r.company?.id ?? "",
                               values: LegalJSON.values(d.prefill?.values ?? r.fieldValues), link: link)
        ) { id in
            Task { await load() }
            openDoc = LegalOpenID(id: id)
        }
    }

    private func parentLabel(_ r: LegalBoardRequest) -> String? {
        guard let p = r.parent, let n = p.number else { return nil }
        return "\(n) · \(p.title ?? "")"
    }
    private func docLive(_ r: LegalBoardRequest) -> Bool { r.document != nil && r.document?.status != "VOID" }

    private func info(_ label: String, _ value: String, danger: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            Text(value).font(NXFont.text(14)).foregroundStyle(danger ? NX.danger : NX.foreground).textSelection(.enabled)
        }
    }

    private func load() async {
        do { detail = try await APIClient.shared.legalBoardRequest(id: requestId); error = nil }
        catch { if detail == nil { self.error = error.legalMessage } }
    }

    private func update(_ fields: [String: Any]) async {
        busy = true
        defer { busy = false }
        do { _ = try await APIClient.shared.legalUpdateRequest(id: requestId, fields: fields) }
        catch { LegalToasts.shared.failure(error) }
        await load()
    }

    private func reject() async {
        let text = reason.trimmingCharacters(in: .whitespacesAndNewlines)
        guard text.count >= 3 else { return }
        do {
            _ = try await APIClient.shared.legalRejectRequest(id: requestId, reason: text)
            LegalToasts.shared.success(T("Request declined. The requester sees your reason."))
        } catch { LegalToasts.shared.failure(error) }
        reason = ""
        await load()
    }

    private func openAttachment(_ r: LegalBoardRequest, _ a: LegalRequestAttachment) async {
        do { sheet = .share(try await APIClient.shared.legalRequestAttachment(id: r.id, attachment: a)) }
        catch { LegalToasts.shared.failure(error) }
    }
}

/// Pick the signed document an addendum request amends (search starts from the number as typed).
struct LegalSignedDocumentPicker: View {
    let initialQuery: String
    let onPick: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var q = ""
    @State private var docs: [LegalDocumentSummary]?
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger) }
                else if docs == nil { LegalLoadingRow() }
                else if docs?.isEmpty == true { Text(T("No signed document matches")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg) }
                ForEach(docs ?? []) { d in
                    Button { onPick(d.id); dismiss() } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(d.number).font(.system(size: 13, design: .monospaced)).foregroundStyle(NX.foreground)
                            Text("\(d.title) · \(d.company?.name ?? "")").font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        }
                    }
                }
            }
            .searchable(text: $q, placement: .navigationBarDrawer(displayMode: .always), prompt: T("Search number, title, counterparty…"))
            .task(id: q) {
                if !q.isEmpty { try? await Task.sleep(nanoseconds: 250_000_000) }
                if Task.isCancelled { return }
                var query = LegalArchiveQuery()
                query.q = q.trimmingCharacters(in: .whitespaces)
                query.status = "SIGNED"
                query.limit = 30
                do { docs = try await APIClient.shared.legalDocuments(query).documents; error = nil }
                catch { if !Task.isCancelled { self.error = error.legalMessage } }
            }
            .onAppear { if q.isEmpty { q = initialQuery } }
            .navigationTitle(T("Parent document (signed)"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
    }
}

/// The request links: the general one and one per company. Copy, open / close, regenerate.
struct LegalRequestLinksSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var links: [LegalRequestLink]?
    @State private var error: String?
    @State private var regenerating: LegalRequestLink?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(T("Only people with a link can ask Legal for a document, and they sign in to NEXUS to send. The general link lets them pick the company; a company's link fixes it."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                if let error { Text(error).font(NXFont.text(13)).foregroundStyle(NX.danger) }
                else if links == nil { LegalLoadingRow() }
                ForEach(links ?? []) { l in
                    Section(l.company?.name ?? T("General (company chosen in the form)")) {
                        Text(url(l)).font(.system(size: 12, design: .monospaced)).foregroundStyle(l.accepting ? NX.foreground : NX.mutedFg)
                            .strikethrough(!l.accepting).textSelection(.enabled)
                        Toggle(T("Taking requests"), isOn: Binding(get: { l.accepting }, set: { v in Task { await setAccepting(l, v) } })).tint(NX.violet)
                        Button { UIPasteboard.general.string = url(l); LegalToasts.shared.success(T("Link copied")) } label: { Label(T("Copy"), systemImage: "doc.on.doc") }
                        Button { regenerating = l } label: { Label(T("Regenerate"), systemImage: "arrow.clockwise") }
                        if let at = l.rotatedAt { Text(String(format: T("Regenerated %@"), LegalLabels.date(at))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                    }
                }
            }
            .navigationTitle(T("Request links"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } } }
            .task { await load() }
            .alert(T("Make a new link?"), isPresented: Binding(get: { regenerating != nil }, set: { if !$0 { regenerating = nil } })) {
                Button(T("Cancel"), role: .cancel) { regenerating = nil }
                Button(T("Make a new link"), role: .destructive) {
                    if let l = regenerating { Task { await regenerate(l) } }
                    regenerating = nil
                }
            } message: {
                Text(T("The current link stops working at once. Anyone who has it will need the new one. Requests already sent stay."))
            }
        }
        .legalToasts()
    }

    private func url(_ l: LegalRequestLink) -> String { Config.baseURL.absoluteString.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + l.path }

    private func load() async {
        do { links = try await APIClient.shared.legalRequestLinkList(); error = nil }
        catch { self.error = error.legalMessage }
    }

    private func setAccepting(_ l: LegalRequestLink, _ v: Bool) async {
        do {
            _ = try await APIClient.shared.legalSetRequestLinkAccepting(scope: l.scope, accepting: v)
            LegalToasts.shared.success(v ? T("The link takes requests again") : T("The link is closed for new requests"))
        } catch { LegalToasts.shared.failure(error) }
        await load()
    }

    private func regenerate(_ l: LegalRequestLink) async {
        do {
            _ = try await APIClient.shared.legalRegenerateRequestLink(scope: l.scope)
            LegalToasts.shared.success(T("New link made. The old one no longer works."))
        } catch { LegalToasts.shared.failure(error) }
        await load()
    }
}
