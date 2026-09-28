import ActivityKit
import WidgetKit
import SwiftUI

// The widget extension does not link Theme.swift — that file carries UIKit appearance work the
// extension has no business running. These two are the only colours the Island needs, taken from
// the same palette: NX.violet and NX.warning.
/// White, not the brand violet: the Live Activity sits on the always-dark Lock Screen and Dynamic
/// Island, where violet read as tinted and dim next to the system's own white glyphs (owner's call,
/// 24 Sep 2026). The name is kept so every use site reads the same.
private let nxViolet = Color.white
private let nxAmber = Color(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255)

/// Where every tap on this activity lands. A literal, so the force-unwrap cannot fail at runtime.
private let nxAttendanceURL = URL(string: "nexus://attendance")!
/// Outside the office: today's permit composer, prefilled — where the outside pushes' "File a
/// permit" action lands too (AppRouter.openScheme).
private let nxPermitTodayURL = URL(string: "nexus://attendance?permit=today")!

/// The work session on the Lock Screen and in the Dynamic Island.
struct WorkSessionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkSessionAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.5))
                .activitySystemActionForegroundColor(.white)
                // From the reminder on, a tap goes where the words point: today's permit, prefilled.
                .widgetURL(context.state.isOutside && context.state.stage != .outside ? nxPermitTodayURL : nxAttendanceURL)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(title(state, short: true)).lineLimit(1).minimumScaleFactor(0.8)
                    } icon: {
                        Image(systemName: symbol(state))
                    }
                    .font(.caption)
                    .foregroundStyle(accent(state))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    clock(state)
                        .font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit())
                        .foregroundStyle(accent(state))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 10) {
                        Text(caption(state))
                            .font(.caption)
                            .foregroundStyle(captionStyle(state))
                            .lineLimit(2)
                        Spacer(minLength: 0)
                        if state.isOutside {
                            // The way out of the countdown that does not involve walking back:
                            // an excuse for today holds the server's clock the moment it is filed.
                            Link(destination: nxPermitTodayURL) {
                                Text(tr(state, "File a permit", "Ajukan izin"))
                                    .font(.caption.weight(.semibold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(Capsule().fill(nxAmber.opacity(0.25)))
                            }
                            .foregroundStyle(nxAmber)
                        } else if !state.isPending {
                            // Hidden while anything is still queued: offering to close a day whose
                            // start has not reached the server yet only invites a second failure.
                            // Opens the attendance screen and stops there. Check-out needs a selfie
                            // and the reflection, so a button that appeared to finish the job from
                            // here would be the loosest path in the app.
                            Link(destination: nxAttendanceURL) {
                                Text(tr(state, "Check out", "Check-out"))
                                    .font(.caption.weight(.semibold))
                                    .padding(.horizontal, 12)
                                    .padding(.vertical, 6)
                                    .background(Capsule().fill(nxViolet.opacity(0.25)))
                            }
                            .foregroundStyle(nxViolet)
                        }
                    }
                }
            } compactLeading: {
                Image(systemName: symbol(state)).foregroundStyle(accent(state))
            } compactTrailing: {
                // Outside: the time left before the automatic check-out, not the time worked.
                clock(state)
                    .monospacedDigit()
                    .foregroundStyle(accent(state))
                    // The compact slot is narrow and a session past one hour reads h:mm:ss. Without
                    // a width the Island clips it mid-digit.
                    .frame(maxWidth: 58)
            } minimal: {
                Image(systemName: symbol(state)).foregroundStyle(accent(state))
            }
        }
    }
}

