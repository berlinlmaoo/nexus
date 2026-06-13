import SwiftUI

struct ProjectsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var projects: [Project] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                content
            }
            .navigationTitle("Mission Control")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if !auth.session!.userName.isEmpty { Text(auth.session!.userName) }
                        Text(auth.session!.userEmail)
                        Divider()
                        Button("Logout", role: .destructive) { auth.logout() }
                    } label: {
                        Circle().fill(NX.violet.opacity(0.15))
                            .frame(width: 30, height: 30)
                            .overlay(Text(initials).font(NXFont.display(12, .black)).foregroundStyle(NX.violet))
                    }
                }
            }
            .task { await load() }
        }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            errorState(error)
        } else if projects.isEmpty {
            VStack(spacing: 10) {
                Image(systemName: "folder").font(.system(size: 44)).foregroundStyle(NX.mutedFg)
                Text("Belum ada project").font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 12) {
                    HStack {
                        Text("\(projects.count) project aktif").font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                        Spacer()
                    }
                    .padding(.horizontal, 4).padding(.top, 4)
                    ForEach(projects) { ProjectCard(project: $0) }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func errorState(_ msg: String) -> some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
            Text(msg).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            Button("Coba lagi") { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var initials: String {
        let n = auth.session?.userName ?? ""
        let parts = n.split(separator: " ")
        if let a = parts.first?.first { return String(a).uppercased() }
        return (auth.session?.userEmail.first.map { String($0).uppercased() }) ?? "?"
    }

    private func load() async {
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

struct ProjectCard: View {
    let project: Project
    @State private var pressed = false

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(hex: project.color ?? "#7b68ee").opacity(0.16))
                Text(project.emoji).font(.system(size: 24))
            }
            .frame(width: 52, height: 52)
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(Color(hex: project.color ?? "#7b68ee").opacity(0.25), lineWidth: 1)
            )

            VStack(alignment: .leading, spacing: 5) {
                Text(project.name)
                    .font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    NexusChip(text: "\(project.taskCount) task", tone: .accent, systemImage: "checklist")
                    NexusChip(text: "\(project.memberCount)", tone: .neutral, systemImage: "person.2.fill")
                    if let status = project.status, status.uppercased() != "ACTIVE" {
                        NexusChip(text: status.capitalized, tone: .warning)
                    }
                }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg.opacity(0.5))
        }
        .nexusCard(padding: 14)
        .scaleEffect(pressed ? 0.98 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: pressed)
        .onTapGesture {}
        .onLongPressGesture(minimumDuration: 0, pressing: { pressed = $0 }, perform: {})
    }
}
