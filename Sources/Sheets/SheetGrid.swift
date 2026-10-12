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

// MARK: - layout

final class SheetGridLayout: UICollectionViewLayout {
    private(set) var colX: [CGFloat] = [0]
    private(set) var rowY: [CGFloat] = [0]

    func configure(widths: [CGFloat], heights: [CGFloat]) {
        var x: [CGFloat] = [0]
        x.reserveCapacity(widths.count + 1)
        for w in widths { x.append(x[x.count - 1] + w) }
        var y: [CGFloat] = [0]
        y.reserveCapacity(heights.count + 1)
        for h in heights { y.append(y[y.count - 1] + h) }
        colX = x
        rowY = y
        invalidateLayout()
    }

    var cols: Int { colX.count - 1 }
    var rows: Int { rowY.count - 1 }

    override var collectionViewContentSize: CGSize { CGSize(width: colX.last ?? 0, height: rowY.last ?? 0) }

    func frame(row: Int, col: Int) -> CGRect {
        guard row >= 0, row < rows, col >= 0, col < cols else { return .zero }
        return CGRect(x: colX[col], y: rowY[row], width: colX[col + 1] - colX[col], height: rowY[row + 1] - rowY[row])
    }

    func frame(of range: SheetRange) -> CGRect {
        frame(row: range.top, col: range.left).union(frame(row: range.bottom, col: range.right))
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

    func column(at x: CGFloat) -> Int? {
        guard cols > 0, x >= 0, x < (colX.last ?? 0) else { return nil }
        return Self.index(of: x, in: colX)
    }

    func row(at y: CGFloat) -> Int? {
        guard rows > 0, y >= 0, y < (rowY.last ?? 0) else { return nil }
        return Self.index(of: y, in: rowY)
    }

    /// The cell under a point, clamped to the sheet (a drag past the edge keeps the last row / column).
    func position(at p: CGPoint, clamp: Bool = false) -> SheetPos? {
        guard rows > 0, cols > 0 else { return nil }
        if clamp {
            let x = min(max(p.x, 0), (colX.last ?? 1) - 0.5)
            let y = min(max(p.y, 0), (rowY.last ?? 1) - 0.5)
            return SheetPos(r: Self.index(of: y, in: rowY), c: Self.index(of: x, in: colX))
        }
        guard let r = row(at: p.y), let c = column(at: p.x) else { return nil }
        return SheetPos(r: r, c: c)
    }

    override func layoutAttributesForElements(in rect: CGRect) -> [UICollectionViewLayoutAttributes]? {
        guard rows > 0, cols > 0 else { return [] }
        let r0 = Self.index(of: max(0, rect.minY), in: rowY)
        let r1 = Self.index(of: max(0, rect.maxY), in: rowY)
        let c0 = Self.index(of: max(0, rect.minX), in: colX)
        let c1 = Self.index(of: max(0, rect.maxX), in: colX)
        guard r0 >= 0, c0 >= 0 else { return [] }
        var out: [UICollectionViewLayoutAttributes] = []
        out.reserveCapacity((r1 - r0 + 1) * (c1 - c0 + 1))
        for r in r0...max(r0, r1) {
            for c in c0...max(c0, c1) {
                let a = UICollectionViewLayoutAttributes(forCellWith: IndexPath(item: c, section: r))
                a.frame = frame(row: r, col: c)
                out.append(a)
            }
        }
        return out
    }

    override func layoutAttributesForItem(at indexPath: IndexPath) -> UICollectionViewLayoutAttributes? {
        let a = UICollectionViewLayoutAttributes(forCellWith: indexPath)
        a.frame = frame(row: indexPath.section, col: indexPath.item)
        return a
    }

    override func shouldInvalidateLayout(forBoundsChange newBounds: CGRect) -> Bool { false }
}

// MARK: - cell

final class SheetGridCell: UICollectionViewCell {
    static let reuseId = "sheet-cell"

    private let label = UILabel()
    private let chip = UILabel()
    private let check = UIImageView()
    private let lines = CAShapeLayer()
    private let flag = CAShapeLayer()

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
        lines.fillColor = nil
        lines.lineWidth = 0.5
        layer.addSublayer(lines)
        flag.fillColor = UIColor.systemRed.cgColor
        layer.addSublayer(flag)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func show(_ d: SheetCellDisplay, gridColor: UIColor) {
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
        flag.isHidden = !d.invalid
        lines.strokeColor = gridColor.cgColor
        verticalAlign = d.verticalAlign
        setNeedsLayout()
    }

    private var verticalAlign = 2

