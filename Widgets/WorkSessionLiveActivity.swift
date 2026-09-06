import ActivityKit
import WidgetKit
import SwiftUI

// The widget extension does not link Theme.swift — that file carries UIKit appearance work the
// extension has no business running. These two are the only colours the Island needs, taken from
// the same palette: NX.violet and NX.warning.
private let nxViolet = Color(red: 0x7B / 255, green: 0x68 / 255, blue: 0xEE / 255)
private let nxAmber = Color(red: 0xFB / 255, green: 0xBF / 255, blue: 0x24 / 255)

/// The work session on the Lock Screen and in the Dynamic Island.
struct WorkSessionLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: WorkSessionAttributes.self) { context in
            LockScreenView(state: context.state)
                .activityBackgroundTint(Color.black.opacity(0.5))
                .activitySystemActionForegroundColor(.white)
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
                    .foregroundStyle(tint(state))
                }
                DynamicIslandExpandedRegion(.trailing) {
                    elapsed(state)
                        .font(.system(.title3, design: .rounded).weight(.semibold).monospacedDigit())
                        .foregroundStyle(tint(state))
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text(caption(state))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .lineLimit(2)
                }
            } compactLeading: {
                Image(systemName: symbol(state)).foregroundStyle(tint(state))
            } compactTrailing: {
                elapsed(state)
                    .monospacedDigit()
                    .foregroundStyle(tint(state))
                    // The compact slot is narrow and a session past one hour reads h:mm:ss. Without
                    // a width the Island clips it mid-digit.
                    .frame(maxWidth: 58)
            } minimal: {
                Image(systemName: symbol(state)).foregroundStyle(tint(state))
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
                .foregroundStyle(tint(state))
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
                .foregroundStyle(tint(state))
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }
}

// MARK: - shared presentation

/// Amber the moment anything is still in flight. Somebody who tapped at 09:00 with no signal must
/// not see a screen identical to a confirmed check-in — that is exactly the person who needs to
/// know it has not landed yet.
private func tint(_ state: WorkSessionAttributes.ContentState) -> Color {
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
