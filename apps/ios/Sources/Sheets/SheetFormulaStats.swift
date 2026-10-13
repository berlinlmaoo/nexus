// Statistics and finance functions of formula.js 4.6.1 (MIT), with its JavaScript semantics — the
// rest of what sheet-formula.ts delegates to @formulajs/formulajs.
import Foundation

enum SheetFormulaStats {
    typealias V = SheetJSValue
    typealias L = SheetFormulaLib

    static func call(_ fn: String, _ a: [V]) throws -> V {
        switch fn {
        case "STDEV", "STDEV.S":
            let v = VARS(a)
            return .num(L.toNumber(v).squareRoot())
        case "STDEVP", "STDEV.P":
            let r = L.toNumber(VARP(a)).squareRoot()
            return r.isNaN ? L.num : .num(r)
        case "VAR", "VAR.S": return VARS(a)
        case "VARP", "VAR.P": return VARP(a)
        case "LARGE": return try LARGE(L.arg(a, 0), L.arg(a, 1))
        case "SMALL": return SMALL(L.arg(a, 0), L.arg(a, 1))
        case "RANK", "RANK.EQ": return RANKEQ(L.arg(a, 0), L.arg(a, 1), L.arg(a, 2))
        case "PERCENTILE", "PERCENTILE.INC": return PERCENTILEINC(L.arg(a, 0), L.arg(a, 1))
        case "QUARTILE", "QUARTILE.INC": return QUARTILEINC(L.arg(a, 0), L.arg(a, 1))
        case "MODE": return MODESNGL(a)
        default: return try callFinance(fn, a)
        }
    }

    private static func callFinance(_ fn: String, _ a: [V]) throws -> V {
        let x = { (i: Int) in L.arg(a, i) }
        switch fn {
        case "PMT": return PMT(x(0), x(1), x(2), x(3), x(4))
        case "FV": return FV(x(0), x(1), x(2), x(3), x(4))
        case "PV": return PV(x(0), x(1), x(2), x(3), x(4))
        case "NPV": return NPV(a)
        case "IRR": return IRR(x(0), x(1))
        case "RATE": return RATE(x(0), x(1), x(2), x(3), x(4), x(5))
        case "NPER": return NPER(x(0), x(1), x(2), x(3), x(4))
        case "IPMT": return IPMT(x(0), x(1), x(2), x(3), x(4), x(5))
        case "PPMT": return PPMT(x(0), x(1), x(2), x(3), x(4), x(5))
        default: throw SheetJSThrow()
        }
    }

    // MARK: - Statistics

    static func AVERAGE(_ range: [Double]) -> V {
        if range.isEmpty { return L.div0 }
        let sum = range.reduce(0, +)
        let r = sum / Double(range.count)
        return r.isNaN ? L.num : .num(r)
    }

    static func VARS(_ a: [V]) -> V {
        let range = L.numbers(a)
        let mean = L.toNumber(AVERAGE(range))
        var sigma: Double = 0
        for x in range { sigma += Foundation.pow(x - mean, 2) }
        return .num(sigma / (Double(range.count) - 1))
    }

    static func VARP(_ a: [V]) -> V {
        let range = L.numbers(a)
        let mean = L.toNumber(AVERAGE(range))
        var sigma: Double = 0
        for x in range { sigma += Foundation.pow(x - mean, 2) }
        let r = sigma / Double(range.count)
        return r.isNaN ? L.num : .num(r)
    }

    private static func nums(_ v: V) -> [Double] {
        if case .arr(let a) = v { return a.map { L.toNumber($0) } }
        return []
    }

    static func LARGE(_ array: V, _ k0: V) throws -> V {
        switch array {
        case .arr(let a): if let e = a.first(where: { $0.isErr }) { return e }
        case .undefined, .null: break
        default: throw SheetJSThrow() // anyError.apply(undefined, <primitive>)
        }
        if k0.isErr { return k0 }
        let list = L.numbers([array]).sorted { $0 > $1 }
        let k = L.parseNumber(k0)
        if L.lt(k, .num(0)) || L.lt(.num(Double(list.count)), k) { return L.value }
        return try L.at(.arr(list.map { .num($0) }), L.toNumber(k) - 1)
    }

