import SwiftUI
import AVFoundation
import UIKit

/// The camera, with the permission answered first.
///
/// Presenting the system picker with camera access denied shows a black screen and nothing else —
/// no reason, no way out but Cancel — so the answer is checked before the picker is built. Never
/// asked: ask now. Refused: say why it matters here and offer Settings. Allowed: the camera.
///
/// Only where there IS a camera to authorise. Mac Catalyst has no capture camera for
/// `UIImagePickerController`, and the sandbox has no camera entitlement, so asking there produces a
/// refusal and a card pointing at a switch that would not help. On a Mac this goes straight to the
/// picker, which opens the photo library instead — the behaviour the Mac build has always had.
struct CameraPicker: View {
    /// Attendance wants the selfie lens; chat wants the one people point at things.
    var cameraDevice: UIImagePickerController.CameraDevice = .front
    var onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var status: AVAuthorizationStatus = UIImagePickerController.isSourceTypeAvailable(.camera)
        ? AVCaptureDevice.authorizationStatus(for: .video)
        : .authorized

    var body: some View {
        switch status {
        case .denied, .restricted:
            ZStack {
                Color.black.ignoresSafeArea()
                PermissionDeniedCard(kind: .camera) { dismiss() }
            }
        case .notDetermined:
            Color.black.ignoresSafeArea()
                .task {
                    let ok = await AVCaptureDevice.requestAccess(for: .video)
                    status = ok ? .authorized : .denied
                }
        default:
            CameraPickerController(cameraDevice: cameraDevice, onCapture: onCapture).ignoresSafeArea()
        }
    }
}

private struct CameraPickerController: UIViewControllerRepresentable {
    var cameraDevice: UIImagePickerController.CameraDevice
    var onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        if UIImagePickerController.isSourceTypeAvailable(.camera) {
            picker.sourceType = .camera
            picker.cameraDevice = cameraDevice
        } else {
            // A Mac without a camera, or the simulator: the library is the nearest thing.
            picker.sourceType = .photoLibrary
        }
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(self) }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let parent: CameraPickerController
        init(_ parent: CameraPickerController) { self.parent = parent }

        func imagePickerController(_ picker: UIImagePickerController,
                                   didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) {
            if let image = info[.originalImage] as? UIImage,
               let data = downscaled(image).jpegData(compressionQuality: 0.7) {
                parent.onCapture(data)
            }
            parent.dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            parent.dismiss()
        }

        /// Keep photos well under the 10MB server cap.
        private func downscaled(_ image: UIImage, maxDimension: CGFloat = 1280) -> UIImage {
            let maxSide = max(image.size.width, image.size.height)
            guard maxSide > maxDimension else { return image }
            let scale = maxDimension / maxSide
            let newSize = CGSize(width: image.size.width * scale, height: image.size.height * scale)
            let renderer = UIGraphicsImageRenderer(size: newSize)
            return renderer.image { _ in image.draw(in: CGRect(origin: .zero, size: newSize)) }
        }
    }
}
