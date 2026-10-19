import Foundation

enum ChatAttachment {
    static func isDocument(_ type: String?, path: String?) -> Bool {
        let mime = (type ?? "").lowercased()
        if mime.hasPrefix("image/") { return false }
        if mime.hasPrefix("application/") || mime.hasPrefix("text/") { return true }
        let ext = URL(string: path ?? "")?.pathExtension.lowercased() ?? ""
        return ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "csv", "txt", "zip"].contains(ext)
    }
}
