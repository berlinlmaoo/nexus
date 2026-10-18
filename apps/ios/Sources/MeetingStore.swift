import Foundation
import Observation

@MainActor @Observable
final class MeetingStore {
    let id: String
    var meeting: MeetingNote?
    var failure: String?
    var notice: String?
    var busy = false
    var saving = false
    var deleted = false
    private var pending: [String: Any] = [:]
    @ObservationIgnored private var debounce: Task<Void, Never>?
    @ObservationIgnored private var saveWorker: Task<Bool, Never>?
    private var latestEventVersion = 0
    init(id: String) { self.id = id }
    var hasUnsaved: Bool { !pending.isEmpty || saving }
    func load() async {
        do {
            let response: MeetingEnvelope = try await NativeAPI.request("/api/meetings/" + NativeAPI.escape(id))
            guard !hasUnsaved else { latestEventVersion = max(latestEventVersion, response.meeting.version); return }
            meeting = response.meeting; failure = nil
        } catch { if !Task.isCancelled { failure = error.localizedDescription } }
    }
    func change(_ fields: [String: Any], edit: (inout MeetingNote) -> Void) {
        guard var current = meeting else { return }
        edit(&current); meeting = current
        pending.merge(fields) { _, new in new }
        debounce?.cancel()
        debounce = Task {
            try? await Task.sleep(for: .milliseconds(650))
            if !Task.isCancelled { _ = await flush() }
        }
    }
    func updateMinutes(_ edit: (inout MeetingMinutes) -> Void) {
        var mom = meeting?.mom ?? MeetingMinutes(); edit(&mom)
        guard let object = try? NativeAPI.object(mom) else { return }
        change(["mom": object]) { $0.mom = mom }
    }
    func updateProposals(_ edit: (inout [MeetingTaskProposal]) -> Void) {
        var proposals = meeting?.proposals ?? []; edit(&proposals)
        guard let object = try? NativeAPI.object(proposals) else { return }
        change(["proposals": object]) { $0.proposals = proposals }
    }
    func setSpeaker(_ key: String, name: String, userId: String? = nil) {
        var map = meeting?.speakers ?? [:]
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { map[key] = nil }
        else {
            let matches = (meeting?.members ?? []).filter { $0.name?.caseInsensitiveCompare(trimmed) == .orderedSame }
            map[key] = .init(name: name, userId: userId ?? (matches.count == 1 ? matches.first?.id : nil), auto: nil)
        }
        guard let object = try? NativeAPI.object(map) else { return }
        change(["speakers":object]) { $0.speakers = map }
    }
    @discardableResult func flush() async -> Bool {
        if let worker = saveWorker { return await worker.value }
        guard !pending.isEmpty else { return true }
        let worker = Task { await self.savePending() }; saveWorker = worker
        let result = await worker.value; saveWorker = nil
        if result && !hasUnsaved && latestEventVersion > (meeting?.version ?? 0) { latestEventVersion = 0; await load() }
        return result
    }
    private func savePending() async -> Bool {
        saving = true; defer { saving = false }
        while !pending.isEmpty {
            guard let current = meeting else { return false }
            let fields = pending; pending = [:]
            var body = fields; body["version"] = current.version
            do {
                let response: MeetingEnvelope = try await NativeAPI.request("/api/meetings/" + NativeAPI.escape(id), method: "PATCH", body: body)
                if pending.isEmpty { meeting = response.meeting }
                else { meeting?.version = response.meeting.version }
                failure = nil
                if fields["speakers"] != nil && response.meeting.status == "READY" { notice = T("Saved. To use the new names in the minutes, choose Write the minutes again.") }
            } catch let error as NativeAPIError where error.code == "VERSION_CONFLICT" {
                if let current = try? JSONDecoder().decode(MeetingEnvelope.self, from: error.data) { meeting = current.meeting }
                pending = [:]
                notice = T("Someone else changed these minutes. Their version is shown now.")
                return false
            } catch {
                pending = fields.merging(pending) { _, latest in latest }
                failure = error.localizedDescription
                return false
            }
        }
        return true
    }
    func event(_ json: String) async {
        struct Event: Decodable { let meetingId: String; let status: String?; let progress: Double?; let version: Int?; let deleted: Bool? }
        guard let event = try? JSONDecoder().decode(Event.self, from: Data(json.utf8)), event.meetingId == id else { return }
        if event.deleted == true { MeetingUploads.shared.cancelAndRemove(id); deleted = true; return }
        if let version = event.version, let current = meeting, version <= current.version { return }
        if hasUnsaved { latestEventVersion = max(latestEventVersion, event.version ?? 0); return }
        if let status = event.status, let current = meeting, status == current.status,
           ["UPLOADING", "TRANSCRIBING", "SUMMARIZING"].contains(status), current.queue?.waiting != true {
            if let progress = event.progress { meeting?.progress = progress }
            if let version = event.version { meeting?.version = version }
        } else { await load() }
    }
    func apply() async {
        guard !busy, await flush(), let current = meeting, current.canApplyDraft else { return }
        busy = true; defer { busy = false }
        do {
            let response: MeetingEnvelope = try await NativeAPI.request("/api/meetings/" + NativeAPI.escape(id) + "/apply", method: "POST", body: ["projectId": current.projectId!, "title": current.title, "overview": current.overview ?? "", "mom": try NativeAPI.object(current.mom ?? MeetingMinutes()), "proposals": try NativeAPI.object(current.proposals ?? []), "lang": AppLanguage.shared.lang.rawValue])
            meeting = response.meeting; failure = nil; await load()
        } catch let error as NativeAPIError where error.code == "ALREADY_APPLIED" {
            if let response = try? JSONDecoder().decode(MeetingEnvelope.self, from: error.data) { meeting = response.meeting }; failure = nil; await load()
        } catch { failure = error.localizedDescription }
    }
    func retry(minutes: Bool = false) async {
        guard !busy, await flush() else { return }; busy = true; defer { busy = false }
        do {
            let response: MeetingEnvelope = try await NativeAPI.request("/api/meetings/" + NativeAPI.escape(id) + "/retry", method: "POST", body: minutes ? ["stage":"minutes"] : [:])
            meeting = response.meeting; failure = nil
        } catch { failure = error.localizedDescription }
    }
    func remove() async {
        guard !busy else { return }; busy = true; defer { busy = false }
        do {
            let _: NativeAPI.Empty = try await NativeAPI.request("/api/meetings/" + NativeAPI.escape(id), method: "DELETE")
            debounce?.cancel(); pending = [:]; MeetingUploads.shared.cancelAndRemove(id); deleted = true
        } catch { failure = error.localizedDescription }
    }
    func changeProject(_ projectId: String?) async {
        guard !busy, await flush() else { return }
        var proposals = meeting?.proposals ?? []
        for i in proposals.indices { proposals[i].assigneeIds = [] }
        var fields: [String: Any] = ["projectId": jsonOrNull(projectId)]
        if meeting?.status == "READY" { fields["proposals"] = try? NativeAPI.object(proposals) }
        change(fields) { $0.projectId = projectId; $0.proposals = proposals; $0.members = [] }
        if await flush() { await load() }
    }
}