    override func layoutSubviews() {
        super.layoutSubviews()
        let b = contentView.bounds.insetBy(dx: 5, dy: 2)
        if label.numberOfLines == 1 {
            let h = min(b.height, label.font.lineHeight + 2)
            let y: CGFloat
            switch verticalAlign {
            case 0: y = b.minY
            case 1: y = b.midY - h / 2
            default: y = b.maxY - h
            }
            label.frame = CGRect(x: b.minX, y: y, width: b.width, height: h)
        } else {
            label.frame = b
        }
        let chipSize = chip.sizeThatFits(CGSize(width: b.width, height: 18))
        chip.frame = CGRect(x: b.minX, y: b.midY - 9, width: min(b.width, chipSize.width), height: 18)
        check.frame = CGRect(x: contentView.bounds.midX - 8, y: contentView.bounds.midY - 8, width: 16, height: 16)
        let w = bounds.width, h = bounds.height
        let path = UIBezierPath()
        path.move(to: CGPoint(x: w - 0.25, y: 0))
        path.addLine(to: CGPoint(x: w - 0.25, y: h - 0.25))
        path.addLine(to: CGPoint(x: 0, y: h - 0.25))
        lines.path = path.cgPath
        let t = UIBezierPath()
        t.move(to: CGPoint(x: w - 7, y: 0))
        t.addLine(to: CGPoint(x: w, y: 0))
        t.addLine(to: CGPoint(x: w, y: 7))
        t.close()
        flag.path = t.cgPath
    }
}

// MARK: - header strips

/// Column letters (horizontal) or row numbers (vertical), drawn for the visible part only and moved with
/// the grid's scroll. The selected rows / columns are tinted, like Sheets.
final class SheetHeaderStrip: UIView {
    enum Axis { case columns, rows }
    let axis: Axis
    var starts: [CGFloat] = [0]
    var labels: (Int) -> String = { _ in "" }
    var offset: CGFloat = 0 { didSet { if offset != oldValue { setNeedsDisplay() } } }
    var highlighted: ClosedRange<Int>?
    var onTap: ((Int, Bool) -> Void)?

    init(axis: Axis) {
        self.axis = axis
        super.init(frame: .zero)
        backgroundColor = UIColor(NX.muted)
        contentMode = .redraw
        isOpaque = true
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped(_:))))
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func index(at p: CGPoint) -> Int? {
        let v = (axis == .columns ? p.x : p.y) + offset
        guard starts.count > 1, v >= 0, v < (starts.last ?? 0) else { return nil }
        var lo = 0, hi = starts.count - 2
        while lo < hi {
            let mid = (lo + hi + 1) / 2
            if starts[mid] <= v { lo = mid } else { hi = mid - 1 }
        }
        return lo
    }

    @objc private func tapped(_ g: UITapGestureRecognizer) {
        guard let i = index(at: g.location(in: self)) else { return }
        onTap?(i, g.modifierFlags.contains(.shift))
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext(), starts.count > 1 else { return }
        let line = UIColor(NX.border)
        let fg = UIColor(NX.mutedFg)
        let font = UIFont.systemFont(ofSize: 11, weight: .medium)
        let para = NSMutableParagraphStyle()
        para.alignment = .center
        let lo = axis == .columns ? rect.minX + offset : rect.minY + offset
        let hi = axis == .columns ? rect.maxX + offset : rect.maxY + offset
        ctx.setLineWidth(1 / max(1, traitCollection.displayScale))
        for i in 0..<(starts.count - 1) {
            let a = starts[i], b = starts[i + 1]
            if b < lo { continue }
            if a > hi { break }
            let cell = axis == .columns
                ? CGRect(x: a - offset, y: 0, width: b - a, height: bounds.height)
                : CGRect(x: 0, y: a - offset, width: bounds.width, height: b - a)
            let on = highlighted?.contains(i) ?? false
            if on {
                ctx.setFillColor(UIColor(NX.violet).withAlphaComponent(0.16).cgColor)
                ctx.fill(cell)
            }
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
        ctx.setStrokeColor(line.cgColor)
        if axis == .columns {
            ctx.move(to: CGPoint(x: 0, y: bounds.height - 0.25)); ctx.addLine(to: CGPoint(x: bounds.width, y: bounds.height - 0.25))
        } else {
            ctx.move(to: CGPoint(x: bounds.width - 0.25, y: 0)); ctx.addLine(to: CGPoint(x: bounds.width - 0.25, y: bounds.height))
        }
        ctx.strokePath()
    }
}

