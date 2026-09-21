import WidgetKit
import SwiftUI

/// Everything the watch-face extension provides.
@main
struct NEXUSWatchWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WatchAttendanceWidget()
    }
}