    static func SMALL(_ array: V, _ k0: V) -> V {
        let arr = L.parseNumberArray(L.flatten([array]))
        let k = L.parseNumber(k0)
        if arr.isErr || k.isErr { return arr }
        let sorted = nums(arr).sorted()
        return (try? L.at(.arr(sorted.map { .num($0) }), L.toNumber(k) - 1)) ?? .undefined
    }

    static func cleanFloat(_ n: Double) -> Double { SheetJS.round(n * 1e14) / 1e14 }

    static func PERCENTILEINC(_ array: V, _ k0: V) -> V {
        let arr = L.parseNumberArray(L.flatten([array]))
        let k = L.parseNumber(k0)
        if arr.isErr || k.isErr { return L.value }
        let sorted = nums(arr).sorted()
        let n = Double(sorted.count)
        let l = L.toNumber(k) * (n - 1)
        let fl = l.rounded(.down)
        func at(_ i: Double) -> Double {
            guard i.isFinite, i >= 0, i == i.rounded(.down), i < n else { return .nan }
            return sorted[Int(i)]
        }
        let v = l == fl ? at(l) : at(fl) + (l - fl) * (at(fl + 1) - at(fl))
        return .num(cleanFloat(v))
    }

    static func QUARTILEINC(_ range: V, _ quart0: V) -> V {
        let arr = L.parseNumberArray(L.numbers([range]).map { .num($0) })
        let q = L.parseNumber(quart0)
        if arr.isErr || q.isErr { return L.value }
        guard case .num(let qn) = q else { return L.num }
        switch qn {
        case 1: return PERCENTILEINC(arr, .num(0.25))
        case 2: return PERCENTILEINC(arr, .num(0.5))
        case 3: return PERCENTILEINC(arr, .num(0.75))
        default: return L.num
        }
    }

    static func RANKEQ(_ number0: V, _ ref0: V, _ order: V) -> V {
        let number = L.parseNumber(number0)
        let ref = L.parseNumberArray(L.flatten([ref0]))
        if number.isErr || ref.isErr { return L.value }
        let list = L.truthy(order) ? nums(ref).sorted() : nums(ref).sorted { $0 > $1 }
        let x = L.toNumber(number)
        return .num(Double((list.firstIndex { $0 == x } ?? -1) + 1))
    }

    static func MODESNGL(_ a: [V]) -> V {
        let range = L.parseNumberArray(L.flatten(a))
        if range.isErr { return range }
        let list = nums(range)
        var count: [String: Int] = [:]
        var maxItems: [Double] = []
        var mx = 0
        for item in list {
            let key = SheetJS.numberToString(item)
            let c = (count[key] ?? 0) + 1
            count[key] = c
            if c > mx { mx = c; maxItems = [] }
            if c == mx { maxItems.append(item) }
        }
        guard let first = maxItems.sorted().first else { return .undefined }
        return .num(first)
    }

    // MARK: - Finance

    private static func orZero(_ v: V) -> V { L.truthy(v) ? v : .num(0) }
    private static func parsed(_ vs: [V]) -> [Double]? {
        var out: [Double] = []
        for v in vs {
            let p = L.parseNumber(v)
            guard case .num(let n) = p else { return nil }
            out.append(n)
        }
        return out
    }

    static func FV(_ rate: V, _ nper: V, _ payment: V, _ value0: V, _ type0: V) -> V {
        guard let p = parsed([rate, nper, payment, orZero(value0), orZero(type0)]) else { return L.value }
        let (r, n, pmt, v, type) = (p[0], p[1], p[2], p[3], p[4])
        var result: Double
        if r == 0 {
            result = v + pmt * n
        } else {
            let term = SheetJS.pow(1 + r, n)
            if type == 1 {
                result = v * term + (pmt * (1 + r) * (term - 1)) / r
            } else {
                result = v * term + (pmt * (term - 1)) / r
            }
        }
        return .num(-result)
    }

