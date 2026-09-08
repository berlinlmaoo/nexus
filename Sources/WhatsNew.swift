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

/// Three tiers, because a release with fifty commits in it cannot be fifty cards. `.headline` is
/// something you go and do differently tomorrow and gets a miniature of the real control;
/// `.also` is worth knowing but not worth a picture; `.fix` is "the thing that annoyed you is gone".
enum WhatsNewKind { case headline, also, fix }

struct WhatsNewEntry: Identifiable {
    let id = UUID()
    var kind: WhatsNewKind = .headline
    let icon: String
    let title: String
    var body: String = ""
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
        // ── headline: things somebody does differently tomorrow ─────────────────────────────
        WhatsNewEntry(
            icon: "sparkle",
            title: T("GIDEON answers attendance tickets properly"),
            body: T("File a ticket about your attendance and GIDEON now reads the record itself — your shift, whether a permit covers the day, whether NEXUS was down, and what the day actually cost you. It proposes the fix for a BoD to approve, and it can propose giving your XP back without changing your recorded hours."),
            demo: AnyView(DemoGideon())
        ),
        WhatsNewEntry(
            icon: "at",
            title: T("Threads is open to everyone"),
            body: T("The company feed used to be BoD-only. Everyone can read, post, comment and like it now — and posts can carry up to four photos."),
            demo: AnyView(DemoComposer())
        ),
        WhatsNewEntry(
            icon: "bolt.horizontal",
            title: T("Files upload faster on the office WiFi"),
            body: T("Photos and files go straight to the server instead of out to the internet and back, so they finish sooner. Nothing to switch on — the app checks whether you are on the office WiFi and picks the faster route itself."),
            demo: AnyView(DemoLan())
        ),
        WhatsNewEntry(
            icon: "applewatch",
            title: T("Apple Watch, widgets and Siri"),
            body: T("Check in from your wrist, keep attendance on the Home and Lock Screen, and ask Siri. The work session shows in the Dynamic Island while it runs."),
            demo: AnyView(DemoWatch())
        ),
        WhatsNewEntry(
            icon: "ellipsis.circle",
            title: T("Delete a post in Threads"),
            body: T("BoD only. In Threads, the dots at the top right of a post remove it — your own, or anyone's. It disappears from the feed for everyone."),
            bodOnly: true
        ),
        WhatsNewEntry(
            icon: "arrow.triangle.swap",
            title: T("Move a ticket from the app"),
            body: T("Tap the status chip at the top of a ticket to move it between Open, In review, Resolved and Closed."),
            bodOnly: true
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
            bodOnly: true
        ),

        // ── also new: worth knowing, not worth a picture ────────────────────────────────────
        WhatsNewEntry(kind: .also, icon: "message", title: T("Chat with GIDEON from the app, and show it a picture")),
        WhatsNewEntry(kind: .also, icon: "doc.text", title: T("Fill in a form in the app, and open a form link straight into it")),
        WhatsNewEntry(kind: .also, icon: "ticket", title: T("File a ticket from your phone and follow the conversation on it")),
        WhatsNewEntry(kind: .also, icon: "bell.badge", title: T("Notifications filter, clear, and land on the thing they point at")),
        WhatsNewEntry(kind: .also, icon: "person.crop.circle", title: T("Open a colleague's profile from any list of people")),
        WhatsNewEntry(kind: .also, icon: "tray.full", title: T("One attendance approval queue, with the reason a request was rejected")),
        WhatsNewEntry(kind: .also, icon: "doc.on.doc", title: T("Open a submission and read what was actually filed")),
        WhatsNewEntry(kind: .also, icon: "arrow.up.circle", title: T("Uploads show how far they have got")),
        WhatsNewEntry(kind: .also, icon: "person.3", title: T("Manage team members and project access from the team"), bodOnly: true),
        WhatsNewEntry(kind: .also, icon: "slider.horizontal.3", title: T("Control Room tabs scroll instead of being squeezed into one row"), bodOnly: true),
        WhatsNewEntry(kind: .also, icon: "iphone", title: T("Control Room shows who has the app, on which build, and who uses GIDEON"), bodOnly: true),

