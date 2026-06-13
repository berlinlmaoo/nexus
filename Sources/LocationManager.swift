import CoreLocation

/// One-shot GPS fix via CoreLocation, async/await. Mirrors the web app's geo.ts intent: ask for
/// permission, grab a best-accuracy fix, surface a clear error on denial/timeout.
final class LocationManager: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocationCoordinate2D, Error>?
    private var awaitingAuth = false

    enum LocationError: LocalizedError {
        case denied, unavailable
        var errorDescription: String? {
            switch self {
            case .denied: return "Izin lokasi ditolak. Aktifin di Settings › NEXUS › Location."
            case .unavailable: return "Lokasi gak kebaca. Pastiin GPS nyala & sinyalnya cukup."
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

    func currentFix() async throws -> CLLocationCoordinate2D {
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
        continuation?.resume(returning: loc.coordinate)
        continuation = nil
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        continuation?.resume(throwing: LocationError.unavailable)
        continuation = nil
    }
}
