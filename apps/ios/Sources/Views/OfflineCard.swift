import SwiftUI

/// What NEXUS is keeping on this phone so it works without a signal, and the two things somebody
/// might reasonably want to decide about it.
///
/// Storage is the person's, not the app's. A feature that quietly fills a phone is a feature people
/// delete the app over, so what it is using is drawn against the budget it is allowed, and the
/// download that can cost money is off until it is switched on.
///
/// Laid out like its neighbours in Tuning Room — violet label, one grey line, icon rows — so it
/// reads as part of the same page rather than a debug panel dropped into it.
struct OfflineCard: View {
    @StateObject private var sync = OfflineSync.shared
    @Environment(AuthStore.self) private var auth
    @State private var cellular = OfflineSync.shared.mediaOverCellular

    private var running: Bool { sync.stage == .data || sync.stage == .media }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(T("OFFLINE COPY")).font(NXFont.text(11, .bold)).tracking(0.5).foregroundStyle(NX.violetText)
                Text(T("Kept on this phone so NEXUS still opens with no signal."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }

            storage

            VStack(spacing: 2) {
                row(icon: "square.stack.3d.up.fill", tint: NX.violetText,
                    title: T("Projects & attendance"), detail: Self.saved(sync.lastDataSync))
                row(icon: "photo.on.rectangle.angled", tint: Color(hex: "#0ea5e9"),
                    title: T("Files & selfies"), detail: Self.saved(sync.lastMediaSync))
            }

            Toggle(isOn: $cellular) {
                HStack(spacing: 10) {
                    iconBadge("antenna.radiowaves.left.and.right", tint: Color(hex: "#f59e0b"))
                    VStack(alignment: .leading, spacing: 1) {
                        Text(T("Use mobile data for files")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                        Text(T("Off by default — files can run to hundreds of megabytes."))
                            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .tint(NX.violetText)
            .padding(.vertical, 6).padding(.horizontal, 11)
            .onChange(of: cellular) { _, v in sync.mediaOverCellular = v }

            syncButton
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .nexusCard()
        // The figure is otherwise only refreshed at the end of a file pass, so every launch opened on
        // a dash even with a phone full of saved files.
        .onAppear { sync.refreshUsage() }
    }

    // MARK: pieces

    /// How much is saved, against the most it is allowed to take.
    private var storage: some View {
        let used = sync.offlineBytes
        let fraction = min(1, Double(used) / Double(AttachmentCache.offlineBudget))
        return VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(used > 0 ? Self.size(used) : T("Nothing yet"))
                    .font(NXFont.display(22, .bold)).foregroundStyle(NX.foreground)
                    .contentTransition(.numericText())
                Text(String(format: T("of %@"), Self.size(AttachmentCache.offlineBudget)))
                    .font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                Spacer(minLength: 0)
                statusPill
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(NX.muted)
                    Capsule()
                        .fill(LinearGradient(colors: [NX.violet, NX.violetText], startPoint: .leading, endPoint: .trailing))
                        // A sliver even for a few kilobytes, so "something is saved" is visible.
                        .frame(width: used > 0 ? max(6, geo.size.width * fraction) : 0)
                }
            }
            .frame(height: 8)
            .animation(.easeOut(duration: 0.4), value: used)
        }
        .padding(14)
        .background(NX.violet.opacity(0.06), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var statusPill: some View {
        let (label, tint): (String, Color) = {
            if running { return (T("Syncing…"), NX.violetText) }
            if sync.lastDataSync == nil { return (T("Not synced yet"), NX.mutedFg) }
            return (T("Up to date"), Color(hex: "#10b981"))
        }()
        return HStack(spacing: 5) {
            Circle().fill(tint).frame(width: 6, height: 6)
            Text(label).font(NXFont.text(11, .semibold)).foregroundStyle(tint)
        }
        .padding(.horizontal, 9).padding(.vertical, 4)
        .background(tint.opacity(0.12), in: Capsule())
    }

    private var syncButton: some View {
        VStack(spacing: 8) {
            if running {
                // Determinate when the pass knows how much is left, a quiet sweep when it does not.
                Group {
                    if let p = sync.progress { ProgressView(value: p) } else { ProgressView(value: nil as Double?) }
                }
                .progressViewStyle(.linear).tint(NX.violetText)
                if !sync.status.isEmpty {
                    Text(sync.status).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Button {
                guard let id = auth.session?.userId else { return }
                Task { await sync.syncAll(userId: id) }
            } label: {
                HStack(spacing: 7) {
                    if running { ProgressView().scaleEffect(0.75).tint(NX.violetText) }
                    else { Image(systemName: "arrow.triangle.2.circlepath").font(.system(size: 13, weight: .bold)) }
                    Text(running ? T("Syncing…") : T("Sync now")).font(NXFont.text(14, .bold))
                }
                .frame(maxWidth: .infinity).padding(.vertical, 12)
                .background(NX.violet.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                .foregroundStyle(NX.violetText)
            }
            .buttonStyle(.plain)
            .disabled(running)
        }
    }

    private func row(icon: String, tint: Color, title: String, detail: String) -> some View {
        HStack(spacing: 10) {
            iconBadge(icon, tint: tint)
            Text(title).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
            Spacer(minLength: 8)
            Text(detail).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
        }
        .padding(.vertical, 6).padding(.horizontal, 11)
    }

    private func iconBadge(_ name: String, tint: Color) -> some View {
        Image(systemName: name)
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(tint)
            .frame(width: 30, height: 30)
            .background(tint.opacity(0.12), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }

    // MARK: formatting

    static func size(_ bytes: Int) -> String {
        let f = ByteCountFormatter(); f.countStyle = .file
        return f.string(fromByteCount: Int64(bytes))
    }
    static func saved(_ date: Date?) -> String {
        guard let date else { return T("Not saved yet") }
        let f = RelativeDateTimeFormatter(); f.unitsStyle = .short
        return String(format: T("Saved %@"), f.localizedString(for: date, relativeTo: Date()))
    }
}
