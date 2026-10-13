import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// The upload panel (owner, 9 Oct 2026): a card in the middle of the screen that says how many files
// are going up, how many megabytes of how many, and how far each file has got — and that folds down
// to a small pill above the tab bar so the person can carry on while it works.
//
// An overlay on the app's root (RootView), NOT a sheet: a sheet would stop the person from using the
// app underneath, and a second sheet on any screen is how one of them silently never presents. The
// card takes touches only where it is drawn; everything around it stays usable.
//
// The queue itself is VaultUploads (Sources/VaultUploads.swift); nothing here owns state.
// ─────────────────────────────────────────────────────────────────────────────

struct VaultUploadOverlay: View {
    @State private var uploads = VaultUploads.shared
    @Environment(\.horizontalSizeClass) private var hSize

    var body: some View {
        ZStack {
            if !uploads.items.isEmpty {
                if uploads.expanded {
                    VaultUploadCard(uploads: uploads)
                        .frame(maxWidth: 420)
                        .padding(.horizontal, 16)
                        .transition(.opacity.combined(with: .scale(scale: 0.96)))
                } else {
                    // Phone: bottom-right, clear of the tab bar (the same 76 pt the GIDEON button
                    // uses) and of anything centred at the bottom of a screen. iPad and Mac: bottom
                    // centre, because GIDEON sits bottom-right there.
                    VaultUploadPill(uploads: uploads)
                        .padding(hSize == .regular ? .horizontal : .trailing, hSize == .regular ? 0 : 16)
                        .padding(.bottom, hSize == .regular ? 28 : 76)
                        .frame(maxWidth: .infinity, maxHeight: .infinity,
                               alignment: hSize == .regular ? .bottom : .bottomTrailing)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                }
            }
        }
        .animation(.easeOut(duration: 0.22), value: uploads.expanded)
        .animation(.easeOut(duration: 0.22), value: uploads.items.isEmpty)
    }
}

/// The card: what is happening, the total, every file, and the buttons.
private struct VaultUploadCard: View {
    let uploads: VaultUploads

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            VaultUploadTotal(uploads: uploads)
            Divider().overlay(NX.border)
            list
            footer
        }
        .padding(16)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).strokeBorder(NX.border))
        .shadow(color: .black.opacity(0.22), radius: 26, y: 10)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 12) {
            statusIcon
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(NXFont.display(16, .bold)).foregroundStyle(NX.foreground)
                    .lineLimit(2)
                if let destination = uploads.destination {
                    Text(String(format: T("to %@"), destination))
                        .font(NXFont.text(12)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Button { uploads.expanded = false } label: {
                Image(systemName: "chevron.down")
                    .font(.system(size: 14, weight: .bold)).foregroundStyle(NX.mutedFg)
                    .frame(width: 36, height: 36)
                    .background(NX.muted, in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(T("Minimize"))
        }
    }

    @ViewBuilder private var statusIcon: some View {
        let (symbol, tint): (String, Color) = {
            if uploads.isRunning { return ("arrow.up.circle.fill", NX.violetText) }
            if uploads.failedCount > 0 { return ("exclamationmark.circle.fill", NX.danger) }
            return ("checkmark.circle.fill", NX.success)
        }()
        Image(systemName: symbol)
            .font(.system(size: 26)).foregroundStyle(tint)
            .frame(width: 30, height: 30)
    }

    private var title: String {
        let counted = uploads.counted.count
        if uploads.isRunning {
            return counted == 1 ? T("Uploading 1 file")
                : String(format: T("Uploading %d of %d files"), uploads.position, counted)
        }
        let done = uploads.doneCount
        let failed = uploads.failedCount
        if failed > 0 { return String(format: T("%d uploaded, %d failed"), done, failed) }
        if done == 0 { return T("Upload cancelled") }
        return done == 1 ? T("1 file uploaded") : String(format: T("%d files uploaded"), done)
    }

    /// Up to four rows as they are; past that a scrolling list of fixed height, so the card never
    /// grows past the screen and never changes height while bytes move.
    @ViewBuilder private var list: some View {
        if uploads.items.count <= 4 {
            VStack(spacing: 12) { rows }
        } else {
            ScrollView {
                VStack(spacing: 12) { rows }.padding(.vertical, 2)
            }
            .frame(height: 252)
        }
    }

    private var rows: some View {
        ForEach(uploads.items) { upload in
            VaultUploadRow(upload: upload, uploads: uploads)
        }
    }

    @ViewBuilder private var footer: some View {
        if uploads.isRunning {
            HStack {
                Button(T("Cancel all"), role: .destructive) { uploads.cancelAll() }
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.danger)
                Spacer()
                Button(T("Minimize")) { uploads.expanded = false }
                    .font(NXFont.text(14, .bold)).foregroundStyle(NX.violetText)
            }
        } else if uploads.failedCount > 0 {
            HStack {
                Button(T("Close")) { uploads.close() }
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.mutedFg)
                Spacer()
                Button(T("Retry failed")) { uploads.retryFailed() }
                    .font(NXFont.text(14, .bold)).foregroundStyle(NX.violetText)
            }
        } else {
            HStack {
                Spacer()
                Button(T("Close")) { uploads.close() }
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.mutedFg)
            }
        }
    }
}

/// "12.4 MB of 40.1 MB · 31%" and the bar. Its own view: it is the part that changes ten times a
/// second, and the card around it should not be rebuilt that often.
private struct VaultUploadTotal: View {
    let uploads: VaultUploads

