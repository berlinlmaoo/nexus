import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// QA web fixes ported to the app (13 Oct 2026, part 2 — interaction, chat, GIDEON, editors). Small shared
// pieces used by several screens:
//   • GideonProblem — a GIDEON failure in words (EN/ID) plus whether "Try again" makes sense. The server
//     answers some refusals in Indonesian only ("File terlalu besar…", "Gideon error (503).", "Gideon lagi
//     gak bisa dihubungi…"); those are mapped by status / code / shape, never shown raw.
//   • LocalDrafts — unsent text kept on the device per composer (chat, task comment), so a failed send while
//     offline, or leaving the screen before it went out, never loses what was typed (web E-BUG-2 family).
//   • EditorKeys — who owns ⌘K right now. In a text editor ⌘K adds a link (web QA S-07); elsewhere it is free
//     for the app's search. Only one binding exists at a time.
//   • LinkInsertSheet — the ⌘K "Add a link" form (text + address), also used to change or remove a link.
//   • DocTitle — a page stored as "Untitled" reads "Tanpa judul" in Indonesian (web docTitle, QA S-29).
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - GIDEON failures

/// A GIDEON failure as the person should read it.
struct GideonProblem: LocalizedError, Equatable {
    let text: String
    /// False for refusals a retry cannot fix (a file type, a missing connection on this server).
    let retryable: Bool

    var errorDescription: String? { text }

    static var unreachable: GideonProblem {
        GideonProblem(text: T("GIDEON can't be reached right now. Try again in a moment."), retryable: true)
    }
    static var busy: GideonProblem {
        GideonProblem(text: T("GIDEON is busy right now. Wait a minute, then try again."), retryable: true)
    }
    static var notConnected: GideonProblem {
        GideonProblem(text: T("GIDEON isn't connected on this server."), retryable: false)
    }
    static var noAnswer: GideonProblem {
        GideonProblem(text: T("GIDEON didn't answer. Try again."), retryable: true)
    }