        // ── fixed ──────────────────────────────────────────────────────────────────────────
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("XP and day-off tokens taken on 2–3 September have been given back — NEXUS was unreachable for 19 hours and the nightly job charged people for it")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("Large files could never be uploaded, and a failed upload said nothing at all")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("Ten rows across the app looked tappable and did nothing")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("Photos on a post did not appear when you opened its thread")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("Closing the GIDEON panel erased the question you had just asked")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("An attachment sent to GIDEON showed on the wrong message")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("An approved request was hard to find again, and requests could not be swiped away")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("A colleague's XP penalties were visible to everyone")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("Menu entries that only ever answered \"forbidden\" are gone")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("Pictures load quicker and stay cached after the app restarts; the Dashboard no longer redraws itself as you scroll")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("The post menu was too small to hit reliably")),
        WhatsNewEntry(kind: .fix, icon: "checkmark", title: T("Files in a project and the Knowledge Library are gone — Z Vault replaces both in 0.1.4")),
    ] }
}

// MARK: - miniatures
//
// Drawn from the same tokens as the real controls, so they age with the app instead of becoming
// pictures of a version that no longer exists.

private struct DemoLan: View {
    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "wifi").font(.system(size: 15, weight: .bold)).foregroundStyle(NX.success)
            Text(T("Office network")).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
            Spacer()
            Text(T("direct")).font(NXFont.text(11, .bold)).foregroundStyle(NX.success)
                .padding(.horizontal, 9).padding(.vertical, 4)
                .background(NX.success.opacity(0.14), in: Capsule())
        }
    }
}

private struct DemoWatch: View {
    var body: some View {
        HStack(spacing: 14) {
            ForEach(["applewatch", "square.grid.2x2.fill", "mic.fill"], id: \.self) { icon in
                Image(systemName: icon).font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(NX.violetText)
                    .frame(width: 40, height: 40)
                    .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
            }
            Spacer()
        }
    }
}

private struct DemoGideon: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "sparkle").font(.system(size: 11, weight: .bold))
                    .foregroundStyle(NX.violetText)
                Text("GIDEON").font(NXFont.text(11, .bold)).foregroundStyle(NX.violetText)
            }
            HStack {
                Text(T("XP cut that day")).font(NXFont.text(10, .bold)).foregroundStyle(NX.mutedFg)
                Spacer()
                Text("-150").font(NXFont.text(14, .bold)).foregroundStyle(NX.danger).monospacedDigit()
            }
            HStack(spacing: 6) {
                NexusChip(text: T("Pending"), tone: .warning)
                Text(T("Waiting on a BoD decision. The attendance record has not changed."))
                    .font(NXFont.text(10)).foregroundStyle(NX.mutedFg).lineLimit(2)
            }
        }
    }
}

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
                        WhatsNewBody(entries: entries)
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

}

/// Headline entries as cards with their miniature, then the short lists. Written once and used by
/// both the sheet and the pushed screen, because two copies you have to remember to change together
/// is how the two of them end up different.
struct WhatsNewBody: View {
    let entries: [WhatsNewEntry]

    private var headline: [WhatsNewEntry] { entries.filter { $0.kind == .headline } }
    private var also: [WhatsNewEntry] { entries.filter { $0.kind == .also } }
    private var fixes: [WhatsNewEntry] { entries.filter { $0.kind == .fix } }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            ForEach(headline) { WhatsNewRow(entry: $0) }
            if !also.isEmpty { list(T("Also new"), also) }
            if !fixes.isEmpty { list(T("Fixed"), fixes) }
        }
    }

    private func list(_ heading: String, _ rows: [WhatsNewEntry]) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionLabel(heading)
            VStack(alignment: .leading, spacing: 9) {
                ForEach(rows) { e in
                    HStack(alignment: .top, spacing: 9) {
                        Image(systemName: e.icon)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(e.kind == .fix ? NX.success : NX.violetText)
                            .frame(width: 16)
                            // Aligns the glyph with the first LINE of the text rather than the
                            // middle of a paragraph that wraps to three.
                            .padding(.top, 2)
                        Text(e.title).font(NXFont.text(13)).foregroundStyle(NX.foreground.opacity(0.9))
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .nexusCard(padding: 14)
        }
    }
}

