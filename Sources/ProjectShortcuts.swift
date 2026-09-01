import Foundation
import Observation

/// One project as it appears in the sidebar: just enough to draw the row and open the board.
struct ProjectRef: Codable, Hashable, Identifiable {
    let id: String
    var name: String
}

/// Pinned and recently-opened projects, kept on the device.
///
/// Deliberately local rather than server-side. "Which projects do I keep coming back to" is a
/// property of a person at a desk, not of the project — the same account on a phone and an iPad
/// reasonably wants different shortcuts, and syncing it would need an API that does not exist.
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

    func togglePin(_ ref: ProjectRef) {
        if let i = pinned.firstIndex(where: { $0.id == ref.id }) {
            pinned.remove(at: i)
        } else {
            pinned.append(ref)
        }
        Self.save(pinned, Self.pinnedKey)
    }

    /// Call on every open. Moves an existing entry to the front instead of duplicating it, and
    /// refreshes the stored name so a renamed project doesn't keep its old label in the sidebar.
    func visit(_ ref: ProjectRef) {
        recent.removeAll { $0.id == ref.id }
        recent.insert(ref, at: 0)
        if recent.count > Self.recentLimit { recent.removeLast(recent.count - Self.recentLimit) }
        Self.save(recent, Self.recentKey)

        if let i = pinned.firstIndex(where: { $0.id == ref.id }), pinned[i].name != ref.name {
            pinned[i].name = ref.name
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
