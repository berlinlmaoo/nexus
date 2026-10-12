import SwiftUI

// Project templates (owner, 12 Oct 2026; DEV server only for now, so this lives on branch `dev`).
//
// GET /api/project-templates hands out the registry the server keeps in src/lib/project-templates.ts,
// in both languages. Nothing here knows a template by name: the gallery card, its mini preview and the
// details step are drawn from the data, so a template added on the server shows up without an app
// update. POST /api/projects { templateId, lang, starter } builds one (APIClient.createProjectFromTemplate).

/// `{ en, id }` text from the registry, read in the app's language.
struct TemplateText: Decodable, Hashable, Sendable {
    let en: String
    let id: String
    var text: String {
        if AppLanguage.shared.lang == .id { return id.isEmpty ? en : id }
        return en
    }
}

struct ProjectTemplate: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let category: String
    let name: TemplateText
    let blurb: TemplateText
    let icon: String?
    let tint: String?
    let sections: [Section]
    let fields: [Field]
    let builtins: [Builtin]
    let tabs: [String]
    let hiddenTabs: [String]
    let defaultTab: String?
    /// "dueDate" or "cf:<field key>": what the Calendar plots.
    let calendarBy: String?
    /// Notion's "My …" preset (e.g. "My meetings"): the project offers a chip filtering on assignee = me.
    let myView: MyView?
    let preview: Preview
    let starterDocs: [StarterDoc]
    let starterTasks: Int

    struct Section: Decodable, Hashable, Sendable { let name: TemplateText; let status: String?; let color: String? }
    struct Option: Decodable, Hashable, Sendable { let label: TemplateText; let color: String? }
    struct Field: Decodable, Hashable, Sendable {
        let key: String
        let name: TemplateText
        let type: String
        let options: [Option]?
    }
    struct Builtin: Decodable, Hashable, Sendable { let key: String; let name: TemplateText }
    struct MyView: Decodable, Hashable, Sendable { let name: TemplateText; let tab: String }
    struct Preview: Decodable, Hashable, Sendable { let layout: String; let columns: [String]? }
    struct StarterDoc: Decodable, Hashable, Sendable { let title: TemplateText; let icon: String? }

    private enum CodingKeys: String, CodingKey {
        case id, category, name, blurb, icon, tint, sections, fields, builtins, tabs, hiddenTabs, defaultTab
        case calendarBy, myView, preview, starterDocs, starterTasks
    }

    /// Lenient: a key a newer server drops (or an older one never sent) costs that key, not the gallery.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        category = (try? c.decodeIfPresent(String.self, forKey: .category)) ?? "projects"
        name = try c.decode(TemplateText.self, forKey: .name)
        blurb = (try? c.decodeIfPresent(TemplateText.self, forKey: .blurb)) ?? TemplateText(en: "", id: "")
        icon = try? c.decodeIfPresent(String.self, forKey: .icon)
        tint = try? c.decodeIfPresent(String.self, forKey: .tint)
        sections = (try? c.decodeIfPresent([Section].self, forKey: .sections)) ?? []
        fields = (try? c.decodeIfPresent([Field].self, forKey: .fields)) ?? []
        builtins = (try? c.decodeIfPresent([Builtin].self, forKey: .builtins)) ?? []
        tabs = (try? c.decodeIfPresent([String].self, forKey: .tabs)) ?? []
        hiddenTabs = (try? c.decodeIfPresent([String].self, forKey: .hiddenTabs)) ?? []
        defaultTab = try? c.decodeIfPresent(String.self, forKey: .defaultTab)
        calendarBy = try? c.decodeIfPresent(String.self, forKey: .calendarBy)
        myView = try? c.decodeIfPresent(MyView.self, forKey: .myView)
        preview = (try? c.decodeIfPresent(Preview.self, forKey: .preview)) ?? Preview(layout: "list", columns: nil)
        starterDocs = (try? c.decodeIfPresent([StarterDoc].self, forKey: .starterDocs)) ?? []
        starterTasks = (try? c.decodeIfPresent(Int.self, forKey: .starterTasks)) ?? 0
    }

    static func == (a: ProjectTemplate, b: ProjectTemplate) -> Bool { a.id == b.id }
    func hash(into h: inout Hasher) { h.combine(id) }

    var hasStarter: Bool { !starterDocs.isEmpty || starterTasks > 0 }

    /// The label of a preview / table column: a field of this template, a built-in it renames, or the
    /// plain built-in name.
    func columnLabel(_ key: String) -> String {
        if key.hasPrefix("cf:") {
            return fields.first { "cf:\($0.key)" == key }?.name.text ?? key
        }
        if let b = builtins.first(where: { $0.key == key }) { return b.name.text }
        switch key {
        case "status": return T("Status")
        case "assignee": return T("Assignee")
        case "dueDate": return T("Due date")
        case "priority": return T("Priority")
        case "tags": return T("Tags")
        default: return key
        }
    }

    /// The tab a project built from this template opens on, as an app tab.
    var defaultProjectTab: ProjectTab? { ProjectTab.fromServerKey(defaultTab) }
    var myViewTab: ProjectTab? { ProjectTab.fromServerKey(myView?.tab) }
}

