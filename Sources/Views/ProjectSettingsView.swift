import SwiftUI
import PhotosUI
import UIKit

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
    /// The stored icon as the server has it. Only its photo is drawn (ProjectMark): emoji and named
    /// icons are ignored since 11 Oct 2026, and there is no field to type one any more.
    @State private var icon: String?
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var photoBusy = false
    @State private var photoError: String?
    @State private var photoProgress = UploadProgress()
    @State private var savingIdentity = false
    @State private var identitySaved = false

    // flags
    @State private var batchDup = false
    @State private var pnl = false
    @State private var finance = false
    @State private var hiddenTabs: [String] = []
    @State private var savingTabs = false
    @State private var autoAssign = false
    @State private var autoIds: Set<String> = []
    @State private var viewerWsRole: String?

    // fields & members
    @State private var fields: [CustomField] = []
    @State private var roster: [WorkspaceRoster.Member] = []
    @State private var projectMembers: [ProjectDetail.ProjectMember] = []
    @State private var showAddMembers = false

    // danger
    @State private var confirmDelete = false
    @State private var busy = false
    @State private var toast: String?

    private let swatches = ["#7b68ee", "#0091ff", "#16a34a", "#f59e0b", "#ef4444", "#ec4899", "#06b6d4", "#64748b"]
    private var canPnl: Bool { viewerWsRole == "BOD" || viewerWsRole == "ONE_ABOVE_ALL" }
    /// Tabs follow the server's rule for every project setting: Manager and above.
    private var canManageTabs: Bool { viewerWsRole == "MANAGER" || canPnl }
    private var hasPhoto: Bool { ProjectMark.isPhoto(icon) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    identityCard
                    customizeCard
                    // A Pipeline Dashboard shows its pipeline, not task tabs: nothing to choose (owner,
                    // 9 Oct 2026, as on the web).
                    // A Pipeline or Outlet Sales Dashboard has fixed tabs (as on the web).
                    if detail.type != "PIPELINE" && detail.type != "OUTLET_SALES" { tabsCard }
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
            // No emoji any more (owner, 11 Oct 2026): the project's photo, or a square in its colour.
            field(T("Photo")) { photoRow }
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

    /// The mark as it will be drawn (live with the colour picked below), and the photo actions.
    /// Uploading and removing save at once, like the web drawer; "Save identity" never sends `icon`.
    private var photoRow: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NX.muted)
                    ProjectMark(icon: icon, color: color, size: 48, glyph: 28)
                        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .frame(width: 48, height: 48)
                VStack(alignment: .leading, spacing: 6) {
                    PhotosPicker(selection: $pickedPhoto, matching: .images, photoLibrary: .shared()) {
                        HStack(spacing: 6) {
                            if photoBusy { ProgressView().controlSize(.small) }
                            Text(hasPhoto ? T("Change photo") : T("Add photo"))
                        }
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.violetText)
                    }
                    .disabled(photoBusy)
                    if hasPhoto {
                        Button(T("Remove photo")) { Task { await removePhoto() } }
                            .font(NXFont.text(12, .semibold)).foregroundStyle(NX.mutedFg)
                            .disabled(photoBusy)
                    }
                }
                Spacer(minLength: 0)
            }
            if !hasPhoto {
                Text(T("Without a photo, the project shows a square in its colour."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            if let photoError {
                Text(photoError).font(NXFont.text(11)).foregroundStyle(NX.danger)
            }
            if photoProgress.isActive {
                UploadProgressBar(progress: photoProgress).frame(maxWidth: 180)
            }
        }
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task { await uploadPhoto(item) }
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
                // Finance is opt-in exactly like P&L (owner, 9 Oct 2026), BoD and above.
                Divider().overlay(NX.border)
                flagToggle("Finance", T("Monthly OPEX and revenue for this project, by year. Off until BoD turns it on, like P&L. Turning it off only hides the tab — the numbers stay."), $finance) {
                    await saveFinance()
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

    // MARK: tabs (owner, 9 Oct 2026)

    /// One switch per tab. Off only hides the tab; Board or List always stays on.
    private var tabsCard: some View {
        card(T("Tabs")) {
            Text(T("Choose the tabs this project shows. Turning a tab off only hides it: nothing in it is deleted, and turning it back on brings everything back."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            ForEach(ProjectTab.hideable) { tab in
                if tab != ProjectTab.hideable.first { Divider().overlay(NX.border) }
                tabToggle(tab)
            }
            if !canManageTabs && viewerWsRole != nil {
                Text(T("Only managers and above can change the tabs.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
        }
    }

    private func tabToggle(_ tab: ProjectTab) -> some View {
        let key = tab.key ?? ""
        let shown = !hiddenTabs.contains(key)
        let shownTaskViews = ProjectTab.taskViews.filter { !hiddenTabs.contains($0.key ?? "") }
        // The last task view stays on: a task project needs some way to see its tasks.
        let lastTaskView = shown && shownTaskViews == [tab]
        return Toggle(isOn: Binding(get: { !hiddenTabs.contains(key) }, set: { on in Task { await setTab(key, shown: on) } })) {
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 8) {
                    Image(systemName: tab.icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.violetText).frame(width: 18)
                    Text(tab.label).font(NXFont.text(14, .semibold)).foregroundStyle(shown ? NX.foreground : NX.mutedFg)
                }
                if lastTaskView {
                    Text(T("Board or List stays on")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
            }
        }
        .tint(NX.violetText)
        .disabled(!canManageTabs || lastTaskView || savingTabs)
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
            // A searchable multi-select sheet, not a long menu of names (owner, 9 Oct 2026).
            Button { showAddMembers = true } label: {
                Label(T("Add members"), systemImage: "person.badge.plus").font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
            }
            .disabled(busy)
            .sheet(isPresented: $showAddMembers) {
                AddProjectMembersSheet(projectId: projectId, roster: roster, memberIds: Set(projectMembers.map(\.uid))) { added in
                    await membersAdded(added)
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
        icon = detail.icon
        batchDup = detail.enableTaskBatchDuplicate ?? false
        pnl = detail.enablePnlDashboard ?? false
        // Same rule as the tab bar: an older server without the flag → the name rule.
        finance = detail.financeEnabled ?? (detail.name.range(of: "finance", options: .caseInsensitive) != nil)
        hiddenTabs = detail.hiddenTabs ?? []
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
        // No `icon` here: the photo saves on its own (uploadPhoto/removePhoto), and sending the field
        // back could only overwrite a photo uploaded meanwhile.
        let ok = (try? await APIClient.shared.updateProject(projectId, fields: [
            "name": name, "description": desc, "color": color,
        ])) != nil
        savingIdentity = false; identitySaved = ok
        if ok { await onChange() }
    }
    /// Same handling as the profile photo: the library hands back HEIC more often than not, which the
    /// server refuses, so it goes up as JPEG with the long edge capped (well under the 5 MB limit).
    /// Then the url is PATCHed onto the project — the upload alone does not store it.
    private func uploadPhoto(_ item: PhotosPickerItem) async {
        photoBusy = true
        photoError = nil
        defer { photoBusy = false; pickedPhoto = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) else {
            photoError = T("Couldn't read that photo.")
            return
        }
        let maxEdge: CGFloat = 1024
        let scale = min(1, maxEdge / max(image.size.width, image.size.height))
        let target = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let resized = UIGraphicsImageRenderer(size: target).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        guard let jpeg = resized.jpegData(compressionQuality: 0.85) else {
            photoError = T("Couldn't read that photo.")
            return
        }
        do {
            let url = try await APIClient.shared.uploadProjectIcon(projectId: projectId, fileName: "icon.jpg", mime: "image/jpeg",
                                                                   data: jpeg, progress: photoProgress)
            _ = try await APIClient.shared.updateProject(projectId, fields: ["icon": url])
            icon = url
            await onChange()
        } catch {
            photoError = (error as? LocalizedError)?.errorDescription ?? T("Upload failed. Try again.")
        }
    }

    /// Back to the default mark: "folder" is the column's default, which ProjectMark draws as the square.
    private func removePhoto() async {
        photoBusy = true
        photoError = nil
        defer { photoBusy = false }
        do {
            _ = try await APIClient.shared.updateProject(projectId, fields: ["icon": "folder"])
            icon = "folder"
            await onChange()
        } catch {
            photoError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save — try again.")
        }
    }

    private func patch(_ fields: [String: Any]) async {
        if (try? await APIClient.shared.updateProject(projectId, fields: fields)) != nil { await onChange() }
        else { show(T("Couldn't save — try again.")) }
    }
    private func saveFinance() async {
        let wanted = finance
        if (try? await APIClient.shared.updateProject(projectId, fields: ["financeEnabled": wanted])) != nil { await onChange() }
        else { finance = !wanted; show(T("Couldn't save — try again.")) }
    }
    /// The whole hidden set goes up each time; keys this build does not know are kept as they are.
    private func setTab(_ key: String, shown: Bool) async {
        guard !key.isEmpty, !savingTabs else { return }
        let before = hiddenTabs
        var next = hiddenTabs.filter { $0 != key }
        if !shown { next.append(key) }
        hiddenTabs = next
        savingTabs = true
        do {
            _ = try await APIClient.shared.updateProject(projectId, fields: ["hiddenTabs": next])
            savingTabs = false
            await onChange()
        } catch let failure {
            savingTabs = false
            hiddenTabs = before
            show((failure as? LocalizedError)?.errorDescription ?? T("Couldn't save — try again."))
        }
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
    private func membersAdded(_ added: [ProjectDetail.ProjectMember]) async {
        let known = Set(projectMembers.map(\.uid))
        projectMembers.append(contentsOf: added.filter { !known.contains($0.uid) })
        if added.isEmpty { show(T("They're already in this project.")) }
        else if added.count == 1 { show(T("1 member added")) }
        else { show(String(format: T("%d members added"), added.count)) }
        await onChange()
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
