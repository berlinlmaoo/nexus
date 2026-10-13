import Foundation
import Foundation
func canon(_ o: Any) -> String { String(data: try! JSONSerialization.data(withJSONObject: o, options: [.sortedKeys]), encoding: .utf8)! }
var fails = 0, checks = 0
func check(_ ok: Bool, _ what: String) { checks += 1; if !ok { fails += 1; print("FAIL", what) } }
/// (text, marks-canon) of every marked text node
func markedRuns(_ inline: [Any]) -> [(String, String)] {
    inline.compactMap { n in
        guard let o = n as? [String: Any], (o["type"] as? String) == "text", let m = o["marks"] as? [Any], !m.isEmpty else { return nil }
        return (o["text"] as? String ?? "", canon(m))
    }
}
func atoms(_ inline: [Any]) -> [String] {
    inline.compactMap { n in
        guard let o = n as? [String: Any], let t = o["type"] as? String, t != "text" else { return nil }
        return canon(o)
    }
}
func hasRun(_ inline: [Any], _ text: String, _ marks: String) -> Bool {
    inline.contains { n in
        guard let o = n as? [String: Any], (o["type"] as? String) == "text", let m = o["marks"] as? [Any] else { return false }
        return canon(m) == marks && (o["text"] as? String ?? "").contains(text)
    }
}
let files = try! FileManager.default.contentsOfDirectory(atPath: ".").filter { $0.hasSuffix(".json") }.sorted()
var edited = 0
for f in files {
    let env = try! JSONSerialization.jsonObject(with: FileManager.default.contents(atPath: f)!) as! [String: Any]
    guard let doc = (env["doc"] as? [String: Any])?["content"] as? [String: Any] else { continue }
    let blocks = (doc["content"] as? [Any] ?? []).compactMap { $0 as? [String: Any] }
    let rows = BlockConvert.rows(from: blocks)
    check(canon(BlockConvert.blocks(from: rows)) == canon(blocks), "\(f) round-trip")
    for r in rows {
        guard let orig = BlockConvert.originalInline(r), !markedRuns(orig).isEmpty || !atoms(orig).isEmpty else { continue }
        let runs = markedRuns(orig), ats = atoms(orig)
        // 1. append at the end
        var a = r; a.text = r.originalText + " tail"
        let ia = BlockConvert.inlineFor(a)
        check(BlockConvert.inlineText(ia) == a.text, "\(f) append text")
        for (t, m) in runs { check(hasRun(ia, t, m), "\(f) append keeps \(t)") }
        for at in ats { check(atoms(ia).contains(at), "\(f) append keeps atom") }
        // 2. insert at the very start
        var b = r; b.text = "Head " + r.originalText
        let ib = BlockConvert.inlineFor(b)
        check(BlockConvert.inlineText(ib) == b.text, "\(f) prepend text")
        for (t, m) in runs { check(hasRun(ib, t, m), "\(f) prepend keeps \(t)") }
        // 3. typing inside the first marked run keeps its marks for the typed letters
        if let (t, m) = runs.first, t.count >= 2, let range = r.originalText.range(of: t) {
            var c = r
            let mid = r.originalText.index(range.lowerBound, offsetBy: 1)
            c.text = String(r.originalText[..<mid]) + "XY" + String(r.originalText[mid...])
            let ic = BlockConvert.inlineFor(c)
            check(BlockConvert.inlineText(ic) == c.text, "\(f) inside text")
            let expect = String(t.prefix(1)) + "XY" + String(t.dropFirst())
            check(hasRun(ic, expect, m), "\(f) typed letters take the run's marks (\(expect))")
        }
        // 4. delete the last word of plain text, marks elsewhere intact
        edited += 1
    }
}
print("pages \(files.count), edited lines \(edited), checks \(checks), fails \(fails)")
if fails > 0 { exit(1) }
