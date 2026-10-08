// Socket.IO v4 over Engine.IO v4 on a WebSocket: the wire format and nothing else. No sockets, no
// timers, no app types, not even Foundation — so this file compiles on Linux as it is, and its tests
// run there against frames recorded from a real socket.io 4.8 server (the version NEXUS runs).
//
// One WebSocket text frame is one Engine.IO packet, a type digit followed by its data:
//
//   0{"sid":…,"upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
//        open — the server's first frame
//   1    close
//   2    ping — in v4 the SERVER pings, every pingInterval, and the client answers
//   3    pong
//   4…   message — carries one Socket.IO packet
//   5 6  upgrade / noop — only used when a polling connection upgrades; never seen here
//
// The Socket.IO packet inside a message:  <type>[<attachments>-][<namespace>,][<ack id>][<JSON>]
//
//   40              connect: the client asks for the default namespace
//   40{"sid":…}     connect: the server accepted (pages/api/socket.ts `io.use` let it through)
//   41              disconnect
//   42["name",…]    event
//   43<id>[…]       ack
//   44{"message":…} connect error: `io.use` called next(new Error(message))
//   45 46           binary event / ack: the attachments follow as binary frames. NEXUS sends none.

// MARK: - JSON

/// A JSON value that keeps an object's keys in the order they were written.
///
/// JavaScript's JSON.stringify writes keys in insertion order, and keeping that order is what lets a
/// frame be parsed and written back byte for byte — the test that the parser misses nothing — and
/// lets this client write `join-room` exactly as socket.io-client writes it.
enum SIOJSON: Equatable {
    case null
    case bool(Bool)
    /// The number exactly as it was written, so writing it back changes nothing.
    case number(String)
    case string(String)
    case array([SIOJSON])
    case object([Member])

    struct Member: Equatable {
        let key: String
        let value: SIOJSON
    }

    /// An object from a literal, keys in the order given: `.fields(["room": .string(r)])`.
    static func fields(_ pairs: KeyValuePairs<String, SIOJSON>) -> SIOJSON {
        .object(pairs.map { Member(key: $0.key, value: $0.value) })
    }

    static func int(_ value: Int) -> SIOJSON { .number(String(value)) }

    // MARK: reading

    /// The first member with this key, when this is an object.
    subscript(key: String) -> SIOJSON? {
        guard case .object(let members) = self else { return nil }
        return members.first(where: { $0.key == key })?.value
    }

    var string: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    var double: Double? {
        if case .number(let n) = self { return Double(n) }
        return nil
    }

    var int: Int? { double.flatMap { Int(exactly: $0) } }

    var array: [SIOJSON]? {
        if case .array(let items) = self { return items }
        return nil
    }

    // MARK: writing

    /// The value as JSON.stringify would write it: no whitespace, keys in their order, the same
    /// escapes (`"` `\` and the C0 controls; `/` and everything above U+001F left as they are).
    var serialized: String {
        var out = ""
        write(into: &out)
        return out
    }

