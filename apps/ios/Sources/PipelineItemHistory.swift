import Foundation

/// The v8 history rows contain whole item snapshots for lifecycle events. Interpret their kind before
/// rendering them so contact payloads never expose an `amount`, and monetary rows respect presenting.
enum PipelineItemHistory {
    static func parts(_ field: String) -> (kind: String, action: String)? {
        let split = field.split(separator: ".", maxSplits: 1).map(String.init)
        guard split.count == 2, ["cashback", "contact", "budget"].contains(split[0]) else { return nil }
        return (split[0], split[1])
    }

    static func isLifecycle(_ action: String) -> Bool { ["created", "deleted", "restored"].contains(action) }

    /// nil means this is not an item row and the existing deal/term renderer should handle it.
    static func value(field: String, value: AuditJSON?, presenting: Bool) -> String? {
        guard let item = parts(field) else { return nil }
        guard let value else { return T("empty") }
        if case .null = value { return T("empty") }
        return render(item: item, value: value, presenting: presenting)
    }

    private static func render(item: (kind: String, action: String), value: AuditJSON?, presenting: Bool) -> String {
        guard let value else { return T("empty") }
        if item.kind == "contact" {
            if item.action == "amount" { return "–" }
            if isLifecycle(item.action), case .object(let object) = value {
                let text = ["role", "name", "phone"].compactMap { key -> String? in
                    guard case .string(let string)? = object[key], !string.isEmpty else { return nil }
                    return key == "role" ? PipelineText.contactRole(string) : string
                }.joined(separator: " · ")
                return text.isEmpty ? T("empty") : text
            }
            if item.action == "role", case .string(let role) = value { return PipelineText.contactRole(role) }
            return text(value)
        }
        if isLifecycle(item.action), case .object(let object) = value {
            if case .number(let amount)? = object["amount"] { return PipelineFormat.idrFull(amount, hidden: presenting) }
            if case .string(let amount)? = object["amount"], let number = Double(amount) {
                return PipelineFormat.idrFull(number, hidden: presenting)
            }
            return T("empty")
        }
        if item.action == "amount" {
            if case .number(let amount) = value { return PipelineFormat.idrFull(amount, hidden: presenting) }
            if case .string(let amount) = value, let number = Double(amount) {
                return PipelineFormat.idrFull(number, hidden: presenting)
            }
            // An unfamiliar money payload is still private in presentation mode.
            if presenting { return PipelineFormat.idrFull(0, hidden: true) }
        }
        return text(value)
    }

    private static func text(_ value: AuditJSON) -> String {
        switch value {
        case .null: return T("empty")
        case .string(let string): return string.isEmpty ? T("empty") : string
        case .number(let number):
            return number.rounded() == number
                ? String(format: "%.0f", number)
                : number.formatted(.number.precision(.fractionLength(0...6)).grouping(.never).locale(AppDateLocale.current))
        case .bool(let flag): return flag ? "✓" : "–"
        case .array, .object: return "–"
        }
    }
}