    var body: some View {
        let sent = uploads.sentBytes
        let total = uploads.totalBytes
        let fraction = total > 0 ? min(1, Double(sent) / Double(total)) : 0
        VStack(alignment: .leading, spacing: 7) {
            HStack {
                Text(String(format: T("%@ of %@"), nxBytes(sent), nxBytes(total)))
                    .font(NXFont.text(13, .semibold).monospacedDigit()).foregroundStyle(NX.foreground)
                Spacer()
                Text("\(Int(fraction * 100))%")
                    .font(NXFont.text(13, .bold).monospacedDigit()).foregroundStyle(NX.violetText)
            }
            VaultUploadBar(fraction: fraction, height: 8)
        }
    }
}

/// One file: name, size, how far it is, and what can be done about it.
private struct VaultUploadRow: View {
    let upload: VaultUpload
    let uploads: VaultUploads

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Image(systemName: icon)
                .font(.system(size: 16)).foregroundStyle(NX.mutedFg)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(upload.name)
                    .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground)
                    .lineLimit(1).truncationMode(.middle)
                detail
                if upload.phase == .uploading {
                    VaultUploadBar(fraction: upload.size > 0 ? Double(upload.sent) / Double(upload.size) : 0, height: 4)
                }
            }
            Spacer(minLength: 6)
            trailing
        }
    }

    @ViewBuilder private var detail: some View {
        switch upload.phase {
        case .queued:
            Text("\(T("Queued")) · \(nxBytes(upload.size))")
                .font(NXFont.text(11).monospacedDigit()).foregroundStyle(NX.mutedFg)
        case .uploading:
            Text(String(format: T("%@ of %@"), nxBytes(upload.sent), nxBytes(upload.size)))
                .font(NXFont.text(11).monospacedDigit()).foregroundStyle(NX.violetText)
        case .done:
            Text("\(nxBytes(upload.size)) · \(T("Done"))")
                .font(NXFont.text(11).monospacedDigit()).foregroundStyle(NX.success)
        case .failed(let reason):
            Text(reason)
                .font(NXFont.text(11, .medium)).foregroundStyle(NX.danger)
                .lineLimit(3).fixedSize(horizontal: false, vertical: true)
        case .cancelled:
            Text(T("Cancelled"))
                .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
        }
    }

    @ViewBuilder private var trailing: some View {
        switch upload.phase {
        case .queued, .uploading:
            Button { uploads.cancel(upload) } label: {
                Image(systemName: "xmark.circle.fill")
                    .font(.system(size: 18)).foregroundStyle(NX.mutedFg)
                    .frame(width: 40, height: 40)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(String(format: T("Cancel %@"), upload.name))
        case .failed:
            Button { uploads.retry(upload) } label: {
                Label(T("Retry"), systemImage: "arrow.clockwise")
                    .font(NXFont.text(12, .bold)).foregroundStyle(NX.violetText)
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(NX.accentBg, in: Capsule())
            }
            .buttonStyle(.plain)
        case .done:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 18)).foregroundStyle(NX.success)
                .frame(width: 40, height: 40)
        case .cancelled:
            EmptyView()
        }
    }

    private var icon: String {
        switch AttachmentKind(mime: nil, name: upload.name) {
        case .image?: return "photo"
        case .video?: return "film"
        case .pdf?:   return "doc.richtext"
        case .audio?: return "waveform"
        case nil:     return "doc"
        }
    }
}

/// The folded panel: "↑ 2/5 · 31%", "✓ 5 uploaded" or "! 1 failed". Tapping it opens the card again.
private struct VaultUploadPill: View {
    let uploads: VaultUploads

    var body: some View {
        Button { uploads.expanded = true } label: {
            HStack(spacing: 7) {
                Image(systemName: symbol).font(.system(size: 13, weight: .bold)).foregroundStyle(tint)
                Text(label)
                    .font(NXFont.text(13, .bold).monospacedDigit()).foregroundStyle(NX.foreground)
                    .lineLimit(1)
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(NX.border))
            .shadow(color: .black.opacity(0.18), radius: 12, y: 5)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(T("Uploads"))
        .accessibilityValue(label)
        .accessibilityHint(T("Shows the upload panel"))
    }

    private var symbol: String {
        if uploads.isRunning { return "arrow.up" }
        return uploads.failedCount > 0 ? "exclamationmark" : "checkmark"
    }

    private var tint: Color {
        if uploads.isRunning { return NX.violetText }
        return uploads.failedCount > 0 ? NX.danger : NX.success
    }

    private var label: String {
        if uploads.isRunning {
            return "\(uploads.position)/\(uploads.counted.count) · \(Int(uploads.fraction * 100))%"
        }
        if uploads.failedCount > 0 { return String(format: T("%d failed"), uploads.failedCount) }
        return String(format: T("%d uploaded"), uploads.doneCount)
    }
}

/// The app's progress bar shape (a muted capsule under a filled one), for a fraction that is already
/// known — the panel computes its own from bytes, so UploadProgressBar's sampling is not needed.
private struct VaultUploadBar: View {
    let fraction: Double
    let height: CGFloat

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(NX.muted)
                Capsule().fill(NX.violet).frame(width: geo.size.width * max(0, min(1, fraction)))
            }
        }
        .frame(height: height)
        .animation(.linear(duration: 0.1), value: fraction)
    }
}
