import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// "What's new", shown once after the app updates.
//
// A release only counts if people find what changed. Threads has been open to everyone since 0.1.3
// and the delete button, the status menu and the photo picker all sit inside screens people already
// think they know — so nothing about them announces itself, and a feature nobody notices is one
// nobody uses.
//
// Every entry carries a LIVE miniature of the real control rather than a description of it. A
// sentence saying "tap the three dots" is a sentence; the actual three dots drawn the way they look
// on the row is a thing you recognise a second later on the screen itself.
// ─────────────────────────────────────────────────────────────────────────────

struct WhatsNewEntry: Identifiable {
    let id = UUID()
    let icon: String
    let title: String
    let body: String
    /// Hidden from anyone who cannot use it. Showing a STAFF member a BoD-only change is the same
    /// mistake as drawing them a Control Room button: an announcement they can only be refused.
    var bodOnly = false
    /// The miniature. `nil` for a change with no single control to point at.
    var demo: AnyView?
}

enum WhatsNew {
    /// Keyed by CFBundleShortVersionString. A version with no entry simply shows nothing, so
    /// shipping a build without writing release notes is silent rather than broken.
    @MainActor
    static func entries(for version: String) -> [WhatsNewEntry] {
        switch version {
        case "0.1.3": return v013
        default: return []
        }
    }

    @MainActor
    private static var v013: [WhatsNewEntry] { [
        WhatsNewEntry(
            icon: "at",
            title: T("Threads is open to everyone"),
            body: T("The company feed used to be BoD-only. Everyone can read, post, comment and like it now — and posts can carry up to four photos."),
            demo: AnyView(DemoComposer())
        ),
        WhatsNewEntry(
            icon: "ellipsis.circle",
            title: T("Take a post down"),
            body: T("BoD only. The dots sit at the top right of a post — your own, or anyone's."),
            bodOnly: true,
            demo: AnyView(DemoDots())
        ),
        WhatsNewEntry(
            icon: "arrow.triangle.swap",
            title: T("Move a ticket from the app"),
            body: T("Tap the status chip at the top of a ticket to move it between Open, In review, Resolved and Closed."),
            bodOnly: true,
            demo: AnyView(DemoStatusChip())
        ),
        WhatsNewEntry(
            icon: "arrow.uturn.backward.circle",
            title: T("Cancel an attendance penalty"),
            body: T("A second kind of proposal on attendance tickets: give back the XP and the day-off token without touching the recorded times."),
            bodOnly: true,
            demo: AnyView(DemoPenaltyCard())
        ),
        WhatsNewEntry(
            icon: "megaphone",
            title: T("Announcements can repeat"),
            body: T("Post one and have it come back every day until a date you set, at an hour you set — pop-up and push both."),
            bodOnly: true,
            demo: AnyView(DemoRepeat())
        ),
        WhatsNewEntry(
            icon: "slider.horizontal.3",
            title: T("Control Room tabs scroll"),
            body: T("Seven tabs no longer share one row's width, so nothing is squeezed to five letters."),
            bodOnly: true,
            demo: AnyView(DemoTabs())
        ),
    ] }
}

// MARK: - miniatures
//
// Drawn from the same tokens as the real controls, so they age with the app instead of becoming
// pictures of a version that no longer exists.

private struct DemoComposer: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 17, weight: .semibold)).foregroundStyle(NX.violetText)
            Text("2/4").font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            Spacer()
            Text(T("Post")).font(NXFont.text(13, .bold)).foregroundStyle(.white)
                .padding(.horizontal, 16).padding(.vertical, 8)
                .background(NX.violet, in: Capsule())
        }
    }
}

private struct DemoDots: View {
    var body: some View {
        HStack(spacing: 10) {
            Circle().fill(NX.muted).frame(width: 26, height: 26)
            VStack(alignment: .leading, spacing: 2) {
                RoundedRectangle(cornerRadius: 3).fill(NX.muted).frame(width: 70, height: 8)
                RoundedRectangle(cornerRadius: 3).fill(NX.muted.opacity(0.6)).frame(width: 40, height: 6)
            }
            Spacer()
            Image(systemName: "ellipsis")
                .font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.violetText)
                .frame(width: 34, height: 34)
                .background(NX.violet.opacity(0.12), in: Circle())
        }
    }
}

private struct DemoStatusChip: View {
    var body: some View {
        HStack(spacing: 8) {
            Text(T("Report body")).font(NXFont.text(13, .bold)).foregroundStyle(NX.mutedFg)
            Spacer(minLength: 4)
            HStack(spacing: 4) {
                NexusChip(text: T("In review"), tone: .accent)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold)).foregroundStyle(NX.mutedFg)
            }
        }
    }
}

