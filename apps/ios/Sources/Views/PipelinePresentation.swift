import SwiftUI

// MARK: - Presentation mode (R-20, 20 Oct 2026, asked by the GM / CEO; web: pipeline/presentation.tsx)
//
// One eye toggle in the Pipeline header hides every rupiah on screen — KPI strip, column totals, cards,
// table, health view, the deal sheet, payment terms and history — so the board can be shown on a big
// screen. Amounts read "Rp ••••" and money fields are locked; the card's margin line and the whole
// Real cost & margin section are not drawn at all. A screen mask only: the Excel export keeps the real
// numbers. Kept in memory across boards for this app session; never stored across app launches.

@MainActor
@Observable
final class PipelinePresentationSession {
    static let shared = PipelinePresentationSession()
    var isPresenting = false
    private init() {}
    func reset() { isPresenting = false }
}

private struct PipelinePresentingKey: EnvironmentKey { static let defaultValue = false }

extension EnvironmentValues {
    /// True while the Pipeline is in presentation mode: every amount is masked.
    var pipelinePresenting: Bool {
        get { self[PipelinePresentingKey.self] }
        set { self[PipelinePresentingKey.self] = newValue }
    }
}

extension PipelineFormat {
    static let moneyMask = "Rp ••••"

    /// The compact and full rupiah, masked while presenting.
    static func idr(_ n: Double?, hidden: Bool) -> String { hidden ? moneyMask : idr(n) }
    static func idrFull(_ n: Double?, hidden: Bool) -> String { hidden ? moneyMask : idrFull(n) }
}

/// A money field while presenting: "Rp ••••", greyed and locked, in the same box as the live field.
struct PipelineMaskedMoney: View {
    let label: String

    var body: some View {
        Text(PipelineFormat.moneyMask)
            .font(NXFont.text(14)).tracking(1).foregroundStyle(NX.mutedFg)
            .frame(maxWidth: .infinity, alignment: .leading)
            .modifier(PipelineInputChrome(active: false))
            .opacity(0.8)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(label): \(T("hidden in presentation mode"))")
    }
}
