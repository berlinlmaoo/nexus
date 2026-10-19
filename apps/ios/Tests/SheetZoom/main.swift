import Foundation
func close(_ a: CGFloat, _ b: CGFloat) { precondition(abs(a - b) < 0.00001) }
for old: CGFloat in [0.5, 0.8, 1, 2] {
    for next: CGFloat in [0.5, 0.8, 1, 2] {
        for offset: CGFloat in [0, 100, 1400] {
            for point: CGFloat in [0, 120, 300] {
                let moved = SheetGridZoom.anchoredOffset(offset, point: point, from: old, to: next)
                // The logical sheet point under the fingers must not move after a zoom or reset.
                close((offset + point) / old, (moved + point) / next)
                close(SheetGridZoom.anchoredOffset(moved, point: point, from: next, to: old), offset)
                for current: CGFloat in [0, 80, 200] {
                    let translated = SheetGridZoom.anchoredOffset(offset, point: point, from: old, to: next, currentPoint: current)
                    close((offset + point) / old, (translated + current) / next)
                    close(SheetGridZoom.anchoredOffset(translated, point: current, from: next, to: old, currentPoint: point), offset)
                }
            }
        }
    }
}
close(SheetGridZoom.clamped(0.1), 0.5); close(SheetGridZoom.clamped(4), 2)
close(SheetGridZoom.clamped(.nan), 1); close(SheetGridZoom.clamped(.infinity), 1)
print("Sheet zoom anchor, reset round-trip and bounds invariants passed")