    private func write(into out: inout String) {
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .number(let n): out += n
        case .string(let s): Self.quote(s, into: &out)
        case .array(let items):
            out += "["
            for (i, item) in items.enumerated() {
                if i > 0 { out += "," }
                item.write(into: &out)
            }
            out += "]"
        case .object(let members):
            out += "{"
            for (i, member) in members.enumerated() {
                if i > 0 { out += "," }
                Self.quote(member.key, into: &out)
                out += ":"
                member.value.write(into: &out)
            }
            out += "}"
        }
    }

    private static let hexDigits = Array("0123456789abcdef")

    private static func quote(_ s: String, into out: inout String) {
        out += "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if scalar.value < 0x20 {
                    out += "\\u00"
                    out.append(hexDigits[Int(scalar.value >> 4)])
                    out.append(hexDigits[Int(scalar.value & 0xF)])
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
    }

    // MARK: parsing

    /// nil for anything that is not exactly one JSON value (surrounding whitespace allowed).
    ///
    /// One known loss: a lone UTF-16 surrogate (`"\ud800"`), which JSON.stringify can write but a
    /// Swift String cannot hold, becomes U+FFFD. Nothing NEXUS sends contains one.
    static func parse<S: StringProtocol>(_ text: S) -> SIOJSON? {
        var reader = Reader(Array(text.utf8))
        reader.skipSpace()
        guard let value = reader.value(depth: 0) else { return nil }
        reader.skipSpace()
        return reader.atEnd ? value : nil
    }

    private struct Reader {
        let bytes: [UInt8]
        var i = 0
        init(_ bytes: [UInt8]) { self.bytes = bytes }

        var atEnd: Bool { i >= bytes.count }

        mutating func skipSpace() {
            while i < bytes.count, bytes[i] == 0x20 || bytes[i] == 0x09 || bytes[i] == 0x0A || bytes[i] == 0x0D { i += 1 }
        }

        mutating func value(depth: Int) -> SIOJSON? {
            // A frame nested this deep is not one the server wrote; refuse it rather than recurse.
            guard depth < 256, i < bytes.count else { return nil }
            switch bytes[i] {
            case UInt8(ascii: "{"): return object(depth: depth)
            case UInt8(ascii: "["): return array(depth: depth)
            case UInt8(ascii: "\""): return string().map(SIOJSON.string)
            case UInt8(ascii: "t"): return literal("true", .bool(true))
            case UInt8(ascii: "f"): return literal("false", .bool(false))
            case UInt8(ascii: "n"): return literal("null", .null)
            default: return number()
            }
        }

        mutating func literal(_ word: String, _ result: SIOJSON) -> SIOJSON? {
            let w = Array(word.utf8)
            guard i + w.count <= bytes.count, Array(bytes[i..<(i + w.count)]) == w else { return nil }
            i += w.count
            return result
        }

        mutating func object(depth: Int) -> SIOJSON? {
            i += 1 // {
            var members: [Member] = []
            skipSpace()
            if i < bytes.count, bytes[i] == UInt8(ascii: "}") { i += 1; return .object(members) }
            while true {
                skipSpace()
                guard i < bytes.count, bytes[i] == UInt8(ascii: "\""), let key = string() else { return nil }
                skipSpace()
                guard i < bytes.count, bytes[i] == UInt8(ascii: ":") else { return nil }
                i += 1
                skipSpace()
                guard let v = value(depth: depth + 1) else { return nil }
                members.append(Member(key: key, value: v))
                skipSpace()
                guard i < bytes.count else { return nil }
                if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
                if bytes[i] == UInt8(ascii: "}") { i += 1; return .object(members) }
                return nil
            }
        }

        mutating func array(depth: Int) -> SIOJSON? {
            i += 1 // [
            var items: [SIOJSON] = []
            skipSpace()
            if i < bytes.count, bytes[i] == UInt8(ascii: "]") { i += 1; return .array(items) }
            while true {
                skipSpace()
                guard let v = value(depth: depth + 1) else { return nil }
                items.append(v)
                skipSpace()
                guard i < bytes.count else { return nil }
                if bytes[i] == UInt8(ascii: ",") { i += 1; continue }
                if bytes[i] == UInt8(ascii: "]") { i += 1; return .array(items) }
                return nil
            }
        }

        mutating func string() -> String? {
            i += 1 // opening quote
            var out: [UInt8] = []
            while i < bytes.count {
                let b = bytes[i]
                if b == UInt8(ascii: "\"") {
                    i += 1
                    return String(decoding: out, as: UTF8.self)
                }
                if b < 0x20 { return nil } // a raw control character is not valid JSON
                guard b == UInt8(ascii: "\\") else {
                    out.append(b)
                    i += 1
                    continue
                }
                i += 1
                guard i < bytes.count else { return nil }
                let e = bytes[i]
                i += 1
                switch e {
                case UInt8(ascii: "\""): out.append(UInt8(ascii: "\""))
                case UInt8(ascii: "\\"): out.append(UInt8(ascii: "\\"))
                case UInt8(ascii: "/"): out.append(UInt8(ascii: "/"))
                case UInt8(ascii: "b"): out.append(0x08)
                case UInt8(ascii: "f"): out.append(0x0C)
                case UInt8(ascii: "n"): out.append(0x0A)
                case UInt8(ascii: "r"): out.append(0x0D)
                case UInt8(ascii: "t"): out.append(0x09)
                case UInt8(ascii: "u"):
                    guard let unit = hex4(at: i) else { return nil }
                    i += 4
                    var value = unit
                    if (0xD800...0xDBFF).contains(unit) {
                        // A high surrogate counts only with its low half straight after it.
                        if i + 5 < bytes.count, bytes[i] == UInt8(ascii: "\\"), bytes[i + 1] == UInt8(ascii: "u"),
                           let low = hex4(at: i + 2), (0xDC00...0xDFFF).contains(low) {
                            i += 6
                            value = 0x10000 + ((unit - 0xD800) << 10) + (low - 0xDC00)
                        } else {
                            value = 0xFFFD
                        }
                    } else if (0xDC00...0xDFFF).contains(unit) {
                        value = 0xFFFD
                    }
                    let scalar = Unicode.Scalar(value) ?? "\u{FFFD}"
                    Unicode.UTF8.encode(scalar) { out.append($0) }
                default:
                    return nil
                }
            }
            return nil
        }

        func hex4(at start: Int) -> UInt32? {
            guard start + 4 <= bytes.count else { return nil }
            var v: UInt32 = 0
            for b in bytes[start..<(start + 4)] {
                let d: UInt32
                switch b {
                case UInt8(ascii: "0")...UInt8(ascii: "9"): d = UInt32(b - UInt8(ascii: "0"))
                case UInt8(ascii: "a")...UInt8(ascii: "f"): d = UInt32(b - UInt8(ascii: "a") + 10)
                case UInt8(ascii: "A")...UInt8(ascii: "F"): d = UInt32(b - UInt8(ascii: "A") + 10)
                default: return nil
                }
                v = v * 16 + d
            }
            return v
        }

        mutating func number() -> SIOJSON? {
            let start = i
            if i < bytes.count, bytes[i] == UInt8(ascii: "-") { i += 1 }
            guard skipDigits() > 0 else { return nil }
            if i < bytes.count, bytes[i] == UInt8(ascii: ".") {
                i += 1
                guard skipDigits() > 0 else { return nil }
            }
            if i < bytes.count, bytes[i] == UInt8(ascii: "e") || bytes[i] == UInt8(ascii: "E") {
                i += 1
                if i < bytes.count, bytes[i] == UInt8(ascii: "+") || bytes[i] == UInt8(ascii: "-") { i += 1 }
                guard skipDigits() > 0 else { return nil }
            }
            return .number(String(decoding: bytes[start..<i], as: UTF8.self))
        }

        /// How many digits were stepped over.
        mutating func skipDigits() -> Int {
            let start = i
            while i < bytes.count, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(bytes[i]) { i += 1 }
            return i - start
        }
    }
}

