import Foundation

/// One person's record for one attendance period (28th → 27th) — GET /api/members/<id>/record.
///
/// Every figure is decided by the server (lib/member-record.ts) so the web page and this screen can
/// never count a day differently: the Score is the board's (worked / period days − day-off
/// allowance), the day letters are history?compact=1's, and the XP rows arrive with their meaning
/// already worked out (`kind`, `dateKey`). Decoded leniently, like the rest of the app: a field an
/// older server does not send is nil, never a failed screen.
struct MemberRecord: Decodable, Sendable {
    struct Person: Decodable, Sendable {
        let id: String
        let name: String?
        let email: String?
        let avatar: String?
        let role: String?
        let joinedAt: String?
        let isSelf: Bool?
        /// ISO: the last working day of someone who left the company (offboarding, 8 Oct 2026). Their
        /// record stays readable; nil for everyone still here.
        let leftAt: String?
    }
    struct ViewerRights: Decodable, Sendable {
        /// ALL (BoD / One Above All), DIRECT_REPORTS (a manager), SELF.
        let scope: String?
        /// May set a day's status (the board's "Change status").
        let canManageAttendance: Bool?
        /// May remove an XP deduction — never on their own record.
        let canRemoveXp: Bool?
    }
    struct Period: Decodable, Sendable {
        let key: String
        let from: String?
        let to: String?
        let label: String?
        let isCurrent: Bool?
        let days: Int?
        let daysElapsed: Int?
        let previousKey: String?
        let nextKey: String?
    }
    struct Score: Decodable, Sendable {
        let worked: Int
        let working: Int
        let surplus: Int?
        let totalWorked: Int?
        /// The days the score is out of and their allowance, and the day they count from — set when
        /// someone joined during the period (servers from 13 Oct 2026, QA S-20). nil from older servers.
        var days: Int? = nil
        var allowance: Int? = nil
        var from: String? = nil
    }
    struct Counts: Decodable, Sendable {
        let present: Int?
        let permit: Int?
        let leave: Int?
        let sick: Int?
        let dayOff: Int?
        let absent: Int?
        let lateDays: Int?
        let lateMinutes: Int?
    }
    struct DayOff: Decodable, Sendable {
        struct Grant: Decodable, Sendable { let days: Int?; let reason: String? }
        let quota: Int?
        let baseQuota: Int?
        let bonusDays: Int?
        let bonusGrants: [Grant]?
        let used: Int?
        let usedRaw: Int?
        let remaining: Int?
    }
    struct Summary: Decodable, Sendable {
        let score: Score?
        let counts: Counts?
        let dayOff: DayOff?
        let xp: RecordXpTotals?
    }
    /// One cell of the person's streak row. `tone` is the server's letter: P present, L late,
    /// I permit, C leave, S sick, D day off, A absent, "" nothing.
    struct Day: Decodable, Identifiable, Sendable {
        let date: String
        let day: Int?
        let weekday: String?
        let tone: String?
        let isToday: Bool?
        let isFuture: Bool?
        let lateMinutes: Int?
        let penaltyXp: Int?
        var id: String { date }
    }
    struct Request: Decodable, Identifiable, Sendable {
        struct Reviewer: Decodable, Sendable { let id: String?; let name: String? }
        let id: String
        let type: String?
        let status: String?
        let startDate: String?
        let endDate: String?
        let days: Int?
        let reason: String?
        let reviewNote: String?
        let createdAt: String?
        let reviewedAt: String?
        let reviewedBy: Reviewer?
        /// The nightly job's own day-off cut (TK, or more than 120 minutes late) — not something filed.
        let isAuto: Bool?
    }

    let person: Person
    let viewer: ViewerRights?
    let period: Period
    let summary: Summary?
    let days: [Day]?
    let xp: RecordXp?
    let requests: [Request]?
}

struct RecordXpTotals: Decodable, Sendable {
    let gained: Int?
    let lost: Int?
    let net: Int?
    /// XP of deductions the BoD removed in the period (positive).
    let removed: Int?
}

