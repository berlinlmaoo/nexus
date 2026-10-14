// Check of Sources/CustomFieldNumber.swift against the web/server test cases
// (src/lib/custom-field-number.test.mjs) and the Number format contract (numberFormat / decimals / showAs …).
// Run from apps/ios, on macOS:
//   swiftc -o /tmp/cfn Tests/CustomFieldNumber/Stub.swift Sources/CustomFieldNumber.swift Tests/CustomFieldNumber/main.swift && /tmp/cfn
// or on Linux:
//   docker run --rm -v "$PWD":/w -w /w swift:5.10-jammy bash -c "swiftc -o /tmp/t Tests/CustomFieldNumber/Stub.swift Sources/CustomFieldNumber.swift Tests/CustomFieldNumber/main.swift && /tmp/t"
import Foundation
var fails = 0, passes = 0
func check(_ got: String, _ want: String, _ name: String) { if got == want { passes += 1 } else { fails += 1; print("FAIL", name, "got", got, "want", want) } }
check(CustomFieldNumber.normalize("Rp 369.000", idr: true), "369000", "idr \"Rp 369.000\"")
check(CustomFieldNumber.normalize("Rp369.000", idr: true), "369000", "idr \"Rp369.000\"")
check(CustomFieldNumber.normalize("IDR 1.500.000", idr: true), "1500000", "idr \"IDR 1.500.000\"")
check(CustomFieldNumber.normalize("1.500.000", idr: true), "1500000", "idr \"1.500.000\"")
check(CustomFieldNumber.normalize("1,500,000", idr: true), "1500000", "idr \"1,500,000\"")
check(CustomFieldNumber.normalize("Rp 50.000,-", idr: true), "50000", "idr \"Rp 50.000,-\"")
check(CustomFieldNumber.normalize("1.500.000,00", idr: true), "1500000", "idr \"1.500.000,00\"")
check(CustomFieldNumber.normalize("150.000,49", idr: true), "150000", "idr \"150.000,49\"")
check(CustomFieldNumber.normalize("150.000,50", idr: true), "150001", "idr \"150.000,50\"")
check(CustomFieldNumber.normalize("1,500,000.75", idr: true), "1500001", "idr \"1,500,000.75\"")
check(CustomFieldNumber.normalize("999,99", idr: true), "1000", "idr \"999,99\"")
check(CustomFieldNumber.normalize("17jt", idr: true), "17000000", "idr \"17jt\"")
check(CustomFieldNumber.normalize("1,5 jt", idr: true), "1500000", "idr \"1,5 jt\"")
check(CustomFieldNumber.normalize("50rb", idr: true), "50000", "idr \"50rb\"")
check(CustomFieldNumber.normalize("Rp 9 240 943", idr: true), "9240943", "idr \"Rp 9 240 943\"")
check(CustomFieldNumber.normalize("-Rp 25.000", idr: true), "-25000", "idr \"-Rp 25.000\"")
check(CustomFieldNumber.normalize("(25.000)", idr: true), "-25000", "idr \"(25.000)\"")
check(CustomFieldNumber.normalize("0", idr: true), "0", "idr \"0\"")
check(CustomFieldNumber.normalize("007", idr: true), "7", "idr \"007\"")
check(CustomFieldNumber.normalize("369000", idr: true), "369000", "idr \"369000\"")
check(CustomFieldNumber.normalize("", idr: true), "", "idr \"\"")
check(CustomFieldNumber.normalize("   ", idr: true), "", "idr \"   \"")
check(CustomFieldNumber.normalize("abc", idr: true), "", "idr \"abc\"")
check(CustomFieldNumber.normalize("sekitar 20 ribu", idr: true), "20", "idr \"sekitar 20 ribu\"")
check(CustomFieldNumber.normalize("12345678901234567890", idr: true), "12345678901234567890", "idr \"12345678901234567890\"")
check(CustomFieldNumber.normalize("1.500.000", idr: false), "1500000", "plain \"1.500.000\"")
check(CustomFieldNumber.normalize("1.500", idr: false), "1500", "plain \"1.500\"")
check(CustomFieldNumber.normalize("1.5", idr: false), "1.5", "plain \"1.5\"")
check(CustomFieldNumber.normalize("0.500", idr: false), "0.5", "plain \"0.500\"")
check(CustomFieldNumber.normalize("2,5", idr: false), "2.5", "plain \"2,5\"")
check(CustomFieldNumber.normalize("1.234,56", idr: false), "1234.56", "plain \"1.234,56\"")
check(CustomFieldNumber.normalize("1,234.56", idr: false), "1234.56", "plain \"1,234.56\"")
check(CustomFieldNumber.normalize("13.600000", idr: false), "13.6", "plain \"13.600000\"")
check(CustomFieldNumber.normalize("42", idr: false), "42", "plain \"42\"")
check(CustomFieldNumber.normalize("-7", idr: false), "-7", "plain \"-7\"")
check(CustomFieldNumber.normalize("5k", idr: false), "5000", "plain \"5k\"")
check(CustomFieldNumber.normalize("", idr: false), "", "plain \"\"")
check(CustomFieldNumber.normalize("n/a", idr: false), "n/a", "plain \"n/a\"")
check(CustomFieldNumber.normalize("1.50.0", idr: false), "1.50.0", "plain \"1.50.0\"")
check(CustomFieldNumber.normalize("369.000", idr: true), "369000", "idr \"369.000\"")
check(CustomFieldNumber.normalize("72.000", idr: true), "72000", "idr \"72.000\"")
check(CustomFieldNumber.normalize("500.000", idr: true), "500000", "idr \"500.000\"")
check(CustomFieldNumber.normalize("823.000", idr: true), "823000", "idr \"823.000\"")
check(CustomFieldNumber.normalize("95.000", idr: true), "95000", "idr \"95.000\"")
check(CustomFieldNumber.normalize("243.351", idr: true), "243351", "idr \"243.351\"")
check(CustomFieldNumber.normalize("101.250", idr: true), "101250", "idr \"101.250\"")
check(CustomFieldNumber.normalize("13.600000", idr: true), "13600000", "idr \"13.600000\"")
check(CustomFieldNumber.normalize("900.000", idr: true), "900000", "idr \"900.000\"")
check(CustomFieldNumber.normalize("153.134", idr: true), "153134", "idr \"153.134\"")
check(CustomFieldNumber.normalize("935.600", idr: true), "935600", "idr \"935.600\"")
check(CustomFieldNumber.normalize("118.000", idr: true), "118000", "idr \"118.000\"")
check(CustomFieldNumber.normalize("300.000", idr: true), "300000", "idr \"300.000\"")
check(CustomFieldNumber.normalize("280,000", idr: true), "280000", "idr \"280,000\"")
check(CustomFieldNumber.groupIDR("369000"), "369.000", "groupIdrDigits \"369000\"")
check(CustomFieldNumber.groupIDR("1500000"), "1.500.000", "groupIdrDigits \"1500000\"")
check(CustomFieldNumber.groupIDR("0"), "0", "groupIdrDigits \"0\"")
check(CustomFieldNumber.groupIDR(""), "", "groupIdrDigits \"\"")
check(CustomFieldNumber.formatIDR("369.000"), "Rp 369.000", "formatIdr \"369.000\"")
check(CustomFieldNumber.formatIDR("369000"), "Rp 369.000", "formatIdr \"369000\"")
check(CustomFieldNumber.formatIDR("-25000"), "\u{2212}Rp 25.000", "formatIdr \"-25000\"")
check(CustomFieldNumber.formatIDR(""), "", "formatIdr \"\"")

