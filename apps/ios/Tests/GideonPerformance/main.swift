import Foundation
let path = CommandLine.arguments[1]
var data = try JSONDecoder().decode(GideonPerformanceData.self, from: Data(contentsOf: URL(fileURLWithPath: path)))
precondition(data.tiers.map(\.id) == ["astra", "luna", "terra", "experimental"])
precondition(data.hours.count == 24)
precondition(data.quality.thumbsDown == nil)
precondition(data.alerts.count == 4)
precondition(data.telemetryStale(at: Date.distantFuture))
if let live = data.live {
    data.accept(live: live)
    precondition(!data.telemetry.stale)
    precondition(data.telemetry.lastAt == live.at)
    precondition(!data.telemetryStale(at: NativeDate.parse(live.at)!))
    precondition(data.telemetryStale(at: NativeDate.parse(live.at)!.addingTimeInterval(181)))
}
print("Performance live payload, null metrics, string/numeric alerts and telemetry age checks passed")
