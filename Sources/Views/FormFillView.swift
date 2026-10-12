import SwiftUI
import PhotosUI
import UniformTypeIdentifiers

/// Port of f.$formId.tsx: the public intake form, filled and submitted in the app.
///
/// The cards on Forms, the project's Forms tab and the FORMS section of search all lead here — up
/// to now every one of them was a card that could not be opened, so a form link sent to somebody
/// meant leaving the app.
struct FormFillView: View {
    let formId: String
    /// Shown in the navigation bar until the form itself arrives with its real name.
    let title: String

    @Environment(AuthStore.self) private var auth

    @State private var form: PublicForm?
    @State private var values: [String: FormValue] = [:]
    @State private var loading = true
    @State private var errorTitle = ""
    @State private var errorMessage: String?
    /// Drives the clock-vs-lock icon: "opens later" and "gone" are different news.
    @State private var errorIsSchedule = false
    @State private var submitting = false
    @State private var uploadProgress = UploadProgress()
    @State private var actionError: String?
    @State private var done = false
    /// The Idempotency-Key of the answers being submitted: made on the first tap, reused on a retry,
    /// dropped once the submission went through.
    @State private var submitKey: String?

    /// One importer for both buttons. Two `.fileImporter` modifiers on one view is unsupported in
    /// SwiftUI: the second cancels the first, so "Choose files" opened nothing on most devices while
    /// it happened to work on one. The target is deliberately NOT cleared when the picker closes:
    /// the completion handler runs after `isPresented` is already false, and would find it empty.
    private enum PickTarget { case files(String), attachment(String) }
    @State private var pickTarget: PickTarget = .files("")
    @State private var showImporter = false
    /// Where the file comes from: a fresh photo, the photo library, or Files. A reimbursement is
    /// usually a receipt in somebody's hand, so the camera has to be one tap away.
    @State private var showSourceMenu = false
    @State private var showCamera = false
    @State private var showPhotos = false
    @State private var photoItems: [PhotosPickerItem] = []

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
                // Presented from the inner view, the importer from the outer one: one presentation
                // of each kind per view, which is what SwiftUI actually supports.
                .sheet(isPresented: $showCamera) {
                    CameraPicker(cameraDevice: .rear) { data in
                        addData(data, filename: "photo-\(Self.stamp()).jpg", mime: "image/jpeg")
                    }
                    .ignoresSafeArea()
                }
                .photosPicker(isPresented: $showPhotos, selection: $photoItems,
                              maxSelectionCount: { if case .attachment = pickTarget { return 1 } else { return 10 } }(),
                              matching: .images)
                .onChange(of: photoItems) { _, items in
                    guard !items.isEmpty else { return }
                    photoItems = []
                    Task { await addPhotos(items) }
                }
        }
        .alert(T("Add file"), isPresented: $showSourceMenu) {
                Button(T("Cancel"), role: .cancel) {}
            // A beat after the dialog goes, so the next presentation is not swallowed by its exit.
            Button(T("Take a photo")) { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { showCamera = true } }
            Button(T("Choose from Photos")) { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { showPhotos = true } }
            Button(T("Browse files")) { DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { showImporter = true } }
        }
        .navigationTitle(form?.name ?? title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
        .sheet(isPresented: $showImporter) {
            DocumentPicker(types: [.item], multiple: true) { urls in
                let result: Result<[URL], Error> = .success(urls)
                // In a Task, because reading the picked file is what these do and this closure runs on
                // the main actor — see `read`. The attachment slot takes the first file only.
                guard case let .success(urls) = result else { return }
                switch pickTarget {
                case .files(let field): Task { await addFiles(urls, to: field) }
                case .attachment(let field): if let url = urls.first { Task { await addAttachment(url, to: field) } }
                }
            }
            .ignoresSafeArea()
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let errorMessage {
            failureCard(errorMessage)
        } else if done {
            doneCard
        } else if let form {
            editor(form)
        } else {
            failureCard(T("Couldn't load this form."))
        }
    }

    // MARK: - states

    private func failureCard(_ message: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: errorIsSchedule ? "clock" : "lock")
                .font(.system(size: 38)).foregroundStyle(NX.mutedFg)
            Text(errorTitle.isEmpty ? T("Form unavailable") : errorTitle)
                .font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
            Text(message).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            Button(T("Try again")) { Task { await load() } }
                .buttonStyle(NexusPrimaryButton(fullWidth: false))
                .padding(.top, 4)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }

    private var doneCard: some View {
        VStack(spacing: 10) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 46)).foregroundStyle(NX.success)
            Text(T("Submitted — thank you!")).font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
            Text(T("Your response was received.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            if let name = form?.name, !name.isEmpty {
                Text(name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .padding(32)
    }

    // MARK: - the form

    private func editor(_ form: PublicForm) -> some View {
        // Both of these walk the field list once, so they are computed here rather than in each
        // row: the gate under the button and the rows on screen must never disagree about which
        // fields are visible.
        let visible = FormLogic.visibleFields(form.fields, values: values)
        let missing = FormLogic.missingRequired(visible, values: values)

        return ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header(form)
                if visible.isEmpty {
                    Text(T("This form has no fields yet."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                } else {
                    ForEach(visible) { field in fieldRow(field) }
                }
                footer(missing: missing)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func header(_ form: PublicForm) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(form.name).font(NXFont.display(20, .bold)).foregroundStyle(NX.foreground)
            if let description = form.description, !description.isEmpty {
                Text(description).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let session = auth.session {
                VStack(alignment: .leading, spacing: 1) {
                    SectionLabel(T("Submitting as"))
                    Text(session.userName.isEmpty ? session.userEmail : session.userName)
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                }
                .padding(.top, 2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private func fieldRow(_ field: FormField) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            if field.type != "checkbox" { label(field) }
            control(field)
            if field.autofill != nil {
                Text(T("Auto-filled from your account"))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            if field.attachmentEnabled, field.type != "file" { extraAttachment(field) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func label(_ field: FormField) -> some View {
        HStack(spacing: 3) {
            Text(field.displayLabel).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
            if field.required { Text("*").font(NXFont.text(13, .bold)).foregroundStyle(NX.danger) }
        }
    }

    /// The nine types, in the SAME order the web tests them — the order is load-bearing. A field
    /// that is both currency-formatted and autofilled renders as currency there, and an autofilled
    /// textarea stays an editable textarea, because `type` is checked before either flag.
    @ViewBuilder private func control(_ field: FormField) -> some View {
        switch field.type {
        case "textarea": textArea(field)
        case "dropdown", "select": dropdown(field)
        case "multi_select": multiSelect(field)
        case "checkbox": checkbox(field)
        case "file": filePicker(field)
        default:
            if field.isCurrency { currency(field) }
            else if field.autofill != nil { readOnly(field) }
            else if field.type == "date" { datePicker(field) }
            else { plainText(field) }
        }
    }

    private func plainText(_ field: FormField) -> some View {
        TextField(field.placeholder ?? "", text: textBinding(field.id))
            .keyboardType(field.type == "email" ? .emailAddress : (field.type == "number" ? .decimalPad : .default))
            .textInputAutocapitalization(field.type == "email" ? .never : .sentences)
            .autocorrectionDisabled(field.type == "email")
            .modifier(FormInputBox())
    }

    private func textArea(_ field: FormField) -> some View {
        ZStack(alignment: .topLeading) {
            if rawText(field.id).isEmpty, let placeholder = field.placeholder, !placeholder.isEmpty {
                Text(placeholder).font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 13).padding(.vertical, 15)
                    .allowsHitTesting(false)
            }
            TextEditor(text: textBinding(field.id))
                .font(NXFont.text(15))
                .foregroundStyle(NX.foreground)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 96)
                .padding(.horizontal, 8).padding(.vertical, 6)
        }
        .modifier(FormInputBox(padded: false))
    }

    private func readOnly(_ field: FormField) -> some View {
        HStack(spacing: 8) {
            Text(rawText(field.id)).font(NXFont.text(15)).foregroundStyle(NX.mutedFg).lineLimit(1)
            Spacer(minLength: 0)
            Image(systemName: "lock.fill").font(.system(size: 12)).foregroundStyle(NX.mutedFg.opacity(0.6))
        }
        .modifier(FormInputBox())
    }

    private func currency(_ field: FormField) -> some View {
        HStack(spacing: 6) {
            Text("Rp").font(NXFont.text(14, .semibold)).foregroundStyle(NX.mutedFg)
            TextField("0", text: currencyBinding(field.id)).keyboardType(.numberPad)
        }
        .modifier(FormInputBox())
    }

    private func datePicker(_ field: FormField) -> some View {
        // A DatePicker always shows *a* date, so the caption is what tells the difference between
        // "today" and "nobody has chosen yet" — the value stays empty until the picker is used,
        // which is what keeps a required date field blocking submit the way the web's does.
        HStack(spacing: 10) {
            DatePicker("", selection: dateBinding(field.id), displayedComponents: .date)
                .labelsHidden()
                .tint(NX.violet)
            if !FormLogic.isFilled(values[field.id]) {
                Text(T("Not set yet")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 0)
        }
    }

    private func dropdown(_ field: FormField) -> some View {
        let current = rawText(field.id)
        return Menu {
            Button(T("Choose…")) { values[field.id] = .text("") }
            // Indexed because option lists are hand-authored and two identical entries would
            // otherwise share an identity.
            ForEach(field.options.indices, id: \.self) { index in
                Button(field.options[index]) { values[field.id] = .text(field.options[index]) }
            }
        } label: {
            HStack(spacing: 8) {
                Text(current.isEmpty ? T("Choose…") : current)
                    .font(NXFont.text(15))
                    .foregroundStyle(current.isEmpty ? NX.mutedFg : NX.foreground)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Image(systemName: "chevron.up.chevron.down")
                    .font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
            }
            .modifier(FormInputBox())
        }
    }

    private func multiSelect(_ field: FormField) -> some View {
        let chosen = listValue(field.id)
        return VStack(alignment: .leading, spacing: 10) {
            ForEach(field.options.indices, id: \.self) { index in
                Button { toggle(field.options[index], in: field.id) } label: {
                    tickRow(text: field.options[index], on: chosen.contains(field.options[index]))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .modifier(FormInputBox(padded: false))
    }

    private func checkbox(_ field: FormField) -> some View {
        let on = flagValue(field.id)
        return Button { values[field.id] = .flag(!on) } label: {
            tickRow(text: field.displayLabel, on: on, required: field.required)
        }
        .buttonStyle(.plain)
    }

    private func tickRow(text: String, on: Bool, required: Bool = false) -> some View {
        HStack(spacing: 10) {
            Image(systemName: on ? "checkmark.square.fill" : "square")
                .font(.system(size: 17))
                .foregroundStyle(on ? NX.violet : NX.mutedFg)
            HStack(spacing: 3) {
                Text(text).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                if required { Text("*").font(NXFont.text(14, .bold)).foregroundStyle(NX.danger) }
            }
            Spacer(minLength: 0)
        }
    }

    private func filePicker(_ field: FormField) -> some View {
        let picked = fileValue(field.id)
        return VStack(alignment: .leading, spacing: 8) {
            Button {
                pickTarget = .files(field.id)
                showSourceMenu = true
            } label: {
                pickerRow(icon: "paperclip",
                          text: picked.isEmpty ? T("Choose files (more than one is fine)")
                                               : "\(picked.count) \(T("files selected"))",
                          filled: !picked.isEmpty)
            }
            .buttonStyle(.plain)

            ForEach(picked) { file in
                fileChip(name: file.filename) { drop(file.id, from: field.id) }
            }
        }
    }

    private func extraAttachment(_ field: FormField) -> some View {
        let key = "attachment:\(field.id)"
        let attached = fileValue(key).first
        return VStack(alignment: .leading, spacing: 6) {
            Button {
                pickTarget = .attachment(field.id)
                showSourceMenu = true
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: "paperclip").font(.system(size: 11))
                    Text(attached?.filename ?? T("Attach a file (optional)"))
                        .font(NXFont.text(12)).lineLimit(1)
                }
                .foregroundStyle(attached == nil ? NX.mutedFg : NX.violetText)
            }
            .buttonStyle(.plain)
            if attached != nil {
                Button(T("Remove file")) { values[key] = nil }
                    .font(NXFont.text(11, .semibold))
                    .foregroundStyle(NX.danger)
                    .buttonStyle(.plain)
            }
        }
    }

    private func pickerRow(icon: String, text: String, filled: Bool) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 13)).foregroundStyle(NX.mutedFg)
            Text(text).font(NXFont.text(14)).foregroundStyle(filled ? NX.foreground : NX.mutedFg).lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(filled ? NX.violet.opacity(0.5) : NX.border,
                              lineWidth: 1)
        }
    }

    private func fileChip(name: String, onRemove: @escaping () -> Void) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "doc").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
            Text(name).font(NXFont.text(12)).foregroundStyle(NX.foreground).lineLimit(1)
            Spacer(minLength: 0)
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill").font(.system(size: 14)).foregroundStyle(NX.mutedFg)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Remove file"))
        }
        .padding(.horizontal, 10).padding(.vertical, 7)
        .background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }

    private func footer(missing: [String]) -> some View {
        VStack(spacing: 8) {
            if uploadProgress.isActive { UploadProgressBar(progress: uploadProgress) }
            Button { Task { await submit() } } label: {
                HStack(spacing: 8) {
                    if submitting { ProgressView().tint(.white) }
                    Text(T("Submit"))
                }
            }
            .buttonStyle(NexusPrimaryButton())
            .disabled(submitting || !missing.isEmpty)
            .opacity(missing.isEmpty ? 1 : 0.5)

            if missing.isEmpty, let form {
                // Email / link answers the server would refuse, said before the tap (F-BUG-13).
                ForEach(FormLogic.invalidAnswers(FormLogic.visibleFields(form.fields, values: values), values: values), id: \.self) { line in
                    Text(line).font(NXFont.text(12)).foregroundStyle(NX.danger).multilineTextAlignment(.center)
                }
            }
            if !missing.isEmpty {
                Text("\(T("Fill in the required ones first")): \(missing.joined(separator: ", "))")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    .multilineTextAlignment(.center)
            }
            if let actionError {
                Text(actionError).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger)
                    .multilineTextAlignment(.center)
            }
        }
        .padding(.top, 4)
    }

    // MARK: - reading and writing answers

    // Each of these unwraps the dictionary entry before matching on it. Matching an enum case
    // straight against an Optional reads fine and is a coin toss to compile.
    private func rawText(_ id: String) -> String {
        guard let value = values[id], case .text(let s) = value else { return "" }
        return s
    }
    private func listValue(_ id: String) -> [String] {
        guard let value = values[id], case .list(let a) = value else { return [] }
        return a
    }
    private func flagValue(_ id: String) -> Bool {
        guard let value = values[id], case .flag(let b) = value else { return false }
        return b
    }
    private func fileValue(_ id: String) -> [FormUpload] {
        guard let value = values[id], case .files(let f) = value else { return [] }
        return f
    }

    private func textBinding(_ id: String) -> Binding<String> {
        Binding(get: { rawText(id) }, set: { values[id] = .text($0) })
    }

    /// Shows grouped thousands, stores bare digits — the server is handed the same unformatted
    /// string the web sends it.
    private func currencyBinding(_ id: String) -> Binding<String> {
        Binding(get: { FormLogic.idrDisplay(rawText(id)) },
                set: { values[id] = .text(FormLogic.idrDigits($0)) })
    }

    private func dateBinding(_ id: String) -> Binding<Date> {
        Binding(get: { FormLogic.isoDay.date(from: rawText(id)) ?? Date() },
                set: { values[id] = .text(FormLogic.isoDay.string(from: $0)) })
    }

    /// Appends on tick and drops every copy on untick, matching the web — so the stored order is
    /// the order they were chosen in, not the order of the option list.
    private func toggle(_ option: String, in id: String) {
        var chosen = listValue(id)
        if chosen.contains(option) { chosen.removeAll { $0 == option } } else { chosen.append(option) }
        values[id] = .list(chosen)
    }

    private func drop(_ uploadId: UUID, from fieldId: String) {
        values[fieldId] = .files(fileValue(fieldId).filter { $0.id != uploadId })
    }

    // MARK: - files

    private func addFiles(_ urls: [URL], to fieldId: String) async {
        guard !fieldId.isEmpty else { return }
        var picked = fileValue(fieldId)
        // What the submit would already be carrying, kept current across the loop: `values` is not
        // written until the end, so a second file picked in the same breath has to be counted here
        // or the ceiling below would be measured against a stale total.
        var carried = pickedBytes
        for url in urls {
            guard let upload = await read(url, partName: "file:\(fieldId)", carrying: carried) else { continue }
            carried += upload.data.count
            picked.append(upload)
        }
        values[fieldId] = .files(picked)
    }

    /// Photos picked from the library, read one by one; a failure names itself and moves on.
    private func addPhotos(_ items: [PhotosPickerItem]) async {
        for (i, item) in items.enumerated() {
            guard let data = try? await item.loadTransferable(type: Data.self) else {
                actionError = T("Couldn't read that photo.")
                continue
            }
            let type = item.supportedContentTypes.first
            addData(data, filename: "photo-\(Self.stamp())-\(i + 1).\(type?.preferredFilenameExtension ?? "jpg")",
                    mime: type?.preferredMIMEType ?? "image/jpeg")
        }
    }

    /// Bytes that did not come from a URL — a photo just taken, or one from the library — added to
    /// whichever slot the source menu was opened for, under the same ceilings as `read`.
    private func addData(_ data: Data, filename: String, mime: String) {
        let key: String, partName: String, carrying: Int
        switch pickTarget {
        case .files(let field):
            key = field; partName = "file:\(field)"; carrying = pickedBytes
        case .attachment(let field):
            key = "attachment:\(field)"; partName = key
            carrying = pickedBytes - fileValue(key).reduce(0) { $0 + $1.data.count }
        }
        guard !key.isEmpty, !data.isEmpty else { return }
        guard data.count <= FormUpload.maxBytes else { actionError = T("That file is over the 50MB limit."); return }
        guard carrying + data.count <= APIClient.singleRequestCeiling else { actionError = T("These files are too big to send together."); return }
        let upload = FormUpload(partName: partName, filename: filename, mime: mime, data: data)
        if case .attachment = pickTarget { values[key] = .files([upload]) }
        else { values[key] = .files(fileValue(key) + [upload]) }
    }

    private static func stamp() -> String {
        let f = DateFormatter(); f.dateFormat = "yyyyMMdd-HHmmss"; f.locale = Locale(identifier: "en_US_POSIX")
        return f.string(from: Date())
    }

    private func addAttachment(_ url: URL, to fieldId: String) async {
        guard !fieldId.isEmpty else { return }
        let already = fileValue("attachment:\(fieldId)").reduce(0) { $0 + $1.data.count }
        guard let upload = await read(url, partName: "attachment:\(fieldId)",
                                      carrying: pickedBytes - already) else { return }
        values["attachment:\(fieldId)"] = .files([upload])
    }

    /// Everything already picked, across every field. A submit is ONE multipart request carrying
    /// all of it, so what matters is the sum and not any single file.
    private var pickedBytes: Int {
        values.values.reduce(0) { total, value in
            guard case .files(let uploads) = value else { return total }
            return total + uploads.reduce(0) { $0 + $1.data.count }
        }
    }

    /// Reads the picked file into memory and reports the reason inline when it cannot. Returning
    /// nil rather than throwing keeps the callers above short.
    ///
    /// The size is asked of the file system BEFORE anything is read. The picker hands back whatever
    /// was tapped — a film, a disk image — and the old order read it whole and then rejected it,
    /// which on the main actor is a frozen screen paid for a refusal. `read` no longer runs there:
    /// it is async and the read itself is done by a nonisolated call, so the hop off the main actor
    /// happens at the `await`.
    ///
    /// Two ceilings, and they are different things. The 50 MB is the submit route's own per-file
    /// cap, refused by name. `singleRequestCeiling` is the edge's: there is no chunk route for
    /// `/api/forms/{id}/submit`, so five legal 40 MB attachments still make one 200 MB body that
    /// Cloudflare drops after a couple of megabytes. Nobody could act on that failure at submit
    /// time — a form filled in for ten minutes and then refused — so it is caught at the pick.
    private func read(_ url: URL, partName: String, carrying: Int) async -> FormUpload? {
        let scoped = url.startAccessingSecurityScopedResource()
        defer { if scoped { url.stopAccessingSecurityScopedResource() } }

        let size = APIClient.fileSize(of: url)
        guard size > 0 else {
            actionError = T("Couldn't read that file.")
            return nil
        }
        guard size <= FormUpload.maxBytes else {
            actionError = T("That file is over the 50MB limit.")
            return nil
        }
        guard carrying + size <= APIClient.singleRequestCeiling else {
            actionError = T("These files are too big to send together.")
            return nil
        }
        guard let data = await APIClient.bytes(of: url) else {
            actionError = T("Couldn't read that file.")
            return nil
        }

        let mime = UTType(filenameExtension: url.pathExtension.lowercased())?.preferredMIMEType
            ?? "application/octet-stream"
        return FormUpload(partName: partName, filename: url.lastPathComponent, mime: mime, data: data)
    }

    // MARK: - work

    private func load() async {
        loading = true
        errorMessage = nil
        errorTitle = ""
        errorIsSchedule = false
        actionError = nil
        do {
            let loaded = try await APIClient.shared.publicForm(formId)
            form = loaded
            applyAutofill(loaded)
        } catch APIError.unauthorized {
            auth.logout()
        } catch FormAccessError.notOpenYet(let message) {
            errorIsSchedule = true
            errorTitle = T("Form not open yet")
            errorMessage = message
        } catch FormAccessError.unavailable {
            errorTitle = T("Form unavailable")
            errorMessage = T("This form is private or no longer exists.")
        } catch {
            errorTitle = T("Form unavailable")
            errorMessage = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load this form.")
        }
        loading = false
    }

    /// Prefills "Request by" and friends from the signed-in account so nobody retypes their own
    /// name. UX only: the submit route overwrites autofilled answers from the session, so a value
    /// edited on the way out never reaches the task.
    private func applyAutofill(_ form: PublicForm) {
        guard let session = auth.session else { return }
        for field in form.fields where field.autofill != nil {
            values[field.id] = .text(field.autofill == "email" ? session.userEmail : session.userName)
        }
    }

    private func submit() async {
        guard let form, !submitting else { return }
        let visible = FormLogic.visibleFields(form.fields, values: values)
        guard FormLogic.missingRequired(visible, values: values).isEmpty else { return }
        if let bad = FormLogic.invalidAnswers(visible, values: values).first { actionError = bad; return }

        submitting = true
        actionError = nil
        defer { submitting = false }

        let payload = FormLogic.payload(visible: visible, values: values)
        let key = submitKey ?? UUID().uuidString
        submitKey = key
        do {
            try await APIClient.shared.submitForm(formId, data: payload.data, files: payload.files,
                                                  progress: uploadProgress, idempotencyKey: key)
            submitKey = nil
            done = true
        } catch {
            actionError = (error as? LocalizedError)?.errorDescription ?? T("Submission failed. Try again.")
        }
    }
}

/// The web's single `input` class, as one modifier: rounded, hairline border, card ground.
/// `padded: false` is for controls that draw their own inner spacing (the text editor, the
/// multi-select box) and only want the shape.
private struct FormInputBox: ViewModifier {
    var padded = true

    func body(content: Content) -> some View {
        content
            .font(NXFont.text(15))
            .foregroundStyle(NX.foreground)
            .padding(.horizontal, padded ? 12 : 0)
            .padding(.vertical, padded ? 11 : 0)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border)
            }
    }
}
