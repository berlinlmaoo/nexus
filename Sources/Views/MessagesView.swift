import SwiftUI

/// Port of messages.tsx: conversation list grouped Direct/Groups/Projects → tap → chat thread.
struct MessagesView: View {
    @Environment(AuthStore.self) private var auth
    @State private var convos: [Conversation] = []
    @State private var loading = true
    @State private var error: String?

    private var meId: String? { auth.session?.userId }
    private var groups: [(label: String, items: [Conversation])] {
        [("Direct", convos.filter { $0.type == "DM" }),
         ("Groups", convos.filter { $0.type == "GROUP" }),
         ("Projects", convos.filter { $0.type == "PROJECT" })].filter { !$0.1.isEmpty }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle("Messages")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violet).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            VStack(spacing: 12) {
                Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 40)).foregroundStyle(NX.mutedFg)
                Text(error).font(NXFont.text(14)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
                Button("Coba lagi") { Task { await load() } }.buttonStyle(NexusPrimaryButton(fullWidth: false))
            }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
        } else if convos.isEmpty {
            VStack(spacing: 8) {
                Image(systemName: "bubble.left.and.bubble.right").font(.system(size: 42)).foregroundStyle(NX.mutedFg)
                Text("Belum ada chat").font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
            }.frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    ForEach(groups, id: \.label) { group in
                        VStack(alignment: .leading, spacing: 8) {
                            Text(group.label.uppercased()).font(NXFont.text(11, .bold)).tracking(1).foregroundStyle(NX.mutedFg).padding(.leading, 4)
                            VStack(spacing: 0) {
                                ForEach(Array(group.items.enumerated()), id: \.element.id) { idx, c in
                                    if idx > 0 { Divider().overlay(NX.border) }
                                    NavigationLink {
                                        ChatThreadView(conversationId: c.id, title: c.title(meId: meId))
                                    } label: { ConvoRow(convo: c, meId: meId) }
                                    .buttonStyle(.plain)
                                }
                            }
                            .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 18).strokeBorder(NX.border))
                            .nexusShadowSoft()
                        }
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func load() async {
        error = nil
        do { convos = try await APIClient.shared.conversations() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Gagal memuat chat." }
        loading = false
    }
}

struct ConvoRow: View {
    let convo: Conversation
    let meId: String?
    var body: some View {
        HStack(spacing: 12) {
            if convo.isGroupish {
                ZStack {
                    Circle().fill(NX.violet.opacity(0.12)).frame(width: 40, height: 40)
                    Image(systemName: "person.2.fill").font(.system(size: 15)).foregroundStyle(NX.violet)
                }
            } else {
                AvatarView(url: convo.avatarURL(meId: meId), initial: convo.initial(meId: meId), size: 40)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(convo.title(meId: meId)).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                Text(convo.lastMessage?.content ?? "Belum ada pesan").font(NXFont.text(13)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
            Spacer(minLength: 4)
            if let u = convo.unreadCount, u > 0 {
                Text("\(u)").font(NXFont.text(10, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 6).padding(.vertical, 3).background(NX.danger, in: Capsule())
            }
        }
        .padding(14)
    }
}

/// Chat thread — message bubbles (mine onyx-right / others muted-left + name) + input.
struct ChatThreadView: View {
    let conversationId: String
    let title: String
    @Environment(AuthStore.self) private var auth
    @State private var messages: [ChatMessage] = []
    @State private var input = ""
    @State private var loading = true
    @State private var sending = false

    private var meId: String? { auth.session?.userId }

    var body: some View {
        VStack(spacing: 0) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(spacing: 6) {
                        if loading { ProgressView().tint(NX.violet).padding(.top, 40) }
                        else if messages.isEmpty {
                            Text("Belum ada pesan. Say hi 👋").font(NXFont.text(14)).foregroundStyle(NX.mutedFg).padding(.top, 40)
                        }
                        ForEach(messages) { m in bubble(m) }
                        Color.clear.frame(height: 1).id("bottom")
                    }
                    .padding(16)
                }
                .onChange(of: messages.count) { _, _ in withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
                .task { await load(); withAnimation { proxy.scrollTo("bottom", anchor: .bottom) } }
            }

            // input
            HStack(alignment: .bottom, spacing: 8) {
                TextField("Tulis pesan…", text: $input, axis: .vertical)
                    .font(NXFont.text(15)).lineLimit(1...4)
                    .padding(.horizontal, 14).padding(.vertical, 10)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                Button { Task { await send() } } label: {
                    Image(systemName: sending ? "ellipsis" : "paperplane.fill").font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 40, height: 40).background(NX.onyx, in: Circle())
                }.disabled(input.trimmingCharacters(in: .whitespaces).isEmpty || sending)
            }
            .padding(12)
            .background(NX.card)
            .overlay(Rectangle().fill(NX.border).frame(height: 1), alignment: .top)
        }
        .background(NX.background.ignoresSafeArea())
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private func bubble(_ m: ChatMessage) -> some View {
        let mine = m.userId != nil && m.userId == meId
        return HStack(alignment: .bottom, spacing: 8) {
            if mine {
                Spacer(minLength: 50)
            } else {
                AvatarView(url: m.user?.avatar, initial: String((m.user?.name ?? "?").first ?? "?").uppercased(), size: 28)
            }
            VStack(alignment: .leading, spacing: 2) {
                if !mine, let n = m.user?.name { Text(n).font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg) }
                Text(m.content).font(NXFont.text(15))
                    .foregroundStyle(mine ? .white : NX.foreground)
            }
            .padding(.horizontal, 13).padding(.vertical, 9)
            .background(mine ? NX.onyx : NX.muted, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            if !mine { Spacer(minLength: 50) }
        }
    }

    private func load() async {
        do { messages = try await APIClient.shared.conversationMessages(conversationId) }
        catch APIError.unauthorized { auth.logout() }
        catch {}
        loading = false
    }
    private func send() async {
        let v = input.trimmingCharacters(in: .whitespaces)
        guard !v.isEmpty else { return }
        sending = true; input = ""
        try? await APIClient.shared.sendMessage(conversationId, content: v)
        await load()
        sending = false
    }
}
