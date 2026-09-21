import SwiftUI
import AVFoundation
import Vision
import CoreImage
import UIKit

// MARK: - Liveness selfie

/// The attendance selfie, taken by the app itself with a liveness check in front of it.
///
/// A still photo proves a camera was pointed at something. This proves a person was in front of it:
/// look straight, turn right, turn left, blink — the four moves fintech apps ask for before they
/// trust a face. Every check runs on the phone with Apple's Vision framework; no frame leaves the
/// device except the one selfie captured at the end, exactly as before. It does not know WHOSE face
/// this is: that would need enrolment and a face template kept on the server, which is a different
/// decision with its own privacy weight.
///
/// The bright window follows the face: the camera's own face metadata, converted to screen points
/// by the preview layer, so no hand-made rotation or mirror arithmetic is involved. Motion is spent
/// on feedback — a sweep runs round the ring while a step is in progress, a bar fills as the head
/// turns, each finished step fills with a spring — and the end is the Face ID moment: ring closes
/// green, the check draws itself, one haptic. In the dark the rest of the screen turns white and the
/// display goes to full brightness: the phone becomes its own ring light. It also switches on by hand.
///
/// "Right" and "left" are instructions, not requirements. The sign of Vision's yaw depends on the
/// buffer orientation and mirroring and cannot be trusted blind, so the first turn is accepted
/// either way and the second must be the opposite — which is what liveness needs, two poses a
/// photo cannot produce. Someone who follows the words passes; someone who turns the other way
/// passes too, and the bar fills the same for both.
struct LivenessCaptureView: View {
    var onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var engine = LivenessEngine()
    @State private var pulse = false
    @State private var sweep = false
    @State private var demo = false
    @State private var flash = false
    @State private var finishing = false
    @State private var checkDrawn: CGFloat = 0
    @State private var successScale: CGFloat = 0.6
    @State private var manualLight = false
    @State private var savedBrightness: CGFloat?

    private var lightOn: Bool { manualLight || engine.dark }
    private var ink: Color { lightOn ? .black : .white }
    private var inkSoft: Color { lightOn ? .black.opacity(0.7) : .white.opacity(0.78) }
    private var done: Bool { engine.captured != nil }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            CameraFeed(engine: engine).ignoresSafeArea()
            GeometryReader { geo in
                let home = Self.ovalRect(in: geo.size)
                let oval = trackedOval(home: home)
                ZStack {
                    // Everything but the face window is dimmed — or lit white when it's dark.
                    Rectangle().fill(lightOn ? Color.white.opacity(0.94) : Color.black.opacity(0.68))
                        .overlay(
                            Ellipse().frame(width: oval.width, height: oval.height)
                                .position(x: oval.midX, y: oval.midY)
                                .blendMode(.destinationOut)
                        )
                        .compositingGroup()
                    ring(oval)
                    if done { successMark.position(x: oval.midX, y: oval.midY) }
                    gauge.position(x: home.midX, y: home.maxY + 52)
                    if flash { Color.white.opacity(0.85) }
                }
                .animation(reduceMotion ? nil : .interactiveSpring(response: 0.26, dampingFraction: 0.86), value: engine.faceScreenRect)
                .animation(.easeInOut(duration: 0.3), value: lightOn)
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
        .onAppear { engine.start(); pulse = true; sweep = true; demo = true }
        .onDisappear { engine.stop(); restoreBrightness() }
        .onChange(of: lightOn) { _, on in on ? boostBrightness() : restoreBrightness() }
        .onChange(of: engine.captured) { _, data in
            guard let data, !finishing else { return }
            finishing = true
            // The Face ID beat: ring closes, check draws itself, a soft flash, then hand over.
            withAnimation(.spring(response: 0.5, dampingFraction: 0.72)) { successScale = 1 }
            withAnimation(.easeOut(duration: 0.38).delay(0.12)) { checkDrawn = 1 }
            Task {
                try? await Task.sleep(for: .milliseconds(180))
                withAnimation(.easeOut(duration: 0.1)) { flash = true }
                try? await Task.sleep(for: .milliseconds(120))
                withAnimation(.easeIn(duration: 0.3)) { flash = false }
                try? await Task.sleep(for: .milliseconds(700))
                onCapture(data)
                dismiss()
            }
        }
    }

    // MARK: geometry

