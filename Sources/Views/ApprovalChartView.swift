import SwiftUI
import UIKit

/// Bagan Approval di HP — pohon yang sama dengan web (`apps/nexus-lovable-ui/src/components/
/// ApprovalChart.tsx`), bukan daftar bertingkat.
///
/// Daftar bertingkat yang dulu dipakai di sini menjawab "siapa di bawah siapa" satu bagian per
/// atasan, tapi tidak pernah memperlihatkan RANTAINYA: willy → gerro → riri terbaca sebagai tiga
/// bagian yang tidak berhubungan. BoD menggambar bagan itu di web supaya rantainya terlihat, lalu
/// membuka HP dan mendapat bentuk lain. Sekarang bentuknya satu.
///
/// Kanvasnya UIScrollView, bukan gesture SwiftUI: cubit-zoom dan geser yang halus dengan inersia
/// dan batas tepi adalah pekerjaan yang sudah diselesaikan UIKit sepuluh tahun lalu, dan meniru
/// itu dengan MagnifyGesture + DragGesture selalu patah-patah di pohon selebar ini.
struct ApprovalChartView: View {
    let members: [WorkspaceRoster.Member]
    let workspaceId: String
    var onChanged: () async -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var pick: ApproverPickTarget?
    @State private var busy = false
    @State private var problem: String?
    @State private var fitTrigger = 0
    @State private var shareItem: ShareItem?
    /// The chart's own edges (GET /api/admin/approval-chart). Since 13 Oct 2026 the members list withholds
    /// approverId for people outside a Manager's own chain (personal attendance data), which drew the rest
    /// of the company as "not placed"; the chart endpoint keeps every edge. nil = not loaded / older server:
    /// the members' own approverId is used, as before.
    @State private var chartEdges: [String: String]?

    // MARK: data

    /// Who approves `p`: the chart's edge when the chart answered, else the member row's.
    private func approverOf(_ p: WorkspaceRoster.Member) -> String? {
        if let edges = chartEdges, let uid = p.userId { return edges[uid] }
        return p.approverId
    }

    private var people: [WorkspaceRoster.Member] { members.filter { $0.userId != nil } }
    private var byId: [String: WorkspaceRoster.Member] {
        Dictionary(people.map { ($0.userId!, $0) }, uniquingKeysWith: { a, _ in a })
    }
    private static func tier(_ r: String?) -> Int { ["ONE_ABOVE_ALL": 0, "BOD": 1, "MANAGER": 2, "STAFF": 3][r ?? "STAFF"] ?? 4 }
    private static func isSenior(_ p: WorkspaceRoster.Member) -> Bool { p.role == "BOD" || p.role == "ONE_ABOVE_ALL" }
    private func sorted(_ xs: [WorkspaceRoster.Member]) -> [WorkspaceRoster.Member] {
        xs.sorted { (Self.tier($0.role), $0.displayName.lowercased()) < (Self.tier($1.role), $1.displayName.lowercased()) }
    }
    /// Bawahan langsung per atasan. Atasan yang tidak ada di workspace = tidak punya atasan.
    private var children: [String: [WorkspaceRoster.Member]] {
        var m: [String: [WorkspaceRoster.Member]] = [:]
        for p in people {
            if let a = approverOf(p), byId[a] != nil { m[a, default: []].append(p) }
        }
        return m.mapValues(sorted)
    }
    private var roots: [WorkspaceRoster.Member] {
        sorted(people.filter { p in approverOf(p).map { byId[$0] == nil } ?? true })
    }
    private func hasKids(_ p: WorkspaceRoster.Member) -> Bool { !(children[p.userId!] ?? []).isEmpty }
    /// Pohon: siapa pun tanpa atasan yang punya bawahan, plus BoD tanpa bawahan (mereka tetap
    /// puncak, dan BoD yang hilang dari bagan cuma karena belum punya staff itu pertanyaan yang
    /// pernah diajukan). Yang bukan BoD, tanpa atasan DAN tanpa bawahan → chip "belum ditaruh".
    private var trees: [WorkspaceRoster.Member] { roots.filter { hasKids($0) || Self.isSenior($0) } }
    private var alone: [WorkspaceRoster.Member] { roots.filter { !Self.isSenior($0) && !hasKids($0) } }
    private var placed: Int { people.filter { p in approverOf(p).map { byId[$0] != nil } ?? false }.count }
    private var unplaced: Int { roots.filter { !Self.isSenior($0) }.count }