    static func PMT(_ rate: V, _ nper: V, _ pv0: V, _ fv0: V, _ type0: V) -> V {
        guard let p = parsed([rate, nper, pv0, orZero(fv0), orZero(type0)]) else { return L.value }
        let (r, n, pv, fv, type) = (p[0], p[1], p[2], p[3], p[4])
        var result: Double
        if r == 0 {
            result = (pv + fv) / n
        } else {
            let term = SheetJS.pow(1 + r, n)
            let a = (fv * r) / (term - 1)
            let b = (pv * r) / (1 - 1 / term)
            result = type == 1 ? (a + b) / (1 + r) : a + b
        }
        return .num(-result)
    }

    static func IPMT(_ rate: V, _ per: V, _ nper: V, _ pv: V, _ fv0: V, _ type0: V) -> V {
        guard let p = parsed([rate, per, nper, pv, orZero(fv0), orZero(type0)]) else { return L.value }
        let (r, pr, n, pvv, fv, type) = (p[0], p[1], p[2], p[3], p[4], p[5])
        let payment = PMT(.num(r), .num(n), .num(pvv), .num(fv), .num(type))
        var interest: Double
        if pr == 1 {
            interest = type == 1 ? 0 : -pvv
        } else if type == 1 {
            interest = L.toNumber(FV(.num(r), .num(pr - 2), payment, .num(pvv), .num(1))) - L.toNumber(payment)
        } else {
            interest = L.toNumber(FV(.num(r), .num(pr - 1), payment, .num(pvv), .num(0)))
        }
        return .num(interest * r)
    }

    static func PPMT(_ rate: V, _ per: V, _ nper: V, _ pv: V, _ fv0: V, _ type0: V) -> V {
        let fv = orZero(fv0), type = orZero(type0)
        guard let p = parsed([rate, nper, pv, fv, type]) else { return L.value }
        let pmt = PMT(.num(p[0]), .num(p[1]), .num(p[2]), .num(p[3]), .num(p[4]))
        let ip = IPMT(.num(p[0]), per, .num(p[1]), .num(p[2]), .num(p[3]), .num(p[4]))
        return .num(L.toNumber(pmt) - L.toNumber(ip))
    }

    static func PV(_ rate: V, _ per: V, _ pmt: V, _ fv0: V, _ type0: V) -> V {
        guard let p = parsed([rate, per, pmt, orZero(fv0), orZero(type0)]) else { return L.value }
        let (r, n, pm, fv, type) = (p[0], p[1], p[2], p[3], p[4])
        if r == 0 { return .num(-pm * n - fv) }
        let f = SheetJS.pow(1 + r, n)
        return .num((((1 - f) / r) * pm * (1 + r * type) - fv) / f)
    }

    static func NPV(_ a: [V]) -> V {
        let args = L.parseNumberArray(L.flatten(a))
        if args.isErr { return args }
        let list = nums(args)
        let rate = list[0]
        var v: Double = 0
        for j in 1..<max(list.count, 1) where j < list.count { v += list[j] / SheetJS.pow(1 + rate, Double(j)) }
        return .num(v)
    }

    static func NPER(_ rate: V, _ pmt: V, _ pv: V, _ fv0: V, _ type0: V) -> V {
        let fv: V = { if case .undefined = fv0 { return .num(0) }; return fv0 }()
        let type: V = { if case .undefined = type0 { return .num(0) }; return type0 }()
        guard let p = parsed([rate, pmt, pv, fv, type]) else { return L.value }
        let (r, pm, pvv, f, t) = (p[0], p[1], p[2], p[3], p[4])
        if r == 0 { return .num(-(pvv + f) / pm) }
        let num = pm * (1 + r * t) - f * r
        let den = pvv * r + pm * (1 + r * t)
        return .num(Foundation.log(num / den) / Foundation.log(1 + r))
    }

