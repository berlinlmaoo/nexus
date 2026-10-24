import SwiftUI
import PhotosUI
import UIKit

// ─────────────────────────────────────────────────────────────────────────────
// Control Room → Bagan IP & Divisi. The web chart (OrgChart.tsx) on the phone, iPad and Mac.
//
// Three views, like the web: Ringkas (the top with its people and the cards right under it — fits a
// phone), one chip per card under the top (only that part), and Lengkap (everything). Every view is
// laid out automatically: arranging cards by hand stays on the web, where there is room for it.
//
// The tree is drawn with stacks, the way ApprovalChartView draws its tree, inside the same
// UIScrollView canvas (pinch, pan with inertia, double-tap to fit). Lines are drawn behind the cards
// from anchors: the crossbar from the bottom of a card's last box to the sub-units it does not lead
// through a person, and one line per leader from that person's chip to the card they lead or the
// box of the people under them, each on its own 12pt track, the one going farthest out highest, so
// lines from neighbouring leaders nest instead of crossing (owner, 5 Oct 2026).
//
// Tap a card to change it, tap a person to place them. The chart grants nothing — no project
// access, no attendance rule.
// ─────────────────────────────────────────────────────────────────────────────

struct AdminOrgChartSection: View {
    /// "ringkas", "lengkap" or "u:<unitId>" — remembered on this device.
    @AppStorage("nexus.orgChart.view") private var viewKey = "ringkas"
    @State private var tree: OrgTree?
    @State private var loading = true
    @State private var problem: String? = nil
    @State private var fitTrigger = 0
    @State private var editing: OrgUnitDTO?
    @State private var adding: OrgAddTarget?
    @State private var placing: OrgPersonDTO?
    @State private var shareItem: ShareItem?

    private var focusId: String? {
        guard viewKey.hasPrefix("u:"), let tree else { return nil }
        let id = String(viewKey.dropFirst(2))
        return tree.units[id] != nil ? id : nil
    }
    private var summary: Bool { focusId == nil && viewKey != "lengkap" }

    var body: some View {
        VStack(spacing: 0) {
            if let tree {
                header(tree)
                chips(tree)
                if let f = focusId { breadcrumb(tree, f) }
                Divider().overlay(NX.border)
                ZStack {
                    NX.background
                    ZoomableCanvas(fitTrigger: fitTrigger) { chart(tree) }
                }
                unplaced(tree)
            } else if loading {
                ProgressView().tint(NX.violetText).frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    EmptyState(icon: "rectangle.3.group", title: T("The chart couldn't load"),
                               subtitle: problem ?? T("Needs board access."),
                               actionTitle: T("Try again"), actionIcon: "arrow.clockwise",
                               action: { Task { await load() } })
                        .padding(.top, 40)
                }
            }
        }
        .task { await load() }
        .onChange(of: viewKey) { _, _ in fitTrigger += 1 }
        .sheet(item: $editing) { u in
            if let tree {
                NavigationStack {
                    OrgUnitSheet(tree: tree, unit: u, initialParent: u.parentId,
                                 onFocus: { id in editing = nil; viewKey = "u:\(id)" },
                                 onAddChild: { id in editing = nil; adding = OrgAddTarget(parentId: id) },
                                 onDone: { await load() })
                }
            }
        }
        .sheet(item: $adding) { a in
            if let tree {
                NavigationStack {
                    OrgUnitSheet(tree: tree, unit: nil, initialParent: a.parentId,
                                 onFocus: nil, onAddChild: nil, onDone: { await load() })
                }
            }
        }
        .sheet(item: $placing) { p in
            if let tree {
                NavigationStack { OrgPersonSheet(tree: tree, person: p, onDone: { await load() }) }
            }
        }
        .sheet(item: $shareItem) { item in ActivityView(items: [item.url]) }
    }

    private func load() async {
        if tree == nil { loading = true }
        do {
            let data = try await APIClient.shared.orgChart()
            tree = OrgTree(data)
            problem = nil
        } catch {
            problem = FailureText.text(error)
        }
        loading = false
    }

    // MARK: header, chips, breadcrumb

    private func header(_ t: OrgTree) -> some View {
        let cards = t.units.values.filter { !$0.isGroup }.count
        let placed = t.people.filter { !$0.unitIds.isEmpty }.count
        return HStack(spacing: 12) {
            HStack(spacing: 3) {
                Text("\(cards)").font(NXFont.text(13, .bold)).monospacedDigit().foregroundStyle(NX.foreground)
                Text(T("IP/Team")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            HStack(spacing: 3) {
                Text("\(placed)/\(t.people.count)").font(NXFont.text(13, .bold)).monospacedDigit().foregroundStyle(NX.foreground)
                Text(T("people placed")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
            }
            Spacer(minLength: 0)
            Button { fitTrigger += 1 } label: {
                Image(systemName: "arrow.down.left.and.arrow.up.right").font(.system(size: 13, weight: .semibold))
            }
            .accessibilityLabel(T("Fit to screen"))
            Button { exportPNG(t) } label: {
                Image(systemName: "square.and.arrow.up").font(.system(size: 13, weight: .semibold))
            }
            .accessibilityLabel(T("Share as image"))
            Button {
                adding = OrgAddTarget(parentId: focusId ?? (t.roots.count == 1 ? t.roots[0].id : nil))
            } label: {
                Label(T("Add"), systemImage: "plus").font(NXFont.text(13, .semibold))
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(NX.foreground, in: Capsule())
                    .foregroundStyle(NX.background)
            }
        }
        .foregroundStyle(NX.mutedFg)
        .buttonStyle(.plain)
        .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 6)
    }

    private func chips(_ t: OrgTree) -> some View {
        let tops = t.topUnits
        let active: String? = focusId.flatMap { (f: String) -> String? in
            let path = Set(t.path(f).map { $0.id })
            return tops.first { path.contains($0.id) }?.id
        }
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                OrgViewChip(title: T("Summary"), active: summary) { viewKey = "ringkas" }
                OrgViewChip(title: T("Full"), active: focusId == nil && viewKey == "lengkap") { viewKey = "lengkap" }
                if !tops.isEmpty {
                    Rectangle().fill(NX.border).frame(width: 1, height: 16).padding(.horizontal, 2)
                }
                ForEach(tops) { u in
                    OrgViewChip(title: u.name, active: active == u.id, logo: u.isIP ? u.logoUrl : nil) { viewKey = "u:\(u.id)" }
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 6)
        }
    }

    private func breadcrumb(_ t: OrgTree, _ f: String) -> some View {
        let path = t.path(f)
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(Array(path.enumerated()), id: \.element.id) { i, u in
                    if i > 0 {
                        Image(systemName: "chevron.right").font(.system(size: 9, weight: .semibold)).foregroundStyle(NX.mutedFg)
                    }
                    if i == path.count - 1 {
                        Text(u.name).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground)
                    } else {
                        Button { viewKey = i == 0 ? "ringkas" : "u:\(u.id)" } label: {
                            Text(u.name).font(NXFont.text(12)).foregroundStyle(NX.mutedFg)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 16).padding(.bottom, 8)
        }
    }

    /// People not in any card yet. Tap = place them.
    @ViewBuilder private func unplaced(_ t: OrgTree) -> some View {
        let alone = t.people.filter { $0.unitIds.isEmpty }
            .sorted { $0.displayName.localizedCaseInsensitiveCompare($1.displayName) == .orderedAscending }
        if !alone.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("\(T("Not placed yet")) · \(orgPeopleCount(alone.count))")
                    .font(NXFont.text(10.5, .bold)).tracking(0.6).foregroundStyle(NX.warning)
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(alone) { p in
                            Button { placing = p } label: {
                                HStack(spacing: 6) {
                                    AvatarView(url: p.avatar, initial: p.initial, size: 22, userId: p.userId, name: p.displayName)
                                    Text(p.displayName).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(NX.card, in: Capsule())
                                .overlay(Capsule().strokeBorder(NX.border))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(.horizontal, 14).padding(.vertical, 10)
            .background(.ultraThinMaterial)
            .overlay(alignment: .top) { Divider().overlay(NX.border) }
        }
    }

    // MARK: chart (canvas and export)

    private func chart(_ t: OrgTree) -> some View {
        let ctx = OrgCtx(tree: t, summary: summary,
                         onUnit: { editing = $0 },
                         onPerson: { placing = $0 })
        let tops: [OrgUnitDTO] = focusId.flatMap { t.units[$0] }.map { [$0] } ?? t.roots
        return HStack(alignment: .top, spacing: 56) {
            ForEach(tops) { u in OrgNode(id: u.id, ctx: ctx) }
        }
        .padding(28)
        .background(NX.background)
    }

    /// A sharp PNG to share: the chart drawn again at 2× without the canvas transform.
    @MainActor private func exportPNG(_ t: OrgTree) {
        let renderer = ImageRenderer(content: chart(t).environment(\.colorScheme, .light))
        renderer.scale = 2
        guard let img = renderer.uiImage, let data = img.pngData() else { problem = T("Couldn't create the image."); return }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("\(T("IP & Division Chart")) \(f.string(from: Date())).png")
        do { try data.write(to: url); shareItem = ShareItem(url: url) } catch { problem = T("Couldn't create the image.") }
    }
}

struct OrgAddTarget: Identifiable {
    let id = UUID()
    let parentId: String?
}

private struct OrgViewChip: View {
    let title: String
    let active: Bool
    var logo: String? = nil
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                if let logo { OrgLogo(url: logo, name: title, size: 16, rounded: 8, onLight: !active) }
                Text(title).font(NXFont.text(12, .semibold)).lineLimit(1)
            }
            .foregroundStyle(active ? Color.white : NX.mutedFg)
            .padding(.horizontal, 12).padding(.vertical, 6)
            .background(active ? OC.accentFill : NX.card, in: Capsule())
            .overlay(Capsule().strokeBorder(active ? Color.clear : NX.border))
        }
        .buttonStyle(.plain)
    }
}

