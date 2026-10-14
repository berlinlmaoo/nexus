import SwiftUI
import Observation

// ─────────────────────────────────────────────────────────────────────────────
// The sidebar's folder tree (iPad / Mac), as the web's SidebarProjectTree: under Projects, "Folders"
// and each folder as a row that opens to its subfolders and projects (UI tour run 9, P11). Plain List
// rows and DisclosureGroups, so selection, keyboard and VoiceOver behave like every other sidebar row.
// ─────────────────────────────────────────────────────────────────────────────

@MainActor
@Observable
final class SidebarFolderStore {
    static let shared = SidebarFolderStore()

    private(set) var folders: [ProjectFolder] = []
    private(set) var projects: [Project] = []
    /// Folders opened in the sidebar (closed by default, as on the web).
    var expanded: Set<String> = []

    func load(workspaceId: String?) async {
        async let f = try? APIClient.shared.projectFolders(workspaceId: workspaceId)
        async let p = try? APIClient.shared.projects()
        let (folderList, projectList) = await (f, p)
        if let folderList { folders = folderList }
        if let projectList { projects = projectList }
    }

    private func sorted(_ list: [ProjectFolder]) -> [ProjectFolder] {
        list.sorted { ($0.position ?? 0, $0.name) < ($1.position ?? 0, $1.name) }
    }

    /// Top-level folders: no parent, or a parent this list does not hold.
    var roots: [ProjectFolder] {
        let ids = Set(folders.map(\.id))
        return sorted(folders.filter { $0.parentFolderId.map { !ids.contains($0) } ?? true })
    }

    func children(of id: String) -> [ProjectFolder] { sorted(folders.filter { $0.parentFolderId == id }) }

    func projects(in id: String) -> [Project] {
        projects.filter { $0.folderId == id }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    /// What the row's count says: its projects and subfolders, as the Projects screen counts them.
    func count(_ id: String) -> Int { projects(in: id).count + children(of: id).count }
}

/// One folder row in the sidebar, opening to its subfolders and projects.
struct SidebarFolderNode: View {
    let folder: ProjectFolder
    let store: SidebarFolderStore
    var depth = 0

    private var isExpanded: Binding<Bool> {
        Binding(get: { store.expanded.contains(folder.id) },
                set: { on in if on { store.expanded.insert(folder.id) } else { store.expanded.remove(folder.id) } })
    }

    var body: some View {
        DisclosureGroup(isExpanded: isExpanded) {
            // Three levels at most (FolderTree.maxDepth), so the recursion stays shallow.
            ForEach(store.children(of: folder.id)) { sub in
                SidebarFolderNode(folder: sub, store: store, depth: depth + 1)
            }
            ForEach(store.projects(in: folder.id)) { p in
                let ref = ProjectRef(id: p.id, name: p.name, icon: p.icon, color: p.color)
                HStack(spacing: 10) {
                    ProjectRefIcon(ref: ref, size: 20)
                    Text(p.name).font(NXFont.text(15)).lineLimit(1).modifier(SidebarSelection.TextColor())
                }
                .tag(NXSelection.project(ref))
                .modifier(MacSidebarRowInsets())
                .contextMenu {
                    Button { ProjectShortcuts.shared.togglePin(ref) } label: {
                        Label(ProjectShortcuts.shared.isPinned(ref.id) ? T("Unpin") : T("Pin"),
                              systemImage: ProjectShortcuts.shared.isPinned(ref.id) ? "pin.slash" : "pin")
                    }
                }
            }
        } label: {
            HStack(spacing: 8) {
                SidebarFolderGlyph(folder: folder)
                Text(folder.name).font(NXFont.text(15)).lineLimit(1)
                Spacer(minLength: 4)
                Text("\(store.count(folder.id))").font(NXFont.text(12)).monospacedDigit().foregroundStyle(NX.mutedFg)
            }
            .accessibilityElement(children: .combine)
        }
        .modifier(MacSidebarRowInsets())
    }
}

/// A folder's mark at sidebar size: its photo, its own emoji, else a folder outline in its colour
/// (FolderIconTile's rules, 20 pt).
struct SidebarFolderGlyph: View {
    let folder: ProjectFolder
    private static let folderish: Set<String> = ["📁", "📂", "🗂️", "🗂", "folder"]

    private var tint: Color {
        guard let hex = folder.color, hex.hasPrefix("#"), hex.count == 7 else { return NX.mutedFg }
        let v = Int(hex.dropFirst(), radix: 16) ?? 0
        let r = (v >> 16) & 0xff, g = (v >> 8) & 0xff, b = v & 0xff
        return (r + g + b) < 120 ? NX.foreground : Color(hex: hex)
    }

    var body: some View {
        ZStack {
            if folder.isUploadedIcon {
                CachedImage(url: URL(string: Config.baseURL.absoluteString + (folder.icon ?? ""))) { img in
                    img.resizable().scaledToFill()
                } placeholder: { Image(systemName: "folder").font(.system(size: 14)).foregroundStyle(tint) }
                .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
            } else if let icon = folder.icon?.trimmingCharacters(in: .whitespaces), !icon.isEmpty,
                      !Self.folderish.contains(icon.lowercased()), folder.emoji != "📁" {
                Text(folder.emoji).font(.system(size: 14))
            } else {
                Image(systemName: "folder").font(.system(size: 14, weight: .regular)).foregroundStyle(tint)
            }
        }
        .frame(width: 20, height: 20)
        .accessibilityHidden(true)
    }
}
