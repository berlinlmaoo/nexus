package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.feature.projects.CustomFieldDef

/**
 * Form questions and the project's category field (web form-model.ts / lib/form-category.ts c1afb95, iOS 0ed8600).
 * Sections became statuses on 12 Oct; the old category sections became a SELECT field named "Kategori" /
 * "Category". A one-answer question still sending its answer to "Section" whose options are categories really
 * belongs to that field (the server files such answers there).
 */
object FormCategory {
    private fun lc(s: String) = s.trim().lowercase()
    private val NAME = Regex("^(kategori|category)( \\d+)?$", RegexOption.IGNORE_CASE)

    fun isCategoryName(name: String) = NAME.matches(name.trim())
    fun isSelect(f: CustomFieldDef) = f.kind == "SELECT"

    /** The project's category field: the select named Kategori / Category. */
    fun projectField(fields: List<CustomFieldDef>): CustomFieldDef? = fields.firstOrNull { isSelect(it) && isCategoryName(it.name) }

    private fun clean(options: List<String>) = options.map { it.trim() }.filter { it.isNotEmpty() }

    /** A one-answer "Section" question whose options are categories: the select field they belong to. */
    fun fieldForSectionQuestion(type: String, target: String, options: List<String>, fields: List<CustomFieldDef>, sections: List<String>): CustomFieldDef? {
        if (target != "task_list" || (type != "dropdown" && type != "select")) return null
        val opts = clean(options)
        val sectionNames = sections.map(::lc).toSet()
        if (opts.any { lc(it) in sectionNames }) return null
        val selects = fields.filter(::isSelect).sortedBy { if (isCategoryName(it.name)) 0 else 1 }
        if (opts.isEmpty()) return selects.firstOrNull { isCategoryName(it.name) }
        return selects.firstOrNull { f -> val choices = f.choices.map(::lc).toSet(); opts.all { lc(it) in choices } }
    }

    /** Every option is a section name (what "Use these sections as options" writes). */
    fun optionsAreSections(options: List<String>, sections: List<String>): Boolean {
        val opts = clean(options); val names = sections.map(::lc).toSet()
        return opts.isNotEmpty() && opts.all { lc(it) in names }
    }

    /** Picking a select field as the target adopts its options when the question only had section names / none. */
    fun shouldAdopt(options: List<String>, sections: List<String>, choices: List<String>) =
        choices.isNotEmpty() && (optionsAreSections(options, sections) || clean(options).isEmpty())

    /** A question mapped to a select field: its options that the field doesn't have (saved as typed). */
    fun extraOptions(options: List<String>, choices: List<String>): List<String> {
        val known = choices.map(::lc).toSet()
        return clean(options).filter { lc(it) !in known }
    }

    /** The question's options already are exactly the field's. */
    fun sameOptions(options: List<String>, choices: List<String>): Boolean {
        val have = clean(options).map(::lc).toSet()
        return extraOptions(options, choices).isEmpty() && clean(choices).all { lc(it) in have }
    }
}
