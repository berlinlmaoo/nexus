import Foundation

/// The last successful response for an endpoint, kept on disk.
///
/// Screens used to open on a spinner every single time — even reopening the leaderboard a minute
/// later refetched everything before drawing a single row. This stores the raw bytes so a screen
/// can render what it had immediately and refresh underneath, and so it still has something to
/// show with no signal at all.
///
/// Raw bytes, not decoded models, on purpose: the API models are `Decodable` only, and making
/// every one of them `Encodable` just to cache it would be a much wider change for no gain.
enum ResponseCache {
    /// Deliberately modest. This is a convenience cache, not offline storage — the attendance
    /// queue is what actually has to survive.
    private static let maxBytes = 8 << 20   // 8 MB

    private static let dir: URL = {
        let base = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        let d = base.appendingPathComponent("responses", isDirectory: true)
        try? FileManager.default.createDirectory(at: d, withIntermediateDirectories: true)
        return d
    }()

    /// Keys are endpoint-shaped ("leaderboard", "projects"), so they are turned into something
    /// safe for a filename rather than trusted as one.
    private static func url(_ key: String) -> URL {
        let safe = key.unicodeScalars.map { CharacterSet.alphanumerics.contains($0) ? Character($0) : "-" }
        return dir.appendingPathComponent(String(safe) + ".json")
    }

    static func save(_ key: String, _ data: Data) {
        guard data.count <= maxBytes else { return }
        try? data.write(to: url(key), options: .atomic)
    }

    /// Returns the stored bytes and when they were stored, so a screen can say how old what it is
    /// showing actually is. Data that silently looks live but is a day old is worse than a spinner.
    static func load(_ key: String) -> (data: Data, savedAt: Date)? {
        let u = url(key)
        guard let data = try? Data(contentsOf: u),
              let at = (try? FileManager.default.attributesOfItem(atPath: u.path))?[.modificationDate] as? Date
        else { return nil }
        return (data, at)
    }

    static func decoded<T: Decodable>(_ key: String, as type: T.Type) -> (value: T, savedAt: Date)? {
        guard let hit = load(key), let v = try? JSONDecoder().decode(T.self, from: hit.data) else { return nil }
        return (v, hit.savedAt)
    }

    /// Called on logout: a cached roster or task list must not outlive the session that fetched it.
    static func clearAll() {
        try? FileManager.default.removeItem(at: dir)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    }
}
