import SwiftUI

struct ProjectsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var projects: [Project] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    ProgressView("Memuat projects…")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                } else if let error {
                    ContentUnavailableView {
                        Label("Gagal memuat", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(error)
                    } actions: {
                        Button("Coba lagi") { Task { await load() } }
                            .buttonStyle(.borderedProminent)
                    }
                } else if projects.isEmpty {
                    ContentUnavailableView("Belum ada project", systemImage: "folder")
                } else {
                    List(projects) { project in
                        ProjectRow(project: project)
                            .listRowSeparator(.hidden)
                    }
                    .listStyle(.plain)
                    .refreshable { await load() }
                }
            }
            .navigationTitle("Projects")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if !auth.session!.userName.isEmpty {
                            Text(auth.session!.userName)
                        }
                        Text(auth.session!.userEmail)
                        Divider()
                        Button("Logout", role: .destructive) { auth.logout() }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        loading = projects.isEmpty
        error = nil
        do {
            projects = try await APIClient.shared.projects()
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Terjadi kesalahan."
        }
        loading = false
    }
}

struct ProjectRow: View {
    let project: Project

    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(hex: project.color ?? "#7b68ee").opacity(0.18))
                .frame(width: 44, height: 44)
                .overlay(Text(project.emoji).font(.title3))

            VStack(alignment: .leading, spacing: 3) {
                Text(project.name)
                    .font(.headline)
                    .lineLimit(1)
                HStack(spacing: 10) {
                    Label("\(project.taskCount)", systemImage: "checklist")
                    Label("\(project.memberCount)", systemImage: "person.2")
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            if let status = project.status {
                Text(status.capitalized)
                    .font(.caption2.weight(.bold))
                    .padding(.horizontal, 8).padding(.vertical, 4)
                    .background(Brand.violet.opacity(0.12), in: Capsule())
                    .foregroundStyle(Brand.violet)
            }
        }
        .padding(.vertical, 6)
    }
}