struct WhatsNewRow: View {
    let entry: WhatsNewEntry
    var body: some View { draw(entry) }

    private func draw(_ e: WhatsNewEntry) -> some View {
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

/// The same notes, reachable on purpose from More rather than only once after an update.
///
/// Exists because "shown once, then never again" makes a feature you cannot go back and check —
/// and the first thing anybody asks about a release-notes sheet is how to see it again. Pushed, not
/// presented: it is a place in the app, not an interruption.
struct WhatsNewScreen: View {
    @State private var viewer = Viewer.shared

    private var current: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
    }
    private var entries: [WhatsNewEntry] {
        WhatsNew.entries(for: current).filter { !$0.bodOnly || viewer.isBoD }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    Text("NEXUS \(current)").font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                    if entries.isEmpty {
                        // A build with no notes written says so, rather than showing an empty page
                        // that reads as a bug.
                        EmptyState(icon: "sparkles", title: T("Nothing new to show"),
                                   subtitle: T("No release notes were written for this version."))
                    } else {
                        WhatsNewBody(entries: entries)
                    }
                }
                .padding(20)
            }
        }
        .navigationTitle(T("What's new"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await viewer.loadIfNeeded() }
    }
}

// MARK: - when to show it

/// Attached once, at the root. Decides on appearance and never again for that version.
struct WhatsNewGate: ViewModifier {
    /// Empty means "has not seen release notes for any version yet".
    ///
    /// It is TEMPTING to read that as a fresh install and stay quiet. That was the first cut, and it
    /// was wrong in the way that matters: this key has never existed on anybody's phone, so every
    /// one of the 46 people already using NEXUS would have taken the fresh-install branch and not a
    /// single person would have seen the 0.1.3 notes. A feature that never fires.
    ///
    /// The two cases are genuinely indistinguishable today — nothing on the device says whether the
    /// app was here yesterday. So the cost of each mistake decides it: showing a brand-new user one
    /// short sheet is mildly redundant, showing nobody anything makes the whole thing pointless.
    /// `firstRunVersion` below records enough that 0.1.4 onward can tell them apart properly.
    @AppStorage("whatsNew.lastSeenVersion") private var lastSeen = ""
    /// The version this device first ran AFTER release notes existed. From the next release on,
    /// firstRun == current with nothing seen yet is a real fresh install and stays quiet.
    @AppStorage("whatsNew.firstRunVersion") private var firstRun = ""
    @State private var showing = false
    @State private var entries: [WhatsNewEntry] = []
    @State private var viewer = Viewer.shared
    /// Gated on being signed in for two reasons: a release-notes sheet over the login screen is
    /// nonsense, and the role lookup below is an API call that would only 401 there.
    ///
    /// OPTIONAL on purpose. The non-optional form traps when nothing upstream provided the value,
    /// which is a whole app that will not open — over release notes. Read this way, a modifier that
    /// ends up in the wrong place simply shows nothing.
    @Environment(AuthStore.self) private var auth: AuthStore?

    private var current: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""
    }

    func body(content: Content) -> some View {
        content
            .task(id: auth?.session?.userId) {
                guard auth?.session?.userId != nil else { return }
                guard !current.isEmpty else { return }
                let firstEver = firstRun.isEmpty
                if firstEver { firstRun = current }
                // A fresh install of THIS version, proven rather than assumed: the device had no
                // record of any version and the one it landed on is the one running. Only true from
                // 0.1.4 on — on 0.1.3 firstRun is empty for everybody, updaters included, which is
                // exactly why that branch does not fire here.
                if !firstEver && firstRun == current && lastSeen.isEmpty { lastSeen = current; return }
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
