/**
 * Form questions that still pick a "section" but whose options are categories (13 Oct 2026).
 *
 * The category conversion (scripts/convert-category-sections.cjs) turned category sections ("AI & Tech",
 * "Management", "PATS X"…) into a select field "Kategori" / "Category" and made the sections statuses
 * (To Do / On Progress / Done). Forms are remapped by that script and by
 * prisma/sql/2026-10-13-formcat-form-kategori-mapping.sql, but a form that still says `task_list` with
 * category options (an older copy, a form edited before the release, a released app's builder) must not
 * show "To Do / On Progress / Done" to the sender nor lose the category. So:
 *  - public/route.ts keeps such a question's own options instead of syncing it to the section names;
 *  - submit/route.ts files an answer that names no section into the select field that lists it, and the
 *    task lands in the first section (the project's default status), as before.
 * Pure: no imports, shared by both routes and the unit test (form-category.test.mjs).
 */

export type FormCategorySection = { name: string }
export type FormCategoryField = { id: string; name: string; type: string | null | undefined; options: unknown }

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase()

/** The options of a select custom field, whatever shape they were saved in. */
export function selectFieldChoices(options: unknown): string[] {
  if (!options) return []
  if (Array.isArray(options)) return options.map(String)
  const o = options as { options?: unknown[]; choices?: unknown[] }
  if (Array.isArray(o.options)) return o.options.map(String)
  if (Array.isArray(o.choices)) return o.choices.map(String)
  return []
}

/** A form question's own options (bare list or `{ choices }`), trimmed, blanks dropped. */
export function questionOptions(options: unknown): string[] {
  return selectFieldChoices(options).map((s) => s.trim()).filter(Boolean)
}

/** A one-answer choice question (the only kind that can name a category). */
export function isChoiceQuestion(type: unknown): boolean {
  return /^(dropdown|select|radio|single_select|choice)$/i.test(String(type ?? ""))
}

const CATEGORY_NAME = /^(kategori|category)( \d+)?$/i

/**
 * The SELECT field a `task_list` question's categories belong to, or null when the question is a real
 * section/status question (one of its options is a section name) or no field lists its options.
 * Preference: a field that lists every option, named Kategori/Category first; else, when the question has
 * no options at all, a field named Kategori/Category.
 */
export function categoryFieldForQuestion(
  questionOpts: unknown,
  sections: FormCategorySection[],
  fields: FormCategoryField[],
): FormCategoryField | null {
  const opts = questionOptions(questionOpts)
  const sectionNames = new Set(sections.map((s) => norm(s.name)))
  if (opts.some((o) => sectionNames.has(norm(o)))) return null
  const selects = fields.filter((f) => String(f.type ?? "").toUpperCase() === "SELECT")
  const byName = (a: FormCategoryField, b: FormCategoryField) => Number(CATEGORY_NAME.test(b.name)) - Number(CATEGORY_NAME.test(a.name))
  if (!opts.length) return selects.filter((f) => CATEGORY_NAME.test(f.name)).sort(byName)[0] ?? null
  const listing = selects.filter((f) => {
    const choices = new Set(selectFieldChoices(f.options).map(norm))
    return opts.every((o) => choices.has(norm(o)))
  })
  return listing.sort(byName)[0] ?? null
}

/**
 * For an ANSWER to a `task_list` question that matched no section: the select field (and its option,
 * spelled as the field spells it) the answer belongs in, or null.
 */
export function categoryValueForAnswer(
  answer: string,
  sections: FormCategorySection[],
  fields: FormCategoryField[],
): { fieldId: string; value: string } | null {
  const a = norm(answer)
  if (!a || sections.some((s) => norm(s.name) === a)) return null
  const selects = fields.filter((f) => String(f.type ?? "").toUpperCase() === "SELECT")
  const hits = selects
    .map((f) => ({ f, opt: selectFieldChoices(f.options).find((o) => norm(o) === a) }))
    .filter((x): x is { f: FormCategoryField; opt: string } => !!x.opt)
    .sort((x, y) => Number(CATEGORY_NAME.test(y.f.name)) - Number(CATEGORY_NAME.test(x.f.name)))
  return hits[0] ? { fieldId: hits[0].f.id, value: hits[0].opt } : null
}