// ── Number formats (Notion style, run 14) ──────────────────────────────────────────────────────
typealias CFN = CustomFieldNumber
typealias Style = CustomFieldNumber.Style
let M = "\u{2212}"
func style(_ nf: String?, _ d: Int? = nil) -> Style { Style(numberFormat: nf, decimals: d) }
func checkD(_ b: Bool, _ name: String) { check(b ? "true" : "false", "true", name) }

// Every format × decimals (Default, 0, 2, 5) × positive / negative.
let matrix: [(String, Int?, String, String)] = [
    // numberFormat, decimals, 1234567.891, -1500.5
    ("number", nil, "1.234.567,891", M + "1.500,5"),
    ("number", 0, "1.234.568", M + "1.501"),
    ("number", 2, "1.234.567,89", M + "1.500,50"),
    ("number", 5, "1.234.567,89100", M + "1.500,50000"),
    ("number_with_separators", nil, "1.234.567,891", M + "1.500,5"),
    ("number_with_separators", 0, "1.234.568", M + "1.501"),
    ("number_with_separators", 2, "1.234.567,89", M + "1.500,50"),
    ("number_with_separators", 5, "1.234.567,89100", M + "1.500,50000"),
    ("percent", nil, "123.456.789,1%", M + "150.050%"),
    ("percent", 0, "123.456.789%", M + "150.050%"),
    ("percent", 2, "123.456.789,10%", M + "150.050,00%"),
    ("percent", 5, "123.456.789,10000%", M + "150.050,00000%"),
    ("IDR", nil, "Rp 1.234.568", M + "Rp 1.501"),
    ("IDR", 0, "Rp 1.234.568", M + "Rp 1.501"),
    ("IDR", 2, "Rp 1.234.567,89", M + "Rp 1.500,50"),
    ("IDR", 5, "Rp 1.234.567,89100", M + "Rp 1.500,50000"),
    ("USD", nil, "US$1.234.567,89", M + "US$1.500,50"),
    ("USD", 0, "US$1.234.568", M + "US$1.501"),
    ("USD", 2, "US$1.234.567,89", M + "US$1.500,50"),
    ("USD", 5, "US$1.234.567,89100", M + "US$1.500,50000"),
    ("EUR", nil, "€1.234.567,89", M + "€1.500,50"),
    ("EUR", 0, "€1.234.568", M + "€1.501"),
    ("JPY", nil, "JP¥1.234.568", M + "JP¥1.501"),
    ("JPY", 2, "JP¥1.234.567,89", M + "JP¥1.500,50"),
    ("GBP", nil, "£1.234.567,89", M + "£1.500,50"),
    ("INR", nil, "Rs 1.234.567,89", M + "Rs 1.500,50"),
    ("KRW", nil, "₩1.234.568", M + "₩1.501"),
    ("CHF", nil, "CHF 1.234.567,89", M + "CHF 1.500,50"),
    ("SAR", nil, "SAR 1.234.567,89", M + "SAR 1.500,50"),
    ("SGD", 5, "SGD 1.234.567,89100", M + "SGD 1.500,50000"),
    ("BTC", nil, "₿1.234.567,891", M + "₿1.500,5"),
    ("BTC", 0, "₿1.234.568", M + "₿1.501"),
    ("BTC", 2, "₿1.234.567,89", M + "₿1.500,50"),
    ("BTC", 5, "₿1.234.567,89100", M + "₿1.500,50000"),
]
for (nf, d, pos, neg) in matrix {
    check(CFN.display("1234567.891", style: style(nf, d)), pos, "\(nf) d=\(d.map(String.init) ?? "Default") positive")
    check(CFN.display("-1500.5", style: style(nf, d)), neg, "\(nf) d=\(d.map(String.init) ?? "Default") negative")
}
// Every currency in the list formats without falling back, with plain spaces only.
for f in CFN.formats where f.code.count == 3 && f.code != "BTC" {
    let out = CFN.display("1234.5", style: style(f.code))
    checkD(!out.contains("\u{00A0}") && !out.contains("\u{202F}") && out.contains("1.23"), "currency \(f.code) → \(out)")
}
// No "−0": a negative that rounds to zero is zero.
check(CFN.display("-0.4", style: style("IDR")), "Rp 0", "idr -0.4")
check(CFN.display("-0.004", style: style("number", 2)), "0,00", "number -0.004 d=2")
check(CFN.display("0", style: style("number")), "0", "number 0")

