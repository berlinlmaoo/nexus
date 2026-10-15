import SwiftUI

// MARK: - Control Room shared bits (AdminView is in AdminEditViews.swift)

struct AdminStat: View {
    let label: String
    let value: Int
    let active: Bool
    let action: () -> Void
    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) {
                Text("\(value)").font(NXFont.display(22, .bold)).foregroundStyle(NX.foreground)
                Text(label).font(NXFont.text(11, .medium)).foregroundStyle(NX.mutedFg).lineLimit(1).minimumScaleFactor(0.8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(NX.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(active ? NX.violet : NX.border, lineWidth: active ? 1.5 : 1))
        }
        .buttonStyle(.plain)
    }
}

struct AdminMemberRow: View {
    let member: WorkspaceRoster.Member
    var body: some View {
        HStack(spacing: 12) {
            Text(member.initial)
                .font(NXFont.text(13, .bold)).foregroundStyle(NX.violetText)
                .frame(width: 38, height: 38)
                .background(NX.violet.opacity(0.12), in: Circle())
                .overlay(Circle().strokeBorder(NX.border))
            VStack(alignment: .leading, spacing: 2) {
                Text(member.displayName).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                if let email = member.user?.email, !email.isEmpty {
                    Text(email).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            Spacer(minLength: 6)
            RoleChip(role: member.role ?? "STAFF")
        }
        .padding(.horizontal, 14).padding(.vertical, 11)
    }
}

/// Org-role pill matching web ORG_ROLE_LABEL / ORG_ROLE_TONE (rose / violet / sky / muted).
struct RoleChip: View {
    let role: String
    private var label: String {
        switch role {
        case "ONE_ABOVE_ALL": return "One Above All"
        case "BOD": return "Board"
        case "MANAGER": return "Manager"
        case "STAFF": return "Staff"
        default: return role
        }
    }
    private var color: Color {
        switch role {
        case "ONE_ABOVE_ALL": return NX.danger
        case "BOD": return NX.violetText
        case "MANAGER": return NX.blue
        default: return NX.mutedFg
        }
    }
    var body: some View {
        Text(label).font(NXFont.text(11, .bold))
            .padding(.horizontal, 9).padding(.vertical, 4)
            .foregroundStyle(color)
            .background(color.opacity(0.14), in: Capsule())
    }
}

// MARK: - shared small states

struct NoticeCard: View {
    let tone: ChipTone
    let title: String
    let message: String
    private var color: Color { tone == .warning ? NX.warning : tone == .danger ? NX.danger : NX.blue }
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(NXFont.text(13, .bold)).foregroundStyle(color)
            Text(message).font(NXFont.text(12)).foregroundStyle(color.opacity(0.85))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(color.opacity(0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(color.opacity(0.3), lineWidth: 1))
    }
}

/// A screen that could not load, drawn as an `EmptyState` so it answers the same three things:
/// what happened (title), what it means (subtitle), and what to do (a real, full-width button —
/// the compact pill read as an afterthought on a screen that has nothing else on it).
///
/// When the message is the "nothing answered" sentence, the title says that calmly and the
/// subtitle gives the next step; the raw sentence would only repeat it. Anything else is the
/// server's own words and goes in the subtitle verbatim.
struct ErrorState: View {
    let message: String
    /// The screen's own icon, used when the server did answer (a 403, a 404). An unreachable
    /// server always gets the wifi mark, whichever screen it happened on.
    var icon: String = "exclamationmark.triangle"
    let retry: () -> Void

    private var unreachable: Bool { message == APIError.unreachableText }

    var body: some View {
        VStack(spacing: 6) {
            EmptyState(icon: unreachable ? "wifi.exclamationmark" : icon,
                       title: unreachable ? T("Can't reach NEXUS right now") : T("Couldn't load this"),
                       subtitle: unreachable ? T("Check your connection, or try again in a moment.") : message)
                // EmptyState fills the height when not compact; here it sits above the button, so
                // it takes only what it needs and the pair stays centred together.
                .fixedSize(horizontal: false, vertical: true)
            Button(action: retry) { Label(T("Try again"), systemImage: "arrow.clockwise") }
                .buttonStyle(NexusPrimaryButton())
                .frame(maxWidth: 320)
                .padding(.horizontal, 24)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// The one empty state in the app.
///
/// An empty screen has to answer three things or it reads as broken: WHY there is nothing here
/// (the subtitle: what this place is for and where its content comes from), WHAT to do next, and
/// a way to do it right there (the action). "No data" answered none of them, and a grey icon with
/// a headline answered one. `compact` is for a card inside a scrolling screen, where a full-height
/// centred block would push everything below it off screen.
struct EmptyState: View {
    let icon: String
    let title: String
    var subtitle: String = ""
    /// Kept for the callers that pass one; the calm style (web UI sweep, 12 Oct 2026) draws the icon muted.
    var tint: Color = NX.violet
    var actionTitle: String? = nil
    var actionIcon: String? = "plus"
    var action: (() -> Void)? = nil
    var compact: Bool = false
    /// The action as the web's filled primary button (near-black), where the web draws it so: Room
    /// Booking's "New booking" (UI tour run 15, Q-IA15 / Q-M22).
    var prominent: Bool = false

    /// The web's calm empty state after the UI sweep: one muted icon in a soft circle, the title, why it
    /// is empty and where things come from, and the next step as a quiet button. No illustration stack.
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon)
                .font(.system(size: compact ? 18 : 22, weight: .regular))
                .foregroundStyle(NX.mutedFg)
                .frame(width: compact ? 44 : 56, height: compact ? 44 : 56)
                .background(NX.muted, in: Circle())
                .padding(.bottom, 4)
                .accessibilityHidden(true)
            Text(title).font(NXFont.text(compact ? 15 : 16, .semibold)).foregroundStyle(NX.foreground).multilineTextAlignment(.center)
            if !subtitle.isEmpty {
                Text(subtitle).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true).frame(maxWidth: 380)
            }
            if let actionTitle, let action {
                Button { action() } label: {
                    Group { if let actionIcon { Label(actionTitle, systemImage: actionIcon) } else { Text(actionTitle) } }
                        .font(NXFont.text(13, .semibold)).foregroundStyle(prominent ? NX.background : NX.foreground)
                        .padding(.horizontal, 14).padding(.vertical, 8)
                        .background(prominent ? NX.onyx : NX.card, in: Capsule())
                        .overlay(Capsule().strokeBorder(prominent ? Color.clear : NX.border))
                        // The pill stays compact; the place a finger can hit is the full 44 pt.
                        .frame(minHeight: 44).contentShape(Rectangle())
                }
                .buttonStyle(.plain).padding(.top, 4)
                .hoverEffect(.highlight)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: compact ? nil : .infinity)
        .padding(.vertical, compact ? 18 : 32).padding(.horizontal, 24)
    }

    /// The pill under the white label. On the default tint it takes the deeper brand shade: white
    /// 13 pt type on the brand violet itself is 4.15:1 in light mode, under AA (impeccable audit,
    /// 6 Oct 2026). The icon above keeps the tint; a screen that passes its own tint keeps it here too.
    private var actionFill: Color { tint == NX.violet ? NX.violetFill : tint }
}
