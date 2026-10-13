import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// The public intake form — GET /api/forms/{id}/public — and the rules the web
// renderer (apps/nexus-lovable-ui/src/routes/f.$formId.tsx) applies to it.
//
// Those rules are PORTED here rather than approximated, because both ends act on
// them. The client decides what is shown and what is sent; the submit route
// re-derives visibility from the same `showIf` and refuses a submission whose
// required fields are missing. A field this app shows that the server treats as
// hidden becomes a value nobody asked for; one it hides that the server treats as
// visible becomes a 400 the person filling it in cannot act on.
// ─────────────────────────────────────────────────────────────────────────────

/// One `showIf` clause. Everything is lenient because `Form.fields` is an untyped JSON
/// column: a half-written condition must leave the field visible, the way the web's
/// `default: return true` does, rather than fail the whole form's decode.
struct FormCondition: Decodable, Sendable {
    let fieldId: String
    let op: String
    let value: String

    private enum CodingKeys: String, CodingKey {
        case fieldId, value
        case op = "operator"
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        fieldId = (try? c.decode(String.self, forKey: .fieldId)) ?? ""
        op = (try? c.decode(String.self, forKey: .op)) ?? ""
        value = (try? c.decode(FormScalar.self, forKey: .value))?.text ?? ""
    }
}

/// A single field of the form. `id` is the only thing that must be there — it is the key the
/// answers are filed under, and the submit route looks values up by it.
struct FormField: Identifiable, Sendable {
    let id: String
    let name: String?
    let label: String?
    let type: String
    let required: Bool
    let placeholder: String?
    let options: [String]
    let attachmentEnabled: Bool
    /// "name" | "email" — the value is filled from the account and never typed.
    let autofill: String?
    /// "currency-idr" on a number field.
    let numberFormat: String?
    let showIf: FormCondition?

    /// `f.name || f.label || "Field"` — JS falsiness, so an empty `name` falls through to `label`.
    var displayLabel: String {
        if let name, !name.isEmpty { return name }
        if let label, !label.isEmpty { return label }
        return T("Field")
    }

    var isCurrency: Bool { type == "number" && numberFormat == "currency-idr" }
}

extension FormField: Decodable {
    private enum CodingKeys: String, CodingKey {
        case id, name, label, type, required, placeholder, options
        case attachmentEnabled, autofill, numberFormat, showIf
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try? c.decode(String.self, forKey: .name)
        label = try? c.decode(String.self, forKey: .label)
        type = (try? c.decode(String.self, forKey: .type)) ?? "text"
        required = (try? c.decode(Bool.self, forKey: .required)) ?? false
        placeholder = try? c.decode(String.self, forKey: .placeholder)
        attachmentEnabled = (try? c.decode(Bool.self, forKey: .attachmentEnabled)) ?? false
        autofill = try? c.decode(String.self, forKey: .autofill)
        numberFormat = try? c.decode(String.self, forKey: .numberFormat)
        showIf = try? c.decode(FormCondition.self, forKey: .showIf)

        // `options` is authored in two shapes and both are in production data: a bare list from the
        // builder, and `{ choices: [...] }` from the older schema. The public route also REPLACES
        // this with a bare list of live section names for any field mapped to `task_list`, so a
        // form can hand back either shape on different fields of the same request.
        if let flat = try? c.decode([FormScalar].self, forKey: .options) {
            options = flat.compactMap(\.value)
        } else if let boxed = try? c.decode(FormChoices.self, forKey: .options) {
            options = boxed.choices
        } else {
            options = []
        }
    }
}

/// A JSON scalar read as text. Options are written as strings by the builder, but the column is
/// untyped — a number in there should become "3", not take the form down.
private struct FormScalar: Decodable {
    let value: String?
    var text: String { value ?? "" }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) { value = s }
        else if let b = try? c.decode(Bool.self) { value = b ? "true" : "false" }
        else if let d = try? c.decode(Double.self) { value = FormLogic.numberText(d) }
        else { value = nil }
    }
}

private struct FormChoices: Decodable {
    let choices: [String]
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        choices = ((try? c.decode([FormScalar].self, forKey: .choices)) ?? []).compactMap(\.value)
    }
    private enum CodingKeys: String, CodingKey { case choices }
}

/// The form as the renderer needs it. Deliberately narrower than the route's response: `branding`,
/// `taskLists` and `requireAuth` are all things the SERVER acts on, and reading them here would
/// invite the app to make a decision the server has already made.
struct PublicForm: Decodable, Sendable {
    let id: String
    let name: String
    let description: String?
    let fields: [FormField]