// Percent: the stored fraction × 100; Default = the fraction's own digits minus 2.
check(CFN.display("0.42", style: style("percent")), "42%", "percent 0.42")
check(CFN.display("0.07", style: style("percent")), "7%", "percent 0.07")
check(CFN.display("0.4213", style: style("percent")), "42,13%", "percent 0.4213")
check(CFN.display("1", style: style("percent")), "100%", "percent 1")
check(CFN.display("-0.42", style: style("percent")), M + "42%", "percent -0.42")
check(CFN.display("0.4213", style: style("percent", 0)), "42%", "percent 0.4213 d=0")
check(CFN.display("0.4213", style: style("percent", 1)), "42,1%", "percent 0.4213 d=1")
check(CFN.display("1234.567", style: style("percent")), "123.456,7%", "percent grouped")

// Default = the value's own shortest digits.
check(CFN.display("0.1", style: style("number")), "0,1", "number 0.1")
check(CFN.display("13.600000", style: style("number")), "13,6", "number 13.600000")
check(CFN.display("2.5", style: style(nil)), "2,5", "absent numberFormat 2.5")
check(CFN.display("1500000", style: style(nil)), "1.500.000", "absent numberFormat 1500000")
check(CFN.display("0.00000001", style: style("BTC")), "₿0,00000001", "btc satoshi")
check(CFN.display("1e-8", style: style("BTC")), "₿0,00000001", "btc js exponent")
// Text that is not a number shows as typed; empty shows nothing.
check(CFN.display("n/a", style: style("USD")), "n/a", "usd text")
check(CFN.display("", style: style("USD")), "", "usd empty")
check(CFN.display("  ", style: style("percent")), "", "percent blank")

