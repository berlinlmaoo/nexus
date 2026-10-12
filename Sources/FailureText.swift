import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// One way to say "that didn't work" (web lib/failure.ts + LoadError.tsx, QA 13 Oct 2026).
//
// Failed writes were silent, showed raw server text ("Forbidden: LEAD role required…", "Internal server
// error") or a generic line. Every failure now reads as a sentence for a person, in the app's language: the
// server's own sentence when it wrote one, otherwise a line for the status. A write that fails also keeps
// what the person typed (the screen's job) and says so in a toast (`failureToast`).
// ─────────────────────────────────────────────────────────────────────────────

/// The server's access-level refusals (403 with `code`, project access levels round 2, 13 Oct 2026; web
/// failure.ts + task-undo.ts friendlyError) as sentences for a person. `APIClient.serverMessage` swaps the
/// raw "Forbidden: you need Can edit access in this project" for these, so every place that shows an
/// APIError.http message gets the readable line. Older servers' role wording ("MEMBER role", "LEAD role")
/// maps the same way.
enum AccessRefusal {
    static var needsEditText: String { "You can view this project but not change it. Ask its Project Owner for Can edit access." }
    static var needsCommentText: String { "You can view this project but not comment. Ask its Project Owner for Can comment access." }
    static var needsFullText: String { "Only people with Full access to the project can do this." }

    /// The English sentence (translated where it is shown) for a refusal, or nil when it is not one.
    static func readable(code: String?, message: String?) -> String? {
        switch code {
        case "NEEDS_EDIT_ACCESS": return needsEditText
        case "NEEDS_COMMENT_ACCESS": return needsCommentText
        case "NEEDS_FULL_ACCESS": return needsFullText
        default: break
        }
        // No code: only a "Forbidden…" line from an older server is reworded; real sentences pass through.
        guard let msg = message, msg.range(of: "^forbidden", options: [.regularExpression, .caseInsensitive]) != nil else { return nil }
        if msg.range(of: "Can edit access|MEMBER role", options: [.regularExpression, .caseInsensitive]) != nil { return needsEditText }
        if msg.range(of: "Can comment access", options: [.regularExpression, .caseInsensitive]) != nil { return needsCommentText }
        if msg.range(of: "Full access|LEAD role", options: [.regularExpression, .caseInsensitive]) != nil { return needsFullText }
        return nil
    }
}

enum FailureText {
    /// Server text that is a code word for a developer, not a sentence for a person.
    private static func isRaw(_ msg: String) -> Bool {
        let pattern = #"^(forbidden|unauthorized|internal server error|request failed|not found|bad request|missing fields|invalid\b|[a-z]+ is required|[a-z]+ required|failed to )"#
        return msg.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    /// Why it failed, as the web's failureText(): the server's sentence unless it is a code word.
    static func text(_ error: Error) -> String {
        if let api = error as? APIError {
            switch api {
            case .offline: return APIError.unreachableText
            case .unauthorized: return T("Your session ended. Sign in again, then retry.")
            case .decoding: return T("Something went wrong. Try again.")
            case .upgradeRequired(let m): return m
            case .transport(let m): return m.isEmpty ? T("Something went wrong. Try again.") : T(m)
            case .http(let code, let message):
                let msg = (message ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
                // A server failure is never shown raw (web friendlyError, QA R2 Manager B31).
                if code >= 500 { return T("Something went wrong on our side. Try again in a moment.") }
                if code == 403, let r = AccessRefusal.readable(code: nil, message: msg) { return T(r) }
                // A real sentence wins, in the app's language when it has one.
                if !msg.isEmpty && !isRaw(msg) { return T(msg) }
                if code == 403 { return T("Your role can't do this. Ask a BoD if you need it.") }
                if code == 404 { return T("It no longer exists. Refresh the page.") }
                if code >= 500 { return T("Something went wrong on our side. Try again in a moment.") }
                return T("The server didn't accept it. Check what you entered and try again.")
            }
        }
        if (error as? URLError) != nil { return APIError.unreachableText }
        return T("Something went wrong. Try again.")
    }

    /// The shape of a failed LOAD (web LoadError): told apart because each one says something different.
    enum LoadKind { case offline, notFound, forbidden, server }
    static func loadKind(_ error: Error) -> LoadKind {
        if let api = error as? APIError {
            if api.nobodyAnswered { return .offline }
            if case .http(404, _) = api { return .notFound }
            if case .http(403, _) = api { return .forbidden }
        }
        if (error as? URLError) != nil { return .offline }
        return .server
    }
}

/// A failed-write toast: what failed (title) and why (FailureText), at the bottom of the screen for a few
/// seconds. The screen keeps the person's input; this only tells them.
struct FailureToastPayload: Equatable {
    let title: String
    let detail: String
    let id = UUID()
    static func == (a: FailureToastPayload, b: FailureToastPayload) -> Bool { a.id == b.id }

    init(title: String, error: Error) { self.title = title; self.detail = FailureText.text(error) }
    init(title: String, detail: String) { self.title = title; self.detail = detail }
}

private struct FailureToastModifier: ViewModifier {
    @Binding var payload: FailureToastPayload?

    func body(content: Content) -> some View {
        content.overlay(alignment: .bottom) {
            if let p = payload {
                HStack(alignment: .top, spacing: 10) {
                    Image(systemName: "exclamationmark.circle.fill").foregroundStyle(NX.danger).padding(.top, 1)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.title).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                        if !p.detail.isEmpty {
                            Text(p.detail).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    Spacer(minLength: 0)
                    Button { payload = nil } label: { Image(systemName: "xmark").font(.system(size: 11, weight: .bold)).foregroundStyle(NX.mutedFg) }
                        .buttonStyle(.plain).accessibilityLabel(T("Close"))
                }
                .padding(12)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.border))
                .shadow(color: .black.opacity(0.12), radius: 8, y: 3)
                .padding(.horizontal, 16).padding(.bottom, 16)
                .frame(maxWidth: 520)
                .transition(.move(edge: .bottom).combined(with: .opacity))
                .task(id: p.id) {
                    try? await Task.sleep(nanoseconds: 4_500_000_000)
                    if payload?.id == p.id { payload = nil }
                }
                .accessibilityElement(children: .combine)
            }
        }
        .animation(.easeOut(duration: 0.2), value: payload)
    }
}

