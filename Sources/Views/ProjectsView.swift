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
                Image(systemName: "rectangle.stack").font(.system(size: 44)).foregroundStyle(NX.mutedFg)
                Text("Belum ada mission").font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                LazyVStack(spacing: 16) {
                    // hero strip (web: "missions visible")
                    HStack(spacing: 6) {
                        Image(systemName: "sparkles").font(.system(size: 12, weight: .bold))
                        Text("\(projects.count) missions visible").font(NXFont.text(12, .semibold))
                    }
                    .foregroundStyle(NX.violet)
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(NX.violet.opacity(0.1), in: Capsule())
                    .frame(maxWidth: .infinity, alignment: .leading)

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
        .padding(32).frame(maxWidth: .infinity, maxHeight: .infinity)
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

/// Faithful port of the web ProjectCard: icon tile + name + description + status chip,
/// Cards/Done/Lanes metrics, "mission energy" progress bar, member avatars + deadline.
struct ProjectCard: View {
    let project: Project
    @State private var pressed = false

    private var accent: Color { Color(hex: project.color ?? "#a168be") }
    private var done: Int { 0 }   // completed count not in the list endpoint (matches web's 0 for fresh)
    private var total: Int { project.taskCount }
    private var progress: Double { total > 0 ? Double(done) / Double(total) : 0 }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // header row
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14, style: .continuous).fill(NX.muted)
                    if project.isUploadedIcon {
                        AsyncImage(url: URL(string: Config.baseURL.absoluteString + (project.icon ?? ""))) { img in
                            img.resizable().scaledToFill()
                        } placeholder: { Text("📁").font(.system(size: 22)) }
                        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                    } else {
                        Text(project.emoji).font(.system(size: 22))
                    }
                }
                .frame(width: 44, height: 44)

                VStack(alignment: .leading, spacing: 3) {
                    Text(project.name).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(project.description?.isEmpty == false ? project.description! : "No brief yet — add one and make the mission clearer.")
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
                }
                Spacer(minLength: 4)
                NexusChip(text: project.statusLabel, tone: statusTone)
            }

            // metrics
            HStack(spacing: 8) {
                metric("Cards", "\(total)")
                metric("Done", "\(done)")
                metric("Lanes", "\(project.laneCount)")
            }
            .padding(.top, 16)

            // progress
            VStack(spacing: 6) {
                HStack {
                    Text("\(Int(progress * 100))% mission energy").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    Spacer()
                    Text("\(max(0, total - done)) left").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                GeometryReader { geo in
                    ZStack(alignment: .leading) {
                        Capsule().fill(NX.muted)
                        Capsule().fill(NX.success).frame(width: geo.size.width * progress)
                    }
                }
                .frame(height: 7)
            }
            .padding(.top, 16)

            // footer
            HStack {
                if project.memberCount > 0 {
                    HStack(spacing: -8) {
                        ForEach(Array(project.memberInitials.enumerated()), id: \.offset) { _, ini in
                            Text(ini).font(NXFont.text(10, .bold)).foregroundStyle(NX.violet)
                                .frame(width: 24, height: 24).background(NX.accentBg, in: Circle())
                                .overlay(Circle().strokeBorder(NX.card, lineWidth: 2))
                        }
                        if project.memberCount > 4 {
                            Text("+\(project.memberCount - 4)").font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                                .frame(width: 24, height: 24).background(NX.muted, in: Circle())
                                .overlay(Circle().strokeBorder(NX.card, lineWidth: 2))
                        }
                    }
                } else {
                    Text("Solo quest").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer()
                HStack(spacing: 4) {
                    Image(systemName: "clock").font(.system(size: 11))
                    Text("No deadline").font(NXFont.text(11))
                }.foregroundStyle(NX.mutedFg)
            }
            .padding(.top, 16)
        }
        .padding(18)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).strokeBorder(NX.border, lineWidth: 1))
        .overlay(alignment: .topTrailing) {
            Circle().fill(accent.opacity(0.10)).frame(width: 110, height: 110).offset(x: 36, y: -36).allowsHitTesting(false)
        }
        .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
        .nexusShadowSoft()
        .scaleEffect(pressed ? 0.98 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: pressed)
        .onLongPressGesture(minimumDuration: 0, pressing: { pressed = $0 }, perform: {})
    }

    private func metric(_ label: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value).font(NXFont.display(18, .bold)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(10, .medium)).foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 8)
        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }

    private var statusTone: ChipTone {
        switch (project.status ?? "ACTIVE").uppercased() {
        case "AT_RISK": return .warning
        case "OFF_TRACK": return .danger
        case "COMPLETED", "DONE": return .success
        default: return .accent
        }
    }
}
