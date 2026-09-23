import SwiftUI

/// What NEXUS is keeping on this phone so it works without a signal, and the two things somebody
/// might reasonably want to decide about it.
///
/// Storage is the person's, not the app's. A feature that quietly fills a phone is a feature people
/// delete the app over, so what it is using is written down, and the download that can cost money
/// is off until it is switched on.
struct OfflineCard: View {
    @StateObject private var sync = OfflineSync.shared
    @Environment(AuthStore.self) private var auth
    @State private var cellular = OfflineSync.shared.mediaOverCellular

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "arrow.down.circle.fill").font(.system(size: 15)).foregroundStyle(NX.violetText)
                VStack(alignment: .leading, spacing: 1) {
                    Text(T("Offline copy")).font(NXFont.text(14, .bold)).foregroundStyle(NX.foreground)
                    Text(T("Your projects, attendance and their files, kept on this phone so NEXUS still opens with no signal."))
                        .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            HStack(spacing: 18) {
                stat(T("Files"), sync.offlineBytes > 0 ? Self.size(sync.offlineBytes) : "—")
                stat(T("Data"), Self.when(sync.lastDataSync))
                stat(T("Files synced"), Self.when(sync.lastMediaSync))
            }
            Toggle(isOn: $cellular) {
                VStack(alignment: .leading, spacing: 1) {
                    Text(T("Download files on mobile data")).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    Text(T("Off by default — the files can run to hundreds of megabytes."))
                        .font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                }
            }
            .tint(NX.violetText)
            .onChange(of: cellular) { _, v in sync.mediaOverCellular = v }
            HStack(spacing: 10) {
                Button {
                    guard let id = auth.session?.userId else { return }
                    Task { await sync.syncAll(userId: id) }
                } label: {
                    HStack(spacing: 6) {
                        if sync.stage == .data || sync.stage == .media { ProgressView().scaleEffect(0.7) }
                        else { Image(systemName: "arrow.clockwise").font(.system(size: 11, weight: .bold)) }
                        Text(T("Sync now")).font(NXFont.text(12, .bold))
                    }
                    .padding(.horizontal, 12).padding(.vertical, 7)
                    .background(NX.violet.opacity(0.12), in: Capsule()).foregroundStyle(NX.violetText)
                }
                .buttonStyle(.plain).disabled(sync.stage == .data || sync.stage == .media)
                if !sync.status.isEmpty {
                    Text(sync.status).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(value).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
            Text(label).font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
        }
    }

    static func size(_ bytes: Int) -> String {
        let f = ByteCountFormatter(); f.countStyle = .file
        return f.string(fromByteCount: Int64(bytes))
    }
    static func when(_ date: Date?) -> String {
        guard let date else { return "—" }
        let f = RelativeDateTimeFormatter(); f.unitsStyle = .abbreviated
        return f.localizedString(for: date, relativeTo: Date())
    }
}
