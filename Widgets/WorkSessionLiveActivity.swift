import ActivityKit
import WidgetKit
import SwiftUI

// The widget extension does not link Theme.swift — that file carries UIKit appearance work the
// extension has no business running. These two are the only colours the Island needs, taken from
// the same palette: NX.violet and NX.warning.
private let nxViolet = Color(red: 0x7B / 255, green: 0x68 / 255, blue: 0xEE / 255)
private let nxAmber = Color(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255)

/// Where every tap on this activity lands. A literal, so the force-unwrap cannot fail at runtime.
private let nxAttendanceURL = URL(string: "nexus://attendance")!

/// The work session on the Lock Screen and in the Dynamic Island.
struct WorkSessionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkSessionAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.5))
                .activitySystemActionForegroundColor(.white)
                .widgetURL(nxAttendanceURL)
        } dynamicIsland: { context in
            let state = context.state
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label {
                        Text(state.officeName ?? "NEXUS").lineLimit(1)
                    } icon: {
                        Image(systemName: symbol(state))
                    }
                    .font(.caption)
                    .foregroundStyle(accent(state))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    elapsed(state)
                        .font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit())
                        .foregroundStyle(accent(state))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 10) {
                        Text(caption(state))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                        Spacer(minLength: 0)
                        // Hidden while anything is still queued: offering to close a day whose
                        // start has not reached the server yet only invites a second failure.
                        if !state.isPending {
                            // Opens the attendance screen and stops there. Check-out needs a selfie
                            // and the reflection, so a button that appeared to finish the job from
                            // here would be the loosest path in the app.
                            Link(destination: nxAttendanceURL) {
                                Text("Check out")
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
                elapsed(state)
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
                Text(state.officeName ?? "NEXUS")
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
                Text(caption(state))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
            }
            Spacer(minLength: 8)
            elapsed(state)
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
private func accent(_ state: WorkSessionAttributes.ContentState) -> Color {
    state.isPending ? nxAmber : nxViolet
}

private func symbol(_ state: WorkSessionAttributes.ContentState) -> String {
    state.isPending ? "arrow.triangle.2.circlepath" : "briefcase.fill"
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
        return "Saved on this phone — sending when the server is back"
    }
    if state.isPending {
        return state.pendingCount == 1
            ? "1 tap still to send"
            : "\(state.pendingCount) taps still to send"
    }
    if let out = state.expectedOutAt {
        return "Until \(out.formatted(date: .omitted, time: .shortened))"
    }
    return "Checked in"
}