    static func RATE(_ nper: V, _ pmt: V, _ pv: V, _ fv0: V, _ type0: V, _ guess0: V) -> V {
        let guessV: V = { if case .undefined = guess0 { return .num(0.1) }; return guess0 }()
        let fv: V = { if case .undefined = fv0 { return .num(0) }; return fv0 }()
        let typeV: V = { if case .undefined = type0 { return .num(0) }; return type0 }()
        guard let p = parsed([nper, pmt, pv, fv, typeV, guessV]) else { return L.value }
        let (n, pm, pvv, f) = (p[0], p[1], p[2], p[3])
        let type: Double = p[4] != 0 && !p[4].isNaN ? 1 : 0
        let epsMax = 1e-10
        var rate = p[5]
        for _ in 0..<100 {
            if rate <= -1 { return L.num }
            var y: Double
            if abs(rate) < epsMax {
                y = pvv * (1 + n * rate) + pm * (1 + rate * type) * n + f
            } else {
                let ff = SheetJS.pow(1 + rate, n)
                y = pvv * ff + pm * (1 / rate + type) * (ff - 1) + f
            }
            if abs(y) < epsMax { return .num(rate) }
            var dy: Double
            if abs(rate) < epsMax {
                dy = pvv * n + pm * type * n
            } else {
                let ff = SheetJS.pow(1 + rate, n)
                let df = n * SheetJS.pow(1 + rate, n - 1)
                dy = pvv * df + pm * (1 / rate + type) * df + pm * (-1 / (rate * rate)) * (ff - 1)
            }
            rate -= y / dy
        }
        return .num(rate)
    }

    static func IRR(_ values0: V, _ guess0: V) -> V {
        var guessV: V
        switch guess0 {
        case .num: guessV = guess0
        case .undefined: guessV = .num(0.1)
        default: guessV = L.parseNumber(guess0)
        }
        let values = L.parseNumberArray(L.flatten([values0]).filter { $0.isDefined })
        if values.isErr || guessV.isErr { return L.value }
        let flows = nums(values)
        let positive = flows.contains { $0 > 0 }, negative = flows.contains { $0 < 0 }
        if !positive || !negative { return L.num }
        let guess = L.toNumber(guessV)
        func npv(_ r0: Double) -> Double {
            let r = r0 <= -1 ? -0.999999999 : r0
            var result = flows[0]
            let base = 1 + r
            var factor: Double = 1
            for i in 1..<max(flows.count, 1) where i < flows.count {
                factor *= base
                result += flows[i] / factor
            }
            return result
        }
        var cache: [Double: Double] = [:]
        func cached(_ rate: Double) -> Double {
            let rounded = SheetJS.round(rate * 1e10) / 1e10
            if let v = cache[rounded] { return v }
            let v = npv(rounded)
            cache[rounded] = v
            return v
        }
        let epsMax = 1e-10
        let maxIterations = 1000
        var rate = guess
        var prevRate = rate
        var iteration = 0
        while iteration < maxIterations {
            let current = cached(rate)
            if abs(current) < epsMax { return .num(rate) }
            if iteration > 0 && abs(rate - prevRate) < epsMax * 10 { break }
            let delta = max(0.0001, abs(rate * 0.0001))
            let deriv = (cached(rate + delta) - current) / delta
            if abs(deriv) < epsMax { break }
            prevRate = rate
            let step = current / deriv
            let maxStep = max(0.1, abs(rate) * 0.5)
            if abs(step) > maxStep { rate -= SheetJS.sign(step) * maxStep } else { rate -= step }
            if rate <= -1 { rate = -0.99999999 }
            if rate > 1000 { rate = 1000 }
            iteration += 1
        }
        let atRate = cached(rate)
        if abs(atRate) < epsMax { return .num(rate) }
        var a: Double, b: Double
        if atRate > 0 {
            a = rate
            b = rate + 0.1
            while cached(b) > 0 && b < 1000 { b = b * 2 + 0.1 }
            if b >= 1000 { return .num(rate) }
        } else {
            b = rate
            a = max(-0.99999999, rate - 0.1)
            while cached(a) < 0 && a > -0.99999999 { a = max(-0.99999999, a - 0.1) }
            if a <= -0.99999999 { return .num(rate) }
        }
        var c: Double = .nan
        for _ in 0..<maxIterations {
            c = (a + b) / 2
            let npvC = cached(c)
            if abs(npvC) < epsMax || abs(b - a) < epsMax { return .num(c) }
            if npvC * cached(a) < 0 { b = c } else { a = c }
        }
        return .num(c)
    }
}
