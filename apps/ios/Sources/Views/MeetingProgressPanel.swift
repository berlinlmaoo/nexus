import SwiftUI

/// After "Upload recording": one screen for the whole way to the minutes (R-6). Three steps — Upload,
/// Transcribe, Minutes & tasks ready — with the current one's live detail under it, one sentence that the
/// sheet can be closed, then Open meeting / Done. Cancel upload is offered only while step ① runs.
struct MeetingProgressPanel: View {
    let created: MeetingNote
    let onOpen: () -> Void
    let onDone: () -> Void
    let onCancelUpload: () async -> Void
    @Environment(\.scenePhase) private var phase
    @State private var uploads = MeetingUploads.shared
    @State private var store: MeetingStore
    @State private var confirmCancel = false
    @State private var cancelling = false

    init(created: MeetingNote, onOpen: @escaping () -> Void, onDone: @escaping () -> Void, onCancelUpload: @escaping () async -> Void) {
        self.created = created; self.onOpen = onOpen; self.onDone = onDone; self.onCancelUpload = onCancelUpload
        _store = State(initialValue: MeetingStore(id: created.id))
    }

    private var meeting: MeetingNote { tourFixture ? created : store.meeting ?? uploads.completed[created.id] ?? created }
    private var uploaded: Bool { uploads.completed[created.id] != nil || meeting.status != "UPLOADING" }
    /// Debug UI tour: the screen drawn from a fixture, without uploading anything (MeetingProgressTourFixture).
    private var tourFixture: Bool {
        #if DEBUG
        return MeetingProgressTourFixture.state != nil
        #else
        return false
        #endif
    }
    private var step: MeetingProgressStep {
        guard uploaded else { return .upload }
        switch meeting.status {
        case "QUEUED", "TRANSCRIBING": return .transcribe
        case "FAILED": return meeting.transcript?.isEmpty == false ? .ready : .transcribe
        default: return .ready
        }
    }
    private var finished: Bool { ["READY", "APPLYING", "APPLIED"].contains(meeting.status) }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            VStack(alignment: .leading, spacing: 4) {
                Text(T(finished ? "Minutes ready" : "Processing the meeting")).font(NXFont.display(22, .bold))
                Text(created.title).font(NXFont.text(15)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
            VStack(alignment: .leading, spacing: 0) {
                ForEach(MeetingProgressStep.allCases, id: \.self) { item in
                    MeetingProgressStepRow(step: item, state: state(of: item), last: item == .ready) { detail(for: item) }
                }
            }
            if !finished {
                Text(T("You can close this. We'll notify you when the minutes are ready."))
                    .font(NXFont.text(13)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            // The accent, as "Apply" in the review: one main action colour across meeting notes (Q-3, Berlin 20 Oct).
            VStack(spacing: 10) {
                Button(action: onOpen) { Text(T("Open meeting")).frame(maxWidth: .infinity) }.buttonStyle(.nxAccent).accessibilityIdentifier("meetings.progress.open")
                Button(action: onDone) { Text(T("Done")).frame(maxWidth: .infinity) }.buttonStyle(.nxBordered).accessibilityIdentifier("meetings.progress.done")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityIdentifier("meetings.progress")
        .task(id: "\(phase)|\(uploaded)") {
            guard uploaded, !tourFixture, LiveRefresh.inFront(phase) else { return }
            await store.load()
            while !Task.isCancelled && store.meeting?.working != false {
                try? await Task.sleep(for: .seconds(15))
                if !Task.isCancelled { await store.load() }
            }
        }
        .realtimeRoom(meeting.projectId.map { "project:" + $0 })
        .onReceive(NotificationCenter.default.publisher(for: .nexusMeetingChanged)) { note in Task { await store.event(note.userInfo?[RealtimeKey.json] as? String ?? "{}") } }
        .alert(T("Cancel the upload?"), isPresented: $confirmCancel) {
            Button(T("Keep uploading"), role: .cancel) {}
            Button(T("Cancel upload"), role: .destructive) { Task { cancelling = true; await onCancelUpload(); cancelling = false } }
        } message: { Text(T("The meeting is removed. A recording made here stays on this device.")) }
    }

    private func state(of item: MeetingProgressStep) -> MeetingProgressStepState {
        if meeting.status == "FAILED" && item == step { return .failed }
        if finished && item == .ready { return .done }
        return item.rawValue < step.rawValue ? .done : item == step ? .current : .upcoming
    }

    @ViewBuilder private func detail(for item: MeetingProgressStep) -> some View {
        if state(of: item) == .failed {
            Text(meeting.error ?? T("Failed")).font(NXFont.text(13)).foregroundStyle(NX.danger).fixedSize(horizontal: false, vertical: true)
        } else if state(of: item) == .current || (item == .ready && finished) {
            switch item {
            case .upload: uploadDetail
            case .transcribe: transcribeDetail
            case .ready: Text(T(finished ? "Ready — open to review" : "Writing the minutes…")).font(NXFont.text(13)).foregroundStyle(finished ? NX.foreground : NX.mutedFg)
            }
        }
    }

    private var uploadDetail: some View {
        VStack(alignment: .leading, spacing: 8) {
            if tourFixture { MeetingUploadBytes(sent: 13_002_342, total: 32_610_713) }
            else { MeetingUploadStatus(meetingId: created.id) }
            Button(T("Cancel upload"), role: .destructive) { confirmCancel = true }
                .font(NXFont.text(13, .semibold)).buttonStyle(.plain).foregroundStyle(NX.danger)
                .disabled(cancelling).accessibilityIdentifier("meetings.progress.cancelUpload")
        }
    }

    @ViewBuilder private var transcribeDetail: some View {
        if let queue = meeting.queue, queue.waiting {
            VStack(alignment: .leading, spacing: 2) {
                Text((queue.position ?? 0) > 1 ? String(format: T("#%@ in the queue"), AppNumber.int(queue.position!)) : T("Next in the queue"))
                    .font(NXFont.text(13, .semibold))
                if queue.etaSec > 0 { Text(String(format: T("Ready in about %@ min"), AppNumber.int(max(1, Int(ceil(queue.etaSec / 60)))))).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) }
            }
        } else if meeting.status == "TRANSCRIBING" {
            VStack(alignment: .leading, spacing: 6) {
                ProgressView(value: min(1, max(0, meeting.progress))).tint(NX.violet)
                Text(transcribingText).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
        } else {
            Text(T("Next in the queue")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
        }
    }

    private var transcribingText: String {
        guard let eta = meeting.queue?.etaSec, eta > 0 else { return T("Transcribing…") }
        let minutes = max(1, Int(ceil(eta / 60)))
        return String(format: T("Transcribing… about %@ min left"), AppNumber.int(minutes))
    }
}

enum MeetingProgressStep: Int, CaseIterable {
    case upload, transcribe, ready
    var title: String { T(self == .upload ? "Upload" : self == .transcribe ? "Transcribe" : "Minutes & tasks ready") }
}

/// One step: the marker (number, check or warning) on a line down to the next step, the title, then the detail.
enum MeetingProgressStepState { case done, current, upcoming, failed }

struct MeetingProgressStepRow<Detail: View>: View {
    let step: MeetingProgressStep
    let state: MeetingProgressStepState
    let last: Bool
    @ViewBuilder let detail: Detail
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(spacing: 0) {
                marker
                if !last { Rectangle().fill(state == .done ? NX.violet : NX.border).frame(width: 2).frame(maxHeight: .infinity) }
            }.frame(width: 26)
            VStack(alignment: .leading, spacing: 6) {
                Text(step.title).font(NXFont.text(15, state == .current || state == .failed ? .semibold : .regular))
                    .foregroundStyle(state == .upcoming ? NX.mutedFg : NX.foreground)
                    .frame(minHeight: 26)
                detail
            }
            .padding(.bottom, last ? 0 : 18)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("meetings.progress.step.\(step.rawValue + 1)")
    }
    @ViewBuilder private var marker: some View {
        switch state {
        case .done:
            Image(systemName: "checkmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                .frame(width: 26, height: 26).background(NX.violet, in: Circle())
        case .current:
            Text(AppNumber.int(step.rawValue + 1)).font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
                .frame(width: 26, height: 26).background(NX.accentBg, in: Circle()).overlay(Circle().strokeBorder(NX.violet, lineWidth: 2))
        case .upcoming:
            Text(AppNumber.int(step.rawValue + 1)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                .frame(width: 26, height: 26).overlay(Circle().strokeBorder(NX.border, lineWidth: 1.5))
        case .failed:
            Image(systemName: "exclamationmark").font(.system(size: 12, weight: .bold)).foregroundStyle(.white)
                .frame(width: 26, height: 26).background(NX.danger, in: Circle())
        }
    }
}

#if DEBUG
/// Debug UI tour only: the progress screen in one state ("r6-progress-upload|queued|transcribing|ready" as the
/// tour screen id) without creating a meeting or uploading audio to the server.
enum MeetingProgressTourFixture {
    static var state: String? {
        guard TourMode.isActive, let screen = TourMode.argument("nexusTourScreen"), screen.hasPrefix("r6-progress-") else { return nil }
        return String(screen.dropFirst("r6-progress-".count))
    }
    static func meeting() -> MeetingNote? {
        guard let state else { return nil }
        let status = ["upload": "UPLOADING", "queued": "QUEUED", "transcribing": "TRANSCRIBING"][state] ?? "READY"
        let queue = state == "queued" ? #"{"waiting":true,"position":1,"etaSec":360}"# : state == "transcribing" ? #"{"waiting":false,"etaSec":360}"# : "null"
        let json = """
        {"id":"tour-meeting","title":"Meeting Notes QA","status":"\(status)","progress":\(state == "transcribing" ? 0.4 : 0),"language":"auto",
         "source":"upload","createdBy":{"id":"tour"},"audio":{"name":"meeting.m4a","mime":"audio/mp4","bytes":32610713,"received":0,"available":true},
         "taskCount":0,"version":1,"createdAt":"2026-10-19T10:00:00Z","updatedAt":"2026-10-19T10:00:00Z",
         "can":{"edit":true,"apply":true,"delete":true,"retry":true},"queue":\(queue)}
        """
        return try? JSONDecoder().decode(MeetingNote.self, from: Data(json.utf8))
    }
}
#endif
