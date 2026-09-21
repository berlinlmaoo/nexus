import SwiftUI
import AVFoundation
import Vision
import CoreImage
import UIKit

// MARK: - Liveness selfie

/// The attendance selfie, taken by the app itself with a liveness check in front of it.
///
/// A still photo proves a camera was pointed at something. This proves a person was in front of it:
/// look straight, turn to one side, turn to the other, blink — the four moves fintech apps ask for
/// before they trust a face. Every check runs on the phone with Apple's Vision framework; no frame
/// leaves the device except the one selfie captured at the end, exactly as before. It does not know
/// WHOSE face this is: that would need enrolment and a face template kept on the server, which is a
/// different decision with its own privacy weight.
struct LivenessCaptureView: View {
    var onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var engine = LivenessEngine()
    @State private var pulse = false
    @State private var flash = false
    @State private var finishing = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            CameraFeed(session: engine.session).ignoresSafeArea()
            GeometryReader { geo in
                let oval = Self.ovalRect(in: geo.size)
                ZStack {
                    // Dim everything but the oval, so the face has one obvious place to be.
                    Rectangle().fill(Color.black.opacity(0.68))
                        .overlay(Ellipse().frame(width: oval.width, height: oval.height).position(x: oval.midX, y: oval.midY).blendMode(.destinationOut))
                        .compositingGroup()
                    ring(oval)
                    gauge.position(x: oval.midX, y: oval.maxY + 44)
                    if flash { Color.white.opacity(0.85) }
                }
            }
            .ignoresSafeArea()
            VStack(spacing: 0) {
                header
                Spacer()
                chips.padding(.bottom, 28)
            }
            if engine.cameraDenied { deniedCard }
        }
        .preferredColorScheme(.dark)
        .onAppear { engine.start(); pulse = true }
        .onDisappear { engine.stop() }
        .onChange(of: engine.captured) { _, data in
            guard let data, !finishing else { return }
            finishing = true
            withAnimation(.easeOut(duration: 0.12)) { flash = true }
            Task {
                try? await Task.sleep(for: .milliseconds(140))
                withAnimation(.easeIn(duration: 0.25)) { flash = false }
                try? await Task.sleep(for: .milliseconds(650))
                onCapture(data)
                dismiss()
            }
        }
    }

    // MARK: pieces

    private static func ovalRect(in size: CGSize) -> CGRect {
        let w = min(size.width * 0.72, 300), h = w * 1.32
        return CGRect(x: (size.width - w) / 2, y: size.height * 0.44 - h / 2, width: w, height: h)
    }

    private var done: Bool { engine.captured != nil }

    /// Four arcs around the oval, one per move: grey to do, violet in progress, green done.
    private func ring(_ oval: CGRect) -> some View {
        ZStack {
            ForEach(0..<4, id: \.self) { i in
                let state = segmentState(i)
                Ellipse()
                    .trim(from: CGFloat(i) / 4 + 0.012, to: CGFloat(i + 1) / 4 - 0.012)
                    .stroke(color(for: state), style: StrokeStyle(lineWidth: state == .current ? 7 : 5, lineCap: .round))
                    .opacity(state == .current && !reduceMotion ? (pulse ? 1 : 0.45) : 1)
                    .animation(state == .current && !reduceMotion ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .default, value: pulse)
            }
            .rotationEffect(.degrees(-90))
            if done {
                Ellipse().stroke(NX.success, lineWidth: 7)
                    .transition(.scale(scale: 0.92).combined(with: .opacity))
                Image(systemName: "checkmark").font(.system(size: 64, weight: .bold)).foregroundStyle(.white)
                    .padding(28).background(NX.success, in: Circle())
                    .transition(.scale(scale: 0.4).combined(with: .opacity))
            } else if engine.presence != .ok && engine.step != .capture {
                Ellipse().stroke(Color.orange.opacity(0.9), style: StrokeStyle(lineWidth: 3, dash: [8, 10]))
                    .padding(-12)
                    .transition(.opacity)
            }
        }
        .frame(width: oval.width, height: oval.height)
        .padding(-10)
        .position(x: oval.midX, y: oval.midY)
        .animation(.spring(response: 0.45, dampingFraction: 0.7), value: done)
        .animation(.easeInOut(duration: 0.25), value: engine.presence)
    }

    private enum Seg { case todo, current, done }
    private func segmentState(_ i: Int) -> Seg {
        let idx = engine.step.rawValue
        if done || idx > i { return .done }
        return idx == i ? .current : .todo
    }
    private func color(for s: Seg) -> Color {
        switch s { case .todo: return .white.opacity(0.28); case .current: return NX.violet; case .done: return NX.success }
    }

    /// Live feedback that needs no words: a dot that follows the head, two zones to reach it into.
    /// For the blink step it becomes an eye that closes with the user's own eyes.
    private var gauge: some View {
        Group {
            switch engine.step {
            case .sideA, .sideB:
                ZStack {
                    Capsule().fill(Color.white.opacity(0.18)).frame(width: 200, height: 10)
                    HStack {
                        zone(reached: engine.firstSide == -1, wanted: engine.step == .sideB && engine.firstSide == 1)
                        Spacer()
                        zone(reached: engine.firstSide == 1, wanted: engine.step == .sideB && engine.firstSide == -1)
                    }
                    .frame(width: 200)
                    Circle().fill(Color.white).frame(width: 18, height: 18)
                        .shadow(color: .black.opacity(0.3), radius: 3, y: 1)
                        .offset(x: max(-88, min(88, CGFloat(engine.yawDegrees) * 3.2)))
                        .animation(.interactiveSpring(response: 0.25, dampingFraction: 0.8), value: engine.yawDegrees)
                }
            case .blink:
                Image(systemName: engine.eyesClosed ? "eye.slash.fill" : "eye.fill")
                    .font(.system(size: 30, weight: .semibold)).foregroundStyle(.white)
                    .contentTransition(.symbolEffect(.replace))
                    .opacity(reduceMotion ? 1 : (pulse ? 1 : 0.35))
                    .animation(reduceMotion ? .default : .easeInOut(duration: 0.7).repeatForever(autoreverses: true), value: pulse)
            case .capture:
                Image(systemName: "camera.fill").font(.system(size: 26, weight: .semibold)).foregroundStyle(.white)
            case .center:
                Image(systemName: "face.dashed").font(.system(size: 30, weight: .semibold)).foregroundStyle(.white.opacity(0.9))
            }
        }
        .frame(height: 44)
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.2), value: engine.step)
    }

    private func zone(reached: Bool, wanted: Bool) -> some View {
        Capsule().fill(reached ? NX.success : (wanted ? NX.violet : Color.white.opacity(0.35)))
            .frame(width: 34, height: 18)
            .opacity(wanted && !reduceMotion ? (pulse ? 1 : 0.5) : 1)
            .animation(wanted && !reduceMotion ? .easeInOut(duration: 0.7).repeatForever(autoreverses: true) : .default, value: pulse)
    }

    private var header: some View {
        VStack(spacing: 10) {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 36, height: 36).background(Color.white.opacity(0.18), in: Circle())
                }
                .buttonStyle(.plain).accessibilityLabel(T("Cancel"))
                Spacer()
                Text(T("Face check")).font(NXFont.text(13, .semibold)).foregroundStyle(.white.opacity(0.7))
                Spacer()
                Color.clear.frame(width: 36, height: 36)
            }
            .padding(.horizontal, 16)
            VStack(spacing: 6) {
                Text(title).font(NXFont.display(24, .bold)).foregroundStyle(.white)
                    .multilineTextAlignment(.center).contentTransition(.numericText())
                Text(subtitle).font(NXFont.text(14)).foregroundStyle(.white.opacity(0.78))
                    .multilineTextAlignment(.center).frame(minHeight: 36, alignment: .top)
            }
            .padding(.horizontal, 28).padding(.top, 6)
            .animation(.easeInOut(duration: 0.2), value: title)
            .animation(.easeInOut(duration: 0.2), value: subtitle)
        }
        .padding(.top, 8)
    }

    private var title: String {
        if done { return T("Verified") }
        switch engine.step {
        case .center: return T("Look straight at the camera")
        case .sideA: return T("Turn your head to one side")
        case .sideB: return T("Now turn to the other side")
        case .blink: return T("Blink")
        case .capture: return T("Hold still")
        }
    }
    private var subtitle: String {
        if done { return T("Taking your selfie…") }
        if let n = engine.notice { return n }
        switch engine.presence {
        case .none: return T("No face yet. Hold the phone at eye level, in good light.")
        case .small: return T("Come a little closer.")
        case .offCentre: return T("Move your face into the oval.")
        case .ok: break
        }
        if engine.stalled {
            switch engine.step {
            case .sideA, .sideB: return T("Turn a bit further, until the dot reaches the end.")
            case .blink: return T("Blink once, slowly. Glasses can make this harder.")
            default: return T("Keep your face inside the oval, in good light.")
            }
        }
        switch engine.step {
        case .center: return T("Keep your face inside the oval.")
        case .sideA: return T("Slowly, until the dot reaches the end.")
        case .sideB: return T("Same again, the other way.")
        case .blink: return T("Look straight and blink once.")
        case .capture: return T("Look straight, eyes open.")
        }
    }

    private var chips: some View {
        HStack(spacing: 8) {
            ForEach(Array(zip(0..<4, [T("Straight"), T("Side"), T("Other side"), T("Blink")])), id: \.0) { i, label in
                let s = segmentState(i)
                HStack(spacing: 5) {
                    if s == .done { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).transition(.scale.combined(with: .opacity)) }
                    Text(label).font(NXFont.text(11, .semibold))
                }
                .foregroundStyle(s == .todo ? Color.white.opacity(0.5) : .white)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background((s == .done ? NX.success : s == .current ? NX.violet : Color.white.opacity(0.14)), in: Capsule())
                .animation(.spring(response: 0.4, dampingFraction: 0.7), value: engine.step)
            }
        }
    }

    private var deniedCard: some View {
        VStack(spacing: 12) {
            Image(systemName: "camera.fill").font(.system(size: 28)).foregroundStyle(.white)
            Text(T("NEXUS needs the camera for the attendance selfie.")).font(NXFont.text(14, .semibold)).foregroundStyle(.white).multilineTextAlignment(.center)
            Button(T("Open Settings")) { if let u = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(u) } }
                .buttonStyle(NexusPrimaryButton())
        }
        .padding(24).background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(32)
    }
}

