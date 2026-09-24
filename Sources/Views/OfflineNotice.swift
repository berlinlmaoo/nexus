import Foundation
import SwiftUI

/// A quiet line saying that what is on screen was saved earlier, shown only when it was.
///
/// Data that silently looks live but is a day old is worse than an empty screen, because somebody
/// acts on it. Deliberately small and grey: this is a footnote about freshness, not an error —
/// the screen it sits under is working exactly as intended.
struct OfflineNotice: View {
    let savedAt: Date

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: "arrow.down.circle").font(.system(size: 10, weight: .semibold))
            Text(String(format: T("Saved copy from %@"), Self.stamp(savedAt)))
                .font(NXFont.text(11))
        }
        .foregroundStyle(NX.mutedFg)
        .frame(maxWidth: .infinity, alignment: .center)
        .padding(.top, 2)
    }

    static func stamp(_ d: Date) -> String {
        let f = DateFormatter()
        f.timeZone = JakartaDay.calendar.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = JakartaDay.same(d, Date()) ? "HH:mm" : "d MMM, HH:mm"
        return f.string(from: d)
    }
}

/// The office's day, which is the only day attendance is ever counted in.
///
/// Every comparison about "is this still today" has to be made in Jakarta time or it is wrong for
/// anybody travelling — and a cached check-in shown on the wrong day is the single most damaging
/// thing this app can say.
enum JakartaDay {
    static let calendar: Calendar = {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = TimeZone(identifier: "Asia/Jakarta") ?? .current
        return c
    }()

    static func same(_ a: Date, _ b: Date) -> Bool { calendar.isDate(a, inSameDayAs: b) }
}
