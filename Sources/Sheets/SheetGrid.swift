import SwiftUI
import UIKit

// The spreadsheet grid: a UICollectionView with its own layout (rows = sections, columns = items), column
// letters and row numbers in two strips outside it that follow its scroll, and the selection drawn as views
// over the cells. Cells are reused, so a long sheet scrolls freely in both directions without SwiftUI stacks
// (no lazy stacks in a two-axis scroll; see ios-ui notes). Gestures:
//   tap = select · tap on the selected cell / double tap = edit · ⌘-click = add a range · ⇧-click = extend
//   touch: press and hold, then drag = select a range (release without moving = the cell menu)
//   pointer (iPad trackpad, Mac): drag = select a range · right-click = the cell menu
// Keyboard (iPad keyboard, Mac): arrows (⇧ extends), Tab / Enter, Delete, ⌘C ⌘X ⌘V, ⌘Z ⇧⌘Z, ⌘A, ⌘B ⌘I,
// Esc, and typing starts editing the cell with that character.
//
// Sheets parity (13 Oct 2026):
// - Frozen rows / columns: the layout pins their cells to the visible edge (frame + contentOffset, a
//   bounds-change invalidation limited to the frozen items); the selection is drawn in four clipped panes
//   (corner, frozen rows, frozen columns, the rest) so it never shows through a frozen pane.
// - Merged cells: the anchor cell gets the block's frame, covered cells are not laid out.
// - Long text runs over empty neighbours (left → right, right → left, centred both ways); the gridlines
//   under it are hidden; hit-testing still uses the grid's geometry, so a tap selects the cell under it.
// - Borders (bx / bd) per side with line style and colour; gridlines can be switched off (noGrid).
// - Column / row resize: drag a header edge with the pointer (resize pointer on iPad / Mac), or with a
//   finger the round handle on the edge of selected whole columns / rows.
// - Filter: a funnel on the filter's header row opens its menu.

// MARK: - layout

final class SheetGridLayout: UICollectionViewLayout {
    private(set) var colX: [CGFloat] = [0]
    private(set) var rowY: [CGFloat] = [0]
    private(set) var frozenRows = 0
    private(set) var frozenCols = 0
    private(set) var merges: [SheetRange] = []
    private var anchors: [SheetPos: SheetRange] = [:]
    private var covered: Set<SheetPos> = []
    /// Cells whose text runs over a neighbour draw above it (asked of the host, which measures the text).
    var spills: ((Int, Int) -> Bool)?

    func configure(widths: [CGFloat], heights: [CGFloat], frozenRows fr: Int, frozenCols fc: Int, merges m: [SheetRange]) {
        var x: [CGFloat] = [0]
        x.reserveCapacity(widths.count + 1)
        for w in widths { x.append(x[x.count - 1] + w) }
        var y: [CGFloat] = [0]
        y.reserveCapacity(heights.count + 1)
        for h in heights { y.append(y[y.count - 1] + h) }
        colX = x
        rowY = y
        frozenRows = max(0, min(fr, heights.count))
        frozenCols = max(0, min(fc, widths.count))
        if m != merges {
            merges = m
            var a: [SheetPos: SheetRange] = [:]
            var cov = Set<SheetPos>()
            for r in m {
                a[SheetPos(r: r.top, c: r.left)] = r
                for p in r.positions where !(p.r == r.top && p.c == r.left) { cov.insert(p) }
            }
            anchors = a
            covered = cov
        }
        invalidateLayout()
    }

    var cols: Int { colX.count - 1 }
    var rows: Int { rowY.count - 1 }
    var frozenWidth: CGFloat { colX[frozenCols] }
    var frozenHeight: CGFloat { rowY[frozenRows] }

    override var collectionViewContentSize: CGSize { CGSize(width: colX.last ?? 0, height: rowY.last ?? 0) }

    /// How far the frozen panes are moved to stay on screen (never negative: they follow a bounce).
    var pin: CGPoint {
        guard let cv = collectionView else { return .zero }
        return CGPoint(x: max(0, cv.contentOffset.x), y: max(0, cv.contentOffset.y))
    }

    func frame(row: Int, col: Int) -> CGRect {
        guard row >= 0, row < rows, col >= 0, col < cols else { return .zero }
        return CGRect(x: colX[col], y: rowY[row], width: colX[col + 1] - colX[col], height: rowY[row + 1] - rowY[row])
    }

    /// The frame a cell is drawn in: a merged block's anchor spans the block.
    func cellFrame(row: Int, col: Int) -> CGRect {
        if let m = anchors[SheetPos(r: row, c: col)] { return frame(of: m) }
        return frame(row: row, col: col)
    }

    func frame(of range: SheetRange) -> CGRect {
        frame(row: range.top, col: range.left).union(frame(row: range.bottom, col: range.right))
    }

    func merge(at p: SheetPos) -> SheetRange? { anchors[p] ?? (covered.contains(p) ? merges.first { $0.contains(p) } : nil) }
    func isCovered(_ p: SheetPos) -> Bool { covered.contains(p) }

    /// A content frame where it is on screen (frozen rows / columns pinned).
    func screenFrame(_ f: CGRect, row: Int, col: Int) -> CGRect {
        var g = f
        let p = pin
        if row < frozenRows { g.origin.y += p.y }
        if col < frozenCols { g.origin.x += p.x }
        return g
    }

    /// A point in the collection view to the sheet's own (unpinned) coordinates.
    func contentPoint(_ p: CGPoint) -> CGPoint {
        let o = pin
        var q = p
        if frozenCols > 0, p.x - o.x < frozenWidth { q.x = p.x - o.x }
        if frozenRows > 0, p.y - o.y < frozenHeight { q.y = p.y - o.y }
        return q
    }

