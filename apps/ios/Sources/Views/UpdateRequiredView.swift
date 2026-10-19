import SwiftUI

/// The whole app, while this build is below the server's floor.
///
/// Not a sheet and not an overlay: NexusApp draws THIS in place of RootView. An overlay sits under
/// any sheet, alert or full-screen cover already up, and a second presentation from the root fails
/// while a child is presenting — so the only way to be above login, sign-up, the splash and every
/// sheet at once is for none of them to exist. Removing RootView dismisses whatever it presented.
///
/// Deliberately no close button, no swipe, no "later": every request this build makes is being
/// refused with 426 anyway, so letting somebody past this would only lead them into a screen of
/// errors that say less than this one does.
struct UpdateRequiredView: View {
    let requirement: AppVersionGate.Requirement
    @State private var gate = AppVersionGate.shared
    @State private var queue = AttendanceQueue.shared
    @State private var appearance = AppAppearance.shared
    @Environment(\.openURL) private var openURL
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                VStack(spacing: 0) {
                    Spacer(minLength: 24)
                    Image("NexusLogo")
                        .resizable().scaledToFit()
                        .frame(width: 84, height: 84)
                        .shadow(color: NX.violet.opacity(0.3), radius: 16, y: 10)
                        .padding(.bottom, 28)
                        .accessibilityHidden(true)

                    Text(T("Update NEXUS to continue"))
                        .font(NXFont.display(24, .bold))
                        .foregroundStyle(NX.foreground)
                        .multilineTextAlignment(.center)
                        .padding(.bottom, 12)
                        .accessibilityAddTraits(.isHeader)

                    Text(T("This version is no longer supported. Your data is safe — update from the App Store and you'll pick up right where you left off."))
                        .font(NXFont.text(15))
                        .foregroundStyle(NX.mutedFg)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)

                    // A tap queued while offline is on disk in Application Support, which an update
                    // does not touch, and the new build replays it on launch. Said out loud because
                    // "is my check-in lost?" is the first thing anybody with one waiting will ask.
                    if queue.count > 0 {
                        Label(T("Your saved check-in is kept on this phone and sends itself after the update."),
                              systemImage: "tray.full.fill")
                            .font(NXFont.text(13))
                            .foregroundStyle(NX.foreground)
                            .padding(12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(NX.muted, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .padding(.top, 18)
                    }

                    Spacer(minLength: 32)

                    Button(T("Open App Store")) { openStore() }
                        .buttonStyle(NexusPrimaryButton())

                    Button {
                        Task { await gate.checkPolicy(force: true) }
                    } label: {
                        HStack(spacing: 6) {
                            if gate.checking { ProgressView().controlSize(.small) }
                            Text(T("Check again"))
                        }
                        .font(NXFont.text(14, .semibold))
                        .foregroundStyle(NX.violetText)
                        .padding(.vertical, 12)
                        .frame(maxWidth: .infinity)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .disabled(gate.checking)
                    .padding(.top, 6)

                    // Numbers only, so nothing here needs translating: which build this is and which
                    // one the server wants. Useful the moment somebody sends a screenshot to support.
                    if let running = gate.running {
                        Text(requirement.minSupported.isEmpty ? "NEXUS \(running)" : "NEXUS \(running) → \(requirement.minSupported)")
                            .font(NXFont.text(11))
                            .foregroundStyle(NX.mutedFg.opacity(0.8))
                            .padding(.top, 8)
                    }
                }
                .frame(maxWidth: 420)
                .padding(.horizontal, 28)
                .padding(.bottom, 20)
                .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
        }
        .background(NX.background.ignoresSafeArea())
        .preferredColorScheme(appearance.theme.colorScheme)
        // The only presentation on this screen. Raised by the queue the moment a held tap meets
        // the 426, which is also the moment this screen appears.
        .heldAttendanceNotice(whileLocked: true)
        // RootView's scenePhase handler is gone while this is up, so this one keeps the check
        // running on the way back from the App Store. Throttled like the other.
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await gate.checkPolicy() } }
        }
    }

    /// The link the server gave, or — when a 426 arrived without one and the policy has not
    /// answered yet — another attempt to learn it rather than a button that silently does nothing.
    private func openStore() {
        if let url = requirement.storeUrl ?? gate.storeUrl {
            openURL(url)
        } else {
            Task { await gate.checkPolicy(force: true) }
        }
    }
}

/// Tuning Room's quiet "there is a newer version" row. Only drawn when the policy reported a newer
/// App Store build than this one and this one is still allowed — the blocking screen covers the
/// other case. Lives only in Tuning Room on purpose: the daily push already reminds people, and a
/// banner on every screen for an optional update is nagging.
struct UpdateAvailableRow: View {
    let version: String
    let storeUrl: URL
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "arrow.down.app.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(NX.violetText)
            Text(String(format: T("NEXUS %@ is available"), version))
                .font(NXFont.text(13, .bold))
                .foregroundStyle(NX.foreground)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button(T("Update")) { openURL(storeUrl) }
                .font(NXFont.text(12, .bold)).foregroundStyle(.white)
                .padding(.horizontal, 12).padding(.vertical, 7)
                .background(NX.violet, in: Capsule())
        }
        .padding(12)
        .background(NX.violet.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.violet.opacity(0.3)))
    }
}

/// The update is coming, with a date. One sentence used by both the daily alert and the Tuning Room
/// row, so the two can never name different deadlines.
enum GraceWording {
    /// "Monday 27 September, 09:00 WIB" — always office time, because the server's cutoff is one
    /// instant for everybody and a phone set to another zone must not show a different hour.
    static func deadline(_ date: Date) -> String {
        let f = DateFormatter()
        f.timeZone = TimeZone(identifier: "Asia/Jakarta")
        f.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_GB")
        f.dateFormat = "EEEE d MMMM HH:mm"
        return f.string(from: date) + " WIB"
    }