    /// A refusal that came back as an HTTP status, before any answer streamed. `code` and `message` are the
    /// JSON body's `code` / `error` when there was one.
    static func http(status: Int, code: String?, message: String?) -> GideonProblem {
        switch (code ?? "").lowercased() {
        case "file_too_large": return GideonProblem(text: T("File is over the 10MB limit."), retryable: false)
        case "unsupported_file_type": return GideonProblem(text: T("GIDEON can't read that kind of file yet."), retryable: false)
        case "not_configured", "gideon_unavailable": return .notConnected
        case "gideon_no_answer": return .noAnswer
        case "rate_limited": return GideonProblem(text: T("That's a lot of AI requests in an hour. Try again a little later."), retryable: false)
        default: break
        }
        switch status {
        case 413: return GideonProblem(text: T("File is over the 10MB limit."), retryable: false)
        case 415: return GideonProblem(text: T("GIDEON can't read that kind of file yet."), retryable: false)
        case 429: return .busy
        case 503:
            // "GIDEON is not connected on this server" (schedules, status draft) vs. a shim that is down.
            if let message, message.lowercased().contains("not connected") || message.lowercased().contains("isn't connected") { return .notConnected }
            return .unreachable
        case 502, 504, 520...527, 530: return .unreachable
        default:
            if let message, !message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return GideonProblem(text: stream(message).text, retryable: status >= 500)
            }
            return GideonProblem(text: T("GIDEON couldn't answer that. Try again."), retryable: status >= 500)
        }
    }

    /// An `error` event inside the stream. The server writes a few fixed sentences (some only in
    /// Indonesian) and "Gideon error (NNN)." for a refusal from the shim behind it.
    static func stream(_ content: String) -> GideonProblem {
        let s = content.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = s.lowercased()
        if let status = statusIn(lower) {
            switch status {
            case 429: return .busy
            case 415: return GideonProblem(text: T("GIDEON can't read that kind of file yet."), retryable: false)
            case 413: return GideonProblem(text: T("File is over the 10MB limit."), retryable: false)
            case 500...599: return .unreachable
            default: return GideonProblem(text: T("GIDEON couldn't answer that. Try again."), retryable: true)
            }
        }
        if lower.contains("dokumen belum bisa dibaca") { return GideonProblem(text: T("GIDEON can't read documents on this server yet."), retryable: false) }
        if lower.contains("gak bisa dihubungi") || lower.contains("can't be reached") || lower.contains("cannot be reached") { return .unreachable }
        if lower.contains("isn't connected") || lower.contains("not connected") { return .notConnected }
        if lower.contains("couldn't write") { return GideonProblem(text: T("GIDEON couldn't write that. Try again."), retryable: true) }
        if s.isEmpty || lower == "gideon failed." { return GideonProblem(text: T("GIDEON failed."), retryable: true) }
        return GideonProblem(text: T(s), retryable: true)
    }

    /// The placeholder the chat route sends as the FINAL text when the model gave nothing back
    /// ("(Gideon balas kosong — coba ulang.)"): an empty answer, not an answer.
    static func isEmptyPlaceholder(_ text: String) -> Bool {
        let lower = text.lowercased()
        return lower.contains("balas kosong") && lower.count < 60
    }

    /// "gideon error (503)." → 503.
    private static func statusIn(_ lower: String) -> Int? {
        guard lower.hasPrefix("gideon error"), let open = lower.firstIndex(of: "("), let close = lower.firstIndex(of: ")"), open < close else { return nil }
        return Int(lower[lower.index(after: open)..<close])
    }

    /// Any error as a GIDEON problem (network failures say "can't be reached", not URLSession's words).
    static func from(_ error: Error) -> GideonProblem {
        if let p = error as? GideonProblem { return p }
        if error is URLError { return .unreachable }
        if let api = error as? APIError {
            switch api {
            case .offline: return .unreachable
            case .http(let code, let message): return http(status: code, code: nil, message: message)
            case .transport(let message):
                // nothingAnswered() wraps a dropped connection as .transport(unreachableText).
                if message == APIError.unreachableText { return .unreachable }
                return stream(message)
            default: break
            }
        }
        return GideonProblem(text: (error as? LocalizedError)?.errorDescription ?? T("GIDEON failed."), retryable: true)
    }
}

// MARK: - unsent text kept on the device

/// Text typed into a composer that has not reached the server yet, per composer ("chat:<id>",
/// "comment:<taskId>"). Kept in UserDefaults: small, survives the app being closed, and cleared the moment
/// the server has the text. Signing out clears all of it (`clearAll`).
enum LocalDrafts {
    private static let prefix = "nx.draft."

    static func text(_ key: String) -> String {
        UserDefaults.standard.string(forKey: prefix + key) ?? ""
    }

    static func set(_ key: String, _ value: String) {
        if value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            UserDefaults.standard.removeObject(forKey: prefix + key)
        } else {
            UserDefaults.standard.set(String(value.prefix(20_000)), forKey: prefix + key)
        }
    }

    static func clear(_ key: String) { UserDefaults.standard.removeObject(forKey: prefix + key) }

    /// Every kept draft (sign-out: the next person on this phone must not find them).
    static func clearAll() {
        let d = UserDefaults.standard
        for k in d.dictionaryRepresentation().keys where k.hasPrefix(prefix) { d.removeObject(forKey: k) }
    }
}

/// True when nothing on NEXUS's side answered (offline, a dropped connection, an edge 502–504): the kind
/// of failure where a kept copy and "Try again" are the right answer, unlike a refusal.
func isTransientFailure(_ error: Error) -> Bool {
    if error is URLError { return true }
    if let api = error as? APIError { return api.nobodyAnswered }
    return false
}

// MARK: - ⌘K routing

/// Who answers ⌘K right now. A text editor that has the keyboard registers its link action; while one is
/// registered the app-wide ⌘K (search) must not bind, so the editor's binding is the only one.
@MainActor
@Observable
final class EditorKeys {
    static let shared = EditorKeys()
    /// Set while a block editor / comment box has focus.
    private(set) var linkOwner: String?
    private init() {}