struct RecordXp: Decodable, Sendable {
    let entries: [RecordXpEntry]?
    let totals: RecordXpTotals?
    let hasOlder: Bool?
    let olderPeriod: String?
}

/// `?only=xp` — one earlier period's XP rows, for "Load older".
struct RecordXpPage: Decodable, Sendable {
    let period: String?
    let xp: RecordXp
}

/// One XP ledger row on the record.
struct RecordXpEntry: Decodable, Identifiable, Sendable {
    struct Removal: Decodable, Sendable {
        struct By: Decodable, Sendable { let id: String?; let name: String? }
        let at: String?
        let by: By?
        let note: String?
    }
    let id: String
    /// What the row holds now: 0 once the BoD removed it.
    let amount: Int
    /// What it was written as.
    let originalAmount: Int?
    let createdAt: String?
    let reason: String?
    let kind: String?
    /// The server's English label — the fallback for a kind this build does not know.
    let label: String?
    /// The attendance day a penalty is about (usually the day before it was written).
    let dateKey: String?
    let detail: String?
    let lateMinutes: Int?
    let attendance: Bool?
    let removed: Removal?
    let canRemove: Bool?

    var shownAmount: Int { originalAmount ?? amount }
    var isRemoved: Bool { removed != nil }
    var signedAmount: String { shownAmount > 0 ? "+\(shownAmount)" : "\(shownAmount)" }

    /// The reason in the app's language, by `kind`; unknown kinds keep the server's words.
    var title: String {
        let note = (detail ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        switch kind ?? "" {
        case "late":
            if let m = lateMinutes, m > 0 { return "\(T("Late check-in")) · \(m) \(T("min"))" }
            return note.isEmpty ? T("Late check-in") : "\(T("Late check-in")) · \(note.replacingOccurrences(of: "min", with: T("min")))"
        case "nocheckout":     return T("No check-out")
        case "alpha":          return T("Absent without notice (TK)")
        case "peer_penalty":   return T("Peer report · penalty")
        case "peer_bounty":    return T("Peer report · reward")
        case "admin_adjust":   return note.isEmpty ? T("Adjusted by a board member") : "\(T("Adjusted by a board member")) · \(xpAdminNote(note))"
        case "quest":          return T("Quest completed")
        case "quest_penalty":  return T("Penalty quest")
        case "bonus":          return note.isEmpty ? T("Bonus") : "\(T("Bonus")) · \(note)"
        case "task_done":      return T("Task completed")
        case "priority_bonus": return T("Priority task bonus")
        case "goal_milestone": return T("Goal milestone")
        case "streak":         return T("Daily streak")
        default:               return label ?? reason ?? T("XP change")
        }
    }
}

/// POST /api/gamification/xp-transactions/<id>/refund.
struct XpRefundResponse: Decodable, Sendable {
    struct Refund: Decodable, Sendable {
        let id: String?
        let transactionId: String?
        let amount: Int?
        let refunded: Int?
    }
    let ok: Bool?
    let refund: Refund?
    let totalXp: Int?
}

/// The note of a BoD XP adjustment in the app language. The server stamps the actor into the stored reason
/// in Indonesian ("<note> · oleh <Name>", or just "oleh <Name>"), so English showed "oleh"; the word is
/// swapped for the language's "by".
func xpAdminNote(_ note: String) -> String {
    let n = note.trimmingCharacters(in: .whitespacesAndNewlines)
    if let r = n.range(of: " · oleh ", options: .backwards) {
        let name = String(n[r.upperBound...]).trimmingCharacters(in: .whitespaces)
        return "\(n[..<r.lowerBound]) · \(String(format: T("by %@"), name))"
    }
    if n.hasPrefix("oleh ") {
        return String(format: T("by %@"), String(n.dropFirst(5)).trimmingCharacters(in: .whitespaces))
    }
    return n
}