    // MARK: body

    var body: some View {
        NavigationStack {
            ZStack(alignment: .top) {
                NX.background.ignoresSafeArea()
                ZoomableCanvas(fitTrigger: fitTrigger) { chartContent }
                    .ignoresSafeArea(edges: .bottom)
                statsStrip
            }
            .navigationTitle(T("Bagan Approval"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(T("Close")) { dismiss() } }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if busy { ProgressView() }
                    Button { fitTrigger += 1 } label: { Image(systemName: "arrow.down.left.and.arrow.up.right") }
                        .accessibilityLabel(T("Pas ke layar"))
                    Button { exportPNG() } label: { Image(systemName: "square.and.arrow.up") }
                        .accessibilityLabel(T("Bagikan sebagai gambar"))
                }
            }
            .sheet(item: $pick) { t in
                NavigationStack {
                    ApproverPickSheet(target: t, candidates: candidates(for: t)) { approverId in
                        pick = nil
                        Task {
                            busy = true
                            problem = nil
                            do {
                                try await APIClient.shared.setAttendanceApprover(memberId: t.memberId, approverId: approverId, workspaceId: t.workspaceId)
                                await onChanged()
                            } catch {
                                problem = (error as? LocalizedError)?.errorDescription ?? T("Gagal memindahkan.")
                            }
                            busy = false
                        }
                    }
                }
            }
            .sheet(item: $shareItem) { item in ActivityView(items: [item.url]) }
            .task(id: members.count) { await loadEdges() }
        }
    }

    private func loadEdges() async {
        guard let chart = try? await APIClient.shared.approvalChartEdges() else { return }
        var edges: [String: String] = [:]
        for person in chart.people ?? [] {
            if let uid = person.userId, let a = person.approverId { edges[uid] = a }
        }
        chartEdges = edges
    }

    private var statsStrip: some View {
        HStack(spacing: 12) {
            stat(placed, T("punya atasan"), tone: nil)
            stat(unplaced, T("belum ditaruh"), tone: unplaced == 0 ? NX.success : NX.warning)
            stat(trees.count, T("puncak"), tone: nil)
            Spacer(minLength: 0)
            if let problem {
                Text(problem).font(NXFont.text(11)).foregroundStyle(NX.danger).lineLimit(1)
            } else {
                Text(T("Ketuk kartu = pilih atasan · cubit = zoom")).font(NXFont.text(10.5)).foregroundStyle(NX.mutedFg).lineLimit(1)
            }
        }
        .padding(.horizontal, 14).padding(.vertical, 8)
        .background(.ultraThinMaterial)
        .overlay(alignment: .bottom) { Divider().overlay(NX.border) }
    }

    private func stat(_ n: Int, _ label: String, tone: Color?) -> some View {
        HStack(spacing: 3) {
            Text("\(n)").font(NXFont.text(13, .bold)).monospacedDigit().foregroundStyle(tone ?? NX.foreground)
            Text(label).font(NXFont.text(11)).foregroundStyle(tone ?? NX.mutedFg)
        }
    }

    /// Calon atasan: semua orang kecuali dirinya dan keturunannya (server juga menolak lingkaran,
    /// tapi kandidat yang pasti ditolak tidak perlu ditawarkan).
    private func candidates(for t: ApproverPickTarget) -> [WorkspaceRoster.Member] {
        guard let selfId = t.selfUserId else { return people }
        var banned: Set<String> = [selfId]
        var stack = [selfId]
        while let cur = stack.popLast() {
            for k in children[cur] ?? [] where !banned.contains(k.userId!) {
                banned.insert(k.userId!); stack.append(k.userId!)
            }
        }
        return people.filter { !banned.contains($0.userId!) }
    }

    private func tap(_ p: WorkspaceRoster.Member) {
        guard !busy, let mid = p.id else { return }
        pick = ApproverPickTarget(id: mid, memberId: mid, workspaceId: workspaceId, name: p.displayName, current: approverOf(p), selfUserId: p.userId)
    }

    // MARK: chart content (dipakai kanvas DAN ekspor)

    private var chartContent: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack(alignment: .top, spacing: 28) {
                ForEach(trees, id: \.idv) { root in
                    OrgTreeNode(person: root, children: children, rootless: !Self.isSenior(root), onTap: tap)
                }
            }
            if !alone.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("\(T("Not placed")) · \(alone.count) · \(T("their requests go to every BoD"))")
                        .font(NXFont.text(11, .bold)).foregroundStyle(NX.warning)
                    FlowLayout(spacing: 8) {
                        ForEach(alone, id: \.idv) { p in
                            Button { tap(p) } label: {
                                HStack(spacing: 6) {
                                    AvatarView(url: p.avatarURL, initial: p.initial, size: 20)
                                    Text(p.displayName).font(NXFont.text(12, .semibold)).foregroundStyle(NX.foreground).lineLimit(1)
                                    Text(orgRoleLabel(p.role)).font(NXFont.text(10)).foregroundStyle(NX.mutedFg)
                                }
                                .padding(.horizontal, 10).padding(.vertical, 6)
                                .background(NX.card, in: Capsule())
                                .overlay(Capsule().strokeBorder(NX.warning.opacity(0.5), style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .padding(12)
                .frame(maxWidth: 640, alignment: .leading)
                .background(NX.warning.opacity(0.06), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            }
        }
        .padding(28)
        .background(NX.background)
    }

    /// PNG tajam untuk dibagikan — bagan digambar ulang pada 3× tanpa transform kanvas, jadi
    /// hasilnya tidak tergantung seberapa jauh orangnya sedang men-zoom.
    @MainActor private func exportPNG() {
        let renderer = ImageRenderer(content: chartContent.environment(\.colorScheme, .light))
        renderer.scale = 3
        guard let img = renderer.uiImage, let data = img.pngData() else { return }
        let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("Bagan Approval \(f.string(from: Date())).png")
        do { try data.write(to: url); shareItem = ShareItem(url: url) } catch { problem = T("Gagal membuat gambar.") }
    }
}

// MARK: - pohon

/// Anchor tengah tiap kolom anak, supaya palang mendatar di atasnya digambar persis dari kolom
/// pertama ke kolom terakhir — bukan selebar HStack (yang menggantung melewati kartu di ujung).
private struct OrgColumnAnchorKey: PreferenceKey {
    static var defaultValue: [Anchor<CGPoint>] = []
    static func reduce(value: inout [Anchor<CGPoint>], nextValue: () -> [Anchor<CGPoint>]) { value += nextValue() }
}

private let orgLine = NX.mutedFg.opacity(0.55)
private let orgStub: CGFloat = 16

/// Satu orang dan semua di bawahnya. Cabang (anak yang punya bawahan, atau Manager/BoD) dapat
/// kolom sendiri; STAFF tanpa bawahan ditumpuk dalam satu kotak — sama dengan `TreeNode` di web:
/// Manager tanpa bawahan yang ikut ditumpuk di atas staff terbaca seperti atasan mereka.
private struct OrgTreeNode: View {
    let person: WorkspaceRoster.Member
    let children: [String: [WorkspaceRoster.Member]]
    var rootless: Bool = false
    let onTap: (WorkspaceRoster.Member) -> Void

    private var kids: [WorkspaceRoster.Member] { children[person.userId ?? ""] ?? [] }
    private func isLeaf(_ k: WorkspaceRoster.Member) -> Bool { (children[k.userId ?? ""] ?? []).isEmpty && k.role == "STAFF" }
    private var branches: [WorkspaceRoster.Member] { kids.filter { !isLeaf($0) } }
    private var leaves: [WorkspaceRoster.Member] { kids.filter(isLeaf) }

    var body: some View {
        VStack(spacing: 0) {
            OrgPersonCard(person: person, reports: kids.count, rootless: rootless, onTap: onTap)
            if !kids.isEmpty {
                Rectangle().fill(orgLine).frame(width: 1.5, height: orgStub)
                HStack(alignment: .top, spacing: 18) {
                    ForEach(branches, id: \.idv) { k in
                        column { OrgTreeNode(person: k, children: children, onTap: onTap) }
                    }
                    if !leaves.isEmpty {
                        column {
                            VStack(alignment: .leading, spacing: 8) {
                                Text("\(leaves.count) staff").font(NXFont.text(10, .bold)).tracking(0.5).foregroundStyle(NX.mutedFg)
                                ForEach(leaves, id: \.idv) { k in
                                    OrgPersonCard(person: k, reports: 0, rootless: false, onTap: onTap)
                                }
                            }
                            .padding(8)
                            .background(NX.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(orgLine, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                        }
                    }
                }
                // Palang mendatar: dari tengah kolom pertama ke tengah kolom terakhir, di garis atas HStack.
                .backgroundPreferenceValue(OrgColumnAnchorKey.self) { anchors in
                    GeometryReader { g in
                        let xs = anchors.map { g[$0].x }
                        if let a = xs.min(), let b = xs.max(), xs.count > 1 {
                            Path { p in p.move(to: CGPoint(x: a, y: 0)); p.addLine(to: CGPoint(x: b, y: 0)) }
                                .stroke(orgLine, lineWidth: 1.5)
                        }
                    }
                }
            }
        }
        // Anchor kolom-kolom di dalam node ini sudah dipakai di atas; jangan bocor ke node induk,
        // atau palang induk akan membentang sampai ke cucu.
        .transformPreference(OrgColumnAnchorKey.self) { $0 = [] }
    }

    private func column<C: View>(@ViewBuilder _ content: () -> C) -> some View {
        VStack(spacing: 0) {
            Rectangle().fill(orgLine).frame(width: 1.5, height: orgStub)
            content()
        }
        .anchorPreference(key: OrgColumnAnchorKey.self, value: .top) { [$0] }
    }
}

/// Kartu orang, 150pt. Warna ikut PERAN, bukan kedalaman — kedalaman bisa berapa saja, dan peran
/// yang menjawab "orang ini siapa". Sama dengan `PersonCard` di web.
private struct OrgPersonCard: View {
    let person: WorkspaceRoster.Member
    let reports: Int
    let rootless: Bool
    let onTap: (WorkspaceRoster.Member) -> Void

    private var senior: Bool { person.role == "BOD" || person.role == "ONE_ABOVE_ALL" }
    private var manager: Bool { person.role == "MANAGER" }
    private var filled: Bool { senior || manager }
    private var fill: Color { senior ? Color(hex: "#1e3a5f") : manager ? Color(hex: "#2c5282") : NX.card }
    private var fg: Color { filled ? .white : NX.foreground }
    private var sub: Color { filled ? .white.opacity(0.75) : NX.mutedFg }

    private var hours: String? {
        if person.flexiTimeEnabled ?? false { return nil }
        guard let s = person.attendanceShiftStartTime, let e = person.attendanceShiftEndTime, !s.isEmpty, !e.isEmpty else { return nil }
        return "\(Self.to12(s))–\(Self.to12(e))"
    }
    /// "09:00" → "9 AM" — kartunya cuma 150pt.
    private static func to12(_ hhmm: String) -> String {
        let parts = hhmm.split(separator: ":")
        guard parts.count == 2, let h = Int(parts[0]), let m = Int(parts[1]) else { return hhmm }
        let ap = h >= 12 ? "PM" : "AM"
        let hh = ((h + 11) % 12) + 1
        return m == 0 ? "\(hh) \(ap)" : "\(hh):\(String(format: "%02d", m)) \(ap)"
    }

    var body: some View {
        Button { onTap(person) } label: {
            HStack(spacing: 8) {
                AvatarView(url: person.avatarURL, initial: person.initial, size: 28)
                VStack(alignment: .leading, spacing: 1) {
                    Text(person.displayName).font(NXFont.text(12, .bold)).foregroundStyle(fg).lineLimit(1)
                    HStack(spacing: 4) {
                        Text(orgRoleLabel(person.role)).font(NXFont.text(9.5, .semibold)).foregroundStyle(sub)
                        if reports > 0 {
                            Text("· \(reports)").font(NXFont.text(9.5, .semibold)).foregroundStyle(sub).monospacedDigit()
                        }
                    }
                    HStack(spacing: 5) {
                        if person.flexiTimeEnabled ?? false {
                            Label(T("Flexi"), systemImage: "bolt.fill").font(NXFont.text(9, .bold)).foregroundStyle(filled ? Color(hex: "#fbbf24") : NX.warning)
                        } else if let hours {
                            Text(hours).font(NXFont.text(9)).foregroundStyle(sub).monospacedDigit().lineLimit(1)
                        }
                        if person.noGeofenceMode ?? false {
                            Image(systemName: "iphone").font(.system(size: 9, weight: .bold)).foregroundStyle(filled ? .white : NX.violetText)
                        }
                    }
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 8).padding(.vertical, 7)
            .frame(width: 150, alignment: .leading)
            .background(fill, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(filled ? Color.clear : NX.border))
            .shadow(color: .black.opacity(filled ? 0.18 : 0.06), radius: 3, y: 2)
            .overlay(alignment: .topTrailing) {
                if rootless {
                    Text(T("tanpa atasan")).font(NXFont.text(8.5, .bold)).foregroundStyle(Color(hex: "#92400e"))
                        .padding(.horizontal, 5).padding(.vertical, 1.5)
                        .background(Color(hex: "#fef3c7"), in: Capsule())
                        .overlay(Capsule().strokeBorder(Color(hex: "#fcd34d")))
                        .offset(x: -6, y: -8)
                }
            }
        }
        .buttonStyle(.plain)
    }
}

// MARK: - kanvas zoom/geser

/// SwiftUI di dalam UIScrollView: cubit untuk zoom, geser dengan inersia, ketuk dua kali untuk
/// pas-ke-layar / perbesar. Konten dipusatkan saat lebih kecil dari layar.
struct ZoomableCanvas<Content: View>: UIViewRepresentable {
    let fitTrigger: Int
    @ViewBuilder let content: () -> Content

    func makeCoordinator() -> ZoomCanvasCoordinator { ZoomCanvasCoordinator() }

    func makeUIView(context: Context) -> ZoomCanvasScrollView {
        let scroll = ZoomCanvasScrollView()
        scroll.delegate = context.coordinator
        scroll.showsVerticalScrollIndicator = false
        scroll.showsHorizontalScrollIndicator = false
        scroll.bouncesZoom = true
        scroll.alwaysBounceVertical = true
        scroll.alwaysBounceHorizontal = true
        scroll.backgroundColor = .clear
        scroll.contentInsetAdjustmentBehavior = .never
        let host = UIHostingController(rootView: AnyView(content()))
        host.view.backgroundColor = .clear
        scroll.addSubview(host.view)
        context.coordinator.host = host
        let tap = UITapGestureRecognizer(target: context.coordinator, action: #selector(ZoomCanvasCoordinator.doubleTap(_:)))
        tap.numberOfTapsRequired = 2
        scroll.addGestureRecognizer(tap)
        scroll.onLayout = { [weak coordinator = context.coordinator] in coordinator?.layoutContent(initial: true) }
        return scroll
    }

    func updateUIView(_ scroll: ZoomCanvasScrollView, context: Context) {
        context.coordinator.host?.rootView = AnyView(content())
        context.coordinator.layoutContent(initial: false)
        if context.coordinator.lastFitTrigger != fitTrigger {
            context.coordinator.lastFitTrigger = fitTrigger
            context.coordinator.fit(animated: true)
        }
    }

}

final class ZoomCanvasScrollView: UIScrollView {
    var onLayout: (() -> Void)?
    override func layoutSubviews() {
        super.layoutSubviews()
        onLayout?()
    }
}

/// Di luar `ZoomableCanvas` karena struct itu generik, dan `@objc` (dibutuhkan #selector ketuk
/// dua kali) tidak boleh berada di dalam tipe generik.
final class ZoomCanvasCoordinator: NSObject, UIScrollViewDelegate {
        var host: UIHostingController<AnyView>?
        var lastFitTrigger = 0
        private var didFit = false
        private var lastSize: CGSize = .zero

        private var scroll: UIScrollView? { host?.view.superview as? UIScrollView }

        /// Ukur konten pada skala 1, pasang sebagai contentSize, lalu pas-ke-layar sekali saat
        /// kanvasnya pertama kali punya ukuran.
        func layoutContent(initial: Bool) {
            guard let host, let scroll else { return }
            let size = host.sizeThatFits(in: CGSize(width: CGFloat.greatestFiniteMagnitude, height: CGFloat.greatestFiniteMagnitude))
            if size != lastSize {
                lastSize = size
                host.view.bounds = CGRect(origin: .zero, size: size)
                host.view.center = CGPoint(x: size.width * scroll.zoomScale / 2, y: size.height * scroll.zoomScale / 2)
                scroll.contentSize = CGSize(width: size.width * scroll.zoomScale, height: size.height * scroll.zoomScale)
            }
            if !didFit, scroll.bounds.width > 0, scroll.bounds.height > 0, size.width > 0 {
                didFit = true
                fit(animated: false)
            }
            center()
        }

        func fit(animated: Bool) {
            guard let scroll, lastSize.width > 0, scroll.bounds.width > 0 else { return }
            let scale = min(scroll.bounds.width / lastSize.width, scroll.bounds.height / lastSize.height, 1.0)
            scroll.minimumZoomScale = min(scale, 0.35)
            scroll.maximumZoomScale = 3.0
            scroll.setZoomScale(scale, animated: animated)
            center()
        }

        /// Konten yang lebih kecil dari layar dipusatkan lewat inset, supaya pohon kecil tidak
        /// menempel di pojok kiri atas.
        private func center() {
            guard let scroll else { return }
            let dx = max(0, (scroll.bounds.width - scroll.contentSize.width) / 2)
            let dy = max(0, (scroll.bounds.height - scroll.contentSize.height) / 2)
            scroll.contentInset = UIEdgeInsets(top: dy, left: dx, bottom: dy, right: dx)
        }

        @objc func doubleTap(_ g: UITapGestureRecognizer) {
            guard let scroll else { return }
            let fitScale = min(scroll.bounds.width / max(lastSize.width, 1), scroll.bounds.height / max(lastSize.height, 1), 1.0)
            if scroll.zoomScale > fitScale + 0.01 {
                fit(animated: true)
            } else {
                let target = min(scroll.maximumZoomScale, max(1.0, fitScale * 2))
                let p = g.location(in: host?.view)
                let w = scroll.bounds.width / target, h = scroll.bounds.height / target
                scroll.zoom(to: CGRect(x: p.x - w / 2, y: p.y - h / 2, width: w, height: h), animated: true)
            }
        }

        func viewForZooming(in scrollView: UIScrollView) -> UIView? { host?.view }
        func scrollViewDidZoom(_ scrollView: UIScrollView) { center() }
}