// Rupiah reads legacy grouped text, and machine numbers as numbers.
check(CFN.display("369.000", style: style("IDR")), "Rp 369.000", "idr legacy 369.000")
check(CFN.display("13.600000", style: style("IDR")), "Rp 13.600.000", "idr legacy 13.600000")
check(CFN.display("1234567.891", style: style("IDR")), "Rp 1.234.568", "idr machine 1234567.891")
check(CFN.display("0.42", style: style("IDR")), "Rp 0", "idr machine 0.42")
check(CFN.display("0.42", style: style("IDR", 2)), "Rp 0,42", "idr 0.42 d=2")
check(CFN.display("150000.5", style: style("IDR", 1)), "Rp 150.000,5", "idr 150000.5 d=1")
check(CFN.display("Rp 1.500.000", style: style("IDR")), "Rp 1.500.000", "idr typed text")

// Compatibility: old options → a style.
check(Style(options: ["format": "currency-idr"]).numberFormat, "IDR", "compat currency-idr")
check(Style(options: ["format": "IDR"]).numberFormat, "IDR", "compat IDR")
check(Style(options: ["format": "Rupiah"]).numberFormat, "IDR", "compat rupiah")
check(Style(options: "currency-idr").numberFormat, "IDR", "compat bare string")
check(Style(options: nil).numberFormat, "number_with_separators", "compat none")
check(Style(options: [String: Any]()).numberFormat, "number_with_separators", "compat empty")
check(Style(options: ["options": ["a", "b"]]).numberFormat, "number_with_separators", "compat select-ish options")
check(Style(options: ["numberFormat": "USD", "format": "currency-idr"]).numberFormat, "USD", "numberFormat wins")
check(Style(options: ["numberFormat": "XYZ"]).numberFormat, "number_with_separators", "unknown numberFormat")
check(Style(options: ["numberFormat": "XYZ", "format": "currency-idr"]).numberFormat, "IDR", "unknown numberFormat + legacy idr")
check(Style(options: ["numberFormat": "usd"]).numberFormat, "USD", "lowercase code")
check(CFN.display("369000", format: "currency-idr"), "Rp 369.000", "legacy display(format:) idr")
check(CFN.display("1500000", format: nil), "1.500.000", "legacy display(format:) plain")

// Options decoding: decimals / showAs / colour / divideBy / showNumber, invalid values dropped.
let full = Style(options: ["numberFormat": "IDR", "decimals": 2, "showAs": "ring", "barColor": "blue", "divideBy": 50, "showNumber": false])
check("\(full.decimals ?? -1) \(full.showAs.rawValue) \(full.barColor) \(full.divideBy) \(full.showNumber)", "2 ring blue 50.0 false", "full options")
let bad = Style(options: ["decimals": 9, "showAs": "pie", "barColor": "teal", "divideBy": -3, "showNumber": "yes"])
check("\(bad.decimals.map(String.init) ?? "nil") \(bad.showAs.rawValue) \(bad.barColor) \(bad.divideBy) \(bad.showNumber)", "nil number default 100.0 true", "invalid options dropped")
check(Style(options: ["divideBy": 0]).divideBy.description, "100.0", "divideBy 0 → 100")
check(Style(options: ["decimals": true]).decimals.map(String.init) ?? "nil", "nil", "decimals bool ignored")

// Write side: format "currency-idr" only for Rupiah; defaults left out.
let idrOut = style("IDR").options
check(idrOut["format"] as? String ?? "", "currency-idr", "write idr legacy key")
check(idrOut["numberFormat"] as? String ?? "", "IDR", "write idr numberFormat")
checkD(style("USD").options["format"] == nil, "write usd has no legacy key")
checkD(Style().options.count == 1, "write default has only numberFormat")
var ringStyle = style("percent", 1); ringStyle.showAs = .ring; ringStyle.barColor = "red"; ringStyle.divideBy = 10; ringStyle.showNumber = false
let ro = ringStyle.options
check("\(ro["decimals"] as? Int ?? -1) \(ro["showAs"] as? String ?? "") \(ro["barColor"] as? String ?? "") \(ro["divideBy"] as? Double ?? 0) \(ro["showNumber"] as? Bool ?? true)", "1 ring red 10.0 false", "write ring options")
// Round trip.
checkD(Style(options: ringStyle.options) == ringStyle, "round trip")
checkD(Style(options: full.options) == full, "round trip idr")

