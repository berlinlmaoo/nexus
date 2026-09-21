import SwiftUI

private let nxViolet = Color(red: 0x7B / 255, green: 0x68 / 255, blue: 0xEE / 255)

/// Seven dots per day: the colours of the crew board, sized for a wrist.
struct DayDots: View {
    let days: [AttendanceCompactDay]
    var body: some View {
        HStack(spacing: 4) {
            ForEach(days.sorted { $0.date < $1.date }, id: \.date) { d in
                VStack(spacing: 2) {
                    Circle().fill(toneColor(d.tone)).frame(width: 11, height: 11)
                    Text(weekdayLetter(d.date)).font(.system(size: 8)).foregroundStyle(.secondary)
                }
            }
        }
    }
}

func toneColor(_ t: String) -> Color {
    switch t {
    case "P", "I": return Color(red: 0x34 / 255, green: 0xD3 / 255, blue: 0x99 / 255)
    case "L":      return Color(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255)
    case "C":      return Color(red: 0.98, green: 0.80, blue: 0.20)
    case "S":      return Color(red: 0.97, green: 0.55, blue: 0.20)
    case "D":      return nxViolet
    case "A":      return Color(red: 0.94, green: 0.33, blue: 0.40)
    default:       return Color.secondary.opacity(0.3)
    }
}

func weekdayLetter(_ key: String) -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Jakarta"); f.locale = Locale(identifier: "en_US_POSIX")
    guard let d = f.date(from: key) else { return "" }
    let w = DateFormatter(); w.dateFormat = "EEEEE"; w.timeZone = f.timeZone
    return w.string(from: d)
}

func shortTime(_ iso: String?) -> String {
    guard let iso else { return "—" }
    let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let b = ISO8601DateFormatter(); b.formatOptions = [.withInternetDateTime]
    guard let d = a.date(from: iso) ?? b.date(from: iso) else { return "—" }
    return d.formatted(date: .omitted, time: .shortened)
}

/// The crew's last seven days, one row per person; a tap opens the days with their times.
///
/// Who appears is the server's call: BoD sees everybody, a manager their direct reports, and
/// anybody else gets only themselves — the same rule as the board on the phone and the web.
struct CrewView: View {
    @Environment(WatchAuth.self) private var auth
    @State private var rows: [AttendanceCompactDay] = []
    @State private var loading = true
    @State private var error: String?

    private struct Person: Identifiable { let id: String; let name: String; let days: [AttendanceCompactDay] }
    private var people: [Person] {
        let grouped = Dictionary(grouping: rows) { $0.userId ?? "me" }
        return grouped.map { Person(id: $0.key, name: $0.value.first?.name ?? "—", days: $0.value) }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    var body: some View {
        NavigationStack {
            List {
                if loading && rows.isEmpty {
                    ProgressView().frame(maxWidth: .infinity)
                } else if let error {
                    Text(error).font(.caption2).foregroundStyle(.secondary)
                } else if people.isEmpty {
                    Text("Nothing recorded in the last week.").font(.caption2).foregroundStyle(.secondary)
                } else {
                    ForEach(people) { p in
                        NavigationLink {
                            PersonDaysView(person: p.name, days: p.days)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(p.name).font(.caption.weight(.semibold)).lineLimit(1)
                                DayDots(days: p.days)
                            }
                            .padding(.vertical, 2)
                        }
                    }
                }
            }
            .navigationTitle("Crew")
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        guard let session = auth.session else { return }
        error = nil
        do {
            // Ask for the crew; the server answers with exactly who this person may see.
            rows = try await WatchAPI.recent(session, scope: "workspace")
        } catch {
            // A plain staff member is refused the workspace scope: show their own week instead.
            rows = (try? await WatchAPI.recent(session, scope: "me")) ?? []
            if rows.isEmpty { self.error = (error as? LocalizedError)?.errorDescription ?? "Couldn't load." }
        }
        loading = false
    }
}

/// One person, one line per day: the colour in words and the two times.
struct PersonDaysView: View {
    let person: String
    let days: [AttendanceCompactDay]
    var body: some View {
        List(days.sorted { $0.date > $1.date }, id: \.date) { d in
            HStack(spacing: 8) {
                Circle().fill(toneColor(d.tone)).frame(width: 10, height: 10)
                VStack(alignment: .leading, spacing: 1) {
                    Text(dayLabel(d.date)).font(.caption.weight(.semibold))
                    Text(d.label + (d.checkInAt != nil ? " · in \(shortTime(d.checkInAt)) · out \(shortTime(d.checkOutAt))" : ""))
                        .font(.caption2).foregroundStyle(.secondary)
                }
            }
        }
        .navigationTitle(person)
    }
    private func dayLabel(_ key: String) -> String {
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "Asia/Jakarta"); f.locale = Locale(identifier: "en_US_POSIX")
        guard let d = f.date(from: key) else { return key }
        let w = DateFormatter(); w.dateFormat = "EEE d MMM"; w.timeZone = f.timeZone
        return w.string(from: d)
    }
}