    /// The last index whose start is at or before `v` (binary search over the prefix sums).
    private static func index(of v: CGFloat, in starts: [CGFloat]) -> Int {
        let n = starts.count - 1
        guard n > 0 else { return -1 }
        var lo = 0, hi = n - 1
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if starts[mid] <= v { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    /// The cell under a point of the COLLECTION VIEW, clamped to the sheet when asked (a drag past the edge
    /// keeps the last row / column).
    func position(at point: CGPoint, clamp: Bool = false) -> SheetPos? {
        positionInContent(contentPoint(point), clamp: clamp)
    }

    func positionInContent(_ p: CGPoint, clamp: Bool = false) -> SheetPos? {
        guard rows > 0, cols > 0 else { return nil }
        if clamp {
            let x = min(max(p.x, 0), (colX.last ?? 1) - 0.5)
            let y = min(max(p.y, 0), (rowY.last ?? 1) - 0.5)
            return SheetPos(r: Self.index(of: y, in: rowY), c: Self.index(of: x, in: colX))
        }
        guard p.x >= 0, p.y >= 0, p.x < (colX.last ?? 0), p.y < (rowY.last ?? 0) else { return nil }
        return SheetPos(r: Self.index(of: p.y, in: rowY), c: Self.index(of: p.x, in: colX))
    }

    /// Every cell to lay out for a rect of the collection view: the scrolled ones it covers, the frozen ones
    /// (always on screen), and merged blocks reaching into it.
    private func positions(in rect: CGRect) -> [SheetPos] {
        guard rows > 0, cols > 0 else { return [] }
        let r0 = Self.index(of: max(0, rect.minY), in: rowY)
        let r1 = Self.index(of: max(0, rect.maxY), in: rowY)
        let c0 = Self.index(of: max(0, rect.minX), in: colX)
        let c1 = Self.index(of: max(0, rect.maxX), in: colX)
        guard r0 >= 0, c0 >= 0 else { return [] }
        let fr = frozenRows, fc = frozenCols
        let sr0 = max(r0, fr), sc0 = max(c0, fc)
        var out: [SheetPos] = []
        func add(_ r: Int, _ c: Int) {
            let p = SheetPos(r: r, c: c)
            if !covered.contains(p) { out.append(p) }
        }
        if sr0 <= r1, sc0 <= c1 { for r in sr0...r1 { for c in sc0...c1 { add(r, c) } } }
        if fr > 0, sc0 <= c1 { for r in 0..<fr { for c in sc0...c1 { add(r, c) } } }
        if fc > 0, sr0 <= r1 { for r in sr0...r1 { for c in 0..<fc { add(r, c) } } }
        if fr > 0, fc > 0 { for r in 0..<fr { for c in 0..<fc { add(r, c) } } }
        // A merged block whose anchor scrolled out of the rect but whose body is still in it.
        if !merges.isEmpty {
            var have = Set<SheetPos>()
            for p in out where anchors[p] != nil { have.insert(p) }
            for m in merges {
                let a = SheetPos(r: m.top, c: m.left)
                if have.contains(a) { continue }
                if screenFrame(frame(of: m), row: m.top, col: m.left).intersects(rect) { out.append(a) }
            }
        }
        return out
    }

    private func attributes(_ p: SheetPos) -> UICollectionViewLayoutAttributes {
        let a = UICollectionViewLayoutAttributes(forCellWith: IndexPath(item: p.c, section: p.r))
        a.frame = screenFrame(cellFrame(row: p.r, col: p.c), row: p.r, col: p.c)
        var z = 0
        if p.r < frozenRows && p.c < frozenCols { z = 30 } else if p.r < frozenRows || p.c < frozenCols { z = 20 }
        if spills?(p.r, p.c) == true { z += 1 }
        a.zIndex = z
        a.isHidden = covered.contains(p)
        return a
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        positions(in: rect).map { attributes($0) }
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        attributes(SheetPos(r: indexPath.section, c: indexPath.item))
    }

    /// Scrolling moves the frozen cells: only they are laid out again.
    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool {
        guard frozenRows > 0 || frozenCols > 0, let cv = collectionView else { return false }
        return newBounds.origin != cv.bounds.origin || newBounds.size != cv.bounds.size
    }

    override func invalidationContext(forBoundsChange newBounds: CGRect) -> UICollectionViewLayoutInvalidationContext {
        let ctx = super.invalidationContext(forBoundsChange: newBounds)
        let frozen = positions(in: newBounds).filter { $0.r < frozenRows || $0.c < frozenCols }
        if !frozen.isEmpty { ctx.invalidateItems(at: frozen.map { IndexPath(item: $0.c, section: $0.r) }) }
        return ctx
    }
}

// MARK: - cell

final class SheetGridCell: UICollectionViewCell {
    static let reuseId = "sheet-cell"

    private let label = UILabel()
    private let chip = UILabel()
    private let check = UIImageView()
    private let funnel = UIImageView()
    private let lines = CAShapeLayer()
    private let flag = CAShapeLayer()
    private let note = CAShapeLayer()
    private var edges: [CAShapeLayer] = []
    private var borders = SheetGridStyle.Borders()
    private var extent = SheetSpill.Extent()
    private var hideRightLine = false

    override init(frame: CGRect) {
        super.init(frame: frame)
        contentView.clipsToBounds = true
        label.numberOfLines = 1
        label.lineBreakMode = .byClipping
        contentView.addSubview(label)
        chip.font = .systemFont(ofSize: 12, weight: .medium)
        chip.layer.cornerRadius = 9
        chip.layer.masksToBounds = true
        chip.textAlignment = .center
        contentView.addSubview(chip)
        check.contentMode = .scaleAspectFit
        contentView.addSubview(check)
        funnel.contentMode = .scaleAspectFit
        funnel.isHidden = true
        addSubview(funnel)
        lines.fillColor = nil
        lines.lineWidth = 0.5
        layer.addSublayer(lines)
        for _ in 0..<4 {
            let e = CAShapeLayer()
            e.fillColor = nil
            e.isHidden = true
            layer.addSublayer(e)
            edges.append(e)
        }
        flag.fillColor = UIColor.systemRed.cgColor
        layer.addSublayer(flag)
        note.fillColor = UIColor.systemOrange.cgColor
        layer.addSublayer(note)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// `extent`: how far the text runs over neighbours; `frozen`: drawn opaque over the scrolled cells.
    func show(_ d: SheetCellDisplay, gridColor: UIColor, extent: SheetSpill.Extent, hideRightLine: Bool, frozen: Bool) {
        backgroundColor = frozen ? UIColor(NX.card) : nil
        contentView.backgroundColor = d.fill
        let size = d.fontSize ?? 13
        var font = UIFont.systemFont(ofSize: size, weight: d.bold ? .semibold : .regular)
        if d.italic, let desc = font.fontDescriptor.withSymbolicTraits(.traitItalic) { font = UIFont(descriptor: desc, size: size) }
        var attrs: [NSAttributedString.Key: Any] = [.font: font]
        let color: UIColor = d.isError ? .systemRed : (d.isLink ? .link : (d.textColor ?? .label))
        attrs[.foregroundColor] = color
        if d.strike { attrs[.strikethroughStyle] = NSUnderlineStyle.single.rawValue }
        if d.underline || d.isLink { attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue }
        label.attributedText = NSAttributedString(string: d.text, attributes: attrs)
        label.textAlignment = d.alignment
        label.numberOfLines = d.wrap ? 0 : 1
        label.lineBreakMode = d.wrap ? .byWordWrapping : .byClipping
        label.isHidden = d.checkbox != nil || !d.chips.isEmpty

        if let first = d.chips.first {
            chip.isHidden = false
            chip.text = " " + d.chips.map(\.text).joined(separator: ", ") + " "
            chip.backgroundColor = first.background
            chip.textColor = first.foreground
        } else {
            chip.isHidden = true
        }
        if let on = d.checkbox {
            check.isHidden = false
            check.image = UIImage(systemName: on ? "checkmark.square.fill" : "square")
            check.tintColor = on ? UIColor(NX.violet) : .tertiaryLabel
        } else {
            check.isHidden = true
        }
        if let active = d.filterHead {
            funnel.isHidden = false
            funnel.image = UIImage(systemName: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
            funnel.tintColor = active ? UIColor(NX.violet) : .secondaryLabel
        } else {
            funnel.isHidden = true
        }
        flag.isHidden = !d.invalid
        note.isHidden = !d.commented
        lines.strokeColor = gridColor.cgColor
        verticalAlign = d.verticalAlign
        borders = d.borders
        self.extent = extent
        self.hideRightLine = hideRightLine
        contentView.clipsToBounds = extent.left == 0 && extent.right == 0
        setNeedsLayout()
    }

    private var verticalAlign = 2

    override func prepareForReuse() {
        super.prepareForReuse()
        extent = SheetSpill.Extent()
        contentView.clipsToBounds = true
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        var b = contentView.bounds.insetBy(dx: 5, dy: 2)
        if !funnel.isHidden { b.size.width = max(0, b.width - 20) }
        // Overflowing text: the label runs over the empty neighbours (their lines are hidden by the host).
        let lx = b.minX - CGFloat(extent.left)
        let lw = b.width + CGFloat(extent.left + extent.right)
        if label.numberOfLines == 1 {
            let h = min(b.height, label.font.lineHeight + 2)
            let y: CGFloat
            switch verticalAlign {
            case 0: y = b.minY
            case 1: y = b.midY - h / 2
            default: y = b.maxY - h
            }
            label.frame = CGRect(x: lx, y: y, width: lw, height: h)
        } else {
            label.frame = b
        }
        let chipSize = chip.sizeThatFits(CGSize(width: b.width, height: 18))
        chip.frame = CGRect(x: b.minX, y: b.midY - 9, width: min(b.width, chipSize.width), height: 18)
        check.frame = CGRect(x: contentView.bounds.midX - 8, y: contentView.bounds.midY - 8, width: 16, height: 16)
        funnel.frame = CGRect(x: bounds.width - 21, y: bounds.midY - 8, width: 16, height: 16)
        let w = bounds.width, h = bounds.height
        let path = UIBezierPath()
        if hideRightLine {
            path.move(to: CGPoint(x: w, y: h - 0.25))
            path.addLine(to: CGPoint(x: 0, y: h - 0.25))
        } else {
            path.move(to: CGPoint(x: w - 0.25, y: 0))
            path.addLine(to: CGPoint(x: w - 0.25, y: h - 0.25))
            path.addLine(to: CGPoint(x: 0, y: h - 0.25))
        }
        lines.path = path.cgPath
        let t = UIBezierPath()
        t.move(to: CGPoint(x: w - 7, y: 0))
        t.addLine(to: CGPoint(x: w, y: 0))
        t.addLine(to: CGPoint(x: w, y: 7))
        t.close()
        flag.path = t.cgPath
        note.path = t.cgPath
        layoutBorders()
    }

    /// The cell's own borders, drawn inside its edges (Sheets: thin 1, medium 2, thick 3, dotted, dashed,
    /// double), in their colour or the text colour.
    private func layoutBorders() {
        let w = bounds.width, h = bounds.height
        let sides: [(SheetGridStyle.Edge?, Int)] = [(borders.t, 0), (borders.b, 1), (borders.l, 2), (borders.r, 3)]
        for (edge, i) in sides {
            let layer = edges[i]
            guard let edge else { layer.isHidden = true; continue }
            layer.isHidden = false
            let width: CGFloat = edge.s == "medium" ? 2 : (edge.s == "thick" ? 3 : 1)
            layer.lineWidth = width
            layer.lineDashPattern = edge.s == "dotted" ? [1, 2] : (edge.s == "dashed" ? [4, 2] : nil)
            let color = edge.c.flatMap { SheetBridge.hexColor($0) } ?? UIColor.label
            layer.strokeColor = color.resolvedColor(with: traitCollection).cgColor
            let inset = edge.s == "double" ? 0.5 : width / 2
            let p = UIBezierPath()
            func line(_ a: CGPoint, _ b: CGPoint) { p.move(to: a); p.addLine(to: b) }
            switch i {
            case 0:
                line(CGPoint(x: 0, y: inset), CGPoint(x: w, y: inset))
                if edge.s == "double" { line(CGPoint(x: 0, y: 2.5), CGPoint(x: w, y: 2.5)) }
            case 1:
                line(CGPoint(x: 0, y: h - inset), CGPoint(x: w, y: h - inset))
                if edge.s == "double" { line(CGPoint(x: 0, y: h - 2.5), CGPoint(x: w, y: h - 2.5)) }
            case 2:
                line(CGPoint(x: inset, y: 0), CGPoint(x: inset, y: h))
                if edge.s == "double" { line(CGPoint(x: 2.5, y: 0), CGPoint(x: 2.5, y: h)) }
            default:
                line(CGPoint(x: w - inset, y: 0), CGPoint(x: w - inset, y: h))
                if edge.s == "double" { line(CGPoint(x: w - 2.5, y: 0), CGPoint(x: w - 2.5, y: h)) }
            }
            layer.path = p.cgPath
        }
    }
}

// MARK: - header strips

/// Column letters (horizontal) or row numbers (vertical), drawn for the visible part only and moved with
/// the grid's scroll; frozen ones stay put. The selected rows / columns are tinted, like Sheets. Edges can
/// be dragged to resize (pointer anywhere on an edge, a finger on the handle of selected whole columns /
/// rows), and small arrows mark hidden rows / columns (tap them to show them again).
final class SheetHeaderStrip: UIView, UIGestureRecognizerDelegate {
    enum Axis { case columns, rows }
    let axis: Axis
    var starts: [CGFloat] = [0]
    var labels: (Int) -> String = { _ in "" }
    var offset: CGFloat = 0 { didSet { if offset != oldValue { setNeedsDisplay() } } }
    var pin: CGFloat = 0
    var frozen = 0
    var highlighted: ClosedRange<Int>?
    /// Visible indices with hidden rows / columns just before them (count = after the last).
    var markers: Set<Int> = []
    var resizable = false
    /// Whole columns / rows selected: a touch handle sits on the edge of the last one.
    var handleRange: ClosedRange<Int>?
    var onTap: ((Int, Bool) -> Void)?
    var onUnhide: ((Int) -> Void)?
    /// (index, new size, finished)
    var onResize: ((Int, CGFloat, Bool) -> Void)?
    var onResizeCancel: (() -> Void)?

    private var resizeIndex: Int?
    private var resizeStart: CGFloat = 0
    private var resizeOrigin: CGFloat = 0

    init(axis: Axis) {
        self.axis = axis
        super.init(frame: .zero)
        backgroundColor = UIColor(NX.muted)
        contentMode = .redraw
        isOpaque = true
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        addGestureRecognizer(tap)
        let pan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:)))
        pan.delegate = self
        pan.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue),
                                 NSNumber(value: UITouch.TouchType.indirectPointer.rawValue)]
        addGestureRecognizer(pan)
        // iPad pointer only; on the Mac (Catalyst) the plain arrow stays.
        #if !targetEnvironment(macCatalyst)
        addInteraction(UIPointerInteraction(delegate: self))
        #endif
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    private var count: Int { max(0, starts.count - 1) }
    private var frozenExtent: CGFloat { starts[min(frozen, count)] }

