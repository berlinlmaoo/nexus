import SwiftUI
import PDFKit

// ─────────────────────────────────────────────────────────────────────────────
// Print preview and live printer status (owner, 18 Nov 2026).
// Preview: GET /api/print/preview → the exact PDF the print sends; pages drawn lazily as thumbnails (files can
// have 50+ pages), in grayscale for Black & white, pages outside an upload's typed range dimmed; a tap pushes
// the page larger inside the print sheet's own NavigationStack (no second sheet).
// Status: GET /api/print/status every 5 s while on screen and the app is active. "disconnected" (the printer's
// USB cable is out) is said plainly: prints wait on the server and come out once it is connected again.
// ─────────────────────────────────────────────────────────────────────────────

// MARK: - Printer status

/// Polls the printer status while its view is on screen. Each screen owns one; `run()` lives in a `.task`, so it
/// stops when the view goes away.
@MainActor
@Observable
final class PrinterStatusStore {
    private(set) var status: PrinterStatus?
    private(set) var failed: String?

    /// Every 5 s until the task is cancelled.
    func run() async {
        while !Task.isCancelled {
            await refresh()
            try? await Task.sleep(nanoseconds: 5_000_000_000)
        }
    }

    func refresh() async {
        do {
            status = try await APIClient.shared.printerStatus()
            failed = nil
        } catch {
            guard !Task.isCancelled else { return }
            failed = (error as? LocalizedError)?.errorDescription ?? T("Check your connection and try again.")
        }
    }
}

extension View {
    /// Runs the store's poll while the view is on screen AND the app is in the foreground.
    func printerStatusPolling(_ store: PrinterStatusStore) -> some View {
        modifier(PrinterStatusPolling(store: store))
    }
}

private struct PrinterStatusPolling: ViewModifier {
    let store: PrinterStatusStore
    @Environment(\.scenePhase) private var scenePhase
    func body(content: Content) -> some View {
        content.task(id: scenePhase == .active) {
            if scenePhase == .active { await store.run() }
        }
    }
}

/// The sentence for a printer whose cable is out (and for a job the queue marks "stalled").
func printerDisconnectedText() -> String {
    T("The printer isn't connected to the server. Your print comes out as soon as it's connected again.")
}

