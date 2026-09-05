import CoreLocation

/// One-shot GPS fix via CoreLocation, async/await. Mirrors the web app's geo.ts intent: ask for
/// permission, grab a best-accuracy fix, surface a clear error on denial/timeout.
final class LocationManager: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<Fix, Error>?

    /// Everything CoreLocation hands over, not just the pair of numbers.
    ///
    /// A spoofed position is trivial to produce and impossible to rule out from coordinates alone,
    /// so the point is not to block it here — the app cannot — but to carry the evidence to the
    /// server, where it can be flagged and reviewed. `latitude`/`longitude` keep their old names so
    /// every existing call site reads the same.
    struct Fix: Sendable {
        let latitude: Double
        let longitude: Double
        /// Metres. Real GPS varies; several spoofers report a suspiciously perfect constant.
        let accuracyM: Double
        /// Many spoofers never supply one, which is itself worth recording.
        let altitudeM: Double?
        let speedMps: Double?
        let capturedAt: Date
        /// iOS 15+, Apple's own answer to "did this come from a simulator". Not every spoofing
        /// method trips it, but when it does the answer is unambiguous.
        let simulated: Bool
        /// Position came from an external accessory rather than the device's own receiver.
        let fromAccessory: Bool
    }
    private var awaitingAuth = false

    enum LocationError: LocalizedError {
        case denied, unavailable
        var errorDescription: String? {
            switch self {
            case .denied: return T("Location permission denied. Turn it on in Settings › NEXUS › Location.")
            case .unavailable: return T("Couldn't read your location. Make sure GPS is on and the signal is good.")
            }
        }
    }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    /// Pre-warm the permission prompt (call when the attendance screen appears).
    func requestPermissionIfNeeded() {
        if manager.authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
    }

    func currentFix() async throws -> Fix {
        switch manager.authorizationStatus {
        case .denied, .restricted:
            throw LocationError.denied
        default:
            break
        }
        return try await withCheckedThrowingContinuation { cont in
            self.continuation = cont
            if manager.authorizationStatus == .notDetermined {
                self.awaitingAuth = true
                manager.requestWhenInUseAuthorization()
            } else {
                manager.requestLocation()
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        guard awaitingAuth else { return }
        switch m.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            awaitingAuth = false
            m.requestLocation()
        case .denied, .restricted:
            awaitingAuth = false
            continuation?.resume(throwing: LocationError.denied)
            continuation = nil
        default:
            break
        }
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let source = loc.sourceInformation
        continuation?.resume(returning: Fix(
            latitude: loc.coordinate.latitude,
            longitude: loc.coordinate.longitude,
            accuracyM: loc.horizontalAccuracy,
            // CoreLocation uses negative values to mean "not available" rather than nil.
            altitudeM: loc.verticalAccuracy > 0 ? loc.altitude : nil,
            speedMps: loc.speed >= 0 ? loc.speed : nil,
            capturedAt: loc.timestamp,
            simulated: source?.isSimulatedBySoftware ?? false,
            fromAccessory: source?.isProducedByAccessory ?? false
        ))
        continuation = nil
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        continuation?.resume(throwing: LocationError.unavailable)
        continuation = nil
    }
}
