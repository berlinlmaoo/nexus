import SwiftUI

/// Port of docs.tsx ("Knowledge Library"): searchable doc list → reader.
struct DocsView: View {
    @Environment(AuthStore.self) private var auth
    @State private var docs: [Doc] = []
    @State private var query = ""
    @State private var loading = true
    @State private var error: String?

    private var filtered: [Doc] {
        query.trimmingCharacters(in: .whitespaces).isEmpty ? docs
            : docs.filter { $0.title.lowercased().contains(query.lowercased()) }
    }

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            content
        }
        .navigationTitle("Knowledge Library")
        .navigationBarTitleDisplayMode(.inline)
        .searchable(text: $query, prompt: T("Search docs…"))
        .task { await load() }
    }

    @ViewBuilder private var content: some View {
        if loading {
            ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let error {
            emptyState(icon: "book.closed", title: "Library terkunci", msg: error)
        } else if filtered.isEmpty {
            emptyState(icon: "books.vertical", title: query.isEmpty ? T("The shelf is still empty") : T("No matches"),
                       msg: query.isEmpty ? T("No docs in this workspace yet.") : T("Try another keyword."))
        } else {
            ScrollView {
                NXCardGrid(spacing: 12) {
                    ForEach(filtered) { d in
                        NavigationLink { DocReaderView(docId: d.id, title: d.title) } label: { DocCard(doc: d) }
                            .buttonStyle(.plain)
                    }
                }
                .padding(16)
            }
            .refreshable { await load() }
        }
    }

    private func emptyState(icon: String, title: String, msg: String) -> some View {
        VStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 42)).foregroundStyle(NX.mutedFg)
            Text(title).font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
            Text(msg).font(NXFont.text(13)).foregroundStyle(NX.mutedFg).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity, maxHeight: .infinity).padding(32)
    }

    private func load() async {
        error = nil
        do { docs = try await APIClient.shared.docs() }
        catch APIError.unauthorized { auth.logout() }
        catch { self.error = (error as? LocalizedError)?.errorDescription ?? "Login/session diperlukan." }
        loading = false
    }
}

struct DocCard: View {
    let doc: Doc
    var body: some View {
        HStack(spacing: 14) {
            Text(doc.emoji).font(.system(size: 22))
                .frame(width: 44, height: 44).background(NX.muted, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
                Text(doc.title).font(NXFont.display(15, .bold)).foregroundStyle(NX.foreground).lineLimit(1)
                if let preview = doc.contentText, !preview.isEmpty {
                    Text(preview).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(2)
                } else if let pname = doc.project?.name {
                    Text(pname).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                }
            }
            Spacer(minLength: 4)
            Image(systemName: "chevron.right").font(.system(size: 13, weight: .bold)).foregroundStyle(NX.mutedFg.opacity(0.5))
        }
        .nexusCard(padding: 14)
    }
}

struct DocReaderView: View {
    let docId: String
    let title: String
    @Environment(AuthStore.self) private var auth
    @State private var doc: Doc?
    @State private var loading = true

    var body: some View {
        ZStack {
            NX.background.ignoresSafeArea()
            if loading { ProgressView().tint(NX.violetText) }
            else if let doc {
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(spacing: 10) {
                            Text(doc.emoji).font(.system(size: 30))
                            Text(doc.title).font(NXFont.display(26, .bold)).foregroundStyle(NX.foreground)
                        }
                        if let body = doc.contentText, !body.isEmpty {
                            Text(body).font(NXFont.text(15)).foregroundStyle(NX.foreground.opacity(0.92))
                                .fixedSize(horizontal: false, vertical: true).lineSpacing(4)
                        } else {
                            Text(T("This doc is still empty.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
                        }
                    }
                    .padding(20)
                }
            } else {
                Text(T("Couldn't load the doc.")).font(NXFont.text(14)).foregroundStyle(NX.mutedFg)
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        do { doc = try await APIClient.shared.doc(docId) }
        catch APIError.unauthorized { auth.logout() }
        catch {}
        loading = false
    }
}
