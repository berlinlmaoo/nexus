// Column stats (Data ▸ Column stats) — 1:1 port of the web's lib/sheet-stats.ts: what Sheets shows for one
// column — counts, the value-frequency table, a count-per-value chart and a numeric histogram. Foundation
// only; tested on Linux against lib/sheet-stats.test.mjs (Tests/SheetPanels). Like Sheets, hidden and
// filtered rows are included (the caller passes every row).
import Foundation

enum SheetStats {
    /// One cell of the column: its computed value and the text it shows.
    struct Input {
        var value: SheetCellValue
        var text: String
        init(value: SheetCellValue, text: String) { self.value = value; self.text = text }
    }

    struct FrequencyRow: Equatable {
        var text: String
        var count: Int
    }

    struct Bin: Equatable {
        var from: Double
        var to: Double
        var count: Int
    }

    struct ColumnStats {
        /// Rows considered (after the ignored header rows).
        var total: Int
        var empty: Int
        /// Distinct non-empty shown texts.
        var unique: Int
        /// How many cells hold a number.
        var numeric: Int
        var sum: Double?
        var avg: Double?
        var median: Double?
        var min: Double?
        var max: Double?
        /// Most frequent first; ties in natural (numeric-aware) order. Reverse it for "least frequent".
        var frequency: [FrequencyRow]
        /// One bar per distinct value, in natural order (the "Count" chart).
        var counts: [FrequencyRow]
        /// Histogram of the numeric values (the "Distribution" chart); empty when there are none.
        var distribution: [Bin]
    }

    static func isEmpty(_ x: Input) -> Bool {
        switch x.value {
        case .empty: return true
        case .text(let s) where s.isEmpty: return true
        default: return SheetJS.trim(x.text).isEmpty
        }
    }

    private static func number(_ v: SheetCellValue) -> Double? {
        if case .number(let n) = v { return n }
        return nil
    }

    /// Intl.Collator("en", { numeric: true, sensitivity: "base" }).compare
    static func naturalCompare(_ a: String, _ b: String) -> Int {
        let r = a.compare(b, options: [.caseInsensitive, .diacriticInsensitive, .numeric], range: nil, locale: Locale(identifier: "en"))
        switch r {
        case .orderedAscending: return -1
        case .orderedDescending: return 1
        case .orderedSame: return 0
        }
    }

    /// Stats for one column's values (top to bottom), skipping the first `ignoreRows` rows.
    static func columnStats(_ values: [Input], ignoreRows: Int = 0) -> ColumnStats {
        let skip = max(0, ignoreRows)
        let rows: [Input] = skip >= values.count ? [] : Array(values[skip...])
        var order: [String] = []
        var freq: [String: Int] = [:]
        var numbers: [Double] = []
        var empty = 0
        for x in rows {
            if isEmpty(x) { empty += 1; continue }
            if let c = freq[x.text] { freq[x.text] = c + 1 } else { freq[x.text] = 1; order.append(x.text) }
            if let n = number(x.value), n.isFinite { numbers.append(n) }
        }
        let entries = order.map { FrequencyRow(text: $0, count: freq[$0] ?? 0) }
        // Numbers sort by value, not by their formatted text ("1.000" after "200").
        var numOf: [String: Double] = [:]
        for x in rows where !isEmpty(x) {
            if let n = number(x.value) { numOf[x.text] = n }
        }
        let byValue: (FrequencyRow, FrequencyRow) -> Int = { a, b in
            let na = numOf[a.text], nb = numOf[b.text]
            if let na, let nb { return na == nb ? 0 : (na < nb ? -1 : 1) }
            if na != nil { return -1 }
            if nb != nil { return 1 }
            return naturalCompare(a.text, b.text)
        }
        let natural = SheetFilter.stableSorted(entries, byValue)
        let frequency = SheetFilter.stableSorted(natural) { a, b in b.count - a.count }

        let sorted = numbers.sorted()
        let n = sorted.count
        let sum: Double? = n > 0 ? sorted.reduce(0, +) : nil
        var median: Double? = nil
        if n > 0 { median = n % 2 == 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2 }
        return ColumnStats(
            total: rows.count,
            empty: empty,
            unique: freq.count,
            numeric: n,
            sum: sum,
            avg: n > 0 ? sum.map { $0 / Double(n) } : nil,
            median: median,
            min: sorted.first,
            max: sorted.last,
            frequency: frequency,
            counts: natural,
            distribution: histogram(sorted)
        )
    }

    /// Equal-width bins (Sturges' rule, at most 20); one bin when every value is the same.
    static func histogram(_ values: [Double]) -> [Bin] {
        let v = values.filter { $0.isFinite }
        guard !v.isEmpty else { return [] }
        var lo = Double.infinity, hi = -Double.infinity
        for x in v { if x < lo { lo = x }; if x > hi { hi = x } }
        if lo == hi { return [Bin(from: lo, to: hi, count: v.count)] }
        let k = min(20, max(1, Int((log2(Double(v.count)) + 1).rounded(.up))))
        let width = (hi - lo) / Double(k)
        var bins: [Bin] = []
        for i in 0..<k {
            let from: Double = lo + Double(i) * width
            let to: Double = i == k - 1 ? hi : lo + Double(i + 1) * width
            bins.append(Bin(from: from, to: to, count: 0))
        }
        for x in v {
            let i = min(k - 1, Int(((x - lo) / width).rounded(.down)))
            bins[i].count += 1
        }
        return bins
    }
}
