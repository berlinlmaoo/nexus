import SwiftUI
import UIKit

// MARK: - Haptics

/// Lightweight wrapper over UIKit feedback generators. No-ops on the simulator (fires on device).
enum Haptics {
    static func tap() { UIImpactFeedbackGenerator(style: .light).impactOccurred() }
    static func medium() { UIImpactFeedbackGenerator(style: .medium).impactOccurred() }
    static func success() { UINotificationFeedbackGenerator().notificationOccurred(.success) }
    static func warning() { UINotificationFeedbackGenerator().notificationOccurred(.warning) }
}

// MARK: - Shimmer + skeleton loading

/// A diagonal highlight that sweeps across the view, masked to its shape. Honors Reduce Motion
/// (falls back to a static muted fill). Use via `.shimmer()` on skeleton placeholders.
struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content.overlay(
            GeometryReader { geo in
                if !reduceMotion {
                    LinearGradient(
                        colors: [.clear, Color.white.opacity(0.55), .clear],
                        startPoint: .topLeading, endPoint: .bottomTrailing
                    )
                    .frame(width: geo.size.width * 1.4)
                    .offset(x: phase * geo.size.width * 1.8)
                }
            }
            .blendMode(.overlay)
            .allowsHitTesting(false)
        )
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 1.15).repeatForever(autoreverses: false)) { phase = 1 }
        }
    }
}

extension View {
    func shimmer() -> some View { modifier(Shimmer()) }
}

/// One placeholder card (icon block + two text lines) with a shimmer sweep.
struct SkeletonCard: View {
    var body: some View {
        HStack(spacing: 12) {
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(NX.muted).frame(width: 44, height: 44)
            VStack(alignment: .leading, spacing: 8) {
                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(NX.muted).frame(maxWidth: .infinity).frame(height: 13)
                RoundedRectangle(cornerRadius: 6, style: .continuous).fill(NX.muted).frame(width: 150, height: 11)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(NX.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).strokeBorder(NX.border))
        .shimmer()
    }
}

/// A full-height stack of skeleton cards — drop-in replacement for a centered loading spinner.
struct SkeletonList: View {
    var count = 5
    var body: some View {
        VStack(spacing: 12) {
            ForEach(0..<count, id: \.self) { _ in SkeletonCard() }
            Spacer(minLength: 0)
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .transition(.opacity)
    }
}

// MARK: - Reveal on appear

/// Subtle fade + rise as a view first appears. Honors Reduce Motion. `index` staggers list items.
struct RevealOnAppear: ViewModifier {
    var index: Int = 0
    @State private var shown = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    func body(content: Content) -> some View {
        content
            .opacity(shown || reduceMotion ? 1 : 0)
            .offset(y: shown || reduceMotion ? 0 : 10)
            .onAppear {
                guard !reduceMotion, !shown else { shown = true; return }
                withAnimation(.spring(response: 0.45, dampingFraction: 0.85).delay(Double(min(index, 8)) * 0.04)) {
                    shown = true
                }
            }
    }
}

extension View {
    func revealOnAppear(_ index: Int = 0) -> some View { modifier(RevealOnAppear(index: index)) }
}
