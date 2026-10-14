import SwiftUI

// MARK: - Models

struct ReflectionDay: Decodable, Identifiable, Sendable {
    let date: String
    let reflection: String
    let summary: String?
    var id: String { date }
}
struct ReflectionMonthly: Decodable, Sendable {
    let summary: String
    let sourceDays: Int
    let updatedAt: String
}
struct ReflectionsResponse: Decodable, Sendable {
    let userId: String
    let month: String
    let days: [ReflectionDay]
    let monthly: ReflectionMonthly?
}

// MARK: - Screen

/// The daily check-out reflections of one person for one month, with GIDEON's summary of each
/// day and of the month so far. Your own by default; a manager or BoD picks a person.
struct ReflectionsView: View {
    var canPickPeople: Bool = false
    @Environment(\.dismiss) private var dismiss
    @State private var monthOffset = 0
    @State private var person: (id: String, name: String)? = nil
    @State private var people: [(id: String, name: String)] = []
    @State private var data: ReflectionsResponse?
    @State private var loading = true
    @State private var error: String?
    @State private var summarizing = false
    @State private var summarizeError: String?
    @State private var expanded: Set<String> = []

    private var monthDate: Date { ProjDate.cal.date(byAdding: .month, value: monthOffset, to: Date()) ?? Date() }
    private var monthKey: String {
        let f = DateFormatter(); f.calendar = ProjDate.cal; f.timeZone = ProjDate.cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM"
        return f.string(from: monthDate)
    }
    private var monthLabel: String {
        let f = DateFormatter(); f.calendar = ProjDate.cal; f.timeZone = ProjDate.cal.timeZone; f.dateFormat = "MMMM yyyy"
        return f.string(from: monthDate)
    }
    private func dayLabel(_ iso: String) -> String {
        let p = DateFormatter(); p.dateFormat = "yyyy-MM-dd"; p.timeZone = ProjDate.cal.timeZone; p.locale = Locale(identifier: "en_US_POSIX")
        guard let d = p.date(from: iso) else { return iso }
        let f = DateFormatter(); f.calendar = ProjDate.cal; f.timeZone = ProjDate.cal.timeZone; f.locale = AppDateLocale.current; f.dateFormat = "EEE d MMM"
        return f.string(from: d)
    }
    private var days: [ReflectionDay] { data?.days ?? [] }
    private var upToDate: Bool { (data?.monthly?.sourceDays ?? -1) == days.count }

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        header
                        if loading {
                            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity).padding(.vertical, 24)
                        } else if let error {
                            Text(error).font(NXFont.text(13, .semibold)).foregroundStyle(NX.danger)
                        } else if days.isEmpty {
                            EmptyState(icon: "pencil.line", title: "\(T("No reflections in")) \(monthLabel)",
                                       subtitle: T("A reflection is written at check-out. Once one is checked out with, it shows up here with GIDEON's summary of the day."))
                        } else {
                            monthCard
                            dayList
                        }
                    }
                    .padding(16)
                }
            }
            .navigationTitle(T("Reflections")).navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button(T("Close")) { dismiss() } } }
            .task { if canPickPeople { await loadPeople() }; await load() }
            .task(id: "\(monthKey)|\(person?.id ?? "me")") { await load() }
        }
    }

    // MARK: pieces

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(T("What was written at check-out, with GIDEON's summary of each day and of the month so far."))
                .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 8) {
                if canPickPeople {
                    Menu {
                        Button(T("Me")) { person = nil; expanded = [] }
                        ForEach(people, id: \.id) { p in Button(p.name) { person = p; expanded = [] } }
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "person.crop.circle").font(.system(size: 13))
                            Text(person?.name ?? T("Me")).font(NXFont.text(12, .semibold)).lineLimit(1)
                            Image(systemName: "chevron.down").font(.system(size: 9, weight: .bold))
                        }
                        .foregroundStyle(NX.foreground).padding(.horizontal, 10).padding(.vertical, 7)
                        .background(NX.card, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
                    }
                }
                Spacer()
                HStack(spacing: 0) {
                    Button { monthOffset -= 1; expanded = [] } label: { Image(systemName: "chevron.left").font(.system(size: 12, weight: .bold)).frame(width: 30, height: 30) }
                    Text(monthLabel).font(NXFont.text(12, .semibold)).frame(minWidth: 110)
                    Button { monthOffset += 1; expanded = [] } label: { Image(systemName: "chevron.right").font(.system(size: 12, weight: .bold)).frame(width: 30, height: 30) }
                        .disabled(monthOffset >= 0).opacity(monthOffset >= 0 ? 0.3 : 1)
                }
                .foregroundStyle(NX.foreground).background(NX.card, in: Capsule()).overlay(Capsule().strokeBorder(NX.border))
            }
        }
    }

    private var monthCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label(T("GIDEON's month summary"), systemImage: "sparkles").font(NXFont.display(14, .bold)).foregroundStyle(NX.foreground)
                Spacer()
            }
            if let m = data?.monthly {
                Text(m.summary).font(NXFont.text(13)).foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true)
                let newer = days.count - m.sourceDays
                Text("\(T("Built from")) \(m.sourceDays) \(m.sourceDays == 1 ? T("day") : T("days"))" + (newer > 0 ? " · \(newer) \(T("newer not included yet"))" : ""))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            } else {
                Text("\(T("Not written yet. GIDEON summarizes whatever has been collected so far:")) \(days.count) \(days.count == 1 ? T("day") : T("days")).")
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
            }
            Button { Task { await summarize() } } label: {
                HStack(spacing: 6) {
                    if summarizing { ProgressView().tint(.white) } else { Image(systemName: "sparkles") }
                    Text(summarizing ? T("GIDEON is reading…") : (data?.monthly == nil ? T("Summarize so far") : (upToDate ? T("Summary is current") : T("Update the summary"))))
                }
            }
            .buttonStyle(NexusPrimaryButton()).disabled(summarizing)
            if let summarizeError { Text(summarizeError).font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger) }
        }
        .padding(14)
        .background(NX.violet.opacity(0.07), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.violet.opacity(0.25)))
    }

    private var dayList: some View {
        VStack(spacing: 0) {
            ForEach(days.reversed()) { d in
                let open = expanded.contains(d.date)
                VStack(alignment: .leading, spacing: 8) {
                    Button {
                        withAnimation(.easeInOut(duration: 0.2)) { if open { expanded.remove(d.date) } else { expanded.insert(d.date) } }
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Text(dayLabel(d.date)).font(NXFont.text(11, .bold)).foregroundStyle(NX.mutedFg).frame(width: 78, alignment: .leading)
                            if let s = d.summary {
                                Text(s).font(NXFont.text(13)).foregroundStyle(NX.foreground).multilineTextAlignment(.leading)
                            } else {
                                Text(T("GIDEON hasn't summarized this day yet — the note is below."))
                                    .font(NXFont.text(12)).italic().foregroundStyle(NX.mutedFg).multilineTextAlignment(.leading)
                            }
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg)
                                .rotationEffect(.degrees(open ? 90 : 0))
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if open {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(T("WRITTEN AT CHECK-OUT")).font(NXFont.text(9, .bold)).foregroundStyle(NX.mutedFg)
                            Text(d.reflection).font(NXFont.text(13)).foregroundStyle(NX.foreground).fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                        .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .padding(.leading, 88)
                    }
                }
                .padding(.vertical, 10)
                Divider().overlay(NX.border)
            }
        }
        .padding(.horizontal, 12)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.border))
    }

    // MARK: data

    private func load() async {
        loading = data == nil; error = nil; summarizeError = nil
        do { data = try await APIClient.shared.reflections(userId: person?.id, month: monthKey) }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load reflections.") }
        loading = false
    }

    private func loadPeople() async {
        // Whoever appears on the board this month — the server already scoped that to what the viewer may see.
        guard let rows = try? await APIClient.shared.attendanceRecent(scope: "workspace", days: 31) else { return }
        var seen: [String: String] = [:]
        for r in rows { if let id = r.userId, seen[id] == nil { seen[id] = r.name ?? id } }
        people = seen.map { (id: $0.key, name: $0.value) }.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func summarize() async {
        summarizing = true; summarizeError = nil; defer { summarizing = false }
        do {
            _ = try await APIClient.shared.summarizeReflections(userId: person?.id, month: monthKey)
            Haptics.success()
            await load()
        } catch { summarizeError = (error as? LocalizedError)?.errorDescription ?? T("GIDEON didn't answer. Try again in a minute.") }
    }
}
