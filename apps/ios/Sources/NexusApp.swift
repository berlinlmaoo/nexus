import SwiftUI
import UIKit

@main
struct NexusApp: App {
    @UIApplicationDelegateAdaptor(NotificationAppDelegate.self) private var appDelegate
    @State private var auth = AuthStore()
    /// The shared instance, not a fresh one: App Intents run outside SwiftUI and can only reach the
    /// router through its static handle, so both sides have to be looking at the same object.
    @State private var router = AppRouter.shared
    @Environment(\.scenePhase) private var scenePhase
    /// Forced-update state. Shared, because APIClient raises it from a 426 outside SwiftUI.
    @State private var versionGate = AppVersionGate.shared

    init() {
        FontLoader.registerAll()
        Self.configureAppearance()
        // Activating publishes whatever is already in the Keychain, so a watch paired after signing
        // in catches up without waiting for the next login.
        PhoneSessionBridge.shared.activate()
    }

    var body: some Scene {
        WindowGroup {
            // The update gate goes ABOVE everything by replacing it. While `required` is set RootView
            // is not in the hierarchy at all, so no login, sign-up, splash, sheet or alert can draw
            // over the cover — removing the view that presented them dismisses them. See
            // UpdateRequiredView for why an overlay could not do this.
            ZStack {
                if let requirement = versionGate.required {
                    UpdateRequiredView(requirement: requirement)
                        .tint(NX.violetText)
                        .transition(.opacity)
                } else {
                    RootView()
                        // BEFORE .environment(auth), and the order is load-bearing: a ViewModifier's body
                        // runs in its PARENT's environment, not in the environment of the content it wraps.
                        // Put after, WhatsNewGate looks for AuthStore where nothing has put one — and a
                        // non-optional @Environment does not return nil there, it traps. The app opened on
                        // a black screen.
                        .whatsNew()
                        // Branch dev: an orange top edge while the app talks to the DEV server.
                        .overlay(alignment: .top) { DevServerBadge() }
                        .environment(auth)
                        .environment(router)
                        .tint(NX.violetText)
                        .hideMacWindowTitle()
                        // Siri, Shortcuts, the Live Activity and the widgets all arrive here as a URL
                        // — and so does a tapped Universal Link on iOS. AppRouter.open decides which of the
                        // two vocabularies (`nexus://` or `https://`) a URL is speaking.
                        .onOpenURL { router.open($0) }
                        // The Mac half of the same job, and BOTH are required.
                        //
                        // On iOS a browsing activity reaches a SwiftUI app through `.onOpenURL` and this
                        // modifier is never called. On Mac Catalyst it is the exact reverse: a universal
                        // link arrives as an NSUserActivity and `.onOpenURL` does not fire, which is why
                        // NEXUS-Catalyst.entitlements refused to claim `applinks:` at all until now — a
                        // claimed domain with no handler takes the link away from Safari and then does
                        // nothing with it, which is worse than not claiming it.
                        //
                        // Each platform calls exactly one of these two, so there is no double-open to
                        // guard against; the router is idempotent for the same URL either way.
                        .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                            if let url = activity.webpageURL { router.open(url) }
                        }
                        // The UI screenshot tour (Sources/TourDriver.swift); draws and does nothing otherwise.
                        .modifier(TourDriver(auth: auth, router: router))
                        .task(id: auth.readySession?.userId) {
                            // The tour's QA account must not register this device for pushes, start the
                            // work-hours trail or send queued check-ins: it is only here to be photographed.
                            if TourMode.isActive { return }
                            if let userId = auth.readySession?.userId {
                                await NotificationManager.shared.activate(userId: userId)
                                await APIClient.shared.sendUiLanguage(AppLanguage.shared.lang)
                                // The banner promises "sends itself when NEXUS is back". Until 0.1.5 the
                                // only thing that drained the queue was opening the Attendance screen.
                                await AttendanceQueue.shared.flush()
                                // Launch and sign-in: an open check-in from earlier today resumes
                                // the trail without the Attendance screen having to be opened.
                                await WorkLocationTracker.shared.reconcileFromServer()
                                await ProjectShortcuts.shared.syncPins()
                                // A fresh sign-in: the calendar widgets get this person's tasks now,
                                // not at the next throttled refresh.
                                await CalendarWidgetPresence.refresh(force: true)
                            }
                        }
                        .onChange(of: scenePhase) { _, phase in
                            // Before the signed-in guard: a signed-out phone needs to learn it is too old
                            // just as much. Throttled inside to once per 30 minutes; the launch check
                            // below is the forced one.
                            if phase == .active { Task { await versionGate.checkPolicy() } }
                            if phase == .active { Task { await RemoteConfig.shared.refresh() } }
                            // A pin made on the web or another device shows up when the app comes back.
                            // On the way out, which is the only moment iOS will accept the request: an app
                            // in the foreground is not a candidate for either window.
                            if phase == .background { BackgroundRefresh.schedule() }
                            guard phase == .active else { return }
                            Task {
                                await auth.refreshIdentity()
                                guard let userId = auth.readySession?.userId else { return }
                                await ProjectShortcuts.shared.syncPins()
                                if TourMode.isActive { return }
                                await NotificationManager.shared.reconcileReminders(userId: userId)
                                await AttendanceQueue.shared.flush()
                                await WorkLocationTracker.shared.reconcileFromServer()
                                await CalendarWidgetPresence.refresh()
                            }
                        }
                        // The "why NEXUS wants Always location" sheet, on a host of its own so it
                        // never shares a view with another `.sheet`.
                        .background { if !TourMode.isActive { WorkLocationPromptHost() } }
                }
            }
            .animation(.easeInOut(duration: 0.25), value: versionGate.required)
            // The once-a-day "update by <date>" alert. On the root, beside the lock rather than
            // inside RootView, because it is about the app, not about any one screen.
            .graceWarningNotice()
            // Once per launch, forced: the floor may have moved while the app was closed, and
            // finding out here beats finding out from the first refused request.
            .task { await versionGate.checkPolicy(force: true) }
            .task { await RemoteConfig.shared.refresh(force: true) }
            // The realtime connection (Sources/Realtime) follows the session and whether the app is in
            // front: open while signed in and active (on the Mac, while a window is visible), closed in
            // the background and on sign-out. Here on the outer stack rather than on RootView, so it
            // keeps following both while the update gate stands in RootView's place.
            .onChange(of: scenePhase, initial: true) { _, phase in
                RealtimeClient.shared.reconcile(session: auth.readySession, phase: phase)
            }
            .onChange(of: auth.session?.token, initial: true) { _, _ in
                RealtimeClient.shared.reconcile(session: auth.readySession, phase: scenePhase)
            }
            .onChange(of: auth.session?.userId) { _, _ in
                RealtimeClient.shared.reconcile(session: auth.readySession, phase: scenePhase)
            }
            .onChange(of: auth.identityReady, initial: true) { _, _ in
                RealtimeClient.shared.reconcile(session: auth.readySession, phase: scenePhase)
            }
        }
        // The Calendar's keyboard commands, as a Calendar menu (CalendarView.swift): in the menu bar on
        // the Mac and from iPadOS 26, in the ⌘ overlay on earlier iPads. The iPhone shows no menu; the
        // Calendar binds its shortcuts there itself (CalendarKeys).
        .commands {
            CalendarMenuCommands()
        }
        #if targetEnvironment(macCatalyst)
        // ⌘T is Today on the Mac, as in Apple's Calendar. The Mac's stock Format › Font menu claims it
        // for Show Fonts, which nothing in this app uses (no text in it can be styled).
        .commands {
            CommandGroup(replacing: .textFormatting) { }
        }
        #endif
    }

    /// Global navigation/tab chrome — match the web: rounded display title, NEXUS background.
    private static func configureAppearance() {
        let bg = UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: 0x11141b) : UIColor(rgb: 0xf8f9fb) }

        let nav = UINavigationBarAppearance()
        nav.configureWithOpaqueBackground()
        nav.backgroundColor = bg
        nav.shadowColor = .clear
        nav.largeTitleTextAttributes = [.font: UIFont.systemFont(ofSize: 32, weight: .heavy)]
        nav.titleTextAttributes = [.font: UIFont.systemFont(ofSize: 17, weight: .bold)]
        UINavigationBar.appearance().standardAppearance = nav
        UINavigationBar.appearance().scrollEdgeAppearance = nav
        UINavigationBar.appearance().compactAppearance = nav

        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = bg
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }
}

extension View {
    /// Mac: no "NEXUS By Z" title bar above the app (owner, 29 Sep 2026). The sidebar already says
    /// where you are, and the bar only took a strip off the top. The traffic lights stay.
    func hideMacWindowTitle() -> some View {
        #if targetEnvironment(macCatalyst)
        return onAppear {
            for scene in UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }) {
                scene.titlebar?.titleVisibility = .hidden
                scene.titlebar?.toolbar = nil
            }
        }
        #else
        return self
        #endif
    }
}
