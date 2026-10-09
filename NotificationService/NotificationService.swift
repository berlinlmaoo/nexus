import UserNotifications
import UniformTypeIdentifiers

/// Puts the photo on a Threads push, so a long press shows the picture and not just the words
/// (owner, 9 Oct 2026).
///
/// The server marks such a push `aps.mutable-content = 1` and adds a top-level `image` key: an
/// absolute https URL that needs no cookie. That matters, because this process has no session —
/// it shares nothing with the app (no App Group, no Keychain), and does not need to.
///
/// A push without `image` goes out exactly as it came in. The content is a mutable COPY of the
/// original, so `userInfo` (the post id the tap deep-links to) and the category are untouched
/// either way; this only ever adds an attachment.
final class NotificationService: UNNotificationServiceExtension {
    /// Mirrors what is sensible for the extension's ~24 MB memory ceiling and a push that has to
    /// appear promptly. A bigger picture is simply left off; the notification still arrives.
    private static let maxBytes: Int64 = 10 * 1024 * 1024
    private static let timeout: TimeInterval = 20

    private let lock = NSLock()
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?
    private var download: URLSessionDownloadTask?

    override func didReceive(_ request: UNNotificationRequest,
                             withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
        guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
            contentHandler(request.content)
            return
        }
        lock.lock()
        self.contentHandler = contentHandler
        bestAttempt = content
        lock.unlock()

        guard let raw = request.content.userInfo["image"] as? String,
              let url = URL(string: raw), url.scheme?.lowercased() == "https" else {
            deliver()
            return
        }

        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = Self.timeout
        config.timeoutIntervalForResource = Self.timeout
        config.httpShouldSetCookies = false
        let session = URLSession(configuration: config)
        let task = session.downloadTask(with: url) { [weak self] location, response, error in
            guard let self else { return }
            // The downloaded file is deleted as soon as this closure returns, so it is moved now.
            if error == nil, let location, let attachment = Self.attachment(from: location, response: response) {
                self.lock.lock()
                self.bestAttempt?.attachments = [attachment]
                self.lock.unlock()
            }
            self.deliver()
        }
        lock.lock()
        download = task
        lock.unlock()
        task.resume()
        session.finishTasksAndInvalidate()
    }

    /// iOS is about to kill the extension (~30 s). Show the notification as it is — text without
    /// the picture beats no notification, which is what not calling the handler would mean.
    override func serviceExtensionTimeWillExpire() {
        lock.lock()
        let task = download
        lock.unlock()
        task?.cancel()
        deliver()
    }

    /// Hands the content over exactly once: the download finishing and the timeout can race, and
    /// a cancelled download still calls its completion handler.
    private func deliver() {
        lock.lock()
        let handler = contentHandler
        let content = bestAttempt
        contentHandler = nil
        lock.unlock()
        if let handler, let content { handler(content) }
    }

    /// A temp file with the extension the MIME type implies (the attachment API decides what the
    /// file is partly from its extension), or nil for anything that is not a usable image.
    private static func attachment(from location: URL, response: URLResponse?) -> UNNotificationAttachment? {
        if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) { return nil }
        guard let mime = response?.mimeType?.lowercased(), mime.hasPrefix("image/") else { return nil }
        let fm = FileManager.default
        guard let size = (try? fm.attributesOfItem(atPath: location.path))?[.size] as? NSNumber,
              size.int64Value > 0, size.int64Value <= maxBytes else { return nil }

        let type = UTType(mimeType: mime)
        let ext = type?.preferredFilenameExtension ?? Self.fallbackExtension(mime)
        let dest = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString).appendingPathExtension(ext)
        do {
            try fm.moveItem(at: location, to: dest)
        } catch {
            return nil
        }
        var options: [AnyHashable: Any] = [:]
        if let type { options[UNNotificationAttachmentOptionsTypeHintKey] = type.identifier }
        // Throws for a format the notification UI cannot draw; the push then goes out without it.
        return try? UNNotificationAttachment(identifier: "image", url: dest, options: options)
    }

    private static func fallbackExtension(_ mime: String) -> String {
        switch mime {
        case "image/png": return "png"
        case "image/gif": return "gif"
        case "image/heic", "image/heif": return "heic"
        case "image/webp": return "webp"
        default: return "jpg"
        }
    }
}
