import Foundation
import Observation
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Z Vault uploads, owned by the app rather than by a screen (owner, 9 Oct 2026: "progress upload
// ga detail. harusnya pop up aja di tengah yang bisa di minimize … bisa jalan di background,
// keliatan juga lagi upload berapa file dan progress per MB-nya").
//
// VaultView hands files over and can be left: the queue keeps going while the person browses
// elsewhere, and the panel (VaultUploadPanel.swift, an overlay on RootView) shows it from anywhere.
//
// One file at a time. The server caps how many chunked uploads one person may have open, and one
// at a time is also what makes "Uploading 2 of 5" true. The transport is the vault's own
// (`vaultUpload` / `vaultReplace`: one request up to 64 MB, 16 MB chunks above that), and each file
// has its own UploadProgress, so its megabytes move with URLSession's byte callbacks.
//
// The background, honestly: while it has work the queue holds a UIKit background task, which buys
// roughly 30 seconds after NEXUS leaves the screen — enough for most photos, not for a long film.
// When iOS takes that time back, the file in flight is put back at the front of the queue instead
// of being marked failed, and the queue carries on the next time NEXUS comes to the front. That
// file starts again from its first byte (a chunked upload cannot be resumed). If iOS ends the app
// altogether, the queue is gone with it; nothing is half-written on the server, and the files that
// had already landed stay.
// ─────────────────────────────────────────────────────────────────────────────

/// A file handed to the upload queue: where it is, the name the vault should store, and what to
/// delete once it is finished with (nil = nothing). Plain data, made wherever a file is read — the
/// drop reader's callbacks included.
struct VaultIncomingFile {
    let file: URL
    let name: String
    let owned: URL?
}

/// One file on its way into the vault.
@MainActor
@Observable
final class VaultUpload: Identifiable {
    enum Phase: Equatable {
        case queued
        case uploading
        case done
        /// The reason, already in words a person can act on.
        case failed(String)
        case cancelled
    }

    enum Target: Equatable {
        /// Into a folder; nil is the top of the vault.
        case folder(String?)
        /// New bytes for an existing file ("Replace file…").
        case replace(itemId: String)
    }

    let id = UUID()
    let name: String
    let size: Int
    let file: URL
    let target: Target
    /// Where it is going, as the panel says it ("LOGO", "Vault").
    let destination: String
    /// The copy this app made for the upload, removed once the entry is finished with; nil when the
    /// file is not this app's to delete.
    let owned: URL?
    var phase: Phase = .queued
    /// Bytes going out, sampled ten times a second. Only rows and totals that draw them read it.
    let progress = UploadProgress()
    @ObservationIgnored private var discarded = false

    init(name: String, size: Int, file: URL, target: Target, destination: String, owned: URL?) {
        self.name = name
        self.size = size
        self.file = file
        self.target = target
        self.destination = destination
        self.owned = owned
    }

    var isFailed: Bool {
        if case .failed = phase { return true }
        return false
    }

    /// What has gone up so far, for the megabyte counters.
    var sent: Int {
        switch phase {
        case .done: return size
        case .uploading: return Int(Double(size) * progress.fraction)
        default: return 0
        }
    }

    func discardCopy() {
        guard !discarded, let owned else { return }
        discarded = true
        try? FileManager.default.removeItem(at: owned)
    }
}

@MainActor
@Observable
final class VaultUploads {
    static let shared = VaultUploads()

    private(set) var items: [VaultUpload] = []
    /// The centred card (true) or the small pill above the tab bar (false).
    var expanded = true

    @ObservationIgnored private var runner: Task<Void, Never>?
    @ObservationIgnored private var inFlight: (id: UUID, job: Task<Error?, Never>)?
    @ObservationIgnored private var backgroundTask: UIBackgroundTaskIdentifier = .invalid
    /// iOS took the background time back; the queue waits for the app to come to the front.
    @ObservationIgnored private var outOfTime = false
    /// Files that were in flight when that happened: their failure is the suspension, not theirs.
    @ObservationIgnored private var interrupted: Set<UUID> = []
    @ObservationIgnored private var closer: Task<Void, Never>?
    @ObservationIgnored private var activeObserver: NSObjectProtocol?

    private init() {
        activeObserver = NotificationCenter.default.addObserver(
            forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
        ) { [weak self] _ in
            // A hop rather than `assumeIsolated`: nothing here has to happen before the post returns.
            Task { @MainActor in self?.resume() }
        }
    }

    // MARK: Reading

    /// The files that count towards "2 of 5": a cancelled one drops out.
    var counted: [VaultUpload] { items.filter { $0.phase != .cancelled } }
    var isRunning: Bool { items.contains { $0.phase == .queued || $0.phase == .uploading } }
    var doneCount: Int { items.filter { $0.phase == .done }.count }
    var failedCount: Int { items.filter(\.isFailed).count }
    /// 1-based position of the file going up now among the counted ones.
    var position: Int { min(counted.count, doneCount + failedCount + 1) }
    var totalBytes: Int { counted.reduce(0) { $0 + $1.size } }
    var sentBytes: Int { counted.reduce(0) { $0 + $1.sent } }
    var fraction: Double { totalBytes > 0 ? min(1, Double(sentBytes) / Double(totalBytes)) : 0 }
    /// Where the current (or last) file is going, for the card's subtitle.
    var destination: String? {
        (items.first(where: { $0.phase == .uploading }) ?? items.last(where: { $0.phase != .cancelled }))?.destination
    }

    // MARK: Handing files over

    func add(_ files: [VaultIncomingFile], into folderId: String?, named destination: String) {
        enqueue(files.map {
            VaultUpload(name: $0.name, size: APIClient.fileSize(of: $0.file), file: $0.file,
                        target: .folder(folderId), destination: destination, owned: $0.owned)
        })
    }

    func replace(_ itemId: String, itemName: String, with file: VaultIncomingFile) {
        enqueue([VaultUpload(name: file.name, size: APIClient.fileSize(of: file.file), file: file.file,
                             target: .replace(itemId: itemId), destination: itemName, owned: file.owned)])
    }

    private func enqueue(_ uploads: [VaultUpload]) {
        guard !uploads.isEmpty else { return }
        closer?.cancel()
        // A fresh batch opens the card; files added to a running batch leave it as the person set it.
        if !isRunning { expanded = true }
        // What finished earlier and is only waiting for the panel to close makes room for the new batch.
        if !isRunning && failedCount == 0 {
            for u in items { u.discardCopy() }
            items.removeAll()
        }
        items.append(contentsOf: uploads)
        pump()
    }

    // MARK: Acting on the list

    func cancel(_ upload: VaultUpload) {
        switch upload.phase {
        case .queued:
            upload.phase = .cancelled
            upload.discardCopy()
        case .uploading:
            upload.phase = .cancelled
            if inFlight?.id == upload.id { inFlight?.job.cancel() }
        default:
            return
        }
        if !isRunning { settle() }
    }

    func cancelAll() {
        for u in items where u.phase == .queued {
            u.phase = .cancelled
            u.discardCopy()
        }
        if let current = items.first(where: { $0.phase == .uploading }) { cancel(current) }
        if !isRunning { settle() }
    }

    func retry(_ upload: VaultUpload) {
        guard upload.isFailed else { return }
        closer?.cancel()
        upload.phase = .queued
        pump()
    }

    func retryFailed() {
        let failed = items.filter(\.isFailed)
        guard !failed.isEmpty else { return }
        closer?.cancel()
        for u in failed { u.phase = .queued }
        pump()
    }

    /// The panel's Close. While something is still going up this only minimises: closing would
    /// leave a queue nobody can see.
    func close() {
        guard !isRunning else { expanded = false; return }
        closer?.cancel()
        for u in items { u.discardCopy() }
        items.removeAll()
        expanded = true
    }

    /// Sign-out: everything stops and goes, copies included.
    func reset() {
        for u in items where u.phase == .queued || u.phase == .uploading { u.phase = .cancelled }
        inFlight?.job.cancel()
        closer?.cancel()
        for u in items { u.discardCopy() }
        items.removeAll()
        expanded = true
    }

    // MARK: The queue

    private func pump() {
        guard runner == nil else { return }
        runner = Task { await self.drain() }
    }

    private func drain() async {
        while !outOfTime, let next = items.first(where: { $0.phase == .queued }) {
            holdBackgroundTime()
            await send(next)
        }
        releaseBackgroundTime()
        runner = nil
        if !outOfTime { settle() }
    }

    private func send(_ upload: VaultUpload) async {
        upload.phase = .uploading
        let job = Task { () -> Error? in
            do {
                try await Self.transfer(upload)
                return nil
            } catch {
                return error
            }
        }
        inFlight = (upload.id, job)
        let failure = await job.value
        inFlight = nil
        let wasInterrupted = interrupted.remove(upload.id) != nil
        // Cancelled while it was going up: the cancel already said so.
        guard upload.phase == .uploading else {
            upload.discardCopy()
            return
        }
        if let failure {
            if wasInterrupted && Self.isLostConnection(failure) {
                // iOS suspended NEXUS mid-file. Not this file's fault: it goes again when NEXUS is back.
                upload.phase = .queued
            } else {
                upload.phase = .failed(Self.describe(failure))
            }
        } else {
            upload.phase = .done
            upload.discardCopy()
            // The folder on screen (here or on any VaultView) refreshes now rather than at its
            // next timer: the server's own realtime ping may not come back to the device that sent it.
            NotificationCenter.default.post(name: .nexusWorkspaceChanged, object: nil,
                                            userInfo: [RealtimeKey.kind: RealtimeKind.vault])
        }
    }

    private static func transfer(_ upload: VaultUpload) async throws {
        // Every file handed over is already a copy this app owns; the scope is for anything that
        // is not (harmless when there is no scope to open).
        let scoped = upload.file.startAccessingSecurityScopedResource()
        defer { if scoped { upload.file.stopAccessingSecurityScopedResource() } }
        guard upload.size > 0 else { throw VaultUploadError.unreadable }
        switch upload.target {
        case .folder(let parentId):
            try await APIClient.shared.vaultUpload(file: upload.file, fileName: upload.name,
                                                   parentId: parentId, progress: upload.progress)
        case .replace(let itemId):
            try await APIClient.shared.vaultReplace(itemId: itemId, file: upload.file, fileName: upload.name,
                                                    progress: upload.progress)
        }
    }

    /// Everything went up or was cancelled: the panel says so for a moment and goes. A failure keeps
    /// it until the person retries or closes it.
    private func settle() {
        guard !items.isEmpty, !isRunning, failedCount == 0 else { return }
        closer?.cancel()
        closer = Task { [weak self] in
            try? await Task.sleep(for: .seconds(2.5))
            guard !Task.isCancelled, let self, !self.isRunning, self.failedCount == 0 else { return }
            for u in self.items { u.discardCopy() }
            self.items.removeAll()
            self.expanded = true
        }
    }

    // MARK: Background time

    private func holdBackgroundTime() {
        guard backgroundTask == .invalid else { return }
        backgroundTask = UIApplication.shared.beginBackgroundTask(withName: "nexus.vault.upload") { [weak self] in
            MainActor.assumeIsolated { self?.ranOutOfTime() }
        }
    }

    private func ranOutOfTime() {
        outOfTime = true
        if let id = inFlight?.id { interrupted.insert(id) }
        releaseBackgroundTime()
    }

    private func releaseBackgroundTime() {
        guard backgroundTask != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTask)
        backgroundTask = .invalid
    }

    private func resume() {
        guard outOfTime else { return }
        outOfTime = false
        if items.contains(where: { $0.phase == .queued }) { pump() }
    }

    // MARK: Words

    /// No answer at all — the kind of failure a suspension produces. A status the server sent is
    /// an answer and never counts.
    private static func isLostConnection(_ error: Error) -> Bool {
        if let api = error as? APIError {
            switch api {
            case .transport, .offline: return true
            case .http(let code, let message): return message == nil && APIError.isEdgeOnly(code)
            default: return false
            }
        }
        return error is URLError
    }

    /// What actually went wrong, in words a person can act on: the file could not be read, the vault
    /// is full, the folder is locked or gone, the file is too big, or the server's own reason.
    static func describe(_ error: Error) -> String {
        if error is VaultUploadError || error is CocoaError { return T("Couldn't read this file.") }
        if let url = error as? URLError {
            return url.code == .cancelled ? T("Cancelled") : T("Can't reach NEXUS. Check your connection and retry.")
        }
        guard let api = error as? APIError else { return error.localizedDescription }
        switch api {
        case .http(let status, let said):
            return statusText(status, said)
        case .unauthorized, .decoding, .upgradeRequired:
            return api.errorDescription ?? T("Something went wrong.")
        case .offline:
            return T("Can't reach NEXUS. Check your connection and retry.")
        case .transport(let message):
            // Either nothing answered (the client's own sentence) or the file could not be read.
            return message == APIError.unreachableText ? T("Can't reach NEXUS. Check your connection and retry.") : message
        }
    }

    private static func statusText(_ status: Int, _ said: String?) -> String {
        let reason = said?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        switch status {
        case 507:
            return T("The vault is full. Empty the trash or ask the board for more space.")
        case 413:
            return T("This file is too big to upload (max 1 GB).")
        case 429:
            return T("Too many uploads at once. Try again in a moment.")
        case 404:
            return T("This folder no longer exists.")
        case 403:
            // A code the client already words (only the uploader or BoD may replace a file, it is in
            // the trash) says more than the bare refusal of a locked folder.
            if reason.isEmpty || reason == "Forbidden" || reason == "No workspace" {
                return T("You can't add files to this folder.")
            }
            return reason
        case 500...599 where !APIError.isEdgeOnly(status):
            return String(format: T("The server couldn't save the file (%d). Try again."), status)
        default:
            if APIError.isEdgeOnly(status) && reason.isEmpty {
                return T("Can't reach NEXUS. Check your connection and retry.")
            }
            return reason.isEmpty ? "Server error (\(status))." : String(format: T("The server said: %@"), reason) + " (\(status))"
        }
    }
}

/// The file handed over could not be read on this device (gone, empty, unreadable).
enum VaultUploadError: Error {
    case unreadable
}