    private func along(_ p: CGPoint) -> CGFloat { axis == .columns ? p.x : p.y }

    /// Where index i starts / ends on screen.
    private func screenStart(_ i: Int) -> CGFloat { starts[i] - offset + (i < frozen ? pin : 0) }
    private func screenEnd(_ i: Int) -> CGFloat { starts[i + 1] - offset + (i < frozen ? pin : 0) }

    func index(at p: CGPoint) -> Int? {
        let s = along(p)
        let v = frozen > 0 && s < frozenExtent - offset + pin ? s + offset - pin : s + offset
        guard starts.count > 1, v >= 0, v < (starts.last ?? 0) else { return nil }
        var lo = 0, hi = starts.count - 2
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if starts[mid] <= v { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    /// The index whose END edge is within `tolerance` of the point.
    private func edge(at p: CGPoint, tolerance: CGFloat) -> Int? {
        guard let i = index(at: p) ?? (count > 0 ? count - 1 : nil) else { return nil }
        let s = along(p)
        if abs(s - screenEnd(i)) <= tolerance { return i }
        if i > 0, abs(s - screenStart(i)) <= tolerance { return i - 1 }
        return nil
    }

    /// A finger on the handle of the selected whole columns / rows.
    private func handleHit(_ p: CGPoint) -> Int? {
        guard let r = handleRange, r.upperBound < count else { return nil }
        let e = screenEnd(r.upperBound)
        let cross = axis == .columns ? p.y : p.x
        let mid = (axis == .columns ? bounds.height : bounds.width) / 2
        return abs(along(p) - e) <= 22 && abs(cross - mid) <= 22 ? r.upperBound : nil
    }

    private func markerHit(_ p: CGPoint) -> Int? {
        let s = along(p)
        for m in markers {
            let at = m < count ? screenStart(m) : (count > 0 ? screenEnd(count - 1) : 0)
            if abs(s - at) <= 9 { return m }
        }
        return nil
    }

    @objc private func tapped(_ g: UITapGestureRecognizer) {
        let p = g.location(in: self)
        if let m = markerHit(p) { onUnhide?(m); return }
        guard let i = index(at: p) else { return }
        onTap?(i, g.modifierFlags.contains(.shift))
    }

    private var lastTouchType: UITouch.TouchType = .direct

    func gestureRecognizer(_ g: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        lastTouchType = touch.type
        return true
    }

    /// The resize pan starts only on an edge: any edge with the pointer (and on the Mac), the handle with a finger.
    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        // Only this strip's own resize pan; anything else (a sheet's swipe-down, a navigation pan) is UIKit's call.
        guard let pan = g as? UIPanGestureRecognizer, pan.view === self else { return super.gestureRecognizerShouldBegin(g) }
        guard resizable else { return false }
        let now = pan.location(in: self), t = pan.translation(in: self)
        let p = CGPoint(x: now.x - t.x, y: now.y - t.y)
        let pointer = lastTouchType == .indirectPointer || traitCollection.userInterfaceIdiom == .mac
        if pointer, let i = edge(at: p, tolerance: 5) { resizeIndex = i; return true }
        if let i = handleHit(p) { resizeIndex = i; return true }
        return false
    }

    @objc private func panned(_ g: UIPanGestureRecognizer) {
        guard let i = resizeIndex else { return }
        switch g.state {
        case .began:
            resizeOrigin = along(g.location(in: self))
            resizeStart = starts[i + 1] - starts[i]
        case .changed, .ended:
            let size = max(axis == .columns ? 30 : 20, min(axis == .columns ? 600 : 400, resizeStart + along(g.location(in: self)) - resizeOrigin))
            onResize?(i, size, g.state == .ended)
            if g.state == .ended { resizeIndex = nil }
        default:
            onResizeCancel?()
            resizeIndex = nil
        }
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext(), starts.count > 1 else { return }
        let line = UIColor(NX.border)
        let fg = UIColor(NX.mutedFg)
        let font = UIFont.systemFont(ofSize: 11, weight: .medium)
        let para = NSMutableParagraphStyle()
        para.alignment = .center
        ctx.setLineWidth(1 / max(1, traitCollection.displayScale))
        let edgeOfFrozen = frozenExtent - offset + pin
        // Scrolled ones first, clipped to the area right of / below the frozen ones; then the frozen ones.
        ctx.saveGState()
        if frozen > 0 {
            ctx.clip(to: axis == .columns
                     ? CGRect(x: edgeOfFrozen, y: 0, width: max(0, bounds.width - edgeOfFrozen), height: bounds.height)
                     : CGRect(x: 0, y: edgeOfFrozen, width: bounds.width, height: max(0, bounds.height - edgeOfFrozen)))
        }
        drawRange(ctx, from: frozen, line: line, fg: fg, font: font, para: para)
        ctx.restoreGState()
        if frozen > 0 { drawRange(ctx, from: 0, upTo: frozen, line: line, fg: fg, font: font, para: para) }
        ctx.setStrokeColor(line.cgColor)
        if axis == .columns {
            ctx.move(to: CGPoint(x: 0, y: bounds.height - 0.25)); ctx.addLine(to: CGPoint(x: bounds.width, y: bounds.height - 0.25))
        } else {
            ctx.move(to: CGPoint(x: bounds.width - 0.25, y: 0)); ctx.addLine(to: CGPoint(x: bounds.width - 0.25, y: bounds.height))
        }
        ctx.strokePath()
        if frozen > 0 {
            // Sheets' grey freeze bar.
            ctx.setFillColor(UIColor.systemGray3.cgColor)
            ctx.fill(axis == .columns ? CGRect(x: edgeOfFrozen - 1.5, y: 0, width: 3, height: bounds.height)
                                      : CGRect(x: 0, y: edgeOfFrozen - 1.5, width: bounds.width, height: 3))
        }
        drawMarkers(ctx)
        drawHandle(ctx)
    }

    private func drawRange(_ ctx: CGContext, from: Int, upTo: Int? = nil, line: UIColor, fg: UIColor, font: UIFont, para: NSParagraphStyle) {
        let end = upTo ?? count
        guard from < end else { return }
        let lo: CGFloat = 0, hi = axis == .columns ? bounds.width : bounds.height
        for i in from..<end {
            let a = screenStart(i), b = screenEnd(i)
            if b < lo { continue }
            if a > hi { break }
            let cell = axis == .columns
                ? CGRect(x: a, y: 0, width: b - a, height: bounds.height)
                : CGRect(x: 0, y: a, width: bounds.width, height: b - a)
            let on = highlighted?.contains(i) ?? false
            ctx.setFillColor((on ? UIColor(NX.violet).withAlphaComponent(0.16) : UIColor(NX.muted)).cgColor)
            ctx.fill(cell)
            ctx.setStrokeColor(line.cgColor)
            if axis == .columns {
                ctx.move(to: CGPoint(x: cell.maxX - 0.25, y: 0)); ctx.addLine(to: CGPoint(x: cell.maxX - 0.25, y: bounds.height))
            } else {
                ctx.move(to: CGPoint(x: 0, y: cell.maxY - 0.25)); ctx.addLine(to: CGPoint(x: bounds.width, y: cell.maxY - 0.25))
            }
            ctx.strokePath()
            let text = labels(i) as NSString
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: on ? UIColor.label : fg, .paragraphStyle: para]
            let h = font.lineHeight
            text.draw(in: CGRect(x: cell.minX, y: cell.midY - h / 2, width: cell.width, height: h), withAttributes: attrs)
        }
    }