// MARK: - host view

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
    private let selectionLayer = UIView()
    private var rangeViews: [UIView] = []
    private let activeView = UIView()
    private var editMenu: UIEditMenuInteraction?
    private var menuPos: SheetPos?
    private var dragMoved = false

    private var rowCount = 0
    private var colCount = 0
    private var lastWidths: [CGFloat] = []
    private var lastHeights: [CGFloat] = []
    private var selection = SheetSelection()
    private let gridColor = UIColor(NX.border)

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

        selectionLayer.isUserInteractionEnabled = false
        selectionLayer.layer.zPosition = 10
        collection.addSubview(selectionLayer)
        activeView.layer.borderColor = UIColor(NX.violet).cgColor
        activeView.layer.borderWidth = 2
        activeView.isUserInteractionEnabled = false
        selectionLayer.addSubview(activeView)

        columnStrip.labels = { SheetA1.letters($0) }
        rowStrip.labels = { "\($0 + 1)" }
        columnStrip.onTap = { [weak self] i, ext in self?.delegate?.gridColumnTap(i, extend: ext) }
        rowStrip.onTap = { [weak self] i, ext in self?.delegate?.gridRowTap(i, extend: ext) }

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

    /// Everything from the store: sizes, contents and the selection.
    func reload(rows: Int, cols: Int, widths: [CGFloat], heights: [CGFloat], selection: SheetSelection) {
        let shapeChanged = rows != rowCount || cols != colCount || widths != lastWidths || heights != lastHeights
        rowCount = rows
        colCount = cols
        lastWidths = widths
        lastHeights = heights
        if shapeChanged {
            layout.configure(widths: widths, heights: heights)
            columnStrip.starts = layout.colX
            rowStrip.starts = layout.rowY
        }
        collection.reloadData()
        setSelection(selection)
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
        guard rowCount > 0, colCount > 0 else {
            selectionLayer.isHidden = true
            return
        }
        selectionLayer.isHidden = false
        selectionLayer.frame = CGRect(origin: .zero, size: layout.collectionViewContentSize)
        while rangeViews.count < selection.ranges.count {
            let v = UIView()
            v.isUserInteractionEnabled = false
            v.backgroundColor = UIColor(NX.violet).withAlphaComponent(0.10)
            v.layer.borderColor = UIColor(NX.violet).withAlphaComponent(0.7).cgColor
            v.layer.borderWidth = 1
            selectionLayer.insertSubview(v, belowSubview: activeView)
            rangeViews.append(v)
        }
        for (i, v) in rangeViews.enumerated() {
            if i < selection.ranges.count, !selection.ranges[i].isSingle || selection.ranges.count > 1 {
                v.isHidden = false
                v.frame = layout.frame(of: selection.ranges[i])
            } else {
                v.isHidden = true
            }
        }
        activeView.frame = layout.frame(row: selection.active.r, col: selection.active.c).insetBy(dx: -1, dy: -1)
        let cur = selection.current
        columnStrip.highlighted = cur.left...cur.right
        rowStrip.highlighted = cur.top...cur.bottom
        columnStrip.setNeedsDisplay()
        rowStrip.setNeedsDisplay()
    }

    func scrollToVisible(_ p: SheetPos) {
        let f = layout.frame(row: p.r, col: p.c)
        guard f != .zero else { return }
        collection.scrollRectToVisible(f.insetBy(dx: -8, dy: -8), animated: false)
    }

    func refreshVisibleCells() {
        for case let cell as SheetGridCell in collection.visibleCells {
            guard let ip = collection.indexPath(for: cell) else { continue }
            cell.show(delegate?.gridDisplay(SheetPos(r: ip.section, c: ip.item)) ?? SheetCellDisplay(), gridColor: gridColor)
        }
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
    }

    private func syncStrips() {
        columnStrip.offset = collection.contentOffset.x
        rowStrip.offset = collection.contentOffset.y
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) { syncStrips() }

    // MARK: data source

    func numberOfSections(in collectionView: UICollectionView) -> Int { rowCount }
    func collectionView(_ collectionView: UICollectionView, numberOfItemsInSection section: Int) -> Int { colCount }

    func collectionView(_ collectionView: UICollectionView, cellForItemAt indexPath: IndexPath) -> UICollectionViewCell {
        let cell = collectionView.dequeueReusableCell(withReuseIdentifier: SheetGridCell.reuseId, for: indexPath)
        if let c = cell as? SheetGridCell {
            c.show(delegate?.gridDisplay(SheetPos(r: indexPath.section, c: indexPath.item)) ?? SheetCellDisplay(), gridColor: gridColor)
        }
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
        guard let p = pos(g) else { return }
        let flags = g.modifierFlags.intersection([.shift, .command, .control, .alternate])
        let wasActive = selection.isSingleCell && selection.active == p
        delegate?.gridTap(p, extend: flags.contains(.shift), add: flags.contains(.command))
        // Tapping the cell that is already selected opens it (Sheets on a phone).
        if wasActive, flags.isEmpty, traitCollection.horizontalSizeClass == .compact { delegate?.gridEdit(p) }
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

    /// A drag near an edge scrolls the grid that way.
    private func autoscroll(at point: CGPoint) {
        let edge: CGFloat = 36, step: CGFloat = 18
        var off = collection.contentOffset
        let f = collection.frame
        if point.x > f.maxX - edge { off.x += step } else if point.x < f.minX + edge { off.x -= step }
        if point.y > f.maxY - edge { off.y += step } else if point.y < f.minY + edge { off.y -= step }
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
            host.reload(rows: store.rowCount, cols: store.colCount,
                        widths: (0..<store.colCount).map { store.columnWidth($0) },
                        heights: (0..<store.rowCount).map { store.rowHeight($0) },
                        selection: store.selection)
        } else if selVersion != c.lastSelVersion {
            c.lastSelVersion = selVersion
            host.setSelection(store.selection)
        }
        // Back from the editor: the keyboard comes back to the grid.
        if c.wasEditing && !editing { DispatchQueue.main.async { host.becomeFirstResponder() } }
        c.wasEditing = editing
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

        func gridDisplay(_ p: SheetPos) -> SheetCellDisplay { store.display(p) }
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
}