// MARK: - colours (the web's tokens)

private enum OC {
    static let top = Color(hex: "#0f2742")
    static let ip = Color(hex: "#1e3a5f")
    static let division = Color(light: 0xedf2f9, dark: 0x1a2a41)
    static let divisionLine = Color(light: 0xc6d4e7, dark: 0x2e4565)
    static let divisionText = Color(light: 0x15304f, dark: 0xdce7f6)
    static let divisionSub = Color(light: 0x5a6b83, dark: 0x9fb0c8)
    static let sub = Color(light: 0xffffff, dark: 0x151b26)
    static let subLine = Color(light: 0xd8e0eb, dark: 0x2b3547)
    static let subText = Color(light: 0x22344d, dark: 0xd4dce8)
    static let line = Color(light: 0xb4c1d3, dark: 0x3e4c61)
    static let group = Color(light: 0x1e3a5f, dark: 0x94a3b8)
    static let accentFill = Color(light: 0x1e3a5f, dark: 0x3a5a86)
    static let accentText = Color(light: 0x1e3a5f, dark: 0x9fb6d6)
}

private enum OrgTone {
    case top, ip, division, sub

    var fill: Color {
        switch self {
        case .top: return OC.top
        case .ip: return OC.ip
        case .division: return OC.division
        case .sub: return OC.sub
        }
    }
    var text: Color {
        switch self {
        case .top, .ip: return .white
        case .division: return OC.divisionText
        case .sub: return OC.subText
        }
    }
    var meta: Color {
        switch self {
        case .top, .ip: return Color.white.opacity(0.7)
        case .division, .sub: return OC.divisionSub
        }
    }
    var border: Color? {
        switch self {
        case .top, .ip: return nil
        case .division: return OC.divisionLine
        case .sub: return OC.subLine
        }
    }
}

// MARK: - tree

private struct OrgCtx {
    let tree: OrgTree
    let summary: Bool
    let onUnit: (OrgUnitDTO) -> Void
    let onPerson: (OrgPersonDTO) -> Void
}

/// Points the lines are drawn between: a chip's bottom, a column's top, the bottom of a card's
/// last box (with its frame, to place the crossbar's stem).
private enum OrgMark {
    case point(Anchor<CGPoint>)
    case rect(Anchor<CGRect>)
}

