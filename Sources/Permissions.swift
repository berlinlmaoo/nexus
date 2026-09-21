import SwiftUI
import AVFoundation
import CoreLocation
import UserNotifications
import UIKit

/// What the app needs from the phone, and what to do when someone said no.
///
/// iOS asks each of these exactly once. A "Don't Allow" is permanent from the app's side: every later
/// request is refused silently, with no prompt, and the only way back is Settings. So the app never
/// re-asks — it notices, says what is off and why it matters here, and takes the person straight to
/// the switch. Photos and Files need nothing: their pickers run outside the app and hand over only
/// what was chosen.
enum PermissionKind: String, Identifiable, CaseIterable {
    case camera, location, notifications
    var id: String { rawValue }

    var title: String {
        switch self {
        case .camera: return T("Camera is off for NEXUS")
        case .location: return T("Location is off for NEXUS")
        case .notifications: return T("Notifications are off for NEXUS")
        }
    }
    var why: String {
        switch self {
        case .camera: return T("Attendance needs a selfie, and photos of receipts and documents need the camera. Turn it on in Settings › NEXUS › Camera.")
        case .location: return T("Attendance is checked against the office area, so it cannot be recorded without your location. Turn it on in Settings › NEXUS › Location.")
        case .notifications: return T("Approvals, replies and attendance reminders arrive as notifications. Turn them on in Settings › NEXUS › Notifications.")
        }
    }
    var symbol: String {
        switch self { case .camera: return "camera.fill"; case .location: return "location.slash.fill"; case .notifications: return "bell.slash.fill" }
    }
}

enum Permissions {
    static func openSettings() {
        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
    }
    static var cameraDenied: Bool {
        let s = AVCaptureDevice.authorizationStatus(for: .video)
        return s == .denied || s == .restricted
    }
    static var locationDenied: Bool {
        let s = CLLocationManager().authorizationStatus
        return s == .denied || s == .restricted
    }
    static func notificationsDenied() async -> Bool {
        await UNUserNotificationCenter.current().notificationSettings().authorizationStatus == .denied
    }
    /// Everything currently switched off — for a screen that lists them.
    static func denied() async -> [PermissionKind] {
        var out: [PermissionKind] = []
        if cameraDenied { out.append(.camera) }
        if locationDenied { out.append(.location) }
        if await notificationsDenied() { out.append(.notifications) }
        return out
    }
}

/// A full card for when the thing the person just asked for cannot happen at all — the camera
/// screen with no camera access, for instance.
struct PermissionDeniedCard: View {
    let kind: PermissionKind
    var onCancel: (() -> Void)? = nil
    var body: some View {
        VStack(spacing: 14) {
            Image(systemName: kind.symbol).font(.system(size: 30)).foregroundStyle(.white)
            Text(kind.title).font(NXFont.display(18, .bold)).foregroundStyle(.white).multilineTextAlignment(.center)
            Text(kind.why).font(NXFont.text(14)).foregroundStyle(.white.opacity(0.8)).multilineTextAlignment(.center)
            Button(T("Open Settings")) { Permissions.openSettings() }.buttonStyle(NexusPrimaryButton())
            if let onCancel {
                Button(T("Not now")) { onCancel() }.font(NXFont.text(14, .semibold)).foregroundStyle(.white.opacity(0.8))
            }
        }
        .padding(24).background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .padding(28)
    }
}

/// An inline reminder that sits where the thing it blocks lives — above the check-in buttons when
/// location is off — and takes the person to the switch.
struct PermissionBanner: View {
    let kind: PermissionKind
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: kind.symbol).font(.system(size: 15, weight: .semibold)).foregroundStyle(NX.danger).padding(.top, 1)
            VStack(alignment: .leading, spacing: 3) {
                Text(kind.title).font(NXFont.text(13, .bold)).foregroundStyle(NX.foreground)
                Text(kind.why).font(NXFont.text(12)).foregroundStyle(NX.mutedFg).fixedSize(horizontal: false, vertical: true)
                Button(T("Open Settings")) { Permissions.openSettings() }
                    .font(NXFont.text(12, .bold)).foregroundStyle(.white)
                    .padding(.horizontal, 12).padding(.vertical, 7).background(NX.danger, in: Capsule())
                    .padding(.top, 4)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .background(NX.danger.opacity(0.08), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(NX.danger.opacity(0.35)))
    }
}

extension View {
    /// An alert with the reason and a button to Settings, driven by an optional kind.
    func permissionAlert(_ kind: Binding<PermissionKind?>) -> some View {
        alert(kind.wrappedValue?.title ?? "",
              isPresented: Binding(get: { kind.wrappedValue != nil }, set: { if !$0 { kind.wrappedValue = nil } }),
              presenting: kind.wrappedValue) { _ in
            Button(T("Open Settings")) { Permissions.openSettings() }
            Button(T("Not now"), role: .cancel) {}
        } message: { k in
            Text(k.why)
        }
    }
}
