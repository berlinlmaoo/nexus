import SwiftUI
import AVKit

struct MeetingBetaBadge: View {
    var body: some View { Text(T("Beta").uppercased()).font(NXFont.text(10, .semibold)).foregroundStyle(NX.violetText).padding(.horizontal, 7).padding(.vertical, 3).background(NX.violet.opacity(0.08), in: Capsule()).accessibilityLabel(T("Beta")) }
}
enum MeetingLabels {
    static func status(_ status: String) -> String { T(["UPLOADING":"Uploading", "QUEUED":"Queued", "TRANSCRIBING":"Transcribing", "SUMMARIZING":"Writing minutes", "READY":"Ready to review", "APPLYING":"Applying…", "APPLIED":"Applied", "FAILED":"Failed"][status] ?? status) }
    static func clock(_ seconds: Double) -> String { let n = max(0, Int(seconds)); return String(format: n >= 3600 ? "%d:%02d:%02d" : "%d:%02d", n >= 3600 ? n / 3600 : n / 60, n >= 3600 ? n / 60 % 60 : n % 60, n % 60) }
}
struct MeetingQueueBlock: View {
    let meeting: MeetingNote
    var compact = false
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let queue = meeting.queue {
                if queue.waiting {
                    Text(T("Waiting for the transcription server…")).font(NXFont.text(13, .semibold))
                    Text((queue.position ?? 0) > 1 ? String(format: T("#%@ in line"), AppNumber.int(queue.position!)) : T("next in line")).font(NXFont.text(12))
                }
                Text(estimate(queue.etaSec)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            } else if meeting.status == "QUEUED" {
                Text(T("Waiting for the transcription server…")).font(NXFont.text(13, .semibold))
            }
            if !compact { Text(T("You can leave this page — we'll notify you when it's ready.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
        }.fixedSize(horizontal: false, vertical: true)
    }
    private func estimate(_ seconds: Double) -> String {
        let minutes = max(1, Int(ceil(max(0, seconds) / 60)))
        return "≈ " + (minutes >= 60 ? String(format: T("Ready in about %@ h %@ min"), AppNumber.int(minutes / 60), AppNumber.int(minutes % 60)) : String(format: T("Ready in about %@ min"), AppNumber.int(minutes)))
    }
}

struct MeetingListView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(AppRouter.self) private var router
    var projectId: String? = nil
    @State private var meetings: [MeetingNote] = []
    @State private var loading = true
    @State private var failure: Error?
    @State private var showNew = false
    var body: some View {
        Group {
            if !RemoteConfig.shared.meetingNotesEnabled { disabled }
            else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        ViewThatFits(in: .horizontal) {
                            HStack { heading.fixedSize(); Spacer(); newButton.fixedSize() }
                            VStack(alignment: .leading, spacing: 12) { heading; newButton }
                        }
                        if loading && meetings.isEmpty { ProgressView().frame(maxWidth: .infinity) }
                        if let failure { LoadErrorView(error: failure, what: T("Meeting notes"), retry: { Task { await load() } }, compact: true) }
                        if !loading && meetings.isEmpty && failure == nil {
                            EmptyState(icon: "mic", title: T("No meeting notes yet"), subtitle: T("Upload or record a meeting. GIDEON writes the minutes and suggests tasks; you check them before anything is added."), actionTitle: T("New meeting notes"), action: { showNew = true })
                        }
                        ForEach(meetings) { meeting in
                            NavigationLink { MeetingDetailView(id: meeting.id) } label: {
                                VStack(alignment: .leading, spacing: 7) {
                                    HStack(alignment: .top) { Text(meeting.title).font(NXFont.text(16, .semibold)).foregroundStyle(NX.foreground); Spacer(); Text(MeetingLabels.status(meeting.status)).font(NXFont.text(11)).foregroundStyle(meeting.status == "FAILED" ? NX.danger : NX.violetText) }
                                    Text([meeting.project?.name, LegalLabels.date(meeting.createdAt), meeting.durationSec.map(MeetingLabels.clock)].compactMap { $0 }.joined(separator: " · ")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                                    if meeting.working { MeetingQueueBlock(meeting: meeting, compact: true) }
                                    if meeting.status == "FAILED" { Text(MeetingIssue.message(meeting.errorCode ?? "") ?? T("The meeting notes couldn't be prepared. Open the meeting to try again.")).font(NXFont.text(12)).foregroundStyle(NX.danger) }
                                }.frame(maxWidth: .infinity, alignment: .leading).nexusCard()
                            }.buttonStyle(.plain)
                        }
                    }.frame(maxWidth: 1040).frame(maxWidth: .infinity).padding(20)
                }
            }
        }
        .background(NX.background).navigationTitle(T("Meeting notes")).navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showNew) { NewMeetingSheet(projectId: projectId).environment(auth).environment(router) }
        .task { await load() }
        .onReceive(NotificationCenter.default.publisher(for: .nexusMeetingChanged)) { _ in Task { await load() } }
        .refreshable { await load() }
        .accessibilityIdentifier("meetings.list")
    }
    private var heading: some View { HStack { Text(T("Meeting notes")).font(NXFont.display(28, .bold)); MeetingBetaBadge() } }
    private var newButton: some View { Button { showNew = true } label: { Label(T("New meeting notes"), systemImage: "plus") }.buttonStyle(.nxPrimary) }
    private var disabled: some View { EmptyState(icon: "mic.slash", title: T("Meeting notes is unavailable right now."), subtitle: T("Try again later.")) }
    private func load() async {
        guard RemoteConfig.shared.meetingNotesEnabled else { loading = false; return }
        do {
            let page: MeetingListResponse = try await NativeAPI.request("/api/meetings?limit=100" + (projectId.map { "&projectId=" + NativeAPI.escape($0) } ?? ""))
            meetings = page.meetings; failure = nil
        } catch { failure = error }; loading = false
    }
}

