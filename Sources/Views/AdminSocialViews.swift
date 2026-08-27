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
                .font(NXFont.text(13, .bold)).foregroundStyle(NX.violet)
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
        case "BOD": return "BoD"
        case "MANAGER": return "Manager"
        case "STAFF": return "Staff"
        default: return role
        }
    }
    private var color: Color {
        switch role {
        case "ONE_ABOVE_ALL": return NX.danger
        case "BOD": return NX.violet
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
        .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(color.opacity(0.3), style: StrokeStyle(lineWidth: 1, dash: [5])))
    }
}

struct ErrorState: View {
    let message: String
    let retry: () -> Void
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
            Text(message).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
            Button(T("Try again"), action: retry).buttonStyle(NexusPrimaryButton(fullWidth: false))
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
    }
}

struct EmptyState: View {
    let icon: String
    let title: String
    let subtitle: String
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 42)).foregroundStyle(NX.mutedFg.opacity(0.5))
            Text(title).font(NXFont.display(17, .bold)).foregroundStyle(NX.foreground).multilineTextAlignment(.center)
            Text(subtitle).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
    }
}
