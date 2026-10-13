import SwiftUI
import UIKit

// Chart ▸ Download (web SheetChart.tsx download("png")): the chart drawn by the same Swift Charts view into a
// PNG at its size on the sheet (ImageRenderer), saved under the chart's title and handed to the system:
// the share sheet on iPhone / iPad (a popover pointing at the chart), a Save panel on the Mac.

@MainActor
enum SPChartExport {
    /// The chart as a PNG file in the temporary folder, named after its title; nil when it can't be drawn.
    static func pngFile(spec: SPChartSpec, data: SheetData, engine: SheetEngine) -> URL? {
        let w = CGFloat(max(SheetChartPlace.minWidth, spec.w))
        let h = CGFloat(max(SheetChartPlace.minHeight, spec.h))
        let content = SPChartView(spec: spec, data: data, engine: engine, forExport: true)
            .frame(width: w, height: h)
            .environment(\.colorScheme, .light)
        let renderer = ImageRenderer(content: content)
        renderer.scale = 2
        guard let image = renderer.uiImage, let png = image.pngData() else { return nil }
        let folder = FileManager.default.temporaryDirectory.appendingPathComponent("chart-" + UUID().uuidString, isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            let url = folder.appendingPathComponent(fileName(spec.title) + ".png")
            try png.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    /// "Q3 / sales" → "Q3   sales" (web: the characters a file name can't hold become spaces).
    static func fileName(_ title: String?) -> String {
        let raw = (title ?? "").isEmpty ? T("Chart") : (title ?? "")
        let bad = CharacterSet(charactersIn: "\\/:*?\"<>|")
        let cleaned = String(raw.unicodeScalars.map { bad.contains($0) ? " " : Character($0) })
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return cleaned.isEmpty ? "chart" : cleaned
    }

    /// Draws the chart and offers the file (share sheet / Save panel). `anchor` = the view the iPad popover
    /// points at (the chart); without one it shows in the middle of the screen.
    static func download(spec: SPChartSpec, data: SheetData, engine: SheetEngine, anchor: UIView?) {
        guard let url = pngFile(spec: spec, data: data, engine: engine), let presenter = topController(anchor) else { return }
        #if targetEnvironment(macCatalyst)
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        presenter.present(picker, animated: true)
        #else
        let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        if let pop = share.popoverPresentationController {
            if let anchor, anchor.window != nil {
                pop.sourceView = anchor
                pop.sourceRect = anchor.bounds
            } else {
                let v: UIView = presenter.view
                pop.sourceView = v
                pop.sourceRect = CGRect(x: v.bounds.midX, y: v.bounds.midY, width: 1, height: 1)
                pop.permittedArrowDirections = []
            }
        }
        presenter.present(share, animated: true)
        #endif
    }

    /// The controller on top (a sheet that is open, else the window's root).
    static func topController(_ anchor: UIView?) -> UIViewController? {
        let window: UIWindow? = anchor?.window ?? UIApplication.shared.connectedScenes
            .compactMap { $0 as? UIWindowScene }
            .flatMap { $0.windows }
            .first { $0.isKeyWindow }
        var top = window?.rootViewController
        while let next = top?.presentedViewController, !next.isBeingDismissed { top = next }
        return top
    }
}

/// Holds the UIKit view behind a SwiftUI view, so a popover can point at it.
@MainActor
final class SPAnchorRef {
    weak var view: UIView?
}

/// Put as a background of the SwiftUI view a popover should point at.
struct SPAnchorView: UIViewRepresentable {
    let ref: SPAnchorRef

    func makeUIView(context: Context) -> UIView {
        let v = UIView()
        v.backgroundColor = .clear
        v.isUserInteractionEnabled = false
        ref.view = v
        return v
    }

    func updateUIView(_ uiView: UIView, context: Context) { ref.view = uiView }
}