private struct OrgMarkKey: PreferenceKey {
    static var defaultValue: [String: OrgMark] = [:]
    static func reduce(value: inout [String: OrgMark], nextValue: () -> [String: OrgMark]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

private struct OrgNode: View {
    let id: String
    let ctx: OrgCtx

    var body: some View {
        if let u = ctx.tree.units[id] {
            if u.isGroup {
                OrgGroupFrame(unit: u, ctx: ctx)
            } else {
                OrgCardBranch(unit: u, ctx: ctx)
            }
        }
    }
}

/// A card, its BoD and Manager boxes under it, and its row under those.
private struct OrgCardBranch: View {
    let unit: OrgUnitDTO
    let ctx: OrgCtx

    var body: some View {
        let t = ctx.tree
        let level = t.level(unit.id)
        // Ringkas: below the top only the card itself, with the size of its branch and its leaders.
        let shallow = ctx.summary && level >= 1
        let people = t.split(unit.id)
        let row = shallow ? [] : t.row(of: unit.id)
        let chipOf: [String: String] = Dictionary(
            row.compactMap { item in t.leaderChip(of: item, in: unit.id, people: people).map { (item.id, $0) } },
            uniquingKeysWith: { a, _ in a })
        let showBod = !shallow && !people.bods.isEmpty
        let showMgr = !shallow && !people.managers.isEmpty
        let band = CGFloat(34 + 12 * chipOf.count)

        VStack(spacing: 0) {
            OrgUnitCard(unit: unit, tone: tone(level), meta: meta(shallow: shallow, people: people),
                        faces: shallow ? people.bods + people.managers : [], onTap: { ctx.onUnit(unit) })
                .anchorPreference(key: OrgMarkKey.self, value: .bounds) { (!showBod && !showMgr) ? ["src": .rect($0)] : [:] }
            if showBod {
                OrgStub()
                OrgPeopleBox(unitId: unit.id, title: "\(T("Board")) · \(people.bods.count)", people: people.bods,
                             horizontal: true, chips: true, ctx: ctx)
                    .anchorPreference(key: OrgMarkKey.self, value: .bounds) { !showMgr ? ["src": .rect($0)] : [:] }
            }
            if showMgr {
                OrgStub()
                OrgPeopleBox(unitId: unit.id, title: "Manager · \(people.managers.count)", people: people.managers,
                             horizontal: true, chips: true, ctx: ctx)
                    .anchorPreference(key: OrgMarkKey.self, value: .bounds) { ["src": .rect($0)] }
            }
            if !row.isEmpty {
                Color.clear.frame(width: 1, height: band)
                HStack(alignment: .top, spacing: 24) {
                    ForEach(row) { item in
                        column(item, people: people)
                            .anchorPreference(key: OrgMarkKey.self, value: .top) { ["col:\(item.id)": .point($0)] }
                    }
                }
            }
        }
        .backgroundPreferenceValue(OrgMarkKey.self) { marks in
            GeometryReader { g in
                OrgLines.path(marks: marks, in: g, row: row, chipOf: chipOf, unitId: unit.id)
                    .stroke(OC.line, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
            }
        }
        // Everything inside has been drawn above; do not let it reach the branch around this one.
        .transformPreference(OrgMarkKey.self) { $0 = [:] }
    }

    @ViewBuilder private func column(_ item: OrgRowItem, people: OrgUnitPeople) -> some View {
        switch item {
        case .unit(let id):
            OrgNode(id: id, ctx: ctx)
        case .staff:
            OrgPeopleBox(unitId: unit.id, title: orgPeopleCount(people.staff.count), people: people.staff,
                         horizontal: false, chips: false, ctx: ctx)
        case .under(_, let leaderId):
            let box = people.under.first { $0.leader.userId == leaderId }
            OrgPeopleBox(unitId: unit.id,
                         title: String(format: T("Under %@ · %d"), box?.leader.firstName ?? "?", box?.people.count ?? 0),
                         people: box?.people ?? [], horizontal: false, chips: false, ctx: ctx)
        }
    }

    private func tone(_ level: Int) -> OrgTone {
        if unit.isIP { return level == 0 ? .top : .ip }
        if let p = ctx.tree.effectiveParent(unit.id), ctx.tree.units[p]?.kind == "DIVISION" { return .sub }
        return .division
    }

    private func meta(shallow: Bool, people: OrgUnitPeople) -> String {
        if shallow {
            let s = ctx.tree.branchStats(unit.id)
            var parts = [s.people > 0 ? orgPeopleCount(s.people) : T("no people yet")]
            if s.parts > 0 { parts.append(s.parts == 1 ? T("1 part") : String(format: T("%d parts"), s.parts)) }
            return parts.joined(separator: " · ")
        }
        let n = ctx.tree.peopleOf[unit.id]?.count ?? 0
        return n > 0 ? orgPeopleCount(n) : T("no people yet")
    }
}

/// A group: a soft tinted area with its title on top and its cards inside.
private struct OrgGroupFrame: View {
    let unit: OrgUnitDTO
    let ctx: OrgCtx

    var body: some View {
        let t = ctx.tree
        // Ringkas shows the groups right under the top with their cards, and nothing deeper.
        let hidden = ctx.summary && t.level(unit.id) > 1
        let row = hidden ? [] : t.row(of: unit.id)
        let count = t.children[unit.id]?.count ?? 0

        VStack(spacing: 0) {
            Button { ctx.onUnit(unit) } label: {
                Text("\(unit.name.uppercased()) · \(count)")
                    .font(NXFont.text(10, .bold)).tracking(1.2).foregroundStyle(NX.mutedFg)
                    .padding(.horizontal, 10).padding(.vertical, 4)
                    .background(NX.card, in: Capsule())
                    .overlay(Capsule().strokeBorder(OC.group.opacity(0.14)))
            }
            .buttonStyle(.plain)
            .anchorPreference(key: OrgMarkKey.self, value: .bounds) { ["src": .rect($0)] }
            if !row.isEmpty {
                Color.clear.frame(width: 1, height: 30)
                HStack(alignment: .top, spacing: 24) {
                    ForEach(row) { item in
                        Group {
                            switch item {
                            case .unit(let id): OrgNode(id: id, ctx: ctx)
                            default: EmptyView()
                            }
                        }
                        .anchorPreference(key: OrgMarkKey.self, value: .top) { ["col:\(item.id)": .point($0)] }
                    }
                }
            } else if count == 0 {
                Text(T("Nothing in it yet")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).padding(.top, 12)
            }
        }
        .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 18)
        .frame(minWidth: 200)
        .backgroundPreferenceValue(OrgMarkKey.self) { marks in
            GeometryReader { g in
                OrgLines.path(marks: marks, in: g, row: row, chipOf: [:], unitId: unit.id)
                    .stroke(OC.line, style: StrokeStyle(lineWidth: 1.5, lineCap: .round, lineJoin: .round))
            }
        }
        .transformPreference(OrgMarkKey.self) { $0 = [:] }
        .background(OC.group.opacity(0.05), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(OC.group.opacity(0.12)))
    }
}

private enum OrgLines {
    /// Leader lines first (each on its own 12pt track under the box: left-going ones first, the one
    /// going farthest out highest, then right-going ones the same way), then the crossbar to the
    /// rest, from the box's middle — or, when leader lines leave this box, from above the middle of
    /// the cards it serves, through a gap between two people.
    static func path(marks: [String: OrgMark], in g: GeometryProxy, row: [OrgRowItem],
                     chipOf: [String: String], unitId: String) -> Path {
        func point(_ key: String) -> CGPoint? {
            if case .point(let a)? = marks[key] { return g[a] }
            return nil
        }
        var p = Path()
        guard case .rect(let srcAnchor)? = marks["src"] else { return p }
        let src = g[srcAnchor]

        var led: [(from: CGPoint, to: CGPoint)] = []
        for item in row {
            guard let chip = chipOf[item.id], let c = point("chip:\(chip)"), let t = point("col:\(item.id)") else { continue }
            led.append((from: c, to: t))
        }
        let left = led.filter { $0.to.x < $0.from.x }.sorted { $0.to.x < $1.to.x }
        let right = led.filter { $0.to.x >= $0.from.x }.sorted { $0.to.x > $1.to.x }
        for (k, l) in (left + right).enumerated() {
            let y = src.maxY + 12 + CGFloat(k) * 12
            p.addPath(rounded([l.from, CGPoint(x: l.from.x, y: y), CGPoint(x: l.to.x, y: y), l.to]))
        }

        let targets = row.filter { chipOf[$0.id] == nil }.compactMap { point("col:\($0.id)") }
        guard !targets.isEmpty else { return p }
        let busY = (targets.map(\.y).min() ?? src.maxY) - 14
        var x = src.midX
        if !led.isEmpty, let lo = targets.map(\.x).min(), let hi = targets.map(\.x).max() {
            let want = min(src.maxX - 18, max(src.minX + 18, (lo + hi) / 2))
            if abs(want - src.midX) >= 24 {
                let chips = marks.keys.filter { $0.hasPrefix("chip:\(unitId):") }.compactMap { point($0) }
                    .filter { $0.y <= src.maxY + 1 && $0.y >= src.minY - 1 }
                    .map(\.x).sorted()
                let gaps = zip(chips, chips.dropFirst()).map { ($0 + $1) / 2 }
                x = gaps.min { abs($0 - want) < abs($1 - want) } ?? want
            }
        }
        let stem = CGPoint(x: x, y: src.maxY)
        for t in targets {
            p.addPath(rounded([stem, CGPoint(x: stem.x, y: busY), CGPoint(x: t.x, y: busY), t]))
        }
        return p
    }

    /// A right-angled path with its bends rounded (8pt, less where a leg is short).
    static func rounded(_ pts: [CGPoint], r: CGFloat = 8) -> Path {
        var p = Path()
        guard let first = pts.first else { return p }
        p.move(to: first)
        if pts.count > 2 {
            for i in 1..<(pts.count - 1) {
                let a = pts[i - 1], b = pts[i], c = pts[i + 1]
                let l1 = hypot(b.x - a.x, b.y - a.y), l2 = hypot(c.x - b.x, c.y - b.y)
                let rr = min(r, l1 / 2, l2 / 2)
                if rr < 0.5 { p.addLine(to: b); continue }
                p.addLine(to: CGPoint(x: b.x + (a.x - b.x) / l1 * rr, y: b.y + (a.y - b.y) / l1 * rr))
                p.addQuadCurve(to: CGPoint(x: b.x + (c.x - b.x) / l2 * rr, y: b.y + (c.y - b.y) / l2 * rr), control: b)
            }
        }
        if let last = pts.last { p.addLine(to: last) }
        return p
    }
}

private struct OrgStub: View {
    var body: some View { Rectangle().fill(OC.line).frame(width: 1.5, height: 20) }
}

/// Kartu IP/Team: logo (IP only), name on up to two lines, how many people.
private struct OrgUnitCard: View {
    let unit: OrgUnitDTO
    let tone: OrgTone
    let meta: String
    let faces: [OrgPersonDTO]
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(spacing: 10) {
                if unit.isIP { OrgLogo(url: unit.logoUrl, name: unit.name, size: tone == .top ? 40 : 34, rounded: 8) }
                VStack(alignment: .leading, spacing: 2) {
                    Text(unit.name)
                        .font(NXFont.text(tone == .top ? 14 : 13, .semibold))
                        .foregroundStyle(tone.text)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(meta).font(NXFont.text(10.5)).foregroundStyle(tone.meta).lineLimit(1)
                    if !faces.isEmpty {
                        HStack(spacing: -6) {
                            ForEach(faces.prefix(4)) { p in
                                AvatarView(url: p.avatar, initial: p.initial, size: 20, userId: p.userId, name: p.displayName)
                                    .overlay(Circle().stroke(tone.fill, lineWidth: 2))
                            }
                            if faces.count > 4 {
                                Text("+\(faces.count - 4)").font(NXFont.text(10, .semibold)).foregroundStyle(tone.meta)
                                    .padding(.leading, 10)
                            }
                        }
                        .padding(.top, 4)
                    }
                }
            }
            .padding(.horizontal, 12).padding(.vertical, tone == .top ? 12 : 10)
            .frame(minWidth: tone == .top ? 212 : 176, maxWidth: 232, alignment: .leading)
            .background(tone.fill, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                if let b = tone.border {
                    RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(b)
                }
            }
            .shadow(color: .black.opacity(tone.border == nil ? 0.18 : 0.05), radius: 4, y: 2)
        }
        .buttonStyle(.plain)
    }
}