    static func sentence(_ grace: AppVersionGate.Grace) -> String {
        String(format: T("Update NEXUS by %@. After that, this version can't take attendance."),
               deadline(grace.deadline))
    }
}

/// Tuning Room's grace-period row: warning-toned, because unlike an optional update this one has a
/// date after which check-in stops working.
struct UpdateDeadlineRow: View {
    let grace: AppVersionGate.Grace
    let storeUrl: URL?
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "clock.badge.exclamationmark.fill")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(NX.warning)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 6) {
                Text(GraceWording.sentence(grace))
                    .font(NXFont.text(13, .bold))
                    .foregroundStyle(NX.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                if let storeUrl {
                    Button(T("Open App Store")) { openURL(storeUrl) }
                        .font(NXFont.text(12, .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 12).padding(.vertical, 7)
                        .background(NX.warning, in: Capsule())
                }
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(NX.warning.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.warning.opacity(0.4)))
    }
}

/// The once-a-day grace alert. Attached at the app root (NexusApp) so it can appear whichever
/// screen the day starts on; dismissible, because until the deadline this build still works.
private struct GraceWarningNotice: ViewModifier {
    @State private var gate = AppVersionGate.shared
    @Environment(\.openURL) private var openURL

    func body(content: Content) -> some View {
        content.alert(
            T("Update NEXUS soon"),
            // Never on top of the lock screen: once locked, the warning has already come true.
            isPresented: Binding(get: { !TourMode.isActive && StartupModalQueue.shared.owner == .update && gate.graceNoticeDue && gate.grace != nil && gate.required == nil },
                                 set: { if !$0, StartupModalQueue.shared.owner == .update { gate.graceNoticeSeen(); StartupModalQueue.shared.finish(.update) } }),
            presenting: gate.grace
        ) { _ in
            if let url = gate.storeUrl {
                Button(T("Open App Store")) { openURL(url) }
            }
            Button(T("Later"), role: .cancel) {}
        } message: { grace in
            Text(GraceWording.sentence(grace))
        }
        .onChange(of: gate.graceNoticeDue && gate.grace != nil && gate.required == nil, initial: true) { _, due in
            StartupModalQueue.shared.update(.update, pending: due && !TourMode.isActive)
        }
    }
}

/// "Your check-in is saved on this phone" — for taps held because the server refused this BUILD.
///
/// Two instances exist and never at the same time: one on the update cover (`whileLocked: true`),
/// which shows it the moment the 426 happens, and one on the Attendance screen (`whileLocked:
/// false`), which shows it on opening while anything is still held and the lock is not up. The
/// lock condition is what keeps the Attendance one from grabbing the notice in the instant before
/// the cover replaces it — an alert dismissed by its view disappearing would mark it seen.
private struct HeldAttendanceNotice: ViewModifier {
    let whileLocked: Bool
    @State private var queue = AttendanceQueue.shared
    @State private var gate = AppVersionGate.shared
    @Environment(\.openURL) private var openURL

    private var kinds: Set<PendingAttendance.Kind> { queue.heldKinds }
    private var title: String {
        if kinds == [.checkIn] { return T("Your check-in is saved on this phone") }
        if kinds == [.checkOut] { return T("Your check-out is saved on this phone") }
        return T("Your attendance is saved on this phone")
    }
    private var message: String {
        if kinds == [.checkIn] {
            return T("NEXUS needs an update before it can send it. Update from the App Store — your check-in will be sent automatically with the time you tapped.")
        }
        if kinds == [.checkOut] {
            return T("NEXUS needs an update before it can send it. Update from the App Store — your check-out will be sent automatically with the time you tapped.")
        }
        return T("NEXUS needs an update before it can send them. Update from the App Store — they'll be sent automatically with the times you tapped.")
    }

    func body(content: Content) -> some View {
        content
            .alert(title,
                   isPresented: Binding(get: { queue.heldNoticeDue && queue.isHeldForUpdate
                                                && (gate.required != nil) == whileLocked && (whileLocked || StartupModalQueue.shared.owner == .attendance) },
                                        // Only THIS instance's own dismissal counts as seen. The
                                        // Attendance one being torn down by the cover must not
                                        // swallow the notice the cover is about to show.
                                        set: { if !$0, (gate.required != nil) == whileLocked { queue.heldNoticeDue = false; StartupModalQueue.shared.finish(.attendance) } })) {
                if let url = gate.required?.storeUrl ?? gate.storeUrl {
                    Button(T("Open App Store")) { openURL(url) }
                }
                Button(T("OK"), role: .cancel) {}
            } message: {
                Text(message)
            }
            .onChange(of: queue.heldNoticeDue && queue.isHeldForUpdate, initial: true) { _, due in
                if !whileLocked { StartupModalQueue.shared.update(.attendance, pending: due) }
            }
            .onAppear {
                // The Attendance screen says it again every time it opens with something held;
                // the cover only when the refusal first happens (the queue raises it then).
                if !whileLocked, queue.isHeldForUpdate { queue.heldNoticeDue = true }
            }
    }
}

extension View {
    func graceWarningNotice() -> some View { modifier(GraceWarningNotice()) }
    func heldAttendanceNotice(whileLocked: Bool) -> some View { modifier(HeldAttendanceNotice(whileLocked: whileLocked)) }
}
