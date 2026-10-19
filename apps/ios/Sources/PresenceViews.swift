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
    /// Off where the row already leads with the same dot (Set a status, R-14).
    var showDot = true
    private var status: PresenceStatus? { PresenceStore.shared.status(userId) }
    var body: some View {
        if let status {
            HStack(spacing: 6) {
                if showDot { PresenceDot(tone: status.tone) }
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
/// It leads with the person's CURRENT presence dot (R-14: an orange ring next to "Offline · Checked out"
/// read as a second state), or a neutral status icon before the first presence read.
struct SetPresenceRow: View {
    var showCurrent = true
    /// Home's panel under the Attendance card: the Attendance card's tile, type and height (R-14).
    var homeCard = false
    var onOpen: (() -> Void)? = nil
    @State private var showing = false
    private var current: PresenceStatus? { PresenceStore.shared.status(Keychain.load()?.userId) }
    var body: some View {
        if PresenceStore.shared.enabled {
            Button { if let onOpen { onOpen() } else { showing = true } } label: {
                if homeCard { cardLabel } else { rowLabel }
            }.buttonStyle(.plain).accessibilityIdentifier(homeCard ? "home.presence" : "presence.set")
                .sheet(isPresented: $showing) { SetPresenceSheet() }
        }
    }
    private var rowLabel: some View {
        HStack(spacing: 10) {
            leading(size: 10).frame(width: 20)
            Text(T("Set a status")).foregroundStyle(NX.foreground)
            Spacer(minLength: 4)
            if showCurrent { PresenceLine(userId: Keychain.load()?.userId, showDot: false).lineLimit(2).multilineTextAlignment(.trailing) }
            Image(systemName: "chevron.right").font(.system(size: 11)).foregroundStyle(NX.mutedFg)
        }.font(NXFont.text(14)).frame(maxWidth: .infinity, minHeight: 44).contentShape(Rectangle())
    }
    private var cardLabel: some View {
        HStack(spacing: 12) {
            leading(size: 14)
                .frame(width: 44, height: 44)
                .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            Text(T("Set a status")).font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
            Spacer(minLength: 8)
            PresenceLine(userId: Keychain.load()?.userId, showDot: false)
                .lineLimit(2).multilineTextAlignment(.trailing)
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg)
        }
        .nexusCard(padding: 12, radius: 18)
        .contentShape(Rectangle())
    }
    @ViewBuilder private func leading(size: CGFloat) -> some View {
        if let current {
            PresenceDot(tone: current.tone, size: size)
        } else {
            Image(systemName: "person.crop.circle.badge.clock").font(.system(size: size + 4)).foregroundStyle(NX.mutedFg)
                .accessibilityHidden(true)
        }
    }
}

struct SetPresenceSheet: View {
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    /// None until the person picks one (R-11): an availability on its own is a whole status.
    @State private var selectedAvailability: String?
    /// The text a quick pick wrote, so an availability tapped after it clears it; typed text stays.
    @State private var pickedText: String?
    @State private var later = false
    @State private var start = Date().addingTimeInterval(3600)
    @State private var clearAfter = "60"
    @State private var end = Date().addingTimeInterval(3600)
    @State private var displayedManualId: String?
    @State private var busy = false
    @State private var failure: String?
    private var language: String { AppLanguage.shared.lang.rawValue }
    private var starts: Date { later ? start : Date() }
    private var ends: Date { PresenceSchedule.ends(clearAfter, starts: starts, custom: end) }
    @State private var emoji = "💬"
    private var trimmed: String { text.trimmingCharacters(in: .whitespacesAndNewlines) }
    /// Empty when only an availability is set (N-1b: the server then labels it "Do not disturb" alone).
    private var statusText: String { trimmed.isEmpty ? "" : emoji + " " + trimmed }
    private var valid: Bool { (selectedAvailability != nil || !trimmed.isEmpty) && statusText.utf16.count <= 80 }
    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    statusEntry
                    availability
                    quickPicks
                    PresenceScheduleGroup(clearAfter: $clearAfter, later: $later, start: $start, end: $end, starts: starts, ends: ends, language: language)
                    if let failure { Text(failure).font(NXFont.text(13)).foregroundStyle(NX.danger).accessibilityIdentifier("presence.error") }
                    if !PresenceStore.shared.enabled { Text(T("Presence is switched off.")).foregroundStyle(NX.mutedFg) }
                    if let displayedManualId {
                        Button(T("Clear status"), role: .destructive) { mutate { try await PresenceStore.shared.clear(id: displayedManualId) } }
                            .font(NXFont.text(15, .semibold)).frame(maxWidth: .infinity)
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
                .onChange(of: text) { _, value in
                    while statusText.utf16.count > 80 && !text.isEmpty { text.removeLast() }
                    if value != pickedText { pickedText = nil }
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
            Text(AppNumber.int(statusText.utf16.count) + "/80")
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
        Button {
            selectedAvailability = value
            // A quick pick's words go with it; words the person typed stay (R-11a).
            if let pickedText, text == pickedText { text = ""; emoji = "💬"; self.pickedText = nil }
        } label: {
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
    /// Text, emoji and duration, and Away unless the person changes it after (R-11b).
    private func pick(_ icon: String, _ label: String, minutes: Int) -> some View {
        Button { emoji = icon; text = T(label); pickedText = T(label); clearAfter = String(minutes); selectedAvailability = "away" } label: {
            HStack(spacing: 12) {
                Text(icon); Text(T(label)).foregroundStyle(NX.foreground); Spacer()
                Text(T(minutes == 180 ? "3 hours" : "1 hour")).foregroundStyle(NX.mutedFg)
            }.font(NXFont.text(14)).padding(14).contentShape(Rectangle())
        }.buttonStyle(.plain).accessibilityIdentifier("presence.preset." + String(minutes) + "." + label)
    }
    private func restore() async {
        await PresenceStore.shared.refresh()
        guard let manual = PresenceStore.shared.status(Keychain.load()?.userId)?.manual else { return }
        displayedManualId = manual.id
        selectedAvailability = manual.availability.flatMap { ["online", "away", "dnd"].contains($0) ? $0 : nil } ?? (manual.text.isEmpty ? nil : "away")
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

/// When a status ends: the "Clear after" choices (minutes, Today, This week = Sunday 23:59 WIB, Custom…).
enum PresenceSchedule {
    static let options: [(tag: String, label: String)] = [("30", "30 minutes"), ("60", "1 hour"), ("120", "2 hours"), ("240", "4 hours"), ("today", "Today"), ("week", "This week"), ("pick", "Custom…")]
    static func label(_ tag: String) -> String {
        if let option = options.first(where: { $0.tag == tag }) { return T(option.label) }
        return tag == "180" ? T("3 hours") : tag
    }
    static func ends(_ tag: String, starts: Date, custom: Date) -> Date {
        switch tag {
        case "today": return PresenceTime.todayEnd(starts)
        case "week": return weekEnd(starts)
        case "pick": return custom
        default: return starts.addingTimeInterval(Double(tag).map { $0 * 60 } ?? 3600)
        }
    }
    /// Sunday 23:59 WIB of the week `date` is in (Monday-first, as the web).
    static func weekEnd(_ date: Date) -> Date {
        var cal = Calendar(identifier: .gregorian); cal.timeZone = PresenceTime.zone
        let weekday = cal.component(.weekday, from: date)   // 1 = Sunday
        let days = weekday == 1 ? 0 : 8 - weekday
        return PresenceTime.todayEnd(cal.date(byAdding: .day, value: days, to: date) ?? date)
    }
}

/// "Clear after" and "Starts" as one compact group; the date and time wheel appears in it only for Custom…
/// or Later…, and one line under it says until when (R-11c).
private struct PresenceScheduleGroup: View {
    @Binding var clearAfter: String
    @Binding var later: Bool
    @Binding var start: Date
    @Binding var end: Date
    let starts: Date
    let ends: Date
    let language: String
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(spacing: 0) {
                row(T("Clear after"), value: PresenceSchedule.label(clearAfter), id: "presence.clearAfter") {
                    ForEach(PresenceSchedule.options, id: \.tag) { option in
                        Button { clearAfter = option.tag } label: { menuItem(T(option.label), on: clearAfter == option.tag) }
                    }
                }
                if clearAfter == "pick" {
                    DatePicker(T("Until"), selection: $end, in: starts..., displayedComponents: [.date, .hourAndMinute])
                        .datePickerStyle(.wheel).labelsHidden().frame(maxWidth: .infinity).accessibilityIdentifier("presence.endsAt")
                }
                Divider().padding(.leading, 14)
                row(T("Starts"), value: T(later ? "Later…" : "Now"), id: "presence.from") {
                    Button { later = false } label: { menuItem(T("Now"), on: !later) }
                    Button { later = true } label: { menuItem(T("Later…"), on: later) }
                }
                if later {
                    DatePicker(T("Starts at"), selection: $start, in: Date()..., displayedComponents: [.date, .hourAndMinute])
                        .datePickerStyle(.wheel).labelsHidden().frame(maxWidth: .infinity).accessibilityIdentifier("presence.startsAt")
                }
            }
            .background(NX.card, in: RoundedRectangle(cornerRadius: 12)).overlay(RoundedRectangle(cornerRadius: 12).stroke(NX.border))
            Text(summary).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).padding(.horizontal, 4).accessibilityIdentifier("presence.summary")
        }.font(NXFont.text(14))
    }
    private var summary: String {
        if later {
            let sameDay = PresenceTime.format(starts, "yyyyMMdd", language: language) == PresenceTime.format(ends, "yyyyMMdd", language: language)
            return PresenceTime.format(starts, "EEE d MMM HH:mm", language: language) + " – "
                + PresenceTime.format(ends, sameDay ? "HH:mm 'WIB'" : "EEE d MMM HH:mm 'WIB'", language: language)
        }
        return String(format: T("Until %@"), PresenceTime.format(ends, "EEE d MMM HH:mm 'WIB'", language: language))
    }
    private func row<Items: View>(_ title: String, value: String, id: String, @ViewBuilder items: () -> Items) -> some View {
        HStack {
            Text(title).foregroundStyle(NX.foreground)
            Spacer()
            Menu { items() } label: {
                HStack(spacing: 4) {
                    Text(value).foregroundStyle(NX.violetText)
                    Image(systemName: "chevron.up.chevron.down").font(.system(size: 10, weight: .semibold)).foregroundStyle(NX.violetText)
                }.frame(minHeight: 44).contentShape(Rectangle())
            }.accessibilityIdentifier(id)
        }.padding(.horizontal, 14)
    }
    @ViewBuilder private func menuItem(_ title: String, on: Bool) -> some View {
        if on { Label(title, systemImage: "checkmark") } else { Text(title) }
    }
}
