import SwiftUI

enum MeetingVoiceStyle {
    static let colors = ["#8b5cf6", "#0ea5e9", "#10b981", "#f59e0b", "#f43f5e", "#14b8a6", "#d946ef", "#84cc16", "#f97316", "#6366f1"]
    static func number(_ key: String, keys: [String]) -> Int {
        let offset = keys.compactMap { Int($0.filter(\.isNumber)) }.min() == 0 ? 0 : 1
        return max(0, (Int(key.filter(\.isNumber)) ?? ((keys.firstIndex(of: key) ?? 0) + offset)) - offset)
    }
    static func color(_ key: String, keys: [String]) -> Color { Color(hex: colors[number(key, keys: keys) % colors.count]) }
    static func fallback(_ key: String, keys: [String]) -> String { String(format: T("Speaker %@"), AppNumber.int(number(key, keys: keys) + 1)) }
    static func keys(_ meeting: MeetingNote) -> [String] { Array(Set((meeting.transcript ?? []).compactMap(\.speaker).filter { !$0.isEmpty })).sorted { (Int($0.filter(\.isNumber)) ?? 0) < (Int($1.filter(\.isNumber)) ?? 0) } }
    static func name(_ key: String, in meeting: MeetingNote) -> String {
        let name = meeting.speakers?[key]?.name.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return name.isEmpty ? fallback(key, keys: keys(meeting)) : name
    }
}

struct MeetingSpeakersSection: View {
    let store: MeetingStore
    let meeting: MeetingNote
    let listen: (Double) -> Void
    private var keys: [String] { MeetingVoiceStyle.keys(meeting) }
    private var editable: Bool { meeting.can.edit && !["APPLYING","APPLIED"].contains(meeting.status) }
    var body: some View {
        if !keys.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                HStack { Text(T("Speakers")).font(NXFont.text(18, .semibold)); Spacer(); Text(keys.count == 1 ? T("1 voice") : String(format: T("%@ voices"), AppNumber.int(keys.count))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg) }
                Text(T("GIDEON told the voices apart and read the names from the introductions. Voices are only used to label this recording.")).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                ForEach(keys, id: \.self) { key in voice(key) }
            }.accessibilityElement(children: .contain).accessibilityIdentifier("meetings.speakers")
        }
    }
    private func voice(_ key: String) -> some View {
        let lines = (meeting.transcript ?? []).filter { $0.speaker == key }
        let first = lines.first
        let duration = lines.reduce(0.0) { $0 + max(0, $1.end - $1.start) }
        let speaker = store.meeting?.speakers?[key]
        return VStack(alignment: .leading, spacing: 10) {
            HStack {
                Circle().fill(MeetingVoiceStyle.color(key, keys: keys)).frame(width: 9, height: 9)
                Text(MeetingVoiceStyle.fallback(key, keys: keys)).font(NXFont.text(13, .semibold))
                Spacer()
                if speaker?.name.isEmpty == false { NexusChip(text: T(speaker?.auto == true ? "From introductions" : "Set by hand"), tone: .neutral) }
            }
            if editable {
                HStack {
                    TextField(T("Who is this?"), text: Binding(get: { store.meeting?.speakers?[key]?.name ?? "" }, set: { store.setSpeaker(key, name: $0) }))
                        .textFieldStyle(.roundedBorder).accessibilityIdentifier("meetings.speaker.name." + key)
                    if let members = meeting.members, !members.isEmpty {
                        Menu { ForEach(members) { member in Button(member.name ?? "—") { store.setSpeaker(key, name: member.name ?? "", userId: member.id) } } } label: { Image(systemName: "person.crop.circle.badge.plus").frame(width: 36, height: 36) }.accessibilityLabel(T("Project members"))
                    }
                }
            } else { Text(speaker?.name.isEmpty == false ? speaker!.name : T("Not named")).font(NXFont.text(14)).textSelection(.enabled) }
            HStack {
                Text(String(format: T("%@ lines · %@"), AppNumber.int(lines.count), MeetingLabels.clock(duration))).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                Spacer()
                if let first, meeting.audio.available { Button(String(format: T("Listen %@"), MeetingLabels.clock(first.start))) { listen(first.start) }.font(NXFont.text(12, .medium)).buttonStyle(.plain).foregroundStyle(NX.violetText).accessibilityIdentifier("meetings.speaker.listen." + key) }
            }
            if let first { Text(first.text).italic().font(NXFont.text(13)).foregroundStyle(NX.mutedFg).textSelection(.enabled).fixedSize(horizontal: false, vertical: true) }
        }.nexusCard()
    }
}