/// BoD / Manager chips side by side, staff and "di bawah" lists stacked (six or more in two columns).
private struct OrgPeopleBox: View {
    let unitId: String
    let title: String
    let people: [OrgPersonDTO]
    let horizontal: Bool
    /// Leaders' chips mark where their lines start.
    let chips: Bool
    let ctx: OrgCtx

    var body: some View {
        VStack(spacing: 4) {
            Text(title.uppercased()).font(NXFont.text(9.5, .bold)).tracking(0.9).foregroundStyle(NX.mutedFg)
                .padding(.top, 1)
            if horizontal {
                HStack(alignment: .top, spacing: 4) {
                    ForEach(people) { p in row(p) }
                }
            } else if people.count >= 6 {
                let half = (people.count + 1) / 2
                HStack(alignment: .top, spacing: 4) {
                    VStack(alignment: .leading, spacing: 2) { ForEach(people.prefix(half)) { p in row(p) } }
                    VStack(alignment: .leading, spacing: 2) { ForEach(people.dropFirst(half)) { p in row(p) } }
                }
            } else {
                VStack(alignment: .leading, spacing: 2) { ForEach(people) { p in row(p) } }
            }
        }
        .padding(6)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(NX.border))
    }

    private func row(_ p: OrgPersonDTO) -> some View {
        Button { ctx.onPerson(p) } label: {
            HStack(spacing: 8) {
                AvatarView(url: p.avatar, initial: p.initial, size: 26, userId: p.userId, name: p.displayName)
                VStack(alignment: .leading, spacing: 1) {
                    Text(p.displayName).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(subline(p)).font(NXFont.text(10)).foregroundStyle(NX.mutedFg).lineLimit(1)
                }
            }
            .padding(.horizontal, 6).padding(.vertical, 4)
            .frame(minWidth: 148, maxWidth: 212, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .anchorPreference(key: OrgMarkKey.self, value: .bottom) { chips ? ["chip:\(unitId):\(p.userId)": .point($0)] : [:] }
    }

    private func subline(_ p: OrgPersonDTO) -> String {
        var parts: [String] = []
        if let t = p.title(in: unitId) { parts.append(t) }
        parts.append(orgRoleLabel(p.role))
        if p.unitIds.count > 1 { parts.append(String(format: T("+%d more IP/Team"), p.unitIds.count - 1)) }
        return parts.joined(separator: " · ")
    }
}

/// An IP's logo. Mostly-light logos (white text on a transparent PNG) sit on dark navy, others on
/// white — a white logo vanished on the white tile (owner, 30 Sep 2026). Read from the image cache
/// first, so an exported PNG has the logos too.
private struct OrgLogo: View {
    let url: String?
    let name: String
    let size: CGFloat
    let rounded: CGFloat
    /// Drawn on a light surface (a filter chip), not a dark card: the initials stand-in must not be white.
    var onLight = false
    @State private var image: UIImage? = nil
    @State private var light = false

    init(url: String?, name: String, size: CGFloat, rounded: CGFloat, onLight: Bool = false) {
        self.url = url
        self.name = name
        self.size = size
        self.rounded = rounded
        self.onLight = onLight
        if let u = OrgLogo.resolve(url),
           let hit = ImageLoader.memory.object(forKey: ImageLoader.cacheKey(u, ImageLoader.tilePixel) as NSURL) {
            _image = State(initialValue: hit)
            _light = State(initialValue: OrgLogo.isLight(hit))
        }
    }

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit().padding(size > 20 ? 2 : 1)
                    .frame(width: size, height: size)
                    .background(light ? Color(hex: "#0f1b2d") : Color.white,
                                in: RoundedRectangle(cornerRadius: rounded, style: .continuous))
            } else {
                // White on a white chip was an empty gap before the IP's name (visual QA 24 Oct 2026, iPad).
                Text(initials).font(NXFont.text(size > 20 ? 11 : 7, .bold)).foregroundStyle(onLight ? NX.mutedFg : .white)
                    .frame(width: size, height: size)
                    .background(onLight ? NX.muted : Color.white.opacity(0.18), in: RoundedRectangle(cornerRadius: rounded, style: .continuous))
            }
        }
        .task(id: url) {
            guard image == nil, let u = OrgLogo.resolve(url), let img = await ImageLoader.shared.image(for: u) else { return }
            light = OrgLogo.isLight(img)
            image = img
        }
    }

    private var initials: String {
        String(name.split(separator: " ").prefix(2).compactMap { $0.first }).uppercased()
    }

    static func resolve(_ url: String?) -> URL? {
        guard let url, !url.isEmpty else { return nil }
        return URL(string: url.hasPrefix("http") ? url : Config.baseURL.absoluteString + url)
    }

    /// Average brightness of the visible pixels, from a 32×32 copy.
    static func isLight(_ img: UIImage) -> Bool {
        guard let cg = img.cgImage else { return false }
        let w = 32, h = 32
        var px = [UInt8](repeating: 0, count: w * h * 4)
        // The context draws into the array's own bytes, so it lives only inside this closure.
        let drawn: Bool = px.withUnsafeMutableBytes { buf in
            guard let ctx = CGContext(data: buf.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                                      space: CGColorSpaceCreateDeviceRGB(),
                                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return false }
            ctx.draw(cg, in: CGRect(x: 0, y: 0, width: w, height: h))
            return true
        }
        guard drawn else { return false }
        var sum = 0.0, n = 0.0
        for i in stride(from: 0, to: px.count, by: 4) {
            let a = Double(px[i + 3]) / 255
            if a < 0.2 { continue }
            // Premultiplied: undo the alpha before weighing the colour.
            let r = Double(px[i]) / 255 / a, gr = Double(px[i + 1]) / 255 / a, b = Double(px[i + 2]) / 255 / a
            sum += 0.2126 * r + 0.7152 * gr + 0.0722 * b
            n += 1
        }
        return n > 0 && sum / n > 0.72
    }
}

