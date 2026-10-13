import Foundation

/// GET /api/docs (list) + /api/docs/{id} (detail with contentText).
struct Doc: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let contentText: String?
    let icon: String?
    let updatedAt: String?
    let project: ProjectRef?
    /// The project the page belongs to (GIDEON action items become its tasks).
    let projectId: String?
    /// The block-editor document (dev server): drawn by BlockDocView. Read leniently — an older shape
    /// (a string, a list) is simply nil and `contentText` is shown as before.
    let content: LenientBlockDoc?
    struct ProjectRef: Decodable, Sendable { let name: String? }
    var emoji: String { (icon?.isEmpty == false && !(icon ?? "").hasPrefix("/")) ? icon! : "📄" }
}
struct DocsResponse: Decodable, Sendable { let docs: [Doc]? }

/// Never fails: a block doc when the value is one, else nil.
struct LenientBlockDoc: Decodable, Sendable {
    let node: BlockNode?
    init(from decoder: Decoder) throws { node = try? BlockNode(from: decoder) }
}
struct DocResponse: Decodable, Sendable { let doc: Doc }

/// GET /api/forms?projectId= — intake forms.
struct NexusForm: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let description: String?
    let isPublic: Bool?
    let projectId: String?
    let count: CountRef?
    struct CountRef: Decodable, Sendable { let submissions: Int? }
    /// The readable part of the public link (`/f/<slug>`); older rows may have none, and the
    /// link then falls back to the id, which the public route also resolves.
    var slug: String? = nil
    enum CodingKeys: String, CodingKey {
        case id, name, description, isPublic, projectId, slug
        case count = "_count"
    }
    var submissionCount: Int { count?.submissions ?? 0 }
}
