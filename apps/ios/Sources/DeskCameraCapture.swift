import SwiftUI
import AVFoundation
import CoreImage
import UIKit

/// Taking a photo where `UIImagePickerController` has no camera — the Mac.
///
/// Mac Catalyst does not support the picker's camera source, so "Take a photo" used to open the
/// photo library on a laptop with a webcam pointed straight at the person. This is the same capture
/// stack the attendance face check already uses — session, preview layer, video frames, one frame
/// turned into a JPEG — minus the liveness checks, because this is a receipt or a chat photo, not
/// an attendance record. It works on iOS too; only the Mac routes to it.
struct DeskCameraCapture: View {
    var cameraDevice: UIImagePickerController.CameraDevice = .rear
    var onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @StateObject private var camera = DeskCamera()
    @State private var flash = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if camera.denied {
                PermissionDeniedCard(kind: .camera) { dismiss() }
            } else {
                DeskCameraFeed(session: camera.session).ignoresSafeArea()
                if flash { Color.white.opacity(0.85).ignoresSafeArea() }
                VStack {
                    HStack {
                        Button { dismiss() } label: {
                            Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                                .frame(width: 36, height: 36).background(Color.white.opacity(0.18), in: Circle())
                        }
                        .buttonStyle(.plain).padding(16)
                        Spacer()
                    }
                    Spacer()
                    Button { shoot() } label: {
                        ZStack {
                            Circle().strokeBorder(Color.white.opacity(0.9), lineWidth: 4).frame(width: 74, height: 74)
                            Circle().fill(Color.white).frame(width: 60, height: 60)
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(!camera.ready)
                    .opacity(camera.ready ? 1 : 0.4)
                    .padding(.bottom, 28)
                    .accessibilityLabel(T("Take a photo"))
                }
            }
        }
        .preferredColorScheme(.dark)
        .onAppear { camera.start(front: cameraDevice == .front) }
        .onDisappear { camera.stop() }
    }

    private func shoot() {
        guard let data = camera.still() else { return }
        withAnimation(.easeOut(duration: 0.1)) { flash = true }
        Task {
            try? await Task.sleep(for: .milliseconds(120))
            onCapture(data)
            dismiss()
        }
    }
}

private struct DeskCameraFeed: UIViewRepresentable {
    let session: AVCaptureSession
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.previewLayer.session = session
        v.previewLayer.videoGravity = .resizeAspectFill
        return v
    }
    func updateUIView(_ uiView: PreviewView, context: Context) {}
    final class PreviewView: UIView {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        var previewLayer: AVCaptureVideoPreviewLayer { layer as! AVCaptureVideoPreviewLayer }
    }
}

/// Keeps the session running and the most recent frame, so the shutter is instant.
final class DeskCamera: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    @Published private(set) var denied = false
    @Published private(set) var ready = false

    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "id.znetworks.nexus.deskcamera", qos: .userInitiated)
    private let ciContext = CIContext()
    private var latest: CVPixelBuffer?
    private var mirrored = true

    func start(front: Bool) {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configure(front: front)
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                DispatchQueue.main.async { if ok { self.configure(front: front) } else { self.denied = true } }
            }
        default: denied = true
        }
    }

    func stop() { queue.async { if self.session.isRunning { self.session.stopRunning() } } }

    private func configure(front: Bool) {
        let position: AVCaptureDevice.Position = front ? .front : .back
        queue.async {
            if !self.session.inputs.isEmpty {
                if !self.session.isRunning { self.session.startRunning() }
                DispatchQueue.main.async { self.ready = true }
                return
            }
            self.session.beginConfiguration()
            self.session.sessionPreset = .hd1280x720
            // A Mac has one camera and it reports no useful position, so the position-specific
            // lookup is a preference, not a requirement.
            let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: position)
                ?? AVCaptureDevice.default(for: .video)
            guard let device, let input = try? AVCaptureDeviceInput(device: device), self.session.canAddInput(input) else {
                self.session.commitConfiguration()
                DispatchQueue.main.async { self.denied = true }
                return
            }
            self.mirrored = device.position != .back
            self.session.addInput(input)
            let output = AVCaptureVideoDataOutput()
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: self.queue)
            if self.session.canAddOutput(output) { self.session.addOutput(output) }
            self.session.commitConfiguration()
            self.session.startRunning()
            DispatchQueue.main.async { self.ready = true }
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        latest = CMSampleBufferGetImageBuffer(sampleBuffer)
    }

    /// The last frame as a JPEG, under the 10MB server cap by a wide margin.
    func still() -> Data? {
        guard let pixel = latest else { return nil }
        var image = CIImage(cvPixelBuffer: pixel)
        // A self-facing camera is a mirror on screen; the photo should look like what was on screen.
        if mirrored { image = image.oriented(.upMirrored) }
        let maxSide = max(image.extent.width, image.extent.height)
        if maxSide > 1280 { image = image.transformed(by: CGAffineTransform(scaleX: 1280 / maxSide, y: 1280 / maxSide)) }
        guard let cg = ciContext.createCGImage(image, from: image.extent) else { return nil }
        return UIImage(cgImage: cg).jpegData(compressionQuality: 0.7)
    }
}
