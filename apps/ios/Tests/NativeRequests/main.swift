import Foundation
let uuid = "019a12d5-1234-7000-8000-000000000001"
for id in [uuid,"legacycuid000000000000001","future id_~"] {
    let _: NativeAPI.Empty = try await NativeAPI.request("/api/meetings/" + NativeAPI.escape(id))
    precondition(APIClient.last?.url?.lastPathComponent == id, "An opaque ID must survive the URL builder without double encoding")
    let _: NativeAPI.Empty = try await NativeAPI.request("/api/gideon/people/" + NativeAPI.escape(id) + "/chats?q=" + NativeAPI.escape("space & punctuation"))
    let url = APIClient.last!.url!
    precondition(url.path == "/api/gideon/people/" + id + "/chats")
    precondition(URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == "space & punctuation")
}
let _: NativeAPI.Empty = try await NativeAPI.request("/api/gideon/task-targets?projectId=" + NativeAPI.escape(uuid))
precondition(URLComponents(url: APIClient.last!.url!, resolvingAgainstBaseURL: false)?.queryItems?.first?.value == uuid)
for id in [uuid, "legacycuid000000000000001"] {
    for prefix in ["/api/gideon/proposals/", "/api/gideon/chats/"] {
        precondition(GideonRequestProbe.url(prefix + GideonRequestProbe.enc(id)).lastPathComponent == id, "GIDEON decisions and rename/delete must preserve UUIDs")
    }
    let request = APIClient.shared.makeRequest("/api/projects/" + GideonRequestProbe.enc(id) + "/social-media")
    precondition(request.url!.path == "/api/projects/" + id + "/social-media", "Shared legacy component encoding must preserve UUID paths")
}
print("16 native and GIDEON request path/query contract checks passed")
