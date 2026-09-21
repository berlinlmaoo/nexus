import Foundation
import UIKit
import Vision

/// Is there actually a person in the attendance selfie?
///
/// Attendance is proven by a photo, and a photo of the office wall proves nothing. This runs
/// Apple's on-device face detector on the selfie before it is sent — no network, no upload, a few
/// hundred milliseconds — and refuses to submit when no face of a usable size is in frame. It is a
/// guard against the lazy case (the ceiling, the desk, a thumb), not a biometric: it does not check
/// WHOSE face it is. The server keeps its own checks on the location's physics.
enum FaceGuard {
    enum Verdict: Equatable { case ok(faces: Int), noFace, unreadable }

    /// Smallest face that counts, as a fraction of the shorter image side. A colleague far in the
    /// background is not a selfie.
    private static let minFaceFraction: CGFloat = 0.12

    static func check(_ data: Data) async -> Verdict {
        await Task.detached(priority: .userInitiated) { () -> Verdict in
            guard let image = UIImage(data: data), let cg = image.cgImage else { return .unreadable }
            let request = VNDetectFaceRectanglesRequest()
            let handler = VNImageRequestHandler(cgImage: cg, orientation: cgOrientation(image.imageOrientation), options: [:])
            do { try handler.perform([request]) } catch { return .unreadable }
            let faces = (request.results ?? []).filter { min($0.boundingBox.width, $0.boundingBox.height) >= minFaceFraction }
            return faces.isEmpty ? .noFace : .ok(faces: faces.count)
        }.value
    }

    private static func cgOrientation(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch o {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