struct MeetingDetailView: View {
    let id: String
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var phase
    @State private var store: MeetingStore
    @State private var projectPicker = false
    @State private var confirmDelete = false
    @State private var confirmRewrite = false
    @State private var transcriptOpen = false
    @State private var transcriptSearch = ""
    @State private var attendee = ""
    @State private var player: AVPlayer?
    @State private var audioFailure: String?
    @State private var doc: String?
    @State private var task: String?
    init(id: String) { self.id = id; _store = State(initialValue: MeetingStore(id: id)) }
    var body: some View {
        Group {
            if store.deleted { EmptyState(icon: "trash", title: T("This meeting was deleted"), subtitle: T("A saved minutes page and its tasks stay in the project."), actionTitle: T("Close"), action: { dismiss() }) }
            else if !RemoteConfig.shared.meetingNotesEnabled { EmptyState(icon: "mic.slash", title: T("Meeting notes is unavailable right now."), subtitle: T("Try again later.")) }
            else if let meeting = store.meeting { content(meeting) }
            else if let failure = store.failure { EmptyState(icon: "wifi.exclamationmark", title: T("Couldn't load meeting notes."), subtitle: failure, actionTitle: T("Try again"), action: { Task { await store.load() } }) }
            else { ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity) }
        }
        .background(NX.background).navigationTitle(T("Meeting notes")).navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    if store.meeting?.status == "READY" && store.meeting?.can.retry == true { Button(T("Write the minutes again")) { confirmRewrite = true } }
                    if store.meeting?.can.delete == true { Button(T("Delete meeting"), role: .destructive) { confirmDelete = true } }
                } label: { Image(systemName: "ellipsis") }.accessibilityLabel(T("Meeting actions"))
            }
        }
        .alert(T("Delete meeting?"), isPresented: $confirmDelete) {
            Button(T("Delete meeting"), role: .destructive) { Task { await store.remove() } }; Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("The audio is deleted now. The transcript and minutes can be restored from Control Room › Audit for 90 days. A saved minutes page and its tasks stay in the project.")) }
        .background { Color.clear.alert(T("Write the minutes again?"), isPresented: $confirmRewrite) {
            Button(T("Write the minutes again"), role: .destructive) { Task { await store.retry(minutes: true) } }; Button(T("Cancel"), role: .cancel) {}
        } message: { Text(T("This replaces your edits and uses GIDEON credits.")) } }
        .sheet(isPresented: $projectPicker) { MeetingProjectPicker(selected: store.meeting?.projectId) { project in Task { await store.changeProject(project?.id) } } }
        .navigationDestination(item: $doc) { DocReaderView(docId: $0, title: store.meeting?.doc?.title ?? T("Meeting notes")) }
        .navigationDestination(item: $task) { TaskDetailView(taskId: $0) }
        .realtimeRoom(store.meeting?.projectId.map { "project:" + $0 })
        .task(id: phase) {
            guard LiveRefresh.inFront(phase) else { return }
            await store.load()
            while !Task.isCancelled { try? await Task.sleep(for: .seconds(store.meeting?.working == true ? 15 : 60)); if !Task.isCancelled { await store.load() } }
        }
        .onReceive(NotificationCenter.default.publisher(for: .nexusMeetingChanged)) { note in Task { await store.event(note.userInfo?[RealtimeKey.json] as? String ?? "{}") } }
        .onReceive(NotificationCenter.default.publisher(for: .nexusRealtimeConnected)) { _ in Task { await store.load() } }
        .onChange(of: store.deleted) { _, deleted in if deleted { dismiss() } }
        .onDisappear { player?.pause(); Task { _ = await store.flush() } }
        .onChange(of: phase) { _, phase in if phase == .background { Task { _ = await store.flush() } } }
        .keyboardDoneBar()
    }
    private func content(_ meeting: MeetingNote) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack { Text(T("Meeting notes")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg); MeetingBetaBadge(); Spacer(); Text(store.saving ? T("Saving…") : store.hasUnsaved ? T("Unsaved changes") : T("Saved")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg) }
                TextField(T("Title"), text: Binding(get: { store.meeting?.title ?? "" }, set: { title in store.change(["title":title]) { $0.title = title } }), axis: .vertical).font(NXFont.display(28, .bold)).textFieldStyle(.plain).disabled(!meeting.can.edit).accessibilityIdentifier("meetings.title")
                properties(meeting)
                if let failure = store.failure { HStack { Text(failure).font(NXFont.text(12)).foregroundStyle(NX.danger); Spacer(); if store.hasUnsaved { Button(T("Try again")) { Task { _ = await store.flush() } } } } }
                if let notice = store.notice { Text(notice).font(NXFont.text(12)).foregroundStyle(NX.warning) }
                if meeting.working { progress(meeting) }
                if meeting.status == "FAILED" {
                    VStack(alignment: .leading, spacing: 10) {
                        Text(MeetingIssue.message(meeting.errorCode ?? "") ?? T("The meeting notes couldn't be prepared. Open the meeting to try again.")).foregroundStyle(NX.danger)
                        if meeting.can.retry { Button(T("Try again")) { Task { await store.retry() } }.buttonStyle(.nxPrimary).disabled(store.busy) }
                    }.nexusCard()
                }
                if ["READY","APPLIED"].contains(meeting.status) { minutes(meeting) }
                MeetingSpeakersSection(store: store, meeting: meeting) { seconds in Task { await seek(seconds) } }
                if let segments = meeting.transcript, !segments.isEmpty { transcript(segments, meeting: meeting) }
            }.frame(maxWidth: 960).frame(maxWidth: .infinity).padding(20)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("meetings.detail")
        .safeAreaInset(edge: .bottom) {
            if meeting.status == "READY" {
                HStack(spacing: 12) {
                    Text(meeting.selectedTasks.count == 1 ? T("Save the minutes and create 1 task") : String(format: T("Save the minutes and create %@ tasks"), AppNumber.int(meeting.selectedTasks.count))).font(NXFont.text(12))
                    Spacer()
                    Button(T("Apply")) { Task { await store.apply() } }.buttonStyle(.nxPrimary).disabled(!meeting.canApplyDraft || store.busy)
                        .accessibilityIdentifier("meetings.apply")
                }.padding(16).background(NX.card).overlay(alignment: .top) { Divider() }
            }
        }
    }
    private func properties(_ meeting: MeetingNote) -> some View {
        VStack(spacing: 12) {
            property("Status") { Text(MeetingLabels.status(meeting.status)).foregroundStyle(meeting.status == "FAILED" ? NX.danger : NX.violetText) }
            property("Project") { Button(meeting.project?.name ?? T("Choose a project")) { projectPicker = true }.buttonStyle(.plain).disabled(!meeting.can.edit || meeting.status == "APPLIED" || meeting.createdBy.id != Keychain.load()?.userId).accessibilityIdentifier("meetings.project") }
            property("Date") { Text(LegalLabels.date(meeting.recordedAt ?? meeting.createdAt)) }
            property("Duration") { Text(meeting.durationSec.map(MeetingLabels.clock) ?? "—") }
            property("Language") {
                if ["UPLOADING","QUEUED"].contains(meeting.status) && meeting.can.edit {
                    Picker(T("Language"), selection: Binding(get: { store.meeting?.language ?? "auto" }, set: { language in store.change(["language":language]) { $0.language = language } })) { languageOptions }.labelsHidden()
                } else { Text(T(meeting.detectedLanguage == "id" ? "Indonesian" : meeting.detectedLanguage == "en" ? "English" : "Detect automatically")) }
            }
            property("Recorded by") { Text(meeting.createdBy.name ?? "—") }
            if meeting.audio.available {
                property("Audio") { Button { Task { await preparePlayer(meeting) } } label: { Label(meeting.audio.name, systemImage: "play.circle") }.buttonStyle(.plain) }
                if let player { VideoPlayer(player: player).frame(height: 76).accessibilityIdentifier("meetings.player") }
                if let audioFailure { Text(audioFailure).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
        }.font(NXFont.text(13))
    }
    private func property<Content: View>(_ label: String, @ViewBuilder _ content: () -> Content) -> some View { HStack(alignment: .top, spacing: 12) { Text(T(label)).foregroundStyle(NX.mutedFg).frame(width: 104, alignment: .leading); content().frame(maxWidth: .infinity, alignment: .leading) } }
    private var languageOptions: some View { Group { Text(T("Detect automatically")).tag("auto"); Text(T("Indonesian")).tag("id"); Text(T("English")).tag("en") } }
    private func progress(_ meeting: MeetingNote) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { ForEach(Array(["Upload","Transcript","Write minutes","Review"].enumerated()), id: \.offset) { index, title in
                let stage = ["UPLOADING":0,"QUEUED":1,"TRANSCRIBING":1,"SUMMARIZING":2,"READY":3,"APPLYING":3][meeting.status] ?? 0
                Label(T(title), systemImage: index < stage ? "checkmark.circle.fill" : "\(index + 1).circle").font(NXFont.text(11)).foregroundStyle(index <= stage ? NX.violetText : NX.mutedFg)
            } }
            ProgressView(value: min(1, max(0, meeting.status == "UPLOADING" ? Double(meeting.audio.received) / Double(max(1, meeting.audio.bytes)) : meeting.progress))).tint(NX.violet)
            if meeting.transcribeStats?.stage == "speakers" { Text(T("Telling the voices apart…")).font(NXFont.text(12)) }
            else if meeting.status == "TRANSCRIBING" { Text(T("Transcribing on the office server. GIDEON Model 0 is paused meanwhile.")).font(NXFont.text(12)) }
            if meeting.status == "SUMMARIZING" { Text(T("GIDEON is reading the transcript and writing the minutes.")).font(NXFont.text(12)) }
            MeetingQueueBlock(meeting: meeting)
            if meeting.status == "UPLOADING" { MeetingUploadStatus(meetingId: meeting.id) }
        }.frame(maxWidth: .infinity, alignment: .leading).nexusCard()
    }
    private func minutes(_ meeting: MeetingNote) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            if meeting.status == "APPLIED" {
                VStack(alignment: .leading, spacing: 10) {
                    Label(meeting.taskCount == 1 ? T("Minutes saved and 1 task created") : String(format: T("Minutes saved and %@ tasks created"), AppNumber.int(meeting.taskCount)), systemImage: "checkmark.circle.fill").foregroundStyle(NX.success)
                    if let document = meeting.doc { Button(T("Open minutes")) { doc = document.id }.buttonStyle(.nxBordered) }
                    ForEach(meeting.tasks ?? []) { value in Button(value.title) { task = value.id }.buttonStyle(.plain).font(NXFont.text(13)) }
                }.nexusCard()
            }
            sectionTitle("Overview")
            textEditor(meeting.overview ?? "", editable: meeting.can.edit && meeting.status == "READY", id: "overview") { value in store.change(["overview":value]) { $0.overview = value } }
            sectionTitle("Minutes of meeting")
            attendees(meeting)
            if let mom = meeting.mom {
                sectionTitle("Topics")
                ForEach(mom.topics.indices, id: \.self) { index in
                    VStack(alignment: .leading, spacing: 6) {
                        textEditor(mom.topics[index].title, editable: editable(meeting), id: "topic-\(index)") { value in store.updateMinutes { guard $0.topics.indices.contains(index) else { return }; $0.topics[index].title = value } }
                        stringList(mom.topics[index].points, editable: editable(meeting), label: "Points") { values in store.updateMinutes { guard $0.topics.indices.contains(index) else { return }; $0.topics[index].points = values } }
                        if editable(meeting) { Button(T("Remove topic"), role: .destructive) { store.updateMinutes { if $0.topics.indices.contains(index) { $0.topics.remove(at: index) } } }.font(NXFont.text(11)).frame(minHeight: 44) }
                    }.nexusCard()
                }
                if editable(meeting) { Button(T("Add topic")) { store.updateMinutes { $0.topics.append(.init(title: "", points: [])) } }.buttonStyle(.nxBordered) }
                sectionTitle("Decisions"); stringList(mom.decisions, editable: editable(meeting), label: "Decisions") { values in store.updateMinutes { $0.decisions = values } }
                sectionTitle("Open questions"); stringList(mom.openQuestions, editable: editable(meeting), label: "Open questions") { values in store.updateMinutes { $0.openQuestions = values } }
                sectionTitle("Action items")
                ForEach(mom.actionItems.indices, id: \.self) { index in
                    VStack(alignment: .leading, spacing: 7) {
                        textEditor(mom.actionItems[index].text, editable: editable(meeting), id: "action-\(index)") { value in store.updateMinutes { guard $0.actionItems.indices.contains(index) else { return }; $0.actionItems[index].text = value } }
                        if editable(meeting) {
                            TextField(T("Owner"), text: Binding(get: { store.meeting?.mom?.actionItems.meetingElement(index)?.owner ?? "" }, set: { value in store.updateMinutes { guard $0.actionItems.indices.contains(index) else { return }; $0.actionItems[index].owner = value.isEmpty ? nil : value } })).textFieldStyle(.roundedBorder)
                            NativeOptionalDay(label: "Due", value: Binding(get: { store.meeting?.mom?.actionItems.meetingElement(index)?.due.map(CalDays.date) }, set: { date in store.updateMinutes { guard $0.actionItems.indices.contains(index) else { return }; $0.actionItems[index].due = date.map(CalDays.key) } }))
                            Button(T("Remove"), role: .destructive) { store.updateMinutes { if $0.actionItems.indices.contains(index) { $0.actionItems.remove(at: index) } } }
                        } else { Text([mom.actionItems[index].owner,mom.actionItems[index].due].compactMap { $0 }.joined(separator: " · ")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                    }.nexusCard()
                }
                if editable(meeting) { Button(T("Add action item")) { store.updateMinutes { $0.actionItems.append(.init(text: "", owner: nil, due: nil)) } }.buttonStyle(.nxBordered) }
            }
            if meeting.status == "READY" { proposals(meeting) }
        }
    }
    private func attendees(_ meeting: MeetingNote) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(T("Attendees")).font(NXFont.text(13, .semibold))
            if !MeetingVoiceStyle.keys(meeting).isEmpty { Text(T("Names come from the introductions at the start. If a voice is wrong, fix it under Speakers below the minutes.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
            FlowLayout(spacing: 6) {
                ForEach(Array((meeting.mom?.attendees ?? []).enumerated()), id: \.offset) { index, name in
                    HStack { Text(name); if editable(meeting) { Button { store.updateMinutes { if $0.attendees.indices.contains(index) { $0.attendees.remove(at: index) } } } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }.accessibilityLabel(String(format: T("Remove %@"), name)) } }.font(NXFont.text(12)).padding(7).background(NX.muted, in: Capsule())
                }
            }
            if editable(meeting) {
                HStack {
                    TextField(T("Add attendee"), text: $attendee).textFieldStyle(.roundedBorder)
                    Button(T("Add")) { let name = attendee.trimmingCharacters(in: .whitespacesAndNewlines); if !name.isEmpty { store.updateMinutes { if !$0.attendees.contains(name) { $0.attendees.append(name) } }; attendee = "" } }.buttonStyle(.nxBordered).disabled(attendee.trimmingCharacters(in: .whitespaces).isEmpty)
                    Menu(T("Project members")) {
                        ForEach(meeting.members ?? []) { member in
                            Button(member.name ?? "—") {
                                store.updateMinutes { mom in
                                    let name = member.name ?? "—"
                                    if !mom.attendees.contains(name) { mom.attendees.append(name) }
                                }
                            }
                        }
                    }.buttonStyle(.nxBordered)
                }
            }

        }
    }
    private func proposals(_ meeting: MeetingNote) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionTitle("Tasks to create")
            Text(String(format: T("%@ of %@ selected"), AppNumber.int(meeting.selectedTasks.count), AppNumber.int(meeting.proposals?.count ?? 0))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            ForEach(Array((meeting.proposals ?? []).enumerated()), id: \.element.key) { index, proposal in
                VStack(alignment: .leading, spacing: 9) {
                    HStack(alignment: .top, spacing: 10) {
                        TextField(T("Title"), text: Binding(get: { store.meeting?.proposals?.meetingElement(index)?.title ?? "" }, set: { value in store.updateProposals { guard $0.indices.contains(index) else { return }; $0[index].title = value } }), axis: .vertical).accessibilityIdentifier("meetings.proposal.title." + proposal.key)
                        Toggle(T("Include task"), isOn: Binding(get: { store.meeting?.proposals?.meetingElement(index)?.include ?? false }, set: { value in store.updateProposals { guard $0.indices.contains(index) else { return }; $0[index].include = value } })).labelsHidden().fixedSize().accessibilityIdentifier("meetings.proposal.include." + proposal.key)
                    }
                    TextField(T("Description"), text: Binding(get: { store.meeting?.proposals?.meetingElement(index)?.description ?? "" }, set: { value in store.updateProposals { guard $0.indices.contains(index) else { return }; $0[index].description = value } }), axis: .vertical).font(NXFont.text(13))
                    Menu {
                        ForEach(meeting.members ?? []) { member in
                            Button { store.updateProposals { guard $0.indices.contains(index) else { return }; if $0[index].assigneeIds.contains(member.id) { $0[index].assigneeIds.removeAll { $0 == member.id } } else { $0[index].assigneeIds.append(member.id) } } } label: {
                                Label(member.name ?? "—", systemImage: proposal.assigneeIds.contains(member.id) ? "checkmark" : "person")
                            }
                        }
                    } label: { Label(proposal.assigneeIds.isEmpty ? T("Unassigned") : (meeting.members ?? []).filter { proposal.assigneeIds.contains($0.id) }.compactMap(\.name).joined(separator: ", "), systemImage: "person") }.accessibilityIdentifier("meetings.proposal.pic." + proposal.key)
                    NativeOptionalDay(label: "Due", value: Binding(get: { store.meeting?.proposals?.meetingElement(index)?.dueDate.map(CalDays.date) }, set: { date in store.updateProposals { guard $0.indices.contains(index) else { return }; $0[index].dueDate = date.map(CalDays.key) } }), controlID: "meetings.proposal.due." + proposal.key)
                }.disabled(!meeting.can.edit).nexusCard()
            }
        }
    }
    private func transcript(_ segments: [MeetingNote.Segment], meeting: MeetingNote) -> some View {
        DisclosureGroup(T("Transcript"), isExpanded: $transcriptOpen) {
            VStack(alignment: .leading, spacing: 10) {
                TextField(T("Find in transcript"), text: $transcriptSearch).textFieldStyle(.roundedBorder)
                Text(T("Automatic transcript — names and words can be misheard.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                ForEach(Array(segments.enumerated()), id: \.offset) { _, segment in
                    if transcriptSearch.isEmpty || segment.text.localizedCaseInsensitiveContains(transcriptSearch) {
                        HStack(alignment: .top, spacing: 12) {
                            Button(MeetingLabels.clock(segment.start)) { Task { if player == nil, let meeting = store.meeting { await preparePlayer(meeting) }; await player?.seek(to: CMTime(seconds: segment.start, preferredTimescale: 600)); player?.play() } }.font(NXFont.text(11)).foregroundStyle(NX.violetText)
                            (Text(segment.speaker.map { MeetingVoiceStyle.name($0, in: meeting) + ": " } ?? "").fontWeight(.semibold).foregroundColor(segment.speaker.map { MeetingVoiceStyle.color($0, keys: MeetingVoiceStyle.keys(meeting)) } ?? NX.foreground) + Text(segment.text)).font(NXFont.text(13)).textSelection(.enabled)
                        }
                    }
                }
            }.padding(.top, 10)
        }
    }
    private func seek(_ seconds: Double) async {
        if player == nil, let meeting = store.meeting { await preparePlayer(meeting) }
        await player?.seek(to: CMTime(seconds: seconds, preferredTimescale: 600)); player?.play()
    }
    private func preparePlayer(_ meeting: MeetingNote) async {
        guard meeting.audio.available, let session = Keychain.load() else { audioFailure = T("The audio is no longer available."); return }
        let request = APIClient.shared.makeRequest("/api/meetings/" + NativeAPI.escape(id) + "/audio")
        guard let url = request.url, let host = url.host,
              let cookie = HTTPCookie(properties: [.domain:host, .path:"/", .name:session.cookieName, .value:session.token]) else { return }
        let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey:[cookie]])
        player = AVPlayer(playerItem: AVPlayerItem(asset: asset)); player?.play(); audioFailure = nil
    }
    private func sectionTitle(_ title: String) -> some View { Text(T(title)).font(NXFont.display(18, .bold)) }
    private func editable(_ meeting: MeetingNote) -> Bool { meeting.can.edit && meeting.status == "READY" }
    private func textEditor(_ text: String, editable: Bool, id: String, change: @escaping (String) -> Void) -> some View {
        Group { if editable { TextField("", text: Binding(get: { text }, set: change), axis: .vertical).textFieldStyle(.plain).lineLimit(2...30).accessibilityIdentifier("meetings.edit." + id) } else { Text(text.isEmpty ? "—" : text).textSelection(.enabled) } }.font(NXFont.text(14)).frame(maxWidth: .infinity, alignment: .leading)
    }
    private func stringList(_ values: [String], editable: Bool, label: String, change: @escaping ([String]) -> Void) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(values.indices, id: \.self) { index in
                HStack(alignment: .top) {
                    Text("•").foregroundStyle(NX.mutedFg)
                    textEditor(values[index], editable: editable, id: label + "-\(index)") { text in var next = values; next[index] = text; change(next) }
                    if editable { Button { var next = values; next.remove(at: index); change(next) } label: { Image(systemName: "xmark").frame(width: 44, height: 44) }.accessibilityLabel(T("Remove")) }
                }
            }
            if editable { Button(T("Add")) { var next = values; next.append(""); change(next) }.font(NXFont.text(12)).frame(minHeight: 44) }
        }
    }
}

private extension Array { func meetingElement(_ index: Int) -> Element? { indices.contains(index) ? self[index] : nil } }
