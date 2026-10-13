import Foundation

/// Form questions and the project's category field (web form-model.ts / src/lib/form-category.ts, 13 Oct 2026).
/// Sections became statuses on 12 Oct; the old category sections became a SELECT custom field named
/// "Kategori" / "Category". A one-answer question still sending its answer to "Section" whose options are
/// categories really belongs to that field (the server files such answers there).
enum FormCategory {
    private static func lc(_ s: String) -> String { s.trimmingCharacters(in: .whitespaces).lowercased() }

    /// "Kategori", "Category", "Kategori 2"…
    static func isCategoryName(_ name: String) -> Bool {
        name.range(of: #"^(kategori|category)( \d+)?$"#, options: [.regularExpression, .caseInsensitive]) != nil
    }

    static func isSelect(_ c: CustomField) -> Bool { c.type.uppercased() == "SELECT" }

    /// The project's category field: the select named Kategori / Category.
    static func projectField(_ fields: [CustomField]) -> CustomField? {
        fields.first { isSelect($0) && isCategoryName($0.name) }
    }

    private static func cleanOptions(_ options: [String]) -> [String] {
        options.map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
    }

    /// A one-answer "Section" question whose options are categories: the select field they belong to.
    static func fieldForSectionQuestion(type: String, target: String, options: [String],
                                        fields: [CustomField], sections: [String]) -> CustomField? {
        guard target == "task_list", type == "dropdown" || type == "select" else { return nil }
        let opts = cleanOptions(options)
        let sectionNames = Set(sections.map(lc))
        if opts.contains(where: { sectionNames.contains(lc($0)) }) { return nil }
        let selects = fields.filter(isSelect).sorted { isCategoryName($0.name) && !isCategoryName($1.name) }
        if opts.isEmpty { return selects.first { isCategoryName($0.name) } }
        return selects.first { f in
            let choices = Set(f.choices.map(lc))
            return opts.allSatisfy { choices.contains(lc($0)) }
        }
    }

    /// Every option is a section name (what "Use these sections as options" writes).
    static func optionsAreSections(_ options: [String], sections: [String]) -> Bool {
        let opts = cleanOptions(options)
        let sectionNames = Set(sections.map(lc))
        return !opts.isEmpty && opts.allSatisfy { sectionNames.contains(lc($0)) }
    }

    /// Picking a select field as the target adopts its options when the question only had section names / none.
    static func shouldAdopt(_ options: [String], sections: [String], choices: [String]) -> Bool {
        !choices.isEmpty && (optionsAreSections(options, sections: sections) || cleanOptions(options).isEmpty)
    }
}