    private static func ovalRect(in size: CGSize) -> CGRect {
        let w = min(size.width * 0.72, 300), h = w * 1.32
        return CGRect(x: (size.width - w) / 2, y: size.height * 0.44 - h / 2, width: w, height: h)
    }

    /// The window hugs the detected face (a little room for hair and chin); without a face it rests
    /// at its home position so people know where to put themselves. The rect is already in screen
    /// points — the camera's face metadata converted by the preview layer.
    private func trackedOval(home: CGRect) -> CGRect {
        guard let f = engine.faceScreenRect, f.width > 10, f.height > 10, f.width.isFinite, f.height.isFinite else { return home }
        let w = min(max(f.width * 1.3, 150), home.width * 1.15)
        let h = min(max(f.height * 1.5, w * 1.2), home.height * 1.2)
        return CGRect(x: f.midX - w / 2, y: f.midY - f.height * 0.08 - h / 2, width: w, height: h)
    }

    // MARK: ring

    /// Four arcs around the window, one per move: grey to do, violet in progress, green done.
    /// Starts at the top and goes clockwise; the trim offsets do that without rotating the shape
    /// (a rotated ellipse swaps its width and height — that was the squashed ring).
    private func ring(_ oval: CGRect) -> some View {
        ZStack {
            // A faint sweep running round the ring while a step is in progress — the "scanning"
            // feel — dimmer while it waits for a face.
            if !done && !reduceMotion {
                Ellipse()
                    .stroke(AngularGradient(colors: [.clear, .clear, NX.violet.opacity(0.9), .clear], center: .center),
                            style: StrokeStyle(lineWidth: 9, lineCap: .round))
                    .rotationEffect(.degrees(sweep ? 360 : 0))
                    .animation(.linear(duration: 2.4).repeatForever(autoreverses: false), value: sweep)
                    .opacity(engine.presence == .ok ? 0.9 : 0.35)
            }
            ForEach(0..<4, id: \.self) { i in
                let state = segmentState(i)
                let from = CGFloat((i + 3) % 4) / 4
                Ellipse()
                    .trim(from: from + 0.012, to: from + 0.25 - 0.012)
                    .stroke(color(for: state), style: StrokeStyle(lineWidth: state == .current ? 7 : 5, lineCap: .round))
                    .opacity(done ? 0 : (state == .current && !reduceMotion ? (pulse ? 1 : 0.55) : 1))
                    .animation(state == .current && !reduceMotion ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .spring(response: 0.45, dampingFraction: 0.7), value: pulse)
            }
            if done {
                // The four arcs become one closed green ring.
                Ellipse().trim(from: 0, to: checkDrawn > 0 ? 1 : 0.001)
                    .stroke(NX.success, style: StrokeStyle(lineWidth: 7, lineCap: .round))
                    .animation(.easeOut(duration: 0.45), value: checkDrawn)
            } else if engine.presence != .ok && engine.step != .capture {
                Ellipse().stroke(Color.orange.opacity(0.9), style: StrokeStyle(lineWidth: 3, dash: [8, 10]))
                    .padding(-12)
                    .transition(.opacity)
            }
        }
        .frame(width: oval.width + 20, height: oval.height + 20)
        .scaleEffect(engine.presence == .ok || done || reduceMotion ? 1 : (pulse ? 1.015 : 0.985))
        .animation(engine.presence == .ok || done || reduceMotion ? .spring(response: 0.4, dampingFraction: 0.75) : .easeInOut(duration: 1.6).repeatForever(autoreverses: true), value: pulse)
        .position(x: oval.midX, y: oval.midY)
        .animation(.spring(response: 0.45, dampingFraction: 0.7), value: done)
        .animation(.easeInOut(duration: 0.25), value: engine.presence)
    }

    /// The check that draws itself inside a green disc — the Face ID "done" moment.
    private var successMark: some View {
        ZStack {
            Circle().fill(NX.success).frame(width: 120, height: 120)
                .shadow(color: NX.success.opacity(0.45), radius: 24)
            CheckmarkShape().trim(from: 0, to: checkDrawn)
                .stroke(Color.white, style: StrokeStyle(lineWidth: 9, lineCap: .round, lineJoin: .round))
                .frame(width: 58, height: 58)
        }
        .scaleEffect(successScale)
        .opacity(successScale > 0.7 ? 1 : 0)
    }