    private enum CodingKeys: String, CodingKey { case id, name, description, fields }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = (try? c.decode(String.self, forKey: .id)) ?? ""
        name = (try? c.decode(String.self, forKey: .name)) ?? ""
        description = try? c.decode(String.self, forKey: .description)
        // One unreadable entry in an untyped column must not cost the other nine fields, and the
        // route itself tolerates `fields` not being an array at all.
        let raw = (try? c.decode([FormFieldBox].self, forKey: .fields)) ?? []
        fields = raw.compactMap(\.field)
    }
}

private struct FormFieldBox: Decodable {
    let field: FormField?
    init(from decoder: Decoder) throws { field = try? FormField(from: decoder) }
}

/// A file the person picked, held in memory until submit. `partName` is the multipart key the
/// submit route splits on — `file:<fieldId>` for a file field, `attachment:<fieldId>` for the
/// optional extra on any other field.
struct FormUpload: Identifiable, Sendable {
    let id = UUID()
    let partName: String
    let filename: String
    let mime: String
    let data: Data

    /// The submit route rejects anything past this with a message naming the file.
    static let maxBytes = 50 * 1024 * 1024
}

/// One answer. The four cases are the four JSON shapes the web puts in `values`, kept apart so
/// "unticked checkbox" and "empty text" stay distinguishable — the condition operators tell them
/// apart and so does the required check.
enum FormValue: Sendable {
    case text(String)
    case list([String])
    case flag(Bool)
    case files([FormUpload])
}

/// The ported rules. A namespace rather than free functions: a bare `tint()` at file scope once
/// shadowed the SwiftUI modifier of the same name across this target.
enum FormLogic {

    // MARK: - reading a value

    /// `Array.isArray(raw) ? raw.map(String) : [raw == null ? "" : String(raw)]`.
    ///
    /// The empty-vs-absent distinction matters and is not cosmetic: an ABSENT value yields `[""]`,
    /// so `equals ""` is true for it, while an emptied multi-select yields `[]`, for which the same
    /// condition is false. Both then join to "" and read as empty. That is the web's behaviour.
    ///
    /// The one place this is not a straight port is a condition pointing at a FILE field, where the
    /// web stringifies the File objects into "[object File]". Filenames are used instead — the web
    /// value is meaningless to compare against, and no form conditions on an upload.
    static func conditionValues(_ value: FormValue?) -> [String] {
        guard let value else { return [""] }
        switch value {
        case .text(let s): return [s]
        case .flag(let b): return [b ? "true" : "false"]
        case .list(let a): return a
        case .files(let f): return f.map(\.filename)
        }
    }

    /// `isFilled` — note `false` counts as empty, so a required checkbox must actually be ticked.
    /// The submit route is looser here (it only rejects undefined/null/""/[]), so this is the
    /// stricter of the two and can never produce a submission the server would refuse.
    static func isFilled(_ value: FormValue?) -> Bool {
        guard let value else { return false }
        switch value {
        case .text(let s): return !s.isEmpty
        case .flag(let b): return b
        case .list(let a): return !a.isEmpty
        case .files(let f): return !f.isEmpty
        }
    }

    // MARK: - conditional visibility

    /// Port of `evalCond`. Five operators, and an unknown one shows the field rather than hiding it.
    static func evaluate(_ cond: FormCondition?, values: [String: FormValue]) -> Bool {
        guard let cond else { return true }
        let list = conditionValues(values[cond.fieldId])
        let joined = list.joined(separator: ", ")
        let expected = cond.value

        switch cond.op {
        case "equals": return list.contains(expected)
        case "not_equals": return !list.contains(expected)
        // `"abc".includes("")` is true in JS, while Swift's `contains("")` is false — without this
        // guard a `contains ""` rule would hide every field it is attached to.
        case "contains": return expected.isEmpty || joined.lowercased().contains(expected.lowercased())
        case "is_empty": return joined.isEmpty
        case "is_not_empty": return !joined.isEmpty
        default: return true
        }
    }

    static func visibleFields(_ fields: [FormField], values: [String: FormValue]) -> [FormField] {
        fields.filter { evaluate($0.showIf, values: values) }
    }

    /// Labels of the visible required fields still waiting for an answer. Empty means submit is
    /// allowed — the gate and the "fill these first" line are the same computation on purpose.
    static func missingRequired(_ visible: [FormField], values: [String: FormValue]) -> [String] {
        visible.filter { $0.required && !isFilled(values[$0.id]) }.map(\.displayLabel)
    }

