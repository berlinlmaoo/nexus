import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// The form builder — a port of the web's FormBuilder and ProjectFormsView
// (apps/nexus-lovable-ui/src/components/forms/form-kit.tsx).
//
// Owner, 9 Oct 2026: on iPhone and on the Mac, "+" on a project's Forms tab
// opened New task, and there was no way to build a form at all — the app could
// only fill one in. Everything the web builder does is here: name, description,
// fields (add, edit, reorder, delete; the same nine types; required; options;
// file attachment; auto-fill; Rupiah format; branching; routing; mapping to task
// fields and custom fields), public/private, login-to-submit, the access
// schedule, the public link, duplicate to another project and delete.
//
// Every screen is pushed, never presented: the project screen already owns its
// sheets, and a builder in a sheet over it would be the third.
// ─────────────────────────────────────────────────────────────────────────────

extension Notification.Name {
    /// A form was created, saved, published, duplicated or deleted on this device. The server sends
    /// no realtime event for forms, so the lists that show them listen for this instead.
    static let nexusFormsChanged = Notification.Name("nexus.forms.changed")
}

/// A form to fill in, pushed from a context menu.
struct FormFillTarget: Hashable, Identifiable {
    let id: String
    let name: String
}

/// A form to edit, pushed from the Forms page (which lists forms from every project).
struct FormEditTarget: Hashable, Identifiable {
    let projectId: String
    let projectName: String
    let formId: String
    var id: String { formId }
}

enum FormBuilderText {
    static func counts(submissions: Int, fields: Int) -> String {
        let s = submissions == 1 ? T("1 submission") : String(format: T("%d submissions"), submissions)
        let f = fields == 1 ? T("1 field") : String(format: T("%d fields"), fields)
        return "\(s) · \(f)"
    }
}

// MARK: - Project → Forms tab

/// The project's Forms tab — the web's ProjectFormsView. Every intake form of this project, a New
/// form row, and each form opening in the builder (as a card does on the web). Filling one in,
/// its link and publishing are on the row's context menu.
struct ProjectFormsBuilderTab: View {
    let projectId: String
    let projectName: String
    /// Raised to the project screen, which owns the one New form destination — the same one its
    /// "+" opens on this tab.
    let onNewForm: () -> Void

    @Environment(AuthStore.self) private var auth
    @State private var forms: [BuilderForm] = []
    @State private var loading = true
    @State private var error: String?
    @State private var fillTarget: FormFillTarget?
    @State private var busyId: String?
    @State private var actionError: String?
    @State private var toast: String?

    var body: some View {
        content
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .overlay(alignment: .bottom) {
                if let toast { FormToast(text: toast) }
            }
            .navigationDestination(item: $fillTarget) { t in FormFillView(formId: t.id, title: t.name) }
            .task { await load() }
            .onReceive(NotificationCenter.default.publisher(for: .nexusFormsChanged)) { _ in
                Task { await load() }
            }
            .alert(T("Couldn't update the form"), isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
                Button(T("OK"), role: .cancel) { actionError = nil }
            } message: {
                Text(actionError ?? "")
            }
    }

    @ViewBuilder private var content: some View {
        if loading && forms.isEmpty {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error, forms.isEmpty {
            ErrorState(message: error, icon: "list.clipboard") { Task { await load() } }
        } else if forms.isEmpty {
            ScrollView {
                EmptyState(icon: "list.clipboard", title: T("No forms in this project yet"),
                           subtitle: T("A form is an intake page — a request, a reimbursement, a report. Every submission becomes a task in this project."),
                           actionTitle: T("New form"), actionIcon: "plus", action: onNewForm)
                    .padding(.horizontal, 24).padding(.top, 48)
            }
            .refreshable { await load() }
        } else {
            List {
                Section {
                    Button(action: onNewForm) {
                        Label(T("New form"), systemImage: "plus.circle.fill")
                            .font(NXFont.text(15, .semibold)).foregroundStyle(NX.violetText)
                    }
                } footer: {
                    Text(T("Tap a form to edit it. Touch and hold it to fill it in, copy or share its link, or publish it."))
                }
                Section {
                    ForEach(forms) { f in
                        NavigationLink {
                            FormBuilderView(projectId: projectId, projectName: projectName, formId: f.id)
                        } label: {
                            FormBuilderRow(form: f, busy: busyId == f.id)
                        }
                        .contextMenu { menu(for: f) }
                    }
                } header: {
                    Text(T("Intake forms"))
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .refreshable { await load() }
        }
    }

    @ViewBuilder private func menu(for f: BuilderForm) -> some View {
        Button { fillTarget = FormFillTarget(id: f.id, name: f.name) } label: {
            Label(T("Fill in"), systemImage: "square.and.pencil")
        }
        if f.isPublic == true {
            Button { copy(f.publicURL) } label: { Label(T("Copy public link"), systemImage: "doc.on.doc") }
            ShareLink(item: f.publicURL) { Label(T("Share link"), systemImage: "square.and.arrow.up") }
            Button { Task { await setPublic(f, false) } } label: { Label(T("Unpublish"), systemImage: "eye.slash") }
        } else {
            Button { Task { await setPublic(f, true) } } label: { Label(T("Publish"), systemImage: "globe") }
        }
    }

    private func load() async {
        do {
            forms = try await APIClient.shared.builderForms(projectId: projectId)
            error = nil
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            error = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't load forms.")
        }
        loading = false
    }

    /// PATCH `{ isPublic }` alone — the route writes only the keys it is sent.
    private func setPublic(_ f: BuilderForm, _ on: Bool) async {
        busyId = f.id
        defer { busyId = nil }
        do {
            try await APIClient.shared.updateForm(f.id, ["isPublic": on])
            NotificationCenter.default.post(name: .nexusFormsChanged, object: nil)
            flash(on ? T("Published — anyone with the link can open it.") : T("Unpublished — the public link stops working."))
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            actionError = (failure as? LocalizedError)?.errorDescription ?? T("Try again in a moment.")
        }
    }

    private func copy(_ url: URL) {
        UIPasteboard.general.string = url.absoluteString
        flash(T("Link copied"))
    }

    private func flash(_ text: String) {
        withAnimation(.snappy) { toast = text }
        Task {
            try? await Task.sleep(nanoseconds: 1_800_000_000)
            withAnimation(.snappy) { if toast == text { toast = nil } }
        }
    }
}

/// A short confirmation at the bottom of the list — "Link copied".
private struct FormToast: View {
    let text: String
    var body: some View {
        Text(text)
            .font(NXFont.text(13, .semibold)).foregroundStyle(.white)
            .padding(.horizontal, 14).padding(.vertical, 9)
            .background(NX.violetFill, in: Capsule())
            .padding(.bottom, 20)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .allowsHitTesting(false)
    }
}

/// One form in a list: name, project (when the list spans projects), description, counts, and
/// whether its link is public — the web's FormCard as a row.
struct FormBuilderRow: View {
    let form: BuilderForm
    var projectName: String? = nil
    var busy = false

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "doc.text.fill").font(.system(size: 15)).foregroundStyle(NX.violetText)
                .frame(width: 34, height: 34)
                .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(form.name).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Spacer(minLength: 4)
                    if busy {
                        ProgressView().controlSize(.small)
                    } else if form.isPublic == true {
                        NexusChip(text: T("Public"), tone: .success, systemImage: "globe")
                    } else {
                        NexusChip(text: T("Private"), tone: .neutral, systemImage: "lock")
                    }
                }
                if let projectName {
                    Text(projectName).font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText).lineLimit(1)
                }
                if let d = form.description?.trimmingCharacters(in: .whitespacesAndNewlines), !d.isEmpty {
                    Text(d).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(2)
                }
                Text(FormBuilderText.counts(submissions: form.submissionCount, fields: form.fieldCount))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
        }
        .padding(.vertical, 4)
    }
}