    func claim(_ owner: String) { linkOwner = owner }
    func release(_ owner: String) { if linkOwner == owner { linkOwner = nil } }
    var editorHasKeyboard: Bool { linkOwner != nil }
}

// MARK: - ⌘K link form

/// One link already in a block: its text and address, and where it sits among the block's inline nodes.
struct ExistingLink: Identifiable, Hashable {
    let index: Int
    let text: String
    let href: String
    var id: Int { index }
}

/// "Add a link" (⌘K in an editor): the words to show and the address. With links already in the block it
/// lists them too, to change an address or remove the link (the words stay).
struct LinkInsertSheet: View {
    var existing: [ExistingLink] = []
    /// (text, address) for a new link.
    let onInsert: (String, String) -> Void
    /// (link, new address or nil to remove the link).
    var onEdit: ((ExistingLink, String?) -> Void)? = nil
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var href = ""
    @State private var editing: ExistingLink?
    @FocusState private var focus: Field?
    private enum Field: Hashable { case text, href }

    var body: some View {
        NavigationStack {
            Form {
                if let editing {
                    Section(T("Link")) {
                        Text(editing.text).font(NXFont.text(14, .semibold))
                        TextField(T("Paste or type a link…"), text: $href)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .focused($focus, equals: .href)
                            .onSubmit { save() }
                    }
                    Section {
                        Button(T("Remove link"), role: .destructive) { onEdit?(editing, nil); dismiss() }
                    }
                } else {
                    Section(T("New link")) {
                        TextField(T("Text to show (optional)"), text: $text)
                            .focused($focus, equals: .text)
                            .onSubmit { focus = .href }
                        TextField(T("Paste or type a link…"), text: $href)
                            .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled()
                            .focused($focus, equals: .href)
                            .onSubmit { save() }
                    }
                    if !existing.isEmpty, onEdit != nil {
                        Section(T("Links in this block")) {
                            ForEach(existing) { l in
                                Button {
                                    editing = l
                                    href = l.href
                                    focus = .href
                                } label: {
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(l.text).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                        Text(l.href).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                                    }
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle(editing == nil ? T("Add a link") : T("Edit link"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Cancel")) { dismiss() }.keyboardShortcut(.cancelAction)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(T("Save")) { save() }
                        .disabled(Self.normalized(href) == nil)
                }
            }
            .onAppear { focus = .href }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() {
        guard let url = Self.normalized(href) else { return }
        if let editing { onEdit?(editing, url) } else { onInsert(text.trimmingCharacters(in: .whitespacesAndNewlines), url) }
        dismiss()
    }

    /// "example.com" → "https://example.com"; mailto:/tel: kept; anything with a space or nothing → nil.
    static func normalized(_ raw: String) -> String? {
        let s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !s.isEmpty, !s.contains(" ") else { return nil }
        let lower = s.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") || lower.hasPrefix("mailto:") || lower.hasPrefix("tel:") { return s }
        guard s.contains(".") else { return nil }
        return "https://" + s
    }
}

// MARK: - page titles

enum DocTitle {
    /// A page's title for display: a new page is stored as "Untitled" (server default, and the apps create
    /// it that way too); in Indonesian it reads "Tanpa judul".
    static func display(_ title: String?) -> String {
        let v = (title ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        return v.isEmpty || v == "Untitled" ? T("Untitled") : v
    }
}

// MARK: - links in plain text

enum Linkified {
    private static let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue)

    /// Plain text with its web addresses tappable (task comments: a ⌘K link is written into the text).
    static func text(_ s: String) -> AttributedString {
        var out = AttributedString(s)
        guard let detector, !s.isEmpty else { return out }
        let ns = s as NSString
        for m in detector.matches(in: s, range: NSRange(location: 0, length: ns.length)) {
            guard let url = m.url, let r = Range(m.range, in: s),
                  let lo = AttributedString.Index(r.lowerBound, within: out),
                  let hi = AttributedString.Index(r.upperBound, within: out) else { continue }
            out[lo..<hi].link = url
            out[lo..<hi].underlineStyle = .single
        }
        return out
    }
}
