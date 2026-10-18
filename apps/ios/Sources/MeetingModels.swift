import Foundation

struct MeetingNote: Codable, Identifiable {
    struct Person: Codable { let id: String; let name: String?; let avatar: String? }
    struct Project: Codable { let id: String; let name: String; let icon: String? }
    struct Audio: Codable { let name: String; let mime: String; let bytes: Int; var received: Int; let available: Bool; let deletedAt: String?; let deleteAfter: String? }
    struct Document: Codable { let id: String; let title: String; let url: String }
    struct Permissions: Codable { let edit: Bool; let apply: Bool; let delete: Bool; let retry: Bool }
    struct Queue: Codable { let waiting: Bool; let position: Int?; let etaSec: Double }
    struct Segment: Codable { let start: Double; let end: Double; let text: String; let speaker: String? }
    struct Speaker: Codable { var name: String; var userId: String? }
    struct AppliedTask: Codable, Identifiable { let id: String; let title: String; let status: String?; let dueDate: String?; let projectId: String?; let assignees: [GideonTaskOptions.Member]? }
    let id: String
    var title: String
    var status: String
    var progress: Double
    var language: String
    let source: String
    var projectId: String?
    var project: Project?
    let createdBy: Person
    var audio: Audio
    let durationSec: Double?
    let recordedAt: String?
    let detectedLanguage: String?
    let tier: String?
    let doc: Document?
    let taskCount: Int
    let error: String?
    let errorCode: String?
    let appliedAt: String?
    var version: Int
    let createdAt: String
    let updatedAt: String
    let can: Permissions
    var queue: Queue?
    var overview: String?
    var mom: MeetingMinutes?
    var proposals: [MeetingTaskProposal]?
    var speakers: [String: Speaker]?
    let transcript: [Segment]?
    let tasks: [AppliedTask]?
    var members: [GideonTaskOptions.Member]?
    var working: Bool { ["UPLOADING", "QUEUED", "TRANSCRIBING", "SUMMARIZING", "APPLYING"].contains(status) }
    var selectedTasks: [MeetingTaskProposal] { (proposals ?? []).filter(\.include) }
    var canApplyDraft: Bool { can.apply && status == "READY" && !(projectId ?? "").isEmpty && !selectedTasks.contains { $0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty } }
}
struct MeetingMinutes: Codable, Equatable {
    struct Topic: Codable, Equatable { var title: String; var points: [String] }
    struct Action: Codable, Equatable { var text: String; var owner: String?; var due: String? }
    var attendees: [String] = []
    var topics: [Topic] = []
    var decisions: [String] = []
    var openQuestions: [String] = []
    var actionItems: [Action] = []
}
struct MeetingTaskProposal: Codable, Identifiable, Equatable {
    var key: String; var include: Bool; var title: String; var description: String
    var assigneeIds: [String]; var dueDate: String?; var actionIndex: Int?
    var id: String { key }
}
struct MeetingEnvelope: Decodable { let meeting: MeetingNote }
struct MeetingListResponse: Decodable {
    let meetings: [MeetingNote]
    let settings: Settings
    struct Settings: Decodable { let enabled: Bool; let maxMinutes: Int; let maxBytes: Int; let retentionDays: Int }
}
struct MeetingCreated: Decodable {
    let meeting: MeetingNote
    let upload: Upload
    struct Upload: Decodable { let chunkBytes: Int; let maxChunkBytes: Int }
}
struct MeetingChunkReply: Decodable { let received: Int; let complete: Bool }

enum MeetingIssue {
    static func message(_ code: String, metadata: [String: Any] = [:]) -> String? {
        switch code.lowercased() {
        case "too_large": return String(format: T("This recording is too large. Maximum size: %@."), AppNumber.bytes(metadata["maxBytes"] as? Int ?? RemoteConfigDefaults.maxBytes))
        case "too_long": return String(format: T("This recording is too long. Maximum length: %@ min."), AppNumber.int(metadata["maxMinutes"] as? Int ?? 180))
        case "unsupported_type": return T("Choose an audio file: M4A, MP3, WAV, WebM, OGG, AAC or FLAC.")
        case "empty_file": return T("This file is empty. Choose another file.")
        case "undecodable": return T("This recording couldn't be read. Try another audio file.")
        case "no_speech": return T("No speech was found in this recording.")
        case "audio_gone", "audio_missing": return T("The audio is no longer available.")
        case "upload_abandoned": return T("This upload expired. Upload the recording again.")
        case "transcriber_unreachable": return T("The transcription server can't be reached. Try again later.")
        case "transcribe_failed": return T("The recording couldn't be transcribed. Try again.")
        case "gpu_busy": return T("The office GPU was busy for too long. Try again.")
        case "gideon_failed": return T("GIDEON couldn't write the minutes. Try again.")
        case "gideon_off": return T("GIDEON is unavailable right now. Try again later.")
        case "credits_exhausted": return T("You're out of GIDEON credits. Try again when they reset.")
        case "owner_gone": return T("The uploader no longer has access to this workspace.")
        case "deleted": return T("This meeting was deleted")
        case "disabled": return T("Meeting notes is unavailable right now.")
        case "too_many_uploads": return T("Finish an existing upload before starting another (maximum 3).")
        case "rate_limited": return T("Too many recordings uploaded. Try again later.")
        case "chunk_too_large": return T("This upload chunk is too large. Try the upload again.")
        case "not_ready": return T("The meeting notes aren't ready to apply yet.")
        case "needs_project": return T("Choose a project before applying the minutes.")
        case "no_section": return T("Add a task column to this project first.")
        case "needs_edit_access": return T("You need Can edit or Full access to this project.")
        case "owner_only": return T("Only the uploader can change the meeting's project.")
        default: return nil
        }
    }
    private enum RemoteConfigDefaults { static let maxBytes = 500 * 1_048_576 }
}

/// Persist app-relative paths so an app update can relocate its data container.
/// Accept the earlier absolute-path manifests, but always resolve inside the current private folder.
enum MeetingStorage {
    static func resolve(_ saved: String, in folder: URL) -> URL? {
        let relative: String
        if saved.hasPrefix("/") {
            guard let range = saved.range(of: "/" + folder.lastPathComponent + "/", options: .backwards) else { return nil }
            relative = String(saved[range.upperBound...])
        } else { relative = saved }
        let parts = relative.split(separator: "/", omittingEmptySubsequences: false)
        guard !parts.isEmpty, parts.allSatisfy({ !$0.isEmpty && $0 != "." && $0 != ".." }) else { return nil }
        return folder.appendingPathComponent(relative).standardizedFileURL
    }
}