private struct LockScreenView: View {
    let state: WorkSessionAttributes.ContentState

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol(state))
                .font(.title3)
                .foregroundStyle(accent(state))
            VStack(alignment: .leading, spacing: 2) {
                Text(title(state, short: false))
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                    .minimumScaleFactor(0.85)
                Text(caption(state))
                    .font(.caption)
                    .foregroundStyle(captionStyle(state))
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            clock(state)
                .font(.system(.title2, design: .rounded).weight(.semibold).monospacedDigit())
                .foregroundStyle(accent(state))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// MARK: - shared presentation

/// Amber the moment anything is still in flight. Somebody who tapped at 09:00 with no signal must
/// not see a screen identical to a confirmed check-in — that is exactly the person who needs to
/// know it has not landed yet.
///
/// Amber too while outside the office: the one colour on this activity that means "look at me",
/// and the app's own warning colour — not the brand violet, which reads as decoration here.
private func accent(_ state: WorkSessionAttributes.ContentState) -> Color {
    state.isPending || state.isOutside ? nxAmber : nxViolet
}

private func symbol(_ state: WorkSessionAttributes.ContentState) -> String {
    if state.isPending { return "arrow.triangle.2.circlepath" }
    return state.isOutside ? "location.fill" : "briefcase.fill"
}

/// From the warning (2 h) on, the line under the title turns amber as well: at that point it is
/// the one thing on the Lock Screen worth reading.
private func captionStyle(_ state: WorkSessionAttributes.ContentState) -> Color {
    state.isOutside && state.stage == .warned ? nxAmber : .secondary
}

/// The Live Activity's words, in the language the person picked inside the app. The extension cannot
/// reach the app's language table (Localization.swift is app-only, and its switch lives in the app's
/// own UserDefaults), so the app sends the choice in the state and the few strings drawn here carry
/// both languages. Nil or anything but "id" is English, the app's default.
private func tr(_ state: WorkSessionAttributes.ContentState, _ en: String, _ id: String) -> String {
    state.lang == "id" ? id : en
}

/// "20:59" on the office clock — the same spelling the outside pushes use.
private func hhmm(_ date: Date) -> String {
    let f = DateFormatter()
    f.dateFormat = "HH:mm"
    f.locale = Locale(identifier: "en_US_POSIX")
    f.timeZone = TimeZone(identifier: "Asia/Jakarta")
    return f.string(from: date)
}

/// The Lock Screen's first line / the expanded Island's leading label: the office normally, the
/// outside clock's start while outside.
private func title(_ state: WorkSessionAttributes.ContentState, short: Bool) -> String {
    guard state.isOutside, let since = state.outsideSince else { return state.officeName ?? "NEXUS" }
    return short
        ? tr(state, "Outside since \(hhmm(since))", "Di luar sejak \(hhmm(since))")
        : tr(state, "Outside the office since \(hhmm(since))", "Di luar kantor sejak \(hhmm(since))")
}

/// Time worked, or — outside the office — the time left before the automatic check-out.
@ViewBuilder
private func clock(_ state: WorkSessionAttributes.ContentState) -> some View {
    if state.isOutside, let since = state.outsideSince, let end = state.autoCheckoutAt, since < end {
        // Counts down on its own and stops at 0:00; the next update (the server checking the
        // person out ends the activity) replaces it. The range starts at the episode's start so it
        // is valid whatever time the view happens to be drawn at.
        Text(timerInterval: since...end, countsDown: true, showsHours: true)
    } else {
        elapsed(state)
    }
}

@ViewBuilder
private func elapsed(_ state: WorkSessionAttributes.ContentState) -> some View {
    if let start = state.startedAt {
        // Counts up on its own. No push, no timer, no battery cost.
        Text(start, style: .timer)
    } else {
        Text("--:--")
    }
}

private func caption(_ state: WorkSessionAttributes.ContentState) -> String {
    if state.isUnconfirmed {
        return tr(state, "Saved on your phone. Sends itself when NEXUS is back.",
                  "Tersimpan di HP. Terkirim sendiri saat NEXUS kembali.")
    }
    if state.isPending {
        return state.pendingCount == 1
            ? tr(state, "1 record waiting to be sent to NEXUS", "1 catatan menunggu dikirim ke NEXUS")
            : tr(state, "\(state.pendingCount) records waiting to be sent to NEXUS",
                 "\(state.pendingCount) catatan menunggu dikirim ke NEXUS")
    }
    if state.isOutside, let auto = state.autoCheckoutAt {
        // The server's own stages: the reminder at 1h30, the warning at 2h (its pushes say the same).
        switch state.stage {
        case .warned:
            return tr(state, "Head back now — auto check-out at \(hhmm(auto))",
                      "Balik ke kantor sekarang — check-out otomatis jam \(hhmm(auto))")
        case .reminded:
            return tr(state, "File a permit or head back · auto check-out \(hhmm(auto))",
                      "Ajukan izin atau balik ke kantor · check-out otomatis \(hhmm(auto))")
        default:
            return tr(state, "Auto check-out \(hhmm(auto))", "Check-out otomatis \(hhmm(auto))")
        }
    }
    if let out = state.expectedOutAt {
        return tr(state, "Until \(out.formatted(date: .omitted, time: .shortened))",
                  "Sampai \(out.formatted(date: .omitted, time: .shortened))")
    }
    return tr(state, "Checked in", "Sudah check-in")
}
