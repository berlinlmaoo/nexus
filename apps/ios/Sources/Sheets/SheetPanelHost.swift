import SwiftUI

// One enum for every spreadsheet panel, so the sheet screen presents them through a SINGLE .sheet(item:)
// (two .sheet modifiers on one view leave buttons dead). SheetPanelMenu is the menu the screen can drop into
// its format bar / "More" menu; SheetPanelHost is what the .sheet shows.

enum SheetPanelKind: Identifiable, Equatable {
    case find
    /// One cell's comment thread and history (rowId, columnId).
    case cellComments(rowId: String, columnId: String)
    case allComments
    case versions
    case validation
    case conditionalFormat
    case alternatingColors
    case charts
    /// One chart's editor (tapping a chart on the grid).
    case chart(String)
    /// One slicer's editor (Data ▸ Add a slicer, or Edit slicer on its chip).
    case slicer(String)
    case pivot
    /// Data ▸ Column stats for a model column.
    case columnStats(Int)
    case namedRanges
    case protectedRanges
    /// Format ▸ Number ▸ Custom number format / date and time / currency.
    case customNumber
    case customDate
    case customCurrency

    var id: String {
        switch self {
        case .find: return "find"
        case .cellComments(let r, let c): return "comments:\(r):\(c)"
        case .allComments: return "allComments"
        case .versions: return "versions"
        case .validation: return "validation"
        case .conditionalFormat: return "cf"
        case .alternatingColors: return "alt"
        case .charts: return "charts"
        case .chart(let id): return "chart:\(id)"
        case .slicer(let id): return "slicer:\(id)"
        case .pivot: return "pivot"
        case .columnStats: return "stats"
        case .namedRanges: return "named"
        case .protectedRanges: return "protect"
        case .customNumber: return "customNumber"
        case .customDate: return "customDate"
        case .customCurrency: return "customCurrency"
        }
    }
}

struct SheetPanelHost: View {
    let kind: SheetPanelKind
    let ctx: SheetPanelContext

    var body: some View {
        switch kind {
        case .find: SheetFindPanel(ctx: ctx)
        case .cellComments(let r, let c): SheetCellCommentsPanel(ctx: ctx, rowId: r, columnId: c)
        case .allComments: SheetAllCommentsPanel(ctx: ctx)
        case .versions: SheetVersionsPanel(ctx: ctx)
        case .validation: SheetValidationPanel(ctx: ctx)
        case .conditionalFormat: SheetCondFormatPanel(ctx: ctx)
        case .alternatingColors: SheetAlternatingColorsPanel(ctx: ctx)
        case .charts: SheetChartsPanel(ctx: ctx)
        case .chart(let id): SheetChartEditorHost(ctx: ctx, chartId: id)
        case .slicer(let id): SheetSlicerEditorHost(ctx: ctx, slicerId: id)
        case .pivot: SheetPivotPanel(ctx: ctx)
        case .columnStats(let c): SheetStatsPanel(ctx: ctx, column: c)
        case .namedRanges: SheetNamedRangesPanel(ctx: ctx)
        case .protectedRanges: SheetProtectedRangesPanel(ctx: ctx)
        case .customNumber: SheetNumFmtPanel(ctx: ctx, kind: .number)
        case .customDate: SheetNumFmtPanel(ctx: ctx, kind: .date)
        case .customCurrency: SheetNumFmtPanel(ctx: ctx, kind: .currency)
        }
    }
}

/// The panels as menu items (Edit / View / Insert / Format / Data in one list); `open` sets the screen's panel.
struct SheetPanelMenuItems: View {
    let store: SheetStore
    let open: (SheetPanelKind) -> Void

    var body: some View {
        Button { open(.find) } label: { Label(T("Find and replace"), systemImage: "magnifyingglass") }
        if let r = store.rowId(store.selection.active.r), let c = store.columnId(store.selection.active.c) {
            Button { open(.cellComments(rowId: r, columnId: c)) } label: { Label(T("Comment"), systemImage: "text.bubble") }
        }
        Button { open(.allComments) } label: { Label(T("All comments"), systemImage: "bubble.left.and.bubble.right") }
        Button { open(.versions) } label: { Label(T("Version history"), systemImage: "clock.arrow.circlepath") }
        Divider()
        Button { open(.charts) } label: { Label(T("Charts"), systemImage: "chart.bar.xaxis") }
        Button { open(.pivot) } label: { Label(T("Pivot table"), systemImage: "tablecells.badge.ellipsis") }
        Button { open(.columnStats(store.modelCol(store.selection.active.c) ?? 0)) } label: {
            Label(T("Column stats"), systemImage: "chart.bar.doc.horizontal")
        }
        Divider()
        Button { open(.namedRanges) } label: { Label(T("Named ranges"), systemImage: "character.cursor.ibeam") }
        Button { open(.protectedRanges) } label: { Label(T("Protected sheets and ranges"), systemImage: "lock") }
        Button { open(.validation) } label: { Label(T("Data validation"), systemImage: "checklist") }
        Button { open(.conditionalFormat) } label: { Label(T("Conditional formatting"), systemImage: "paintpalette") }
        Button { open(.alternatingColors) } label: { Label(T("Alternating colours"), systemImage: "rectangle.grid.1x2") }
    }
}