    /// ◂▸ where rows / columns are hidden.
    private func drawMarkers(_ ctx: CGContext) {
        guard !markers.isEmpty else { return }
        ctx.setFillColor(UIColor(NX.mutedFg).cgColor)
        for m in markers {
            let at = m < count ? screenStart(m) : (count > 0 ? screenEnd(count - 1) : 0)
            let c = axis == .columns ? CGPoint(x: at, y: bounds.height / 2) : CGPoint(x: bounds.width / 2, y: at)
            let s: CGFloat = 3.5
            let p = UIBezierPath()
            if axis == .columns {
                p.move(to: CGPoint(x: c.x - 1, y: c.y - s)); p.addLine(to: CGPoint(x: c.x - 1 - s, y: c.y)); p.addLine(to: CGPoint(x: c.x - 1, y: c.y + s)); p.close()
                p.move(to: CGPoint(x: c.x + 1, y: c.y - s)); p.addLine(to: CGPoint(x: c.x + 1 + s, y: c.y)); p.addLine(to: CGPoint(x: c.x + 1, y: c.y + s)); p.close()
            } else {
                p.move(to: CGPoint(x: c.x - s, y: c.y - 1)); p.addLine(to: CGPoint(x: c.x, y: c.y - 1 - s)); p.addLine(to: CGPoint(x: c.x + s, y: c.y - 1)); p.close()
                p.move(to: CGPoint(x: c.x - s, y: c.y + 1)); p.addLine(to: CGPoint(x: c.x, y: c.y + 1 + s)); p.addLine(to: CGPoint(x: c.x + s, y: c.y + 1)); p.close()
            }
            ctx.addPath(p.cgPath)
            ctx.fillPath()
        }
    }

    /// The touch resize handle: a violet dot on the edge of the selected whole columns / rows.
    private func drawHandle(_ ctx: CGContext) {
        guard resizable, let r = handleRange, r.upperBound < count, traitCollection.userInterfaceIdiom != .mac else { return }
        let e = screenEnd(r.upperBound)
        let c = axis == .columns ? CGPoint(x: e, y: bounds.height / 2) : CGPoint(x: bounds.width / 2, y: e)
        let d: CGFloat = 12
        ctx.setFillColor(UIColor(NX.violet).cgColor)
        ctx.fillEllipse(in: CGRect(x: c.x - d / 2, y: c.y - d / 2, width: d, height: d))
        ctx.setFillColor(UIColor.white.cgColor)
        ctx.fillEllipse(in: CGRect(x: c.x - 2, y: c.y - 2, width: 4, height: 4))
    }
}

// MARK: - selection panes

/// One quarter of the screen (frozen corner, frozen rows, frozen columns, the rest) holding the selection
/// drawn in sheet coordinates, clipped to that quarter: its bounds origin is where the quarter's top-left
/// is in the sheet, so a frozen pane never shows the selection of cells scrolled under it.
private final class SelectionPane: UIView {
    var rangeViews: [UIView] = []
    let activeView = UIView()

    override init(frame: CGRect) {
        super.init(frame: frame)
        clipsToBounds = true
        isUserInteractionEnabled = false
        backgroundColor = .clear
        activeView.layer.borderColor = UIColor(NX.violet).cgColor
        activeView.layer.borderWidth = 2
        activeView.isUserInteractionEnabled = false
        addSubview(activeView)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(ranges: [CGRect], active: CGRect) {
        while rangeViews.count < ranges.count {
            let v = UIView()
            v.isUserInteractionEnabled = false
            v.backgroundColor = UIColor(NX.violet).withAlphaComponent(0.10)
            v.layer.borderColor = UIColor(NX.violet).withAlphaComponent(0.7).cgColor
            v.layer.borderWidth = 1
            insertSubview(v, belowSubview: activeView)
            rangeViews.append(v)
        }
        for (i, v) in rangeViews.enumerated() {
            if i < ranges.count { v.isHidden = false; v.frame = ranges[i] } else { v.isHidden = true }
        }
        activeView.frame = active
    }
}

// MARK: - host view

/// What the grid draws, from the store.
struct SheetGridInput {
    var rows = 0
    var cols = 0
    var widths: [CGFloat] = []
    var heights: [CGFloat] = []
    var frozenRows = 0
    var frozenCols = 0
    var merges: [SheetRange] = []
    var showGrid = true
    var canEdit = false
    var rowMarkers: Set<Int> = []
    var colMarkers: Set<Int> = []
}

/// What the grid asks of its owner. The store answers through the SwiftUI wrapper's coordinator.
@MainActor
protocol SheetGridDelegate: AnyObject {
    func gridTap(_ p: SheetPos, extend: Bool, add: Bool)
    func gridEdit(_ p: SheetPos)
    func gridDragBegan(_ p: SheetPos)
    func gridDragMoved(_ p: SheetPos)
    func gridType(_ text: String)
    func gridKey(_ key: SheetGridKey)
    func gridMenu(for p: SheetPos) -> UIMenu?
    func gridColumnTap(_ c: Int, extend: Bool)
    func gridRowTap(_ r: Int, extend: Bool)
    func gridDisplay(_ p: SheetPos) -> SheetCellDisplay
    func gridResizeColumns(_ cols: [Int], width: CGFloat)
    func gridResizeRows(_ rows: [Int], height: CGFloat)
    func gridFilterMenu(_ c: Int)
    func gridUnhideRows(before r: Int)
    func gridUnhideColumns(before c: Int)
    /// The formula bar has the keyboard: taps on the grid must not take it away.
    var gridIsEditing: Bool { get }
}

enum SheetGridKey {
    case move(dr: Int, dc: Int, extend: Bool)
    case jump(dr: Int, dc: Int, extend: Bool)
    case tab(back: Bool), enter(back: Bool), delete, escape, copy, cut, paste, undo, redo, selectAll, bold, italic, editCell
}

final class SheetGridHost: UIView, UICollectionViewDataSource, UICollectionViewDelegate, UIEditMenuInteractionDelegate {
    weak var delegate: SheetGridDelegate?

