import Foundation

/// GET /api/docs (list) + /api/docs/{id} (detail with contentText).
struct Doc: Decodable, Identifiable, Sendable {
    let id: String
    let title: String
    let contentText: String?
    let icon: String?
    let updatedAt: String?
    let project: ProjectRef?
    struct ProjectRef: Decodable, Sendable { let name: String? }
    var emoji: String { (icon?.isEmpty == false && !(icon ?? "").hasPrefix("/")) ? icon! : "📄" }
}
struct DocsResponse: Decodable, Sendable { let docs: [Doc]? }
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
    enum CodingKeys: String, CodingKey {
        case id, name, description, isPublic, projectId
        case count = "_count"
    }
    var submissionCount: Int { count?.submissions ?? 0 }
}
