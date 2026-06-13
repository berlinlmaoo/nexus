import SwiftUI

struct ProjectsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var projects: [Project] = []
    @State private var loading = true
    @State private var error: String?
    @State private var workspaceId: String?
    @State private var showCreate = false

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                content
            }
            .navigationTitle("Mission Control")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { showCreate = true } label: { Image(systemName: "plus") }
                        .disabled(workspaceId == nil)
                }
            }
            .sheet(isPresented: $showCreate) {
                CreateProjectSheet(workspaceId: workspaceId ?? "") { await load() }
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

                    ForEach(projects) { p in
                        NavigationLink {
                            ProjectBoardView(projectId: p.id, projectName: p.name)
                        } label: {
                            ProjectCard(project: p)
                        }
                        .buttonStyle(PressableCardStyle())
                    }
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
            if workspaceId == nil { workspaceId = try? await APIClient.shared.workspaceInfo().workspaceId }
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? "Terjadi kesalahan."
        }
        loading = false
    }
}

/// Create a new project (web "Launch a new mission"): name + color.
struct CreateProjectSheet: View {
    let workspaceId: String
    let onCreated: () async -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var color = "#7B2FBE"
    @State private var icon = "🚀"
    @State private var busy = false
    @State private var err: String?

    private let colors = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#7B2FBE"]
    private let icons = ["🚀", "📁", "⭐️", "⚡️", "🎯", "💼", "🎬", "📣"]

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        field("NAMA MISSION") {
                            TextField("mis. PATS Multimedia", text: $name)
                                .font(NXFont.text(16)).padding(12)
                                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                        }
                        field("ICON") {
                            HStack(spacing: 8) {
                                ForEach(icons, id: \.self) { ic in
                                    Text(ic).font(.system(size: 22)).frame(width: 40, height: 40)
                                        .background(icon == ic ? NX.violet.opacity(0.15) : NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                                        .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(icon == ic ? NX.violet : NX.border))
                                        .onTapGesture { icon = ic }
                                }
                            }
                        }
                        field("WARNA") {
                            HStack(spacing: 10) {
                                ForEach(colors, id: \.self) { c in
                                    Circle().fill(Color(hex: c)).frame(width: 30, height: 30)
                                        .overlay(Circle().strokeBorder(color == c ? NX.foreground : .clear, lineWidth: 2))
                                        .onTapGesture { color = c }
                                }
                            }
                        }
                        if let err { Text(err).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger) }
                        Button { Task { await create() } } label: {
                            HStack(spacing: 8) { if busy { ProgressView().tint(.white) }; Text("Launch mission") }
                        }
                        .buttonStyle(NexusPrimaryButton())
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Mission baru")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Batal") { dismiss() } } }
        }
    }

    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
            content()
        }
    }

    private func create() async {
        busy = true; err = nil; defer { busy = false }
        do {
            try await APIClient.shared.createProject(workspaceId: workspaceId, name: name.trimmingCharacters(in: .whitespaces), color: color, icon: icon)
            await onCreated()
            dismiss()
        } catch {
            err = (error as? LocalizedError)?.errorDescription ?? "Gagal bikin project."
        }
    }
}

/// Faithful port of the web ProjectCard: icon tile + name + description + status chip,
/// Cards/Done/Lanes metrics, "mission energy" progress bar, member avatars + deadline.
/// Press-scale for a whole card used as a NavigationLink/Button label. Lives in a ButtonStyle so
/// the tap still reaches the NavigationLink (an inline `onLongPressGesture` would swallow it).
struct PressableCardStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

struct ProjectCard: View {
    let project: Project

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
