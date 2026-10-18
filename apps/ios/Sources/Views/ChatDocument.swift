import SwiftUI
import QuickLook

/// Shared by the pending attachment and sent messages. Documents use the authenticated download path;
/// the previewer only receives a local file and never has to guess at cookies or a remote host.
struct ChatDocumentCard: View {
    let path: String
    let name: String?
    let size: Int?
    var ink: Color = NX.foreground
    @State private var loading = false
    @State private var failure: String?
    @State private var localFile: URL?

    var body: some View {
        Button { Task { await open() } } label: {
            HStack(spacing: 10) {
                Image(systemName: "doc.text").font(.system(size: 24))
                VStack(alignment: .leading, spacing: 3) {
                    Text(name ?? T("Document")).font(NXFont.text(13, .semibold)).lineLimit(2).multilineTextAlignment(.leading)
                    if let size { Text(nxBytes(size)).font(NXFont.text(11)).opacity(0.7) }
                }
                if loading { ProgressView().tint(ink) }
                else { Image(systemName: "arrow.down.circle").font(.system(size: 18)) }
            }
            .foregroundStyle(ink).padding(10)
            .background(ink.opacity(0.07), in: RoundedRectangle(cornerRadius: 10))
            .frame(maxWidth: 270, alignment: .leading)
        }
        .buttonStyle(.plain).disabled(loading)
        .quickLookPreview($localFile)
        .alert(T("Couldn't open this file"), isPresented: Binding(get: { failure != nil }, set: { if !$0 { failure = nil } })) {
            Button(T("OK")) { failure = nil }
        } message: { Text(failure ?? "") }
    }
    private func open() async {
        loading = true
        defer { loading = false }
        do { localFile = try await APIClient.shared.downloadAttachment(url: path, fileName: name ?? URL(string: path)?.lastPathComponent ?? "document") }
        catch { failure = error.localizedDescription }
    }
}
