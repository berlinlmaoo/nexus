import Foundation

/// The selection the editor started with is kept separately from live refreshes. Only deliberate
/// additions/removals travel to the server; another device's untouched additions stay there.
struct StringSetEdit {
    let added: [String]
    let removed: [String]
    init(base: Set<String>, selected: Set<String>) {
        added = selected.subtracting(base).sorted()
        removed = base.subtracting(selected).sorted()
    }
}

/// Task socket events are invalidations, never replacement cards. Ignore delayed events older than
/// a card already fetched over HTTP; unknown/missing timestamps still trigger the normal refetch.
struct TaskVersionTracker {
    private var held: [String: Date] = [:]
    mutating func remember(_ id: String, _ updatedAt: String?) {
        guard let date = Self.date(updatedAt) else { return }
        if held[id].map({ $0 < date }) ?? true { held[id] = date }
    }
    func accepts(_ id: String?, _ updatedAt: String?) -> Bool {
        guard let id, let incoming = Self.date(updatedAt), let current = held[id] else { return true }
        return incoming >= current
    }
    mutating func reset() { held.removeAll() }
    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: value) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: value)
    }
}

/// Undo moves only the dragged cards back before their original untouched neighbours. Replaying a
/// whole old lane order would also undo another person's intervening reorder or newly inserted cards.
struct TaskReorderMove: Equatable {
    let movedIds: [String]
    let beforeId: String?

    static func restoring(movedIds: Set<String>, in order: [String]) -> [TaskReorderMove] {
        var moves: [TaskReorderMove] = []
        var run: [String] = []
        for id in order {
            if movedIds.contains(id) { run.append(id) }
            else if !run.isEmpty {
                moves.append(TaskReorderMove(movedIds: run, beforeId: id))
                run = []
            }
        }
        if !run.isEmpty { moves.append(TaskReorderMove(movedIds: run, beforeId: nil)) }
        return moves
    }
}
