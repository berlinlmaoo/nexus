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

    func vaultShares(itemId: String) async throws -> [VaultShare] {
        let path = "/api/vault/shares?itemId=\(vaultEnc(itemId))"
        return (try await vaultRun(makeRequest(path), decode: VaultSharesResponse.self)).shares
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

    // MARK: Bytes

    /// A vault file on disk, cached the same way an attachment is.
    ///
    /// `/api/vault/items/<id>/raw` requires the session, exactly like `/api/files/…`, so this cannot
    /// be handed to Safari or to QuickLook's own fetch — and going through the client is also what
    /// makes it take the office LAN like everything else in the app.
    ///
    /// A WARNING for whoever adds "replace this file" in 0.1.5. `AttachmentCache` keys on the URL,
    /// and it does that safely today because an attachment URL carries a random on-disk name that is
    /// never reused. A vault URL is the ITEM id, which is stable on purpose — that is what keeps a
    /// link that has already been sent working after the logo behind it changes. The moment bytes
    /// can be swapped under an id, this cache will keep handing back the old file with no way to
    /// notice, and the fix belongs there (a version or an ETag in the key), not in the viewer.
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
            throw APIError.transport(error.localizedDescription)
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
        if let obj = try? JSONSerialization.jsonObject(with: body) as? [String: Any],
           let message = obj["error"] as? String, !message.isEmpty {
            return .transport(message)
        }
        return .http(status)
    }

    private func vaultEnc(_ s: String) -> String {
        s.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? s
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
