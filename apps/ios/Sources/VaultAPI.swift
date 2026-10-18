import Foundation

// ─────────────────────────────────────────────────────────────────────────────
// Z Vault endpoints.
//
// In their own file for the same reason FormFillAPI.swift is: APIClient.swift is long enough that
// touching it re-typechecks a great deal of the app. The cost of the split is one small `send`
// helper, which is the same trade that file already made.
//
// Everything here addresses items by ID. There is no method that takes a path, because the server
// has no route that accepts one.
// ─────────────────────────────────────────────────────────────────────────────

extension APIClient {

    // MARK: Browsing

    func vaultList(parentId: String? = nil, trash: Bool = false, query: String? = nil) async throws -> VaultListing {
        var items: [String] = []
        if let parentId, !parentId.isEmpty { items.append("parentId=\(vaultEnc(parentId))") }
        if trash { items.append("trash=1") }
        if let query, !query.isEmpty { items.append("q=\(vaultEnc(query))") }
        let path = "/api/vault/items" + (items.isEmpty ? "" : "?" + items.joined(separator: "&"))
        return try await vaultRun(makeRequest(path), decode: VaultListing.self)
    }

    @discardableResult
    func vaultCreateFolder(name: String, parentId: String?) async throws -> VaultItem {
        var req = makeRequest("/api/vault/items", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        var body: [String: Any] = ["name": name]
        if let parentId { body["parentId"] = parentId }
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await vaultRun(req, decode: VaultItem.self)
    }

    @discardableResult
    func vaultRename(_ itemId: String, to name: String) async throws -> VaultItem {
        try await vaultPatch(itemId, body: ["name": name])
    }

    @discardableResult
    func vaultRestore(_ itemId: String) async throws -> VaultItem {
        try await vaultPatch(itemId, body: ["restore": true])
    }

    /// Put an item in another folder, or at the top level with nil.
    ///
    /// The server decides everything that matters and its refusal is the text to show: a folder can
    /// never go into itself or anything below it, the destination must be a folder this person may
    /// write in, and a name already taken there gets " (2)" — so the item that comes back may carry a
    /// new name. The top level is sent as an explicit null: leaving `parentId` out would not be a move.
    @discardableResult
    func vaultMove(_ itemId: String, to parentId: String?) async throws -> VaultItem {
        try await vaultPatch(itemId, body: ["parentId": jsonOrNull(parentId)])
    }

    /// Set who may open (`read`) and add to (`write`) an item — BoD only, the server decides. Each is
    /// sent only when given: `.some(nil)` clears the item's own lock (it follows the folder above
    /// again), `.none` leaves that threshold alone.
    @discardableResult
    func vaultSetAccess(_ itemId: String, read: String??, write: String??) async throws -> VaultItem {
        var body: [String: Any] = [:]
        if let read { body["minReadRole"] = jsonOrNull(read) }
        if let write { body["minWriteRole"] = jsonOrNull(write) }
        return try await vaultPatch(itemId, body: body)
    }

    private func vaultPatch(_ itemId: String, body: [String: Any]) async throws -> VaultItem {
        var req = makeRequest("/api/vault/items/\(vaultEnc(itemId))", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        return try await vaultRun(req, decode: VaultItem.self)
    }

    /// `purge: false` is the trash and is reversible. `purge: true` unlinks the bytes and is not.
    @discardableResult
    func vaultDelete(_ itemId: String, purge: Bool = false) async throws -> Bool {
        let path = "/api/vault/items/\(vaultEnc(itemId))" + (purge ? "?purge=1" : "")
        _ = try await vaultRun(makeRequest(path, method: "DELETE"), decode: VaultDeleteResult.self)
        return true
    }

    @discardableResult
    func vaultEmptyTrash() async throws -> VaultDeleteResult {
        try await vaultRun(makeRequest("/api/vault/trash/empty", method: "POST"), decode: VaultDeleteResult.self)
    }

    // MARK: Sharing

    /// Every link made for one file or folder, plus whether this person may make an external one.
    func vaultShares(itemId: String) async throws -> VaultSharesResponse {
        let path = "/api/vault/shares?itemId=\(vaultEnc(itemId))"
        return try await vaultRun(makeRequest(path), decode: VaultSharesResponse.self)
    }

    func vaultCreateShare(itemId: String, requireAuth: Bool, allowDownload: Bool,
                          expires: VaultExpiry) async throws -> VaultShare {
        var req = makeRequest("/api/vault/shares", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "itemId": itemId,
            "requireAuth": requireAuth,
            "allowDownload": allowDownload,
            "expires": expires.rawValue,
        ])
        return try await vaultRun(req, decode: VaultShare.self)
    }

    @discardableResult
    func vaultRevokeShare(_ shareId: String) async throws -> VaultShare {
        try await vaultRun(makeRequest("/api/vault/shares/\(vaultEnc(shareId))", method: "DELETE"),
                           decode: VaultShare.self)
    }

    /// Resolve a tapped `/v/<slug>` link. Sent WITH the session when there is one — an internal link
    /// needs it, and an external link ignores it.
    func vaultPublic(slug: String) async throws -> VaultPublicFile {
        try await vaultRun(makeRequest("/api/vault/public/\(vaultEnc(slug))"), decode: VaultPublicFile.self)
    }

    /// One folder of a shared folder (since 9 Oct 2026). nil = the shared folder itself. The server
    /// answers 404 for anything outside what the link opens, so a stale id simply fails.
    func vaultPublicItems(slug: String, folderId: String?) async throws -> VaultPublicListing {
        let path = "/api/vault/public/\(vaultEnc(slug))/items" + (folderId.map { "?folderId=\(vaultEnc($0))" } ?? "")
        return try await vaultRun(makeRequest(path), decode: VaultPublicListing.self)
    }

    // MARK: Bytes

    /// A vault file on disk, cached the same way an attachment is.
    ///
    /// `/api/vault/items/<id>/raw` requires the session, exactly like `/api/files/…`, so this cannot
    /// be handed to Safari or to QuickLook's own fetch — and going through the client is also what
    /// makes it take the office LAN like everything else in the app.
    ///
    /// `AttachmentCache` keys on the URL, and a vault URL names the ITEM, which is stable on purpose —
    /// it is what keeps a link that has already been sent working after the logo behind it changes.
    /// Since "Replace file…" (9 Oct 2026) the server puts the file's content version in that URL
    /// (`…/raw?v=<fileVersion>`), so a replaced file arrives at a new URL and this cache misses
    /// instead of handing back the old bytes. Nothing here builds the URL; it is used as given.
    func vaultDownload(item: VaultItem, progress: UploadProgress? = nil) async throws -> URL {
        guard let raw = item.url else { throw APIError.transport(T("That file has no address.")) }
        return try await downloadAttachment(url: raw, fileName: item.name, progress: progress)
    }

    // MARK: Upload

    /// Put a file into the vault.
    ///
    /// Takes a URL, not `Data`, for the same reason task attachments do: the size decides the route,
    /// and holding a large file in memory to build a body around it is two copies of it resident
    /// before a byte leaves.
    @discardableResult
    func vaultUpload(file: URL, fileName: String, parentId: String?,
                     progress: UploadProgress? = nil) async throws -> Bool {
        let size = Self.fileSize(of: file)
        guard size > 0 else { throw APIError.transport(T("Couldn't read that file.")) }

        if size <= Self.singleRequestCeiling {
            let data = try Data(contentsOf: file, options: .mappedIfSafe)
            let boundary = "Boundary-\(UUID().uuidString)"
            var req = makeRequest("/api/vault/upload", method: "POST")
            req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            var body = Data()
            func add(_ s: String) { body.append(Data(s.utf8)) }
            if let parentId {
                add("--\(boundary)\r\nContent-Disposition: form-data; name=\"parentId\"\r\n\r\n\(parentId)\r\n")
            }
            add("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(vaultQuoted(fileName))\"\r\nContent-Type: application/octet-stream\r\n\r\n")
            body.append(data)
            add("\r\n--\(boundary)--\r\n")
            req.httpBody = body
            _ = try await vaultRun(req, decode: VaultItem.self, reporting: progress)
            return true
        }

        // Bigger than one request can carry past Cloudflare — the shared chunk route, with the vault
        // as its target. Same transport as a task attachment; only the destination differs.
        try await uploadInChunks(file: file, fileName: fileName, size: size,
                                 extraQuery: "&target=vault" + (parentId.map { "&parentId=\(vaultEnc($0))" } ?? ""),
                                 progress: progress)
        return true
    }

    /// New bytes for an existing file — same item id, same place, same links ("Replace file…",
    /// 9 Oct 2026). One request for a small file; the shared chunk route with `replaceItemId` for a
    /// large one. The server answers with the item, carrying its new `fileVersion` and URLs.
    @discardableResult
    func vaultReplace(itemId: String, file: URL, fileName: String,
                      progress: UploadProgress? = nil) async throws -> Bool {
        let size = Self.fileSize(of: file)
        guard size > 0 else { throw APIError.transport(T("Couldn't read that file.")) }

        if size <= Self.singleRequestCeiling {
            let data = try Data(contentsOf: file, options: .mappedIfSafe)
            let boundary = "Boundary-\(UUID().uuidString)"
            var req = makeRequest("/api/vault/items/\(vaultEnc(itemId))/replace", method: "POST")
            req.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
            var body = Data()
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"\(vaultQuoted(fileName))\"\r\nContent-Type: application/octet-stream\r\n\r\n".utf8))
            body.append(data)
            body.append(Data("\r\n--\(boundary)--\r\n".utf8))
            req.httpBody = body
            _ = try await vaultRun(req, decode: VaultItem.self, reporting: progress)
            return true
        }
        try await uploadInChunks(file: file, fileName: fileName, size: size,
                                 extraQuery: "&target=vault&replaceItemId=\(vaultEnc(itemId))",
                                 progress: progress)
        return true
    }

    // MARK: Google Workspace

    /// Akun Workspace yang bisa ditautkan. BoD saja; server menjawab 403 untuk yang lain.
    func googleWorkspaceAccounts() async throws -> GoogleWorkspaceAccounts {
        try await vaultRun(makeRequest("/api/admin/google-workspace/accounts"), decode: GoogleWorkspaceAccounts.self)
    }

    /// Tautkan (atau lepas, dengan nil). Server memverifikasi alamatnya benar-benar ada di Google
    /// sebelum menyimpan — jadi kegagalan di sini berarti alamatnya tidak ada atau sudah dipakai
    /// orang lain, dua hal yang pesannya perlu sampai apa adanya ke layar.
    @discardableResult
    func linkGoogleWorkspace(userId: String, email: String?) async throws -> Bool {
        var req = makeRequest("/api/admin/users/\(vaultEnc(userId))", method: "PATCH")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        // NSNull, bukan `nil as Any`: JSONSerialization menolak nil di dalam dictionary dan akan
        // melempar, sehingga MELEPAS tautan gagal sementara memasangnya berhasil — cacat yang cuma
        // muncul di satu arah dan karenanya mudah lolos dari pengujian.
        req.httpBody = try JSONSerialization.data(
            withJSONObject: ["googleWorkspaceEmail": jsonOrNull(email)])
        _ = try await vaultRun(req, decode: GoogleLinkResponse.self)
        return true
    }

    /// Keanggotaan tim + project SEMUA orang sekaligus. BoD saja; server menjawab 403 untuk yang lain.
    func adminUserMemberships() async throws -> UserMembershipsResponse {
        try await vaultRun(makeRequest("/api/admin/users/memberships"), decode: UserMembershipsResponse.self)
    }

    /// Membuat mailbox Google Workspace baru dan menautkannya ke satu profil NEXUS.
    ///
    /// Ini MENGISI satu seat lisensi berbayar dan mengembalikan sandi sementara yang hanya bisa
    /// dilihat sekali. BoD saja; server menolak yang lain dengan 403 dan memeriksa dulu apakah
    /// alamatnya sudah ada sebelum membuat.
    func createGoogleWorkspaceAccount(userId: String, localPart: String, domain: String,
                                      givenName: String, familyName: String) async throws -> CreatedGoogleAccount {
        var req = makeRequest("/api/admin/google-workspace/users", method: "POST")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONSerialization.data(withJSONObject: [
            "userId": userId, "localPart": localPart, "domain": domain,
            "givenName": givenName, "familyName": familyName,
        ])
        return try await vaultRun(req, decode: CreatedGoogleAccount.self)
    }

    // MARK: Plumbing

    /// `run` is private to APIClient.swift and Swift's `private` does not reach across files, so this
    /// extension brings the same three rules with it: transport errors named, 401 distinguished from
    /// every other failure so the session can be dropped, and a decode failure kept separate from a
    /// refusal. Any drift between the two is a bug in this file, not a difference worth having.
    private func vaultRun<T: Decodable>(_ req: URLRequest, decode: T.Type,
                                        reporting progress: UploadProgress? = nil) async throws -> T {
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await perform(req, reporting: progress)
        } catch {
            throw APIError.nothingAnswered(error)
        }
        guard let http = response as? HTTPURLResponse else { throw APIError.transport("No response") }
        if http.statusCode == 401 { throw APIError.unauthorized }
        guard (200..<300).contains(http.statusCode) else {
            // The vault routes answer with a reason for every refusal they author — over quota, not
            // a folder, somebody else's file, a link that was revoked — and those are worth showing
            // rather than replacing with a status code.
            throw APIClient.vaultRefusal(data, status: http.statusCode)
        }
        do { return try JSONDecoder().decode(T.self, from: data) }
        catch { throw APIError.decoding }
    }

    private static func vaultRefusal(_ body: Data, status: Int) -> APIError {
        guard let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any] else {
            return .http(status, nil)
        }
        // A share link's reason, or a refusal's code, in the app's language (since 9 Oct 2026). The
        // server's own sentence is Indonesian whatever the app is set to.
        //
        // `.http` with the sentence rather than `.transport` (9 Oct 2026): the text shown is the same,
        // but the status survives, and the upload panel words a full vault (507), a locked or vanished
        // folder (403/404) or a file too big (413) from it. `.transport` also read as "nobody
        // answered" to `nobodyAnswered`, which a refusal is not.
        if let key = (obj["reason"] as? String) ?? (obj["code"] as? String), let text = vaultReasonText[key] {
            return .http(status, T(text))
        }
        if let message = obj["error"] as? String, !message.isEmpty {
            return .http(status, message)
        }
        return .http(status, nil)
    }

    /// English source text per `reason` (share links) or `code` (refusals); T() translates.
    private static let vaultReasonText: [String: String] = [
        "missing": "This link doesn't exist. Ask the sender for a new link.",
        "revoked": "The person who shared this link has turned it off. Ask the sender for a new link.",
        "expired": "This link has expired. Ask the sender for a new link.",
        "gone": "What this link opened is no longer available. Ask the sender for a new link.",
        "not_member": "This link is only for people at the company that shared it.",
        "forbidden": "This folder is locked to certain roles, and yours isn't one of them.",
        "PREVIEW_ONLY": "This file can't be previewed, and the sender turned downloads off.",
        "VIEW_ONLY": "This link is view-only. The sender turned downloads off.",
        "EXTERNAL_NOT_ALLOWED": "Only the person who uploaded this, or the board, can make a link for people outside NEXUS.",
        "NOT_YOURS": "Only the person who uploaded this, or the board, can do that.",
        "TRASHED": "This file is in the trash. Restore it first.",
        "QUOTA": "The vault is full.",
    ]

    private func vaultEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))) ?? s
    }

    /// A quote or a newline in a filename would end the multipart header early. Everything else is
    /// left alone so the name the server stores is the name the person picked.
    private func vaultQuoted(_ raw: String) -> String {
        raw.replacingOccurrences(of: "\"", with: "")
            .replacingOccurrences(of: "\r", with: "")
            .replacingOccurrences(of: "\n", with: "")
    }
}

struct VaultDeleteResult: Codable {
    let trashed: Int?
    let purged: Int?
    let filesUnlinked: Int?
}


/// Balasan PATCH profil. Hanya field yang benar-benar dibaca layar ini.
struct GoogleLinkResponse: Codable {
    struct U: Codable { let id: String?; let googleWorkspaceEmail: String? }
    let user: U?
}
