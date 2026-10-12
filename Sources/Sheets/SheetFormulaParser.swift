// Tokenizer + parser of stored formulas — port of the matching section of sheet-formula.ts.
import Foundation

extension SheetFormula {
    enum Tok {
        case num(Double)
        case str(String)
        case bool(Bool)
        case err(String)
        case ref(col: String, row: String)
        case colref(col: String)
        case op(String)
        case fn(String)
        case lp, rp, sep, colon, pct
    }

    struct RangeNode {
        var c1: String
        var c2: String
        var r1: String?
        var r2: String?
    }

    indirect enum Node {
        case num(Double)
        case str(String)
        case bool(Bool)
        case err(String)
        case ref(col: String, row: String)
        case range(RangeNode)
        case bin(op: String, l: Node, r: Node)
        case neg(Node)
        case pct(Node)
        case call(fn: String, args: [Node])

        var isRange: Bool { if case .range = self { return true }; return false }
    }

    static let PREC: [String: Int] = [
        "<": 1, ">": 1, "<=": 1, ">=": 1, "=": 1, "<>": 1,
        "&": 2,
        "+": 3, "-": 3,
        "*": 4, "/": 4,
        "^": 5,
    ]

    /// True when the formula separates arguments with ";".
    static func usesSemicolons(_ src: [UnicodeScalar]) -> Bool {
        var inStr = false
        for ch in src {
            if ch == "\"" { inStr = !inStr } else if !inStr && ch == ";" { return true }
        }
        return false
    }

    private static let errorWords = ["REF!", "DIV/0!", "CIRCULAR!", "CYCLE!", "NAME?", "VALUE!", "N/A", "NUM!", "NULL!"]

    private static func errorAt(_ src: [UnicodeScalar], _ i: Int) -> String? {
        for w in errorWords {
            let ws = Array(w.unicodeScalars)
            if i + 1 + ws.count > src.count { continue }
            var ok = true
            for k in 0..<ws.count where String(src[i + 1 + k]).uppercased() != String(ws[k]) { ok = false; break }
            if ok { return "#" + w }
        }
        return nil
    }

    enum Lexed {
        case toks([Tok])
        case error(String)
    }

    private static func lexNumber(_ src: [UnicodeScalar], _ start: Int, _ semi: Bool) -> (Double, Int) {
        var j = start
        var text = ""
        while j < src.count {
            let c = src[j]
            if isDigitU(c.value) { text.unicodeScalars.append(c); j += 1; continue }
            if c == "." && !text.contains(".") { text += "."; j += 1; continue }
            let nextDigit = j + 1 < src.count && isDigitU(src[j + 1].value)
            if c == "," && semi && !text.contains(".") && nextDigit { text += "."; j += 1; continue }
            break
        }
        if j < src.count && (src[j] == "e" || src[j] == "E") {
            var k = j + 1
            if k < src.count && (src[k] == "+" || src[k] == "-") { k += 1 }
            let ds = k
            while k < src.count && isDigitU(src[k].value) { k += 1 }
            if k > ds { text += string(src[j..<k]); j = k }
        }
        return (SheetJS.stringToNumber(text), j)
    }

    static func tokenize(_ s: String) -> Lexed {
        let src = scalars(s)
        var out: [Tok] = []
        let semi = usesSemicolons(src)
        var i = 0
        while i < src.count {
            let ch = src[i]
            if ch == " " || ch == "\t" || ch == "\n" || ch == "\r" { i += 1; continue }
            if ch == "{" {
                let end = indexOf(src, "}", from: i)
                if end < 0 { return .error(ERR.value) }
                let inner = Array(src[(i + 1)..<end])
                guard let bang = inner.firstIndex(of: "!") else { return .error(ERR.value) }
                var col = string(inner[0..<bang])
                var row = string(inner[(bang + 1)...])
                if col.hasPrefix("$") { col.removeFirst() }
                if row.hasPrefix("$") { row.removeFirst() }
                out.append(row == "*" ? .colref(col: col) : .ref(col: col, row: row))
                i = end + 1
                continue
            }
            if ch == "\"" {
                var j = i + 1
                var s = String.UnicodeScalarView()
                while true {
                    if j >= src.count { return .error(ERR.value) }
                    if src[j] == "\"" {
                        if j + 1 < src.count && src[j + 1] == "\"" { s.append("\""); j += 2; continue }
                        break
                    }
                    s.append(src[j])
                    j += 1
                }
                out.append(.str(String(s)))
                i = j + 1
                continue
            }
            if ch == "#" {
                guard let e = errorAt(src, i) else { return .error(ERR.value) }
                out.append(.err(e))
                i += e.unicodeScalars.count
                continue
            }
            let nextIsDigit = i + 1 < src.count && isDigitU(src[i + 1].value)
            if isDigitU(ch.value) || (ch == "." && nextIsDigit) {
                let (n, j) = lexNumber(src, i, semi)
                if !n.isFinite { return .error(ERR.value) }
                out.append(.num(n))
                i = j
                continue
            }
            if isIdentStartU(ch.value) {
                var j = i
                while j < src.count && isIdentU(src[j].value) { j += 1 }
                let wordS = Array(src[i..<j])
                let up = string(wordS).uppercased()
                var k = j
                while k < src.count && src[k] == " " { k += 1 }
                let call = k < src.count && src[k] == "("
                if !call && (up == "TRUE" || up == "FALSE") {
                    out.append(.bool(up == "TRUE"))
                } else if !call && parseCellWord(wordS) != nil {
                    out.append(.err(ERR.ref))
                } else {
                    out.append(.fn(up))
                }
                i = j
                continue
            }
            switch ch {
            case "(": out.append(.lp); i += 1; continue
            case ")": out.append(.rp); i += 1; continue
            case ",", ";": out.append(.sep); i += 1; continue
            case ":": out.append(.colon); i += 1; continue
            case "%": out.append(.pct); i += 1; continue
            default: break
            }
            if i + 1 < src.count {
                let two = string(src[i...(i + 1)])
                if two == ">=" || two == "<=" || two == "<>" { out.append(.op(two)); i += 2; continue }
            }
            if "+-*/^<>=&".unicodeScalars.contains(ch) { out.append(.op(String(ch))); i += 1; continue }
            return .error(ERR.value)
        }
        return .toks(out)
    }