// Bar / Ring fill: value ÷ Divide by, clamped; Percent fills by the fraction.
func fillOf(_ v: String, _ s: Style) -> String { String(format: "%.3f", CFN.fill(CFN.decimal(v, style: s)!, style: s)) }
check(fillOf("42", style(nil)), "0.420", "fill 42/100")
check(fillOf("250", style(nil)), "1.000", "fill clamp high")
check(fillOf("-5", style(nil)), "0.000", "fill clamp low")
var div50 = style(nil); div50.divideBy = 50
check(fillOf("25", div50), "0.500", "fill divideBy 50")
var pctDiv = style("percent"); pctDiv.divideBy = 10
check(fillOf("0.42", pctDiv), "0.420", "percent fill ignores divideBy")
check(fillOf("1.7", style("percent")), "1.000", "percent fill clamp high")
check(fillOf("-0.2", style("percent")), "0.000", "percent fill clamp low")
check(fillOf("1234567.891", style("IDR")), "1.000", "idr fill clamp")

// Storing: "42%" → 0.42 in any field; Rupiah decimals keep up to that many digits.
check(CFN.normalize("42%", style: style(nil)), "0.42", "store 42%")
check(CFN.normalize("42 %", style: style("percent")), "0.42", "store 42 %")
check(CFN.normalize("7,5%", style: style("percent")), "0.075", "store 7,5%")
check(CFN.normalize("0.42", style: style("percent")), "0.42", "store percent fraction")
check(CFN.normalize("150.000,50", style: style("IDR")), "150001", "store idr default rounds")
check(CFN.normalize("150.000,50", style: style("IDR", 0)), "150001", "store idr d=0 rounds")
check(CFN.normalize("150.000,55", style: style("IDR", 2)), "150000.55", "store idr d=2")
check(CFN.normalize("150.000,555", style: style("IDR", 2)), "150000.56", "store idr d=2 rounds to 2")
check(CFN.normalize("150.000,5", style: style("IDR", 1)), "150000.5", "store idr d=1")
check(CFN.normalize("369.000", style: style("IDR", 2)), "369000", "store idr d=2 grouping")
check(CFN.normalize("Rp 1.500.000", style: style("IDR", 2)), "1500000", "store idr d=2 with Rp")
check(CFN.normalize("1,5jt", style: style("IDR", 2)), "1500000", "store idr d=2 jt")
check(CFN.normalize("\u{2212}Rp 25.000", style: style("IDR")), "-25000", "store true minus")
check(CFN.normalize("2,5", style: style("USD")), "2.5", "store usd")
check(CFN.normalize("1.234,56", style: style("EUR")), "1234.56", "store eur")

// The list: Rupiah right under Percent, the rest in Notion's order; every name in both languages.
check(CFN.formats.prefix(5).map(\.code).joined(separator: ","), "number,number_with_separators,percent,IDR,USD", "list order")
check(String(CFN.formats.count), "45", "list size")
checkD(CFN.formats.last?.code == "BTC", "BTC last")
checkD(Set(CFN.formats.map(\.code)).count == CFN.formats.count, "codes unique")
check(CFN.info("IDR").shortName, "Rupiah", "short name en")
AppLanguage.shared.lang = .id
check(CFN.info("USD").name, "Dolar AS (USD)", "id name")
check(CFN.info("number_with_separators").shortName, "Angka dengan pemisah", "id short")
check(CFN.filterFormats("dolar").first?.code ?? "", "USD", "filter id")
AppLanguage.shared.lang = .en
// Fuzzy filter: substring matches first, then letters in order (Notion: "rup").
check(CFN.filterFormats("rup").map(\.code).joined(separator: ","), "IDR,INR,PKR,UYU", "filter rup")
check(CFN.filterFormats("").count.description, "45", "filter empty")
check(CFN.filterFormats("btc").first?.code ?? "", "BTC", "filter code")
check(CFN.filterFormats("zloty").first?.code ?? "", "PLN", "filter diacritics")
checkD(CFN.filterFormats("qqq").isEmpty, "filter none")

print("passes", passes, "fails", fails)
if fails > 0 { exit(1) }
