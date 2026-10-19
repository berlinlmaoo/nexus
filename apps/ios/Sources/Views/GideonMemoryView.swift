import SwiftUI
import UIKit

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

private enum MemoryProfileField: String, CaseIterable, Identifiable {
    case nickname, occupation, about
    var id: String { rawValue }
    var label: String { T(self == .nickname ? "Your nickname" : self == .occupation ? "Your role / occupation" : "More about you") }
    var maxLength: Int { self == .nickname ? 60 : self == .occupation ? 120 : 170 }
    var key: String { self == .occupation ? "role" : rawValue }
    var source: String { self == .nickname ? "PROFILE_NICKNAME" : self == .occupation ? "PROFILE_ROLE" : "PROFILE_ABOUT" }
    var prefix: String { self == .nickname ? "Nickname: " : self == .occupation ? "Role / occupation: " : "More about me: " }
    func memory(in items: [GideonMemory]) -> GideonMemory? {
        items.first { $0.status == "ACTIVE" && ($0.source == source || ($0.source == "SETTINGS" && ($0.text.hasPrefix(prefix) || (self == .about && $0.text.hasPrefix("About me: "))))) }
    }
    func value(in items: [GideonMemory], profile: GideonMemoryProfile? = nil) -> String {
        if let profile { return (self == .nickname ? profile.nickname : self == .occupation ? profile.role : profile.about) ?? "" }
        guard let memory = memory(in: items) else { return "" }
        if memory.text.hasPrefix(prefix) { return String(memory.text.dropFirst(prefix.count)) }
        if self == .about && memory.text.hasPrefix("About me: ") { return String(memory.text.dropFirst("About me: ".count)) }
        return memory.text
    }
}

struct GideonMemoryView: View {
    var embedded = false
    @Environment(AuthStore.self) private var auth
    @State private var store = GideonMemoryStore.shared
    var body: some View {
        Group {
            if embedded { pageContent }
            else { ScrollView { pageContent } }
        }.background(NX.background)
            .navigationTitle(embedded ? "" : T("GIDEON Memory")).navigationBarTitleDisplayMode(.inline)
            .accessibilityElement(children: .contain).accessibilityIdentifier("memory.settings").keyboardDoneBar()
            .task { await store.refresh() }
            .liveRefresh(every: 60, on: [.nexusRealtimeConnected], refreshOnReturn: true) { await store.refresh() }
            .onChange(of: store.sessionExpired) { _, expired in if expired { auth.logout() } }
    }
    /// Inset-grouped as ChatGPT's Memory screen (R-3): the purpose as the page subtitle, rounded groups without
    /// shadows, each caption below its group, and the profile fields edited in place (saved on Return or on
    /// leaving the field) instead of rows that push an editor.
    private var pageContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            VStack(alignment: .leading, spacing: 6) {
                if embedded { Text(T("GIDEON Memory")).font(NXFont.display(26, .bold)) }
                Text(T("What GIDEON remembers about you, so its answers fit you. Only you can see this.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }.padding(.horizontal, embedded ? 0 : 4)
            MemoryGroup(caption: T(store.paused ? "Off: GIDEON doesn't remember anything new and doesn't use what's here." : "GIDEON uses what it remembers to personalize your answers.")) {
                Toggle(T("Use GIDEON Memory"), isOn: Binding(get: { !store.paused && store.available }, set: { on in Task { await store.setPaused(!on) } }))
                    .tint(NX.violet).disabled(store.busy || !store.loaded || !store.available).accessibilityIdentifier("memory.enabled")
                    .padding(.horizontal, 16).frame(minHeight: 50)
            }
            MemoryGroup(caption: T("See what GIDEON has learned about you. Add things here or tell it in a chat.")) {
                NavigationLink { GideonMemorySummaryView() } label: {
                    HStack { Text(T("Memory summary")).foregroundStyle(NX.foreground); Spacer(); Image(systemName: "chevron.right").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg) }
                        .padding(.horizontal, 16).frame(minHeight: 50).contentShape(Rectangle())
                }.buttonStyle(.plain).accessibilityIdentifier("memory.summary")
            }
            ForEach(MemoryProfileField.allCases) { field in
                MemoryGroup(header: field.label, caption: field == .about ? T("Saved directly as a private memory. Only you can see this.") : nil) {
                    MemoryProfileInlineField(field: field, enabled: profileEditable)
                }
            }
            if store.loaded && !store.profileAvailable { MemoryCaption(text: T("Profile fields aren't available on this server yet.")) }
            if !store.available { MemoryCaption(text: T("GIDEON Memory is not available right now.")) }
            if store.loading && !store.loaded { ProgressView(T("Loading…")) }
            if let failure = store.failure {
                Text(failure).font(NXFont.text(12)).foregroundStyle(NX.danger)
                Button(T("Retry")) { Task { await store.refresh() } }.buttonStyle(.nxBordered)
            }
        }.font(NXFont.text(15)).padding(embedded ? 0 : 16).frame(maxWidth: 900, alignment: .leading).frame(maxWidth: .infinity)
    }
    private var profileEditable: Bool { store.loaded && !store.paused && store.available && store.profileAvailable }
}

