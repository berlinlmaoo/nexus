import SwiftUI

// The pieces the signed-out flows drawn in place of LoginView's card share: sign-up and password
// reset. They lived privately in SignUpView until the reset flow arrived; pulled out here so the
// two screens keep one look (and one countdown behaviour) instead of two copies that drift apart.
//
// Naming note: no generic parameter in this file may be called `T` — `T("…")` is the localisation
// function, and a generic `T` in scope silently turns every `T("…")` into "construct a T".

/// Stateless blocks, grouped so call sites read `AuthForm.errorBox(…)` rather than free functions.
enum AuthForm {
    /// The red box under a form, holding the server's sentence verbatim.
    static func errorBox(_ text: String) -> some View {
        Text(text)
            .font(NXFont.text(13, .semibold))
            .foregroundStyle(NX.danger)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14).padding(.vertical, 11)
            .background(Color(hex: "#fef2f2"), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.danger.opacity(0.2)))
    }

    /// The green "we emailed you" box above a code field.
    static func infoBox(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "envelope.badge.fill").font(.system(size: 14, weight: .semibold))
            Text(text).frame(maxWidth: .infinity, alignment: .leading)
        }
        .font(NXFont.text(13, .semibold))
        .foregroundStyle(NX.success)
        .padding(.horizontal, 14).padding(.vertical, 11)
        .background(Color(hex: "#ecfdf5"), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(NX.success.opacity(0.2)))
    }

    /// Uppercase tracked label over a field, as on LoginView.
    @ViewBuilder
    static func fieldBlock<Content: View>(label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(label).font(NXFont.text(11, .bold)).tracking(1).foregroundStyle(NX.mutedFg)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.leading, 4)
            content()
        }
    }

    /// Seconds until `until`, rounded up so the label never shows 0 while the button is still off.
    static func secondsLeft(until: Date?, at now: Date) -> Int {
        guard let until else { return 0 }
        return max(0, Int(until.timeIntervalSince(now).rounded(.up)))
    }
}

/// Centred while it fits, scrollable once it does not: four fields and a helper line do not fit an
/// SE with the keyboard up. `minHeight` rather than a fixed height, so a card taller than the
/// screen grows the scroll content instead of being clipped.
struct AuthScrollContainer<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        GeometryReader { geo in
            ScrollView {
                content()
                    .frame(maxWidth: 460)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 24)
                    .frame(maxWidth: .infinity, minHeight: geo.size.height)
            }
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
    }
}

/// LoginView's frosted card: material, white wash, hairline and the long soft shadow.
struct AuthCard: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 28)
            .padding(.vertical, 34)
            .frame(maxWidth: .infinity)
            .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 38, style: .continuous))
            .background(Color.white.opacity(0.5), in: RoundedRectangle(cornerRadius: 38, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 38, style: .continuous).strokeBorder(.white.opacity(0.65), lineWidth: 1))
            .shadow(color: .black.opacity(0.10), radius: 40, y: 26)
    }
}

/// The chrome around LoginView's text fields. Focus is passed in as a Bool because each screen
/// owns its own `@FocusState` enum; the `.focused(…)` itself stays with the caller.
struct AuthFieldChrome: ViewModifier {
    let focused: Bool
    var verticalPadding: CGFloat = 15

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 18).padding(.vertical, verticalPadding)
            .background(Color.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(focused ? NX.onyx.opacity(0.5) : .white, lineWidth: focused ? 2 : 1)
            )
            .shadow(color: .black.opacity(0.03), radius: 4, y: 2)
    }
}

/// The 6-digit field. `.oneTimeCode` is what lets iOS lift the code out of the email in Mail and
/// offer it above the keyboard; `.numberPad` alone does not. The caller applies `.focused`.
struct OneTimeCodeField: View {
    @Binding var code: String
    let focused: Bool

    var body: some View {
        TextField("", text: $code, prompt: Text("000000").foregroundColor(NX.mutedFg.opacity(0.6)))
            .textContentType(.oneTimeCode)
            .keyboardType(.numberPad)
            .font(.system(size: 26, weight: .bold, design: .monospaced))
            .tracking(10)
            .multilineTextAlignment(.center)
            .foregroundStyle(NX.foreground)
            .modifier(AuthFieldChrome(focused: focused, verticalPadding: 14))
            // Autofill and paste can bring spaces or a longer string; the server only accepts
            // exactly six ASCII digits (`^\d{6}$`).
            .onChange(of: code) { _, value in
                let digits = String(value.filter(\.isASCIIDigit).prefix(6))
                if digits != value { code = digits }
            }
    }
}

/// The onyx CTA with the server's cooldown folded in: while it runs the label counts down and the
/// button is off, instead of inviting a tap the server has already said it will refuse.
struct CooldownCTA: View {
    let idle: String
    let busyLabel: String
    let busy: Bool
    let cooldownUntil: Date?
    let action: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let left = AuthForm.secondsLeft(until: cooldownUntil, at: ctx.date)
            Button(action: action) {
                HStack(spacing: 8) {
                    if busy {
                        ProgressView().tint(.white)
                        Text(busyLabel)
                    } else if left > 0 {
                        Text(String(format: T("Try again in %ds"), left)).monospacedDigit()
                    } else {
                        Text(idle)
                        Image(systemName: "arrow.right").font(.system(size: 14, weight: .bold))
                    }
                }
                .modifier(OnyxCTA())
            }
            .buttonStyle(.plain)
            .disabled(busy || left > 0)
            .opacity(busy || left > 0 ? 0.7 : 1)
        }
    }
}

/// "Resend code", or the countdown until the server will take another request. The countdown is
/// the reason the tap is refused, so it is shown rather than a button that silently does nothing.
struct ResendCodeButton: View {
    let busy: Bool
    let cooldownUntil: Date?
    let action: () -> Void

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            let left = AuthForm.secondsLeft(until: cooldownUntil, at: ctx.date)
            Button(action: action) {
                Text(left > 0 ? String(format: T("Resend in %ds"), left) : T("Resend code"))
                    .font(NXFont.text(13, .bold))
                    .foregroundStyle(left > 0 ? NX.mutedFg : NX.violetText)
                    .monospacedDigit()
            }
            .buttonStyle(.plain)
            .disabled(busy || left > 0)
        }
    }
}

/// LoginView's onyx CTA, shared by the sign-up and reset buttons so they cannot drift from it.
struct OnyxCTA: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(NXFont.display(16, .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .background(NX.onyx, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .shadow(color: NX.onyx.opacity(0.25), radius: 18, y: 10)
    }
}

extension Character {
    /// `isNumber` would also let through Arabic-Indic and full-width digits, which the server's
    /// `^\d{6}$` refuses.
    var isASCIIDigit: Bool { isASCII && isNumber }
}
