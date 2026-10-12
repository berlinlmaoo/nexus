import SwiftUI
import UIKit

// Things that sit on the spreadsheet grid besides its cells (web SheetGrid.tsx / SheetChart.tsx ChartObject):
// - fonts for the `ff` families (the web's list mapped to what iOS / the Mac has, system designs as fallback),
// - charts floating over the cells at their `at` anchor (row / column id + dx / dy, w × h): drawn with the
//   same Swift Charts view as the Charts panel inside a UIHostingController, scrolled with the cells; tap
//   selects, tap again opens the chart editor; drag moves it (pointer at once, a finger after a short hold),
//   the corner handle resizes it; saved to settings.charts,
// - the corner above the row numbers with the two freeze handles (drag them to freeze rows / columns),
// - the collection view subclass that lets the charts take touches before the cells under them.

// MARK: - fonts

@MainActor
enum SheetGridFonts {
    private static var families: Set<String> = Set(UIFont.familyNames.map { $0.lowercased() })
    private static var cache: [String: UIFont] = [:]

    /// The cell font: the stored family (or the system font), its size, bold and italic.
    static func font(size: CGFloat, bold: Bool, italic: Bool, family: String?) -> UIFont {
        let key = "\(family ?? "")|\(size)|\(bold)|\(italic)"
        if let f = cache[key] { return f }
        let base = baseFont(size: size, bold: bold, family: family)
        var traits = base.fontDescriptor.symbolicTraits
        if bold && family != nil { traits.insert(.traitBold) }
        if italic { traits.insert(.traitItalic) }
        var out = base
        if traits != base.fontDescriptor.symbolicTraits, let d = base.fontDescriptor.withSymbolicTraits(traits) {
            out = UIFont(descriptor: d, size: size)
        }
        cache[key] = out
        return out
    }

    private static func baseFont(size: CGFloat, bold: Bool, family: String?) -> UIFont {
        let system = UIFont.systemFont(ofSize: size, weight: bold ? .semibold : .regular)
        guard let family else { return system }
        for name in SheetGridText.candidates(family) {
            switch name {
            case ":serif": if let d = system.fontDescriptor.withDesign(.serif) { return UIFont(descriptor: d, size: size) }
            case ":mono": if let d = system.fontDescriptor.withDesign(.monospaced) { return UIFont(descriptor: d, size: size) }
            case ":rounded": if let d = system.fontDescriptor.withDesign(.rounded) { return UIFont(descriptor: d, size: size) }
            default:
                guard families.contains(name.lowercased()) else { continue }
                let d = UIFontDescriptor(fontAttributes: [.family: name])
                return UIFont(descriptor: d, size: size)
            }
        }
        return system
    }

    /// A font for a menu row showing the family's look.
    static func preview(_ family: String?) -> Font {
        Font(font(size: 15, bold: false, italic: false, family: family) as CTFont)
    }
}

// MARK: - the collection view

/// The grid's collection view: floating objects (charts) answer touches before the cells under them.
final class SheetCollectionView: UICollectionView {
    var objectHit: ((CGPoint, UIEvent?) -> UIView?)?

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        if let v = objectHit?(point, event) { return v }
        return super.hitTest(point, with: event)
    }
}

// MARK: - one chart on the grid

/// Where a chart sits, from the store (visible row / column of its anchor, offsets and size in points).
struct SheetGridChart: Equatable {
    var id: String
    var row: Int
    var col: Int
    var dx: CGFloat
    var dy: CGFloat
    var w: CGFloat
    var h: CGFloat
}

final class SheetChartObjectView: UIView, UIGestureRecognizerDelegate {
    let chartId: String
    private let hosting: UIHostingController<AnyView>
    private let handle = UIView()
    private let more = UIButton(type: .system)
    /// Anchored in a frozen row / column: drawn above the frozen cells and still touchable there.
    var frozenAnchor = false

    var selected = false { didSet { if selected != oldValue { updateChrome() } } }
    var canEdit = false { didSet { if canEdit != oldValue { updateChrome() } } }

    var onSelect: ((String) -> Void)?
    var onOpen: ((String) -> Void)?
    /// (id, frame in the collection view, finished, resized)
    var onDrag: ((String, CGRect, Bool, Bool) -> Void)?
    var menu: ((String) -> UIMenu?)?

    private var startFrame: CGRect = .zero
    private var startPoint: CGPoint = .zero
    private var dragging = false