/// One inset group: an optional header above the rounded card, an optional caption below it.
private struct MemoryGroup<Content: View>: View {
    var header: String? = nil
    var caption: String? = nil
    @ViewBuilder let content: Content
    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            if let header { Text(header).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg).padding(.horizontal, 16) }
            VStack(spacing: 0) { content }
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            if let caption { MemoryCaption(text: caption) }
        }
    }
}

private struct MemoryCaption: View {
    let text: String
    var body: some View {
        Text(text).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            .fixedSize(horizontal: false, vertical: true).padding(.horizontal, 16)
    }
}

/// A profile field edited in place: saved on Return (single-line fields) or when focus leaves it.
private struct MemoryProfileInlineField: View {
    let field: MemoryProfileField
    let enabled: Bool
    @State private var store = GideonMemoryStore.shared
    @State private var value = ""
    @State private var saved = ""
    @State private var saving = false
    @State private var justSaved = false
    @FocusState private var focused: Bool
    private var limit: Int { max(1, min(field.maxLength, store.textMax - field.prefix.utf16.count)) }
    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            input
            if saving { ProgressView().controlSize(.small) }
            else if justSaved { Image(systemName: "checkmark").font(.system(size: 12, weight: .semibold)).foregroundStyle(NX.mutedFg).accessibilityLabel(T("Saved")) }
        }
        .padding(.horizontal, 16).padding(.vertical, 13)
        .contentShape(Rectangle()).onTapGesture { if enabled { focused = true } }
        .onAppear { load() }
        .onChange(of: field.value(in: store.memories, profile: store.profile)) { _, _ in if !focused && !saving { load() } }
        .onChange(of: focused) { _, now in if !now { commit() } }
        .onChange(of: value) { _, _ in while value.utf16.count > limit && !value.isEmpty { value.removeLast() } }
    }
    @ViewBuilder private var input: some View {
        if field == .about {
            TextField(field.label, text: $value, prompt: Text(T(placeholder)), axis: .vertical)
                .lineLimit(2...6).modifier(MemoryFieldStyle(enabled: enabled, field: field)).focused($focused)
        } else {
            TextField(field.label, text: $value, prompt: Text(T(placeholder)))
                .submitLabel(.done).onSubmit { focused = false }
                .modifier(MemoryFieldStyle(enabled: enabled, field: field)).focused($focused)
        }
    }
    private var placeholder: String {
        field == .nickname ? "What should GIDEON call you?" : field == .occupation ? "e.g. Finance manager" : "Interests, values or preferences to keep in mind"
    }
    private func load() {
        value = field.value(in: store.memories, profile: store.profile); saved = value
    }
    private func commit() {
        let text = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard enabled, text != saved.trimmingCharacters(in: .whitespacesAndNewlines) else { return }
        saving = true
        Task {
            let ok = await store.setProfile(field: field.key, value: text)
            saving = false
            if ok {
                saved = text; value = text; justSaved = true
                try? await Task.sleep(for: .seconds(2)); justSaved = false
            }
        }
    }
}

private struct MemoryFieldStyle: ViewModifier {
    let enabled: Bool
    let field: MemoryProfileField
    func body(content: Content) -> some View {
        content.textFieldStyle(.plain).font(NXFont.text(15)).foregroundStyle(NX.foreground)
            .disabled(!enabled).accessibilityIdentifier("memory.profile." + field.rawValue)
    }
}