// MARK: - change a card / add one

/// "1 person" / "12 people" in either language.
private func orgPeopleCount(_ n: Int) -> String {
    n == 1 ? T("1 person") : String(format: T("%d people"), n)
}

private struct OrgKindOption: Identifiable {
    let kind: String
    let title: String
    let sub: String
    let icon: String
    var id: String { kind }
}

private let orgKinds: [OrgKindOption] = [
    OrgKindOption(kind: "IP", title: "IP / Company", sub: "Has its own logo", icon: "building.2.fill"),
    OrgKindOption(kind: "DIVISION", title: "Division / Team", sub: "A working team, no logo", icon: "person.2.fill"),
    OrgKindOption(kind: "GROUP", title: "Group", sub: "Only arranges cards", icon: "square.grid.2x2.fill"),
]

/// Tambah atau ubah satu kartu: jenis, nama, logo, letak, pemimpin, dan jabatan orang-orangnya.
private struct OrgUnitSheet: View {
    let tree: OrgTree
    let unit: OrgUnitDTO?
    let initialParent: String?
    let onFocus: ((String) -> Void)?
    let onAddChild: ((String) -> Void)?
    let onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var name: String
    @State private var kind: String
    @State private var kindPicked: Bool
    @State private var parentId: String?
    @State private var leadUserId: String?
    @State private var logoURL: String?
    @State private var pendingLogo: Data? = nil
    @State private var pickedLogo: PhotosPickerItem? = nil
    @State private var busy = false
    @State private var problem: String? = nil
    @State private var confirmDelete = false

    init(tree: OrgTree, unit: OrgUnitDTO?, initialParent: String?, onFocus: ((String) -> Void)?,
         onAddChild: ((String) -> Void)?, onDone: @escaping () async -> Void) {
        self.tree = tree
        self.unit = unit
        self.initialParent = initialParent
        self.onFocus = onFocus
        self.onAddChild = onAddChild
        self.onDone = onDone
        _name = State(initialValue: unit?.name ?? "")
        _kind = State(initialValue: unit?.kind ?? OrgUnitSheet.guessKind(tree, initialParent))
        _kindPicked = State(initialValue: unit != nil)
        _parentId = State(initialValue: initialParent)
        _leadUserId = State(initialValue: unit?.leadUserId)
        _logoURL = State(initialValue: unit?.logoUrl)
    }

    /// A new card guesses its kind from the cards it will sit next to — a company under the top, a
    /// division under a company — until a kind is picked by hand.
    static func guessKind(_ tree: OrgTree, _ parentId: String?) -> String {
        guard let pid = parentId else { return "IP" }
        let next = (tree.children[pid] ?? []).filter { !$0.isGroup }
        if !next.isEmpty { return next.filter(\.isIP).count * 2 > next.count ? "IP" : "DIVISION" }
        if let p = tree.units[pid], p.parentId == nil, !p.isGroup { return "IP" }
        return "DIVISION"
    }

    private var isGroup: Bool { kind == "GROUP" }
    private var parent: OrgUnitDTO? { parentId.flatMap { tree.units[$0] } }
    /// The card whose BoD/Manager may lead this one: the parent, or the card above its group(s).
    private var leadCard: String? {
        guard let pid = parentId, let p = tree.units[pid] else { return nil }
        return p.isGroup ? tree.effectiveParent(pid) : pid
    }
    private var leadCandidates: [OrgPersonDTO] {
        guard let c = leadCard else { return [] }
        return (tree.peopleOf[c] ?? []).filter(\.isLeader)
    }
    private var cardPeople: [OrgPersonDTO] { unit.map { tree.peopleOf[$0.id] ?? [] } ?? [] }
    private var groupBlocked: Bool { isGroup && unit?.kind != "GROUP" && !cardPeople.isEmpty }
    private var excluded: Set<String> {
        guard let u = unit else { return [] }
        return tree.descendants(u.id).union([u.id])
    }
    private func kindTitle(_ k: OrgKindOption) -> String {
        k.kind == "DIVISION" && parent?.kind == "DIVISION" ? T("Sub-division") : T(k.title)
    }
    private var examples: [String] {
        tree.units.values
            .filter { $0.kind == kind && $0.id != unit?.id && (kind != "IP" || $0.parentId != nil) }
            .sorted(by: OrgTree.byPosition).prefix(3).map(\.name)
    }

