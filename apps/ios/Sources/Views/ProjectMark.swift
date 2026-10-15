import SwiftUI

/// A PROJECT's mark: one default for every project, unless the project has an uploaded photo.
/// Owner, 14 Oct 2026 (option A): a calm Notion-style page, identical to web: a thin grey outline
/// document with a folded corner and two text lines, monochrome, no fill, no background tile, on a
/// 24x24 grid scaled to the slot. It replaced the full-colour clipboard-checklist of 11 Oct.
/// Emoji and named icons ("folder", "rocket", "🚀") stored by older screens are ignored on purpose,
/// and so is the project's colour.
///
/// Folders are NOT drawn with this: they keep their own emoji/photo (FolderIconTile).
struct ProjectMark: View {
    let icon: String?
    /// Kept so call sites stay as they are; ignored — the default icon is the same for every project.
    let color: String?
    /// The slot the mark sits in. A photo and the default icon both fill it.
    var size: CGFloat = 20
    /// Draw the default icon at this side instead of `size` (centred in the slot), for a slot where a
    /// photo should fill a larger area than the icon.
    var glyph: CGFloat? = nil
    /// The project, when known: the mark then draws the icon it has NOW (ProjectIconStore, patched live
    /// by realtime and every project fetch) instead of whatever the caller's payload carried, so a photo
    /// changed or removed on another device shows here at once. Leave nil only where the screen edits
    /// the icon itself (Project settings' preview).
    var projectId: String? = nil

    /// What is drawn: the live icon when the store knows this project, else the caller's.
    private var shown: String? {
        if let projectId, let live = ProjectIconStore.shared.icons[projectId] { return live }
        return icon
    }

    /// True when the stored icon is an uploaded picture ("/api/files/…" or an absolute URL).
    static func isPhoto(_ icon: String?) -> Bool {
        guard let icon else { return false }
        return icon.hasPrefix("/") || icon.hasPrefix("http")
    }

    /// The uploaded picture's URL, or nil when the project has none.
    static func photoURL(_ icon: String?) -> URL? {
        guard let icon, isPhoto(icon) else { return nil }
        return URL(string: icon.hasPrefix("http") ? icon : Config.baseURL.absoluteString + icon)
    }

    var body: some View {
        Group {
            if let url = Self.photoURL(shown) {
                CachedImage(url: url) { $0.resizable().scaledToFill() } placeholder: { defaultMark }
                    .frame(width: size, height: size)
                    .clipShape(RoundedRectangle(cornerRadius: size * 0.28, style: .continuous))
            } else if let symbol = dashboardSymbol {
                // A dashboard project without a photo wears its template's icon, the one its card shows in
                // New project, in the same muted outline as the default page — as on the web (R14-WB-10;
                // UI tour run 15, Q-IB16: the outlet and socmed headers showed the plain page).
                Image(systemName: symbol)
                    .font(.system(size: (glyph ?? size) * 0.82, weight: .regular))
                    .foregroundStyle(Self.stroke)
                    .frame(width: size, height: size)
            } else {
                defaultMark.frame(width: size, height: size)
            }
        }
        .accessibilityHidden(true)
        // A project this device has not listed yet (a search hit, a GIDEON source): fetch the list once.
        .task(id: projectId) {
            if let projectId, ProjectIconStore.shared.icons[projectId] == nil { await ProjectIconStore.shared.loadOnce() }
        }
    }

    /// The web's DASHBOARD_MARK: Store, Megaphone, Filter.
    private var dashboardSymbol: String? {
        guard let projectId, let kind = ProjectIconStore.shared.types[projectId] else { return nil }
        switch kind {
        case "OUTLET_SALES": return "storefront"
        case "SOCIAL_MEDIA_REPORT": return "megaphone"
        case "PIPELINE": return "line.3.horizontal.decrease"
        default: return nil
        }
    }

    private var defaultMark: some View {
        let side = glyph ?? size
        // Stroke 1.6 on the 24-grid, like web's SVG; never thinner than one point so 14-16 pt rows stay crisp.
        return ProjectPageShape()
            .stroke(Self.stroke, style: StrokeStyle(lineWidth: max(1, 1.6 * side / 24), lineCap: .round, lineJoin: .round))
            .frame(width: side, height: side)
    }

    /// Notion's muted grey (web --st-gray-dot): #91918e light, #9b9a97 dark.
    static let stroke = Color(light: 0x91918e, dark: 0x9b9a97)
}