private struct GideonMemorySummaryView: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var store = GideonMemoryStore.shared
    @State private var text = ""
    @State private var editing: String?
    @State private var editText = ""
    @State private var editKind: MemoryKind = .fact
    @State private var editDay = ""
    @State private var confirmAll = false
    @State private var revealed = false
    @State private var updated = Date()
    private var sections: [(kind: String, title: String)] { [("PREFERENCE", "Preferences"), ("PERSON", "About you"), ("DATE", "Dates"), ("FACT", "Notes")] }
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                summarySubtitle
                if !revealed && (store.loading || !store.loaded) { MemoryLoadingGrid().frame(height: 320) }
                else if store.loaded {
                    if store.memories.isEmpty { EmptyState(icon: "brain", title: T("Nothing remembered yet"), subtitle: T("Add things here or tell GIDEON in a chat.")) }
                    ForEach(Array(sections.enumerated()), id: \.element.kind) { index, section in
                        let memories = store.memories.filter { $0.kind == section.kind }
                        if !memories.isEmpty {
                            ZStack(alignment: .topLeading) {
                                VStack(alignment: .leading, spacing: 8) {
                                    Text(T(section.title)).font(NXFont.text(13, .semibold)).foregroundStyle(NX.mutedFg)
                                    ForEach(memories) { row($0) }
                                }.opacity(revealed ? 1 : 0).offset(y: revealed ? 0 : 8)
                                VStack(alignment: .leading, spacing: 10) {
                                    RoundedRectangle(cornerRadius: 4).fill(NX.muted).frame(width: 100, height: 14)
                                    RoundedRectangle(cornerRadius: 6).fill(NX.muted).frame(height: 34)
                                }.opacity(revealed ? 0 : 1).accessibilityHidden(true)
                            }
                                .animation(reduceMotion ? nil : .easeOut(duration: 0.2).delay(Double(index) * 0.05), value: revealed)
                        }
                    }
                    Button(T("Forget everything"), role: .destructive) { confirmAll = true }.disabled(store.busy).accessibilityIdentifier("memory.forgetAll")
                }
                if let failure = store.failure {
                    Text(failure).font(NXFont.text(12)).foregroundStyle(NX.danger)
                    Button(T("Retry")) { Task { await reload() } }.buttonStyle(.nxBordered)
                }
            }.padding(20).frame(maxWidth: 900, alignment: .leading).frame(maxWidth: .infinity)
        }.background(NX.background).navigationTitle(T("Memory summary")).navigationBarTitleDisplayMode(.inline)
            .accessibilityIdentifier("memory.summary.page").keyboardDoneBar()
            .safeAreaInset(edge: .bottom) { composer }
            .task { await reload() }
            .onChange(of: store.sessionExpired) { _, expired in if expired { auth.logout() } }
            .alert(T("Forget everything?"), isPresented: $confirmAll) {
                Button(T("Cancel"), role: .cancel) {}
                Button(T("Forget everything"), role: .destructive) { Task { await store.forgetEverything() } }
            } message: { Text(store.memories.count == 1 ? T("GIDEON stops using the 1 thing it remembers about you. It's deleted for good after 30 days.") : String(format: T("GIDEON stops using the %@ things it remembers about you. They're deleted for good after 30 days."), AppNumber.int(store.memories.count))) }
    }
    private var summarySubtitle: some View {
        Group {
            if store.loading { MemoryLoadingTitle() }
            else if store.loaded {
                TimelineView(.periodic(from: .now, by: 60)) { context in
                    Text(String(format: T("Updated %@"), relative(updated, now: context.date)))
                }
            }
        }.font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
    }
    private func relative(_ date: Date, now: Date) -> String {
        let f = RelativeDateTimeFormatter(); f.locale = AppDateLocale.current; return f.localizedString(for: date, relativeTo: now)
    }
    private func reload() async {
        let started = Date(); await store.refresh(); updated = ProjDate.parse(store.updatedAt) ?? Date()
        if Date().timeIntervalSince(started) < 0.25 || reduceMotion { var t = Transaction(); t.disablesAnimations = true; withTransaction(t) { revealed = true } }
        else { revealed = true }
    }
    private var composer: some View {
        VStack(alignment: .leading, spacing: 6) {
            MemoryComposerField(text: $text, textMax: store.textMax, canSend: canAdd) {
                Task { if await store.add(text: text.trimmingCharacters(in: .whitespacesAndNewlines), kind: "FACT", date: "") { text = ""; updated = Date() } }
            }
            if store.paused { Text(T("GIDEON Memory is paused.")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).padding(.horizontal, 14) }
            else if store.full { Text(String(format: T("GIDEON Memory is full (%@). Delete something to add more."), AppNumber.int(store.max))).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).padding(.horizontal, 14) }
        }.padding(.horizontal, 16).padding(.vertical, 10).background(NX.background)
    }
    private var canAdd: Bool {
        !(store.busy || store.paused || !store.available || store.full || !store.loaded || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }
    @ViewBuilder private func row(_ memory: GideonMemory) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            if editing == memory.id {
                MemoryInlineTextField(text: $editText, onSubmit: { saveEdit(memory) }, onCancel: { editing = nil })
                    .frame(height: 36)
                    .onChange(of: editText) { _, value in if value.count > store.textMax { editText = String(value.prefix(store.textMax)) } }
                    .accessibilityIdentifier("memory.edit.text")
                Picker(T("Type"), selection: $editKind) { ForEach(MemoryKind.allCases) { Text($0.label).tag($0) } }.pickerStyle(.menu)
                if editKind == .date { TextField(T("MM-DD (optional)"), text: $editDay).textFieldStyle(.roundedBorder) }
                HStack { Button(T("Cancel")) { editing = nil }.buttonStyle(.nxBordered).keyboardShortcut(.cancelAction); Button(T("Save")) { saveEdit(memory) }.buttonStyle(.nxPrimary).disabled(editText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || store.busy).accessibilityIdentifier("memory.edit.save") }
            } else {
                HStack(alignment: .top, spacing: 8) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(profileDisplay(memory)).font(NXFont.text(14)).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                        if memory.kind == "DATE", let day = memoryDay(memory.monthDay) { Label(day, systemImage: "calendar").font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                        if memory.status == "PENDING" {
                            HStack { NexusChip(text: T("Suggested, not saved yet"), tone: .neutral); Button(T("Save")) { Task { await store.save(memory) } }.font(NXFont.text(12, .semibold)).disabled(store.busy || store.paused).accessibilityIdentifier("memory.save." + memory.id); Spacer() }
                        }
                    }.frame(maxWidth: .infinity, alignment: .leading)
                    Menu {
                        Button { editing = memory.id; editText = memory.text; editKind = MemoryKind(rawValue: memory.kind) ?? .fact; editDay = memory.monthDay ?? "" } label: { Label(T("Edit"), systemImage: "pencil") }.accessibilityIdentifier("memory.edit." + memory.id)
                        Button(role: .destructive) { Task { await store.remove(memory) } } label: { Label(T("Delete"), systemImage: "trash") }.accessibilityIdentifier("memory.delete." + memory.id)
                    } label: { Image(systemName: "ellipsis").frame(width: 44, height: 44) }
                        .accessibilityLabel(T("Memory options")).disabled(store.busy)
                }.font(NXFont.text(12))
            }
        }.padding(14).background(NX.card, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(NX.border)).accessibilityElement(children: .contain).accessibilityIdentifier("memory.row." + memory.id)
    }
    private func profileDisplay(_ memory: GideonMemory) -> String {
        guard let field = MemoryProfileField.allCases.first(where: { $0.source == memory.source }) else { return memory.text }
        return field.label + ": " + (memory.text.hasPrefix(field.prefix) ? String(memory.text.dropFirst(field.prefix.count)) : memory.text)
    }
    private func saveEdit(_ memory: GideonMemory) { Task { if await store.edit(memory, text: editText, kind: editKind.rawValue, date: editDay) { editing = nil } } }
    private func memoryDay(_ value: String?) -> String? {
        guard let value else { return nil }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(secondsFromGMT: 0); f.dateFormat = "yyyy-MM-dd"; f.isLenient = false
        return f.date(from: "2024-" + value).map { AppDateLocale.formatter("d MMM", timeZone: TimeZone(secondsFromGMT: 0)).string(from: $0) }
    }
}