    /// Email and link answers that the server would refuse (bughunt F-BUG-13; same rules as the submit
    /// route: an email needs name@domain.tld, a link needs a host with a dot). Autofilled answers are the
    /// server's to fill. One sentence per bad answer, in the app's language.
    static func invalidAnswers(_ visible: [FormField], values: [String: FormValue]) -> [String] {
        visible.compactMap { f in
            guard f.autofill == nil, f.type == "email" || f.type == "url",
                  case .text(let raw)? = values[f.id] else { return nil }
            let v = raw.trimmingCharacters(in: .whitespacesAndNewlines)
            if v.isEmpty { return nil }
            if f.type == "email" {
                return looksLikeEmail(v) ? nil : String(format: T("%@: enter an email address, like name@company.com."), f.displayLabel)
            }
            return looksLikeURL(v) ? nil : String(format: T("%@: enter a web address, like company.com."), f.displayLabel)
        }
    }

    static func looksLikeEmail(_ v: String) -> Bool {
        v.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]+$"#, options: .regularExpression) != nil
    }

    static func looksLikeURL(_ v: String) -> Bool {
        if v.rangeOfCharacter(from: .whitespacesAndNewlines) != nil { return false }
        let hasScheme = v.range(of: #"^[a-zA-Z][a-zA-Z0-9+.-]*://"#, options: .regularExpression) != nil
        guard let u = URL(string: hasScheme ? v : "https://" + v), let scheme = u.scheme?.lowercased(),
              scheme == "http" || scheme == "https", let host = u.host else { return false }
        return host.range(of: #"\.[a-zA-Z]{2,}$"#, options: .regularExpression) != nil
    }

    // MARK: - formatting

    /// `new Intl.NumberFormat("id-ID")` over a digit string: dotted thousands, and zero renders as
    /// nothing at all because `Number("0")` is falsy on the web. Grouping is done by hand rather
    /// than through a NumberFormatter so a long entry keeps its exact digits instead of being
    /// rounded through a Double.
    static func idrDisplay(_ raw: String) -> String {
        let digits = Array(raw.drop(while: { $0 == "0" }))
        guard !digits.isEmpty else { return "" }
        var out = ""
        for (i, ch) in digits.enumerated() {
            if i > 0, (digits.count - i) % 3 == 0 { out.append(".") }
            out.append(ch)
        }
        return out
    }

    /// What the currency field STORES: the plain digits, which is what the web sends and what the
    /// server coerces. `\d` in the web's regex is ASCII-only, so an Arabic-Indic digit is stripped
    /// there too and must be stripped here.
    static func idrDigits(_ typed: String) -> String {
        typed.filter { $0.isASCII && $0.isNumber }
    }

    /// `String(3)` is "3" in JS, not "3.0".
    static func numberText(_ d: Double) -> String {
        if d == d.rounded(), abs(d) < 1e15 { return String(Int64(d)) }
        return String(d)
    }

    /// The wire format of `<input type="date">`, which is what the submit route parses.
    static let isoDay: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    // MARK: - the submission

    /// Builds the two halves of the multipart body from the answers, exactly as the web does:
    /// only VISIBLE fields are sent, a file field contributes its filenames as its `data` value
    /// (the bytes ride separately), and the optional extra attachment is recorded under its own
    /// `attachment:<id>` key in both halves.
    static func payload(visible: [FormField],
                        values: [String: FormValue]) -> (data: [String: Any], files: [FormUpload]) {
        var data: [String: Any] = [:]
        var files: [FormUpload] = []

        for field in visible {
            let value = values[field.id]
            if field.type == "file" {
                let picked = pickedFiles(value)
                data[field.id] = picked.map(\.filename).joined(separator: ", ")
                files += picked
            } else {
                data[field.id] = jsonValue(value)
            }

            let key = "attachment:\(field.id)"
            if field.attachmentEnabled, let extra = pickedFiles(values[key]).first {
                data[key] = extra.filename
                files.append(extra)
            }
        }

        return (data, files)
    }

    private static func pickedFiles(_ value: FormValue?) -> [FormUpload] {
        guard let value, case .files(let f) = value else { return [] }
        return f
    }

    /// `data[field.id] = v ?? ""` — an untouched field is sent as an empty string, not omitted,
    /// which is what makes the stored submission list every question that was asked.
    private static func jsonValue(_ value: FormValue?) -> Any {
        guard let value else { return "" }
        switch value {
        case .text(let s): return s
        case .list(let a): return a
        case .flag(let b): return b
        case .files(let f): return f.map(\.filename).joined(separator: ", ")
        }
    }
}
