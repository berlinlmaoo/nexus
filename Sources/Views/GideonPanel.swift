import SwiftUI

/// The floating GIDEON button, and the chat it opens.
///
/// Bottom-LEFT on purpose. The right-hand side of a phone screen is where thumbs already live —
/// send buttons, compose buttons, the scroll edge — and a permanent circle parked there gets pressed
/// by accident. On the web the panel sits bottom-right because a cursor does not have that problem.
struct GideonLauncher: View {
    @Environment(AuthStore.self) private var auth
    @State private var open = false

    var body: some View {
        Button {
            open = true
        } label: {
            Image(systemName: "sparkles")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(
                    LinearGradient(colors: [NX.violet, Color(hex: "#b3a6ff")],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: Circle()
                )
                .shadow(color: NX.violet.opacity(0.45), radius: 14, y: 6)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("GIDEON")
        .padding(.leading, 20)
        // Clears the tab bar on a phone. On the iPad sidebar layout there is no bar, so this is
        // simply a comfortable margin.
        .padding(.bottom, 76)
        .sheet(isPresented: $open) { GideonPanel() }
    }
}

struct GideonPanel: View {
    @Environment(AuthStore.self) private var auth
    @Environment(\.dismiss) private var dismiss

    @State private var turns: [GideonTurn] = []
    @State private var draft = ""
    @State private var sending = false
    @State private var error: String?
    @State private var loaded = false

    var body: some View {
        NavigationStack {
            ZStack {
                NX.background.ignoresSafeArea()
                VStack(spacing: 0) {
                    transcript
                    composer
                }
            }
            .navigationTitle("GIDEON")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(T("Close")) { dismiss() }
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button(T("Clear chat"), role: .destructive) {
                            Task { await clear() }
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                    .disabled(sending || turns.isEmpty)
                }
            }
        }
        .task {
            guard !loaded else { return }
            loaded = true
            // The thread lives on the server, so this picks up whatever was said on the web.
            turns = (try? await GideonClient.history()) ?? []
        }
    }

    // MARK: - transcript

    private var transcript: some View {
        ScrollViewReader { proxy in
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    if turns.isEmpty && !sending {
                        empty
                    }
                    ForEach(turns) { turn in
                        bubble(turn).id(turn.id)
                    }
                    if let error {
                        Text(error)
                            .font(NXFont.text(12))
                            .foregroundStyle(NX.danger)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .id("error")
                    }
                }
                .padding(16)
            }
            .onChange(of: turns.last?.content) { _, _ in
                // Follows the answer as it grows, not just when a turn is added.
                guard let last = turns.last else { return }
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(last.id, anchor: .bottom) }
            }
        }
    }

    private var empty: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: "sparkles")
                .font(.system(size: 26))
                .foregroundStyle(NX.violetText)
            Text(T("Ask GIDEON about NEXUS"))
                .font(NXFont.display(16, .bold))
                .foregroundStyle(NX.foreground)
            Text(T("Projects, tasks, who is busy, what is overdue."))
                .font(NXFont.text(13))
                .foregroundStyle(NX.mutedFg)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 40)
    }

    private func bubble(_ turn: GideonTurn) -> some View {
        HStack {
            if turn.role == .user { Spacer(minLength: 44) }
            VStack(alignment: .leading, spacing: 6) {
                Text(turn.content.isEmpty ? "…" : turn.content)
                    .font(NXFont.text(14))
                    .foregroundStyle(turn.role == .user ? .white : NX.foreground)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                if !turn.tools.isEmpty {
                    Text(turn.tools.joined(separator: " · "))
                        .font(NXFont.text(10))
                        .foregroundStyle(turn.role == .user ? .white.opacity(0.7) : NX.mutedFg)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(
                turn.role == .user ? AnyShapeStyle(NX.violet) : AnyShapeStyle(NX.card),
                in: RoundedRectangle(cornerRadius: 16, style: .continuous)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(turn.role == .user ? .clear : NX.border)
            )
            if turn.role == .assistant { Spacer(minLength: 44) }
        }
    }

    // MARK: - composer

    private var composer: some View {
        HStack(spacing: 10) {
            TextField(T("Ask anything about NEXUS…"), text: $draft, axis: .vertical)
                .font(NXFont.text(14))
                .lineLimit(1...5)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(NX.border))
                .disabled(sending)

            Button {
                Task { await send() }
            } label: {
                Image(systemName: sending ? "ellipsis" : "arrow.up")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 38, height: 38)
                    .background(canSend ? NX.violet : NX.muted, in: Circle())
            }
            .buttonStyle(.plain)
            .disabled(!canSend)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(NX.background)
    }

    private var canSend: Bool {
        !sending && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    // MARK: - work

    private func send() async {
        let text = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !sending else { return }
        error = nil
        draft = ""
        sending = true
        defer { sending = false }

        turns.append(GideonTurn(role: .user, content: text))
        // An empty assistant turn goes in immediately so the answer has somewhere to land and the
        // list scrolls to it before the first chunk arrives.
        let answer = GideonTurn(role: .assistant, content: "")
        turns.append(answer)

        do {
            // "sonnet" is what the web sends today. The server ignores it — the three tiers are not
            // wired yet — so no picker is shown here rather than offering a choice that does nothing.
            for try await chunk in GideonClient.stream(messages: history(), model: "sonnet") {
                guard let index = turns.firstIndex(where: { $0.id == answer.id }) else { continue }
                turns[index].content += chunk
            }
            // A stream that ends without a word is a failure the user can see but not explain.
            if let index = turns.firstIndex(where: { $0.id == answer.id }), turns[index].content.isEmpty {
                turns.remove(at: index)
                error = T("GIDEON didn't answer. Try again.")
            }
        } catch APIError.unauthorized {
            auth.logout()
        } catch {
            turns.removeAll { $0.id == answer.id }
            self.error = (error as? LocalizedError)?.errorDescription ?? T("GIDEON failed.")
        }
    }

    /// Everything except the empty assistant turn that is still being filled in.
    private func history() -> [GideonTurn] {
        turns.filter { !($0.role == .assistant && $0.content.isEmpty) }
    }

    private func clear() async {
        do {
            try await GideonClient.clearHistory()
            turns = []
            error = nil
        } catch {
            self.error = (error as? LocalizedError)?.errorDescription ?? T("Failed.")
        }
    }
}
