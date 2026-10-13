import SwiftUI

/// The NEXUS mark, as geometry rather than a picture.
///
/// The app already ships the logo as a PNG, and a PNG can only fade. Drawn as four strokes that
/// grow outward from the centre, the mark assembles itself — which is the whole point of showing it
/// while the app is loading: the motion says "putting your things back together", not "please wait".
///
/// Four arms rather than two paths, because `trim` runs one way along a path: two would draw from
/// one end to the other, and the mark is symmetric about its centre. Each arm starts at the middle
/// and reaches out, so all four bloom at once.
struct NexusMarkArm: Shape {
    enum Corner { case topLeft, topRight, bottomLeft, bottomRight }
    let corner: Corner

    func path(in rect: CGRect) -> Path {
        func p(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + rect.width * x, y: rect.minY + rect.height * y)
        }
        var path = Path()
        switch corner {
        case .topLeft:
            path.move(to: p(0.50, 0.455))
            path.addQuadCurve(to: p(0.135, 0.245), control: p(0.315, 0.425))
        case .topRight:
            path.move(to: p(0.50, 0.455))
            path.addQuadCurve(to: p(0.865, 0.245), control: p(0.685, 0.425))
        case .bottomLeft:
            path.move(to: p(0.50, 0.545))
            path.addQuadCurve(to: p(0.135, 0.755), control: p(0.315, 0.575))
        case .bottomRight:
            path.move(to: p(0.50, 0.545))
            path.addQuadCurve(to: p(0.865, 0.755), control: p(0.685, 0.575))
        }
        return path
    }
}

/// The mark, drawing itself.
///
/// `progress` 0…1 is how far the arms have grown; the caller animates it. Kept separate from the
/// splash so the same mark can be used anywhere something is loading.
struct NexusMark: View {
    var progress: CGFloat = 1
    var lineWidth: CGFloat = 0.085      // fraction of the side
    var color: Color = .white

    var body: some View {
        GeometryReader { geo in
            let side = min(geo.size.width, geo.size.height)
            ZStack {
                ForEach(Array([NexusMarkArm.Corner.topLeft, .topRight, .bottomLeft, .bottomRight].enumerated()), id: \.offset) { _, corner in
                    NexusMarkArm(corner: corner)
                        .trim(from: 0, to: progress)
                        .stroke(color, style: StrokeStyle(lineWidth: side * lineWidth, lineCap: .round, lineJoin: .round))
                }
            }
            .frame(width: geo.size.width, height: geo.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

/// What the app shows while it puts back what it already had.
///
/// Not a decoration. Opening NEXUS after a few days used to mean a screen of spinners, one per
/// card, each waiting on its own request — and with no signal, several of them never resolved at
/// all. This screen stands in front of that: the cache is read, the warm-up is started, and the
/// person sees the mark assemble instead of a grid of grey rectangles. It steps aside as soon as
/// there is something real to show, and never waits for the network to finish.
struct SplashView: View {
    /// What the warm-up is doing right now, shown under the mark. Empty means nothing to say.
    var status: String = ""
    /// 0…1 across the whole warm-up, or nil while the amount of work is still unknown.
    var progress: Double?
    /// Drives the arms; owned here so the animation runs even if nothing else changes.
    @State private var draw: CGFloat = 0
    @State private var settle = false
    @State private var glow = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            LinearGradient(colors: [Color(hex: "#7c6af0"), Color(hex: "#4b3fb0")],
                           startPoint: .topLeading, endPoint: .bottomTrailing)
                .ignoresSafeArea()
            VStack(spacing: 26) {
                Spacer()
                ZStack {
                    // A soft bloom behind the mark, so the strokes read as lit rather than painted.
                    Circle()
                        .fill(Color.white.opacity(0.16))
                        .frame(width: 190, height: 190)
                        .blur(radius: 42)
                        .scaleEffect(glow ? 1.06 : 0.94)
                        .opacity(draw > 0.2 ? 1 : 0)
                    NexusMark(progress: draw)
                        .frame(width: 132, height: 132)
                        .scaleEffect(settle ? 1 : 0.94)
                        .shadow(color: .black.opacity(0.18), radius: 18, y: 8)
                }
                VStack(spacing: 7) {
                    Text("NEXUS")
                        .font(NXFont.display(19, .bold))
                        .tracking(6)
                        .foregroundStyle(.white)
                        .opacity(settle ? 1 : 0)
                    Text(status.isEmpty ? T("Getting your workspace ready") : status)
                        .font(NXFont.text(12))
                        .foregroundStyle(.white.opacity(0.75))
                        .opacity(settle ? 1 : 0)
                        .animation(.easeInOut(duration: 0.2), value: status)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: 260)
                }
                Spacer()
                // A determinate bar once the work is countable, a travelling one before that: a bar
                // that pretends to know how far along it is when it does not is the thing people
                // learn to distrust.
                ProgressBar(progress: progress)
                    .frame(width: 168, height: 3)
                    .opacity(settle ? 1 : 0)
                    .padding(.bottom, 54)
            }
        }
        .onAppear {
            guard !reduceMotion else { draw = 1; settle = true; return }
            withAnimation(.easeOut(duration: 0.85)) { draw = 1 }
            withAnimation(.spring(response: 0.5, dampingFraction: 0.7).delay(0.55)) { settle = true }
            withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true).delay(0.6)) { glow = true }
        }
    }

    private struct ProgressBar: View {
        let progress: Double?
        @State private var travel = false
        var body: some View {
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(Color.white.opacity(0.22))
                    if let progress {
                        Capsule().fill(Color.white)
                            .frame(width: max(6, geo.size.width * CGFloat(min(max(progress, 0), 1))))
                            .animation(.easeOut(duration: 0.3), value: progress)
                    } else {
                        Capsule().fill(Color.white.opacity(0.9))
                            .frame(width: geo.size.width * 0.34)
                            .offset(x: travel ? geo.size.width * 0.66 : 0)
                            .animation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true), value: travel)
                    }
                }
            }
            .onAppear { travel = true }
        }
    }
}
