import WidgetKit
import SwiftUI

/// Everything this extension provides.
@main
struct NEXUSWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WorkSessionLiveActivity()
        AttendanceWidget()
    }
}
