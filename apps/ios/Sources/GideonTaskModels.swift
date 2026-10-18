import Foundation

struct GideonTaskDelete: Decodable, Sendable, Equatable {
    let taskId: String
    let title: String
    let projectId: String?
    let projectName: String?
    let status: String?
    let progress: String?
    let due: String?
    let dueDay: String?
    let assignees: [String]?
    let deleted: Bool?
    let auditLogId: String?
}
struct GideonTaskTarget: Decodable, Sendable, Equatable {
    struct Project: Decodable, Sendable, Equatable, Identifiable {
        let id: String
        let name: String
        let icon: String?
        let color: String?
    }
    let title: String
    let projects: [Project]
    let projectId: String?
    let taskListId: String?
    let status: String?
    let assigneeIds: [String]?
    let dueDay: String?
    let calendar: Bool?
    let chosenProjectId: String?
}
struct GideonTaskOptions: Decodable, Sendable, Equatable {
    struct Section: Decodable, Sendable, Equatable, Identifiable {
        let id: String
        let name: String
        let taskStatus: String?
        let color: String?
    }
    struct Member: Codable, Sendable, Equatable, Identifiable {
        let id: String
        let name: String?
        let avatar: String?
    }
    let sections: [Section]
    let members: [Member]
}
struct GideonTaskChoice: Sendable, Equatable {
    var projectId: String
    var taskListId: String?
    var assigneeIds: [String]
    var dueDate: String?
    var body: [String: Any] {
        var result: [String: Any] = ["projectId": projectId, "assigneeIds": assigneeIds, "dueDate": dueDate as Any? ?? NSNull()]
        if let taskListId { result["taskListId"] = taskListId }
        return result
    }
    mutating func reconcile(_ options: GideonTaskOptions, status: String?) {
        let members = Set(options.members.map(\.id))
        assigneeIds = assigneeIds.filter { members.contains($0) }
        if !options.sections.contains(where: { $0.id == taskListId }) {
            taskListId = options.sections.first(where: { $0.taskStatus == status })?.id ?? options.sections.first?.id
        }
    }
}
