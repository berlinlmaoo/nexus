import Foundation
import Observation

/// Only one launch notice owns presentation. A notice already being read is never pre-empted.
@MainActor @Observable
final class StartupModalQueue {
    enum Notice: Int, CaseIterable { case xp, announcement, attendance, update, location }
    static let shared = StartupModalQueue()
    private(set) var owner: Notice?
    private var pending: Set<Notice> = []
    private var loading: Set<Notice> = [.announcement]
    func update(_ notice: Notice, pending: Bool, loading: Bool = false) {
        if pending { self.pending.insert(notice) } else { self.pending.remove(notice) }
        if loading { self.loading.insert(notice) } else { self.loading.remove(notice) }
        if owner == notice && !pending { owner = nil }
        choose()
    }
    func finish(_ notice: Notice) { pending.remove(notice); if owner == notice { owner = nil }; choose() }
    func reset() { owner = nil; pending = []; loading = [.announcement] }
    private func choose() {
        guard owner == nil else { return }
        for notice in Notice.allCases {
            if loading.contains(notice) { return }
            if pending.contains(notice) { owner = notice; return }
        }
    }
}