struct ProjectTemplatesResponse: Decodable, Sendable { let templates: [ProjectTemplate]? }

extension ProjectTab {
    /// A server tab key (lib/project-tabs.ts) as an app tab. "table" is the Spreadsheet tab here: the
    /// app's grid of every task with the project's fields as columns.
    static func fromServerKey(_ key: String?) -> ProjectTab? {
        guard let key else { return nil }
        if key == "table" { return .sheet }
        return ProjectTab.allCases.first { $0.key == key }
    }
}

/// The registry, fetched once per launch (it changes only with a server deploy) and shared by the
/// gallery and by a project that opens on its template's tab.
@MainActor
enum ProjectTemplateStore {
    private static var cached: [ProjectTemplate]?
    private static var cachedOn: ServerEnvironment?

    static func load(force: Bool = false) async throws -> [ProjectTemplate] {
        if !force, let cached, cachedOn == ServerEnvironment.current { return cached }
        let list = try await APIClient.shared.projectTemplates()
        cached = list
        cachedOn = ServerEnvironment.current
        return list
    }

    static func find(_ id: String?) async -> ProjectTemplate? {
        guard let id, !id.isEmpty else { return nil }
        return (try? await load())?.first { $0.id == id }
    }
}

/// Notion's option colours, as the web draws them (TemplateGallery.tsx CHIP).
enum TemplateTint {
    /// A template's section / option colour: the same nine-colour option palette the board draws its
    /// status columns in (StatusOptions.swift), so a template's preview matches the board it makes.
    static func color(_ name: String?) -> Color {
        StatusColor.swatch(StatusColor.normalize(name) ?? "gray").dot
    }

    /// lucide-react icon names from the registry → SF Symbols. Unknown names fall back to a checklist,
    /// as the web does.
    static func symbol(_ lucide: String?) -> String {
        switch lucide {
        case "CalendarRange": return "calendar"
        case "Megaphone": return "megaphone"
        case "PartyPopper": return "sparkles"
        case "Users": return "person.2"
        case "StickyNote": return "note.text"
        case "Lightbulb": return "lightbulb"
        case "FileText": return "doc.text"
        case "Bug": return "ladybug"
        case "Flag": return "flag"
        case "Images": return "photo.on.rectangle"
        case "Map": return "map"
        case "Package": return "shippingbox"
        case "Target": return "target"
        default: return "checklist"
        }
    }
}

/// A task status as the app says it (section status menu, template details).
enum TaskStatusName {
    static let all = ["TODO", "IN_PROGRESS", "IN_REVIEW", "DONE", "CANCELLED"]
    static func label(_ s: String) -> String {
        switch s {
        case "TODO": return T("To do")
        case "IN_PROGRESS": return T("In progress")
        case "IN_REVIEW": return T("In review")
        case "DONE": return T("Done")
        case "CANCELLED": return T("Cancelled")
        default: return humanizeEnum(s)
        }
    }
}
