import SwiftUI

private enum MemoryKind: String, CaseIterable, Identifiable {
    case fact = "FACT", preference = "PREFERENCE", person = "PERSON", date = "DATE"
    var id: String { rawValue }
    var label: String { T(self == .fact ? "Note" : self == .preference ? "Preference" : self == .person ? "About you" : "Date") }
    var heading: String { T(self == .fact ? "Notes" : self == .preference ? "Preferences" : self == .person ? "About you" : "Dates") }
}

struct GideonMemorySheet: View {
    @Environment(\.dismiss) private var dismiss
    var body: some View {
        NavigationStack {
            GideonMemoryView()
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } } }
        }.modifier(PageWideFittedSheet(maxHeight: 800))
    }
}

struct GideonMemoryView: View {
    var embedded = false
    @Environment(AuthStore.self) private var auth
    @State private var store = GideonMemoryStore.shared
    @State private var text = ""
    @State private var kind: MemoryKind = .fact
    @State private var day = ""
    @State private var editing: String?
    @State private var editText = ""
    @State private var editKind: MemoryKind = .fact
    @State private var editDay = ""
    @State private var confirmAll = false
    @FocusState private var editorFocused: Bool
    var body: some View {
        Group {
            if embedded { pageContent }
            else { ScrollView { pageContent } }

        }.background(NX.background)
            .navigationTitle(embedded ? "" : T("GIDEON Memory")).navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("memory.settings").keyboardDoneBar()
            .task { await store.refresh() }
            .liveRefresh(every: 60, on: [.nexusRealtimeConnected], refreshOnReturn: true) { await store.refresh() }
            .onChange(of: store.sessionExpired) { _, expired in if expired { auth.logout() } }
            .alert(T("Forget everything?"), isPresented: $confirmAll) {
                Button(T("Cancel"), role: .cancel) {}
                Button(T("Forget everything"), role: .destructive) { Task { await store.forgetEverything() } }
            } message: { Text(String(format: T("GIDEON stops using the %@ things it remembers about you. They're deleted for good after 30 days."), AppNumber.int(store.memories.count))) }
    }
    private var pageContent: some View {
            VStack(alignment: .leading, spacing: 20) {
                if embedded { Text(T("GIDEON Memory")).font(NXFont.display(26, .bold)) }
                Text(T("What GIDEON remembers about you, so its answers fit you. Only you can see this.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                Toggle(T("Use GIDEON Memory"), isOn: Binding(get: { !store.paused }, set: { on in Task { await store.setPaused(!on) } }))
                    .disabled(store.busy || !store.loaded).accessibilityIdentifier("memory.enabled")
                Text(T("Off: GIDEON doesn't remember anything new and doesn't use what's here.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                if store.loading && !store.loaded { ProgressView().frame(maxWidth: .infinity) }
                if let failure = store.failure {
                    HStack(alignment: .top) { Text(failure).foregroundStyle(NX.danger); Spacer(); Button(T("Try again")) { Task { await store.refresh() } } }.font(NXFont.text(12)).accessibilityIdentifier("memory.error")
                }
                if let notice = store.notice { Text(notice).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).accessibilityIdentifier("memory.notice") }
                if store.loaded {
                    addRow
                    if store.memories.isEmpty {
                        EmptyState(icon: "brain", title: T("Nothing remembered yet"), subtitle: T("Tell GIDEON in a chat, e.g. “remember that I prefer short answers”, or add something here."))
                    } else {
                        ForEach([MemoryKind.preference, .person, .date, .fact]) { group in
                            let rows = store.memories.filter { (MemoryKind(rawValue: $0.kind) ?? .fact) == group }
                            if !rows.isEmpty {
                                VStack(alignment: .leading, spacing: 12) {
                                    Text(group.heading).font(NXFont.text(16, .semibold))
                                    ForEach(rows) { memory in row(memory) }
                                }
                            }
                        }
                        Button(T("Forget everything"), role: .destructive) { confirmAll = true }.buttonStyle(.nxBordered).disabled(store.busy).accessibilityIdentifier("memory.forgetAll")
                    }
                }
            }.padding(embedded ? 0 : 20).frame(maxWidth: 900, alignment: .leading).frame(maxWidth: .infinity)
    }
    private var addRow: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField(T("e.g. Keep answers short."), text: $text, axis: .vertical).lineLimit(1...5).textFieldStyle(.roundedBorder)
                .onChange(of: text) { _, value in if value.count > store.textMax { text = String(value.prefix(store.textMax)) } }
                .accessibilityIdentifier("memory.text")
            HStack {
                Picker(T("Type"), selection: $kind) { ForEach(MemoryKind.allCases) { Text($0.label).tag($0) } }.pickerStyle(.menu).accessibilityIdentifier("memory.kind")
                Spacer()
                Text(AppNumber.int(text.count) + "/" + AppNumber.int(store.textMax)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                Button(T("Add")) { Task { if await store.add(text: text, kind: kind.rawValue, date: day) { text = ""; day = "" } } }.buttonStyle(.nxPrimary)
                    .disabled(store.busy || store.paused || store.full || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty).accessibilityIdentifier("memory.add")
            }
            if kind == .date { TextField(T("MM-DD (optional)"), text: $day).textFieldStyle(.roundedBorder).accessibilityIdentifier("memory.date") }
            if store.paused { Text(T("GIDEON Memory is paused.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
            else if store.full { Text(String(format: T("GIDEON Memory is full (%@). Delete something to add more."), AppNumber.int(store.max))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
        }.nexusCard().disabled(store.paused)
    }
    @ViewBuilder private func row(_ memory: GideonMemory) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if editing == memory.id {
                TextField(T("Edit memory"), text: $editText).textFieldStyle(.roundedBorder).focused($editorFocused).submitLabel(.done)
                    .onSubmit { saveEdit(memory) }
                    .onKeyPress(.escape) { editing = nil; return .handled }
                    .onChange(of: editText) { _, value in if value.count > store.textMax { editText = String(value.prefix(store.textMax)) } }
                    .accessibilityIdentifier("memory.edit.text")
                Picker(T("Type"), selection: $editKind) { ForEach(MemoryKind.allCases) { Text($0.label).tag($0) } }.pickerStyle(.menu)
                if editKind == .date { TextField(T("MM-DD (optional)"), text: $editDay).textFieldStyle(.roundedBorder) }
                HStack { Button(T("Cancel")) { editing = nil }.buttonStyle(.nxBordered); Button(T("Save")) { saveEdit(memory) }.buttonStyle(.nxPrimary).disabled(editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.busy).accessibilityIdentifier("memory.edit.save") }
            } else {
                Text(memory.text).font(NXFont.text(14)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                if memory.kind == "DATE", let day = memoryDay(memory.monthDay) { Label(day, systemImage: "calendar").font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                if memory.status == "PENDING" {
                    HStack { NexusChip(text: T("Suggested, not saved yet"), tone: .neutral); Button(T("Save")) { Task { await store.save(memory) } }.font(NXFont.text(12, .semibold)).disabled(store.busy || store.paused).accessibilityIdentifier("memory.save." + memory.id); Spacer() }
                }
                HStack {
                    Spacer()
                    Button { editing = memory.id; editText = memory.text; editKind = MemoryKind(rawValue: memory.kind) ?? .fact; editDay = memory.monthDay ?? ""; editorFocused = true } label: { Label(T("Edit"), systemImage: "pencil") }.accessibilityIdentifier("memory.edit." + memory.id)
                    Button(role: .destructive) { Task { await store.remove(memory) } } label: { Label(T("Delete"), systemImage: "trash") }.accessibilityIdentifier("memory.delete." + memory.id)
                }.font(NXFont.text(12)).buttonStyle(.borderless).disabled(store.busy)
            }
        }.padding(14).background(NX.card, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(NX.border)).accessibilityElement(children: .contain).accessibilityIdentifier("memory.row." + memory.id)
    }
    private func saveEdit(_ memory: GideonMemory) { Task { if await store.edit(memory, text: editText, kind: editKind.rawValue, date: editDay) { editing = nil } } }
    private func memoryDay(_ value: String?) -> String? {
        guard let value else { return nil }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0); f.dateFormat = "yyyy-MM-dd"; f.isLenient = false
        return f.date(from: "2024-" + value).map { AppDateLocale.formatter("d MMM", timeZone: TimeZone(secondsFromGMT: 0)).string(from: $0) }
    }
}

/// Own answers only. OAA review never mounts this view, even if a server sent unexpected metadata.
struct GideonMemoryChip: View {
    let memory: GideonMemory
    @Environment(AuthStore.self) private var auth
    @State private var store = GideonMemoryStore.shared
    @State private var open = false
    @State private var interacted = false
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if memory.status == "PENDING" {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: "brain").foregroundStyle(NX.mutedFg)
                    VStack(alignment: .leading, spacing: 6) {
                        Text(T("Remember this?")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        Text(memory.text).font(NXFont.text(13)).fixedSize(horizontal: false, vertical: true)
                        HStack {
                            Button(T("Don't save")) { interacted = true; Task { await store.remove(memory) } }.buttonStyle(.plain).foregroundStyle(NX.mutedFg).accessibilityIdentifier("memory.chip.dont." + memory.id)
                            Spacer()
                            Button(T("Save")) { interacted = true; Task { await store.save(memory) } }.buttonStyle(.nxPrimary).accessibilityIdentifier("memory.chip.save." + memory.id)
                        }.font(NXFont.text(12)).disabled(store.busy)
                    }
                }.padding(10).background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
            } else if memory.status == "ACTIVE" {
                Button { open = true } label: { Label(String(format: T("Saved to GIDEON Memory: %@"), memory.text), systemImage: "checkmark").fixedSize(horizontal: false, vertical: true) }
                    .buttonStyle(.plain).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).accessibilityIdentifier("memory.chip.open." + memory.id)
            } else { Text(String(format: T("Not saved: %@"), memory.text)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true) }
            if interacted, let failure = store.failure { Text(failure).font(NXFont.text(12)).foregroundStyle(NX.danger) }
        }.frame(maxWidth: .infinity, alignment: .leading).accessibilityElement(children: .contain).accessibilityIdentifier("memory.chip." + memory.id)
            .sheet(isPresented: $open) { GideonMemorySheet().environment(auth) }
            .onChange(of: store.sessionExpired) { _, expired in if expired { auth.logout() } }
    }
}