    private enum Seg { case todo, current, done }
    private func segmentState(_ i: Int) -> Seg {
        let idx = engine.step.rawValue
        if done || idx > i { return .done }
        return idx == i ? .current : .todo
    }
    private func color(for s: Seg) -> Color {
        switch s {
        case .todo: return lightOn ? .black.opacity(0.18) : .white.opacity(0.28)
        case .current: return NX.violet
        case .done: return NX.success
        }
    }

    // MARK: gauge — what to do, and how far along it is

    /// Under the window: for a turn, an arrow, a head that demonstrates the move, and a bar that
    /// fills as the head turns; for the blink, an eye that blinks to show what is wanted and closes
    /// with the person's own eyes; a camera while the picture is taken.
    private var gauge: some View {
        Group {
            switch engine.step {
            case .sideA, .sideB:
                let right = engine.step == .sideA
                VStack(spacing: 10) {
                    HStack(spacing: 14) {
                        if !right { arrow("arrow.left", nudge: -1) }
                        Image(systemName: "face.smiling")
                            .font(.system(size: 34, weight: .medium)).foregroundStyle(ink)
                            .rotation3DEffect(.degrees(reduceMotion ? 0 : (demo ? (right ? 38 : -38) : 0)), axis: (x: 0, y: 1, z: 0), perspective: 0.6)
                            .animation(reduceMotion ? .default : .easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: demo)
                        if right { arrow("arrow.right", nudge: 1) }
                    }
                    ZStack(alignment: .leading) {
                        Capsule().fill(ink.opacity(0.18)).frame(width: 200, height: 10)
                        Capsule().fill(engine.turnProgress >= 1 ? NX.success : NX.violet)
                            .frame(width: max(10, 200 * engine.turnProgress), height: 10)
                            .animation(.interactiveSpring(response: 0.25, dampingFraction: 0.8), value: engine.turnProgress)
                    }
                }
            case .blink:
                VStack(spacing: 6) {
                    Image(systemName: engine.eyesClosed ? "eye.slash.fill" : (demo ? "eye.fill" : "eye.slash.fill"))
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(engine.eyesClosed ? NX.success : ink)
                        .contentTransition(.symbolEffect(.replace))
                        .animation(reduceMotion ? .default : .easeInOut(duration: 0.55).repeatForever(autoreverses: true), value: demo)
                    Text(T("close · open")).font(NXFont.text(11, .semibold)).foregroundStyle(inkSoft)
                }
            case .capture:
                Image(systemName: "camera.fill").font(.system(size: 26, weight: .semibold)).foregroundStyle(ink)
            case .center:
                Image(systemName: "face.dashed").font(.system(size: 30, weight: .semibold)).foregroundStyle(ink.opacity(0.9))
            }
        }
        .frame(height: 70)
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.2), value: engine.step)
    }

    private func arrow(_ symbol: String, nudge: CGFloat) -> some View {
        Image(systemName: symbol).font(.system(size: 30, weight: .bold)).foregroundStyle(NX.violet)
            .offset(x: reduceMotion ? 0 : (demo ? 8 * nudge : 0))
            .animation(reduceMotion ? .default : .easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: demo)
    }

    // MARK: header, chips, denied

    private var header: some View {
        VStack(spacing: 10) {
            HStack {
                Button { dismiss() } label: {
                    Image(systemName: "xmark").font(.system(size: 15, weight: .bold)).foregroundStyle(ink)
                        .frame(width: 36, height: 36).background(ink.opacity(0.14), in: Circle())
                }
                .buttonStyle(.plain).accessibilityLabel(T("Cancel"))
                Spacer()
                Text(T("Face check")).font(NXFont.text(13, .semibold)).foregroundStyle(inkSoft)
                Spacer()
                Button { manualLight.toggle(); Haptics.tap() } label: {
                    Image(systemName: lightOn ? "sun.max.fill" : "sun.max").font(.system(size: 15, weight: .bold))
                        .foregroundStyle(lightOn ? Color.orange : ink)
                        .frame(width: 36, height: 36).background(ink.opacity(0.14), in: Circle())
                }
                .buttonStyle(.plain).accessibilityLabel(T("Screen light"))
            }
            .padding(.horizontal, 16)
            VStack(spacing: 6) {
                Text(title).font(NXFont.display(24, .bold)).foregroundStyle(ink)
                    .multilineTextAlignment(.center).contentTransition(.numericText())
                Text(subtitle).font(NXFont.text(14)).foregroundStyle(inkSoft)
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
        case .sideA: return T("Turn your head to the right")
        case .sideB: return T("Now turn to the left")
        case .blink: return T("Blink once")
        case .capture: return T("Hold still")
        }
    }
    private var subtitle: String {
        if done { return T("Taking your selfie…") }
        if let n = engine.notice { return n }
        if engine.presence == .none && engine.dark { return T("It's dark here, so the screen is your light. Hold the phone a little closer.") }
        switch engine.presence {
        case .none: return T("No face yet. Hold the phone at eye level, in good light.")
        case .small: return T("Come a little closer.")
        case .offCentre: return T("Move your face into the window.")
        case .ok: break
        }
        if engine.stalled {
            switch engine.step {
            case .sideA, .sideB: return T("Turn a bit further, until the bar fills up.")
            case .blink: return T("Close your eyes for a moment, then open them. Glasses can make this harder.")
            default: return T("Keep your face inside the window, in good light.")
            }
        }
        switch engine.step {
        case .center: return T("Keep your face inside the window.")
        case .sideA: return T("Slowly, like the arrow, until the bar fills up.")
        case .sideB: return T("Same again, the other way.")
        case .blink: return T("Look straight, close your eyes, then open them.")
        case .capture: return T("Look straight, eyes open.")
        }
    }

    private var chips: some View {
        HStack(spacing: 8) {
            ForEach(Array(zip(0..<4, [T("Straight"), T("Right"), T("Left"), T("Blink")])), id: \.0) { i, label in
                let s = segmentState(i)
                HStack(spacing: 5) {
                    if s == .done { Image(systemName: "checkmark").font(.system(size: 10, weight: .bold)).transition(.scale.combined(with: .opacity)) }
                    Text(label).font(NXFont.text(11, .semibold))
                }
                .foregroundStyle(s == .todo ? ink.opacity(0.5) : .white)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background((s == .done ? NX.success : s == .current ? NX.violet : ink.opacity(0.14)), in: Capsule())
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

    // The screen as a ring light: full brightness while lit, put back exactly as it was after.
    private func boostBrightness() {
        if savedBrightness == nil { savedBrightness = UIScreen.main.brightness }
        UIScreen.main.brightness = 1
    }
    private func restoreBrightness() {
        if let b = savedBrightness { UIScreen.main.brightness = b; savedBrightness = nil }
    }
}

/// A check drawn as one stroke, so `.trim` can animate it being written.
private struct CheckmarkShape: Shape {
    func path(in r: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: r.minX + r.width * 0.12, y: r.minY + r.height * 0.55))
        p.addLine(to: CGPoint(x: r.minX + r.width * 0.42, y: r.minY + r.height * 0.84))
        p.addLine(to: CGPoint(x: r.minX + r.width * 0.90, y: r.minY + r.height * 0.22))
        return p
    }
}

// MARK: - Camera preview

private struct CameraFeed: UIViewRepresentable {
    let engine: LivenessEngine
    func makeUIView(context: Context) -> PreviewView {
        let v = PreviewView()
        v.previewLayer.session = engine.session
        v.previewLayer.videoGravity = .resizeAspectFill
        engine.previewLayer = v.previewLayer
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
/// Two detectors, each doing what it is good at: the camera's own face metadata places the window
/// (screen points, converted by the preview layer, no geometry of ours); Vision's landmarks give
/// yaw for the turns and lid separation for the blink.
///
/// Older phones — XR, XS, 11 — run the landmark request in 30–50 ms rather than 10. The engine
/// measures each pass and, when it is slow, lets the next frame go by (never during the blink step,
/// where a blink is only a few frames long); the camera's own face box keeps the window smooth
/// regardless, since it costs nothing.
final class LivenessEngine: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureMetadataOutputObjectsDelegate {
    enum Step: Int, Comparable {
        case center, sideA, sideB, blink, capture
        static func < (a: Step, b: Step) -> Bool { a.rawValue < b.rawValue }
    }
    enum Presence { case none, small, offCentre, ok }

    @Published private(set) var step: Step = .center
    @Published private(set) var presence: Presence = .none
    /// Where the face is ON SCREEN, in points.
    @Published private(set) var faceScreenRect: CGRect?
    @Published private(set) var yawDegrees: Double = 0
    /// 0…1: how far the head has turned toward what the current step asks for.
    @Published private(set) var turnProgress: Double = 0
    @Published private(set) var eyesClosed = false
    @Published private(set) var stalled = false
    @Published private(set) var dark = false
    @Published private(set) var notice: String?
    @Published private(set) var cameraDenied = false
    @Published private(set) var captured: Data?

    let session = AVCaptureSession()
    weak var previewLayer: AVCaptureVideoPreviewLayer?
    private let metadataOutput = AVCaptureMetadataOutput()
    private let queue = DispatchQueue(label: "id.znetworks.nexus.liveness", qos: .userInitiated)
    private let ciContext = CIContext()

    // Queue-confined state.
    private var current: Step = .center
    private var holdFrames = 0
    private var side: Double = 0
    private var openness: [Double] = []       // recent eye openness, for the blink reference
    private var blinkSeen = false
    private var lostFrames = 0
    private var frameCount = 0
    private var skipNext = false
    private var stepStart = Date()
    private var cooldownUntil = Date.distantPast
    private var finished = false
    private var lastPublish = Date.distantPast
    private var isDark = false

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
            // Let the sensor help in the dark before the screen has to.
            if (try? device.lockForConfiguration()) != nil {
                if device.isLowLightBoostSupported { device.automaticallyEnablesLowLightBoostWhenAvailable = true }
                device.unlockForConfiguration()
            }
            self.session.addInput(input)
            let output = AVCaptureVideoDataOutput()
            output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]
            output.alwaysDiscardsLateVideoFrames = true
            output.setSampleBufferDelegate(self, queue: self.queue)
            if self.session.canAddOutput(output) { self.session.addOutput(output) }
            // Face rectangles from the camera stack itself, for the window that follows the face.
            if self.session.canAddOutput(self.metadataOutput) {
                self.session.addOutput(self.metadataOutput)
                if self.metadataOutput.availableMetadataObjectTypes.contains(.face) {
                    self.metadataOutput.metadataObjectTypes = [.face]
                }
                self.metadataOutput.setMetadataObjectsDelegate(self, queue: .main)
            }
            // The buffer stays in the camera's native orientation. Vision is told how it is held
            // (`.leftMirrored`, the front camera in portrait); nothing is rotated or mirrored by hand.
            self.session.commitConfiguration()
            self.session.startRunning()
        }
    }

    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
        guard let layer = previewLayer else { return }
        let faces = objects.compactMap { $0 as? AVMetadataFaceObject }
        guard let face = faces.max(by: { $0.bounds.width * $0.bounds.height < $1.bounds.width * $1.bounds.height }),
              let onScreen = layer.transformedMetadataObject(for: face) else {
            if faceScreenRect != nil { faceScreenRect = nil }
            return
        }
        let r = onScreen.bounds
        // Sub-2pt wobble is noise, not movement; publishing it only makes the window shiver.
        if let old = faceScreenRect, abs(old.midX - r.midX) < 2, abs(old.midY - r.midY) < 2,
           abs(old.width - r.width) < 2, abs(old.height - r.height) < 2 { return }
        faceScreenRect = r
    }

    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard !finished, let pixel = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        frameCount += 1
        if frameCount % 8 == 0 { measureLight(pixel) }
        if skipNext && current != .blink { skipNext = false; return }
        let started = Date()
        let request = VNDetectFaceLandmarksRequest()
        let handler = VNImageRequestHandler(cvPixelBuffer: pixel, orientation: .leftMirrored, options: [:])
        try? handler.perform([request])
        skipNext = Date().timeIntervalSince(started) > 0.04
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
            publish(presence: .none, yaw: 0, progress: 0, closed: false)
            holdFrames = 0
            return
        }
        lostFrames = 0
        // Vision reports the box in the buffer's own (landscape) space. Size and centring are judged
        // in a way that does not care which way the sensor lies: the face's longer side in pixels
        // against the frame's shorter side.
        let box = face.boundingBox
        let bw = CGFloat(CVPixelBufferGetWidth(pixel)), bh = CGFloat(CVPixelBufferGetHeight(pixel))
        let facePx = max(box.width * bw, box.height * bh)
        let presence: Presence
        if facePx < 0.30 * min(bw, bh) { presence = .small }
        else if abs(box.midX - 0.5) > 0.2 || abs(box.midY - 0.5) > 0.2 { presence = .offCentre }
        else { presence = .ok }
        let yaw = face.yaw?.doubleValue ?? 0

        // Blink reference: the widest the eyes have been in the last ~1.5 s. A blink is a short dip
        // well below that, then a recovery — so it works for narrow eyes and wide eyes alike.
        var closed = false
        if let open = eyeOpenness(face) {
            openness.append(open); if openness.count > 45 { openness.removeFirst() }
            if let ref = openness.max(), ref > 0.05 { closed = open < ref * 0.70 }
        }
        // How far the head has turned toward what this step wants: any side for the first turn,
        // the opposite side for the second.
        var progress = 0.0
        switch current {
        case .sideA: progress = min(1, abs(yaw) / Self.turned)
        case .sideB: progress = (yaw > 0 ? 1.0 : -1.0) == -side ? min(1, abs(yaw) / Self.turned) : 0
        default: break
        }
        publish(presence: presence, yaw: yaw, progress: progress, closed: closed)
        guard presence == .ok, now >= cooldownUntil else { holdFrames = 0; return }
        if !stalled && now.timeIntervalSince(stepStart) > 15 { DispatchQueue.main.async { self.stalled = true } }

        switch current {
        case .center:
            guard abs(yaw) < Self.frontal else { holdFrames = 0; return }
            if held(6) { advance() }
        case .sideA:
            guard abs(yaw) >= Self.turned else { holdFrames = 0; return }
            side = yaw > 0 ? 1 : -1
            if held(3) { advance() }
        case .sideB:
            guard abs(yaw) >= Self.turned, (yaw > 0 ? 1.0 : -1.0) == -side else { holdFrames = 0; return }
            if held(3) { advance() }
        case .blink:
            guard abs(yaw) < Self.frontal + 0.12, let open = eyeOpenness(face), let ref = openness.max(), ref > 0.05 else { return }
            if !blinkSeen { if open < ref * 0.70 { blinkSeen = true } }
            else if open > ref * 0.85 { advance() }
        case .capture:
            guard abs(yaw) < Self.frontal, !closed else { holdFrames = 0; return }
            if held(4) { capture(pixel) }
        }
    }

    private func held(_ frames: Int) -> Bool { holdFrames += 1; return holdFrames >= frames }

    private func advance() {
        holdFrames = 0; blinkSeen = false; stepStart = Date()
        cooldownUntil = Date().addingTimeInterval(0.5)
        current = Step(rawValue: current.rawValue + 1) ?? .capture
        let next = current
        DispatchQueue.main.async {
            Haptics.success()
            self.stalled = false; self.notice = nil; self.turnProgress = 0
            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { self.step = next }
        }
    }

    private func reset(_ why: String) {
        current = .center; holdFrames = 0; side = 0; blinkSeen = false; openness.removeAll()
        stepStart = Date(); cooldownUntil = Date().addingTimeInterval(0.5)
        DispatchQueue.main.async {
            Haptics.warning()
            self.stalled = false; self.notice = why; self.turnProgress = 0
            withAnimation { self.step = .center }
            DispatchQueue.main.asyncAfter(deadline: .now() + 2.5) { if self.notice == why { self.notice = nil } }
        }
    }

    private func publish(presence: Presence, yaw: Double, progress: Double, closed: Bool) {
        let now = Date()
        // Blink state is never throttled — a blink is only a few frames long.
        let deg = yaw * 180 / .pi
        let throttled = now.timeIntervalSince(lastPublish) < 0.04
        if !throttled { lastPublish = now }
        DispatchQueue.main.async {
            if self.eyesClosed != closed { self.eyesClosed = closed }
            guard !throttled else { return }
            if self.presence != presence { self.presence = presence }
            if abs(self.yawDegrees - deg) > 0.5 { self.yawDegrees = deg }
            if abs(self.turnProgress - progress) > 0.02 { self.turnProgress = progress }
        }
    }

    /// How open the eyes are: mean lid separation over the corner-to-corner width, averaged over
    /// both eyes. Independent of the landmark order and of face size — only the ratio to the
    /// person's own recent maximum matters.
    private func eyeOpenness(_ face: VNFaceObservation) -> Double? {
        guard let l = face.landmarks?.leftEye, let r = face.landmarks?.rightEye else { return nil }
        func openness(_ region: VNFaceLandmarkRegion2D) -> Double? {
            let pts = region.normalizedPoints.map { (x: Double($0.x), y: Double($0.y)) }
            guard pts.count >= 6, let a = pts.min(by: { $0.x < $1.x }), let b = pts.max(by: { $0.x < $1.x }) else { return nil }
            let dx = b.x - a.x, dy = b.y - a.y
            let width = (dx * dx + dy * dy).squareRoot()
            guard width > 0 else { return nil }
            var up = 0.0, down = 0.0, nUp = 0, nDown = 0
            for p in pts {
                let d = ((p.x - a.x) * dy - (p.y - a.y) * dx) / width
                if d > 0 { up += d; nUp += 1 } else if d < 0 { down -= d; nDown += 1 }
            }
            let top = nUp > 0 ? up / Double(nUp) : 0, bottom = nDown > 0 ? down / Double(nDown) : 0
            return (top + bottom) / width
        }
        guard let a = openness(l), let b = openness(r) else { return nil }
        return (a + b) / 2
    }

    /// Mean brightness of a coarse grid of pixels. Dark below ~55/255, light again above ~75, so
    /// the screen light does not flicker on the threshold. When no face has been found for a couple
    /// of seconds, merely dim (below ~100) already counts as dark: if the detector cannot see a
    /// face, more light is the one thing that helps.
    private func measureLight(_ pixel: CVPixelBuffer) {
        CVPixelBufferLockBaseAddress(pixel, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixel, .readOnly) }
        guard let base = CVPixelBufferGetBaseAddress(pixel) else { return }
        let w = CVPixelBufferGetWidth(pixel), h = CVPixelBufferGetHeight(pixel), stride = CVPixelBufferGetBytesPerRow(pixel)
        let p = base.assumingMemoryBound(to: UInt8.self)
        var sum = 0, n = 0
        for gy in 0..<16 { for gx in 0..<16 {
            let x = (gx * 2 + 1) * w / 32, y = (gy * 2 + 1) * h / 32
            let o = y * stride + x * 4
            sum += (Int(p[o]) * 114 + Int(p[o + 1]) * 587 + Int(p[o + 2]) * 299) / 1000   // BGRA
            n += 1
        } }
        let mean = n > 0 ? sum / n : 128
        let wasDark = isDark
        let struggling = lostFrames > 60
        if mean < 55 || (struggling && mean < 100) { isDark = true }
        else if mean > (struggling ? 120 : 75) { isDark = false }
        if isDark != wasDark { let d = isDark; DispatchQueue.main.async { self.dark = d } }
    }

    private static func hasUprightFace(_ cg: CGImage) -> Bool {
        let request = VNDetectFaceRectanglesRequest()
        try? VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:]).perform([request])
        return !(request.results ?? []).isEmpty
    }

    private func capture(_ pixel: CVPixelBuffer) {
        finished = true
        // Native landscape buffer → upright, mirrored like the preview the person just looked at.
        // `.leftMirrored` is the front camera held in portrait — and it is what Vision was told, so
        // the face it just tracked is proof it is right. Verified anyway rather than trusted: the
        // finished picture is checked for an upright face, and if there is none the other three
        // ways of holding the sensor are tried. A sideways selfie can never reach the record.
        let base = CIImage(cvPixelBuffer: pixel)
        var chosen: CGImage?
        for orientation in [CGImagePropertyOrientation.leftMirrored, .rightMirrored, .upMirrored, .downMirrored] {
            var image = base.oriented(orientation)
            let maxSide = max(image.extent.width, image.extent.height)
            if maxSide > 1280 { image = image.transformed(by: CGAffineTransform(scaleX: 1280 / maxSide, y: 1280 / maxSide)) }
            guard let cg = ciContext.createCGImage(image, from: image.extent) else { continue }
            if chosen == nil { chosen = cg }
            if Self.hasUprightFace(cg) { chosen = cg; break }
        }
        guard let cg = chosen, let data = UIImage(cgImage: cg).jpegData(compressionQuality: 0.7) else { finished = false; return }
        DispatchQueue.main.async {
            Haptics.success()
            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { self.captured = data }
        }
    }
}
