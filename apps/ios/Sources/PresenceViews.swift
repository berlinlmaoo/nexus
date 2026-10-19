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
                Text(displayText(status)).lineLimit(nil).fixedSize(horizontal: false, vertical: true).layoutPriority(1)
            }.font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                .accessibilityElement(children: .combine).accessibilityIdentifier("presence.status." + (userId ?? ""))
        }
    }
    private func displayText(_ status: PresenceStatus) -> String {
        let language = AppLanguage.shared.lang.rawValue
        let label = status.localizedLabel(language)
        guard showUntil, let until = PresenceTime.until(status.until, language: language) else { return label }
        return label + " · " + String(format: T("until %@"), until)
    }
}
struct PresenceChip: View {
    let userId: String?
    var body: some View {
        if PresenceStore.shared.status(userId) != nil {
            PresenceLine(userId: userId, showUntil: true).padding(.horizontal, 10).padding(.vertical, 6).background(NX.muted, in: RoundedRectangle(cornerRadius: 12))
        }
    }
}

/// This row owns its sheet, so it can be reused inside screens with another presentation.
struct SetPresenceRow: View {
    var showCurrent = true
    var onOpen: (() -> Void)? = nil
    @State private var showing = false
    var body: some View {
        if PresenceStore.shared.enabled {
            Button { if let onOpen { onOpen() } else { showing = true } } label: {
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
    @State private var selectedAvailability = "away"
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
    @State private var emoji = "💬"
    private var statusText: String { emoji + " " + text.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var valid: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && statusText.utf16.count <= 80 }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    statusEntry
                    availability
                    quickPicks
                    schedule
                    if let failure { Text(failure).font(NXFont.text(13)).foregroundStyle(NX.danger).accessibilityIdentifier("presence.error") }
                    if !PresenceStore.shared.enabled { Text(T("Presence is switched off.")).foregroundStyle(NX.mutedFg) }
                    if let displayedManualId {
                        Button(T("Clear status"), role: .destructive) { mutate { try await PresenceStore.shared.clear(id: displayedManualId) } }
                            .disabled(busy).accessibilityIdentifier("presence.clear")
                    }
                }.padding(20).frame(maxWidth: 640).frame(maxWidth: .infinity)
            }.background(NX.background).navigationTitle(T("Status")).navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() }.disabled(busy) }
                    ToolbarItem(placement: .confirmationAction) {
                        Button { mutate { try await PresenceStore.shared.save(text: statusText, startsAt: later ? start : nil, endsAt: ends, availability: selectedAvailability) } } label: {
                            if busy { ProgressView() } else { Text(T("Save")).fontWeight(.semibold) }
                        }.tint(NX.violetText).disabled(busy || !valid || !PresenceStore.shared.enabled).accessibilityIdentifier("presence.save")
                    }
                }
                .environment(\.timeZone, PresenceTime.zone).environment(\.locale, AppDateLocale.current)
                .onChange(of: text) { _, _ in
                    while statusText.utf16.count > 80 && !text.isEmpty { text.removeLast() }
                }
                .task { await restore() }
        }.accessibilityIdentifier("presence.sheet").keyboardDoneBar().presentationDetents([.large]).interactiveDismissDisabled(busy)
    }
    private var statusEntry: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 12) {
                Menu {
                    ForEach(["💬", "🗓️", "🍽️", "🎬", "🚗", "💻"], id: \.self) { item in Button(item) { emoji = item } }
                } label: { Text(emoji).font(.system(size: 26)).frame(width: 44, height: 44) }
                    .accessibilityLabel(T("Status emoji"))
                TextField(T("What are you up to?"), text: $text).textFieldStyle(.plain).accessibilityIdentifier("presence.text")
            }.padding(8).background(NX.card, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(NX.border))
            Text(AppNumber.int(text.isEmpty ? 0 : statusText.utf16.count) + "/80")
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).frame(maxWidth: .infinity, alignment: .trailing)
        }
    }
    private var availability: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(T("Availability")).font(NXFont.text(14))
            HStack(spacing: 4) {
                availabilityOption("online", label: "Online", tone: "green")
                availabilityOption("away", label: "Away", tone: "yellow")
                availabilityOption("dnd", label: T("Do not disturb"), tone: "red")
            }.padding(4).background(NX.muted, in: RoundedRectangle(cornerRadius: 12))
        }
    }
    private func availabilityOption(_ value: String, label: String, tone: String) -> some View {
        Button { selectedAvailability = value } label: {
            HStack(spacing: 5) {
                PresenceDot(tone: tone, size: 7)
                Text(label).font(NXFont.text(12, .medium)).lineLimit(2).multilineTextAlignment(.center).fixedSize(horizontal: false, vertical: true)
            }.frame(maxWidth: .infinity, minHeight: 44).padding(.horizontal, 3)
                .foregroundStyle(NX.foreground)
                .background(selectedAvailability == value ? NX.card : Color.clear, in: RoundedRectangle(cornerRadius: 9))
                .contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("presence.availability." + value)
            .accessibilityAddTraits(selectedAvailability == value ? .isSelected : [])
    }
    private var quickPicks: some View {
        VStack(spacing: 0) {
            pick("🗓️", "Meeting", minutes: 60)
            Divider(); pick("🍽️", "Lunch", minutes: 60)
            Divider(); pick("🎬", "Out for a shoot", minutes: 180)
            Divider(); pick("🚗", "On the road", minutes: 60)
        }.background(NX.card, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(NX.border))
    }
    private func pick(_ icon: String, _ label: String, minutes: Int) -> some View {
        Button { emoji = icon; text = T(label); clearAfter = String(minutes) } label: {
            HStack(spacing: 12) {
                Text(icon); Text(T(label)).foregroundStyle(NX.foreground); Spacer()
                Text(T(minutes == 180 ? "3 hours" : "1 hour")).foregroundStyle(NX.mutedFg)
            }.font(NXFont.text(14)).padding(14).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("presence.preset." + String(minutes) + "." + label)
    }
    private var schedule: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text(T("Clear after")); Spacer()
                Picker(T("Clear after"), selection: $clearAfter) {
                    Text(T("30 minutes")).tag("30"); Text(T("1 hour")).tag("60"); Text(T("2 hours")).tag("120")
                    Text(T("3 hours")).tag("180"); Text(T("Today")).tag("today"); Text(T("Pick a time")).tag("pick")
                }.labelsHidden().accessibilityIdentifier("presence.clearAfter")
            }
            if clearAfter == "pick" { DatePicker(T("Until"), selection: $end, displayedComponents: [.date, .hourAndMinute]).accessibilityIdentifier("presence.endsAt") }
            HStack {
                Text(T("Starts")); Spacer()
                Picker(T("Starts"), selection: $later) { Text(T("Now")).tag(false); Text(T("Later")).tag(true) }
                    .labelsHidden().accessibilityIdentifier("presence.from")
            }
            if later { DatePicker(T("Starts at"), selection: $start, displayedComponents: [.date, .hourAndMinute]).accessibilityIdentifier("presence.startsAt") }
            Text(String(format: T("Until %@"), PresenceTime.format(ends, "EEE d MMM HH:mm 'WIB'", language: language)))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).accessibilityIdentifier("presence.summary")
        }.font(NXFont.text(14))
    }
    private func restore() async {
        await PresenceStore.shared.refresh()
        guard let manual = PresenceStore.shared.status(Keychain.load()?.userId)?.manual else { return }
        displayedManualId = manual.id
        selectedAvailability = manual.selectedAvailability
        let first = manual.text.first
        if let first, first.unicodeScalars.contains(where: { $0.properties.isEmojiPresentation }) {
            emoji = String(first); text = String(manual.text.dropFirst()).trimmingCharacters(in: .whitespaces)
        } else { text = manual.text }
        if let date = PresenceTime.instant(manual.startsAt), date > Date() { later = true; start = date }
        if let date = PresenceTime.instant(manual.endsAt) { clearAfter = "pick"; end = date }
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