// MARK: - Frames

/// One WebSocket text frame, decoded. `SIOFrame(text).text == text` for every frame a socket.io
/// server writes: nothing is normalised away, so what this reads is all there was.
enum SIOFrame: Equatable {
    // Engine.IO
    case open(SIOJSON)
    case close
    case ping(String)
    case pong(String)
    case upgrade(String)
    case noop
    // Socket.IO, inside an Engine.IO message
    case connect(namespace: String, payload: SIOJSON?)
    case disconnect(namespace: String)
    case event(namespace: String, ack: Int?, name: String, args: [SIOJSON])
    case ack(namespace: String, id: Int, args: [SIOJSON])
    case connectError(namespace: String, payload: SIOJSON?)
    /// A binary event or ack, kept verbatim: its attachments follow as binary frames, and nothing in
    /// NEXUS sends one.
    case binary(String)
    /// Not a frame this protocol defines; kept verbatim so it can be logged.
    case malformed(String)

    init(_ text: String) {
        // Worked in UTF-8: every marker in this protocol is ASCII, and slicing bytes cannot merge a
        // type digit into the character after it the way slicing Characters could.
        let utf8 = Array(text.utf8)
        guard let first = utf8.first else { self = .malformed(text); return }
        let rest = Array(utf8.dropFirst())
        let restText = String(decoding: rest, as: UTF8.self)
        switch first {
        case UInt8(ascii: "0"): self = SIOJSON.parse(restText).map(SIOFrame.open) ?? .malformed(text)
        case UInt8(ascii: "1"): self = rest.isEmpty ? .close : .malformed(text)
        case UInt8(ascii: "2"): self = .ping(restText)
        case UInt8(ascii: "3"): self = .pong(restText)
        case UInt8(ascii: "4"): self = Self.socketPacket(rest, whole: text)
        case UInt8(ascii: "5"): self = .upgrade(restText)
        case UInt8(ascii: "6"): self = rest.isEmpty ? .noop : .malformed(text)
        default: self = .malformed(text)
        }
    }

    /// `<type>[<attachments>-][<namespace>,][<ack id>][<JSON>]`, as socket.io-parser 4 reads it.
    private static func socketPacket(_ bytes: [UInt8], whole: String) -> SIOFrame {
        guard let typeByte = bytes.first, (UInt8(ascii: "0")...UInt8(ascii: "6")).contains(typeByte) else {
            return .malformed(whole)
        }
        let type = typeByte - UInt8(ascii: "0")
        if type == 5 || type == 6 { return .binary(whole) }
        var i = 1
        var namespace = "/"
        if i < bytes.count, bytes[i] == UInt8(ascii: "/") {
            let start = i
            while i < bytes.count, bytes[i] != UInt8(ascii: ",") { i += 1 }
            namespace = String(decoding: bytes[start..<i], as: UTF8.self)
            if i < bytes.count { i += 1 } // the comma
        }
        var ack: Int?
        let digitsStart = i
        while i < bytes.count, (UInt8(ascii: "0")...UInt8(ascii: "9")).contains(bytes[i]) { i += 1 }
        if i > digitsStart {
            guard let id = Int(String(decoding: bytes[digitsStart..<i], as: UTF8.self)) else { return .malformed(whole) }
            ack = id
        }
        var payload: SIOJSON?
        if i < bytes.count {
            guard let parsed = SIOJSON.parse(String(decoding: bytes[i...], as: UTF8.self)) else { return .malformed(whole) }
            payload = parsed
        }
        switch type {
        case 0:
            guard ack == nil else { return .malformed(whole) }
            return .connect(namespace: namespace, payload: payload)
        case 1:
            guard ack == nil, payload == nil else { return .malformed(whole) }
            return .disconnect(namespace: namespace)
        case 2:
            guard let items = payload?.array, let name = items.first?.string else { return .malformed(whole) }
            return .event(namespace: namespace, ack: ack, name: name, args: Array(items.dropFirst()))
        case 3:
            guard let ack, let items = payload?.array else { return .malformed(whole) }
            return .ack(namespace: namespace, id: ack, args: items)
        case 4:
            guard ack == nil else { return .malformed(whole) }
            return .connectError(namespace: namespace, payload: payload)
        default:
            return .malformed(whole)
        }
    }

