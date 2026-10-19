import SwiftUI

struct RemindersView: View {
    @Environment(AuthStore.self) private var auth
    @State private var upcoming: [NexusReminder] = []
    @State private var done: [NexusReminder] = []
    @State private var text = ""
    @State private var remindAt = Date().addingTimeInterval(3600)
    @State private var loading = true
    @State private var saving = false
    @State private var error: String?
    @State private var cancel: NexusReminder?
    private let wib = TimeZone(identifier: "Asia/Jakarta")!
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 10) {
                    TextField(T("What should we remind you about?"), text: $text, axis: .vertical)
                        .lineLimit(2...5).textFieldStyle(.nxSoft).accessibilityIdentifier("reminders.text")
                    DatePicker(T("Remind me at"), selection: $remindAt, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                        .environment(\.timeZone, wib)
                    Text(T("Times are WIB.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                    HStack { Spacer(); Button(T("Set reminder")) { Task { await create() } }.buttonStyle(.nxPrimary).disabled(saving || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || text.count > 280) }
                }.padding(14).background(NX.card, in: RoundedRectangle(cornerRadius: 12))
                if let error { ErrorState(message: error) { Task { await load() } } }
                if loading { ProgressView().frame(maxWidth: .infinity) }
                else {
                    Text(T("Coming up")).font(NXFont.text(16, .semibold))
                    if upcoming.isEmpty {
                        EmptyState(icon: "alarm", title: T("No reminders yet"), subtitle: T("Set a reminder above and we'll notify you at that time."), compact: true)
                    }
                    ForEach(upcoming) { row($0, cancellable: true) }
                    if !done.isEmpty {
                        Text(T("Gone off")).font(NXFont.text(16, .semibold))
                        ForEach(done) { row($0, cancellable: false) }
                    }
                }
            }.padding(16).frame(maxWidth: 760).frame(maxWidth: .infinity)
        }
        .background(NX.background.ignoresSafeArea()).navigationTitle(T("Reminders")).navigationBarTitleDisplayMode(.inline)
        .accessibilityIdentifier("reminders.screen")
        .task { await load() }.refreshable { await load() }
        .liveRefresh(every: 60, on: [.nexusRemindersChanged]) { await load(quiet: true) }
        .alert(T("Cancel this reminder?"), isPresented: Binding(get: { cancel != nil }, set: { if !$0 { cancel = nil } }), presenting: cancel) { item in
            Button(T("Cancel reminder"), role: .destructive) { Task { await remove(item) } }
            Button(T("Keep reminder"), role: .cancel) {}
        } message: { Text($0.text) }
    }
    private func row(_ item: NexusReminder, cancellable: Bool) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "alarm").foregroundStyle(NX.violetText)
            VStack(alignment: .leading, spacing: 5) {
                Text(item.text).font(NXFont.text(14)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                if let at = TaskDates.parse(item.remindAt) { Text(AppDateLocale.formatter("EEE d MMM HH:mm", timeZone: wib).string(from: at) + " WIB").font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
            }
            Spacer()
            if cancellable { Button { cancel = item } label: { Image(systemName: "xmark").frame(width: 36, height: 36) }.accessibilityLabel(T("Cancel reminder")).accessibilityIdentifier("reminders.cancel." + item.id) }
        }.padding(14).background(NX.card, in: RoundedRectangle(cornerRadius: 10))
    }
    private func load(quiet: Bool = false) async {
        do {
            let result: NexusReminders = try await NativeAPI.request("/api/reminders?done=1")
            upcoming = result.upcoming; done = result.done; error = nil
        } catch APIError.unauthorized { auth.logout() }
        catch { if !quiet { self.error = issue(error) } }
        loading = false
    }
    private func create() async {
        guard !saving else { return }; saving = true; defer { saving = false }
        do {
            let _: NativeAPI.Empty = try await NativeAPI.request("/api/reminders", method: "POST", body: ["text": text.trimmingCharacters(in: .whitespacesAndNewlines), "remindAt": ISO8601DateFormatter().string(from: remindAt)])
            text = ""; await load()
        } catch APIError.unauthorized { auth.logout() } catch { self.error = issue(error) }
    }
    private func remove(_ item: NexusReminder) async {
        do {
            let _: NativeAPI.Empty = try await NativeAPI.request("/api/reminders/" + NativeAPI.escape(item.id), method: "DELETE")
            await load()
        } catch APIError.unauthorized { auth.logout() } catch { self.error = issue(error) }
    }
    private func issue(_ error: Error) -> String {
        let messages = ["TEXT": "Write a reminder of up to 280 characters.", "TIME_PAST": "Choose a time in the future.", "TIME_FAR": "Choose an earlier date.", "TIME_BAD": "Choose a valid date and time.", "TOO_MANY": "You have too many reminders. Cancel one before adding another.", "NOT_FOUND": "This reminder is no longer available."]
        if let error = error as? NativeAPIError, let message = messages[error.code] { return T(message) }
        return error.localizedDescription
    }
}
