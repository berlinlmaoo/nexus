import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Getting a dropped file out of the system before the system takes it back.
//
// A drop hands the app a file that only exists while the provider's callback runs: Photos exports
// a temporary copy, Files and Finder hand over a URL that may be security-scoped. So the copy is
// made INSIDE the callback, into this app's own temporary folder, and only that copy is uploaded.
//
// Plain Foundation on purpose. The NSItemProvider and UTType calls live in `VaultDropReader`
// (VaultView.swift); what is here — which representation to ask for, what to call the file, and
// the copy itself — compiles on Linux, where it is run against a stub provider that deletes its
// file the moment its callback returns, the way the system does.
// ─────────────────────────────────────────────────────────────────────────────

enum VaultDropFiles {
    /// `tmp/vault-drops/<uuid>/` — one folder per file, so two drops of "IMG_0001.jpg" never meet,
    /// and the folder is what gets deleted once the upload is over.
    static func freshFolder() throws -> URL {
        let folder = FileManager.default.temporaryDirectory
            .appendingPathComponent("vault-drops", isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder
    }

    /// Copy `url` to `tmp/vault-drops/<uuid>/<name>`. Must run inside the provider's callback.
    static func stash(_ url: URL, as name: String) throws -> URL {
        let destination = try freshFolder().appendingPathComponent(name)
        try FileManager.default.copyItem(at: url, to: destination)
        return destination
    }

    /// For a provider that only hands over bytes (`loadDataRepresentation`).
    static func stash(_ data: Data, as name: String) throws -> URL {
        let destination = try freshFolder().appendingPathComponent(name)
        try data.write(to: destination)
        return destination
    }

    /// Which of a provider's registered types to ask for, best first.
    ///
    /// The provider lists its types in fidelity order, so the first one that IS the file's content
    /// wins — not a URL to it, not Photos' private thumbnails, and not a package (a Live Photo
    /// bundle is a folder) while a plain file is on offer. One exception: a HEIC or HEIF photo that
    /// is also offered as JPEG is taken as the JPEG, the same choice the Photos picker makes
    /// (`.compatible`): the vault's thumbnails and every browser a link goes to can show a JPEG.
    ///
    /// `conforms(id, to)` answers UTType conformance; passed in so the choice can be tested where
    /// UniformTypeIdentifiers does not exist.
    static func contentType(_ ids: [String], conforms: (String, String) -> Bool) -> String? {
        let usable = ids.filter { id in
            let lower = id.lowercased()
            if lower.contains(".private.") || lower.contains("thumbnail") { return false }
            if conforms(id, "public.url") { return false }
            return conforms(id, "public.data") || conforms(id, "com.apple.package")
        }
        guard var pick = usable.first(where: { !conforms($0, "com.apple.package") }) ?? usable.first else {
            return nil
        }
        if conforms(pick, "public.heic") || conforms(pick, "public.heif"),
           let jpeg = usable.first(where: { conforms($0, "public.jpeg") }) {
            pick = jpeg
        }
        return pick
    }

    /// Extensions that only say which picture or film format the bytes are in. When the name a
    /// source suggests carries one of these and the bytes asked for are another (Photos suggests
    /// "IMG_3713.HEIC", the JPEG was taken), the extension is swapped rather than doubled.
    private static let mediaExtensions: Set<String> = [
        "heic", "heif", "jpg", "jpeg", "png", "gif", "tif", "tiff", "webp", "bmp", "dng",
        "mov", "mp4", "m4v", "hevc", "avi",
    ]

    /// The name the vault stores.
    ///
    /// The source's own name when it has one ("IMG_3713" from Photos, "Deck.pdf" from Files), else
    /// the received file's name, else one made from the time ("IMG_20261009_042512.jpg"). Internal
    /// names some sources hand out ("version=1&uuid=…", a bare UUID) count as no name. `ext` is the
    /// chosen type's preferred extension, added when the name has none.
    static func fileName(suggested: String?, received: String?, ext: String?, now: Date = Date()) -> String {
        let wanted: String? = {
            guard let e = ext?.lowercased(), !e.isEmpty else { return nil }
            return e == "jpeg" ? "jpg" : e
        }()
        var base: String?
        for candidate in [suggested, received] {
            guard let raw = candidate else { continue }
            let cleaned = clean(raw)
            if !cleaned.isEmpty && !looksInternal(cleaned) { base = cleaned; break }
        }
        guard var name = base else {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "yyyyMMdd_HHmmss"
            return "IMG_\(f.string(from: now))" + (wanted.map { ".\($0)" } ?? "")
        }
        guard let wanted else { return name }
        let current = (name as NSString).pathExtension.lowercased()
        if current.isEmpty {
            name += "." + wanted
        } else if current != wanted && !(current == "jpeg" && wanted == "jpg") {
            if mediaExtensions.contains(current) && mediaExtensions.contains(wanted) {
                name = (name as NSString).deletingPathExtension + "." + wanted
            } else if !mediaExtensions.contains(current) && current.count > 5 {
                // "Q3.final-cut" is a name with a dot in it, not a type: keep it and add the type.
                name += "." + wanted
            }
            // Otherwise the source named its own type ("Deck.key" sent as a zip): its name stands.
        }
        return name
    }

    /// No path separators, no colons (Finder's old separator), no surrounding space.
    private static func clean(_ raw: String) -> String {
        raw.replacingOccurrences(of: "/", with: "-")
            .replacingOccurrences(of: ":", with: "-")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private static func looksInternal(_ name: String) -> Bool {
        if name.contains("=") || name.count > 120 { return true }
        let stem = (name as NSString).deletingPathExtension
        return UUID(uuidString: stem) != nil
    }
}
