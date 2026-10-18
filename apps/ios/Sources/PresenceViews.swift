import SwiftUI

struct PresenceDot: View {
    let tone: String
    var size: CGFloat = 9
    private var color: Color {
        switch tone {
        case "green": return Color(hex: "#22c55e")
        case "yellow": return Color(hex: "#f59e0b")
        case "red": return Color(hex: "#ef4444")
        case "grey": return Color(hex: "#9ca3af")
        default: return Color(hex: "#475569")
        }
    }
    var body: some View {
        Circle().fill(tone == "grey" ? NX.background : color)
            .overlay { if tone == "grey" { Circle().strokeBorder(color, lineWidth: max(1.5, size * 0.2)) } }
            .frame(width: size, height: size).accessibilityHidden(true)
    }
}

struct PresenceLine: View {
    let userId: String?
    var showUntil = false
    private var status: PresenceStatus? { PresenceStore.shared.status(userId) }
    var body: some View {
        if let status {
            HStack(spacing: 6) {
                PresenceDot(tone: status.tone)
                Text(status.localizedLabel(AppLanguage.shared.lang.rawValue))
                if showUntil, let until = PresenceTime.until(status.until, language: AppLanguage.shared.lang.rawValue) {
                    Text("· " + String(format: T("until %@"), until))
                }
            }.font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine).accessibilityIdentifier("presence.status." + (userId ?? ""))
        }
    }
}
struct PresenceChip: View {
    let userId: String?
    var body: some View {
        if PresenceStore.shared.status(userId) != nil {
            PresenceLine(userId: userId, showUntil: true).padding(.horizontal, 10).padding(.vertical, 6).background(NX.muted, in: Capsule())
        }
    }
}

/// This row owns its sheet, so it can be reused inside screens with another presentation.
struct SetPresenceRow: View {
    var showCurrent = true
    @State private var showing = false
    var body: some View {
        if PresenceStore.shared.enabled {
            Button { showing = true } label: {
                HStack(spacing: 10) {
                    Image(systemName: "circle.inset.filled").foregroundStyle(NX.warning)
                    Text(T("Set a status")).foregroundStyle(NX.foreground)
                    Spacer(minLength: 4)
                    if showCurrent { PresenceLine(userId: Keychain.load()?.userId).lineLimit(2).multilineTextAlignment(.trailing) }
                    Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
                }.font(NXFont.text(14)).frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
            }.buttonStyle(.plain).accessibilityIdentifier("presence.set")
                .sheet(isPresented: $showing) { SetPresenceSheet() }
        }
    }
}

