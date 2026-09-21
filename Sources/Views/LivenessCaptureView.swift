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
///
/// The bright window follows the detected face, so the person sees what the check sees. In the
/// dark — a club, a warehouse at night — the rest of the screen turns white and the display goes to
/// full brightness: the phone becomes its own ring light. It also switches on by hand.
struct LivenessCaptureView: View {
    var onCapture: (Data) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @StateObject private var engine = LivenessEngine()
    @State private var pulse = false
    @State private var flash = false
    @State private var finishing = false
    @State private var manualLight = false
    @State private var savedBrightness: CGFloat?

    private var lightOn: Bool { manualLight || engine.dark }
    private var ink: Color { lightOn ? .black : .white }
    private var inkSoft: Color { lightOn ? .black.opacity(0.7) : .white.opacity(0.78) }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            CameraFeed(engine: engine).ignoresSafeArea()
            GeometryReader { geo in
                let home = Self.ovalRect(in: geo.size)
                let oval = trackedOval(home: home, in: geo.size)
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
                    gauge.position(x: home.midX, y: home.maxY + 46)
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
        .onAppear { engine.start(); pulse = true }
        .onDisappear { engine.stop(); restoreBrightness() }
        .onChange(of: lightOn) { _, on in on ? boostBrightness() : restoreBrightness() }
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

    // MARK: geometry

    private static func ovalRect(in size: CGSize) -> CGRect {
        let w = min(size.width * 0.72, 300), h = w * 1.32
        return CGRect(x: (size.width - w) / 2, y: size.height * 0.44 - h / 2, width: w, height: h)
    }

    /// The window hugs the detected face (a little room for hair and chin); without a face it rests
    /// at its home position so people know where to put themselves.
    ///
    /// The rect is already in screen points: it comes from the camera's own face metadata, turned
    /// into layer coordinates by the preview layer (`transformedMetadataObject`). No hand-made
    /// rotation, mirror or crop arithmetic — two attempts at that put the window beside the face
    /// or stretched it twice as tall as the face.
    private func trackedOval(home: CGRect, in size: CGSize) -> CGRect {
        guard let f = engine.faceScreenRect, f.width > 10, f.height > 10, f.width.isFinite, f.height.isFinite else { return home }
        let w = min(max(f.width * 1.3, 150), home.width * 1.15)
        let h = min(max(f.height * 1.5, w * 1.2), home.height * 1.2)
        return CGRect(x: f.midX - w / 2, y: f.midY - f.height * 0.08 - h / 2, width: w, height: h)
    }

    private var done: Bool { engine.captured != nil }

    /// Four arcs around the window, one per move: grey to do, violet in progress, green done.
    /// Starts at the top and goes clockwise; the trim offsets do that without rotating the shape
    /// (a rotated ellipse swaps its width and height — that was the squashed ring).
    private func ring(_ oval: CGRect) -> some View {
        ZStack {
            ForEach(0..<4, id: \.self) { i in
                let state = segmentState(i)
                let from = CGFloat((i + 3) % 4) / 4
                Ellipse()
                    .trim(from: from + 0.012, to: from + 0.25 - 0.012)
                    .stroke(color(for: state), style: StrokeStyle(lineWidth: state == .current ? 7 : 5, lineCap: .round))
                    .opacity(state == .current && !reduceMotion ? (pulse ? 1 : 0.45) : 1)
                    .animation(state == .current && !reduceMotion ? .easeInOut(duration: 0.9).repeatForever(autoreverses: true) : .default, value: pulse)
            }
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
        .frame(width: oval.width + 20, height: oval.height + 20)
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
        switch s {
        case .todo: return lightOn ? .black.opacity(0.18) : .white.opacity(0.28)
        case .current: return NX.violet
        case .done: return NX.success
        }
    }

    /// Live feedback that needs no words: a dot that follows the head, two zones to reach it into.
    /// For the blink step it becomes an eye that closes with the user's own eyes.
    private var gauge: some View {
        Group {
            switch engine.step {
            case .sideA, .sideB:
                ZStack {
                    Capsule().fill(ink.opacity(0.18)).frame(width: 200, height: 10)
                    HStack {
                        zone(reached: engine.firstSide == -1, wanted: engine.step == .sideB && engine.firstSide == 1)
                        Spacer()
                        zone(reached: engine.firstSide == 1, wanted: engine.step == .sideB && engine.firstSide == -1)
                    }
                    .frame(width: 200)
                    Circle().fill(lightOn ? Color.black : Color.white).frame(width: 18, height: 18)
                        .shadow(color: .black.opacity(0.3), radius: 3, y: 1)
                        .offset(x: max(-88, min(88, CGFloat(engine.yawDegrees) * 3.2)))
                        .animation(.interactiveSpring(response: 0.25, dampingFraction: 0.8), value: engine.yawDegrees)
                }
            case .blink:
                Image(systemName: engine.eyesClosed ? "eye.slash.fill" : "eye.fill")
                    .font(.system(size: 30, weight: .semibold)).foregroundStyle(ink)
                    .contentTransition(.symbolEffect(.replace))
            case .capture:
                Image(systemName: "camera.fill").font(.system(size: 26, weight: .semibold)).foregroundStyle(ink)
            case .center:
                Image(systemName: "face.dashed").font(.system(size: 30, weight: .semibold)).foregroundStyle(ink.opacity(0.9))
            }
        }
        .frame(height: 44)
        .transition(.opacity)
        .animation(.easeInOut(duration: 0.2), value: engine.step)
    }

    private func zone(reached: Bool, wanted: Bool) -> some View {
        Capsule().fill(reached ? NX.success : (wanted ? NX.violet : ink.opacity(0.35)))
            .frame(width: 34, height: 18)
            .opacity(wanted && !reduceMotion ? (pulse ? 1 : 0.5) : 1)
            .animation(wanted && !reduceMotion ? .easeInOut(duration: 0.7).repeatForever(autoreverses: true) : .default, value: pulse)
    }

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
        case .sideA: return T("Turn your head to one side")
        case .sideB: return T("Now turn to the other side")
        case .blink: return T("Blink")
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
            case .sideA, .sideB: return T("Turn a bit further, until the dot reaches the end.")
            case .blink: return T("Close your eyes for a moment, then open them. Glasses can make this harder.")
            default: return T("Keep your face inside the window, in good light.")
            }
        }
        switch engine.step {
        case .center: return T("Keep your face inside the window.")
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
/// Turning direction is deliberately not prescribed. Vision's yaw sign depends on the buffer
/// orientation and mirroring, and getting it wrong would tell people "left" while waiting for
/// right. So the first turn may go either way, and the second must go the opposite way — which is
/// exactly what liveness needs: two distinct poses a photo cannot produce.
final class LivenessEngine: NSObject, ObservableObject, AVCaptureVideoDataOutputSampleBufferDelegate, AVCaptureMetadataOutputObjectsDelegate {
    enum Step: Int, Comparable {
        case center, sideA, sideB, blink, capture
        static func < (a: Step, b: Step) -> Bool { a.rawValue < b.rawValue }
    }
    enum Presence { case none, small, offCentre, ok }

    @Published private(set) var step: Step = .center
    @Published private(set) var presence: Presence = .none
    /// Where the face is ON SCREEN, in points, from the camera's own face metadata converted by the
    /// preview layer. Vision still does the landmarks; this only places the window.
    @Published private(set) var faceScreenRect: CGRect?
    @Published private(set) var bufferSize: CGSize?
    /// Set by the preview; converts metadata faces to screen points.
    weak var previewLayer: AVCaptureVideoPreviewLayer?
    private let metadataOutput = AVCaptureMetadataOutput()
    @Published private(set) var yawDegrees: Double = 0
    @Published private(set) var eyesClosed = false
    @Published private(set) var firstSide: Double = 0
    @Published private(set) var stalled = false
    @Published private(set) var dark = false
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
    private var openness: [Double] = []       // recent eye openness, for the blink reference
    private var blinkSeen = false
    private var lostFrames = 0
    private var frameCount = 0
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
            // (`.leftMirrored`, the front camera in portrait) and the preview layer converts the
            // results to the screen — nothing is rotated or mirrored by hand.
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
        if frameCount == 1 {
            let size = CGSize(width: CVPixelBufferGetWidth(pixel), height: CVPixelBufferGetHeight(pixel))
            DispatchQueue.main.async { self.bufferSize = size }
        }
        if frameCount % 8 == 0 { measureLight(pixel) }
        let request = VNDetectFaceLandmarksRequest()
        let handler = VNImageRequestHandler(cvPixelBuffer: pixel, orientation: .leftMirrored, options: [:])
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
        // Vision reports the box in the buffer's own (landscape) space, origin bottom-left. Size
        // and centring are judged there in a way that does not care which way the sensor lies:
        // the face's longer side in pixels against the frame's shorter side.
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
        publish(presence: presence, yaw: yaw, closed: closed)
        guard presence == .ok, now >= cooldownUntil else { holdFrames = 0; return }
        if !stalled && now.timeIntervalSince(stepStart) > 15 { DispatchQueue.main.async { self.stalled = true } }

        switch current {
        case .center:
            guard abs(yaw) < Self.frontal else { holdFrames = 0; return }
            if held(6) { advance() }
        case .sideA:
            guard abs(yaw) >= Self.turned else { holdFrames = 0; return }
            side = yaw > 0 ? 1 : -1
            if held(3) { DispatchQueue.main.async { self.firstSide = self.side }; advance() }
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
            self.stalled = false; self.notice = nil
            withAnimation(.spring(response: 0.45, dampingFraction: 0.7)) { self.step = next }
        }
    }

    private func reset(_ why: String) {
        current = .center; holdFrames = 0; side = 0; blinkSeen = false; openness.removeAll()
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
        // Blink state is never throttled — a blink is only a few frames long.
        let deg = yaw * 180 / .pi
        let throttled = now.timeIntervalSince(lastPublish) < 0.04
        if !throttled { lastPublish = now }
        DispatchQueue.main.async {
            if self.eyesClosed != closed { self.eyesClosed = closed }
            guard !throttled else { return }
            if self.presence != presence { self.presence = presence }
            if abs(self.yawDegrees - deg) > 0.5 { self.yawDegrees = deg }
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
            // Signed distance of every other point to the corner line: lids above and below.
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
    private static func hasUprightFace(_ cg: CGImage) -> Bool {
        let request = VNDetectFaceRectanglesRequest()
        try? VNImageRequestHandler(cgImage: cg, orientation: .up, options: [:]).perform([request])
        return !(request.results ?? []).isEmpty
    }

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