/// State headline with a coloured dot, the reasons people can act on, who is printing, how many wait.
struct PrinterStatusPanel: View {
    let status: PrinterStatus?
    let failed: String?
    /// The WiFi caveat under the panel (the Print screen); the print sheet leaves it out.
    var showNote = true

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let status {
                HStack(spacing: 8) {
                    Circle().fill(status.tone).frame(width: 9, height: 9).accessibilityHidden(true)
                    Text(status.headline).font(NXFont.text(15, .semibold)).foregroundStyle(NX.foreground)
                    Spacer(minLength: 0)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel(T("Printer status") + ": " + status.headline)
                if status.isDisconnected {
                    Text(printerDisconnectedText())
                        .font(NXFont.text(13)).foregroundStyle(NX.foreground)
                        .fixedSize(horizontal: false, vertical: true)
                } else if status.reachable && !status.acceptingJobs {
                    Text(T("The printer isn't taking prints right now."))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
                ForEach(status.reasons, id: \.self) { r in
                    Label(r.label, systemImage: r.severity == "report" ? "info.circle" : "exclamationmark.triangle.fill")
                        .font(NXFont.text(13))
                        .foregroundStyle(r.severity == "error" ? NX.danger : r.severity == "warning" ? NX.warning : NX.mutedFg)
                }
                if let current = status.current {
                    Text(String(format: T("Printing now: %@"), current.mine && !(current.title ?? "").isEmpty
                                ? current.whoLabel + " · " + (current.title ?? "") : current.whoLabel))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        .lineLimit(2)
                }
                if status.waiting > 0 {
                    Text(String(format: T("%d waiting"), status.waiting))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
            } else if let failed {
                Label(T("Couldn't check the printer"), systemImage: "exclamationmark.triangle")
                    .font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text(failed).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                HStack(spacing: 8) {
                    ProgressView()
                    Text(T("Checking the printer…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                }
            }
            if showNote {
                Text(T("Prints sent straight to the printer over WiFi don't show here."))
                    .font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Preview

/// The previewed PDF for one item.
@MainActor
@Observable
final class PrintPreviewModel {
    private(set) var document: PDFDocument?
    private(set) var loading = false
    private(set) var failed: String?

    func load(kind: PrintKind, id: String) async {
        loading = true
        failed = nil
        defer { loading = false }
        do {
            let data = try await APIClient.shared.printPreview(kind: kind, id: id)
            guard let doc = PDFDocument(data: data) else {
                failed = T("Couldn't load the preview")
                return
            }
            document = doc
        } catch {
            guard !Task.isCancelled else { return }
            failed = (error as? LocalizedError)?.errorDescription ?? T("Couldn't load the preview")
        }
    }
}

/// A horizontal strip of page thumbnails with their numbers. `included` nil = every page prints.
struct PrintPreviewStrip: View {
    let model: PrintPreviewModel
    let included: Set<Int>?
    let mono: Bool
    let onRetry: () -> Void
    let onOpen: (Int) -> Void

    var body: some View {
        if let doc = model.document {
            if doc.pageCount == 0 {
                Text(T("This file has no pages to show.")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 10) {
                        ForEach(0..<doc.pageCount, id: \.self) { i in
                            let prints = included?.contains(i + 1) ?? true
                            Button { onOpen(i) } label: {
                                VStack(spacing: 4) {
                                    PrintPageImage(document: doc, index: i, size: CGSize(width: 84, height: 119), mono: mono)
                                        .frame(width: 84, height: 119)
                                    Text("\(i + 1)").font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                                }
                                .opacity(prints ? 1 : 0.35)
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(String(format: T("Page %d of %d"), i + 1, doc.pageCount) + (prints ? "" : ", " + T("Not printed")))
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        } else if let failed = model.failed {
            VStack(alignment: .leading, spacing: 6) {
                Text(T("Couldn't load the preview")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                Text(failed).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                Button(T("Try again"), action: onRetry).font(NXFont.text(13, .semibold))
            }
        } else {
            HStack(spacing: 8) {
                ProgressView()
                Text(T("Loading the preview…")).font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
            }
            .frame(minHeight: 60)
        }
    }
}

/// One page, rendered on demand at twice its size (a lazy stack only asks for the pages near the screen).
struct PrintPageImage: View {
    let document: PDFDocument
    let index: Int
    let size: CGSize
    let mono: Bool
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            Color.white
            if let image {
                Image(uiImage: image).resizable().scaledToFit().grayscale(mono ? 1 : 0)
            } else {
                ProgressView()
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(NX.border))
        .task(id: index) {
            let scale: CGFloat = 2
            image = document.page(at: index)?.thumbnail(of: CGSize(width: size.width * scale, height: size.height * scale), for: .mediaBox)
        }
    }
}

/// A page larger, swipe for the others. Pushed in the print sheet's NavigationStack.
struct PrintPageLargeView: View {
    let document: PDFDocument
    @State var index: Int
    let mono: Bool
    let included: Set<Int>?

    var body: some View {
        TabView(selection: $index) {
            ForEach(0..<document.pageCount, id: \.self) { i in
                PrintPageImage(document: document, index: i, size: CGSize(width: 600, height: 848), mono: mono)
                    .aspectRatio(210.0 / 297.0, contentMode: .fit)
                    .opacity(included?.contains(i + 1) ?? true ? 1 : 0.35)
                    .padding(16)
                    .tag(i)
            }
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
        .background(NX.muted.ignoresSafeArea())
        .navigationTitle(String(format: T("Page %d of %d"), index + 1, document.pageCount))
        .navigationBarTitleDisplayMode(.inline)
    }
}