    var body: some View {
        Form {
            Section {
                ForEach(orgKinds) { k in
                    Button {
                        kind = k.kind
                        kindPicked = true
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: k.icon).font(.system(size: 14, weight: .semibold))
                                .foregroundStyle(k.kind == "IP" ? Color.white : OC.accentText)
                                .frame(width: 30, height: 30)
                                .background(k.kind == "IP" ? OC.ip : OC.division, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            VStack(alignment: .leading, spacing: 1) {
                                Text(kindTitle(k)).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                                Text(T(k.sub)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            }
                            Spacer()
                            if kind == k.kind { Image(systemName: "checkmark").foregroundStyle(OC.accentText) }
                        }
                    }
                    .buttonStyle(.plain)
                }
            } header: {
                Text(unit == nil ? T("What are you adding?") : T("Kind"))
            } footer: {
                if groupBlocked {
                    Text(cardPeople.count == 1 ? T("This card still has 1 person. Remove them before making it a group.") : String(format: T("This card still has %d people. Remove them before making it a group."), cardPeople.count))
                        .foregroundStyle(NX.danger)
                } else if isGroup {
                    Text(T("A group only arranges cards — no logo, no people, no leader."))
                } else if !examples.isEmpty {
                    Text("\(T("Examples in the chart:")) \(examples.joined(separator: ", "))")
                }
            }

            Section(T("Name")) {
                TextField(kind == "IP" ? T("e.g. PATS") : kind == "GROUP" ? T("e.g. Creative") : T("e.g. Multimedia"), text: $name)
                    .textInputAutocapitalization(.words)
            }

            if kind == "IP" {
                Section {
                    HStack(spacing: 14) {
                        logoPreview
                        PhotosPicker(selection: $pickedLogo, matching: .images, photoLibrary: .shared()) {
                            Label((logoURL != nil || pendingLogo != nil) ? T("Change logo") : T("Add logo"), systemImage: "photo")
                                .font(NXFont.text(13, .semibold))
                        }
                        .disabled(busy)
                        if logoURL != nil || pendingLogo != nil {
                            Button(T("Delete"), role: .destructive) { Task { await removeLogo() } }
                                .font(NXFont.text(13)).disabled(busy)
                        }
                    }
                } header: { Text(T("Logo")) } footer: {
                    Text(unit == nil ? T("Optional, you can add it later. PNG, JPG or WebP · max 2 MB.") : T("PNG, JPG or WebP · max 2 MB · square works best."))
                }
            }

            Section(T("Placement")) {
                NavigationLink {
                    OrgParentPicker(tree: tree, excluded: excluded, selection: $parentId)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(parent?.name ?? T("Top level")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                        let trail = parentId.map { tree.trail($0) } ?? ""
                        Text(parent == nil ? T("no parent") : (trail.isEmpty ? T("top level") : trail))
                            .font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(2)
                    }
                }
            }
            .onChange(of: parentId) { _, new in
                if !kindPicked { kind = OrgUnitSheet.guessKind(tree, new) }
            }

            if !isGroup, parentId != nil, !leadCandidates.isEmpty {
                Section {
                    Picker(T("Led by"), selection: $leadUserId) {
                        Text(T("None")).tag(String?.none)
                        ForEach(leadCandidates) { p in
                            Text("\(p.displayName) · \(leadCard.flatMap { p.title(in: $0) } ?? orgRoleLabel(p.role))")
                                .tag(Optional(p.userId))
                        }
                    }
                } footer: {
                    Text(T("This card is drawn under the person you pick, with its line coming from them."))
                }
            }

            if let unit, !isGroup, !cardPeople.isEmpty {
                Section {
                    ForEach(cardPeople) { p in
                        OrgTitleRow(person: p, unitId: unit.id,
                                    leaders: cardPeople.filter { $0.userId != p.userId && $0.isLeader },
                                    onSaved: { await onDone() })
                    }
                } header: {
                    Text("\(T("People on this card")) · \(cardPeople.count)")
                } footer: {
                    Text(T("Job titles show on the chart, e.g. CEO, CMO or Lead."))
                }
            }

            if let unit {
                Section {
                    if let onFocus {
                        Button { onFocus(unit.id) } label: { Label(T("Open on its own"), systemImage: "scope") }
                    }
                    if let onAddChild {
                        Button { onAddChild(unit.id) } label: {
                            Label(unit.isGroup ? T("Add to this group") : T("Add below it"), systemImage: "plus")
                        }
                    }
                    Button(role: .destructive) { confirmDelete = true } label: { Label(T("Delete"), systemImage: "trash") }
                }
            }

            if let problem {
                Section { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) }
            }
        }
        .navigationTitle(unit?.name ?? (parent.map { String(format: T("Add under %@"), $0.name) } ?? T("Add to the chart")))
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } }
            ToolbarItem(placement: .confirmationAction) {
                if busy { ProgressView() } else {
                    Button(unit == nil ? T("Add") : T("Save")) { Task { await save() } }
                        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty || groupBlocked)
                }
            }
        }
        .onChange(of: pickedLogo) { _, item in
            if let item { Task { await pick(item) } }
        }
        // A centred alert, never a confirmationDialog (owner, 29 Sep 2026 — 173ffff).
        .alert(T("Delete this card?"), isPresented: $confirmDelete) {
            Button(T("Delete"), role: .destructive) { Task { await remove() } }
            Button(T("Cancel"), role: .cancel) {}
        } message: {
            Text(T("Its people are removed from this card (they stay in their other IP/Teams) and what is inside it moves up to its parent. No project access changes."))
        }
    }

    @ViewBuilder private var logoPreview: some View {
        if let pendingLogo, let img = UIImage(data: pendingLogo) {
            Image(uiImage: img).resizable().scaledToFit().padding(3)
                .frame(width: 48, height: 48)
                .background(OrgLogo.isLight(img) ? Color(hex: "#0f1b2d") : Color.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
        } else if logoURL != nil {
            OrgLogo(url: logoURL, name: name, size: 48, rounded: 10)
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(NX.border))
        } else {
            Image(systemName: "photo").font(.system(size: 18)).foregroundStyle(NX.mutedFg)
                .frame(width: 48, height: 48)
                .background(NX.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
    }

    /// PNG keeps a transparent logo transparent; at most 512 px on the long side.
    private func pick(_ item: PhotosPickerItem) async {
        defer { pickedLogo = nil }
        guard let raw = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: raw) else {
            problem = T("Couldn't read that image."); return
        }
        let scale = min(1, 512 / max(image.size.width, image.size.height))
        let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: size, format: format).image { _ in image.draw(in: CGRect(origin: .zero, size: size)) }
        guard let png = resized.pngData() else { problem = T("Couldn't read that image."); return }
        guard png.count <= 2 * 1024 * 1024 else { problem = T("The logo can be 2 MB at most."); return }
        guard let unit else { pendingLogo = png; return }
        busy = true
        problem = nil
        defer { busy = false }
        do {
            let saved = try await APIClient.shared.uploadOrgUnitLogo(unitId: unit.id, data: png, mime: "image/png", fileName: "logo.png")
            logoURL = saved.logoUrl
            await onDone()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't upload the logo.")
        }
    }

    private func removeLogo() async {
        guard let unit else { pendingLogo = nil; return }
        busy = true
        problem = nil
        defer { busy = false }
        do {
            try await APIClient.shared.updateOrgUnit(unit.id, fields: ["logoUrl": NSNull()])
            logoURL = nil
            await onDone()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't remove the logo.")
        }
    }

    private func save() async {
        let clean = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !clean.isEmpty else { return }
        let validLead = leadUserId.flatMap { id in leadCandidates.contains { $0.userId == id } ? id : nil }
        busy = true
        problem = nil
        defer { busy = false }
        do {
            if let unit {
                try await APIClient.shared.updateOrgUnit(unit.id, fields: [
                    "name": clean, "kind": kind,
                    "parentId": jsonOrNull(parentId),
                    "leadUserId": jsonOrNull(isGroup ? nil : validLead),
                ])
            } else {
                let made = try await APIClient.shared.createOrgUnit(name: clean, parentId: parentId, kind: kind)
                if !isGroup, let validLead {
                    try await APIClient.shared.updateOrgUnit(made.id, fields: ["leadUserId": validLead])
                }
                if kind == "IP", let pendingLogo {
                    // The card exists already; a failed logo is said, not undone.
                    do { try await APIClient.shared.uploadOrgUnitLogo(unitId: made.id, data: pendingLogo, mime: "image/png", fileName: "logo.png") }
                    catch { problem = T("The card was created, but its logo didn't upload. Add it again from the card.") }
                }
            }
            await onDone()
            if problem == nil { dismiss() }
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save.")
        }
    }

    private func remove() async {
        guard let unit else { return }
        busy = true
        problem = nil
        defer { busy = false }
        do {
            try await APIClient.shared.deleteOrgUnit(unit.id)
            await onDone()
            dismiss()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't delete.")
        }
    }
}