private struct DemoPenaltyCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(T("XP cut that day")).font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                Spacer()
                Text("-150").font(NXFont.text(15, .bold)).foregroundStyle(NX.danger).monospacedDigit()
            }
            HStack {
                Text(T("Day off taken")).font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                Spacer()
                Text("-1").font(NXFont.text(15, .bold)).foregroundStyle(NX.danger).monospacedDigit()
            }
        }
    }
}

private struct DemoRepeat: View {
    var body: some View {
        HStack(spacing: 8) {
            ForEach([T("Once"), "+3 " + T("days"), "+7 " + T("days")], id: \.self) { label in
                Text(label).font(NXFont.text(12, .semibold))
                    .padding(.horizontal, 11).padding(.vertical, 6)
                    .foregroundStyle(label.hasPrefix("+3") ? Color.white : NX.mutedFg)
                    .background(label.hasPrefix("+3") ? NX.violet : NX.card, in: Capsule())
                    .overlay(Capsule().strokeBorder(label.hasPrefix("+3") ? .clear : NX.border))
            }
        }
    }
}

private struct DemoTabs: View {
    var body: some View {
        HStack(spacing: 6) {
            ForEach(["Users", "Absensi", "Audit", "Quests"], id: \.self) { t in
                Text(t).font(NXFont.text(12, .semibold))
                    .padding(.horizontal, 11).padding(.vertical, 6)
                    .foregroundStyle(t == "Users" ? Color.white : NX.mutedFg)
                    .background(t == "Users" ? NX.violet : NX.muted.opacity(0.6), in: Capsule())
            }
            Image(systemName: "chevron.right")
                .font(.system(size: 9, weight: .bold)).foregroundStyle(NX.mutedFg)
        }
    }
}

// MARK: - the sheet

struct WhatsNewSheet: View {
    let version: String
    let entries: [WhatsNewEntry]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(T("What's new")).font(NXFont.display(26, .bold)).foregroundStyle(NX.foreground)
                            Text("NEXUS \(version)").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        }
                        ForEach(entries) { e in row(e) }
                        Button { dismiss() } label: { Text(T("Got it")) }
                            .buttonStyle(NexusPrimaryButton())
                            .padding(.top, 4)
                    }
                    .padding(20)
                }
            }
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(T("Close")) { dismiss() } } }
        }
    }

    private func row(_ e: WhatsNewEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: e.icon)
                    .font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.violetText)
                    .frame(width: 30, height: 30)
                    .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
                VStack(alignment: .leading, spacing: 3) {
                    Text(e.title).font(NXFont.text(15, .bold)).foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(e.body).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if let demo = e.demo {
                demo
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(NX.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard(padding: 14)
    }
}

// MARK: - when to show it

/// Attached once, at the root. Decides on appearance and never again for that version.
struct WhatsNewGate: ViewModifier {
    /// Empty on a device that has never run this. That case is a FRESH INSTALL, not an update, and
    /// greeting somebody with "what's new" before they have seen the old thing is noise — so the
    /// version is recorded silently and the sheet waits for the next release.
    @AppStorage("whatsNew.lastSeenVersion") private var lastSeen = ""
    @State private var showing = false
    @State private var entries: [WhatsNewEntry] = []
    @State private var viewer = Viewer.shared
    /// Gated on being signed in for two reasons: a release-notes sheet over the login screen is
    /// nonsense, and the role lookup below is an API call that would only 401 there.
    @Environment(AuthStore.self) private var auth

    private var current: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }

    func body(content: Content) -> some View {
        content
            .task(id: auth.session?.userId) {
                guard auth.session?.userId != nil else { return }
                guard !current.isEmpty else { return }
                guard !lastSeen.isEmpty else { lastSeen = current; return }
                guard lastSeen != current else { return }
                // The role decides which entries exist at all, so it has to be known before the
                // sheet is shown — otherwise a BoD sees the staff-sized list on the one launch
                // that matters.
                await viewer.loadIfNeeded()
                let all = WhatsNew.entries(for: current)
                let mine = all.filter { !$0.bodOnly || viewer.isBoD }
                guard !mine.isEmpty else { lastSeen = current; return }
                entries = mine
                showing = true
            }
            .sheet(isPresented: $showing, onDismiss: { lastSeen = current }) {
                WhatsNewSheet(version: current, entries: entries)
            }
    }
}

extension View {
    func whatsNew() -> some View { modifier(WhatsNewGate()) }
}
