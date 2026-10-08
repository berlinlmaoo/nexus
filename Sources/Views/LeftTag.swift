import SwiftUI

/// A small muted "Left · 10 Oct" / "Keluar · 10 Okt" beside someone who left the company (offboarding,
/// owner 8 Oct 2026). The recaps (crew board, Reports per crew, the member record) still list them
/// for the periods they were part of, and say so with an additive `leftAt` on the person. Without a
/// date (Control Room's fallback, task people) it reads just "Left" / "Keluar". Same tag as the web's
/// components/LeftTag.tsx.
struct LeftTag: View {
    /// The last working day as the server sends it: "YYYY-MM-DD" or ISO. nil = no date.
    var leftAt: String? = nil
    var size: CGFloat = 10

    var body: some View {
        Text(Self.label(leftAt))
            .font(NXFont.text(size, .semibold))
            .foregroundStyle(ChipTone.neutral.fg)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 6).padding(.vertical, 2)
            .background(ChipTone.neutral.bg, in: Capsule())
            .accessibilityLabel(Self.accessibilityText(leftAt))
    }

    /// "Left · 10 Oct", or "Left" when there is no date.
    static func label(_ leftAt: String?) -> String {
        guard let date = dateText(leftAt) else { return leftWord }
        return String(format: T("Left · %@"), date)
    }

    static func accessibilityText(_ leftAt: String?) -> String {
        guard let date = dateText(leftAt) else { return T("Left the company. Their tasks stay assigned to them.") }
        return String(format: T("Left the workspace — last working day %@"), date)
    }

    /// The bare word. Not `T("Left")`: that key already means the direction ("Kiri", the liveness
    /// check's "turn left"), and T() is keyed by the English word, so one word cannot carry both.
    static var leftWord: String { AppLanguage.shared.lang == .id ? "Keluar" : "Left" }

    /// "10 Oct" / "10 Okt". `leftAt` is an attendance date (00:00 UTC of the Jakarta day), so it is
    /// read and written in UTC: in the phone's own zone a viewer west of UTC would see the day before.
    static func dateText(_ leftAt: String?) -> String? {
        guard let leftAt, leftAt.count >= 10 else { return nil }
        guard let day = keyFormatter.date(from: String(leftAt.prefix(10))) else { return nil }
        let out = DateFormatter()
        out.timeZone = TimeZone(identifier: "UTC")
        out.locale = Locale(identifier: AppLanguage.shared.lang == .id ? "id_ID" : "en_GB")
        out.dateFormat = "d MMM"
        return out.string(from: day)
    }

    private static let keyFormatter: DateFormatter = {
        let f = DateFormatter()
        f.calendar = Calendar(identifier: .gregorian)
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: "UTC")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()
}