/// One person's job title and who they sit under, on one card. The title is saved on Return or
/// when the field loses focus; empty = no title.
private struct OrgTitleRow: View {
    let person: OrgPersonDTO
    let unitId: String
    let leaders: [OrgPersonDTO]
    let onSaved: () async -> Void

    @State private var title: String
    @State private var saving = false
    @State private var problem: String? = nil
    @FocusState private var focused: Bool

    init(person: OrgPersonDTO, unitId: String, leaders: [OrgPersonDTO], onSaved: @escaping () async -> Void) {
        self.person = person
        self.unitId = unitId
        self.leaders = leaders
        self.onSaved = onSaved
        _title = State(initialValue: person.title(in: unitId) ?? "")
    }

    private var under: String? { person.reportsTo?[unitId] }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                AvatarView(url: person.avatar, initial: person.initial, size: 28, userId: person.userId, name: person.displayName)
                VStack(alignment: .leading, spacing: 1) {
                    Text(person.displayName).font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                    Text(orgRoleLabel(person.role)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                }
                Spacer(minLength: 8)
                if saving { ProgressView().controlSize(.small) }
            }
            HStack(spacing: 8) {
                TextField(T("Job title"), text: $title)
                    .font(NXFont.text(13))
                    .textInputAutocapitalization(.words)
                    .focused($focused)
                    .onSubmit { Task { await saveTitle() } }
                    .padding(.horizontal, 10).padding(.vertical, 7)
                    .background(NX.muted, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                if !person.isSenior, !leaders.isEmpty {
                    Menu {
                        Button(T("Not under anyone")) { Task { await saveUnder(nil) } }
                        ForEach(leaders) { l in
                            Button(l.displayName) { Task { await saveUnder(l.userId) } }
                        }
                    } label: {
                        HStack(spacing: 4) {
                            Text(under.flatMap { id in leaders.first { $0.userId == id }?.firstName }.map { String(format: T("under %@"), $0) } ?? T("under —"))
                                .font(NXFont.text(12)).lineLimit(1)
                            Image(systemName: "chevron.up.chevron.down").font(.system(size: 9, weight: .semibold))
                        }
                        .foregroundStyle(OC.accentText)
                        .padding(.horizontal, 10).padding(.vertical, 7)
                        .background(NX.muted, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
            }
            if let problem { Text(problem).font(NXFont.text(11)).foregroundStyle(NX.danger) }
        }
        .padding(.vertical, 2)
        .onChange(of: focused) { _, isFocused in
            if !isFocused { Task { await saveTitle() } }
        }
    }

    private func saveTitle() async {
        let next = title.trimmingCharacters(in: .whitespaces)
        guard next != (person.title(in: unitId) ?? ""), !saving else { return }
        saving = true
        problem = nil
        defer { saving = false }
        do {
            try await APIClient.shared.setOrgUnitMemberTitle(userId: person.userId, unitId: unitId, title: next.isEmpty ? nil : next)
            await onSaved()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save the job title.")
        }
    }

    private func saveUnder(_ leaderId: String?) async {
        saving = true
        problem = nil
        defer { saving = false }
        do {
            try await APIClient.shared.setOrgUnitMemberReportsTo(userId: person.userId, unitId: unitId, leaderId: leaderId)
            await onSaved()
        } catch {
            problem = (error as? LocalizedError)?.errorDescription ?? T("Couldn't save who they are under.")
        }
    }
}

private struct OrgPickRow: Identifiable {
    let unit: OrgUnitDTO
    let depth: Int
    var id: String { unit.id }
}

/// Where a card sits: the whole chart as an indented list (its own branch left out — it cannot sit
/// inside itself); searching turns it into a flat list with each one's path.
private struct OrgParentPicker: View {
    let tree: OrgTree
    let excluded: Set<String>
    @Binding var selection: String?
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    private var rows: [OrgPickRow] {
        var out: [OrgPickRow] = []
        var seen: Set<String> = []
        func walk(_ list: [OrgUnitDTO], _ depth: Int) {
            for u in list where !excluded.contains(u.id) && seen.insert(u.id).inserted {
                out.append(OrgPickRow(unit: u, depth: depth))
                walk(tree.children[u.id] ?? [], depth + 1)
            }
        }
        walk(tree.roots, 0)
        return out
    }

    var body: some View {
        let needle = query.trimmingCharacters(in: .whitespaces).lowercased()
        let shown = needle.isEmpty ? rows : rows.filter { tree.path($0.unit.id).map(\.name).joined(separator: " › ").lowercased().contains(needle) }
        List {
            if needle.isEmpty {
                Button { selection = nil; dismiss() } label: {
                    HStack(spacing: 10) {
                        Image(systemName: "arrow.up.to.line").frame(width: 24).foregroundStyle(NX.mutedFg)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(T("Top level")).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                            Text(T("no parent")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                        }
                        Spacer()
                        if selection == nil { Image(systemName: "checkmark").foregroundStyle(OC.accentText) }
                    }
                }
                .buttonStyle(.plain)
            }
            ForEach(shown) { r in
                Button { selection = r.unit.id; dismiss() } label: {
                    HStack(spacing: 10) {
                        if r.unit.isIP {
                            OrgLogo(url: r.unit.logoUrl, name: r.unit.name, size: 24, rounded: 6)
                        } else {
                            Image(systemName: r.unit.isGroup ? "square.grid.2x2" : "person.2")
                                .font(.system(size: 12, weight: .semibold)).foregroundStyle(OC.accentText)
                                .frame(width: 24, height: 24)
                                .background(OC.division, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(r.unit.name).font(NXFont.text(14, selection == r.unit.id ? .semibold : .regular)).foregroundStyle(NX.foreground)
                            if !needle.isEmpty, !tree.trail(r.unit.id).isEmpty {
                                Text(tree.trail(r.unit.id)).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                            } else if r.unit.isGroup {
                                Text(T("group")).font(NXFont.text(11)).foregroundStyle(NX.mutedFg)
                            }
                        }
                        Spacer()
                        if selection == r.unit.id { Image(systemName: "checkmark").foregroundStyle(OC.accentText) }
                    }
                    .padding(.leading, needle.isEmpty ? CGFloat(r.depth) * 18 : 0)
                }
                .buttonStyle(.plain)
            }
        }
        .searchable(text: $query, prompt: T("Search IP, division or group…"))
        .navigationTitle(T("Placement"))
        .navigationBarTitleDisplayMode(.inline)
    }
}

// MARK: - place a person

private struct OrgLeaderRow: Identifiable {
    let leader: OrgPersonDTO
    let unit: OrgUnitDTO
    var id: String { "\(leader.userId):\(unit.id)" }
}

/// Taruh di bawah seseorang, atau centang IP/Team-nya. Tiap pilihan langsung tersimpan.
private struct OrgPersonSheet: View {
    let tree: OrgTree
    let person: OrgPersonDTO
    let onDone: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var memberOf: Set<String>
    @State private var reportsTo: [String: String]
    @State private var busy = false
    @State private var problem: String? = nil
    @State private var query = ""

    init(tree: OrgTree, person: OrgPersonDTO, onDone: @escaping () async -> Void) {
        self.tree = tree
        self.person = person
        self.onDone = onDone
        _memberOf = State(initialValue: Set(person.unitIds))
        _reportsTo = State(initialValue: person.reportsTo ?? [:])
    }

    private var needle: String { query.trimmingCharacters(in: .whitespaces).lowercased() }
    private var leaderRows: [OrgLeaderRow] {
        tree.people
            .filter { $0.userId != person.userId && $0.isLeader }
            .flatMap { l in l.unitIds.compactMap { id in tree.units[id].flatMap { $0.isGroup ? nil : OrgLeaderRow(leader: l, unit: $0) } } }
            .filter { r in needle.isEmpty || "\(r.leader.displayName) \(r.leader.title(in: r.unit.id) ?? "") \(r.unit.name)".lowercased().contains(needle) }
            .sorted { ($0.leader.displayName.lowercased(), $0.unit.name.lowercased()) < ($1.leader.displayName.lowercased(), $1.unit.name.lowercased()) }
    }
    private var unitRows: [OrgUnitDTO] {
        tree.units.values
            .filter { !$0.isGroup }
            .filter { u in needle.isEmpty || tree.path(u.id).map(\.name).joined(separator: " ").lowercased().contains(needle) }
            .sorted { tree.path($0.id).map(\.name).joined(separator: " › ").localizedCaseInsensitiveCompare(tree.path($1.id).map(\.name).joined(separator: " › ")) == .orderedAscending }
    }

    var body: some View {
        List {
            if !person.isSenior {
                Section {
                    ForEach(reportsTo.sorted(by: { $0.key < $1.key }), id: \.key) { unitId, leaderId in
                        if let u = tree.units[unitId], let l = tree.people.first(where: { $0.userId == leaderId }) {
                            HStack {
                                Text(String(format: T("Now under %@ · %@"), l.displayName, u.name)).font(NXFont.text(12))
                                Spacer()
                                Button(T("Release")) { Task { await release(unitId) } }
                                    .font(NXFont.text(12, .semibold)).foregroundStyle(NX.danger).disabled(busy)
                            }
                        }
                    }
                    ForEach(leaderRows) { r in
                        let on = reportsTo[r.unit.id] == r.leader.userId
                        Button { Task { await place(r) } } label: {
                            HStack(spacing: 10) {
                                AvatarView(url: r.leader.avatar, initial: r.leader.initial, size: 28, userId: r.leader.userId, name: r.leader.displayName)
                                VStack(alignment: .leading, spacing: 1) {
                                    Text(r.leader.displayName + (r.leader.title(in: r.unit.id).map { " — \($0)" } ?? ""))
                                        .font(NXFont.text(13, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                    Text(r.unit.name).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1)
                                }
                                Spacer()
                                if on { Text(T("current")).font(NXFont.text(11, .semibold)).foregroundStyle(OC.accentText) }
                            }
                        }
                        .buttonStyle(.plain)
                        .disabled(busy || on)
                    }
                } header: { Text(T("Under whom")) }
            }
            Section {
                ForEach(unitRows) { u in
                    Toggle(isOn: Binding(get: { memberOf.contains(u.id) }, set: { on in Task { await toggle(u.id, on) } })) {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(u.name).font(NXFont.text(14, .semibold)).foregroundStyle(NX.foreground)
                            let trail = tree.trail(u.id)
                            if !trail.isEmpty { Text(trail).font(NXFont.text(11)).foregroundStyle(NX.mutedFg).lineLimit(1) }
                        }
                    }
                    .disabled(busy)
                }
            } header: { Text(T("IP/Team")) } footer: {
                Text(T("One person can be in several IP/Teams. Project access doesn't change."))
            }
            if let problem { Section { Text(problem).font(NXFont.text(12)).foregroundStyle(NX.danger) } }
        }
        .searchable(text: $query, prompt: T("Search name, job title or IP/Team…"))
        .navigationTitle(person.displayName)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                if busy { ProgressView() } else { Button(T("Done")) { dismiss() } }
            }
        }
    }

    private func act(_ work: () async throws -> Void) async {
        busy = true
        problem = nil
        defer { busy = false }
        do { try await work(); await onDone() }
        catch { problem = (error as? LocalizedError)?.errorDescription ?? T("Try again.") }
    }

    /// In the leader's card first if they are not there yet, then under the leader — one step.
    private func place(_ r: OrgLeaderRow) async {
        await act {
            if !memberOf.contains(r.unit.id) {
                try await APIClient.shared.addOrgUnitMember(userId: person.userId, unitId: r.unit.id)
                memberOf.insert(r.unit.id)
            }
            try await APIClient.shared.setOrgUnitMemberReportsTo(userId: person.userId, unitId: r.unit.id, leaderId: r.leader.userId)
            reportsTo[r.unit.id] = r.leader.userId
        }
    }

    private func release(_ unitId: String) async {
        await act {
            try await APIClient.shared.setOrgUnitMemberReportsTo(userId: person.userId, unitId: unitId, leaderId: nil)
            reportsTo[unitId] = nil
        }
    }

    private func toggle(_ unitId: String, _ on: Bool) async {
        await act {
            if on {
                try await APIClient.shared.addOrgUnitMember(userId: person.userId, unitId: unitId)
                memberOf.insert(unitId)
            } else {
                try await APIClient.shared.removeOrgUnitMember(userId: person.userId, unitId: unitId)
                memberOf.remove(unitId)
                reportsTo[unitId] = nil
            }
        }
    }
}