/// The default project icon's outline on web's 24x24 grid:
/// "M6 3h8l4 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z", "M14 3v4h4", "M8.5 12h7M8.5 15.5h5".
struct ProjectPageShape: Shape {
    func path(in rect: CGRect) -> Path {
        let k = min(rect.width, rect.height) / 24
        let ox = rect.minX + (rect.width - 24 * k) / 2
        let oy = rect.minY + (rect.height - 24 * k) / 2
        func pt(_ x: CGFloat, _ y: CGFloat) -> CGPoint { CGPoint(x: ox + x * k, y: oy + y * k) }
        var p = Path()
        // Page: top edge to the fold, the fold's diagonal, right edge, rounded bottom corners, left edge.
        p.move(to: pt(6, 3))
        p.addLine(to: pt(14, 3))
        p.addLine(to: pt(18, 7))
        p.addLine(to: pt(18, 20))
        p.addArc(tangent1End: pt(18, 21), tangent2End: pt(17, 21), radius: k)
        p.addLine(to: pt(6, 21))
        p.addArc(tangent1End: pt(5, 21), tangent2End: pt(5, 20), radius: k)
        p.addLine(to: pt(5, 4))
        p.addArc(tangent1End: pt(5, 3), tangent2End: pt(6, 3), radius: k)
        p.closeSubpath()
        // Folded corner.
        p.move(to: pt(14, 3))
        p.addLine(to: pt(14, 7))
        p.addLine(to: pt(18, 7))
        // Two text lines.
        p.move(to: pt(8.5, 12))
        p.addLine(to: pt(15.5, 12))
        p.move(to: pt(8.5, 15.5))
        p.addLine(to: pt(13.5, 15.5))
        return p
    }
}

/// Every project's icon as last heard (owner, 14 Oct 2026): from GET /api/projects, a project's detail,
/// this device's own PATCH, and the realtime `workspace-changed { kind: "projects", projectId, icon }`
/// ping. ProjectMark(projectId:) reads it, so the sidebar, shortcuts, lists, search, pickers and GIDEON
/// chips all swap a photo the moment it changes, with no screen keeping a stale copy. Photo URLs carry
/// `?v=<upload time>`, so CachedImage (keyed by URL) never serves the old picture for the new one.
/// An empty string means "no photo" (removed, or the server sent null).
@Observable
final class ProjectIconStore {
    static let shared = ProjectIconStore()
    private(set) var icons: [String: String] = [:]
    @ObservationIgnored private var loaded = false

    func set(_ id: String, _ icon: String?) {
        let v = icon ?? ""
        if icons[id] != v { icons[id] = v }
    }

    func record(_ pairs: [(String, String?)]) {
        for (id, icon) in pairs { set(id, icon) }
    }

    /// Each project's template kind, for the dashboard marks (ProjectMark.dashboardSymbol).
    private(set) var types: [String: String] = [:]
    func recordTypes(_ pairs: [(String, String?)]) {
        for (id, kind) in pairs {
            guard let kind, types[id] != kind else { continue }
            types[id] = kind
        }
    }

    /// One GET /api/projects per launch, for marks of projects no screen has listed yet.
    func loadOnce() async {
        if loaded { return }
        loaded = true
        _ = try? await APIClient.shared.projects()
    }
}

/// The round picture of a group-ish chat room (UI tour run 9): a PROJECT room shows its project's
/// mark — the uploaded photo, else the calm grey page — the way web does; a plain GROUP keeps the grey
/// people glyph. Used by the chat list, the chat header and Chat info so the three always agree.
struct ChatRoomGlyph: View {
    /// Set for a project room.
    let projectId: String?
    /// The project's icon the caller already has (list payload); the live store wins when it knows it.
    var projectIcon: String? = nil
    var size: CGFloat = 40

    var body: some View {
        ZStack {
            Circle().fill(NX.muted)
            if let projectId {
                ProjectMark(icon: projectIcon, color: nil, size: size, glyph: size * 0.5, projectId: projectId)
            } else {
                Image(systemName: "person.2")
                    .font(.system(size: size * 0.35, weight: .medium))
                    .foregroundStyle(NX.mutedFg)
            }
        }
        .frame(width: size, height: size)
        .clipShape(Circle())
        .overlay(Circle().strokeBorder(NX.border, lineWidth: 0.5))
        .accessibilityHidden(true)
    }
}
