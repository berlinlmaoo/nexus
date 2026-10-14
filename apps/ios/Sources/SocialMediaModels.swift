import Foundation

// MARK: - Social Media Report (owner, 14 Oct 2026)
//
// A project of type SOCIAL_MEDIA_REPORT: per day and platform the team records Views, Likes, Comments,
// Shares and Posts published, plus two notes a day ("What worked" / "What didn't work"). Targets per
// platform: monthly engagement and posts, and optionally a date's own. Engagement = Likes + Comments +
// Shares; views are not engagement. The server works everything out (src/lib/social-media.ts): the day's
// targets in force, the month-to-date totals and percentages. This app draws what it is told.
//
// Read leniently: a field a server does not send decodes to nil / empty, so an odd answer costs one
// number, never the screen.

enum SocialMetric: String, CaseIterable, Identifiable {
    case views, likes, comments, shares, posts
    var id: String { rawValue }

    var label: String {
        switch self {
        // "Views" already means saved views in the shared tables ("Tampilan"); here it is plays.
        case .views: return OutletFormat.isID ? "Tayangan" : "Views"
        case .likes: return T("Likes")
        case .comments: return T("Comments")
        case .shares: return T("Shares")
        case .posts: return T("Posts published")
        }
    }
}

struct SocialPlatform: Codable, Hashable, Identifiable {
    var id: String
    var name: String
    var archived: Bool?

    var isArchived: Bool { archived == true }
}

struct SocialReportConfig: Codable, Hashable {
    var version: Int = 1
    var platforms: [SocialPlatform]

    static let standard = SocialReportConfig(platforms: [SocialPlatform(id: "instagram", name: "Instagram"), SocialPlatform(id: "tiktok", name: "TikTok")])
    var active: [SocialPlatform] { platforms.filter { !$0.isArchived } }
}

struct SocialPerson: Decodable, Hashable {
    let id: String
    let name: String?
}

struct SocialPlatformDay: Decodable, Hashable {
    var views: Double?
    var likes: Double?
    var comments: Double?
    var shares: Double?
    var posts: Double?
    var engagement: Double?
    var engagementTarget: Double?
    var postsTarget: Double?
    var engagementTargetSource: String?
    var postsTargetSource: String?
    var engagementPct: Int64?
    var postsPct: Int64?

    func value(_ m: SocialMetric) -> Double? {
        switch m {
        case .views: return views
        case .likes: return likes
        case .comments: return comments
        case .shares: return shares
        case .posts: return posts
        }
    }

    var ownTarget: Bool { engagementTargetSource == "day" || postsTargetSource == "day" }
}

struct SocialDay: Decodable, Hashable, Identifiable {
    let date: String
    let platforms: [String: SocialPlatformDay]
    let engagement: Double?
    let views: Double?
    let posts: Double?
    let worked: String
    let didntWork: String
    let recorded: Bool
    let updatedAt: String?
    let updatedBy: SocialPerson?
    var id: String { date }

    private enum CodingKeys: String, CodingKey { case date, platforms, engagement, views, posts, worked, didntWork, recorded, updatedAt, updatedBy }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        date = try c.decode(String.self, forKey: .date)
        platforms = (try? c.decodeIfPresent([String: SocialPlatformDay].self, forKey: .platforms)) ?? [:]
        engagement = try? c.decodeIfPresent(Double.self, forKey: .engagement)
        views = try? c.decodeIfPresent(Double.self, forKey: .views)
        posts = try? c.decodeIfPresent(Double.self, forKey: .posts)
        worked = (try? c.decodeIfPresent(String.self, forKey: .worked)) ?? ""
        didntWork = (try? c.decodeIfPresent(String.self, forKey: .didntWork)) ?? ""
        recorded = (try? c.decodeIfPresent(Bool.self, forKey: .recorded)) ?? false
        updatedAt = try? c.decodeIfPresent(String.self, forKey: .updatedAt)
        updatedBy = try? c.decodeIfPresent(SocialPerson.self, forKey: .updatedBy)
    }

    var hasNotes: Bool { !worked.isEmpty || !didntWork.isEmpty }
}

