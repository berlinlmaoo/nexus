import SwiftUI

/// One person's employment start date, inside their Control Room › Users detail (owner, 16 Oct 2026: set
/// per person there, no longer a crew list on Attendance; web admin.tsx `EmploymentStartField`). BoD and up,
/// the same /api/attendance/employment-start route as before (the server checks again and audits it).
struct EmploymentStartField: View {
    let userId: String
    @State private var member: EmploymentStartMember?
    @State private var loading = true
    @State private var failed = false
    @State private var editing: EmploymentStartMember?
    @State private var saving = false
    @State private var saveError: String?

    var body: some View {
        Group {
            if loading && member == nil {
                Text(T("Loading…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else if failed && member == nil {
                Button { Task { await load() } } label: {
                    Label(T("Try again"), systemImage: "arrow.clockwise")
                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                        .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            } else if let m = member {
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 12) { dateButton(m); status(m) }
                    VStack(alignment: .leading, spacing: 6) { dateButton(m); status(m) }
                }
            } else {
                // Not in this workspace's crew list (no attendance), so there is nothing to set.
                Text("—").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
        }
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

    private func dateButton(_ m: EmploymentStartMember) -> some View {
        Button { editing = m } label: {
            HStack(spacing: 6) {
                Image(systemName: "calendar").font(.system(size: 13, weight: .semibold)).foregroundStyle(NX.mutedFg)
                Text(m.employmentStartDate.flatMap(Self.dayLabel) ?? T("Pick a date"))
                    .font(NXFont.text(14)).foregroundStyle(m.employmentStartDate == nil ? NX.mutedFg : NX.foreground)
            }
            .padding(.horizontal, 12).frame(minHeight: 40)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(saving)
        .fixedSize()
        .accessibilityLabel(T("Employment start date"))
        .accessibilityValue(m.employmentStartDate.flatMap(Self.dayLabel) ?? T("Pick a date"))
    }

    private func status(_ m: EmploymentStartMember) -> some View {
        Text(statusLine(m)).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
            .fixedSize(horizontal: false, vertical: true)
    }

    private func statusLine(_ m: EmploymentStartMember) -> String {
        if m.employmentStartDate == nil { return T("Can't request leave yet") }
        if m.eligible { return T("Eligible for annual leave") }
        return T("Eligible from {date}").replacingOccurrences(of: "{date}", with: m.eligibleFrom.flatMap(Self.dayLabel) ?? "—")
    }

    /// "14 Oct 2026" from "2026-10-14…" (the web writes the year here too: a start date is often years back).
    static func dayLabel(_ iso: String) -> String? {
        guard let d = ProjDate.fmt("yyyy-MM-dd").date(from: String(iso.prefix(10))) else { return nil }
        return AppDateLocale.formatter("d MMM yyyy").string(from: d)
    }

    private func load() async {
        loading = true; defer { loading = false }
        do {
            let r = try await APIClient.shared.employmentStartDates()
            member = r.members.first { $0.userId == userId }
            failed = false
        } catch {
            failed = true
        }
    }

    private func save(_ m: EmploymentStartMember, _ date: String?) async {
        saving = true; defer { saving = false }
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