// MARK: - Builder

/// New form / Edit form. A pushed screen with Cancel (when there is something to lose) and
/// Create / Save. Creating keeps the screen open on the new form so its link is right there;
/// saving an existing form goes back to the list, as the web's drawer closes.
struct FormBuilderView: View {
    let projectId: String
    let projectName: String
    /// nil = a new form.
    let formId: String?

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    /// The form as the server last returned it; nil until a new form is created.
    @State private var saved: BuilderForm?
    @State private var loaded = false
    @State private var loadError: String?

    @State private var name = ""
    @State private var description = ""
    @State private var isPublic = false
    @State private var requireAuth = false
    @State private var schedule = BuilderSchedule(raw: nil)
    @State private var fields: [BuilderField] = []
    /// The draft as it was loaded or last saved — what "unsaved changes" is measured against.
    @State private var baseline: Draft?

    // Routing and mapping pick from these, exactly as the web's editor does.
    @State private var sections: [ProjectDetail.Lane] = []
    @State private var members: [ProjectDetail.ProjectMember] = []
    @State private var customFields: [CustomField] = []

    @State private var editMode: EditMode = .inactive
    @State private var openFieldId: String?
    @State private var showDuplicate = false
    @State private var showFill = false
    @State private var saving = false
    @State private var deleting = false
    @State private var justCreated = false
    @State private var copied = false
    /// The one alert this screen has — discard, delete, delete-with-submissions or a failure.
    @State private var alert: BuilderAlert?

    private struct Draft: Equatable {
        var name: String
        var description: String
        var isPublic: Bool
        var requireAuth: Bool
        var schedule: BuilderSchedule
        var fields: [BuilderField]
    }

    private enum BuilderAlert: Equatable {
        case discard
        case delete(submissions: Int)
        case forceDelete(submissions: Int)
        case failed(title: String, message: String)
    }

    private var draft: Draft {
        Draft(name: name, description: description, isPublic: isPublic, requireAuth: requireAuth, schedule: schedule, fields: fields)
    }
    private var isDirty: Bool { baseline != nil && draft != baseline }
    private var currentId: String? { saved?.id ?? formId }
    private var canSave: Bool {
        !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !fields.isEmpty
    }

    var body: some View {
        Group {
            if !loaded {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let loadError {
                ErrorState(message: loadError, icon: "list.clipboard") {
                    Task { loaded = false; await load() }
                }
            } else {
                editor
            }
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(currentId == nil ? T("New form") : T("Edit form"))
        .navigationBarTitleDisplayMode(.inline)
        // With unsaved changes the back button becomes Cancel, which asks first. Hiding it also
        // turns off the swipe back, which would otherwise throw the changes away without a word.
        .navigationBarBackButtonHidden(isDirty)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                if isDirty {
                    Button(T("Cancel")) { alert = .discard }
                }
            }
            ToolbarItem(placement: .confirmationAction) {
                if saving {
                    ProgressView()
                } else {
                    Button(currentId == nil ? T("Create") : T("Save")) { Task { await save() } }
                        .fontWeight(.semibold)
                        .disabled(!loaded || loadError != nil || !canSave || (currentId != nil && !isDirty))
                }
            }
        }
        // Once: coming back from a field's screen must not reload over the edits made there.
        .task { if !loaded { await load() } }
        .navigationDestination(item: $openFieldId) { id in fieldEditor(id) }
        .navigationDestination(isPresented: $showDuplicate) {
            FormDuplicateView(sourceProjectId: projectId, initialName: name, description: description,
                              fields: fields, isPublic: isPublic, requireAuth: requireAuth, accessSchedule: scheduleJSON)
        }
        // Only reachable from Manage, which only exists once the form has an id.
        .navigationDestination(isPresented: $showFill) {
            FormFillView(formId: currentId ?? "", title: saved?.name ?? name)
        }
        .alert(alertTitle, isPresented: Binding(get: { alert != nil }, set: { if !$0 { alert = nil } }), presenting: alert) { a in
            alertButtons(a)
        } message: { a in
            Text(alertMessage(a))
        }
    }

    // MARK: editor

