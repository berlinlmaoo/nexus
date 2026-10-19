import Foundation

/// Grid metrics stay in logical sheet points. Zoom only changes their presentation.
enum SheetGridZoom {
    static func clamped(_ value: CGFloat) -> CGFloat { value.isFinite ? min(2, max(0.5, value)) : 1 }
    static func anchoredOffset(_ offset: CGFloat, point: CGFloat, from old: CGFloat, to next: CGFloat) -> CGFloat {
        (offset + point) * next / old - point
    }
}
