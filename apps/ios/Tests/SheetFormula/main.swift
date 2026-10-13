// Linux check of Sources/Sheets/SheetFormula*.swift (+ numfmt / validation / cf / types / clipboard)
// against the web engine's own test files and a corpus of web-engine results. Run from the repo root:
//   docker run --rm -v "$PWD":/w -w /w swift:5.10-jammy bash -c "swiftc -O -o /tmp/t \
//     Sources/Sheets/SheetFormula*.swift Sources/Sheets/SheetNumFmt.swift Sources/Sheets/SheetValidation.swift \
//     Sources/Sheets/SheetCF.swift Sources/Sheets/SheetTypes.swift Sources/Sheets/SheetClipboard.swift \
//     Tests/SheetFormula/*.swift && /tmp/t"
// (Only these files: the rest of Sources/Sheets is UIKit/SwiftUI.) corpus*.json were produced by
// running the web engine itself (node, dev branch, TZ=UTC) — regenerate them when sheet-formula.ts
// changes and this port is updated.
// Prints "checks N, fails 0" when everything matches.
import Foundation

runFormulaTests()   // sheet-formula.test.mjs
runNumFmtTests()    // sheet-numfmt.test.mjs
runValidationTests() // sheet-validation.test.mjs
runCFTests()        // sheet-cf.test.mjs
runCorpusTests()    // corpus.json (web engine outputs)
runCorpus2Tests()   // corpus2.json (grid, sheet-types, validation, CF)
runMiscTests()      // deep chains, caching, clipboard
print("checks \(checks), fails \(fails)")
exit(fails == 0 ? 0 : 1)