/// One rounded capsule as the GIDEON chat composer: soft fill, no outline, the round send button inside it
/// (accent with text, grey while it can't send).
private struct MemoryComposerField: View {
    @Binding var text: String
    let textMax: Int
    let canSend: Bool
    let send: () -> Void
    var body: some View {
        HStack(alignment: .bottom, spacing: 6) {
            TextField(T("Add or update…"), text: $text, axis: .vertical)
                .lineLimit(1...4).textFieldStyle(.plain).font(NXFont.text(15))
                .padding(.leading, 16).padding(.vertical, 11)
                .accessibilityIdentifier("memory.text")
                .onChange(of: text) { _, _ in while text.utf16.count > textMax { text.removeLast() } }
            Button(action: send) {
                Image(systemName: "arrow.up").font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 32, height: 32)
                    .background(canSend ? NX.violet : NX.mutedFg.opacity(0.35), in: Circle())
                    .frame(width: 40, height: 40).contentShape(Circle())
            }
            .buttonStyle(NXPlainPressStyle()).disabled(!canSend)
            .padding(.trailing, 2).padding(.bottom, 1)
            .accessibilityLabel(T("Add")).accessibilityIdentifier("memory.add")
        }
        .background(NX.muted, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .animation(.easeOut(duration: 0.15), value: canSend)
    }
}