extension View {
    /// Shows `payload` as a failure toast; clears it after a few seconds or on ✕.
    func failureToast(_ payload: Binding<FailureToastPayload?>) -> some View {
        modifier(FailureToastModifier(payload: payload))
    }
}

/// The one "this didn't load" state (web LoadError.tsx, QA 13 Oct 2026). A failed request used to fall into
/// whatever the screen drew with no data ("This folder is empty", "No chats yet"), which told the person
/// something false. Four shapes: offline (Try again), not found (no retry; the screen may pass a way back),
/// no access (no retry), server (Try again).
struct LoadErrorView: View {
    let error: Error
    /// What failed, already translated and lower-case: "the vault", "this report".
    var what: String? = nil
    var notFoundTitle: String? = nil
    var notFoundMessage: String? = nil
    var forbiddenTitle: String? = nil
    var forbiddenMessage: String? = nil
    var retry: (() -> Void)? = nil
    /// An extra way out (e.g. "Go to Projects"), shown on every shape.
    var actionTitle: String? = nil
    var action: (() -> Void)? = nil
    var compact: Bool = false

    private var kind: FailureText.LoadKind { FailureText.loadKind(error) }

    private var icon: String {
        switch kind { case .offline: return "wifi.exclamationmark"; case .notFound: return "questionmark.folder"
        case .forbidden: return "lock"; case .server: return "exclamationmark.icloud" }
    }
    private var title: String {
        switch kind {
        case .offline: return T("No connection")
        case .notFound: return notFoundTitle ?? T("Not found")
        case .forbidden: return forbiddenTitle ?? T("You don't have access")
        case .server: return what.map { String(format: T("Couldn't load %@"), $0) } ?? T("Couldn't load this")
        }
    }
    private var message: String {
        switch kind {
        case .offline: return T("Check your internet, then try again. Nothing was changed.")
        case .notFound: return notFoundMessage ?? T("It may have been deleted, or the link is wrong.")
        case .forbidden: return forbiddenMessage ?? T("Your role can't open this. Ask a BoD if you need it.")
        case .server: return T("Something went wrong on our side. Try again in a moment.")
        }
    }
    private var canRetry: Bool { retry != nil && (kind == .offline || kind == .server) }

    var body: some View {
        if canRetry, let retry {
            EmptyState(icon: icon, title: title, subtitle: message,
                       actionTitle: T("Try again"), actionIcon: "arrow.clockwise", action: retry, compact: compact)
        } else if let actionTitle, let action {
            EmptyState(icon: icon, title: title, subtitle: message,
                       actionTitle: actionTitle, actionIcon: nil, action: action, compact: compact)
        } else {
            EmptyState(icon: icon, title: title, subtitle: message, compact: compact)
        }
    }
}