    /// The frame as it goes on the wire — the exact text socket.io writes for it.
    var text: String {
        switch self {
        case .open(let info): return "0" + info.serialized
        case .close: return "1"
        case .ping(let data): return "2" + data
        case .pong(let data): return "3" + data
        case .upgrade(let data): return "5" + data
        case .noop: return "6"
        case .connect(let ns, let payload):
            return "40" + Self.prefix(ns) + (payload?.serialized ?? "")
        case .disconnect(let ns):
            return "41" + Self.prefix(ns)
        case .event(let ns, let ack, let name, let args):
            return "42" + Self.prefix(ns) + (ack.map(String.init) ?? "") + SIOJSON.array([.string(name)] + args).serialized
        case .ack(let ns, let id, let args):
            return "43" + Self.prefix(ns) + String(id) + SIOJSON.array(args).serialized
        case .connectError(let ns, let payload):
            return "44" + Self.prefix(ns) + (payload?.serialized ?? "")
        case .binary(let raw), .malformed(let raw):
            return raw
        }
    }

    /// The default namespace is written as nothing at all; any other as `/name,`.
    private static func prefix(_ namespace: String) -> String {
        namespace == "/" ? "" : namespace + ","
    }
}

/// What the server's open packet says about keeping the link alive.
struct SIOHandshake: Equatable {
    let sid: String
    /// How often the server pings, in milliseconds.
    let pingInterval: Int
    /// How long after a ping the server waits for the pong, in milliseconds. A client that has heard
    /// nothing for pingInterval + pingTimeout is talking to a dead link.
    let pingTimeout: Int

    init?(_ open: SIOJSON) {
        guard let sid = open["sid"]?.string else { return nil }
        self.sid = sid
        pingInterval = open["pingInterval"]?.int ?? 25_000
        pingTimeout = open["pingTimeout"]?.int ?? 20_000
    }
}

// MARK: - What this client writes

/// The frames NEXUS's client sends, byte for byte what socket.io-client 4.8 sends for the same calls.
enum SIOWire {
    /// Connect to the default namespace. No auth payload: the server reads the session cookie.
    static var connect: String { SIOFrame.connect(namespace: "/", payload: nil).text }

    /// The answer to a server ping, echoing its data (none in practice).
    static func pong(_ data: String = "") -> String { SIOFrame.pong(data).text }

    /// `socket.emit(name, ...args)` without an acknowledgement.
    static func event(_ name: String, _ args: SIOJSON...) -> String {
        SIOFrame.event(namespace: "/", ack: nil, name: name, args: args).text
    }
}

// MARK: - Policy

/// The pause before reconnect number `attempt` (0 = the first retry): a ceiling that doubles from
/// `base` up to `cap`, spread between half and all of it so a server restart is not met by every
/// client at the same instant. `unit` is a random number in 0..<1, passed in so tests can pin it.
enum SIOBackoff {
    static func delay(attempt: Int, unit: Double, base: Double = 1, cap: Double = 30) -> Double {
        var ceiling = base
        var n = 0
        while n < attempt, ceiling < cap {
            ceiling *= 2
            n += 1
        }
        ceiling = min(ceiling, cap)
        return ceiling * (0.5 + 0.5 * min(max(unit, 0), 1))
    }
}

/// How the server's `44` refusals are taken (pages/api/socket.ts, `io.use`).
enum SIOConnectRefusal {
    /// The refusals that are about the SESSION, which no retry can fix: no cookie at all, or a
    /// session the server will not accept (signed out elsewhere, offboarded, deleted, revoked).
    /// Anything else — "Authentication failed" is the server's catch-all for an exception, say the
    /// database blinking — is worth trying again.
    static let sessionMessages: Set<String> = ["Authentication required", "Invalid session"]

    static func isSessionRefused(_ payload: SIOJSON?) -> Bool {
        guard let message = payload?["message"]?.string ?? payload?.string else { return false }
        return sessionMessages.contains(message)
    }
}