    private var editor: some View {
        Form {
            if justCreated {
                Section {
                    Label(T("Form created."), systemImage: "checkmark.circle.fill")
                        .font(NXFont.text(14, .semibold)).foregroundStyle(NX.success)
                }
            }
            detailsSection
            publishingSection
            availabilitySection
            fieldsSection
            if currentId != nil { manageSection }
        }
        .environment(\.editMode, $editMode)
        .scrollContentBackground(.hidden)
    }

    private var detailsSection: some View {
        Section {
            TextField(T("Form name"), text: $name)
                .font(NXFont.text(16, .semibold))
            TextField(T("Description (optional)…"), text: $description, axis: .vertical)
                .font(NXFont.text(14))
                .lineLimit(2...6)
        } header: {
            Text(T("Form"))
        } footer: {
            if !projectName.isEmpty {
                Text(String(format: T("Each submission becomes a task in %@."), projectName))
            }
        }
    }

    private var publishingSection: some View {
        Section {
            Toggle(isOn: $isPublic) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Public form")).font(NXFont.text(15))
                    Text(T("A shareable link that opens without a NEXUS login.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
            }
            .tint(NX.violet)
            Toggle(isOn: $requireAuth) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Require NEXUS login to submit")).font(NXFont.text(15))
                    Text(T("Anyone logged in can submit, and their submissions show in My Submissions.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
            }
            .tint(NX.violet)
            if let saved, saved.isPublic == true {
                linkRows(saved.publicURL)
            }
        } header: {
            Text(T("Publishing"))
        } footer: {
            Text(publishingFooter)
        }
    }

    private var publishingFooter: String {
        guard let saved else {
            return isPublic ? T("The link is ready as soon as you create the form.") : T("Turn this on to share the form by link.")
        }
        let wasPublic = saved.isPublic ?? false
        if isPublic != wasPublic {
            return isPublic ? T("Save to publish the link.") : T("Save to unpublish — the public link stops working.")
        }
        return isPublic ? T("Anyone with this link can open the form.") : T("Turn this on to share the form by link.")
    }

    @ViewBuilder private func linkRows(_ url: URL) -> some View {
        Text(url.absoluteString)
            .font(.system(.footnote, design: .monospaced))
            .foregroundStyle(NX.foreground)
            .textSelection(.enabled)
            .lineLimit(2)
        HStack(spacing: 20) {
            Button {
                UIPasteboard.general.string = url.absoluteString
                copied = true
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    copied = false
                }
            } label: {
                Label(copied ? T("Copied!") : T("Copy link"), systemImage: copied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.borderless)
            ShareLink(item: url) {
                Label(T("Share"), systemImage: "square.and.arrow.up")
            }
            .buttonStyle(.borderless)
            Spacer(minLength: 0)
        }
        .font(NXFont.text(14, .semibold))
        .tint(NX.violetText)
    }

    private var availabilitySection: some View {
        Section {
            Picker(T("Form status"), selection: $schedule.override) {
                Text(T("Auto")).tag("")
                Text(T("Force open")).tag("open")
                Text(T("Force closed")).tag("closed")
            }
            .pickerStyle(.menu)
            Toggle(T("Limit access by schedule"), isOn: scheduleEnabled)
                .tint(NX.violet)
            if schedule.enabled {
                dayPicker
                DatePicker(T("Opens at"), selection: timeBinding(\.start), displayedComponents: .hourAndMinute)
                DatePicker(T("Closes at"), selection: timeBinding(\.end), displayedComponents: .hourAndMinute)
                LabeledContent(T("Time zone"), value: schedule.timezone)
            }
        } header: {
            Text(T("Availability"))
        } footer: {
            Text(availabilityFooter)
        }
    }

    private var availabilityFooter: String {
        switch schedule.override {
        case "open":
            return schedule.enabled ? T("Forced open — always accepting submissions. The schedule is ignored while this is set.")
                                    : T("Forced open — always accepting submissions.")
        case "closed":
            return schedule.enabled ? T("Forced closed — not accepting submissions for now. The schedule is ignored while this is set.")
                                    : T("Forced closed — not accepting submissions for now.")
        default:
            return schedule.enabled ? T("Accepting submissions only on the days and hours above.")
                                    : T("Always accepting submissions.")
        }
    }

    /// The web's day chips: Sun … Sat, any number of them.
    private var dayPicker: some View {
        HStack(spacing: 6) {
            ForEach(0..<7, id: \.self) { i in
                let on = schedule.days.contains(i)
                Button {
                    if on { schedule.days.removeAll { $0 == i } } else { schedule.days = (schedule.days + [i]).sorted() }
                } label: {
                    Text(T(FormBuilderVocab.weekdays[i]))
                        .font(NXFont.text(12, .bold))
                        .lineLimit(1).minimumScaleFactor(0.7)
                        .frame(maxWidth: .infinity, minHeight: 32)
                        .foregroundStyle(on ? Color.white : NX.foreground)
                        .background(on ? NX.violetFill : NX.muted, in: Capsule())
                }
                .buttonStyle(.borderless)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(.vertical, 2)
    }

    /// Turning the schedule on with no days picked starts from Mon–Fri, as the web does.
    private var scheduleEnabled: Binding<Bool> {
        Binding(get: { schedule.enabled }, set: { on in
            schedule.enabled = on
            if on && schedule.days.isEmpty { schedule.days = [1, 2, 3, 4, 5] }
        })
    }

    /// "HH:mm" in the schedule's own zone, shown on a time wheel. Only the hour and minute are
    /// read back, so the device's zone never leaks into the stored value.
    private func timeBinding(_ key: WritableKeyPath<BuilderSchedule, String>) -> Binding<Date> {
        Binding(get: { Self.date(fromHHmm: schedule[keyPath: key]) },
                set: { schedule[keyPath: key] = Self.hhmm($0) })
    }

    private static func date(fromHHmm s: String) -> Date {
        let parts = s.split(separator: ":").compactMap { Int($0) }
        let h = parts.first ?? 0, m = parts.count > 1 ? parts[1] : 0
        return Calendar.current.date(bySettingHour: h, minute: m, second: 0, of: Date()) ?? Date()
    }

    private static func hhmm(_ d: Date) -> String {
        let c = Calendar.current.dateComponents([.hour, .minute], from: d)
        return String(format: "%02d:%02d", c.hour ?? 0, c.minute ?? 0)
    }

    private var fieldsSection: some View {
        Section {
            ForEach(fields) { f in
                NavigationLink { fieldEditor(f.id) } label: { FormBuilderFieldRow(field: f) }
            }
            .onMove { fields.move(fromOffsets: $0, toOffset: $1) }
            .onDelete { fields.remove(atOffsets: $0) }
            Button { addField() } label: {
                Label(T("Add field"), systemImage: "plus.circle.fill")
                    .font(NXFont.text(15, .semibold)).foregroundStyle(NX.violetText)
            }
        } header: {
            HStack {
                Text(String(format: T("Fields · %d"), fields.count))
                Spacer()
                if fields.count > 1 {
                    EditButton().font(NXFont.text(13, .semibold)).textCase(nil)
                }
            }
        } footer: {
            Text(fields.isEmpty ? T("A form needs at least one field.") : T("Tap a field to edit it. Edit reorders them; swipe left to delete one."))
        }
    }

    private var manageSection: some View {
        Section {
            if let saved {
                LabeledContent(T("Submissions"), value: "\(saved.submissionCount)")
            }
            Button { showFill = true } label: {
                Label(T("Open the form"), systemImage: "square.and.pencil")
            }
            Button { showDuplicate = true } label: {
                Label(T("Duplicate to another project"), systemImage: "plus.square.on.square")
            }
            Button(role: .destructive) { alert = .delete(submissions: saved?.submissionCount ?? 0) } label: {
                Label(T("Delete form"), systemImage: "trash")
            }
            .disabled(deleting)
        } header: {
            Text(T("Manage"))
        } footer: {
            Text(T("Open the form shows the last saved version. A duplicate copies the fields only — no submissions or tasks."))
        }
    }

    private func addField() {
        let f = BuilderField.fresh()
        fields.append(f)
        openFieldId = f.id
    }

    private func fieldEditor(_ id: String) -> some View {
        FormFieldEditorView(field: fieldBinding(id),
                            others: fields.filter { $0.id != id },
                            sections: sections, members: members, customFields: customFields,
                            onDelete: { fields.removeAll { $0.id == id } })
    }

    /// By id, never by index: a field can be deleted or moved while its screen is the one on top.
    private func fieldBinding(_ id: String) -> Binding<BuilderField> {
        Binding(get: { fields.first(where: { $0.id == id }) ?? BuilderField(raw: ["id": .string(id)]) },
                set: { new in if let i = fields.firstIndex(where: { $0.id == id }) { fields[i] = new } })
    }

    // MARK: alert

    private var alertTitle: String {
        switch alert {
        case .discard: return T("Discard your changes?")
        case .delete: return T("Delete this form?")
        case .forceDelete: return T("This form has submissions")
        case .failed(let title, _): return title
        case nil: return ""
        }
    }

    @ViewBuilder private func alertButtons(_ a: BuilderAlert) -> some View {
        switch a {
        case .discard:
            Button(T("Discard"), role: .destructive) { dismiss() }
            Button(T("Keep editing"), role: .cancel) {}
        case .delete(let n):
            Button(T("Delete"), role: .destructive) { Task { await delete(force: n > 0) } }
            Button(T("Cancel"), role: .cancel) {}
        case .forceDelete:
            Button(T("Delete anyway"), role: .destructive) { Task { await delete(force: true) } }
            Button(T("Cancel"), role: .cancel) {}
        case .failed:
            Button(T("OK"), role: .cancel) {}
        }
    }

    private func alertMessage(_ a: BuilderAlert) -> String {
        switch a {
        case .discard:
            return T("The changes you made to this form haven't been saved.")
        case .delete(let n), .forceDelete(let n):
            if n == 0 { return T("Its fields and its link go with it.") }
            if n == 1 { return T("It has 1 submission. Deleting the form removes it and its My Submissions history too.") }
            return String(format: T("It has %d submissions. Deleting the form removes them and their My Submissions history too."), n)
        case .failed(_, let message):
            return message
        }
    }

    // MARK: load / save / delete

    private func load() async {
        loadError = nil
        async let detailCall = APIClient.shared.project(projectId)
        async let customFieldsCall = APIClient.shared.projectCustomFields(projectId)
        if let formId {
            do {
                let all = try await APIClient.shared.builderForms(projectId: projectId)
                if let f = all.first(where: { $0.id == formId }) {
                    apply(f)
                } else {
                    loadError = T("This form no longer exists.")
                }
            } catch APIError.unauthorized {
                auth.logout()
                return
            } catch let failure {
                loadError = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't load this form.")
            }
        } else if baseline == nil {
            fields = [BuilderField.fresh()]
            baseline = draft
        }
        let detail = try? await detailCall
        sections = detail?.taskLists ?? []
        members = (detail?.members ?? []).filter { !$0.uid.isEmpty }
        customFields = (try? await customFieldsCall) ?? []
        loaded = true
    }

    /// The web's load: the stored fields intact (advanced keys included), or one blank field.
    private func apply(_ f: BuilderForm) {
        saved = f
        name = f.name
        description = f.description ?? ""
        isPublic = f.isPublic ?? false
        requireAuth = f.requireAuth ?? false
        schedule = BuilderSchedule(raw: f.accessSchedule)
        let rows = (f.fields?.array ?? []).compactMap { $0.object }
        fields = rows.isEmpty ? [BuilderField.fresh()] : rows.map { BuilderField(raw: $0) }
        baseline = draft
    }

    /// What goes out as `accessSchedule`: the stored value as it was when the person left the
    /// schedule alone (null for a form that never had one — the server ignores null), the full
    /// schedule once they touched it.
    private var scheduleJSON: Any {
        if schedule != BuilderSchedule(raw: saved?.accessSchedule) { return schedule.json }
        return saved?.accessSchedule?.any ?? NSNull()
    }

    private func save() async {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, !fields.isEmpty else { return }
        saving = true
        defer { saving = false }
        // The web's body, key for key: description is `description || null`.
        var payload: [String: Any] = [
            "name": trimmed,
            "description": jsonOrNull(description.isEmpty ? nil : description),
            "fields": fields.map { $0.json() },
            "isPublic": isPublic,
            "requireAuth": requireAuth,
            "accessSchedule": scheduleJSON,
        ]
        do {
            if let id = currentId {
                try await APIClient.shared.updateForm(id, payload)
                baseline = draft
                // Leave first, then tell the lists — never the other way round (see `delete`).
                dismiss()
                NotificationCenter.default.post(name: .nexusFormsChanged, object: nil)
            } else {
                payload["projectId"] = projectId
                let created = try await APIClient.shared.createForm(payload)
                apply(created)
                justCreated = true
                NotificationCenter.default.post(name: .nexusFormsChanged, object: nil)
            }
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            alert = .failed(title: T("Couldn't save the form"),
                             message: (failure as? LocalizedError)?.errorDescription ?? T("Try again in a moment."))
        }
    }

    /// No submissions → a plain delete, and if somebody submitted in the meantime the server's 409
    /// asks again with the count. With submissions → the person already saw the count, so force.
    private func delete(force: Bool) async {
        guard let id = currentId else { return }
        deleting = true
        defer { deleting = false }
        do {
            try await APIClient.shared.deleteForm(id, force: force)
            // Leave first, then tell the lists: a list that reloaded first would drop the row this
            // screen was pushed from while it is still on top, and the pop that follows would then
            // take the screen underneath with it.
            dismiss()
            NotificationCenter.default.post(name: .nexusFormsChanged, object: nil)
        } catch FormBuilderError.hasSubmissions(let count, _) {
            alert = .forceDelete(submissions: count)
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            alert = .failed(title: T("Couldn't delete the form"),
                            message: (failure as? LocalizedError)?.errorDescription ?? T("Try again in a moment."))
        }
    }
}

/// One field in the builder's list: its type, name, and what is set on it.
private struct FormBuilderFieldRow: View {
    let field: BuilderField

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: field.kind?.icon ?? "questionmark.square")
                .font(.system(size: 14, weight: .semibold)).foregroundStyle(NX.violetText)
                .frame(width: 30, height: 30)
                .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 2) {
                Text(field.displayName)
                    .font(NXFont.text(15, .medium))
                    .foregroundStyle(field.name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? NX.mutedFg : NX.foreground)
                    .lineLimit(1)
                Text(summary).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 4)
            if field.required { NexusChip(text: T("Required"), tone: .accent) }
        }
    }