struct SocialMonthTarget: Decodable, Hashable {
    let platformId: String
    let engagementTarget: Double?
    let postsTarget: Double?
}

struct SocialDayTarget: Decodable, Hashable {
    let date: String
    let platformId: String
    let engagementTarget: Double?
    let postsTarget: Double?
}

struct SocialPlatformOverview: Decodable, Hashable, Identifiable {
    let platformId: String
    let name: String
    let archived: Bool?
    let engagement: Double
    let views: Double
    let posts: Double
    let likes: Double?
    let comments: Double?
    let shares: Double?
    let engagementTargetToDate: Double?
    let postsTargetToDate: Double?
    let engagementPct: Int64?
    let postsPct: Int64?
    let engagementTargetMonth: Double?
    let postsTargetMonth: Double?
    let trend: [Double]?
    var id: String { platformId }
}

struct SocialOverview: Decodable, Hashable {
    let month: String
    let cutoff: String?
    let recordedDays: Int
    let platforms: [SocialPlatformOverview]
}

struct SocialMonthResponse: Decodable {
    let canRecord: Bool
    let canManage: Bool
    let month: String
    let today: String
    let config: SocialReportConfig
    let targets: [SocialMonthTarget]
    let dayTargets: [SocialDayTarget]
    let days: [SocialDay]
    let overview: SocialOverview

    private enum CodingKeys: String, CodingKey { case canRecord, canManage, month, today, config, targets, dayTargets, days, overview }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        canRecord = (try? c.decodeIfPresent(Bool.self, forKey: .canRecord)) ?? false
        canManage = (try? c.decodeIfPresent(Bool.self, forKey: .canManage)) ?? false
        month = try c.decode(String.self, forKey: .month)
        today = (try? c.decodeIfPresent(String.self, forKey: .today)) ?? SocialFormat.wibToday()
        config = (try? c.decodeIfPresent(SocialReportConfig.self, forKey: .config)) ?? .standard
        targets = (try? c.decodeIfPresent([SocialMonthTarget].self, forKey: .targets)) ?? []
        dayTargets = (try? c.decodeIfPresent([SocialDayTarget].self, forKey: .dayTargets)) ?? []
        days = (try? c.decodeIfPresent([SocialDay].self, forKey: .days)) ?? []
        overview = (try? c.decodeIfPresent(SocialOverview.self, forKey: .overview))
            ?? SocialOverview(month: month, cutoff: nil, recordedDays: 0, platforms: [])
    }
}

struct SocialConfigResponse: Decodable {
    let config: SocialReportConfig
    let usage: [String: Int]
    let canManage: Bool?
}

// MARK: - Formats

enum SocialFormat {
    static func wibToday() -> String { OutletFormat.wibToday() }

    /// "12.400" / "12,400"; "—" for nothing.
    static func count(_ n: Double?) -> String {
        guard let n else { return "—" }
        return OutletFormat.grouped(Int64(n.rounded()))
    }

    /// "1,2 rb" / "1.2K" on a calendar cell.
    static func compact(_ n: Double) -> String {
        let f = NumberFormatter()
        f.locale = Locale(identifier: OutletFormat.isID ? "id_ID" : "en_GB")
        f.maximumFractionDigits = 1
        let a = abs(n)
        if a >= 1_000_000 { return (f.string(from: NSNumber(value: n / 1_000_000)) ?? "") + (OutletFormat.isID ? " jt" : "M") }
        if a >= 1_000 { return (f.string(from: NSNumber(value: n / 1_000)) ?? "") + (OutletFormat.isID ? " rb" : "K") }
        return OutletFormat.grouped(Int64(n.rounded()))
    }

    /// Engagement = Likes + Comments + Shares (the server's engagementOf); nil when none is filled.
    static func engagement(likes: Int64?, comments: Int64?, shares: Int64?) -> Int64? {
        let parts = [likes, comments, shares].compactMap { $0 }
        return parts.isEmpty ? nil : parts.reduce(0, +)
    }
}
