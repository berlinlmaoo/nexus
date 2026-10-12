import SwiftUI

/// Port of forms.tsx ("Forms"): intake-form cards aggregated across the user's projects.
///
/// A card opens the form to fill in. Building one — New form in the toolbar, Edit form on a card's
/// context menu — opens the same builder as a project's Forms tab (FormBuilderView.swift).
struct FormsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var forms: [NexusForm] = []
    @State private var projectNames: [String: String] = [:]
    @State private var loading = true
    @State private var error: String?
    @State private var pickProject = false
    @State private var editTarget: FormEditTarget?

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle("Forms")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { pickProject = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel(T("New form"))
            }
        }
        .navigationDestination(isPresented: $pickProject) { FormProjectPickerView() }
        .navigationDestination(item: $editTarget) { t in
            FormBuilderView(projectId: t.projectId, projectName: t.projectName, formId: t.formId)
        }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .nexusFormsChanged)) { _ in
            Task { await load() }
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            ErrorState(message: error, icon: "doc.text.magnifyingglass") { Task { await load() } }
        } else if forms.isEmpty {
            EmptyState(icon: "doc.text", title: T("No forms yet"),
                       subtitle: T("A form is an intake page — a request, a reimbursement, a report — that turns into a task the moment it's submitted. Build the first one and it appears here for everyone to fill in."),
                       actionTitle: T("New form"), actionIcon: "plus", action: { pickProject = true })
        } else {
            ScrollView {
                // The explanation stays outside the grid: it describes the whole screen, and as a
                // grid cell it would sit in the left column pretending to be the first card.
                VStack(spacing: 12) {
                    Text(T("A form that creates a task each time someone submits it."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity, alignment: .leading)
                    NXCardGrid(spacing: 12) {
                        ForEach(forms) { f in
                            NavigationLink { FormFillView(formId: f.id, title: f.name) } label: {
                                FormCard(form: f, projectName: projectNames[f.projectId ?? ""] ?? "Project")
                            }
                            .buttonStyle(.plain)
                            .hoverEffect(.highlight)
                            .contextMenu { menu(for: f) }
                        }
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    /// The same actions a form has on the web's card: edit it, and its public link.
    @ViewBuilder private func menu(for f: NexusForm) -> some View {
        if let pid = f.projectId {
            Button {
                editTarget = FormEditTarget(projectId: pid, projectName: projectNames[pid] ?? "", formId: f.id)
            } label: {
                Label(T("Edit form"), systemImage: "slider.horizontal.3")
            }
        }
        if f.isPublic == true {
            let url = FormLink.url(slug: f.slug, id: f.id)
            Button { UIPasteboard.general.string = url.absoluteString } label: {
                Label(T("Copy public link"), systemImage: "doc.on.doc")
            }
            ShareLink(item: url) { Label(T("Share link"), systemImage: "square.and.arrow.up") }
        }
    }

    private func load() async {
        error = nil
        do {
            let projects = try await APIClient.shared.projects()
            projectNames = Dictionary(projects.map { ($0.id, $0.name) }, uniquingKeysWith: { a, _ in a })
            var all: [NexusForm] = []
            for p in projects {
                if let fs = try? await APIClient.shared.forms(projectId: p.id) {
                    all += fs.map { f in NexusForm(id: f.id, name: f.name, description: f.description, isPublic: f.isPublic, projectId: f.projectId ?? p.id, count: f.count, slug: f.slug) }
                }
            }
            forms = all
        } catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load forms.") }
        loading = false
    }
}

struct FormCard: View {
    let form: NexusForm
    let projectName: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "doc.text.fill").font(.system(size: 16)).foregroundStyle(NX.violetText)
                    .frame(width: 36, height: 36).background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(form.name).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(projectName).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                if form.isPublic == true { NexusChip(text: "Public", tone: .success, systemImage: "globe") }
            }
            if let d = form.description, !d.isEmpty {
                Text(d).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
            HStack(spacing: 6) {
                Image(systemName: "tray.full").font(.system(size: 11))
                Text("\(form.submissionCount) submission\(form.submissionCount == 1 ? "" : "s")").font(NXFont.text(12, .semibold))
            }.foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }
}
