import Foundation
import Observation
import SwiftUI

/// One durable source file and at most one background task per meeting. Server received-offset wins.
@MainActor @Observable
final class MeetingUploads {
    static let shared = MeetingUploads()
    static let sessionID = "id.znetworks.nexus.meeting-audio"
    struct Job: Codable, Identifiable {
        let id: String
        var ownerId: String
        let server: String
        let source: String
        let bytes: Int
        let chunkBytes: Int
        var received: Int
        var chunkFile: String?
        var recordingSource: String?
    }
    private(set) var jobs: [String: Job] = [:]
    private(set) var failures: [String: String] = [:]
    private(set) var fractions: [String: Double] = [:]
    private(set) var completed: [String: MeetingNote] = [:]
    @ObservationIgnored private var active: Set<String> = []
    @ObservationIgnored private var handlers: [() -> Void] = []
    @ObservationIgnored private lazy var delegate = MeetingUploadDelegate(owner: self)
    @ObservationIgnored private lazy var session: URLSession = {
        let config = URLSessionConfiguration.background(withIdentifier: Self.sessionID)
        config.isDiscretionary = false
        config.sessionSendsLaunchEvents = true
        config.httpMaximumConnectionsPerHost = 2
        config.timeoutIntervalForRequest = 120
        config.timeoutIntervalForResource = 24 * 3600
        return URLSession(configuration: config, delegate: delegate, delegateQueue: .main)
    }()
    private let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MeetingUploads", isDirectory: true)
    private var manifest: URL { folder.appendingPathComponent("uploads.json") }
    private init() {
        if let data = try? Data(contentsOf: manifest), let saved = try? JSONDecoder().decode([String: Job].self, from: data) { jobs = saved }
    }
    func begin(file: URL, title: String, projectId: String?, language: String, source: String, duration: Double?, speakerLabels: Bool = true, introEndSec: Double? = nil) async throws -> MeetingNote {
        guard let user = Keychain.load() else { throw APIError.unauthorized }
        let scoped = file.startAccessingSecurityScopedResource(); defer { if scoped { file.stopAccessingSecurityScopedResource() } }
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: file.path) else { throw APIError.transport(T("This recording couldn't be read. Try another audio file.")) }
        let bytes = (attributes[.size] as? NSNumber)?.intValue ?? 0
        guard bytes > 0 else { throw APIError.transport(T("This file is empty. Choose another file.")) }
        guard bytes <= RemoteConfig.shared.meetingMaxBytes else { throw APIError.transport(MeetingIssue.message("too_large", metadata: ["maxBytes":RemoteConfig.shared.meetingMaxBytes])!) }
        if let duration, duration > Double(RemoteConfig.shared.meetingMaxMinutes * 60) { throw APIError.transport(MeetingIssue.message("too_long", metadata: ["maxMinutes":RemoteConfig.shared.meetingMaxMinutes])!) }
        let privateFolder = folder.appendingPathComponent(UUID().uuidString, isDirectory: true)
        let privateFile = privateFolder.appendingPathComponent(file.lastPathComponent)
        try await Task.detached(priority: .utility) {
            try FileManager.default.createDirectory(at: privateFolder, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: file, to: privateFile)
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: privateFile.path)
        }.value
        do {
            let body: [String: Any] = ["fileName":file.lastPathComponent, "mime":Self.mime(file.pathExtension), "size":bytes, "title":title, "projectId":jsonOrNull(projectId), "language":language, "source":source, "durationSec":duration.map { $0 as Any } ?? NSNull(), "recordedAt":ISO8601DateFormatter().string(from: Date()), "speakerLabels":speakerLabels, "introEndSec":(speakerLabels ? introEndSec : nil).map { $0 as Any } ?? NSNull()]
            let response: MeetingCreated = try await NativeAPI.request("/api/meetings", method: "POST", body: body)
            let job = Job(id: response.meeting.id, ownerId: user.userId, server: ServerEnvironment.current.rawValue, source: privateFolder.lastPathComponent + "/" + privateFile.lastPathComponent, bytes: bytes, chunkBytes: min(response.upload.maxChunkBytes, max(1, response.upload.chunkBytes)), received: response.meeting.audio.received, recordingSource: source == "record" ? file.path : nil)
            jobs[job.id] = job; save()
            Task { await schedule(job.id, reconcile: true) }
            return response.meeting
        } catch { try? FileManager.default.removeItem(at: privateFolder); throw error }
    }
    func resumeForCurrentUser() async {
        _ = session
        let tasks = await session.allTasks
        let running = Set(tasks.compactMap { $0.taskDescription?.split(separator: ":", maxSplits: 1).first.map(String.init) })
        for task in tasks {
            guard let id = task.taskDescription?.split(separator: ":", maxSplits: 1).first.map(String.init), let job = jobs[id], isCurrent(job) else { task.cancel(); continue }
            active.insert(id)
        }
        for job in jobs.values where isCurrent(job) && !running.contains(job.id) && !active.contains(job.id) { await schedule(job.id, reconcile: true) }
    }
    /// `keepRecording`: the person cancelled the upload, so a recording made here stays for another try.
    func cancelAndRemove(_ id: String, keepRecording: Bool = false) {
        guard let job = jobs[id], isCurrent(job) else { return }
        session.getAllTasks { tasks in for task in tasks where task.taskDescription?.hasPrefix(id + ":") == true { task.cancel() } }
        finish(id, keepRecording: keepRecording); completed[id] = nil; fractions[id] = nil
    }
    /// Bytes on the server plus the running chunk's bytes sent: the same source as the progress bar.
    func sentBytes(_ id: String) -> Int? {
        guard let job = jobs[id] else { return nil }
        guard let fraction = fractions[id] else { return job.received }
        return min(job.bytes, max(job.received, Int((fraction * Double(job.bytes)).rounded())))
    }
    func retry(_ id: String) async { failures[id] = nil; await schedule(id, reconcile: true) }
    func isCurrent(_ job: Job) -> Bool { job.ownerId == Keychain.load()?.userId && job.server == ServerEnvironment.current.rawValue }
    func rebindIdentity(from old: String, to new: String) {
        for key in jobs.keys where jobs[key]?.ownerId == old { jobs[key]?.ownerId = new }; save()
    }
    func suspendForLogout() {
        session.getAllTasks { tasks in for task in tasks { task.cancel() } }
        active = []
    }
    func handleBackgroundEvents(completion: @escaping () -> Void) { handlers.append(completion); _ = session }
    func finishBackgroundEvents() { let callbacks = handlers; handlers = []; callbacks.forEach { $0() } }
    func progress(_ description: String?, sent: Int64) {
        guard let id = description?.split(separator: ":", maxSplits: 1).first.map(String.init), let job = jobs[id], isCurrent(job) else { return }
        fractions[id] = min(1, Double(job.received + Int(sent)) / Double(max(1, job.bytes)))
    }
    private func schedule(_ id: String, reconcile: Bool = false) async {
        guard !active.contains(id), var job = jobs[id], isCurrent(job) else { return }
        active.insert(id)
        do {
            if reconcile {
                let response: MeetingEnvelope = try await NativeAPI.request("/api/meetings/" + NativeAPI.escape(id))
                if response.meeting.status != "UPLOADING" { completed[id] = response.meeting; finish(id); return }
                job.received = response.meeting.audio.received
            }
            guard isCurrent(job), let sourceURL = MeetingStorage.resolve(job.source, in: folder), FileManager.default.fileExists(atPath: sourceURL.path) else { throw APIError.transport(T("The local recording is missing. Choose the file again.")) }
            guard job.received >= 0 && job.received <= job.bytes else { throw APIError.decoding }
            let completing = job.received == job.bytes
            let chunk = sourceURL.deletingLastPathComponent().appendingPathComponent(completing ? "complete.json" : "chunk-\(job.received).bin")
            if completing { try Data("{}".utf8).write(to: chunk, options: .atomic) }
            else {
                let offset = job.received, count = min(job.chunkBytes, job.bytes - job.received)
                try await Task.detached(priority: .utility) {
                    let file = try FileHandle(forReadingFrom: sourceURL); defer { try? file.close() }
                    try file.seek(toOffset: UInt64(offset))
                    guard let data = try file.read(upToCount: count), data.count == count else { throw APIError.decoding }
                    try data.write(to: chunk, options: .atomic)
                }.value
            }
            try? FileManager.default.setAttributes([.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication], ofItemAtPath: chunk.path)
            guard isCurrent(job) else { active.remove(id); return }
            job.chunkFile = chunk.path; jobs[id] = job; save()
            var request = APIClient.shared.makeRequest("/api/meetings/" + NativeAPI.escape(id) + (completing ? "/audio/complete" : "/audio?offset=\(job.received)"), method: completing ? "POST" : "PUT")
            request.setValue(completing ? "application/json" : "application/octet-stream", forHTTPHeaderField: "Content-Type")
            request.timeoutInterval = 120
            let task = session.uploadTask(with: request, fromFile: chunk)
            task.taskDescription = id + ":" + (completing ? "complete" : String(job.received))
            task.resume()
        } catch { active.remove(id); failures[id] = error.localizedDescription; save() }
    }
    func received(_ description: String?, status: Int, data: Data, error: Error?) async {
        guard let description else { return }
        let parts = description.split(separator: ":", maxSplits: 1).map(String.init)
        guard parts.count == 2, var job = jobs[parts[0]] else { return }
        let id = job.id; active.remove(id)
        if let path = job.chunkFile { try? FileManager.default.removeItem(atPath: path); job.chunkFile = nil }
        jobs[id] = job
        guard isCurrent(job) else { save(); return }
        if let error { failures[id] = APIError.nothingAnswered(error).localizedDescription; save(); return }
        if (200..<300).contains(status) {
            if parts[1] == "complete" {
                guard let response = try? JSONDecoder().decode(MeetingEnvelope.self, from: data) else { failures[id] = APIError.decoding.localizedDescription; return }
                completed[id] = response.meeting; finish(id)
                NotificationCenter.default.post(name: .nexusMeetingChanged, object: nil, userInfo: [RealtimeKey.json:"{\"meetingId\":\"\(id)\"}"])
            } else if let response = try? JSONDecoder().decode(MeetingChunkReply.self, from: data), response.received > job.received && response.received <= job.bytes {
                job.received = response.received; jobs[id] = job; fractions[id] = Double(job.received) / Double(max(1, job.bytes)); failures[id] = nil; save(); await schedule(id)
            } else { failures[id] = APIError.decoding.localizedDescription; save() }
            return
        }
        let refusal = NativeAPIError(status: status, data: data, path: "/api/meetings/" + id)
        if ["OFFSET_MISMATCH", "INCOMPLETE"].contains(refusal.code), let offset = refusal.fields["received"] as? Int, offset >= 0 && offset <= job.bytes {
            job.received = offset; jobs[id] = job; save(); await schedule(id)
        } else if refusal.code == "NOT_UPLOADING" { await schedule(id, reconcile: true) }
        else { failures[id] = status == 401 ? T("Session expired — please log in again.") : refusal.localizedDescription; save() }
    }
    private func finish(_ id: String, keepRecording: Bool = false) {
        if let job = jobs.removeValue(forKey: id) {
            if let source = MeetingStorage.resolve(job.source, in: folder) { try? FileManager.default.removeItem(at: source.deletingLastPathComponent()) }
            if !keepRecording, let source = job.recordingSource { MeetingRecorder.shared.uploaded(source) }
        }
        active.remove(id); fractions[id] = 1; failures[id] = nil; save()
    }
    private func save() { try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true); if let data = try? JSONEncoder().encode(jobs) { try? data.write(to: manifest, options: .atomic) } }
    static let extensions: Set<String> = ["m4a","mp4","mov","mp3","wav","webm","ogg","oga","opus","aac","flac","3gp","amr"]
    static func mime(_ ext: String) -> String {
        ["m4a":"audio/mp4","mp4":"audio/mp4","mov":"video/quicktime","mp3":"audio/mpeg","wav":"audio/wav","webm":"audio/webm","ogg":"audio/ogg","oga":"audio/ogg","opus":"audio/ogg","aac":"audio/aac","flac":"audio/flac","3gp":"audio/3gpp","amr":"audio/amr"][ext.lowercased()] ?? "application/octet-stream"
    }
}