// MARK: - Camera preview

private struct CameraFeed: UIViewRepresentable {
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

// MARK: - Engine

/// Runs the camera and the face checks on its own queue; publishes only what the screen draws.
///
/// Turning direction is deliberately not prescribed. Vision's yaw sign depends on the buffer
/// orientation and mirroring, and getting it wrong would tell people "left" while waiting for
/// right. So the first turn may go either way, and the second must go the opposite way — which is
/// exactly what liveness needs: two distinct poses a photo cannot produce.
final class LivenessEngine: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate {
    enum Step: Int, Comparable {
        case center, sideA, sideB, blink, capture
        static func < (a: Step, b: Step) -> Bool { a.rawValue < b.rawValue }
    }
    enum Presence { case none, small, offCentre, ok }

    @Published private(set) var step: Step = .center
    @Published private(set) var presence: Presence = .none
    @Published private(set) var yawDegrees: Double = 0
    @Published private(set) var eyesClosed = false
    @Published private(set) var firstSide: Double = 0
    @Published private(set) var stalled = false
    @Published private(set) var notice: String?
    @Published private(set) var cameraDenied = false
    @Published private(set) var captured: Data?

    let session = AVCaptureSession()
    private let queue = DispatchQueue(label: "id.znetworks.nexus.liveness", qos: .userInitiated)
    private let ciContext = CIContext()