    private var summary: String {
        var parts = [field.kind?.label ?? field.type]
        if field.hasOptions {
            let n = field.options.filter { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }.count
            parts.append(n == 1 ? T("1 option") : String(format: T("%d options"), n))
        }
        if field.showIf != nil { parts.append(T("Conditional")) }
        if !field.rules.isEmpty { parts.append(field.rules.count == 1 ? T("1 rule") : String(format: T("%d rules"), field.rules.count)) }
        if let m = FormBuilderVocab.mappingTargets.first(where: { $0.value == field.mappingTarget }), m.value != "none" {
            parts.append("→ " + T(m.label))
        }
        return parts.joined(separator: " · ")
    }
}

// MARK: - One field

/// Everything about one field — the web's per-field card and its "Advanced" panel (branching,
/// routing, mapping), one screen. Changes stay in the builder's draft until the form is saved.
struct FormFieldEditorView: View {
    @Binding var field: BuilderField
    let others: [BuilderField]
    let sections: [ProjectDetail.Lane]
    let members: [ProjectDetail.ProjectMember]
    let customFields: [CustomField]
    let onDelete: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var editMode: EditMode = .inactive
    /// Removed only once this screen has gone: removing it while it is on top would pull the row
    /// that pushed it out from under the navigation.
    @State private var deleteOnLeave = false

