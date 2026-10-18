import SwiftUI
import UniformTypeIdentifiers
import AVFoundation

struct MeetingProjectPicker: View {
    var selected: String?
    var allowsNone = true
    let onChoose: (ProjectRef?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var projects: [Project] = []
    @State private var query = ""
    @State private var loading = true
    @State private var failure: Error?
    private var matches: [Project] { projects.filter { query.isEmpty || $0.name.localizedCaseInsensitiveContains(query) } }
    var body: some View {
        NavigationStack {
            List {
                if allowsNone { Button(T("No project")) { onChoose(nil); dismiss() } }
                if loading { ProgressView() }
                if let failure { LoadErrorView(error: failure, what: T("Projects"), retry: { Task { await load() } }, compact: true) }
                if !loading && matches.isEmpty && failure == nil { EmptyState(icon: "folder", title: T("No projects found"), subtitle: T("Only projects you can edit are listed.")) }
                ForEach(matches) { project in
                    Button { onChoose(ProjectRef(id: project.id, name: project.name, icon: project.icon)); dismiss() } label: {
                        HStack { ProjectMark(icon: project.icon, color: project.color, size: 22, projectId: project.id); Text(project.name); Spacer(); if selected == project.id { Image(systemName: "checkmark") } }
                    }
                }
            }.searchable(text: $query, prompt: T("Search projects")).navigationTitle(T("Choose a project"))
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
                .task { await load() }
        }
    }
    private func load() async {
        loading = true; defer { loading = false }
        do {
            let all = try await APIClient.shared.projects()
            let roster = try await APIClient.shared.roster()
            if ["BOD","ONE_ABOVE_ALL"].contains(roster.role ?? "") { projects = all }
            else {
                var editable: [Project] = []
                for project in all {
                    if let detail = try? await APIClient.shared.project(project.id), detail.canEditProject { editable.append(project) }
                    if Task.isCancelled { return }
                }
                projects = editable
            }
            failure = nil
        } catch { failure = error }
    }
}

struct NewMeetingSheet: View {
    var projectId: String? = nil
    var initialFile: URL? = nil
    @Environment(\.dismiss) private var dismiss
    @Environment(AppRouter.self) private var router
    @State private var recorder = MeetingRecorder.shared
    @State private var uploads = MeetingUploads.shared
    @State private var title = ""
    @State private var language = "auto"
    @State private var chosenProject: ProjectRef?
    @State private var file: URL?
    @State private var source = "upload"
    @State private var speakerLabels = true
    @State private var filePicker = false
    @State private var projectPicker = false
    @State private var busy = false
    @State private var failure: String?
    @State private var created: MeetingNote?
    @State private var confirmClose = false
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack { Text(T("Meeting notes")).font(NXFont.display(26, .bold)); MeetingBetaBadge() }
                    if !RemoteConfig.shared.meetingNotesEnabled { EmptyState(icon: "mic.slash", title: T("Meeting notes is unavailable right now."), subtitle: T("Try again later.")) }
                    else if let created {
                        let current = uploads.completed[created.id] ?? created
                        Label(T(uploads.completed[created.id] == nil ? "Uploading" : "Uploaded"), systemImage: uploads.completed[created.id] == nil ? "arrow.up.circle" : "checkmark.circle.fill").font(NXFont.display(20, .bold))
                        Text(created.title).font(NXFont.text(16, .semibold))
                        if uploads.completed[created.id] != nil { MeetingQueueBlock(meeting: current) }
                        else { MeetingUploadStatus(meetingId: created.id); Text(T("The upload continues in the background. Keep the recording on this device until it finishes.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                        HStack { Button(T("Close")) { dismiss() }.buttonStyle(.nxBordered); Button(T("Open meeting")) { open(created.id) }.buttonStyle(.nxPrimary) }
                    } else {
                        TextField(T("Title"), text: $title).font(NXFont.display(22, .bold)).textFieldStyle(.plain)
                        Button { projectPicker = true } label: { Label(chosenProject?.name ?? T("Project (optional)"), systemImage: "folder") }.buttonStyle(.nxBordered)
                        Picker(T("Spoken language"), selection: $language) { Text(T("Detect automatically")).tag("auto"); Text(T("Indonesian")).tag("id"); Text(T("English")).tag("en") }
                        Text(T("Detect automatically works best for Indonesian mixed with English.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        HStack { Button { filePicker = true } label: { Label(T("Upload a file"), systemImage: "doc.badge.arrow.up") }.buttonStyle(.nxBordered).disabled(recorder.recording || recorder.paused || recorder.preparing); Button { source = "record"; recorder.setSpeakerLabels(speakerLabels); Task { await recorder.start() } } label: { Label(T("Record"), systemImage: "mic") }.buttonStyle(.nxBordered).disabled(recorder.recording || recorder.paused || recorder.preparing) }
                        if recorder.preparing { HStack { ProgressView(); Text(T("Starting the microphone…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg) } }
                        if recorder.recording || recorder.paused {
                            MeetingRecordingControls {
                                file = recorder.file; source = "record"; if title.isEmpty { title = T("Meeting recording") }
                            }
                        }
                        if speakerLabels && (recorder.recording || recorder.paused) { introductions }
                        if let notice = recorder.notice { Text(notice).font(NXFont.text(12)).foregroundStyle(NX.warning) }
                        if let file {
                            HStack { Image(systemName: "waveform"); VStack(alignment: .leading) { Text(file.lastPathComponent).font(NXFont.text(13, .semibold)); Text(AppNumber.bytes(APIClient.fileSize(of: file))).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }; Spacer(); Button { self.file = nil } label: { Image(systemName: "xmark.circle.fill") }.accessibilityLabel(T("Remove")) }.nexusCard()
                            Button { Task { await upload(file) } } label: { HStack { if busy { ProgressView() }; Text(T("Upload recording")) } }.buttonStyle(.nxPrimary).disabled(busy || recorder.recording || recorder.paused).accessibilityIdentifier("meetings.upload")
                        }
                        speakerOptions
                        Text(String(format: T("Up to %@ min · %@"), AppNumber.int(RemoteConfig.shared.meetingMaxMinutes), AppNumber.bytes(RemoteConfig.shared.meetingMaxBytes))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        Text(T("Audio is transcribed on the company's own server. Review the minutes and tasks before Apply.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        if let failure = failure ?? recorder.failure { Text(failure).font(NXFont.text(12)).foregroundStyle(NX.danger) }
                    }
                }.padding(20).frame(maxWidth: 720).frame(maxWidth: .infinity)
            }.background(NX.background)
                .navigationTitle(T("New meeting notes")).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { if recorder.recording || recorder.paused { confirmClose = true } else { recorder.cancelPreparation(); dismiss() } } } }
                .interactiveDismissDisabled(recorder.recording || recorder.paused || busy)
                .alert(T("Stop recording?"), isPresented: $confirmClose) { Button(T("Stop")) { recorder.stop(); file = recorder.file; source = "record" }; Button(T("Cancel"), role: .cancel) {} } message: { Text(T("The recording stays on this device until you upload it.")) }
                .sheet(isPresented: $filePicker) { DocumentPicker(types: [.item], multiple: false) { urls in if let url = urls.first { chooseFile(url) } } }
                .background { Color.clear.sheet(isPresented: $projectPicker) { MeetingProjectPicker(selected: chosenProject?.id) { chosenProject = $0 } } }
                .onAppear { recorder.restoreForCurrentUser(); if let initialFile, file == nil { chooseFile(initialFile) }; if file == nil, let saved = recorder.file { file = saved; source = "record"; speakerLabels = recorder.speakerLabels; if title.isEmpty { title = T("Meeting recording") } } }
                .task { if let projectId, chosenProject == nil, let project = try? await APIClient.shared.project(projectId) { chosenProject = ProjectRef(id: project.id, name: project.name, icon: project.icon) } }
                .onDisappear { recorder.cancelPreparation() }
                .onChange(of: recorder.recording) { _, recording in if !recording && !recorder.paused && source == "record" { file = recorder.file } }
        }.keyboardDoneBar().accessibilityIdentifier("meetings.new")
    }
    private var speakerOptions: some View {
        VStack(alignment: .leading, spacing: 8) {
            Toggle(isOn: $speakerLabels) { Label(T("Tell speakers apart"), systemImage: "person.2") }.accessibilityIdentifier("meetings.speakerLabels")
            if speakerLabels {
                Text(T("Start with a quick round of introductions so GIDEON can tell voices apart.") + " “" + T("Hi, I'm Berlin…") + "”").font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                Text(T("Voices are only used to label this recording.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                if !recorder.recording && !recorder.paused { Text(T("Start with a round of introductions.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                if source == "record", file == recorder.file, let end = recorder.introEndSec {
                    Text("· " + String(format: T("introductions until %@"), MeetingLabels.clock(end))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
            }
        }.onChange(of: speakerLabels) { _, value in if source == "record" { recorder.setSpeakerLabels(value) } }
    }
    private var introductions: some View {
        VStack(alignment: .leading, spacing: 8) {
            NexusChip(text: T("Introductions"), tone: .accent)
            if let end = recorder.introEndSec {
                Text(String(format: T("Introductions done at %@"), MeetingLabels.clock(end))).font(NXFont.text(13))
                Button(T("Undo")) { recorder.undoIntroductions() }.buttonStyle(.nxBordered)
            } else {
                Text(T("Each person says their name in turn, then tap Done.")).font(NXFont.text(13))
                Button(T("Done with introductions")) { recorder.markIntroductions() }.buttonStyle(.nxPrimary).accessibilityIdentifier("meetings.introductions.done")
            }
        }.frame(maxWidth: .infinity, alignment: .leading).padding(14).background(NX.accentBg, in: RoundedRectangle(cornerRadius: 12))
    }
    private func chooseFile(_ url: URL) {
        guard MeetingUploads.extensions.contains(url.pathExtension.lowercased()) else { failure = MeetingIssue.message("unsupported_type"); return }
        file = url; source = "upload"; failure = nil
        if title.isEmpty { title = url.deletingPathExtension().lastPathComponent }
    }
    private func upload(_ file: URL) async {
        busy = true; failure = nil; defer { busy = false }
        let scoped = file.startAccessingSecurityScopedResource(); defer { if scoped { file.stopAccessingSecurityScopedResource() } }
        do {
            let asset = AVURLAsset(url: file)
            let measured = try? await asset.load(.duration).seconds
            let duration = measured.flatMap { $0.isFinite && $0 > 0 ? $0 : nil }
            created = try await uploads.begin(file: file, title: title.isEmpty ? file.deletingPathExtension().lastPathComponent : title, projectId: chosenProject?.id, language: language, source: source, duration: duration, speakerLabels: speakerLabels, introEndSec: source == "record" ? recorder.introEndSec : nil)
        } catch { failure = error.localizedDescription }
    }
    private func open(_ id: String) { dismiss(); Task { try? await Task.sleep(for: .milliseconds(350)); router.open(.meeting(id)) } }
}

/// The timer redraws only the recording controls, rather than the whole editable upload form.
private struct MeetingRecordingControls: View {
    let onStopped: () -> Void
    @State private var recorder = MeetingRecorder.shared
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label(MeetingLabels.clock(recorder.elapsed), systemImage: recorder.paused ? "pause.circle" : "record.circle.fill")
                .font(NXFont.display(28, .bold)).foregroundStyle(recorder.paused ? NX.warning : NX.danger)
            HStack {
                Button(T(recorder.paused ? "Resume" : "Pause")) { if recorder.paused { recorder.resume() } else { recorder.pause() } }.buttonStyle(.nxBordered)
                Button(T("Stop")) { recorder.stop(); onStopped() }.buttonStyle(.nxPrimary)
            }
        }.nexusCard()
    }
}
