import SwiftUI

/// Port of the web ProjectSettingsDrawer: identity, customize flags, custom fields,
/// members, and danger zone. Reached from the ⚙︎ in the project header.
struct ProjectSettingsView: View {
    let projectId: String
    let detail: ProjectDetail
    var onChange: () async -> Void = {}
    var onDeleted: () -> Void = {}

    @Environment(\.dismiss) private var dismiss
    @Environment(AuthStore.self) private var auth

    // identity
    @State private var name = ""
    @State private var desc = ""
    @State private var color = "#7b68ee"
    @State private var icon = "🚀"
    @State private var savingIdentity = false
    @State private var identitySaved = false

    // flags
    @State private var batchDup = false
    @State private var pnl = false
    @State private var autoAssign = false
    @State private var autoIds: Set<String> = []
    @State private var viewerWsRole: String?

    // fields & members
    @State private var fields: [CustomField] = []
    @State private var roster: [WorkspaceRoster.Member] = []
    @State private var projectMembers: [ProjectDetail.ProjectMember] = []

    // danger
    @State private var confirmDelete = false
    @State private var busy = false
    @State private var toast: String?

    private let swatches = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#64748b"]
    private var canPnl: Bool { viewerWsRole == "BOD" || viewerWsRole == "ONE_ABOVE_ALL" }
    private var iconIsImage: Bool { icon.hasPrefix("/") || icon.hasPrefix("http") }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    identityCard
                    customizeCard
                    fieldsCard
                    membersCard
                    dangerCard
                }
                .padding(16)
            }
            .background(NX.background.ignoresSafeArea())
            .navigationTitle("Setting Project").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button("Tutup") { dismiss() } } }
            .overlay(alignment: .bottom) { if let toast { toastView(toast) } }
            .onAppear(perform: hydrate)
            .task { await load() }
        }
    }

    // MARK: identity

    private var identityCard: some View {
        card("Identitas") {
            field(T("Project name")) { TextField(T("Name"), text: $name).textFieldStyle(.plain).font(NXFont.text(15)) }
            field("Deskripsi") { TextField("Deskripsi singkat", text: $desc, axis: .vertical).lineLimit(2...4).font(NXFont.text(14)) }
            field("Ikon (emoji)") {
                HStack {
                    if iconIsImage {
                        CachedImage(url: URL(string: icon.hasPrefix("http") ? icon : Config.baseURL.absoluteString + icon)) { $0.resizable().scaledToFill() } placeholder: { Color.clear }
                            .frame(width: 32, height: 32).clipShape(RoundedRectangle(cornerRadius: 8))
                        Button(T("Use an emoji instead")) { icon = "🚀" }.font(NXFont.text(12, .semibold)).foregroundStyle(NX.violetText)
                    } else {
                        TextField("🚀", text: $icon).font(.system(size: 24)).frame(width: 50)
                            .onChange(of: icon) { _, v in if v.count > 2 { icon = String(v.prefix(2)) } }
                    }
                    Spacer()
                }
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Warna").font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                HStack(spacing: 10) {
                    ForEach(swatches, id: \.self) { hex in
                        Circle().fill(Color(hex: hex)).frame(width: 28, height: 28)
                            .overlay(Circle().strokeBorder(.white, lineWidth: color == hex ? 3 : 0))
                            .overlay(Circle().strokeBorder(NX.border, lineWidth: 1))
                            .onTapGesture { color = hex }
                    }
                }
            }
            Button { Task { await saveIdentity() } } label: {
                Text(savingIdentity ? "Menyimpan…" : (identitySaved ? "Tersimpan ✓" : T("Save identity"))).font(NXFont.text(14, .bold))
            }.buttonStyle(NexusPrimaryButton()).disabled(savingIdentity)
        }
    }

    // MARK: customize flags

    private var customizeCard: some View {
        card("Customize") {
            flagToggle(T("Task duplicate mode"), T("Multi-select duplicate + a due-date popup for recurring tasks."), $batchDup) {
                await patch(["enableTaskBatchDuplicate": batchDup])
            }
            if canPnl {
                Divider().overlay(NX.border)
                flagToggle("P&L Dashboard", T("Standalone finance view: daily spend, incoming-cash pipeline."), $pnl) {
                    await patch(["enablePnlDashboard": pnl])
                }
            }
            Divider().overlay(NX.border)
            flagToggle("Auto assign", T("Auto-assign the selected members to new tasks in this project."), $autoAssign) {
                if autoAssign && autoIds.isEmpty { autoAssign = false; show(T("Pick at least one member first.")); return }
                await patch(["autoAssignEnabled": autoAssign, "autoAssignAssigneeIds": Array(autoIds)])
            }
            if autoAssign {
                VStack(alignment: .leading, spacing: 6) {
                    Text(T("Auto-assign to:")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                    ForEach(projectMembers) { m in
                        Button {
                            if autoIds.contains(m.uid) { autoIds.remove(m.uid) } else { autoIds.insert(m.uid) }
                            Task { await patch(["autoAssignEnabled": true, "autoAssignAssigneeIds": Array(autoIds)]) }
                        } label: {
                            HStack(spacing: 10) {
                                Image(systemName: autoIds.contains(m.uid) ? "checkmark.circle.fill" : "circle").foregroundStyle(autoIds.contains(m.uid) ? NX.violetText : NX.mutedFg)
                                AvatarView(url: m.user?.avatar, initial: m.initial, size: 26)
                                Text(m.displayName).font(NXFont.text(13)).foregroundStyle(NX.foreground)
                                Spacer()
                            }
                        }.buttonStyle(.plain)
                    }
                }
            }
        }
    }

    // MARK: custom fields

    private var fieldsCard: some View {
        card("Custom Fields") {
            if fields.isEmpty {
                Text(T("No custom fields in this project yet.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            }
            ForEach(fields) { f in
                HStack(spacing: 10) {
                    Image(systemName: cfIcon(f.type)).font(.system(size: 13)).foregroundStyle(NX.violetText)
                        .frame(width: 30, height: 30).background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(f.name).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                        Text(cfSummary(f)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                    }
                    Spacer(minLength: 4)
                    Button { Task { await deleteField(f) } } label: { Image(systemName: "trash").font(.system(size: 12)).foregroundStyle(NX.danger) }.disabled(busy)
                }
                .padding(.vertical, 3)
            }
            NavigationLink { CustomFieldEditor(projectId: projectId) { await reloadFields() } } label: {
                Label("Field baru", systemImage: "plus").font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
            }
        }
    }

    // MARK: members

    private var membersCard: some View {
        card(T("Project members")) {
            ForEach(projectMembers) { m in
                HStack(spacing: 10) {
                    AvatarView(url: m.user?.avatar, initial: m.initial, size: 32)
                    Text(m.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                    Spacer(minLength: 4)
                    Button { Task { await removeMember(m) } } label: { Image(systemName: "minus.circle.fill").foregroundStyle(NX.danger) }.disabled(busy)
                }
                .padding(.vertical, 2)
            }
            let addable = roster.filter { r in !projectMembers.contains { $0.uid == (r.userId ?? r.idv) } }
            if !addable.isEmpty {
                Menu {
                    ForEach(addable) { r in
                        Button(r.displayName) { Task { await addMember(r) } }
                    }
                } label: {
                    Label(T("Add member"), systemImage: "person.badge.plus").font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
                }
            }
            NavigationLink { InviteByEmailView(projectId: projectId) } label: {
                Label(T("Invite by email"), systemImage: "envelope").font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
            }
        }
    }

    // MARK: danger

    private var dangerCard: some View {
        card("Danger Zone") {
            Button { Task { await duplicate() } } label: {
                Label(busy ? "…" : "Duplikat project", systemImage: "doc.on.doc").font(NXFont.text(14, .bold)).foregroundStyle(NX.blue)
            }.disabled(busy)
            Divider().overlay(NX.border)
            Button(role: .destructive) { confirmDelete = true } label: {
                Label(T("Delete project"), systemImage: "trash").font(NXFont.text(14, .bold)).foregroundStyle(NX.danger)
            }.disabled(busy)
            .alert("\(T("Delete")) \"\(name)\"? \(T("Every task, field and project data goes with it. This cannot be undone."))", isPresented: $confirmDelete) {
                Button(T("Delete permanently"), role: .destructive) { Task { await deleteProj() } }
                Button(T("Cancel"), role: .cancel) {}
            }
        }
    }

    // MARK: building blocks

    private func card<C: View>(_ title: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionLabel(title)
            content()
        }
        .padding(16).frame(maxWidth: .infinity, alignment: .leading)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
    }
    private func field<C: View>(_ label: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
            content().padding(10).background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }
    private func flagToggle(_ title: String, _ sub: String, _ binding: Binding<Bool>, _ onSet: @escaping () async -> Void) -> some View {
        Toggle(isOn: Binding(get: { binding.wrappedValue }, set: { binding.wrappedValue = $0; Task { await onSet() } })) {
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text(sub).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
        }.tint(NX.violetText)
    }
    private func toastView(_ t: String) -> some View {
        Text(t).font(NXFont.text(13, .semibold)).foregroundStyle(.white)
            .padding(.horizontal, 16).padding(.vertical, 10).background(NX.onyx, in: Capsule()).padding(.bottom, 20)
    }
    private func cfIcon(_ type: String) -> String {
        switch type { case "NUMBER": return "number"; case "DATE": return "calendar"; case "PLACE": return "mappin.and.ellipse"
        case "MULTI_SELECT": return "checklist"; case "STATUS": return "flag.fill"; default: return "chevron.down.circle" }
    }
    private func cfSummary(_ f: CustomField) -> String {
        if f.type == "NUMBER" { return f.options?.format == "currency-idr" ? "Angka · Rp" : "Angka" }
        if !f.choices.isEmpty { return "\(f.type.replacingOccurrences(of: "_", with: " ").capitalized) · \(f.choices.joined(separator: ", "))" }
        return f.type.replacingOccurrences(of: "_", with: " ").capitalized
    }

    // MARK: logic

    private func hydrate() {
        name = detail.name
        desc = detail.description ?? ""
        color = detail.color ?? "#7b68ee"
        icon = detail.icon ?? "🚀"
        batchDup = detail.enableTaskBatchDuplicate ?? false
        pnl = detail.enablePnlDashboard ?? false
        autoAssign = detail.autoAssignEnabled ?? false
        autoIds = Set(detail.autoAssignAssigneeIds ?? [])
        projectMembers = detail.members ?? []
    }
    private func load() async {
        async let f = try? APIClient.shared.projectCustomFields(projectId)
        async let r = try? APIClient.shared.roster()
        fields = (await f) ?? []
        if let r = await r { roster = r.members ?? []; viewerWsRole = r.role }
    }
    private func reloadFields() async { fields = (try? await APIClient.shared.projectCustomFields(projectId)) ?? [] }

    private func saveIdentity() async {
        savingIdentity = true; identitySaved = false
        let ok = (try? await APIClient.shared.updateProject(projectId, fields: [
            "name": name, "description": desc, "color": color, "icon": icon
        ])) != nil
        savingIdentity = false; identitySaved = ok
        if ok { await onChange() }
    }
    private func patch(_ fields: [String: Any]) async {
        if (try? await APIClient.shared.updateProject(projectId, fields: fields)) != nil { await onChange() }
        else { show(T("Couldn't save — try again.")) }
    }
    private func deleteField(_ f: CustomField) async {
        busy = true; try? await APIClient.shared.deleteCustomFieldDef(id: f.id); await reloadFields(); busy = false
    }
    private func addMember(_ r: WorkspaceRoster.Member) async {
        guard let uid = r.userId ?? (r.idv.isEmpty ? nil : r.idv) else { return }
        busy = true
        if (try? await APIClient.shared.addProjectMember(projectId: projectId, userId: uid)) != nil {
            projectMembers.append(.init(userId: uid, user: .init(id: uid, name: r.displayName, avatar: r.avatarURL)))
        }
        busy = false; await onChange()
    }
    private func removeMember(_ m: ProjectDetail.ProjectMember) async {
        busy = true
        if (try? await APIClient.shared.removeProjectMember(projectId: projectId, userId: m.uid)) != nil {
            projectMembers.removeAll { $0.uid == m.uid }; autoIds.remove(m.uid)
        }
        busy = false; await onChange()
    }
    private func duplicate() async {
        busy = true
        if (try? await APIClient.shared.duplicateProject(projectId: projectId)) != nil { show("Project diduplikat ✓") }
        else { show(T("Couldn't duplicate.")) }
        busy = false
    }
    private func deleteProj() async {
        busy = true
        if (try? await APIClient.shared.deleteProject(projectId: projectId)) != nil {
            dismiss(); onDeleted()
        } else { show(T("Couldn't delete.")); busy = false }
    }
    private func show(_ t: String) {
        toast = t
        Task { try? await Task.sleep(nanoseconds: 2_200_000_000); if toast == t { toast = nil } }
    }
}