private struct MemoryLoadingTitle: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { context in
            let phase = context.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.2) / 1.2
            Text(T("Loading…")).overlay {
                LinearGradient(colors: [.clear, NX.foreground.opacity(0.7), .clear], startPoint: UnitPoint(x: phase * 2 - 1, y: 0), endPoint: UnitPoint(x: phase * 2, y: 1))
                    .mask(Text(T("Loading…")))
            }
        }
    }
}
private struct MemoryLoadingGrid: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        TimelineView(.animation(minimumInterval: 1 / 30, paused: reduceMotion)) { timeline in
            Canvas { context, size in
                let phase = timeline.date.timeIntervalSinceReferenceDate * 4
                for row in 0..<Int(size.height / 22) {
                    for col in 0..<Int(size.width / 22) {
                        let alpha = reduceMotion ? 0.12 : 0.08 + (sin(phase - Double(row + col) * 0.35) + 1) * 0.06
                        context.fill(Path(ellipseIn: CGRect(x: CGFloat(col * 22 + 10), y: CGFloat(row * 22 + 10), width: 2, height: 2)), with: .color(NX.mutedFg.opacity(alpha)))
                    }
                }
            }
        }.accessibilityHidden(true)
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

/// UITextField handles editing keys before SwiftUI's onKeyPress. Keep Escape in its responder chain.
private struct MemoryInlineTextField: UIViewRepresentable {
    @Binding var text: String
    var onSubmit: () -> Void
    var onCancel: () -> Void
    func makeCoordinator() -> Coordinator { Coordinator(self) }
    func makeUIView(context: Context) -> MemoryInlineUIKitField {
        let field = MemoryInlineUIKitField()
        field.borderStyle = .roundedRect
        field.font = UIFont.preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.returnKeyType = .done
        field.accessibilityIdentifier = "memory.edit.text"
        field.placeholder = T("Edit memory")
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        field.onEscape = { context.coordinator.parent.onCancel() }
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        DispatchQueue.main.async { [weak field] in field?.becomeFirstResponder() }
        return field
    }
    func updateUIView(_ field: MemoryInlineUIKitField, context: Context) {
        context.coordinator.parent = self
        if field.text != text { field.text = text }
        field.textColor = UIColor(NX.foreground)
        field.backgroundColor = UIColor(NX.card)
        field.placeholder = T("Edit memory")
    }
    static func dismantleUIView(_ field: MemoryInlineUIKitField, coordinator: Coordinator) {
        field.onEscape = nil; field.delegate = nil; field.resignFirstResponder()
    }
    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: MemoryInlineTextField
        init(_ parent: MemoryInlineTextField) { self.parent = parent }
        @objc func changed(_ field: UITextField) { parent.text = field.text ?? "" }
        func textFieldShouldReturn(_ textField: UITextField) -> Bool { parent.onSubmit(); return false }
        func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
            if string == UIKeyCommand.inputEscape { parent.onCancel(); return false }
            return true
        }
    }
}
private final class MemoryInlineUIKitField: UITextField {
    var onEscape: (() -> Void)?
    private var commandLookups = 0
    private var escapeDeliveries = 0
    private func diagnostic() {
        if TourMode.isActive { accessibilityLabel = "Memory editor debug focused=\(isFirstResponder) commands=\(commandLookups) escape=\(escapeDeliveries)" }
    }
    override func becomeFirstResponder() -> Bool { let result = super.becomeFirstResponder(); diagnostic(); return result }
    override func canPerformAction(_ action: Selector, withSender sender: Any?) -> Bool {
        if action == #selector(cancelMemoryEdit) { return onEscape != nil }
        return super.canPerformAction(action, withSender: sender)
    }
    override var keyCommands: [UIKeyCommand]? {
        commandLookups += 1; diagnostic()
        let escape = UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(cancelMemoryEdit))
        escape.wantsPriorityOverSystemBehavior = true
        return [escape] + (super.keyCommands ?? [])
    }
    @objc private func cancelMemoryEdit() { escapeDeliveries += 1; diagnostic(); onEscape?() }
    override func insertText(_ text: String) {
        if text == UIKeyCommand.inputEscape { cancelMemoryEdit(); return }
        super.insertText(text)
    }
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        if presses.contains(where: { $0.key?.keyCode == .keyboardEscape }) { cancelMemoryEdit(); return }
        super.pressesBegan(presses, with: event)
    }
}