    // Queue-confined state.
    private var current: Step = .center
    private var holdFrames = 0
    private var side: Double = 0
    private var earBaseline: Double?
    private var blinkSeen = false
    private var lostFrames = 0
    private var stepStart = Date()
    private var cooldownUntil = Date.distantPast
    private var finished = false
    private var lastPublish = Date.distantPast

    private static let frontal = 0.20   // radians; Vision's yaw
    private static let turned = 0.38

    func start() {
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized: configure()
        case .notDetermined:
            AVCaptureDevice.requestAccess(for: .video) { ok in
                DispatchQueue.main.async { if ok { self.configure() } else { self.cameraDenied = true } }
            }
        default: cameraDenied = true
        }
    }

    func stop() { queue.async { if self.session.isRunning { self.session.stopRunning() } } }

    private func configure() {
        queue.async {
            if !self.session.inputs.isEmpty { if !self.session.isRunning { self.session.startRunning() }; return }
            self.session.beginConfiguration()
            self.session.sessionPreset = .hd1280x720
            guard let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .front),
                  let input = try? AVCaptureDeviceInput(device: device), self.session.canAddInput(input) else {
                self.session.commitConfiguration()
                DispatchQueue.main.async { self.cameraDenied = true }
                return
            }
            self.session.addInput(input)
            let output = AVCaptureVideoDataOutput()
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: self.queue)
            if self.session.canAddOutput(output) { self.session.addOutput(output) }
            if let c = output.connection(with: .video) {
                // Upright, and mirrored like the preview, so the buffer is what the person sees.
                if c.isVideoRotationAngleSupported(90) { c.videoRotationAngle = 90 }
                if c.isVideoMirroringSupported { c.automaticallyAdjustsVideoMirroring = false; c.isVideoMirrored = true }
            }
            self.session.commitConfiguration()
            self.session.startRunning()
        }
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !finished, let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        let request = VNDetectFaceLandmarksRequest()
        let handler = VNImageRequestHandler(cvPixelBuffer: pixel, orientation: .up, options: [:])
        try? handler.perform([request])
        let face = (request.results ?? []).max { $0.boundingBox.width < $1.boundingBox.width }
        evaluate(face, pixel: pixel)
    }

    private func evaluate(_ face: VNFaceObservation?, pixel: CVPixelBuffer) {
        let now = Date()
        guard let face else {
            lostFrames += 1
            // Gone for ~1.5 s after the first move: whoever comes back starts over, so a photo
            // cannot be swapped in between moves.
            if lostFrames > 45 && current > .center { reset(T("Face lost. Let's start again.")) }
            publish(presence: .none, yaw: 0, closed: false)
            holdFrames = 0
            return
        }
        lostFrames = 0
        let box = face.boundingBox
        let presence: Presence
        if box.width < 0.30 { presence = .small }
        else if abs(box.midX - 0.5) > 0.16 || abs(box.midY - 0.5) > 0.18 { presence = .offCentre }
        else { presence = .ok }
        let yaw = face.yaw?.doubleValue ?? 0
        let ear = eyeAspectRatio(face)
        var closed = false
        if let ear, let base = earBaseline { closed = ear < base * 0.62 }
        publish(presence: presence, yaw: yaw, closed: closed)
        guard presence == .ok, now >= cooldownUntil else { holdFrames = 0; return }
        if !stalled && now.timeIntervalSince(stepStart) > 18 { DispatchQueue.main.async { self.stalled = true } }

        switch current {
        case .center:
            guard abs(yaw) < Self.frontal else { holdFrames = 0; return }
            // Open-eye baseline for the blink test, learned from this face in this light.
            if let ear { earBaseline = earBaseline.map { $0 * 0.8 + ear * 0.2 } ?? ear }
            if held(6) { advance() }
        case .sideA:
            guard abs(yaw) >= Self.turned else { holdFrames = 0; return }
            side = yaw > 0 ? 1 : -1
            if held(4) { DispatchQueue.main.async { self.firstSide = self.side }; advance() }
        case .sideB:
            guard abs(yaw) >= Self.turned, (yaw > 0 ? 1.0 : -1.0) == -side else { holdFrames = 0; return }
            if held(4) { advance() }
        case .blink:
            guard abs(yaw) < Self.frontal + 0.1, let ear, let base = earBaseline else { return }
            if !blinkSeen { if ear < base * 0.62 { blinkSeen = true } }
            else if ear > base * 0.85 { advance() }
        case .capture:
            guard abs(yaw) < Self.frontal, !closed else { holdFrames = 0; return }
            if held(5) { capture(pixel) }
        }
    }

    private func held(_ frames: Int) -> Bool { holdFrames += 1; return holdFrames >= frames }

    private func advance() {
        holdFrames = 0; blinkSeen = false; stepStart = Date()
        cooldownUntil = Date().addingTimeInterval(0.7)
        current = Step(rawValue: current.rawValue + 1) ?? .capture
        let next = current
        DispatchQueue.main.async {
            Haptics.success()
            self.stalled = false; self.notice = nil
            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { self.step = next }
        }
    }

    private func reset(_ why: String) {
        current = .center; holdFrames = 0; side = 0; earBaseline = nil; blinkSeen = false
        stepStart = Date(); cooldownUntil = Date().addingTimeInterval(0.5)
        DispatchQueue.main.async {
            Haptics.warning()
            self.firstSide = 0; self.stalled = false; self.notice = why
            withAnimation { self.step = .center }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { if self.notice == why { self.notice = nil } }
        }
    }

    private func publish(presence: Presence, yaw: Double, closed: Bool) {
        let now = Date()
        guard now.timeIntervalSince(lastPublish) > 0.04 else { return }
        lastPublish = now
        let deg = yaw * 180 / .pi
        DispatchQueue.main.async {
            if self.presence != presence { self.presence = presence }
            if abs(self.yawDegrees - deg) > 0.5 { self.yawDegrees = deg }
            if self.eyesClosed != closed { self.eyesClosed = closed }
        }
    }

    /// Height over width of the eye outline, averaged over both eyes; size-invariant, so only the
    /// ratio to this person's own open-eye baseline matters.
    private func eyeAspectRatio(_ face: VNFaceObservation) -> Double? {
        guard let l = face.landmarks?.leftEye, let r = face.landmarks?.rightEye else { return nil }
        func ratio(_ region: VNFaceLandmarkRegion2D) -> Double? {
            let pts = region.normalizedPoints
            guard pts.count >= 4 else { return nil }
            let xs = pts.map(\.x), ys = pts.map(\.y)
            let w = Double(xs.max()! - xs.min()!), h = Double(ys.max()! - ys.min()!)
            return w > 0 ? h / w : nil
        }
        guard let a = ratio(l), let b = ratio(r) else { return nil }
        return (a + b) / 2
    }

    private func capture(_ pixel: CVPixelBuffer) {
        finished = true
        // The buffer is mirrored like a mirror; the record should show the person as others see them.
        var image = CIImage(cvPixelBuffer: pixel).oriented(.upMirrored)
        let maxSide = max(image.extent.width, image.extent.height)
        if maxSide > 1280 { image = image.transformed(by: CGAffineTransform(scaleX: 1280 / maxSide, y: 1280 / maxSide)) }
        guard let cg = ciContext.createCGImage(image, from: image.extent),
              let data = UIImage(cgImage: cg).jpegData(compressionQuality: 0.7) else { finished = false; return }
        DispatchQueue.main.async {
            Haptics.success()
            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { self.captured = data }
        }
    }
}
