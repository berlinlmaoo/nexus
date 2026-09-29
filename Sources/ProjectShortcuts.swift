import Foundation
import Observation

/// One project as it appears in the sidebar: just enough to draw the row and open the board.
struct ProjectRef: Codable, Hashable, Identifiable {
    let id: String
    var name: String
    /// Same shape as Project.icon: a path beginning with "/" for an uploaded picture, otherwise an
    /// emoji. Optional because the first visit records the row before the board has loaded.
    var icon: String?

    var isUploadedIcon: Bool { (icon ?? "").hasPrefix("/") }
    var emoji: String? {
        guard let icon, !icon.isEmpty, !isUploadedIcon, isEmojiIcon(icon) else { return nil }
        return icon
    }
}

/// Pinned and recently-opened projects.
///
/// Pins are the person's, on every device: they live on the server (`/api/projects/pins`, the list
/// the web sidebar pins into) and this keeps a copy so the sidebar draws before the network answers
/// (owner, 29 Sep 2026). Recents stay on the device — what was opened here is about this device.
///
/// Recents are recorded by ProjectDetailView itself rather than by whatever opened it, so a project
/// counts as visited no matter the route in: the projects list, the sidebar, or a link from a task.
@Observable
final class ProjectShortcuts {
    static let shared = ProjectShortcuts()

    private static let pinnedKey = "nexus.projects.pinned"
    private static let recentKey = "nexus.projects.recent"
    /// Enough to be useful, few enough that the sidebar still reads as navigation and not a list.
    private static let recentLimit = 5

    private(set) var pinned: [ProjectRef] = []
    private(set) var recent: [ProjectRef] = []

    private init() {
        pinned = Self.load(Self.pinnedKey)
        recent = Self.load(Self.recentKey)
    }

    func isPinned(_ id: String) -> Bool { pinned.contains { $0.id == id } }

    /// Changed here at once, then on the server; a refusal puts it back so the two never disagree.
    @MainActor func togglePin(_ ref: ProjectRef) {
        let nowPinned: Bool
        if let i = pinned.firstIndex(where: { $0.id == ref.id }) {
            pinned.remove(at: i)
            nowPinned = false
        } else {
            pinned.append(ref)
            nowPinned = true
        }
        Self.save(pinned, Self.pinnedKey)
        Task { @MainActor in
            do {
                try await APIClient.shared.setProjectPin(ref.id, pinned: nowPinned)
            } catch {
                if nowPinned { pinned.removeAll { $0.id == ref.id } } else if !isPinned(ref.id) { pinned.append(ref) }
                Self.save(pinned, Self.pinnedKey)
            }
        }
    }

    /// Takes the server's list as the truth: its order, and only projects this person can still
    /// open (the same filter the web sidebar applies). Pins made on this device before pins were
    /// synced are sent up once, so nobody loses the ones they had.
    @MainActor func syncPins() async {
        guard var ids = try? await APIClient.shared.projectPins() else { return }
        if !UserDefaults.standard.bool(forKey: Self.pinsUploadedKey) {
            for ref in pinned where !ids.contains(ref.id) {
                if (try? await APIClient.shared.setProjectPin(ref.id, pinned: true)) != nil { ids.append(ref.id) }
            }
            UserDefaults.standard.set(true, forKey: Self.pinsUploadedKey)
        }
        var known = Dictionary((pinned + recent).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        if let list = try? await APIClient.shared.projects() {
            var visible: [String: ProjectRef] = [:]
            for p in list { visible[p.id] = ProjectRef(id: p.id, name: p.name, icon: p.icon ?? known[p.id]?.icon) }
            known = visible
        }
        let synced = ids.compactMap { known[$0] }
        if synced != pinned {
            pinned = synced
            Self.save(pinned, Self.pinnedKey)
        }
    }
    private static let pinsUploadedKey = "nexus.projects.pinsUploaded"


    /// Call on every open. Moves an existing entry to the front instead of duplicating it, and
    /// refreshes the stored name so a renamed project doesn't keep its old label in the sidebar.
    ///
    /// A board is opened before it is loaded, so the first call of a visit carries no icon. Keeping
    /// the one already stored means the row doesn't flash back to a placeholder every time.
    func visit(_ ref: ProjectRef) {
        var ref = ref
        if ref.icon == nil {
            ref.icon = (recent + pinned).first { $0.id == ref.id }?.icon
        }
        recent.removeAll { $0.id == ref.id }
        recent.insert(ref, at: 0)
        if recent.count > Self.recentLimit { recent.removeLast(recent.count - Self.recentLimit) }
        Self.save(recent, Self.recentKey)

        if let i = pinned.firstIndex(where: { $0.id == ref.id }), pinned[i] != ref {
            pinned[i] = ref
            Self.save(pinned, Self.pinnedKey)
        }
    }

    /// A project the user can no longer reach would otherwise sit in the sidebar forever.
    func forget(_ id: String) {
        recent.removeAll { $0.id == id }
        pinned.removeAll { $0.id == id }
        Self.save(recent, Self.recentKey)
        Self.save(pinned, Self.pinnedKey)
    }

    private static func load(_ key: String) -> [ProjectRef] {
        guard let data = UserDefaults.standard.data(forKey: key) else { return [] }
        return (try? JSONDecoder().decode([ProjectRef].self, from: data)) ?? []
    }

    private static func save(_ refs: [ProjectRef], _ key: String) {
        guard let data = try? JSONEncoder().encode(refs) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }
}