private final class MeetingUploadDelegate: NSObject, URLSessionDataDelegate, URLSessionTaskDelegate {
    private weak var owner: MeetingUploads?
    private var data: [Int: Data] = [:]
    init(owner: MeetingUploads) { self.owner = owner }
    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive bytes: Data) {
        if (data[dataTask.taskIdentifier]?.count ?? 0) < 262_144 { data[dataTask.taskIdentifier, default: Data()].append(bytes) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didSendBodyData bytesSent: Int64, totalBytesSent: Int64, totalBytesExpectedToSend: Int64) {
        Task { @MainActor in owner?.progress(task.taskDescription, sent: totalBytesSent) }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        let body = data.removeValue(forKey: task.taskIdentifier) ?? Data()
        Task { @MainActor in await owner?.received(task.taskDescription, status: (task.response as? HTTPURLResponse)?.statusCode ?? 0, data: body, error: error) }
    }
    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) { Task { @MainActor in owner?.finishBackgroundEvents() } }
}

struct MeetingUploadStatus: View {
    let meetingId: String
    @State private var uploads = MeetingUploads.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let job = uploads.jobs[meetingId], uploads.isCurrent(job) {
                // Bar and label read the same live byte count (R-5: the label stayed at 0 B while the bar moved).
                MeetingUploadBytes(sent: uploads.sentBytes(meetingId) ?? job.received, total: job.bytes)
            }
            if let failure = uploads.failures[meetingId] { Text(failure).font(NXFont.text(12)).foregroundStyle(NX.danger); Button(T("Resume upload")) { Task { await uploads.retry(meetingId) } }.buttonStyle(.nxBordered) }
        }
    }
}

/// The upload bar and "12.4 MB of 31.1 MB · 40 %", drawn from one byte count.
struct MeetingUploadBytes: View {
    let sent: Int
    let total: Int
    var body: some View {
        let fraction = Double(sent) / Double(max(1, total))
        VStack(alignment: .leading, spacing: 6) {
            ProgressView(value: fraction).tint(NX.violet)
            Text(String(format: T("%@ of %@ · %@"), AppNumber.bytes(sent), AppNumber.bytes(total), AppNumber.int(Int((fraction * 100).rounded(.down))) + " %"))
                .font(NXFont.text(12)).monospacedDigit().foregroundStyle(NX.mutedFg).accessibilityIdentifier("meetings.upload.bytes")
        }
    }
}