struct SetPresenceSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var later = false
    @State private var start = Date().addingTimeInterval(3600)
    @State private var clearAfter = "60"
    @State private var end = Date().addingTimeInterval(3600)
    @State private var displayedManualId: String?
    @State private var busy = false
    @State private var failure: String?
    private var language: String { AppLanguage.shared.lang.rawValue }
    private var starts: Date { later ? start : Date() }
    private var ends: Date {
        switch clearAfter {
        case "today": return PresenceTime.todayEnd(Date())
        case "pick": return end
        default: return starts.addingTimeInterval(Double(clearAfter).map { $0 * 60 } ?? 3600)
        }
    }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    Text(T("Everyone in your workspace sees it next to your name until it ends. Nobody is notified.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(spacing: 6) {
                            Text("Away ·").foregroundStyle(NX.warning).font(NXFont.text(14, .semibold))
                            TextField(T("Your status"), text: $text).textFieldStyle(.plain).accessibilityIdentifier("presence.text")
                        }.padding(12).background(NX.card, in: RoundedRectangle(cornerRadius: 10)).overlay(RoundedRectangle(cornerRadius: 10).stroke(NX.border))
                        Text("\(text.count)/80").font(NXFont.text(11)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity, alignment: .trailing)
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                ForEach(["Meeting", "Lunch", "Out for a shoot", "At the dentist", "Potong rambut"], id: \.self) { suggestion in
                                    Button(T(suggestion)) { text = T(suggestion) }.buttonStyle(.nxBordered)
                                }
                            }
                        }
                    }
                    VStack(alignment: .leading, spacing: 12) {
                        Text(T("From")).font(NXFont.text(13, .semibold))
                        Picker(T("From"), selection: $later) { Text(T("Now")).tag(false); Text(T("Later")).tag(true) }.pickerStyle(.segmented).accessibilityIdentifier("presence.from")
                        if later { DatePicker(T("Starts at"), selection: $start, displayedComponents: [.date, .hourAndMinute]).accessibilityIdentifier("presence.startsAt") }
                        Text(T("Clear after")).font(NXFont.text(13, .semibold))
                        Picker(T("Clear after"), selection: $clearAfter) {
                            Text(T("30 minutes")).tag("30"); Text(T("1 hour")).tag("60"); Text(T("2 hours")).tag("120"); Text(T("Today")).tag("today"); Text(T("Pick a time")).tag("pick")
                        }.pickerStyle(.menu).accessibilityIdentifier("presence.clearAfter")
                        if clearAfter == "pick" { DatePicker(T("Until"), selection: $end, displayedComponents: [.date, .hourAndMinute]).accessibilityIdentifier("presence.endsAt") }
                        Text((later ? PresenceTime.format(start, "EEE d MMM HH:mm 'WIB'", language: language) : T("Now")) + " – " + PresenceTime.format(ends, "EEE d MMM HH:mm 'WIB'", language: language)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).accessibilityIdentifier("presence.summary")
                    }.nexusCard()
                    if let failure { Text(failure).font(NXFont.text(13)).foregroundStyle(NX.danger).accessibilityIdentifier("presence.error") }
                    if !PresenceStore.shared.enabled { Text(T("Presence is switched off.")).foregroundStyle(NX.mutedFg) }
                    HStack(spacing: 12) {
                        if let displayedManualId { Button(T("Clear status"), role: .destructive) { mutate { try await PresenceStore.shared.clear(id: displayedManualId) } }.disabled(busy).accessibilityIdentifier("presence.clear") }
                        Spacer()
                        Button(T("Cancel")) { dismiss() }.buttonStyle(.nxBordered).disabled(busy)
                        Button { mutate { try await PresenceStore.shared.save(text: text.trimmingCharacters(in: .whitespacesAndNewlines), startsAt: later ? start : nil, endsAt: ends) } } label: {
                            HStack { if busy { ProgressView() }; Text(T("Save status")) }
                        }.buttonStyle(.nxPrimary).disabled(busy || text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || !PresenceStore.shared.enabled).accessibilityIdentifier("presence.save")
                    }
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.background(NX.background).navigationTitle(T("Set a status")).navigationBarTitleDisplayMode(.inline)
                .toolbar { ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() }.disabled(busy) } }
                .environment(\.timeZone, PresenceTime.zone)
                .onChange(of: text) { _, value in if value.count > 80 { text = String(value.prefix(80)) } }
                .task {
                    await PresenceStore.shared.refresh()
                    guard let manual = PresenceStore.shared.status(Keychain.load()?.userId)?.manual else { return }
                    displayedManualId = manual.id; text = manual.text
                    if let date = PresenceTime.instant(manual.startsAt), date > Date() { later = true; start = date }
                    if let date = PresenceTime.instant(manual.endsAt) { clearAfter = "pick"; end = date }
                }
        }.keyboardDoneBar().presentationDetents([.large]).interactiveDismissDisabled(busy).accessibilityIdentifier("presence.sheet")
    }
    private func mutate(_ operation: @escaping @MainActor () async throws -> Void) {
        busy = true; failure = nil
        Task { @MainActor in
            defer { busy = false }
            do { try await operation(); dismiss() }
            catch { failure = error.localizedDescription }
        }
    }
}