    init(id: String, content: AnyView) {
        chartId = id
        hosting = UIHostingController(rootView: content)
        super.init(frame: .zero)
        clipsToBounds = false
        backgroundColor = UIColor(NX.card)
        layer.cornerRadius = 6
        layer.shadowColor = UIColor.black.cgColor
        layer.shadowOpacity = 0.12
        layer.shadowRadius = 6
        layer.shadowOffset = CGSize(width: 0, height: 2)

        let body = hosting.view!
        body.backgroundColor = .clear
        body.isUserInteractionEnabled = false
        body.layer.cornerRadius = 6
        body.clipsToBounds = true
        body.frame = bounds
        body.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        hosting.safeAreaRegions = []
        addSubview(body)

        handle.backgroundColor = UIColor(NX.violet)
        handle.layer.cornerRadius = 3
        handle.layer.borderColor = UIColor.white.cgColor
        handle.layer.borderWidth = 1.5
        addSubview(handle)

        more.setImage(UIImage(systemName: "ellipsis.circle.fill"), for: .normal)
        more.tintColor = UIColor(NX.violet)
        more.showsMenuAsPrimaryAction = true
        more.accessibilityLabel = T("Chart options")
        addSubview(more)

        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped))
        addGestureRecognizer(tap)

        // Moving: the pointer drags at once (iPad trackpad, Mac); a finger after a short hold.
        let pointerMove = UIPanGestureRecognizer(target: self, action: #selector(pointerMoved(_:)))
        #if targetEnvironment(macCatalyst)
        pointerMove.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirectPointer.rawValue),
                                         NSNumber(value: UITouch.TouchType.direct.rawValue)]
        #else
        pointerMove.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.indirectPointer.rawValue)]
        #endif
        pointerMove.delegate = self
        addGestureRecognizer(pointerMove)
        #if !targetEnvironment(macCatalyst)
        let touchMove = UILongPressGestureRecognizer(target: self, action: #selector(touchMoved(_:)))
        touchMove.minimumPressDuration = 0.3
        touchMove.allowedTouchTypes = [NSNumber(value: UITouch.TouchType.direct.rawValue)]
        touchMove.delegate = self
        addGestureRecognizer(touchMove)
        #endif

        // Resizing: the corner handle answers at once (so the sheet doesn't scroll instead).
        let resize = UILongPressGestureRecognizer(target: self, action: #selector(resized(_:)))
        resize.minimumPressDuration = 0
        resize.delegate = self
        handle.addGestureRecognizer(resize)

        updateChrome()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    func setContent(_ content: AnyView) { hosting.rootView = content }

    private func updateChrome() {
        layer.borderWidth = selected ? 2 : 1
        layer.borderColor = (selected ? UIColor(NX.violet) : UIColor(NX.border)).cgColor
        handle.isHidden = !(selected && canEdit)
        more.isHidden = !selected
        more.menu = selected ? menu?(chartId) : nil
        setNeedsLayout()
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let s: CGFloat = traitCollection.userInterfaceIdiom == .mac ? 12 : 18
        handle.frame = CGRect(x: bounds.width - s - 2, y: bounds.height - s - 2, width: s, height: s)
        more.frame = CGRect(x: bounds.width - 36, y: 4, width: 32, height: 32)
    }

    override func traitCollectionDidChange(_ previous: UITraitCollection?) {
        super.traitCollectionDidChange(previous)
        updateChrome()
    }

    // MARK: gestures

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        if g is UITapGestureRecognizer { return true }
        if g.view === self || g.view === handle { return canEdit }
        return super.gestureRecognizerShouldBegin(g)
    }

    @objc private func tapped() {
        if selected { onOpen?(chartId) } else { onSelect?(chartId) }
    }

    private func begin(_ p: CGPoint) {
        onSelect?(chartId)
        startFrame = frame
        startPoint = p
        dragging = true
    }

    private func moveTo(_ p: CGPoint, done: Bool) {
        guard dragging else { return }
        let f = startFrame.offsetBy(dx: p.x - startPoint.x, dy: p.y - startPoint.y)
        if done { dragging = false }
        onDrag?(chartId, f, done, false)
    }

    private func cancel() {
        guard dragging else { return }
        dragging = false
        onDrag?(chartId, startFrame, true, false)
    }

    @objc private func pointerMoved(_ g: UIPanGestureRecognizer) {
        let p = g.location(in: superview)
        switch g.state {
        case .began: begin(p)
        case .changed: moveTo(p, done: false)
        case .ended: moveTo(p, done: true)
        default: cancel()
        }
    }

    @objc private func touchMoved(_ g: UILongPressGestureRecognizer) {
        let p = g.location(in: superview)
        switch g.state {
        case .began:
            UISelectionFeedbackGenerator().selectionChanged()
            begin(p)
        case .changed: moveTo(p, done: false)
        case .ended: moveTo(p, done: true)
        default: cancel()
        }
    }

    @objc private func resized(_ g: UILongPressGestureRecognizer) {
        let p = g.location(in: superview)
        switch g.state {
        case .began:
            startFrame = frame
            startPoint = p
            dragging = true
        case .changed, .ended:
            guard dragging else { return }
            let w = max(CGFloat(SheetChartPlace.minWidth), startFrame.width + p.x - startPoint.x)
            let h = max(CGFloat(SheetChartPlace.minHeight), startFrame.height + p.y - startPoint.y)
            let f = CGRect(x: startFrame.minX, y: startFrame.minY, width: w, height: h)
            let done = g.state == .ended
            if done { dragging = false }
            onDrag?(chartId, f, done, true)
        default:
            guard dragging else { return }
            dragging = false
            onDrag?(chartId, startFrame, true, true)
        }
    }
}

