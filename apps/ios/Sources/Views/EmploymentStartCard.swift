import SwiftUI

/// The web Attendance page's "Employment start date" section (BoD; UI tour run 15, Q-IB8): the date annual
/// leave is counted from, per person, with who is eligible. Reads and saves through
/// /api/attendance/employment-start, the same endpoint as the web.
struct EmploymentStartCard: View {
    @State private var members: [EmploymentStartMember] = []
    @State private var quota = 12
    @State private var loading = true
    @State private var failed = false
    @State private var query = ""
    @State private var missingOnly = false
    @State private var editing: EmploymentStartMember?
    @State private var saveError: String?

    private var filled: Int { members.filter { $0.employmentStartDate != nil }.count }
    private var eligible: Int { members.filter(\.eligible).count }
    private var shown: [EmploymentStartMember] {
        let q = query.trimmingCharacters(in: .whitespaces)
        return members.filter { m in
            (!missingOnly || m.employmentStartDate == nil)
                && (q.isEmpty || "\(m.name ?? "") \(m.email ?? "")".localizedCaseInsensitiveContains(q))
        }
    }

    @State private var showAll = false
    private static let foldAt = 8

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(T("Employment start date")).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    Text(T("The basis for annual leave ({n} days a year, reset on 1 January). Eligible after 12 months of work. Not filled in = not eligible yet.")
                        .replacingOccurrences(of: "{n}", with: AppNumber.int(quota)))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 8)
                if !members.isEmpty {
                    Text(T("{filled}/{total} filled in · {eligible} eligible")
                        .replacingOccurrences(of: "{filled}", with: AppNumber.int(filled))
                        .replacingOccurrences(of: "{total}", with: AppNumber.int(members.count))
                        .replacingOccurrences(of: "{eligible}", with: AppNumber.int(eligible)))
                        .font(NXFont.text(11, .bold)).foregroundStyle(NX.foreground)
                        .padding(.horizontal, 10).padding(.vertical, 4)
                        .background(NX.muted, in: Capsule())
                        .fixedSize()
                }
            }
            if members.count > 8 {
                HStack(spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "magnifyingglass").font(.system(size: 13)).foregroundStyle(NX.mutedFg)
                        TextField(T("Search…"), text: $query).font(NXFont.text(14)).textFieldStyle(.plain)
                            .textInputAutocapitalization(.never).autocorrectionDisabled()
                    }
                    .padding(.horizontal, 10).frame(maxWidth: 320, minHeight: 36)
                    .background(NX.background, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).strokeBorder(NX.border))
                    Button { missingOnly.toggle() } label: {
                        Text("\(T("Not filled in only")) (\(AppNumber.int(members.count - filled)))")
                            .font(NXFont.text(12, .semibold))
                            .padding(.horizontal, 12).padding(.vertical, 6)
                            .nxChoiceChip(on: missingOnly)
                            .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(missingOnly ? .isSelected : [])
                    Spacer(minLength: 0)
                }
            }
            if loading && members.isEmpty {
                Text(T("Loading…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else if failed && members.isEmpty {
                EmptyState(icon: "exclamationmark.triangle", title: T("Couldn't load."),
                           actionTitle: T("Try again"), actionIcon: "arrow.clockwise",
                           action: { Task { await load() } }, compact: true)
            } else if shown.isEmpty {
                Text(T("No one matches.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                // The first eight, then "Show all n": 54 rows ran three screens down the page (UI tour run 16,
                // R16-I-28). A search or "Not filled in only" shows every match.
                let folded = !showAll && query.isEmpty && !missingOnly && shown.count > Self.foldAt
                let rows = folded ? Array(shown.prefix(Self.foldAt)) : shown
                VStack(spacing: 0) {
                    ForEach(rows) { m in
                        row(m)
                        if m.id != rows.last?.id { Divider() }
                    }
                }
                if shown.count > Self.foldAt && query.isEmpty && !missingOnly {
                    Button { withAnimation(.snappy) { showAll.toggle() } } label: {
                        Text(showAll ? T("Show fewer") : String(format: T("Show all %d"), shown.count))
                            .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                            .frame(minHeight: 44).contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
        }
        .nexusCard()
        .task { await load() }
        .sheet(item: $editing) { m in
            EmploymentStartDateSheet(member: m) { date in
                Task { await save(m, date) }
            }
        }
        .alert(T("Couldn't save the date."), isPresented: Binding(get: { saveError != nil }, set: { if !$0 { saveError = nil } })) {
            Button("OK") { saveError = nil }
        } message: { Text(saveError ?? "") }
    }

    private func row(_ m: EmploymentStartMember) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(m.name ?? m.email ?? "—").font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(statusLine(m)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 8)
            Button { editing = m } label: {
                Text(m.employmentStartDate.flatMap(Self.dayLabel) ?? T("Pick a date"))
                    .font(NXFont.text(13)).foregroundStyle(m.employmentStartDate == nil ? NX.mutedFg : NX.foreground)
                    .padding(.horizontal, 10).frame(minHeight: 34)
                    .background(NX.background, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                    .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(T("Employment start date")), \(m.name ?? "")")
            Text(m.eligible ? T("Eligible") : T("Not yet"))
                .font(NXFont.text(11, .bold))
                .foregroundStyle(m.eligible ? NX.success : NX.mutedFg)
                .padding(.horizontal, 8).padding(.vertical, 3)
                .background((m.eligible ? NX.success : NX.mutedFg).opacity(0.12), in: Capsule())
                .fixedSize()
        }
        .padding(.vertical, 8)
    }

    private func statusLine(_ m: EmploymentStartMember) -> String {
        if m.employmentStartDate == nil { return T("Can't request leave yet") }
        if m.eligible { return T("Eligible for annual leave") }
        return T("Eligible from {date}").replacingOccurrences(of: "{date}", with: m.eligibleFrom.flatMap(Self.dayLabel) ?? "—")
    }

    /// "14 Oct 2026" from "2026-10-14…".
    static func dayLabel(_ iso: String) -> String? {
        guard let d = ProjDate.fmt("yyyy-MM-dd").date(from: String(iso.prefix(10))) else { return nil }
        return AppDateLocale.formatter("d MMM yyyy").string(from: d)
    }

    private func load() async {
        loading = true; defer { loading = false }
        do {
            let r = try await APIClient.shared.employmentStartDates()
            members = r.members
            quota = r.quota ?? quota
            failed = false
        } catch {
            failed = true
        }
    }

    private func save(_ m: EmploymentStartMember, _ date: String?) async {
        do {
            try await APIClient.shared.setEmploymentStartDate(userId: m.userId, date: date)
            await load()
        } catch {
            saveError = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the date.")
        }
    }
}

/// Picks one person's start date (not after today), or clears it.
private struct EmploymentStartDateSheet: View {
    let member: EmploymentStartMember
    let onSave: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var date = Date()

    var body: some View {
        NavigationStack {
            Form {
                DatePicker(T("Employment start date"), selection: $date, in: ...Date(), displayedComponents: .date)
                    .datePickerStyle(.graphical)
                if member.employmentStartDate != nil {
                    Button(T("Clear the date"), role: .destructive) { onSave(nil); dismiss() }
                }
            }
            .navigationTitle(member.name ?? member.email ?? T("Employment start date"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(T("Save")) {
                        onSave(ProjDate.fmt("yyyy-MM-dd").string(from: date))
                        dismiss()
                    }
                }
            }
        }
        .presentationDetents([.large])
        .onAppear {
            if let iso = member.employmentStartDate, let d = ProjDate.fmt("yyyy-MM-dd").date(from: String(iso.prefix(10))) { date = d }
        }
    }
}
