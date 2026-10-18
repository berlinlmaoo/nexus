import Foundation
import AVFoundation
import Observation

@MainActor @Observable
final class MeetingRecorder: NSObject, AVAudioRecorderDelegate {
    static let shared = MeetingRecorder()
    private(set) var preparing = false
    @ObservationIgnored private var preparationEpoch = UUID()
    private(set) var recording = false
    private(set) var paused = false
    private(set) var elapsed: Double = 0
    private(set) var file: URL?
    private(set) var introEndSec: Double?
    var speakerLabels = true
    var notice: String?
    var failure: String?
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var ticker: Timer?
    @ObservationIgnored private var interruption: NSObjectProtocol?
    private var limit: Double = 180 * 60
    private var owner: String?
    private struct Draft: Codable { let path: String; let owner: String; let elapsed: Double; var introEndSec: Double? = nil; var speakerLabels: Bool? = nil }
    private let draftURL = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("meeting-recording.json")
    private var recordingsFolder: URL { draftURL.deletingLastPathComponent().appendingPathComponent("MeetingRecordings", isDirectory: true) }
    func restoreForCurrentUser() {
        guard !recording, !paused, let data = try? Data(contentsOf: draftURL), let draft = try? JSONDecoder().decode(Draft.self, from: data), draft.owner == Keychain.load()?.userId,
              let source = MeetingStorage.resolve(draft.path, in: recordingsFolder), FileManager.default.fileExists(atPath: source.path) else { return }
        file = source; owner = draft.owner; elapsed = draft.elapsed; introEndSec = draft.introEndSec; speakerLabels = draft.speakerLabels ?? true
    }
    private func saveDraft() {
        guard let file, let owner else { return }
        let draft = Draft(path: file.lastPathComponent, owner: owner, elapsed: elapsed, introEndSec: introEndSec, speakerLabels: speakerLabels)
        if let data = try? JSONEncoder().encode(draft) { try? data.write(to: draftURL, options: .atomic) }
    }
    func uploaded(_ path: String) {
        guard let source = MeetingStorage.resolve(path, in: recordingsFolder) else { return }
        try? FileManager.default.removeItem(at: source)
        if let data = try? Data(contentsOf: draftURL), let draft = try? JSONDecoder().decode(Draft.self, from: data), MeetingStorage.resolve(draft.path, in: recordingsFolder) == source { try? FileManager.default.removeItem(at: draftURL) }
        if file == source { file = nil; owner = nil; elapsed = 0; introEndSec = nil }
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
        guard !recording, !paused, !preparing else { return }
        preparing = true; failure = nil; notice = nil
        let epoch = UUID(); preparationEpoch = epoch
        let expectedOwner = Keychain.load()?.userId
        defer { preparing = false }
        let allowed = await withCheckedContinuation { continuation in AVAudioApplication.requestRecordPermission { continuation.resume(returning: $0) } }
        guard epoch == preparationEpoch, expectedOwner == Keychain.load()?.userId else { return }
        guard allowed else { failure = T("Microphone access was blocked. Allow it in Settings, then try again."); return }
        let maxSeconds = Double(RemoteConfig.shared.meetingMaxMinutes * 60)
        do {
            // Activating an input route and preparing an encoder can wait on Core Audio.
            // Transfer the prepared recorder once; subsequent recorder access stays on MainActor.
            let prepared = try await Task.detached(priority: .userInitiated) {
                let session = AVAudioSession.sharedInstance()
                try session.setCategory(.record)
                if session.availableModes.contains(.spokenAudio) { try session.setMode(.spokenAudio) }
                try session.setActive(true)
                let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("MeetingRecordings", isDirectory: true)
                try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                let file = folder.appendingPathComponent("Meeting-" + UUID().uuidString + ".m4a")
                let recorder = try AVAudioRecorder(url: file, settings: [AVFormatIDKey:kAudioFormatMPEG4AAC, AVSampleRateKey:44_100, AVNumberOfChannelsKey:1, AVEncoderBitRateKey:40_000, AVEncoderAudioQualityKey:AVAudioQuality.medium.rawValue])
                guard recorder.prepareToRecord() else { throw APIError.transport(T("Couldn't start recording. Try again.")) }
                return (recorder, file)
            }.value
            guard epoch == preparationEpoch, expectedOwner == Keychain.load()?.userId else {
                prepared.0.stop(); try? FileManager.default.removeItem(at: prepared.1); deactivate(); return
            }
            prepared.0.delegate = self
            guard prepared.0.record(forDuration: maxSeconds) else { throw APIError.transport(T("Couldn't start recording. Try again.")) }
            recorder = prepared.0; file = prepared.1; elapsed = 0; introEndSec = nil; owner = expectedOwner
            limit = maxSeconds; recording = true; paused = false
            saveDraft(); tick()
        } catch { if epoch == preparationEpoch { failure = error.localizedDescription }; deactivate() }
    }
    func markIntroductions() {
        guard recording || paused else { return }
        introEndSec = max(0, recorder?.currentTime ?? elapsed); saveDraft()
    }
    func undoIntroductions() { introEndSec = nil; saveDraft() }
    func setSpeakerLabels(_ value: Bool) { speakerLabels = value; saveDraft() }
    func cancelPreparation() { preparationEpoch = UUID() }
    private func deactivate() { Task.detached { try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation) } }
    func rebindIdentity(from old: String, to new: String) {
        if owner == old { owner = new; saveDraft() }
        else if let data = try? Data(contentsOf: draftURL), let draft = try? JSONDecoder().decode(Draft.self, from: data), draft.owner == old {
            let migrated = Draft(path: draft.path, owner: new, elapsed: draft.elapsed, introEndSec: draft.introEndSec, speakerLabels: draft.speakerLabels)
            if let bytes = try? JSONEncoder().encode(migrated) { try? bytes.write(to: draftURL, options: .atomic) }
            restoreForCurrentUser()
        }
    }
    func stopForLogout() { cancelPreparation(); stop(); file = nil; owner = nil; introEndSec = nil }

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
        deactivate()
    }
    private func tick() {
        ticker?.invalidate()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in
                guard let self else { return }
                let now = self.recorder?.currentTime ?? self.elapsed
                if Int(now) != Int(self.elapsed) { self.elapsed = now }
                if self.elapsed >= self.limit { self.stop(); self.notice = T("Maximum recording length reached.") }
            }
        }
    }
    nonisolated func audioRecorderDidFinishRecording(_ recorder: AVAudioRecorder, successfully flag: Bool) {
        Task { @MainActor in
            guard self.recorder === recorder else { return }
            if elapsed >= limit - 1 { notice = T("Maximum recording length reached.") }
            saveDraft(); recording = false; paused = false; ticker?.invalidate(); ticker = nil
            deactivate()
            if !flag { failure = T("Recording stopped unexpectedly. The audio file is kept on this device.") }
        }
    }
}
