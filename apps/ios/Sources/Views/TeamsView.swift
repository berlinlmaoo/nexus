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
            ErrorState(message: error, icon: "person.3") { Task { await load() } }
        } else if teams.isEmpty {
            EmptyState(icon: "person.3.fill", title: T("No teams yet"),
                       subtitle: T("A team groups people and hands them access to the projects linked to it. Managers create teams from Control Room; once you're in one, it shows up here."))
        } else {
            ScrollView {
                // Same as Forms: the note is about the screen, not about the first team.
                VStack(spacing: 12) {
                    Text(T("Team members automatically get access to the linked projects."))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity, alignment: .leading)
                    NXCardGrid(spacing: 12) {
                        // The cards used to be inert — tapping one did nothing, so members and
                        // project access could only be changed from the web.
                        ForEach(teams) { team in
                            NavigationLink {
                                TeamDetailView(team: team) { Task { await load() } }
                            } label: {
                                TeamCard(team: team)
                            }
                            .buttonStyle(.plain)
                        }
                    }
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
