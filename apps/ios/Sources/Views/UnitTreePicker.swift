import SwiftUI

// ─────────────────────────────────────────────────────────────────────────────
// Pick divisions / units of the IP & Division Chart (web UnitTreePicker.tsx, QA BoD R2 N04: 26 long
// "IP › Division" chips in a row were a wall). One trigger ("Everyone" / the names picked) opens a
// searchable, indented tree with checkboxes; the picked units sit under it as removable chips. Groups
// (they only arrange cards) show as headings and can't be picked. Empty selection = everyone.
// ─────────────────────────────────────────────────────────────────────────────

/// One line of the tree, in tree order, with how deep it sits.
struct UnitTreeRow: Identifiable {
    let unit: OrgUnitDTO
    let depth: Int
    var id: String { unit.id }
}

enum UnitTree {
    /// Flat rows in tree order (position, then name). A search keeps the matches plus the units above them.
    static func rows(_ units: [OrgUnitDTO], query: String) -> [UnitTreeRow] {
        let byId = Dictionary(units.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var children: [String: [OrgUnitDTO]] = [:]
        let rootKey = ""
        for u in units {
            let key: String
            if let p = u.parentId, byId[p] != nil { key = p } else { key = rootKey }
            children[key, default: []].append(u)
        }
        for k in children.keys {
            children[k]?.sort { a, b in
                let pa = a.position ?? 0, pb = b.position ?? 0
                if pa != pb { return pa < pb }
                return a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
        }
        var out: [UnitTreeRow] = []
        var seen: Set<String> = []
        func walk(_ parent: String, _ depth: Int) {
            for u in children[parent] ?? [] where !seen.contains(u.id) {
                seen.insert(u.id)
                out.append(UnitTreeRow(unit: u, depth: depth))
                if depth < 12 { walk(u.id, depth + 1) }
            }
        }
        walk(rootKey, 0)
        let term = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if term.isEmpty { return out }
        var keep: Set<String> = []
        for r in out where r.unit.name.lowercased().contains(term) {
            var cur: OrgUnitDTO? = r.unit
            var hops = 0
            while let c = cur, hops < 8 {
                keep.insert(c.id)
                cur = c.parentId.flatMap { byId[$0] }
                hops += 1
            }
        }
        return out.filter { keep.contains($0.id) }
    }
}

struct UnitTreePicker: View {
    let units: [OrgUnitDTO]
    @Binding var selection: Set<String>
    var disabled: Bool = false
    @State private var open = false

    private var byId: [String: OrgUnitDTO] {
        Dictionary(units.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
    }
    /// The picked units that still exist, in tree order.
    private var picked: [OrgUnitDTO] {
        UnitTree.rows(units, query: "").map(\.unit).filter { selection.contains($0.id) }
    }
    private var summary: String {
        let p = picked
        if p.isEmpty { return T("Everyone") }
        if p.count <= 2 { return p.map(\.name).joined(separator: ", ") }
        return String(format: T("%d divisions"), p.count)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button { open = true } label: {
                HStack(spacing: 8) {
                    Text(summary).font(NXFont.text(15)).foregroundStyle(NX.foreground).lineLimit(1)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.down").font(.system(size: 11, weight: .semibold)).foregroundStyle(NX.mutedFg)
                }
                .padding(12)
                .frame(minHeight: 44)
                .background(NX.card, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 12).strokeBorder(NX.border))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(disabled)
            .accessibilityLabel(T("For"))
            .accessibilityValue(summary)
            if !picked.isEmpty {
                FlowLayout(spacing: 6) {
                    ForEach(picked) { u in chip(u) }
                }
            }
        }
        .sheet(isPresented: $open) {
            UnitTreeSheet(units: units, selection: $selection)
        }
    }

    /// A picked unit; the whole chip removes it (44 pt tall hit area, the capsule stays small).
    private func chip(_ u: OrgUnitDTO) -> some View {
        Button { selection.remove(u.id) } label: {
            HStack(spacing: 4) {
                Text(u.name).font(NXFont.text(12, .semibold)).lineLimit(1)
                Image(systemName: "xmark").font(.system(size: 9, weight: .bold))
            }
            .foregroundStyle(NX.violetText)
            .padding(.leading, 10).padding(.trailing, 8).padding(.vertical, 5)
            .background(NX.violet.opacity(0.12), in: Capsule())
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityLabel(String(format: T("Remove %@"), u.name))
    }
}

/// The searchable tree, as a sheet (the web's popover).
struct UnitTreeSheet: View {
    let units: [OrgUnitDTO]
    @Binding var selection: Set<String>
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""

    var body: some View {
        let rows = UnitTree.rows(units, query: query)
        NavigationStack {
            List {
                if query.trimmingCharacters(in: .whitespaces).isEmpty {
                    checkRow(T("Everyone"), on: selection.isEmpty, depth: 0, bold: false) { selection.removeAll() }
                }
                ForEach(rows) { r in row(r) }
                if rows.isEmpty && !query.trimmingCharacters(in: .whitespaces).isEmpty {
                    Text(String(format: T("No division matches “%@”."), query))
                        .font(NXFont.text(13)).foregroundStyle(NX.mutedFg)
                        .listRowSeparator(.hidden)
                }
            }
            .listStyle(.plain)
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: T("Search divisions"))
            .navigationTitle(T("Divisions")).navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button(T("Done")) { dismiss() } }
            }
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private func row(_ r: UnitTreeRow) -> some View {
        if r.unit.isGroup {
            Text(r.unit.name.uppercased())
                .font(NXFont.text(11, .semibold)).foregroundStyle(NX.mutedFg)
                .padding(.leading, CGFloat(r.depth) * 16)
                .padding(.top, 6)
                .listRowSeparator(.hidden)
                .accessibilityAddTraits(.isHeader)
        } else {
            let on = selection.contains(r.unit.id)
            checkRow(r.unit.name, on: on, depth: r.depth, bold: r.unit.isIP) {
                if on { selection.remove(r.unit.id) } else { selection.insert(r.unit.id) }
            }
        }
    }

    private func checkRow(_ label: String, on: Bool, depth: Int, bold: Bool, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            HStack(spacing: 10) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .font(.system(size: 18))
                    .foregroundStyle(on ? NX.violetText : NX.mutedFg)
                Text(label).font(NXFont.text(14, bold ? .semibold : .regular)).foregroundStyle(NX.foreground).lineLimit(1)
                Spacer(minLength: 0)
            }
            .padding(.leading, CGFloat(depth) * 16)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowSeparator(.hidden)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}
