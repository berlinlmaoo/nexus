import SwiftUI

/// Port of teams.tsx: team cards (name, color, member count, linked projects).
struct TeamsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var teams: [Team] = []
    @State private var loading = true
    @State private var error: String?

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle("Teams")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            VStack(spacing: 12) {
                Image(systemName: "person.3").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                Text(error).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                Button(T("Try again")) { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
            }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
        } else if teams.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "person.3.fill").font(.system(size: 42)).foregroundStyle(NX.mutedFg)
                Text(T("No teams yet")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 12) {
                    Text(T("Team members automatically get access to the linked projects."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity, alignment: .leading)
                    ForEach(teams) { TeamCard(team: $0) }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func load() async {
        error = nil
        do { teams = try await APIClient.shared.teams() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load teams.") }
        loading = false
    }
}

struct TeamCard: View {
    let team: Team
    private var color: Color { Color(hex: team.color ?? "#7b68ee") }
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Text(team.initial).font(NXFont.display(15, .black)).foregroundStyle(.white)
                    .frame(width: 40, height: 40).background(color, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(team.name).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text("\(team.memberCount) \(T("members")) · \(team.projectNames.count) \(T("projects"))")
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
            }
            if !team.projectNames.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(team.projectNames.prefix(6), id: \.self) { n in
                            NexusChip(text: n, tone: .accent)
                        }
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }
}
