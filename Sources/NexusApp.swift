import SwiftUI

@main
struct NexusApp: App {
    @State private var auth = AuthStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(auth)
                .tint(Brand.violet)
        }
    }
}
