import Foundation
import AVFoundation
import Observation

@MainActor @Observable
final class MeetingRecorder: NSObject, AVAudioRecorderDelegate {
    static let shared = MeetingRecorder()
    private(set) var recording = false
    private(set) var paused = false
    private(set) var elapsed: Double = 0
    private(set) var file: URL?
    var notice: String?
    var failure: String?
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var ticker: Timer?
    @ObservationIgnored private var interruption: NSObjectProtocol?
    private var limit: Double = 180 * 60
    private var owner: String?
    private struct Draft: Codable { let path: String; let owner: String; let elapsed: Double }
    private let draftURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("meeting-recording.json")
    func restoreForCurrentUser() {
        guard !recording, !paused, let data = try? Data(contentsOf: draftURL), let draft = try? JSONDecoder().decode(Draft.self, from: data), draft.owner == Keychain.load()?.userId,
              FileManager.default.fileExists(atPath: draft.path) else { return }
        file = URL(fileURLWithPath: draft.path); owner = draft.owner; elapsed = draft.elapsed
    }
    private func saveDraft() {
        guard let file, let owner else { return }
        let draft = Draft(path: file.path, owner: owner, elapsed: elapsed)
        if let data = try? JSONEncoder().encode(draft) { try? data.write(to: draftURL, options: .atomic) }
    }
    func uploaded(_ path: String) {
        let recordings = draftURL.deletingLastPathComponent().appendingPathComponent("MeetingRecordings").path + "/"
        guard path.hasPrefix(recordings) else { return }
        try? FileManager.default.removeItem(atPath: path)
        if let data = try? Data(contentsOf: draftURL), let draft = try? JSONDecoder().decode(Draft.self, from: data), draft.path == path { try? FileManager.default.removeItem(at: draftURL) }
        if file?.path == path { file = nil; owner = nil; elapsed = 0 }
    }
    private override init() {
        super.init()
        restoreForCurrentUser()
        interruption = NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: .main) { [weak self] note in
            guard let raw = note.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt, raw == AVAudioSession.InterruptionType.began.rawValue else { return }
            Task { @MainActor in self?.pause() }
        }
    }
    func start() async {
        guard !recording, !paused else { return }
        failure = nil; notice = nil
        let allowed = await withCheckedContinuation { continuation in AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) } }
        guard allowed else { failure = T("Microphone access was blocked. Allow it in Settings, then try again."); return }
        do {
            let session = AVAudioSession.sharedInstance()
            try session.setCategory(.record)
            // Some input routes don't offer spokenAudio; retain a supported recording mode there.
            if session.availableModes.contains(.spokenAudio) { try session.setMode(.spokenAudio) }
            try session.setActive(true)
            let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MeetingRecordings", isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let file = folder.appendingPathComponent("Meeting-" + UUID().uuidString + ".m4a")
            let recorder = try AVAudioRecorder(url: file, settings: [AVFormatIDKey:kAudioFormatMPEG4AAC, AVSampleRateKey:44_100, AVNumberOfChannelsKey:1, AVEncoderBitRateKey:40_000, AVEncoderAudioQualityKey:AVAudioQuality.medium.rawValue])
            recorder.delegate = self
            guard recorder.prepareToRecord(), recorder.record(forDuration: Double(RemoteConfig.shared.meetingMaxMinutes * 60)) else { throw APIError.transport(T("Couldn't start recording. Try again.")) }
            self.recorder = recorder; self.file = file; elapsed = 0; owner = Keychain.load()?.userId
            limit = Double(RemoteConfig.shared.meetingMaxMinutes * 60); recording = true; paused = false
            saveDraft(); tick()
        } catch { failure = error.localizedDescription }
    }
    func rebindIdentity(from old: String, to new: String) {
        if owner == old { owner = new; saveDraft() }
        else if let data = try? Data(contentsOf: draftURL), let draft = try? JSONDecoder().decode(Draft.self, from: data), draft.owner == old {
            let migrated = Draft(path: draft.path, owner: new, elapsed: draft.elapsed)
            if let bytes = try? JSONEncoder().encode(migrated) { try? bytes.write(to: draftURL, options: .atomic) }
            restoreForCurrentUser()
        }
    }
    func stopForLogout() { stop(); file = nil; owner = nil }

    func pause() {
        guard recording else { return }
        elapsed = recorder?.currentTime ?? elapsed; recorder?.pause(); recording = false; paused = true; ticker?.invalidate(); ticker = nil
        notice = T("Paused"); saveDraft()
    }
    func resume() {
        guard paused, owner == Keychain.load()?.userId else { return }
        do {
            try AVAudioSession.sharedInstance().setActive(true)
            guard recorder?.record(forDuration: max(0.1, limit - elapsed)) == true else { throw APIError.transport(T("Couldn't resume recording. Try again.")) }
            paused = false; recording = true; notice = nil; tick()
        } catch { failure = error.localizedDescription }
    }
    func stop() {
        if let time = recorder?.currentTime, time > 0 { elapsed = time }
        recorder?.stop(); saveDraft(); recording = false; paused = false; ticker?.invalidate(); ticker = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
    private func tick() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 0.25, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                self.elapsed = self.recorder?.currentTime ?? self.elapsed
                if self.elapsed >= self.limit { self.stop(); self.notice = T("Maximum recording length reached.") }
            }
        }
    }
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            if elapsed >= limit - 1 { notice = T("Maximum recording length reached.") }
            saveDraft(); recording = false; paused = false; ticker?.invalidate(); ticker = nil
            if !flag { failure = T("Recording stopped unexpectedly. The audio file is kept on this device.") }
        }
    }
}