    enum Parsed {
        case node(Node)
        case error(String)
    }

    final class Parser {
        let toks: [Tok]
        var p = 0
        init(_ toks: [Tok]) { self.toks = toks }

        func peek() -> Tok? { p < toks.count ? toks[p] : nil }
        func eat() -> Tok? {
            defer { p += 1 }
            return p < toks.count ? toks[p] : nil
        }
        func peekIs(_ f: (Tok) -> Bool) -> Bool { peek().map(f) ?? false }

        func primary() -> Parsed {
            guard let t = eat() else { return .error(ERR.value) }
            switch t {
            case .num(let v): return .node(.num(v))
            case .str(let v): return .node(.str(v))
            case .bool(let v): return .node(.bool(v))
            case .err(let v): return .node(.err(v))
            case .ref(let col, let row):
                if peekIs({ if case .colon = $0 { return true }; return false }) {
                    _ = eat()
                    guard case .ref(let c2, let r2)? = eat() else { return .error(ERR.value) }
                    return .node(.range(RangeNode(c1: col, c2: c2, r1: row, r2: r2)))
                }
                return .node(.ref(col: col, row: row))
            case .colref(let col):
                if peekIs({ if case .colon = $0 { return true }; return false }) {
                    _ = eat()
                    guard case .colref(let c2)? = eat() else { return .error(ERR.value) }
                    return .node(.range(RangeNode(c1: col, c2: c2, r1: nil, r2: nil)))
                }
                return .node(.range(RangeNode(c1: col, c2: col, r1: nil, r2: nil)))
            case .lp:
                let e = expr(0)
                guard case .node = e else { return e }
                guard case .rp? = eat() else { return .error(ERR.value) }
                return e
            case .fn(let name):
                return call(name)
            default:
                return .error(ERR.value)
            }
        }

        func call(_ name: String) -> Parsed {
            guard case .lp? = peek() else { return .error(ERR.name) }
            _ = eat()
            var args: [Node] = []
            if case .rp? = peek() { _ = eat(); return .node(.call(fn: name, args: args)) }
            while true {
                let blank = peekIs { t in
                    switch t {
                    case .sep, .rp: return true
                    default: return false
                    }
                }
                if blank {
                    args.append(.str(""))
                } else {
                    let a = expr(0)
                    guard case .node(let n) = a else { return a }
                    args.append(n)
                }
                guard let nx = eat() else { return .error(ERR.value) }
                if case .rp = nx { break }
                guard case .sep = nx else { return .error(ERR.value) }
            }
            return .node(.call(fn: name, args: args))
        }

        func unary() -> Parsed {
            if case .op(let v)? = peek(), v == "-" || v == "+" {
                _ = eat()
                let e = unary()
                guard case .node(let n) = e else { return e }
                return v == "-" ? .node(.neg(n)) : e
            }
            let e = primary()
            guard case .node(var n) = e else { return e }
            while case .pct? = peek() { _ = eat(); n = .pct(n) }
            return .node(n)
        }

        func expr(_ minPrec: Int) -> Parsed {
            let l = unary()
            guard case .node(var left) = l else { return l }
            while true {
                guard case .op(let op)? = peek(), let prec = PREC[op], prec >= minPrec else { break }
                _ = eat()
                let r = expr(prec + 1)
                guard case .node(let right) = r else { return r }
                left = .bin(op: op, l: left, r: right)
            }
            return .node(left)
        }
    }

    static func parse(_ toks: [Tok]) -> Parsed {
        let p = Parser(toks)
        let node = p.expr(0)
        guard case .node = node else { return node }
        return p.p == toks.count ? node : .error(ERR.value)
    }

    private static var astCache: [String: Parsed] = [:]
    private static let astLock = NSLock()

    static func compile(_ f: String) -> Parsed {
        if f.hasPrefix(AMBIGUOUS) { return .error(ERR.error) }
        astLock.lock()
        if let hit = astCache[f] { astLock.unlock(); return hit }
        astLock.unlock()
        let src = f.hasPrefix("=") ? String(f.dropFirst()) : f
        let ast: Parsed
        switch tokenize(src) {
        case .error(let e): ast = .error(e)
        case .toks(let t): ast = parse(t)
        }
        astLock.lock()
        if astCache.count > 5000 { astCache.removeAll() }
        astCache[f] = ast
        astLock.unlock()
        return ast
    }

    /// Does this stored formula parse? Returns the error text, or nil.
    static func formulaError(_ stored: String) -> String? {
        if case .error(let e) = compile(stored) { return e }
        return nil
    }
}