    var body: some View {
        Form {
            basicsSection
            extraSections
            if field.hasOptions { optionsSection }
            branchingSection
            routingSections
            mappingSection
            Section {
                FormFieldPreview(field: field)
            } header: {
                Text(T("Preview"))
            }
            Section {
                Button(role: .destructive) {
                    deleteOnLeave = true
                    dismiss()
                } label: {
                    Label(T("Delete field"), systemImage: "trash")
                }
            } footer: {
                Text(T("Changes here are kept in the form until you save it."))
            }
        }
        .environment(\.editMode, $editMode)
        .scrollContentBackground(.hidden)
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(field.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .onDisappear { if deleteOnLeave { onDelete() } }
    }

    // MARK: basics

    private var basicsSection: some View {
        Section {
            TextField(T("e.g. Request amount"), text: nameBinding)
                .font(NXFont.text(16, .semibold))
            Picker(T("Type"), selection: typeBinding) {
                ForEach(FormFieldKind.allCases) { k in
                    Label(k.label, systemImage: k.icon).tag(k.rawValue)
                }
                if field.kind == nil { Text(field.type).tag(field.type) }
            }
            Toggle(T("Required"), isOn: $field.required)
                .tint(NX.violet)
        } header: {
            Text(T("Field name"))
        }
    }

    /// The web writes the name to both `name` and `label`.
    private var nameBinding: Binding<String> {
        Binding(get: { field.name }, set: { field.name = $0; field.label = $0 })
    }

    /// A choice field starts with one empty option row to type into, like the web's editor.
    private var typeBinding: Binding<String> {
        Binding(get: { field.type }, set: { new in
            field.type = new
            if field.hasOptions && field.options.isEmpty { field.options = [""] }
        })
    }

    @ViewBuilder private var extraSections: some View {
        if field.type != "file" {
            Section {
                Toggle(isOn: $field.attachmentEnabled) {
                    Label(T("Allow file attachment"), systemImage: "paperclip")
                }
                .tint(NX.violet)
            } footer: {
                Text(T("Lets the person attach a file to this answer. Attaching stays optional for them."))
            }
        }
        if field.type == "text" || field.type == "email" {
            Section {
                Picker(T("Auto-fill from account"), selection: $field.autofill) {
                    Text(T("None")).tag("")
                    Text(T("User's name")).tag("name")
                    Text(T("User's email")).tag("email")
                }
            } footer: {
                Text(field.autofill.isEmpty
                     ? T("For a field like “Request by”: filled from the account of whoever submits.")
                     : T("The person doesn't type it — it's filled from their account and locked."))
            }
        }
        if field.type == "number" {
            Section {
                Picker(T("Number format"), selection: $field.numberFormat) {
                    Text(T("Plain (9240943)")).tag("")
                    Text(T("Rupiah (Rp 9.240.943)")).tag("currency-idr")
                    if !field.numberFormat.isEmpty && field.numberFormat != "currency-idr" {
                        Text(field.numberFormat).tag(field.numberFormat)
                    }
                }
            }
        }
    }

    // MARK: options

    private var optionsSection: some View {
        Section {
            ForEach(Array(field.options.enumerated()), id: \.offset) { i, _ in
                TextField(String(format: T("Option %d"), i + 1), text: optionBinding(i))
            }
            .onDelete { field.options.remove(atOffsets: $0) }
            .onMove { field.options.move(fromOffsets: $0, toOffset: $1) }
            Button { field.options.append("") } label: {
                Label(T("Add option"), systemImage: "plus.circle").foregroundStyle(NX.violetText)
            }
        } header: {
            HStack {
                Text(T("Options"))
                Spacer()
                if field.options.count > 1 {
                    EditButton().font(NXFont.text(13, .semibold)).textCase(nil)
                }
            }
        } footer: {
            Text(T("Blank options are dropped when you save."))
        }
    }

    private func optionBinding(_ i: Int) -> Binding<String> {
        Binding(get: { i < field.options.count ? field.options[i] : "" },
                set: { v in if i < field.options.count { field.options[i] = v } })
    }

    private var ownOptions: [String] {
        field.options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    // MARK: branching (showIf)

    private var branchingSection: some View {
        Section {
            Toggle(T("Only show this field if…"), isOn: showIfOn)
                .tint(NX.violet)
            if let cond = field.showIf {
                Picker(T("Field"), selection: condBinding(\.fieldId, resetsValue: true)) {
                    if !others.contains(where: { $0.id == cond.fieldId }) {
                        Text(others.isEmpty ? T("No other fields") : T("Choose a field")).tag(cond.fieldId)
                    }
                    ForEach(others) { o in Text(o.displayName).tag(o.id) }
                }
                Picker(T("Condition"), selection: condBinding(\.op)) {
                    ForEach(FormBuilderVocab.operators, id: \.value) { o in Text(T(o.label)).tag(o.value) }
                }
                if FormBuilderVocab.needsValue(cond.op) {
                    let parentOptions = optionsOf(cond.fieldId)
                    if parentOptions.isEmpty {
                        TextField(T("Value"), text: condBinding(\.value))
                    } else {
                        Picker(T("Value"), selection: condBinding(\.value)) {
                            Text("—").tag("")
                            ForEach(parentOptions, id: \.self) { o in Text(o).tag(o) }
                            if !cond.value.isEmpty && !parentOptions.contains(cond.value) {
                                Text(cond.value).tag(cond.value)
                            }
                        }
                    }
                }
            }
        } header: {
            Text(T("Branching"))
        } footer: {
            Text(T("While the condition isn't met, the field is hidden and isn't required."))
        }
    }

    private var showIfOn: Binding<Bool> {
        Binding(get: { field.showIf != nil }, set: { on in
            field.showIf = on ? BuilderCondition(fieldId: others.first?.id ?? "", op: "equals", value: "") : nil
        })
    }

    /// Picking another field clears the value, as the web does: the old value was one of the
    /// previous field's options.
    private func condBinding(_ key: WritableKeyPath<BuilderCondition, String>, resetsValue: Bool = false) -> Binding<String> {
        Binding(get: { field.showIf?[keyPath: key] ?? "" }, set: { v in
            guard var c = field.showIf else { return }
            c[keyPath: key] = v
            if resetsValue { c.value = "" }
            field.showIf = c
        })
    }

    private func optionsOf(_ fieldId: String) -> [String] {
        guard let parent = others.first(where: { $0.id == fieldId }) else { return [] }
        return parent.options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    // MARK: routing

    @ViewBuilder private var routingSections: some View {
        Section {
            if field.rules.isEmpty {
                Text(T("No rules yet.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            }
            Button { field.rules.append(BuilderRule.fresh()) } label: {
                Label(T("Add rule"), systemImage: "plus.circle").foregroundStyle(NX.violetText)
            }
        } header: {
            Text(T("Routing"))
        } footer: {
            Text(T("When the answer matches, the new task moves to a section or is assigned to a member."))
        }
        ForEach(Array(field.rules.enumerated()), id: \.element.id) { i, rule in
            Section {
                Picker(T("If the answer"), selection: ruleBinding(rule.id, \.op)) {
                    ForEach(FormBuilderVocab.operators, id: \.value) { o in Text(T(o.label)).tag(o.value) }
                }
                if FormBuilderVocab.needsValue(rule.op) {
                    if ownOptions.isEmpty {
                        TextField(T("Value"), text: ruleBinding(rule.id, \.value))
                    } else {
                        Picker(T("Value"), selection: ruleBinding(rule.id, \.value)) {
                            Text("—").tag("")
                            ForEach(ownOptions, id: \.self) { o in Text(o).tag(o) }
                            if !rule.value.isEmpty && !ownOptions.contains(rule.value) {
                                Text(rule.value).tag(rule.value)
                            }
                        }
                    }
                }
                Picker(T("Then"), selection: ruleBinding(rule.id, \.action)) {
                    ForEach(FormBuilderVocab.routingActions, id: \.value) { a in Text(T(a.label)).tag(a.value) }
                }
                if rule.action == "set_task_list" {
                    Picker(T("Section"), selection: ruleBinding(rule.id, \.targetTaskListId)) {
                        Text(T("Choose a section")).tag("")
                        ForEach(sections) { s in Text(s.name).tag(s.id) }
                        if !rule.targetTaskListId.isEmpty && !sections.contains(where: { $0.id == rule.targetTaskListId }) {
                            Text(T("A section that no longer exists")).tag(rule.targetTaskListId)
                        }
                    }
                } else {
                    Picker(T("Member"), selection: ruleBinding(rule.id, \.targetUserId)) {
                        Text(T("Choose a member")).tag("")
                        ForEach(members) { m in Text(m.displayName).tag(m.uid) }
                        if !rule.targetUserId.isEmpty && !members.contains(where: { $0.uid == rule.targetUserId }) {
                            Text(T("Someone no longer in this project")).tag(rule.targetUserId)
                        }
                    }
                }
                Button(role: .destructive) {
                    field.rules.removeAll { $0.id == rule.id }
                } label: {
                    Label(T("Delete rule"), systemImage: "trash")
                }
            } header: {
                Text(String(format: T("Rule %d"), i + 1))
            }
        }
    }

    private func ruleBinding(_ id: String, _ key: WritableKeyPath<BuilderRule, String>) -> Binding<String> {
        Binding(get: { field.rules.first(where: { $0.id == id })?[keyPath: key] ?? "" },
                set: { v in if let i = field.rules.firstIndex(where: { $0.id == id }) { field.rules[i][keyPath: key] = v } })
    }

    // MARK: mapping

    private var mappingSection: some View {
        Section {
            Picker(T("Map answer to"), selection: $field.mappingTarget) {
                ForEach(FormBuilderVocab.mappingTargets, id: \.value) { m in Text(T(m.label)).tag(m.value) }
                if !FormBuilderVocab.mappingTargets.contains(where: { $0.value == field.mappingTarget }) {
                    Text(field.mappingTarget).tag(field.mappingTarget)
                }
            }
            if field.mappingTarget == "custom_field" {
                Picker(T("Custom field"), selection: $field.mappingCustomFieldId) {
                    Text(T("Choose a custom field")).tag("")
                    ForEach(customFields) { c in Text(c.name).tag(c.id) }
                    if !field.mappingCustomFieldId.isEmpty && !customFields.contains(where: { $0.id == field.mappingCustomFieldId }) {
                        Text(T("A custom field that no longer exists")).tag(field.mappingCustomFieldId)
                    }
                }
            }
            if field.mappingTarget == "task_list" {
                if sections.isEmpty {
                    Label(T("This project has no sections yet. Add a section on the board first, then this mapping works."),
                          systemImage: "exclamationmark.triangle.fill")
                        .font(NXFont.text(13)).foregroundStyle(NX.warning)
                } else {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(T("Sections in this project")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                        Text(sections.map(\.name).joined(separator: " · ")).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                    }
                    if field.type == "dropdown" {
                        Button { field.options = sections.map(\.name) } label: {
                            Label(String(format: T("Use these %d sections as options"), sections.count), systemImage: "doc.on.doc")
                                .foregroundStyle(NX.violetText)
                        }
                    }
                }
            }
        } header: {
            Text(T("Task mapping"))
        } footer: {
            Text(mappingFooter)
        }
    }

    private var mappingFooter: String {
        switch field.mappingTarget {
        case "task_list":
            return T("The answer picks the section the task lands in, matched by section name — so the options must match the section names exactly. With no match, it goes to the first section.")
        case "custom_field":
            return T("The answer is written into this custom field on the new task.")
        case "none":
            return T("Every answer is listed on the task. Mapping also puts this one into a task field.")
        default:
            return T("The answer fills this field of the new task.")
        }
    }
}

/// How the field will look on the form — the web builder's live preview, drawn, not interactive.
private struct FormFieldPreview: View {
    let field: BuilderField

    private var options: [String] {
        field.options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if field.type == "checkbox" {
                HStack(spacing: 8) {
                    Image(systemName: "square").foregroundStyle(NX.mutedFg)
                    Text(field.displayName).font(NXFont.text(14)).foregroundStyle(NX.foreground)
                    if field.required { Text("*").foregroundStyle(NX.danger) }
                }
            } else {
                HStack(spacing: 2) {
                    Text(field.displayName).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    if field.required { Text("*").font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                }
                control
            }
            if field.attachmentEnabled && field.type != "file" {
                Label(T("Attach a file (optional)"), systemImage: "paperclip")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
        }
        .padding(.vertical, 4)
        .allowsHitTesting(false)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var control: some View {
        switch field.type {
        case "multi_select":
            VStack(alignment: .leading, spacing: 5) {
                ForEach(options.isEmpty ? [T("Option")] : options, id: \.self) { o in
                    HStack(spacing: 6) {
                        Image(systemName: "square").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
                        Text(o).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                    }
                }
            }
            .padding(10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
        case "dropdown", "select":
            box(options.first ?? T("Choose an option…"), icon: "chevron.down")
        case "file":
            box(T("Choose a file…"), icon: "paperclip", leading: true)
        case "textarea":
            box(T("Long text answer"), height: 64)
        case "email":
            box(field.autofill.isEmpty ? "email@example.com" : T("Filled from the account"))
        case "number":
            box(field.numberFormat == "currency-idr" ? "Rp 0" : "0")
        case "date":
            box(T("Pick a date"), icon: "calendar")
        default:
            box(field.autofill.isEmpty ? T("Short text answer") : T("Filled from the account"))
        }
    }

    private func box(_ placeholder: String, icon: String? = nil, leading: Bool = false, height: CGFloat = 36) -> some View {
        HStack(spacing: 6) {
            if leading, let icon { Image(systemName: icon).font(.system(size: 12)) }
            Text(placeholder).font(NXFont.text(13)).lineLimit(1)
            Spacer(minLength: 0)
            if !leading, let icon { Image(systemName: icon).font(.system(size: 12)) }
        }
        .foregroundStyle(NX.mutedFg)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: height, alignment: height > 40 ? .topLeading : .leading)
        .padding(.top, height > 40 ? 8 : 0)
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
    }
}

// MARK: - Duplicate to another project

/// The web's "Duplicate form": the builder's CURRENT fields (saved or not) into another project as
/// a new form. Routing rules and custom-field ids are left behind — they belong to this project.
struct FormDuplicateView: View {
    let sourceProjectId: String
    let initialName: String
    let description: String
    let fields: [BuilderField]
    let isPublic: Bool
    let requireAuth: Bool
    let accessSchedule: Any

    @Environment(AuthStore.self) private var auth
    @State private var newName: String
    @State private var projects: [Project] = []
    @State private var loading = true
    @State private var busyProjectId: String?
    @State private var done: String?
    @State private var problem: String?

    init(sourceProjectId: String, initialName: String, description: String, fields: [BuilderField],
         isPublic: Bool, requireAuth: Bool, accessSchedule: Any) {
        self.sourceProjectId = sourceProjectId
        self.initialName = initialName
        self.description = description
        self.fields = fields
        self.isPublic = isPublic
        self.requireAuth = requireAuth
        self.accessSchedule = accessSchedule
        _newName = State(initialValue: initialName)
    }

    private var targets: [Project] { projects.filter { $0.id != sourceProjectId } }

    var body: some View {
        Form {
            Section {
                TextField(T("New form name"), text: $newName)
            } header: {
                Text(T("Name"))
            } footer: {
                Text(T("Copies the fields as they are in the editor now. Submissions and tasks don't come along, and routing rules and custom-field links are cleared — set them up again in that project."))
            }
            if let done {
                Section {
                    Label(String(format: T("Copied to %@."), done), systemImage: "checkmark.circle.fill")
                        .font(NXFont.text(14, .semibold)).foregroundStyle(NX.success)
                }
            }
            if let problem {
                Section {
                    Text(problem).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                }
            }
            Section {
                if loading {
                    ProgressView().frame(maxWidth: .infinity)
                } else if targets.isEmpty {
                    EmptyState(icon: "folder", title: T("No other projects"),
                               subtitle: T("This is the only project you're in, so there's nowhere to copy the form to yet."),
                               compact: true)
                        .frame(maxWidth: .infinity)
                } else {
                    ForEach(targets) { p in
                        Button { Task { await duplicate(to: p) } } label: {
                            HStack(spacing: 10) {
                                ProjectMark(icon: p.icon, color: p.color, size: 22)
                                Text(p.name).font(NXFont.text(15)).foregroundStyle(NX.foreground).lineLimit(1)
                                Spacer(minLength: 4)
                                if busyProjectId == p.id { ProgressView().controlSize(.small) }
                            }
                        }
                        .disabled(busyProjectId != nil)
                    }
                }
            } header: {
                Text(T("Choose the target project"))
            }
        }
        .scrollContentBackground(.hidden)
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(T("Duplicate form"))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if projects.isEmpty {
                do { projects = try await APIClient.shared.projects() }
                catch APIError.unauthorized { auth.logout() }
                catch let failure { problem = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't load projects.") }
                loading = false
            }
        }
    }

    private func duplicate(to p: Project) async {
        busyProjectId = p.id
        problem = nil
        defer { busyProjectId = nil }
        let typed = newName.trimmingCharacters(in: .whitespacesAndNewlines)
        let fallback = initialName.trimmingCharacters(in: .whitespacesAndNewlines)
        let payload: [String: Any] = [
            "name": !typed.isEmpty ? typed : (!fallback.isEmpty ? fallback : "Form"),
            "description": jsonOrNull(description.isEmpty ? nil : description),
            "fields": fields.map { $0.duplicateJSON() },
            "isPublic": isPublic,
            "requireAuth": requireAuth,
            "projectId": p.id,
            "accessSchedule": accessSchedule,
        ]
        do {
            _ = try await APIClient.shared.createForm(payload)
            done = p.name
            NotificationCenter.default.post(name: .nexusFormsChanged, object: nil)
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            problem = String(format: T("Couldn't duplicate: %@"), (failure as? LocalizedError)?.errorDescription ?? T("try again."))
        }
    }
}

// MARK: - New form from the Forms page

/// The Forms page lists forms from every project, so New form there starts by asking which project
/// the form belongs to — the web's project filter next to its New form button.
struct FormProjectPickerView: View {
    @Environment(AuthStore.self) private var auth
    @State private var projects: [Project] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        Group {
            if loading && projects.isEmpty {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let error, projects.isEmpty {
                ErrorState(message: error, icon: "folder") { Task { await load() } }
            } else if projects.isEmpty {
                ScrollView {
                    EmptyState(icon: "folder", title: T("No projects yet"),
                               subtitle: T("A form belongs to a project — every submission becomes one of its tasks. Join or create a project first."))
                        .padding(.horizontal, 24).padding(.top, 48)
                }
            } else {
                List {
                    Section {
                        ForEach(projects) { p in
                            NavigationLink {
                                FormBuilderView(projectId: p.id, projectName: p.name, formId: nil)
                            } label: {
                                HStack(spacing: 10) {
                                    ProjectMark(icon: p.icon, color: p.color, size: 22)
                                    Text(p.name).font(NXFont.text(15)).foregroundStyle(NX.foreground).lineLimit(1)
                                }
                            }
                        }
                    } footer: {
                        Text(T("Each submission to the form becomes a task in the project you pick."))
                    }
                }
                .listStyle(.insetGrouped)
                .scrollContentBackground(.hidden)
            }
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(T("New form in…"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do {
            projects = try await APIClient.shared.projects()
            error = nil
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            error = (failure as? LocalizedError)?.errorDescription ?? T("Couldn't load projects.")
        }
        loading = false
    }
}