    let layout = SheetGridLayout()
    private(set) var collection: UICollectionView!
    private let columnStrip = SheetHeaderStrip(axis: .columns)
    private let rowStrip = SheetHeaderStrip(axis: .rows)
    private let corner = UIView()
    private var panes: [SelectionPane] = []
    private let freezeBarH = UIView()
    private let freezeBarV = UIView()
    private var editMenu: UIEditMenuInteraction?
    private var menuPos: SheetPos?
    private var dragMoved = false

    private var input = SheetGridInput()
    private var selection = SheetSelection()
    private var gridColor = UIColor(NX.border)
    /// Live widths / heights while an edge is dragged (saved when the drag ends).
    private var widthOverride: [Int: CGFloat] = [:]
    private var heightOverride: [Int: CGFloat] = [:]
    /// Per-row displays and overflow, rebuilt with every reload.
    private var rowDisplays: [Int: [SheetCellDisplay]] = [:]
    private var rowSpills: [Int: (extents: [SheetSpill.Extent], hide: [Bool])] = [:]

    static let headerHeight: CGFloat = 24
    static let gutterWidth: CGFloat = 44

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(NX.card)
        collection = UICollectionView(frame: .zero, collectionViewLayout: layout)
        collection.backgroundColor = UIColor(NX.card)
        collection.dataSource = self
        collection.delegate = self
        collection.register(SheetGridCell.self, forCellWithReuseIdentifier: SheetGridCell.reuseId)
        collection.showsHorizontalScrollIndicator = true
        collection.showsVerticalScrollIndicator = true
        collection.alwaysBounceHorizontal = true
        collection.alwaysBounceVertical = true
        collection.isDirectionalLockEnabled = false
        collection.allowsSelection = false
        collection.contentInsetAdjustmentBehavior = .never
        // A pointer drag selects a range; only fingers pan the grid (wheel and trackpad scrolling still do).
        #if targetEnvironment(macCatalyst)
        // On the Mac a click-drag is never a pan: the scroll wheel / trackpad scroll the grid.
        collection.panGestureRecognizer.allowedTouchTypes = []
        #else
        collection.panGestureRecognizer.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        #endif
        addSubview(collection)
        corner.backgroundColor = UIColor(NX.muted)
        addSubview(columnStrip)
        addSubview(rowStrip)
        addSubview(corner)

        for _ in 0..<4 {
            let p = SelectionPane(frame: .zero)
            p.layer.zPosition = 100
            collection.addSubview(p)
            panes.append(p)
        }
        for bar in [freezeBarH, freezeBarV] {
            bar.backgroundColor = .systemGray3
            bar.isUserInteractionEnabled = false
            bar.layer.zPosition = 101
            bar.isHidden = true
            collection.addSubview(bar)
        }
        layout.spills = { [weak self] r, c in self?.spills(r, c) ?? false }

