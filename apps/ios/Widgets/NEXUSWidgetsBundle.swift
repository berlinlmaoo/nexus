import WidgetKit
import SwiftUI

/// Everything this extension provides.
@main
struct NEXUSWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WorkSessionLiveActivity()
        AttendanceWidget()
        // The calendar's eleven widgets come in two bundles of their own: a WidgetBundle builder takes
        // at most ten, and folding each bundle's body in keeps this list short however they grow.
        CalendarHomeWidgets().body
        CalendarLockWidgets().body
    }
}
