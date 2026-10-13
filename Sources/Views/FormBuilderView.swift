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
    /// Can edit and up build forms (server: MEMBER). Can view / Can comment get the list to fill in only
    /// (access levels round 2): no New form, no builder, no publish.
    var canEdit = true

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
                           actionTitle: canEdit ? T("New form") : nil, actionIcon: "plus", action: canEdit ? onNewForm : nil)
                    .padding(.horizontal, 24).padding(.top, 48)
            }
            .refreshable { await load() }
        } else {
            List {
                if canEdit {
                    Section {
                        Button(action: onNewForm) {
                            Label(T("New form"), systemImage: "plus.circle.fill")
                                .font(NXFont.text(15, .semibold)).foregroundStyle(NX.violetText)
                        }
                    } footer: {
                        Text(T("Tap a form to edit it. Touch and hold it to fill it in, copy or share its link, or publish it."))
                    }
                }
                Section {
                    ForEach(forms) { f in
                        NavigationLink {
                            if canEdit {
                                FormBuilderView(projectId: projectId, projectName: projectName, formId: f.id)
                            } else {
                                FormFillView(formId: f.id, title: f.name)
                            }
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
            if canEdit {
                Button { Task { await setPublic(f, false) } } label: { Label(T("Unpublish"), systemImage: "eye.slash") }
            }
        } else if canEdit {
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

// MARK: - Builder (the studio)

/// New form / Edit form — the dev web's form studio (FormStudio.tsx, 12–13 Oct 2026). Tabs Questions ·
/// Settings · Share · Responses; the Questions tab is a page-like canvas of question cards, with the
/// selected question's settings in a side panel on iPad and Mac, and pushed on iPhone.
///
/// Changes save themselves, like the web: 700 ms after the last edit, one save at a time (an edit made
/// during a save is sent right after it), and once more on the way out. A new form is created by its
/// first edit — nothing is created for a builder opened and left untouched.
struct FormBuilderView: View {
    let projectId: String
    let projectName: String
    /// nil = a new form.
    let formId: String?

    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var hSize

    /// The form as the server last returned it; nil until a new form is created.
    @State private var saved: BuilderForm?
    @State private var loaded = false
    @State private var loadError: String?

    @State private var draft = FormStudioDraft.blank()
    /// What the server has: the loaded form, the last saved draft, or — for a form not created yet —
    /// the untouched starting draft. Autosave sends whenever `draft` differs from it.
    @State private var baseline: FormStudioDraft?
    @State private var saveState: FormSaveState = .idle
    @State private var debounce: Task<Void, Never>?
    @State private var inflight = false
    @State private var again = false
    /// A forced save (Preview) asked for while another was in flight.
    @State private var againForce = false
    /// Deleted or discarded: nothing more is saved.
    @State private var stopped = false
    @State private var responseCount = 0

    // Routing and mapping pick from these, exactly as the web's editor does.
    @State private var sections: [ProjectDetail.Lane] = []
    @State private var members: [ProjectDetail.ProjectMember] = []
    @State private var customFields: [CustomField] = []

    @State private var tab: FormStudioTab = .questions
    /// Regular width: the question whose settings fill the side panel.
    @State private var selectedId: String?
    /// Compact width: the question whose settings screen is pushed.
    @State private var openFieldId: String?
    @State private var showDuplicate = false
    @State private var showPreview = false
    @State private var showFill = false
    @State private var deleting = false
    @State private var alert: BuilderAlert?
    @State private var undo: DeletedQuestion?

    private enum BuilderAlert: Equatable {
        case delete(submissions: Int)
        case forceDelete(submissions: Int)
        case failed(title: String, message: String)
    }

    /// A deleted question and the conditions that read it, for Undo.
    private struct DeletedQuestion: Equatable {
        let field: BuilderField
        let index: Int
        let dependents: [String: BuilderCondition]
    }

    private var regular: Bool { hSize == .regular }
    private var currentId: String? { saved?.id ?? formId }
    private var shareURL: URL? { saved?.publicURL }
    private var displayName: String {
        let n = draft.name.trimmingCharacters(in: .whitespacesAndNewlines)
        return n.isEmpty ? T("Untitled form") : n
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
                studio
            }
        }
        .background(NX.background.ignoresSafeArea())
        // Regular width: the breadcrumb and the tabs are the bar; the system Back stays.
        .navigationTitle(regular ? "" : displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        // Once: coming back from a pushed screen must not reload over the edits.
        .task { if !loaded { await load() } }
        .onChange(of: draft) { _, _ in scheduleSave() }
        .onAppear { scheduleSave() }
        .onDisappear { leaving() }
        .navigationDestination(item: $openFieldId) { id in fieldEditor(id, embedded: false) }
        .navigationDestination(isPresented: $showDuplicate) {
            FormDuplicateView(sourceProjectId: projectId, initialName: draft.name, description: draft.description,
                              fields: draft.fields, isPublic: draft.isPublic, requireAuth: draft.requireAuth,
                              accessSchedule: duplicateSchedule, branding: draft.branding.json, settings: draft.settings.duplicateJSON)
        }
        .navigationDestination(isPresented: $showPreview) {
            FormFillView(formId: currentId ?? "", title: displayName, preview: true)
        }
        .navigationDestination(isPresented: $showFill) {
            FormFillView(formId: currentId ?? "", title: displayName)
        }
        .alert(alertTitle, isPresented: Binding(get: { alert != nil }, set: { if !$0 { alert = nil } }), presenting: alert) { a in
            alertButtons(a)
        } message: { a in
            Text(alertMessage(a))
        }
    }

    // MARK: top bar

    @ToolbarContentBuilder private var toolbarContent: some ToolbarContent {
        if loaded && loadError == nil {
            if regular {
                ToolbarItem(placement: .topBarLeading) { breadcrumb }
                ToolbarItem(placement: .principal) {
                    FormStudioTabBar(selection: $tab, responseCount: responseCount)
                }
            }
            ToolbarItemGroup(placement: .topBarTrailing) {
                FormSaveIndicator(state: saveState, hasId: currentId != nil, compact: !regular) { retry() }
                previewButton
                moreMenu
            }
        }
    }

    private var breadcrumb: some View {
        HStack(spacing: 6) {
            if !projectName.isEmpty {
                Text(projectName).foregroundStyle(NX.mutedFg).lineLimit(1)
                Text("/").foregroundStyle(NX.mutedFg.opacity(0.6))
            }
            Text(draft.branding.icon.isEmpty ? displayName : "\(draft.branding.icon) \(displayName)")
                .fontWeight(.medium).foregroundStyle(NX.foreground).lineLimit(1)
        }
        .font(NXFont.text(14))
        .frame(maxWidth: 360, alignment: .leading)
    }

    @ViewBuilder private var previewButton: some View {
        if regular {
            Button { Task { await openPreview() } } label: { Label(T("Preview"), systemImage: "eye").labelStyle(.titleAndIcon) }
                .buttonStyle(NXButtonStyle(kind: .bordered, compact: true))
        } else {
            Button { Task { await openPreview() } } label: { Label(T("Preview"), systemImage: "eye") }
        }
    }

    private var moreMenu: some View {
        Menu {
            if currentId != nil {
                Button { Task { await flush(); showFill = true } } label: {
                    Label(T("Open the form page"), systemImage: "arrow.up.right.square")
                }
                Button { showDuplicate = true } label: {
                    Label(T("Duplicate to another project"), systemImage: "plus.square.on.square")
                }
            }
            Divider()
            Button(role: .destructive) { Task { await askDelete() } } label: {
                Label(currentId != nil ? T("Delete form") : T("Discard draft"), systemImage: "trash")
            }
            .disabled(deleting)
        } label: {
            Image(systemName: "ellipsis").font(.system(size: 15, weight: .medium))
                .frame(width: 30, height: 30).contentShape(Rectangle())
        }
        .accessibilityLabel(T("More"))
    }

    // MARK: body

    private var tabItems: [NXTabItem<FormStudioTab>] {
        FormStudioTab.allCases.map { t in
            NXTabItem(id: t, label: t.label, count: t == .responses && responseCount > 0 ? responseCount : nil)
        }
    }

    private var studio: some View {
        VStack(spacing: 0) {
            if !regular {
                NXUnderlineTabs(items: tabItems, selection: $tab, accessibilityName: T("Form builder"))
            } else {
                Rectangle().fill(NX.border).frame(height: 1)
            }
            tabContent
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .overlay(alignment: .bottom) { undoToast }
    }

    @ViewBuilder private var tabContent: some View {
        switch tab {
        case .questions:
            questionsTab
        case .settings:
            ScrollView {
                FormStudioSettingsTab(draft: $draft, projectName: projectName, members: members,
                                      responseCount: responseCount, regular: regular)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(NX.muted.opacity(0.25))
        case .share:
            ScrollView {
                FormStudioShareTab(url: shareURL, isPublic: draft.isPublic, regular: regular,
                                   onOpen: { Task { await flush(); showFill = true } },
                                   onGoSettings: { tab = .settings })
            }
            .background(NX.muted.opacity(0.25))
        case .responses:
            if let id = currentId {
                FormResponsesView(formId: id, projectId: projectId, embedded: true) { n in responseCount = n }
                    .frame(maxWidth: regular ? 820 : .infinity)
                    .frame(maxWidth: .infinity)
            } else {
                ScrollView {
                    EmptyState(icon: "tray", title: T("No responses yet"),
                               subtitle: T("Share the link from the Share tab. Each answer arrives here and on the project board as a task."))
                        .padding(.horizontal, 24).padding(.top, 64)
                }
            }
        }
    }

    // MARK: questions

    /// Regular width: the canvas and a fixed settings panel side by side (each scrolls on its own, one
    /// axis). Compact: the canvas only; a question's settings are pushed.
    @ViewBuilder private var questionsTab: some View {
        if regular {
            HStack(spacing: 0) {
                canvas
                Rectangle().fill(NX.border).frame(width: 1)
                panel
                    .frame(width: 340)
                    .frame(maxHeight: .infinity, alignment: .top)
                    .background(NX.background)
            }
        } else {
            canvas
        }
    }

    private var canvas: some View {
        ScrollView {
            VStack(spacing: 0) {
                FormCoverBand(cover: draft.branding.cover, height: regular ? 176 : 128)
                VStack(alignment: .leading, spacing: 0) {
                    FormStudioHead(name: $draft.name, description: $draft.description, branding: $draft.branding,
                                   isPublic: draft.isPublic, large: regular, onChangeAccess: { tab = .settings })
                    questionList.padding(.top, 28)
                }
                .frame(maxWidth: 720, alignment: .leading)
                .padding(.horizontal, regular ? 40 : 16)
                .padding(.bottom, 120)
                .frame(maxWidth: .infinity)
            }
            // A click on the page around the questions closes the panel's selection, as on the web.
            .background {
                Color.clear.contentShape(Rectangle()).onTapGesture { selectedId = nil }
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private var questionList: some View {
        VStack(alignment: .leading, spacing: 16) {
            ForEach(Array(draft.fields.enumerated()), id: \.element.id) { i, f in
                questionCard(f, index: i)
            }
            if draft.fields.isEmpty {
                Text(T("No questions yet. Add the first one below."))
                    .font(NXFont.text(15)).foregroundStyle(NX.mutedFg)
            }
            FormAddQuestionMenu { kind in add(kind) }
                .padding(.leading, -10)
        }
    }

    private func questionCard(_ f: BuilderField, index i: Int) -> some View {
        let id = f.id
        return FormQuestionCard(field: fieldBinding(id), index: i, selected: regular && selectedId == id,
                                others: draft.fields.filter { $0.id != id },
                                customFields: customFields, sections: sections, compact: !regular,
                                onSelect: { select(id) },
                                onOpenSettings: { openFieldId = id },
                                onDuplicate: { duplicate(id) },
                                onDelete: { remove(id) })
    }

    @ViewBuilder private var panel: some View {
        if let id = selectedId, draft.fields.contains(where: { $0.id == id }) {
            fieldEditor(id, embedded: true)
                .id(id)
        } else {
            ScrollView { FormPanelHint() }
        }
    }

    private func fieldEditor(_ id: String, embedded: Bool) -> some View {
        let index = draft.fields.firstIndex(where: { $0.id == id }) ?? 0
        return FormFieldEditorView(field: fieldBinding(id),
                                   others: draft.fields.filter { $0.id != id },
                                   allFields: draft.fields,
                                   sections: sections, members: members, customFields: customFields,
                                   onDelete: { remove(id) },
                                   index: index, total: draft.fields.count, embedded: embedded,
                                   onMove: { dir in move(id, dir) },
                                   onDuplicate: { duplicate(id) })
    }

    /// By id, never by index: a question can be deleted or moved while its settings are open.
    private func fieldBinding(_ id: String) -> Binding<BuilderField> {
        Binding(get: { draft.fields.first(where: { $0.id == id }) ?? BuilderField(raw: ["id": .string(id)]) },
                set: { new in if let i = draft.fields.firstIndex(where: { $0.id == id }) { draft.fields[i] = new } })
    }

    private func select(_ id: String) {
        if regular { selectedId = id } else { openFieldId = id }
    }

    private func add(_ kind: FormQuestionKind) {
        let q = BuilderField.fresh(kind: kind)
        draft.fields.append(q)
        select(q.id)
    }

    private func duplicate(_ id: String) {
        guard let i = draft.fields.firstIndex(where: { $0.id == id }) else { return }
        let copy = draft.fields[i].duplicated()
        draft.fields.insert(copy, at: i + 1)
        if regular { selectedId = copy.id }
    }

    private func move(_ id: String, _ dir: Int) {
        guard let i = draft.fields.firstIndex(where: { $0.id == id }) else { return }
        let j = i + dir
        guard j >= 0, j < draft.fields.count else { return }
        draft.fields.swapAt(i, j)
    }

    /// Questions shown only after this one would never show again (their condition reads a missing
    /// answer), so their condition goes with it; Undo puts both back.
    private func remove(_ id: String) {
        guard let i = draft.fields.firstIndex(where: { $0.id == id }) else { return }
        let gone = draft.fields[i]
        var dependents: [String: BuilderCondition] = [:]
        for f in draft.fields where f.showIf?.fieldId == id { dependents[f.id] = f.showIf }
        var next = draft.fields
        next.remove(at: i)
        for k in next.indices where dependents[next[k].id] != nil { next[k].showIf = nil }
        draft.fields = next
        if selectedId == id { selectedId = nil }
        let u = DeletedQuestion(field: gone, index: i, dependents: dependents)
        withAnimation(.snappy) { undo = u }
        Task {
            try? await Task.sleep(nanoseconds: 6_000_000_000)
            withAnimation(.snappy) { if undo == u { undo = nil } }
        }
    }

    private func restore(_ u: DeletedQuestion) {
        var next = draft.fields
        for k in next.indices where next[k].showIf == nil {
            if let c = u.dependents[next[k].id] { next[k].showIf = c }
        }
        next.insert(u.field, at: min(u.index, next.count))
        draft.fields = next
        withAnimation(.snappy) { undo = nil }
    }

    @ViewBuilder private var undoToast: some View {
        if let u = undo {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Question deleted")).font(NXFont.text(14, .semibold))
                    if !u.dependents.isEmpty {
                        Text(u.dependents.count == 1 ? T("1 question was shown only after it; it now always shows.")
                             : String(format: T("%d questions were shown only after it; they now always show."), u.dependents.count))
                            .font(NXFont.text(12)).opacity(0.8)
                    }
                }
                Button(T("Undo")) { restore(u) }
                    .font(NXFont.text(14, .semibold))
                    .buttonStyle(.plain)
            }
            .foregroundStyle(NX.background)
            .padding(.horizontal, 16).padding(.vertical, 11)
            .background(NX.onyx, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .padding(.bottom, 20)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    // MARK: alert

    private var alertTitle: String {
        switch alert {
        case .delete, .forceDelete: return T("Delete this form?")
        case .failed(let title, _): return title
        case nil: return ""
        }
    }

    @ViewBuilder private func alertButtons(_ a: BuilderAlert) -> some View {
        switch a {
        case .delete(let n):
            Button(T("Delete form"), role: .destructive) { Task { await delete(force: n > 0, expect: n) } }
            Button(T("Cancel"), role: .cancel) {}
        case .forceDelete(let n):
            Button(T("Delete anyway"), role: .destructive) { Task { await delete(force: true, expect: n) } }
            Button(T("Cancel"), role: .cancel) {}
        case .failed:
            Button(T("OK"), role: .cancel) {}
        }
    }

    private func alertMessage(_ a: BuilderAlert) -> String {
        switch a {
        case .delete(let n), .forceDelete(let n):
            var text = ""
            if case .forceDelete = a { text = T("New responses came in while you were here.") + " " }
            if n == 0 { return text + T("The link stops working. Control Room → Audit can restore it.") }
            let count = n == 1 ? T("This form has 1 submission.") : String(format: T("This form has %d submissions."), n)
            return text + count + " " + T("Their tasks stay on the board, but the responses leave their senders' My Submissions. The link stops working. Control Room → Audit can restore the form with its responses.")
        case .failed(_, let message):
            return message
        }
    }

    // MARK: load

    private func load() async {
        loadError = nil
        async let detailCall = APIClient.shared.project(projectId)
        async let customFieldsCall = APIClient.shared.projectCustomFields(projectId)
        if let formId {
            do {
                let all = try await APIClient.shared.builderForms(projectId: projectId)
                if let f = all.first(where: { $0.id == formId }) {
                    saved = f
                    responseCount = f.submissionCount
                    let d = FormStudioDraft(form: f)
                    draft = d
                    baseline = d
                    saveState = .saved
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
            let d = FormStudioDraft.blank()
            draft = d
            baseline = d
        }
        let detail = try? await detailCall
        sections = detail?.taskLists ?? []
        members = (detail?.members ?? []).filter { !$0.uid.isEmpty }
        customFields = (try? await customFieldsCall) ?? []
        loaded = true
    }

    // MARK: autosave

    private func scheduleSave() {
        guard loaded, loadError == nil, !stopped, let base = baseline else { return }
        debounce?.cancel()
        guard draft != base else {
            if saveState == .pending { saveState = currentId == nil ? .idle : .saved }
            return
        }
        if !inflight { saveState = .pending }
        debounce = Task {
            try? await Task.sleep(nanoseconds: 700_000_000)
            if Task.isCancelled { return }
            await flush()
        }
    }

    /// One save at a time; an edit made meanwhile goes right after. `force` creates a new form even
    /// when nothing was typed yet (Preview needs a form to open).
    private func flush(force: Bool = false) async {
        guard !stopped, let base = baseline else { return }
        if inflight { again = true; againForce = againForce || force; return }
        let snapshot = draft
        guard snapshot != base || (force && currentId == nil) else { return }
        let creating = currentId == nil
        var requestBody = payload(snapshot, base: base, creating: creating)
        inflight = true
        saveState = .saving
        do {
            let out: BuilderForm
            if let id = currentId {
                out = try await APIClient.shared.updateForm(id, requestBody)
            } else {
                requestBody["projectId"] = projectId
                out = try await APIClient.shared.createForm(requestBody)
            }
            inflight = false
            if stopped && creating {
                // Discarded while it was being created: don't leave it behind.
                try? await APIClient.shared.deleteForm(out.id, force: false)
                return
            }
            saved = out
            baseline = snapshot
            if creating { NotificationCenter.default.post(name: .nexusFormsChanged, object: nil) }
            if draft != snapshot { saveState = .pending; scheduleSave() } else { saveState = .saved }
        } catch APIError.unauthorized {
            inflight = false
            auth.logout()
            return
        } catch let failure {
            inflight = false
            saveState = .failed((failure as? LocalizedError)?.errorDescription ?? T("Try again in a moment."))
        }
        if again {
            let forced = againForce
            again = false
            againForce = false
            await flush(force: forced)
        }
    }

    /// The web's body. Name, description, questions and access always; the schedule, branding and
    /// settings only when they changed (the route writes only the keys it is sent), or all of them for
    /// a new form.
    private func payload(_ d: FormStudioDraft, base: FormStudioDraft, creating: Bool) -> [String: Any] {
        let trimmed = d.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let desc = d.description.trimmingCharacters(in: .whitespacesAndNewlines)
        var p: [String: Any] = [
            "name": trimmed.isEmpty ? T("Untitled form") : trimmed,
            "description": desc.isEmpty ? NSNull() : d.description,
            "fields": d.fields.map { $0.cleanJSON() },
            "isPublic": d.isPublic,
            "requireAuth": d.requireAuth,
        ]
        if creating {
            p["accessSchedule"] = d.schedule == base.schedule ? NSNull() : d.schedule.json
        } else if d.schedule != base.schedule {
            p["accessSchedule"] = d.schedule.json
        }
        if creating || d.branding != base.branding { p["branding"] = d.branding.json }
        if creating || d.settings != base.settings { p["settings"] = d.settings.json }
        return p
    }

    /// What a duplicate takes as `accessSchedule`: the stored value while the schedule is untouched
    /// (null for a form that never had one), the full schedule once it was edited.
    private var duplicateSchedule: Any {
        if draft.schedule != BuilderSchedule(raw: saved?.accessSchedule) { return draft.schedule.json }
        return saved?.accessSchedule?.any ?? NSNull()
    }

    private func retry() {
        saveState = .pending
        Task { await flush() }
    }

    /// Leaving — or a screen pushed on top: what was typed inside the debounce is saved now instead of dropped.
    private func leaving() {
        debounce?.cancel()
        guard !stopped, let base = baseline, draft != base else { return }
        Task {
            await flush()
            NotificationCenter.default.post(name: .nexusFormsChanged, object: nil)
        }
    }

    /// Preview shows the saved form as people see it, so what was typed is saved first.
    private func openPreview() async {
        debounce?.cancel()
        // A save already on its way (e.g. the first create): wait for it, then save what's left.
        var waited = 0
        while inflight && waited < 50 { try? await Task.sleep(nanoseconds: 100_000_000); waited += 1 }
        await flush(force: true)
        if currentId != nil && !saveState.isFailed { showPreview = true }
    }

    // MARK: delete

    /// The count shown in the dialog is read again first: the builder may have been open for a while.
    private func askDelete() async {
        guard let id = currentId else {
            stopped = true
            debounce?.cancel()
            dismiss()
            return
        }
        if let all = try? await APIClient.shared.builderForms(projectId: projectId),
           let f = all.first(where: { $0.id == id }) {
            responseCount = f.submissionCount
        }
        alert = .delete(submissions: responseCount)
    }

    /// No submissions → a plain delete, and if somebody submitted in the meantime the server's 409
    /// asks again with the count. With submissions → the person saw the count, so force with it.
    private func delete(force: Bool, expect: Int) async {
        guard let id = currentId, !deleting else { return }
        deleting = true
        stopped = true
        debounce?.cancel()
        defer { deleting = false }
        do {
            try await APIClient.shared.deleteForm(id, force: force, expect: expect)
            // Leave first, then tell the lists: a list that reloaded first would drop the row this
            // screen was pushed from while it is still on top, and the pop that follows would then
            // take the screen underneath with it.
            dismiss()
            NotificationCenter.default.post(name: .nexusFormsChanged, object: nil)
        } catch FormBuilderError.hasSubmissions(let count, _) {
            stopped = false
            responseCount = count
            alert = .forceDelete(submissions: count)
        } catch APIError.unauthorized {
            auth.logout()
        } catch let failure {
            stopped = false
            alert = .failed(title: T("Couldn't delete the form"),
                            message: (failure as? LocalizedError)?.errorDescription ?? T("Try again in a moment."))
        }
    }
}

// MARK: - One question's settings

/// Everything about one question — the web's QuestionPanel: type, options, logic, where the answer goes,
/// routing, and moving it. Embedded in the studio's side panel on iPad and Mac, pushed on iPhone.
/// Edits go straight into the builder's draft, which saves itself.
struct FormFieldEditorView: View {
    @Binding var field: BuilderField
    let others: [BuilderField]
    /// Every question, this one included — to keep "Show only when" from making a loop.
    var allFields: [BuilderField] = []
    let sections: [ProjectDetail.Lane]
    let members: [ProjectDetail.ProjectMember]
    let customFields: [CustomField]
    let onDelete: () -> Void
    var index = 0
    var total = 1
    /// In the side panel: no navigation title, no preview (the card is the preview), delete at once.
    var embedded = false
    var onMove: ((Int) -> Void)? = nil
    var onDuplicate: (() -> Void)? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var editMode: EditMode = .inactive
    /// Removed only once this screen has gone: removing it while it is on top would pull the row
    /// that pushed it out from under the navigation.
    @State private var deleteOnLeave = false

    var body: some View {
        Form {
            basicsSection
            optionToggles
            if field.hasOptions && !embedded { optionsSection }
            branchingSection
            mappingSection
            routingSections
            if !embedded {
                Section {
                    FormFieldPreview(field: field)
                } header: {
                    Text(T("Preview"))
                }
            }
            questionSection
        }
        .environment(\.editMode, $editMode)
        .scrollContentBackground(.hidden)
        .background(NX.background.ignoresSafeArea())
        .modifier(FieldEditorTitle(title: field.displayName, on: !embedded))
        .onDisappear { if deleteOnLeave { onDelete() } }
    }

    // MARK: basics

    private var basicsSection: some View {
        Section {
            TextField(T("Question"), text: nameBinding, axis: .vertical)
                .font(NXFont.text(16, .semibold))
            Picker(T("Type"), selection: kindBinding) {
                ForEach(FormQuestionKind.allCases) { k in
                    Label(k.label, systemImage: k.icon).tag(k)
                }
            }
        } header: {
            Text(String(format: T("Question %d"), index + 1))
        }
    }

    /// The web writes the name to both `name` and `label`.
    private var nameBinding: Binding<String> {
        Binding(get: { field.name }, set: { v in
            let one = v.replacingOccurrences(of: "\n", with: " ")
            field.name = one
            field.label = one
        })
    }

    private var kindBinding: Binding<FormQuestionKind> {
        Binding(get: { field.questionKind }, set: { field.applyKind($0) })
    }

    // MARK: options (the toggles)

    private var optionToggles: some View {
        Section {
            Toggle(T("Required"), isOn: $field.required).tint(NX.onyx)
            Toggle(isOn: descriptionOn) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(T("Description"))
                    Text(T("Helper text under the question")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
            }
            .tint(NX.onyx)
            if field.description != nil {
                TextField(T("Description (optional)"), text: Binding(get: { field.description ?? "" }, set: { field.description = $0 }), axis: .vertical)
                    .font(NXFont.text(14))
            }
            if field.type == "dropdown" {
                Toggle(isOn: Binding(get: { field.display == "list" }, set: { field.display = $0 ? "list" : "" })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(T("Show options as a list"))
                        Text(T("On the web form. The apps show a menu.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    }
                }
                .tint(NX.onyx)
            }
            if field.type == "number" {
                Toggle(isOn: Binding(get: { field.questionKind == .rupiah }, set: { field.applyKind($0 ? .rupiah : .number) })) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(T("Rupiah amount"))
                        Text("Rp 1.500.000").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    }
                }
                .tint(NX.onyx)
            }
            if field.type == "text" || field.type == "email" {
                Picker(T("Fill from the sender's account"), selection: $field.autofill) {
                    Text(T("Off")).tag("")
                    Text(T("Name")).tag("name")
                    Text(T("Email")).tag("email")
                }
            }
            if field.type != "file" {
                Toggle(isOn: $field.attachmentEnabled) {
                    Label(T("Allow a file with the answer"), systemImage: "paperclip")
                }
                .tint(NX.onyx)
            }
        } header: {
            Text(T("Options"))
        } footer: {
            if !field.autofill.isEmpty {
                Text(T("The person doesn't type it — it's filled from their account and locked."))
            }
        }
    }

    private var descriptionOn: Binding<Bool> {
        Binding(get: { field.description != nil }, set: { field.description = $0 ? (field.description ?? "") : nil })
    }

    // MARK: options (the list, pushed screen only — the card edits them in place)

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
                Text(T("Answer options"))
                Spacer()
                if field.options.count > 1 {
                    EditButton().font(NXFont.text(13, .semibold)).textCase(nil)
                }
            }
        } footer: {
            Text(T("Blank options are dropped when the form saves."))
        }
    }

    private func optionBinding(_ i: Int) -> Binding<String> {
        Binding(get: { i < field.options.count ? field.options[i] : "" },
                set: { v in if i < field.options.count { field.options[i] = v } })
    }

    private var ownOptions: [String] {
        field.options.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
    }

    // MARK: logic (showIf)

    /// Questions this one may depend on: not those already shown only because of it.
    private var parents: [BuilderField] {
        let everything = allFields.isEmpty ? [field] + others : allFields
        return FormStudioLogic.logicParents(everything, selfId: field.id)
    }

    /// The closest question above with options, else the one above, else the first allowed.
    private var defaultParent: BuilderField? {
        let everything = allFields.isEmpty ? [field] + others : allFields
        let myIndex = everything.firstIndex(where: { $0.id == field.id }) ?? everything.count
        let above = parents.filter { p in (everything.firstIndex(where: { $0.id == p.id }) ?? 0) < myIndex }
        return above.last(where: { $0.hasOptions }) ?? above.last ?? parents.first
    }

    private var branchingSection: some View {
        Section {
            Toggle(T("Show only when…"), isOn: showIfOn)
                .tint(NX.onyx)
                .disabled(field.showIf == nil && parents.isEmpty)
            if let cond = field.showIf {
                let parent = others.first(where: { $0.id == cond.fieldId })
                Picker(T("Question"), selection: condBinding(\.fieldId, resetsValue: true)) {
                    if parent == nil {
                        Text(parents.isEmpty ? T("No other questions") : T("Choose a question")).tag(cond.fieldId)
                    }
                    ForEach(parents) { o in Text(o.displayName).tag(o.id) }
                    if let parent, !parents.contains(where: { $0.id == parent.id }) {
                        Text(parent.displayName).tag(parent.id)
                    }
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
                logicWarnings(cond, parent: parent)
            }
        } header: {
            Text(T("Logic"))
        } footer: {
            Text(parents.isEmpty && field.showIf == nil ? T("Add another question first.")
                 : T("While the condition isn't met, the question is hidden and isn't required."))
        }
    }

    @ViewBuilder private func logicWarnings(_ cond: BuilderCondition, parent: BuilderField?) -> some View {
        if FormBuilderVocab.needsValue(cond.op) && cond.value.trimmingCharacters(in: .whitespaces).isEmpty {
            Text(T("Pick a value. Until then the question always shows."))
                .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
        }
        if let parent, FormStudioLogic.staleOption(parent, op: cond.op, value: cond.value) {
            Label(String(format: T("“%@” is no longer an option, so this question never shows. Pick a value again."), cond.value),
                  systemImage: "exclamationmark.circle")
                .font(NXFont.text(13, .medium)).foregroundStyle(NX.warning)
        }
        if let parent, !parents.contains(where: { $0.id == parent.id }) {
            Label(String(format: T("“%@” is itself shown only after this question, so neither can ever show. Pick another question."), parent.displayName),
                  systemImage: "exclamationmark.circle")
                .font(NXFont.text(13, .medium)).foregroundStyle(NX.warning)
        }
    }

    private var showIfOn: Binding<Bool> {
        Binding(get: { field.showIf != nil }, set: { on in
            if !on { field.showIf = nil }
            else if let p = defaultParent { field.showIf = BuilderCondition(fieldId: p.id, op: "equals", value: "") }
        })
    }

    /// Picking another question clears the value, as the web does: the old value was one of the
    /// previous question's options.
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

    private var settableFields: [CustomField] {
        customFields.filter { FormBuilderVocab.settableFieldTypes.contains($0.type.uppercased()) }
    }

    @ViewBuilder private var routingSections: some View {
        Section {
            if field.rules.isEmpty {
                Text(T("When this answer matches, assign someone, set a field or move the task to a section."))
                    .font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            }
            Button { field.rules.append(BuilderRule.fresh()) } label: {
                Label(T("Add rule"), systemImage: "plus.circle").foregroundStyle(NX.violetText)
            }
        } header: {
            Text(T("Routing"))
        }
        ForEach(Array(field.rules.enumerated()), id: \.element.id) { i, rule in
            ruleSection(rule, number: i + 1)
        }
    }

    private func ruleSection(_ rule: BuilderRule, number: Int) -> some View {
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
            if FormStudioLogic.staleOption(field, op: rule.op, value: rule.value) {
                Label(String(format: T("“%@” is no longer an option, so this rule never runs. Pick a value again."), rule.value),
                      systemImage: "exclamationmark.circle")
                    .font(NXFont.text(13, .medium)).foregroundStyle(NX.warning)
            }
            Picker(T("Then"), selection: ruleBinding(rule.id, \.action)) {
                ForEach(FormBuilderVocab.routingActions, id: \.value) { a in Text(T(a.label)).tag(a.value) }
                if !FormBuilderVocab.routingActions.contains(where: { $0.value == rule.action }) {
                    Text(rule.action).tag(rule.action)
                }
            }
            ruleTarget(rule)
            Button(role: .destructive) {
                field.rules.removeAll { $0.id == rule.id }
            } label: {
                Label(T("Delete rule"), systemImage: "trash")
            }
        } header: {
            Text(String(format: T("Rule %d"), number))
        }
    }

    @ViewBuilder private func ruleTarget(_ rule: BuilderRule) -> some View {
        if rule.action == "set_task_list" {
            Picker(T("Section"), selection: ruleBinding(rule.id, \.targetTaskListId)) {
                Text(T("Choose a section")).tag("")
                ForEach(sections) { s in Text(s.name).tag(s.id) }
                if !rule.targetTaskListId.isEmpty && !sections.contains(where: { $0.id == rule.targetTaskListId }) {
                    Text(T("A section that no longer exists")).tag(rule.targetTaskListId)
                }
            }
        } else if rule.action == "set_field" {
            Picker(T("Field"), selection: ruleFieldBinding(rule.id)) {
                Text(T("Choose a field")).tag("")
                ForEach(settableFields) { c in Text(c.name).tag(c.id) }
                if !rule.targetCustomFieldId.isEmpty && !settableFields.contains(where: { $0.id == rule.targetCustomFieldId }) {
                    Text(T("A custom field that no longer exists")).tag(rule.targetCustomFieldId)
                }
            }
            if let target = settableFields.first(where: { $0.id == rule.targetCustomFieldId }) {
                let choices = target.choices
                if choices.isEmpty {
                    TextField(T("Value"), text: ruleBinding(rule.id, \.targetValue))
                } else {
                    Picker(T("Value"), selection: ruleBinding(rule.id, \.targetValue)) {
                        Text("—").tag("")
                        ForEach(choices, id: \.self) { o in Text(o).tag(o) }
                        if !rule.targetValue.isEmpty && !choices.contains(rule.targetValue) {
                            Text(rule.targetValue).tag(rule.targetValue)
                        }
                    }
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
    }

    private func ruleBinding(_ id: String, _ key: WritableKeyPath<BuilderRule, String>) -> Binding<String> {
        Binding(get: { field.rules.first(where: { $0.id == id })?[keyPath: key] ?? "" },
                set: { v in if let i = field.rules.firstIndex(where: { $0.id == id }) { field.rules[i][keyPath: key] = v } })
    }

    /// Another field: its value from the previous one no longer applies.
    private func ruleFieldBinding(_ id: String) -> Binding<String> {
        Binding(get: { field.rules.first(where: { $0.id == id })?.targetCustomFieldId ?? "" },
                set: { v in
                    if let i = field.rules.firstIndex(where: { $0.id == id }) {
                        field.rules[i].targetCustomFieldId = v
                        field.rules[i].targetValue = ""
                    }
                })
    }

    // MARK: mapping

    private var mappingSection: some View {
        Section {
            Picker(T("Answer goes to"), selection: $field.mappingTarget) {
                ForEach(FormBuilderVocab.mappingTargets, id: \.value) { m in Text(T(m.label)).tag(m.value) }
                if !FormBuilderVocab.mappingTargets.contains(where: { $0.value == field.mappingTarget }) {
                    Text(field.mappingTarget).tag(field.mappingTarget)
                }
            }
            if field.mappingTarget == "custom_field" {
                Picker(T("Field"), selection: customFieldBinding) {
                    Text(T("Choose a custom field")).tag("")
                    ForEach(customFields) { c in Text(c.name).tag(c.id) }
                    if !field.mappingCustomFieldId.isEmpty && !customFields.contains(where: { $0.id == field.mappingCustomFieldId }) {
                        Text(T("A custom field that no longer exists")).tag(field.mappingCustomFieldId)
                    }
                }
            }
            if field.mappingTarget == "custom_field" { selectOptionsNote }
            if field.mappingTarget == "task_list", let cat = sectionCategory {
                // Options that are categories, while sections are statuses now (web 13 Oct): one tap moves it.
                Text(String(format: T("These options are categories, and sections are now the project's statuses. Answers go into “%@” and the task starts in the first status."), cat.name))
                    .font(NXFont.text(13)).foregroundStyle(NX.warning)
                Button { sendTo(cat) } label: {
                    Label(String(format: T("Send answers to “%@”"), cat.name), systemImage: "arrow.right").foregroundStyle(NX.violetText)
                }
            } else if field.mappingTarget == "task_list" {
                Text(T("The answer picks the section the task lands in, matched by section name — so the options must match the section names exactly. With no match, it goes to the first section."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                if let cat = FormCategory.projectField(customFields), field.hasOptions, field.type != "multi_select" {
                    Text(String(format: T("Sections are the project's statuses. To sort answers by category, send them to “%@”."), cat.name))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    Button { sendTo(cat) } label: {
                        Label(String(format: T("Send answers to “%@”"), cat.name), systemImage: "arrow.right").foregroundStyle(NX.violetText)
                    }
                }
                if sections.isEmpty {
                    Label(T("This project has no sections yet. Add a section on the board first, then this mapping works."),
                          systemImage: "exclamationmark.triangle.fill")
                        .font(NXFont.text(13)).foregroundStyle(NX.warning)
                } else if field.hasOptions && field.type != "multi_select" {
                    Button { field.options = sections.map(\.name) } label: {
                        Label(String(format: T("Use these %d sections as options"), sections.count), systemImage: "doc.on.doc")
                            .foregroundStyle(NX.violetText)
                    }
                }
            }
        } header: {
            Text(T("Answer goes to"))
        } footer: {
            Text(T("Every response becomes a task in this project. Answers that go nowhere are listed in the task's description."))
        }
    }

    private var sectionNames: [String] { sections.map(\.name) }

    private var sectionCategory: CustomField? {
        FormCategory.fieldForSectionQuestion(type: field.type, target: field.mappingTarget, options: field.options,
                                             fields: customFields, sections: sectionNames)
    }

    /// Answers go to the category field; its options replace section names (or nothing).
    private func sendTo(_ cat: CustomField) {
        if FormCategory.shouldAdopt(field.options, sections: sectionNames, choices: cat.choices) { field.options = cat.choices }
        field.mappingTarget = "custom_field"
        field.mappingCustomFieldId = cat.id
    }

    /// Choosing a SELECT field adopts its options when the question only had section names or none.
    private var customFieldBinding: Binding<String> {
        Binding(get: { field.mappingCustomFieldId }, set: { id in
            field.mappingCustomFieldId = id
            guard field.hasOptions, let target = customFields.first(where: { $0.id == id }), FormCategory.isSelect(target) else { return }
            if FormCategory.shouldAdopt(field.options, sections: sectionNames, choices: target.choices) { field.options = target.choices }
        })
    }

    /// A question mapped to a select field: that field's options, answers that aren't among them, and a
    /// one-tap "Use these N options".
    @ViewBuilder private var selectOptionsNote: some View {
        if let target = customFields.first(where: { $0.id == field.mappingCustomFieldId }), FormCategory.isSelect(target), field.hasOptions {
            let choices = target.choices.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            if !choices.isEmpty {
                let own = field.options.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                let known = Set(choices.map { $0.lowercased() })
                let have = Set(own.map { $0.lowercased() })
                let extra = own.filter { !known.contains($0.lowercased()) }
                let same = extra.isEmpty && choices.allSatisfy { have.contains($0.lowercased()) }
                Text(String(format: T("Options of “%@”: %@"), target.name, choices.joined(separator: ", ")))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                if !extra.isEmpty {
                    Text(String(format: T("Not an option of “%@”: %@. These answers are saved as typed."), target.name, extra.joined(separator: ", ")))
                        .font(NXFont.text(13, .medium)).foregroundStyle(NX.warning)
                }
                if !same && field.type != "multi_select" {
                    Button { field.options = choices } label: {
                        Label(choices.count == 1 ? T("Use this option") : String(format: T("Use these %d options"), choices.count),
                              systemImage: "doc.on.doc").foregroundStyle(NX.violetText)
                    }
                }
            }
        }
    }

    // MARK: move / duplicate / delete

    private var questionSection: some View {
        Section {
            if let onMove {
                Button { onMove(-1) } label: { Label(T("Move up"), systemImage: "arrow.up") }
                    .disabled(index == 0)
                Button { onMove(1) } label: { Label(T("Move down"), systemImage: "arrow.down") }
                    .disabled(index >= total - 1)
            }
            if let onDuplicate {
                Button(action: onDuplicate) { Label(T("Duplicate"), systemImage: "doc.on.doc") }
            }
            Button(role: .destructive) {
                if embedded {
                    onDelete()
                } else {
                    deleteOnLeave = true
                    dismiss()
                }
            } label: {
                Label(T("Delete question"), systemImage: "trash")
            }
        } header: {
            Text(T("Question"))
        } footer: {
            Text(T("Changes save by themselves."))
        }
    }
}

/// The pushed editor's title; in the side panel the builder's own bar stays as it is.
private struct FieldEditorTitle: ViewModifier {
    let title: String
    let on: Bool
    func body(content: Content) -> some View {
        if on {
            content.navigationTitle(title).navigationBarTitleDisplayMode(.inline)
        } else {
            content
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
    /// The cover and icon come along; the people to notify don't (they belong to this project).
    let branding: Any
    let settings: Any

    @Environment(AuthStore.self) private var auth
    @State private var newName: String
    @State private var projects: [Project] = []
    @State private var loading = true
    @State private var busyProjectId: String?
    @State private var done: String?
    @State private var problem: String?

    init(sourceProjectId: String, initialName: String, description: String, fields: [BuilderField],
         isPublic: Bool, requireAuth: Bool, accessSchedule: Any, branding: Any = NSNull(), settings: Any = NSNull()) {
        self.sourceProjectId = sourceProjectId
        self.initialName = initialName
        self.description = description
        self.fields = fields
        self.isPublic = isPublic
        self.requireAuth = requireAuth
        self.accessSchedule = accessSchedule
        self.branding = branding
        self.settings = settings
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
            "branding": branding,
            "settings": settings,
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