        columnStrip.labels = { SheetA1.letters($0) }
        rowStrip.labels = { "\($0 + 1)" }
        columnStrip.onTap = { [weak self] i, ext in self?.delegate?.gridColumnTap(i, extend: ext) }
        rowStrip.onTap = { [weak self] i, ext in self?.delegate?.gridRowTap(i, extend: ext) }
        columnStrip.onUnhide = { [weak self] i in self?.delegate?.gridUnhideColumns(before: i) }
        rowStrip.onUnhide = { [weak self] i in self?.delegate?.gridUnhideRows(before: i) }
        columnStrip.onResize = { [weak self] i, size, done in self?.resizeColumn(i, size, done) }
        rowStrip.onResize = { [weak self] i, size, done in self?.resizeRow(i, size, done) }
        let cancel: () -> Void = { [weak self] in
            guard let self else { return }
            self.widthOverride = [:]
            self.heightOverride = [:]
            self.applyGeometry()
            self.drawSelection()
        }
        columnStrip.onResizeCancel = cancel
        rowStrip.onResizeCancel = cancel

        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        collection.addGestureRecognizer(tap)
        let double = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        double.numberOfTapsRequired = 2
        collection.addGestureRecognizer(double)
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
        hold.minimumPressDuration = 0.4
        hold.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        collection.addGestureRecognizer(hold)
        let pointerDrag = UIPanGestureRecognizer(target: self, action: #selector(pointerDragged(_:)))
        #if targetEnvironment(macCatalyst)
        // However the Mac reports a click (pointer or direct), a click-drag selects a range.
        pointerDrag.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirectPointer.rawValue),
                                         NSNumber(value: UITouch.TouchType.direct.rawValue)]
        #else
        pointerDrag.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirectPointer.rawValue)]
        #endif
        collection.addGestureRecognizer(pointerDrag)
        let secondary = UITapGestureRecognizer(target: self, action: #selector(secondaryClicked(_:)))
        secondary.buttonMaskRequired = .secondary
        collection.addGestureRecognizer(secondary)

        let menu = UIEditMenuInteraction(delegate: self)
        collection.addInteraction(menu)
        editMenu = menu
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    // MARK: data

    /// Everything from the store: sizes, frozen panes, merges, contents and the selection.
    func reload(_ next: SheetGridInput, selection: SheetSelection) {
        input = next
        gridColor = next.showGrid ? UIColor(NX.border) : .clear
        rowDisplays = [:]
        rowSpills = [:]
        applyGeometry()
        columnStrip.resizable = next.canEdit
        rowStrip.resizable = next.canEdit
        columnStrip.markers = next.colMarkers
        rowStrip.markers = next.rowMarkers
        collection.reloadData()
        setSelection(selection)
        updatePanes()
        columnStrip.setNeedsDisplay()
        rowStrip.setNeedsDisplay()
    }

    /// Sizes (with any edge being dragged) into the layout and the strips.
    private func applyGeometry() {
        var widths = input.widths
        for (i, w) in widthOverride where widths.indices.contains(i) { widths[i] = w }
        var heights = input.heights
        for (i, h) in heightOverride where heights.indices.contains(i) { heights[i] = h }
        layout.configure(widths: widths, heights: heights, frozenRows: input.frozenRows, frozenCols: input.frozenCols, merges: input.merges)
        columnStrip.starts = layout.colX
        rowStrip.starts = layout.rowY
        columnStrip.frozen = layout.frozenCols
        rowStrip.frozen = layout.frozenRows
        columnStrip.setNeedsDisplay()
        rowStrip.setNeedsDisplay()
    }

    func setSelection(_ s: SheetSelection) {
        let moved = s.active != selection.active
        selection = s
        drawSelection()
        if moved { scrollToVisible(s.active) }
    }

    private func drawSelection() {
        guard input.rows > 0, input.cols > 0 else {
            panes.forEach { $0.isHidden = true }
            return
        }
        let multi = selection.ranges.count > 1
        // A single cell (or a merged block selected on its own) shows only the active border.
        var rangeFrames: [CGRect] = []
        for r in selection.ranges {
            let lone = r.isSingle || layout.merge(at: r.a) == r
            if !lone || multi { rangeFrames.append(layout.frame(of: r)) }
        }
        let active = layout.cellFrame(row: selection.active.r, col: selection.active.c).insetBy(dx: -1, dy: -1)
        for p in panes { p.show(ranges: rangeFrames, active: active) }
        let cur = selection.current
        columnStrip.highlighted = cur.left...cur.right
        rowStrip.highlighted = cur.top...cur.bottom
        // Whole columns / rows selected: the touch resize handle sits on their edge.
        let wholeCols = cur.top == 0 && cur.bottom == input.rows - 1
        let wholeRows = cur.left == 0 && cur.right == input.cols - 1
        columnStrip.handleRange = wholeCols && !(wholeRows && input.rows > 1) ? cur.left...cur.right : nil
        rowStrip.handleRange = wholeRows && !(wholeCols && input.cols > 1) ? cur.top...cur.bottom : nil
        columnStrip.setNeedsDisplay()
        rowStrip.setNeedsDisplay()
        updatePanes()
    }

    /// The four selection panes and the freeze bars follow the scroll.
    private func updatePanes() {
        let off = collection.contentOffset
        let pin = layout.pin
        let size = collection.bounds.size
        let fw = layout.frozenWidth, fh = layout.frozenHeight
        let right = off.x + size.width, bottom = off.y + size.height
        let mainX = pin.x + fw, mainY = pin.y + fh
        // corner, frozen rows, frozen columns, main
        let frames: [CGRect] = [
            CGRect(x: pin.x, y: pin.y, width: fw, height: fh),
            CGRect(x: mainX, y: pin.y, width: max(0, right - mainX), height: fh),
            CGRect(x: pin.x, y: mainY, width: fw, height: max(0, bottom - mainY)),
            CGRect(x: mainX, y: mainY, width: max(0, right - mainX), height: max(0, bottom - mainY)),
        ]
        let origins: [CGPoint] = [CGPoint(x: 0, y: 0), CGPoint(x: mainX, y: 0), CGPoint(x: 0, y: mainY), CGPoint(x: mainX, y: mainY)]
        let hasData = input.rows > 0 && input.cols > 0
        for (i, p) in panes.enumerated() {
            p.frame = frames[i]
            p.bounds.origin = origins[i]
            p.isHidden = !hasData || frames[i].width <= 0 || frames[i].height <= 0
        }
        freezeBarV.isHidden = layout.frozenCols == 0
        freezeBarV.frame = CGRect(x: pin.x + fw - 1.5, y: off.y, width: 3, height: size.height)
        freezeBarH.isHidden = layout.frozenRows == 0
        freezeBarH.frame = CGRect(x: off.x, y: pin.y + fh - 1.5, width: size.width, height: 3)
    }

    /// Brings a cell into view past the frozen panes (frozen cells are always in view on that axis).
    func scrollToVisible(_ p: SheetPos) {
        let f = layout.cellFrame(row: p.r, col: p.c)
        guard f != .zero else { return }
        var off = collection.contentOffset
        let size = collection.bounds.size
        if p.c >= layout.frozenCols {
            if f.maxX > off.x + size.width { off.x = f.maxX - size.width }
            if f.minX < off.x + layout.frozenWidth { off.x = f.minX - layout.frozenWidth }
        }
        if p.r >= layout.frozenRows {
            if f.maxY > off.y + size.height { off.y = f.maxY - size.height }
            if f.minY < off.y + layout.frozenHeight { off.y = f.minY - layout.frozenHeight }
        }
        off.x = min(max(0, off.x), max(0, collection.contentSize.width - size.width))
        off.y = min(max(0, off.y), max(0, collection.contentSize.height - size.height))
        if off != collection.contentOffset { collection.setContentOffset(off, animated: false) }
    }

    func refreshVisibleCells() {
        rowDisplays = [:]
        rowSpills = [:]
        for case let cell as SheetGridCell in collection.visibleCells {
            guard let ip = collection.indexPath(for: cell) else { continue }
            configure(cell, SheetPos(r: ip.section, c: ip.item))
        }
    }

    // MARK: displays + overflow

    private func displays(row r: Int) -> [SheetCellDisplay] {
        if let d = rowDisplays[r] { return d }
        var list: [SheetCellDisplay] = []
        list.reserveCapacity(input.cols)
        for c in 0..<input.cols { list.append(delegate?.gridDisplay(SheetPos(r: r, c: c)) ?? SheetCellDisplay()) }
        rowDisplays[r] = list
        return list
    }

    private func cellDisplay(_ p: SheetPos) -> SheetCellDisplay {
        let row = displays(row: p.r)
        return row.indices.contains(p.c) ? row[p.c] : SheetCellDisplay()
    }

    /// Overflow of one row (Sheets: long text over empty neighbours), measured with each cell's font.
    private func spill(row r: Int) -> (extents: [SheetSpill.Extent], hide: [Bool])? {
        if let s = rowSpills[r] { return s }
        guard input.cols > 0, input.cols <= 400 else { return nil }
        let list = displays(row: r)
        var cells: [SheetSpill.Cell] = []
        cells.reserveCapacity(list.count)
        guard layout.colX.count == list.count + 1 else { return nil }
        for (c, d) in list.enumerated() {
            let w = Double(layout.colX[c + 1] - layout.colX[c])
            let merged = layout.merge(at: SheetPos(r: r, c: c)) != nil
            let empty = d.blank && !d.hasRule && d.checkbox == nil && d.chips.isEmpty && d.filterHead == nil && !merged
            let can = !merged && d.wrapMode == "o" && !d.numeric && !d.text.isEmpty && !d.rotated && d.checkbox == nil
                && d.chips.isEmpty && d.filterHead == nil && !d.text.contains("\n")
            var tw = 0.0
            if can {
                let size = d.fontSize ?? 13
                let font = UIFont.systemFont(ofSize: size, weight: d.bold ? .semibold : .regular)
                tw = Double(ceil((d.text as NSString).size(withAttributes: [.font: font]).width)) + 1
            }
            let align = d.alignment == .right ? "r" : (d.alignment == .center ? "c" : "l")
            cells.append(SheetSpill.Cell(width: w, empty: empty, canSpill: can, textWidth: tw, align: align))
        }
        let out = SheetSpill.row(cells, barrier: layout.frozenCols)
        rowSpills[r] = (out.extents, out.hideRightLine)
        return rowSpills[r]
    }

    private func spills(_ r: Int, _ c: Int) -> Bool {
        guard let s = spill(row: r), s.extents.indices.contains(c) else { return false }
        return s.extents[c].left > 0 || s.extents[c].right > 0
    }

    private func configure(_ cell: SheetGridCell, _ p: SheetPos) {
        let s = spill(row: p.r)
        var ext = SheetSpill.Extent()
        var hide = false
        if let s, s.extents.indices.contains(p.c) {
            ext = s.extents[p.c]
            // A merged anchor draws the block's right edge: the last column of the merge decides.
            let lastCol = layout.merge(at: p)?.right ?? p.c
            hide = s.hide.indices.contains(lastCol) ? s.hide[lastCol] : false
        }
        cell.show(cellDisplay(p), gridColor: gridColor, extent: ext, hideRightLine: hide,
                  frozen: p.r < layout.frozenRows || p.c < layout.frozenCols)
    }

    // MARK: layout

    override func layoutSubviews() {
        super.layoutSubviews()
        let h = Self.headerHeight, g = Self.gutterWidth
        corner.frame = CGRect(x: 0, y: 0, width: g, height: h)
        columnStrip.frame = CGRect(x: g, y: 0, width: max(0, bounds.width - g), height: h)
        rowStrip.frame = CGRect(x: 0, y: h, width: g, height: max(0, bounds.height - h))
        collection.frame = CGRect(x: g, y: h, width: max(0, bounds.width - g), height: max(0, bounds.height - h))
        syncStrips()
        updatePanes()
    }

    private func syncStrips() {
        let pin = layout.pin
        columnStrip.pin = pin.x
        rowStrip.pin = pin.y
        columnStrip.offset = collection.contentOffset.x
        rowStrip.offset = collection.contentOffset.y
        columnStrip.setNeedsDisplay()
        rowStrip.setNeedsDisplay()
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        syncStrips()
        updatePanes()
    }

    // MARK: resizing

    private func resizeColumn(_ i: Int, _ size: CGFloat, _ done: Bool) {
        // Several whole columns selected and this is one of them: they all take the new width.
        let group: [Int] = columnStrip.handleRange.map { $0.contains(i) ? Array($0) : [i] } ?? [i]
        for c in group { widthOverride[c] = size }
        applyGeometry()
        drawSelection()
        if done {
            widthOverride = [:]
            delegate?.gridResizeColumns(group, width: size)
        }
    }

    private func resizeRow(_ i: Int, _ size: CGFloat, _ done: Bool) {
        let group: [Int] = rowStrip.handleRange.map { $0.contains(i) ? Array($0) : [i] } ?? [i]
        for r in group { heightOverride[r] = size }
        applyGeometry()
        drawSelection()
        if done {
            heightOverride = [:]
            delegate?.gridResizeRows(group, height: size)
        }
    }

    // MARK: data source

    func numberOfSections(in collectionView: UICollectionView) -> Int { input.rows }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { input.cols }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: SheetGridCell.reuseId, for: indexPath)
        if let c = cell as? SheetGridCell { configure(c, SheetPos(r: indexPath.section, c: indexPath.item)) }
        return cell
    }

    // MARK: gestures

    private func pos(_ g: UIGestureRecognizer, clamp: Bool = false) -> SheetPos? {
        layout.position(at: g.location(in: collection), clamp: clamp)
    }

    private func takeKeyboard() {
        if !(delegate?.gridIsEditing ?? false) { becomeFirstResponder() }
    }

    @objc private func tapped(_ g: UITapGestureRecognizer) {
        takeKeyboard()
        let cp = layout.contentPoint(g.location(in: collection))
        guard let p = layout.positionInContent(cp) else { return }
        // The funnel on the filter's header row opens the column's filter menu.
        if cellDisplay(p).filterHead != nil {
            let f = layout.cellFrame(row: p.r, col: p.c)
            if cp.x >= f.maxX - 26 { delegate?.gridFilterMenu(p.c); return }
        }
        let flags = g.modifierFlags.intersection([.shift, .command, .control, .alternate])
        let anchor = layout.merge(at: p).map { SheetPos(r: $0.top, c: $0.left) } ?? p
        let wasActive = (selection.isSingleCell || layout.merge(at: anchor) == selection.current) && selection.active == anchor
        delegate?.gridTap(p, extend: flags.contains(.shift), add: flags.contains(.command))
        // Tapping the cell that is already selected opens it (Sheets on a phone).
        if wasActive, flags.isEmpty, traitCollection.horizontalSizeClass == .compact { delegate?.gridEdit(anchor) }
    }

    @objc private func doubleTapped(_ g: UITapGestureRecognizer) {
        guard let p = pos(g) else { return }
        delegate?.gridEdit(p)
    }

    @objc private func held(_ g: UILongPressGestureRecognizer) {
        switch g.state {
        case .began:
            guard let p = pos(g) else { return }
            dragMoved = false
            UISelectionFeedbackGenerator().selectionChanged()
            delegate?.gridDragBegan(p)
        case .changed:
            autoscroll(at: g.location(in: self))
            guard let p = pos(g, clamp: true) else { return }
            if p != selection.current.b { dragMoved = true }
            delegate?.gridDragMoved(p)
        case .ended:
            if !dragMoved, let p = pos(g) { showMenu(at: g.location(in: collection), for: p) }
        default:
            break
        }
    }

    @objc private func pointerDragged(_ g: UIPanGestureRecognizer) {
        switch g.state {
        case .began:
            takeKeyboard()
            let start = g.location(in: collection)
            let t = g.translation(in: collection)
            if let p = layout.position(at: CGPoint(x: start.x - t.x, y: start.y - t.y)) {
                delegate?.gridDragBegan(p)
            }
        case .changed:
            autoscroll(at: g.location(in: self))
            if let p = pos(g, clamp: true) { delegate?.gridDragMoved(p) }
        default:
            break
        }
    }

    @objc private func secondaryClicked(_ g: UITapGestureRecognizer) {
        guard let p = pos(g) else { return }
        if !selection.contains(p) { delegate?.gridTap(p, extend: false, add: false) }
        showMenu(at: g.location(in: collection), for: p)
    }

    /// A drag near an edge scrolls the grid that way (the frozen panes' edge counts as the top / left).
    private func autoscroll(at point: CGPoint) {
        let edge: CGFloat = 36, step: CGFloat = 18
        var off = collection.contentOffset
        let f = collection.frame
        let left = f.minX + layout.frozenWidth, top = f.minY + layout.frozenHeight
        if point.x > f.maxX - edge { off.x += step } else if point.x < left + edge && point.x >= left { off.x -= step }
        if point.y > f.maxY - edge { off.y += step } else if point.y < top + edge && point.y >= top { off.y -= step }
        let maxX = max(0, collection.contentSize.width - collection.bounds.width)
        let maxY = max(0, collection.contentSize.height - collection.bounds.height)
        off.x = min(max(0, off.x), maxX)
        off.y = min(max(0, off.y), maxY)
        if off != collection.contentOffset { collection.setContentOffset(off, animated: false) }
    }

    // MARK: menu

    private func showMenu(at point: CGPoint, for p: SheetPos) {
        menuPos = p
        editMenu?.presentEditMenu(with: UIEditMenuConfiguration(identifier: nil, sourcePoint: point))
    }

    func editMenuInteraction(_ interaction: UIEditMenuInteraction, menuFor configuration: UIEditMenuConfiguration,
                             suggestedActions: [UIMenuElement]) -> UIMenu? {
        guard let p = menuPos else { return nil }
        return delegate?.gridMenu(for: p)
    }

    // MARK: keyboard

    override var canBecomeFirstResponder: Bool { true }

    override var keyCommands: [UIKeyCommand]? {
        var list: [UIKeyCommand] = []
        func add(_ input: String, _ flags: UIKeyModifierFlags, _ sel: Selector) {
            let k = UIKeyCommand(input: input, modifierFlags: flags, action: sel)
            k.wantsPriorityOverSystemBehavior = true
            list.append(k)
        }
        for flags in [UIKeyModifierFlags(), .shift, .command, [.command, .shift]] {
            add(UIKeyCommand.inputUpArrow, flags, #selector(keyArrow(_:)))
            add(UIKeyCommand.inputDownArrow, flags, #selector(keyArrow(_:)))
            add(UIKeyCommand.inputLeftArrow, flags, #selector(keyArrow(_:)))
            add(UIKeyCommand.inputRightArrow, flags, #selector(keyArrow(_:)))
        }
        add("\t", [], #selector(keyTab(_:)))
        add("\t", .shift, #selector(keyTab(_:)))
        add("\r", [], #selector(keyEnter(_:)))
        add("\r", .shift, #selector(keyEnter(_:)))
        add("\u{8}", [], #selector(keyDelete))
        add(UIKeyCommand.inputDelete, [], #selector(keyDelete))
        add(UIKeyCommand.inputEscape, [], #selector(keyEscape))
        add(UIKeyCommand.inputF2, [], #selector(keyEditCell))
        add("c", .command, #selector(keyCopy))
        add("x", .command, #selector(keyCut))
        add("v", .command, #selector(keyPaste))
        add("z", .command, #selector(keyUndo))
        add("z", [.command, .shift], #selector(keyRedo))
        add("y", .command, #selector(keyRedo))
        add("a", .command, #selector(keySelectAll))
        add("b", .command, #selector(keyBold))
        add("i", .command, #selector(keyItalic))
        return list.filter { !($0.input ?? "").isEmpty }
    }

    @objc private func keyArrow(_ k: UIKeyCommand) {
        var dr = 0, dc = 0
        switch k.input {
        case UIKeyCommand.inputUpArrow: dr = -1
        case UIKeyCommand.inputDownArrow: dr = 1
        case UIKeyCommand.inputLeftArrow: dc = -1
        default: dc = 1
        }
        let ext = k.modifierFlags.contains(.shift)
        if k.modifierFlags.contains(.command) {
            delegate?.gridKey(.jump(dr: dr, dc: dc, extend: ext))
        } else {
            delegate?.gridKey(.move(dr: dr, dc: dc, extend: ext))
        }
    }
    @objc private func keyTab(_ k: UIKeyCommand) { delegate?.gridKey(.tab(back: k.modifierFlags.contains(.shift))) }
    @objc private func keyEnter(_ k: UIKeyCommand) { delegate?.gridKey(.enter(back: k.modifierFlags.contains(.shift))) }
    @objc private func keyDelete() { delegate?.gridKey(.delete) }
    @objc private func keyEscape() { delegate?.gridKey(.escape) }
    @objc private func keyEditCell() { delegate?.gridKey(.editCell) }
    @objc private func keyCopy() { delegate?.gridKey(.copy) }
    @objc private func keyCut() { delegate?.gridKey(.cut) }
    @objc private func keyPaste() { delegate?.gridKey(.paste) }
    @objc private func keyUndo() { delegate?.gridKey(.undo) }
    @objc private func keyRedo() { delegate?.gridKey(.redo) }
    @objc private func keySelectAll() { delegate?.gridKey(.selectAll) }
    @objc private func keyBold() { delegate?.gridKey(.bold) }
    @objc private func keyItalic() { delegate?.gridKey(.italic) }

    /// A printable key with no ⌘ / ⌃ starts editing the cell with that character (Sheets).
    override func pressesBegan(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        var handled = false
        for press in presses {
            guard let key = press.key else { continue }
            if key.modifierFlags.contains(.command) || key.modifierFlags.contains(.control) { continue }
            let chars = key.characters
            guard !chars.isEmpty, let scalar = chars.unicodeScalars.first else { continue }
            // Control characters and the private-use range (arrows, function keys) are not typing.
            if scalar.value < 0x20 || scalar.value == 0x7f || (0xF700...0xF8FF).contains(scalar.value) { continue }
            delegate?.gridType(chars)
            handled = true
        }
        if !handled { super.pressesBegan(presses, with: event) } else { handledPresses.formUnion(presses) }
    }

    private var handledPresses: Set<UIPress> = []

    override func pressesEnded(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let mine = presses.intersection(handledPresses)
        handledPresses.subtract(mine)
        let rest = presses.subtracting(mine)
        if !rest.isEmpty { super.pressesEnded(rest, with: event) }
    }

    override func pressesCancelled(_ presses: Set<UIPress>, with event: UIPressesEvent?) {
        let mine = presses.intersection(handledPresses)
        handledPresses.subtract(mine)
        let rest = presses.subtracting(mine)
        if !rest.isEmpty { super.pressesCancelled(rest, with: event) }
    }
}

// MARK: - SwiftUI wrapper

struct SheetGridView: UIViewRepresentable {
    let store: SheetStore
    /// Copy / paste / menu actions that need SwiftUI (alerts, the pasteboard round trip).
    let actions: SheetGridActions

    func makeCoordinator() -> Coordinator { Coordinator(store: store, actions: actions) }

    func makeUIView(context: Context) -> SheetGridHost {
        let host = SheetGridHost(frame: .zero)
        host.delegate = context.coordinator
        context.coordinator.host = host
        // Arrows work as soon as the sheet is on screen (iPad keyboard, Mac).
        DispatchQueue.main.async { host.becomeFirstResponder() }
        return host
    }

    func updateUIView(_ host: SheetGridHost, context: Context) {
        let c = context.coordinator
        c.store = store
        c.actions = actions
        // Read inside updateUIView so SwiftUI re-runs this when they change.
        let version = store.version
        let editing = store.editing
        let selVersion = store.selVersion
        if version != c.lastVersion {
            c.lastVersion = version
            c.lastSelVersion = selVersion
            host.reload(Self.input(store), selection: store.selection)
        } else if selVersion != c.lastSelVersion {
            c.lastSelVersion = selVersion
            host.setSelection(store.selection)
        }
        // Back from the editor: the keyboard comes back to the grid.
        if c.wasEditing && !editing { DispatchQueue.main.async { host.becomeFirstResponder() } }
        c.wasEditing = editing
    }

    @MainActor
    private static func input(_ store: SheetStore) -> SheetGridInput {
        var i = SheetGridInput()
        i.rows = store.rowCount
        i.cols = store.colCount
        i.widths = (0..<store.colCount).map { store.columnWidth($0) }
        i.heights = (0..<store.rowCount).map { store.rowHeight($0) }
        i.frozenRows = store.frozenRowCount
        i.frozenCols = store.frozenColCount
        i.merges = store.merges
        i.showGrid = store.showGridlines
        i.canEdit = store.canEdit
        i.rowMarkers = Set(store.rowGaps.keys)
        i.colMarkers = Set(store.colGaps.keys)
        return i
    }

    @MainActor
    final class Coordinator: NSObject, SheetGridDelegate {
        var store: SheetStore
        var actions: SheetGridActions
        weak var host: SheetGridHost?
        var lastVersion = -1
        var lastSelVersion = -1
        var wasEditing = false

        init(store: SheetStore, actions: SheetGridActions) {
            self.store = store
            self.actions = actions
        }

        func gridDisplay(_ p: SheetPos) -> SheetCellDisplay {
            var d = store.display(p)
            d.commented = actions.commentCount(p) > 0
            return d
        }
        var gridIsEditing: Bool { store.editing }

        func gridTap(_ p: SheetPos, extend: Bool, add: Bool) {
            let d = store.display(p)
            store.select(p, extend: extend, add: add)
            // A checkbox ticks on a plain tap of its cell, as in Sheets.
            if d.checkbox != nil, !extend, !add, !store.editing { actions.tappedCheckbox(p) }
        }

        func gridEdit(_ p: SheetPos) {
            // The second tap of a double tap on the cell already open: nothing more to do.
            if store.editing && store.selection.active == p { return }
            store.select(p)
            actions.beginEdit(nil)
        }

        func gridDragBegan(_ p: SheetPos) { store.select(p) }
        func gridDragMoved(_ p: SheetPos) { store.select(p, extend: true) }
        func gridType(_ text: String) {
            if store.editing { store.draft += text } else { actions.beginEdit(text) }
        }
        func gridColumnTap(_ c: Int, extend: Bool) { store.selectColumn(c, extend: extend) }
        func gridRowTap(_ r: Int, extend: Bool) { store.selectRow(r, extend: extend) }
        func gridMenu(for p: SheetPos) -> UIMenu? { actions.menu(p) }

        func gridResizeColumns(_ cols: [Int], width: CGFloat) {
            let s = store
            Task { await s.setColumnWidths(cols, width: Double(width)) }
        }

        func gridResizeRows(_ rows: [Int], height: CGFloat) {
            let s = store
            Task { await s.setRowHeights(rows, height: Double(height)) }
        }

        func gridFilterMenu(_ c: Int) { actions.filterMenu(c) }

        func gridUnhideRows(before r: Int) {
            let s = store
            Task { await s.unhideRows(before: r) }
        }

        func gridUnhideColumns(before c: Int) {
            let s = store
            Task { await s.unhideColumns(before: c) }
        }

        func gridKey(_ key: SheetGridKey) {
            switch key {
            case .move(let dr, let dc, let ext): store.move(dr: dr, dc: dc, extend: ext)
            case .jump(let dr, let dc, let ext): store.jump(dr: dr, dc: dc, extend: ext)
            case .tab(let back): store.advance(tab: true, back: back)
            case .enter(let back):
                if back { store.advance(tab: false, back: true) } else { actions.beginEdit(nil) }
            case .delete: store.clearSelection()
            case .escape: store.select(store.selection.active)
            case .editCell: actions.beginEdit(nil)
            case .copy: actions.copy(false)
            case .cut: actions.copy(true)
            case .paste: actions.paste()
            case .undo: Task { await store.undo() }
            case .redo: Task { await store.redo() }
            case .selectAll: store.selectAll()
            case .bold: store.toggleStyleFlag("b", label: T("bold"))
            case .italic: store.toggleStyleFlag("i", label: T("italic"))
            }
        }
    }
}

/// The SwiftUI side's handlers for things the grid cannot do alone.
struct SheetGridActions {
    var beginEdit: (String?) -> Void
    var copy: (Bool) -> Void
    var paste: () -> Void
    var menu: (SheetPos) -> UIMenu?
    var tappedCheckbox: (SheetPos) -> Void
    var filterMenu: (Int) -> Void = { _ in }
    /// Unresolved comments on a cell (the amber corner marker).
    var commentCount: (SheetPos) -> Int = { _ in 0 }
}

#if !targetEnvironment(macCatalyst)
extension SheetHeaderStrip: UIPointerInteractionDelegate {
    // Pointer: a resize pointer over an edge.
    func pointerInteraction(_ interaction: UIPointerInteraction, regionFor request: UIPointerRegionRequest, defaultRegion: UIPointerRegion) -> UIPointerRegion? {
        guard resizable, let i = edge(at: request.location, tolerance: 5) else { return nil }
        let e = screenEnd(i)
        let rect = axis == .columns ? CGRect(x: e - 5, y: 0, width: 10, height: bounds.height) : CGRect(x: 0, y: e - 5, width: bounds.width, height: 10)
        return UIPointerRegion(rect: rect, identifier: NSNumber(value: i))
    }

    func pointerInteraction(_ interaction: UIPointerInteraction, styleFor region: UIPointerRegion) -> UIPointerStyle? {
        UIPointerStyle(shape: axis == .columns ? .verticalBeam(length: 18) : .horizontalBeam(length: 18), constrainedAxes: [])
    }
}
#endif
