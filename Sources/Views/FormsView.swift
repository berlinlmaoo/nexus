import SwiftUI

/// Port of forms.tsx ("Forms"): intake-form cards aggregated across the user's projects.
struct FormsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var forms: [NexusForm] = []
    @State private var projectNames: [String: String] = [:]
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle("Forms")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            VStack(spacing: 12) {
                Image(systemName: "doc.text.magnifyingglass").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                Text(error).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                Button("Coba lagi") { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
            }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
        } else if forms.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "doc.text").font(.system(size: 42)).foregroundStyle(NX.mutedFg)
                Text("Belum ada form").font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                Text("Intake form yang spawn task otomatis muncul di sini.").font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
        } else {
            ScrollView {
                LazyVStack(spacing: 12) {
                    Text("Form intake yang spawn task otomatis pas di-submit.")
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(forms) { f in FormCard(form: f, projectName: projectNames[f.projectId ?? ""] ?? "Project") }
                }
                .padding(16)
            }
            .refreshable { await load() }
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
                    all += fs.map { f in NexusForm(id: f.id, name: f.name, description: f.description, isPublic: f.isPublic, projectId: f.projectId ?? p.id, count: f.count) }
                }
            }
            forms = all
        } catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat forms." }
        loading = false
    }
}

struct FormCard: View {
    let form: NexusForm
    let projectName: String
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "doc.text.fill").font(.system(size: 16)).foregroundStyle(NX.violet)
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
