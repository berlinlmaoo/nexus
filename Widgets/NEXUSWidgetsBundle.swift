import WidgetKit
import SwiftUI

/// Everything this extension provides. Home Screen and Lock Screen widgets land here too when they
/// arrive; for now the work session is the only member.
@main
struct NEXUSWidgetsBundle: WidgetBundle {
    var body: some Widget {
        WorkSessionLiveActivity()
    }
}