// MARK: - the corner with the freeze handles

/// The box above the row numbers: tap selects everything; its bottom / right edges are Sheets' grey freeze
/// handles — drag one to freeze rows / columns up to where it is dropped (web startFreezeDrag).
final class SheetCornerView: UIView, UIGestureRecognizerDelegate {
    enum Axis { case rows, cols }

    var editable = false { didSet { if editable != oldValue { setNeedsDisplay() } } }
    var onSelectAll: (() -> Void)?
    /// (axis, point in the host, state)
    var onFreezeDrag: ((Axis, CGPoint, UIGestureRecognizer.State) -> Void)?
    private var axis: Axis?

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = UIColor(NX.muted)
        contentMode = .redraw
        isAccessibilityElement = true
        accessibilityLabel = T("Select all")
        accessibilityTraits = .button
        addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tapped)))
        let pan = UIPanGestureRecognizer(target: self, action: #selector(panned(_:)))
        pan.delegate = self
        addGestureRecognizer(pan)
        #if !targetEnvironment(macCatalyst)
        addInteraction(UIPointerInteraction(delegate: self))
        #endif
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) is not used") }

    /// Which handle a touch starts on (bottom band = rows, right band = columns).
    private func handle(at p: CGPoint) -> Axis? {
        guard editable else { return nil }
        let row = p.y >= bounds.height - 10
        let col = p.x >= bounds.width - 12
        if row && col { return (bounds.height - p.y) < (bounds.width - p.x) ? .rows : .cols }
        if row { return .rows }
        if col { return .cols }
        return nil
    }

    override func gestureRecognizerShouldBegin(_ g: UIGestureRecognizer) -> Bool {
        guard let pan = g as? UIPanGestureRecognizer, pan.view === self else { return super.gestureRecognizerShouldBegin(g) }
        let now = pan.location(in: self), t = pan.translation(in: self)
        axis = handle(at: CGPoint(x: now.x - t.x, y: now.y - t.y))
        return axis != nil
    }

    @objc private func tapped() { onSelectAll?() }

    @objc private func panned(_ g: UIPanGestureRecognizer) {
        guard let axis, let host = superview else { return }
        onFreezeDrag?(axis, g.location(in: host), g.state)
        if g.state == .ended || g.state == .cancelled || g.state == .failed { self.axis = nil }
    }

    override func draw(_ rect: CGRect) {
        guard let ctx = UIGraphicsGetCurrentContext() else { return }
        ctx.setStrokeColor(UIColor(NX.border).cgColor)
        ctx.setLineWidth(1 / max(1, traitCollection.displayScale))
        ctx.move(to: CGPoint(x: bounds.width - 0.25, y: 0)); ctx.addLine(to: CGPoint(x: bounds.width - 0.25, y: bounds.height))
        ctx.move(to: CGPoint(x: 0, y: bounds.height - 0.25)); ctx.addLine(to: CGPoint(x: bounds.width, y: bounds.height - 0.25))
        ctx.strokePath()
        guard editable else { return }
        // The two grey handles, as on the web's select-all corner.
        ctx.setFillColor(UIColor.systemGray3.cgColor)
        ctx.fill(CGRect(x: 0, y: bounds.height - 4, width: bounds.width, height: 4))
        ctx.fill(CGRect(x: bounds.width - 4, y: 0, width: 4, height: bounds.height))
    }
}

#if !targetEnvironment(macCatalyst)
extension SheetCornerView: UIPointerInteractionDelegate {
    func pointerInteraction(_ interaction: UIPointerInteraction, regionFor request: UIPointerRegionRequest, defaultRegion: UIPointerRegion) -> UIPointerRegion? {
        guard let a = handle(at: request.location) else { return nil }
        let rect = a == .rows ? CGRect(x: 0, y: bounds.height - 10, width: bounds.width, height: 10)
                              : CGRect(x: bounds.width - 12, y: 0, width: 12, height: bounds.height)
        let id: String = a == .rows ? "rows" : "cols"
        return UIPointerRegion(rect: rect, identifier: id)
    }

    func pointerInteraction(_ interaction: UIPointerInteraction, styleFor region: UIPointerRegion) -> UIPointerStyle? {
        let rows = (region.identifier as? String) == "rows"
        return UIPointerStyle(shape: rows ? .horizontalBeam(length: 18) : .verticalBeam(length: 18), constrainedAxes: [])
    }
}
#endif
