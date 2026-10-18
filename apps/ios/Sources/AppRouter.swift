import SwiftUI

/// The five destinations the phone's tab bar can show: Home · Tasks · Calendar · Projects · More.
/// The Calendar took Inbox's place (owner, 8 Oct 2026); while the server's `flags.calendar` holds the
/// Calendar back, Inbox keeps the slot. Inbox otherwise lives in More, which carries its unread count.
enum PhoneTab: Hashable {
    case dashboard, messages, calendar, inbox, projects, more
}

/// A destination that means nothing without an argument.
///
/// NXScreen is eighteen names with a String raw value, and it has to stay exactly that. The sidebar
/// tags its rows with it, `NXScreen(rawValue:)` is how `nexus://<name>` is resolved, and a Swift
/// enum carrying associated values cannot be RawRepresentable at all — so "the form with this id"
/// has no case to be. A form is the first destination in this app with a payload, so it gets a
/// small vocabulary of its own ALONGSIDE that enum rather than an eviscerating change inside it.
struct NXFormRequest: Identifiable, Hashable {
    /// A form id OR its slug. `/api/forms/{id}/public` resolves either, which is the whole reason
    /// the link people actually share can read `/f/pengajuan-finance-management` instead of a cuid.
    let id: String
}

/// A shared vault file somebody was sent, named by the slug in its link.
///
/// Its own type rather than a String for the same reason NXFormRequest is one: `.sheet(item:)` needs
/// something Identifiable, and a bare String would silently coalesce two different links that happen
/// to be presented in the same frame.
struct NXVaultRequest: Identifiable, Hashable {
    /// The opaque capability out of `/v/<slug>`. Never a file name, never a path — the server
    /// resolves what it points at and refuses if it has been revoked or has run out.
    let id: String
}

/// A sign-up link somebody's company handed out: `/register?code=A1B2C3D4E5F6`.
///
/// The id is fresh per tap rather than the code, so tapping the same link twice still reaches the
/// login screen's `onChange` — an Equatable request that compares equal to the last one would not.
struct NXSignupRequest: Identifiable, Hashable {
    let id = UUID()
    /// Already uppercased; may be empty, which still means "open sign-up".
    let code: String
}

/// A password-reset link: `/forgot-password?email=…&invited=1`, the link in the invite email
/// ("set your password"), or the same page linked by hand without `invited`.
///
/// Fresh id per tap for the same reason as NXSignupRequest. LoginView also builds one itself when
/// "Forgot password?" is tapped, so both ways in draw the same screen.
struct NXPasswordResetRequest: Identifiable, Hashable {
    let id = UUID()
    /// Prefill for the email field; may be empty.
    let email: String
    /// From an invite: the person has never had a password, so the screen says "Set your password".
    let invited: Bool
}

/// A record to draw as a sheet above whichever shape is mounted — see `AppRouter.detail`.
struct NXDetailRequest: Identifiable, Hashable {
    let target: NotificationTarget
    var id: String {
        switch target {
        case .reminders: return "reminders"
        case .meeting(let id):    return "meeting-" + id
        case .task(let id):       return "task-" + id
        case .project(let id):    return "project-" + id
        case .submission(let id): return "submission-" + id
        case .legalRequest(let id): return "legal-request-" + id
        default:                  return "other"
        }
    }
}

/// Where a project link asked its project to open: `/projects/{id}?view=form|calendar|board|overview
/// &event={id}&date=YYYY-MM-DD` — the Outlet Sales Dashboard's "Copy form link" (owner, 10 Oct 2026).
/// ProjectDetailView claims it once the project has loaded, and only for its own id.
struct NXProjectLink: Equatable {
    let projectId: String
    let view: String?
    let event: String?
    let date: String?
    /// `&form=<id>`: the form builder open on top of the project, as the web's `?form=` does.
    let form: String?

    /// nil when the link names no project, or carries none of the three (a plain project link).
    init?(path: String) {
        let items = URLComponents(string: path.hasPrefix("/") ? "https://nexus" + path : path)
        let parts = (items?.path ?? "").split(separator: "/").map(String.init)
        guard parts.count == 2, parts[0].lowercased() == "projects", !parts[1].isEmpty else { return nil }
        self.init(projectId: parts[1], query: items?.queryItems ?? [])
    }

    init?(projectId: String, query: [URLQueryItem]) {
        let value = { (k: String) -> String? in
            query.first { $0.name == k }?.value.flatMap { $0.isEmpty ? nil : $0 }
        }
        let view = (value("view") ?? value("v"))?.lowercased(), event = value("event"), date = value("date"), form = value("form")
        guard view != nil || event != nil || date != nil || form != nil else { return nil }
        self.projectId = projectId
        self.view = view
        self.event = event
        self.form = form
        self.date = date.flatMap { OutletFormat.parts($0) != nil && $0.count == 10 ? $0 : nil }
    }
}

/// The Calendar as it stands, carried over when the window crosses the size class: the day it shows,
/// Month or People, the division it is focused on, and the task open on top of it.
struct CalendarCarry: Equatable {
    var day: String
    var people: Bool
    var focusId: String?
    var taskId: String?
}

/// Where the app should go, when the instruction comes from outside the screen you are standing on.
///
/// Siri, a Shortcut, a tap on the Live Activity, a tap on a widget and a tap on a notification all
/// mean the same thing and must land in the same place. Routing them through one vocabulary is what
/// stops the fifth entry point from inventing its own idea of where "attendance" lives.
@MainActor
@Observable
final class AppRouter {
    /// A single instance, because App Intents run outside SwiftUI and have no environment to read.
    static let shared = AppRouter()

    var tab: PhoneTab = .dashboard

    /// Phone: the launcher screen to push inside the More tab, where everything that is not one of
    /// the four tab roots actually lives. Bound rather than fired-and-forgotten, so swiping back
    /// clears it and a second request works exactly like the first.
    var morePush: NXScreen?

    /// iPad and Mac: the screen the sidebar currently HAS selected, written by SidebarRoot.
    /// The phone answers the same question with `tab`. Both exist so something drawn above the
    /// whole app — the GIDEON launcher — can tell which screen it is sitting on top of, which no
    /// view in either layout is in a position to say.
    var sidebarScreen: NXScreen = .dashboard

    /// Whether Home is showing its own root, or has something pushed on top of it.
    ///
    /// `tab` and `sidebarScreen` only answer half the question. Home is a tab AND a NavigationStack,
    /// and Messages, Attendance, Leaderboard, Room Booking, Threads and the Calendar are all
    /// pushed INTO that stack by the quick-action tiles — so the tab never changes, and a launcher
    /// that reads only the tab rides along on top of a chat composer's own buttons.
    ///
    /// Written by DashboardView's root content rather than read off a `path` binding, because every
    /// push out of Home is a view-based `NavigationLink { … }`: those carry no value for a path to
    /// hold, so a bound path would report an empty stack on every one of them. Appearing and
    /// disappearing is the one signal that covers all of them, `.navigationDestination(item:)`
    /// included, and it costs one write per push rather than anything per frame.
    var homeIsRoot = true

    /// iPad and Mac: consumed once by the sidebar, then cleared. A request rather than a piece of
    /// state, so returning to a screen by hand is never undone by a stale flag.
    var sidebarRequest: NXScreen?

    /// A form somebody asked for from outside the app — a tapped `/f/…` link, almost always.
    ///
    /// Held here instead of pushed onto a tab, because it is not a screen this app navigates TO. It
    /// arrives with an argument, it is finished the moment it is submitted, and it has to behave
    /// identically whether the phone's tab bar or the iPad's sidebar happens to be mounted —
    /// `morePush` can do none of the three. RootView presents it above both shapes and clears this
    /// when the sheet closes.
    ///
    /// It is deliberately NOT cleared when the request cannot be served yet. A link tapped by
    /// somebody who is signed out opens the app on the login screen; the request waits there and
    /// the form appears by itself once they are in, rather than being thrown away by the very
    /// login it caused.
    var formRequest: NXFormRequest?

    /// A Z Vault file somebody shared, waiting to be shown. Same rules as `formRequest` in every
    /// respect, including the one that matters most: it is NOT cleared when the app is signed out,
    /// so a link tapped by somebody who has to log in first still opens once they are in.
    var vaultRequest: NXVaultRequest?

    /// Sign-up opened from a link, consumed (and cleared) by LoginView.
    ///
    /// The opposite rule to `formRequest`: only ever set while signed OUT. A form link survives the
    /// login it causes because the form is still wanted afterwards; a sign-up link tapped by
    /// somebody already in the app is simply not for them, and held here it would spring the
    /// sign-up screen on whoever next reaches the login screen — including the person who just
    /// deleted their account.
    var signupRequest: NXSignupRequest?

    /// Password reset opened from a link, consumed (and cleared) by LoginView. Signed-OUT only, for
    /// the same reasons as `signupRequest`: somebody already in the app who taps an invite link was
    /// invited into a workspace they can already reach, and has a password already.
    var passwordResetRequest: NXPasswordResetRequest?

    /// A record a notification pointed at, waiting for the screen that owns it to mount and claim it.
    ///
    /// A push about a leave request has to open THAT request, with Approve and Reject on it — not
    /// the Attendance screen with the request somewhere below the fold. The router walks to the
    /// screen (`go`) and leaves the id here; the screen reads it once its data is in, presents the
    /// record, and clears it. Held rather than fired, for the same reason as `formRequest`: a push
    /// tapped on a cold start arrives before any screen exists, and one tapped while signed out
    /// must survive the login it caused.
    var focus: NotificationTarget?
    var gideonAdminTab: String?

    /// A task, project or submission opened from a notification, drawn as a sheet above either
    /// shape. These three are not screens in the More launcher and have no tab of their own, so
    /// there is no stack to push them onto from here — the Inbox pushes them inside its own stack,
    /// and a push tap has no such stack in hand.
    var detail: NXDetailRequest?

    /// The tab, event and day a project link asked for (`NXProjectLink`), waiting for that project's
    /// screen. Held rather than fired, like `focus`.
    var projectLink: NXProjectLink?

    /// A project to open as a PAGE — pushed on the Projects tab, or selected in the iPad / Mac sidebar —
    /// rather than as the sheet `detail` draws. Claimed (and cleared) by ProjectsView on the phone and
    /// by the sidebar. The UI screenshot tour opens projects this way, so they look like they do
    /// when somebody taps one.
    var projectRequest: ProjectRef?

    /// What is actually on screen, written by the screens themselves (ProjectDetailView, FormBuilderView):
    /// the project id, its tab (ProjectTab raw value, lowercased) and an open form builder's form id.
    /// The UI tour checks these before it photographs a project, so a route that did not land is
    /// reported as the wrong screen instead of a picture of the Projects list.
    var projectOnScreen: String?
    var projectTabOnScreen: String?
    var formOnScreen: String?

    func openProjectPage(_ ref: ProjectRef) {
        // Not `go(.projects)`: that also asks the sidebar for the Projects list, and the sidebar would
        // then land on the list instead of the project.
        tab = .projects
        morePush = nil
        projectRequest = ref
    }

    /// The WIB day ("YYYY-MM-DD") a link asked the Calendar to open on: `/calendar?date=…` from a
    /// notification, or `nexus://calendar?date=…`. CalendarView reads it, jumps to that day and
    /// clears it. Held rather than fired, for the same reasons as `focus`: a link tapped on a cold
    /// start arrives before the screen exists, and the screen may already be on top when it does.
    var calendarLink: String?
    var calendarDate: String?
    /// The CalendarView instance on screen right now (it writes this in onAppear / onDisappear), so a
    /// date link makes the open Calendar jump instead of pushing a second one that opens on today.
    var calendarOnScreen: UUID?
    /// The task a calendar widget row was tapped on (`nexus://calendar?date=…&task=…`). CalendarView
    /// opens it the way its own rows open — editable, read-only or not at all — and clears it.
    var calendarTaskId: String?
    /// Whose tasks the link came from: `&scope=me|division|all`, the scope the tapped widget is set
    /// to. A "Mine" widget used to open the Calendar on Everyone, so the widget and the app told two
    /// different stories about the same day. CalendarView claims it the way it claims the date (it
    /// becomes the Calendar's own Show setting, on screen beside Month / People) and clears it.
    var calendarScope: String?
    /// The Calendar on screen as it stands, written by it as it changes. Read only when the window
    /// crosses the size class (`carryAcrossShapes`).
    var calendarState: CalendarCarry?
    /// Left by a size-class crossing with the Calendar on screen, for the Calendar the other shape
    /// builds; it claims it once, and only within a few seconds of `calendarCarryAt`.
    var calendarCarry: CalendarCarry?
    var calendarCarryAt: Date?
    /// When the Calendar last left the screen. The shape being swapped out takes the Calendar with it,
    /// and its onDisappear may run before AdaptiveRoot hears of the swap: a moment ago still counts.
    var calendarLeftAt: Date?

    /// One notification, wherever it was tapped: the Inbox row and the lock screen land in the same place.
    var meetingFile: URL?

    func open(_ target: NotificationTarget) {
        switch target {
        case .gideonPerformance:
            gideonAdminTab = "performance"
            go(.admin)
        case .screen(let screen):
            go(screen)
        case .reminders, .meeting, .task, .project, .submission, .legalRequest:
            detail = NXDetailRequest(target: target)
        case .legalBoard:
            focus = target
            go(.legal)
        case .attendanceRequest, .offsiteCheckout, .permitToday, .crewBoard, .complaint, .conversation, .announcement, .post:
            focus = target
            if let screen = target.hostScreen { go(screen) }
        case .calendarLink(let path):
            calendarLink = path
            if calendarOnScreen == nil { go(.teamCalendar) }
        case .calendarDay(let day):
            calendarDate = day
            if calendarOnScreen == nil { go(.teamCalendar) }
        }
    }

    /// A tapped push. The payload is the server's notification row without its id: `link`, `type`,
    /// `taskId`, `projectId` (src/lib/apns.ts) — plus the two the app schedules itself.
    func openNotification(_ info: [String: String]) {
        let value = { (k: String) -> String? in info[k].flatMap { $0.isEmpty ? nil : $0 } }
        if let id = value("meetingId") { open(.meeting(id)); return }
        if value("type") == "GIDEON_ALERT" { open(.gideonPerformance); return }
        if let id = value("taskId") { open(.task(id)); return }
        // A link into a project's tab (an outlet's report form) keeps its view, event and day.
        if let link = value("link").flatMap(NXProjectLink.init(path:)) {
            projectLink = link
            open(.project(link.projectId))
            return
        }
        if let id = value("projectId") { open(.project(id)); return }
        // "Budi is outside the office" (approvers, 8 Oct 2026): the crew board, where it shows —
        // not the top of the Attendance screen its "/attendance" link names. Same rule as the Inbox row.
        if value("type")?.lowercased() == NexusNotification.outsideApproverType { open(.crewBoard); return }
        // An external link — the App Store, for the "update NEXUS" reminder — leaves the app.
        if let link = value("link"), link.hasPrefix("http"), let url = URL(string: link) { UIApplication.shared.open(url); return }
        if let link = value("link"), let target = NotificationTarget(path: link) { open(target); return }
        let t = (value("type") ?? "").lowercased()
        if t.contains("attendance") || t.contains("offsite") || t.contains("checkout") { go(.attendance) }
        else if t.contains("message") { go(.messages) }
        else if t.contains("complaint") { go(.tickets) }
        else if t.contains("announcement") { go(.dashboard) }
        else { go(.inbox) }
    }

    /// The phone tab that IS this screen, or nil when the screen lives behind the More launcher.
    /// The Calendar has the third tab while the server's `flags.calendar` is on, Inbox otherwise
    /// (owner, 8 Oct 2026) — whichever does not have it is pushed inside More. Chat has the second
    /// tab and Tasks moved into More (owner, 9 Oct 2026).
    private func tabRoot(for screen: NXScreen) -> PhoneTab? {
        let calendarTab = RemoteConfig.shared.calendar
        switch screen {
        case .dashboard:    return .dashboard
        case .messages:     return .messages
        case .teamCalendar: return calendarTab ? .calendar : nil
        case .inbox:        return calendarTab ? nil : .inbox
        case .projects:     return .projects
        default:            return nil
        }
    }

    func go(_ screen: NXScreen) {
        // Both shapes are answered. Only the one on screen reacts, and the other's flag costs
        // nothing — far cheaper than asking this type which layout is currently mounted.
        if let root = tabRoot(for: screen) {
            tab = root
            // Otherwise a launcher screen pushed a moment ago stays on the More stack, and the tab
            // the person just asked for is the one thing they cannot see.
            morePush = nil
        } else {
            tab = .more
            morePush = screen
        }
        sidebarRequest = screen
    }

    /// The window crossed the size class — Split View, Slide Over, a narrow Stage Manager tile, an
    /// iPhone Plus or Max turned sideways — and AdaptiveRoot is rebuilding the app in its other shape.
    /// Both shapes start from nothing, so the person landed on Home: out of the Calendar and off the
    /// day they were on, once going into Split View and again coming out (impeccable re-audit, 7 Oct
    /// 2026). The new shape is told where they were instead, and a Calendar on screen leaves its day,
    /// view, focus and open task for the one the new shape builds.
    func carryAcrossShapes(toSidebar: Bool) {
        let screen = toSidebar ? phoneScreen : sidebarScreen
        if screen == .teamCalendar, let state = calendarState {
            calendarCarry = state
            calendarCarryAt = Date()
        }
        if toSidebar {
            sidebarRequest = screen
        } else if let root = tabRoot(for: screen) {
            tab = root
            morePush = nil
        } else {
            tab = .more
            morePush = screen
        }
    }

    /// The screen the tab bar is showing, as far as the router can tell: the Calendar wherever it was
    /// pushed (More, or Home's tiles), a launcher screen a request pushed, or the tab itself. The More
    /// launcher has no place in the sidebar, so Home stands in for it.
    private var phoneScreen: NXScreen {
        if calendarOnScreen != nil { return .teamCalendar }
        if let left = calendarLeftAt, Date().timeIntervalSince(left) < 1 { return .teamCalendar }
        switch tab {
        case .dashboard: return .dashboard
        case .messages:  return .messages
        case .calendar:  return .teamCalendar
        case .inbox:     return .inbox
        case .projects:  return .projects
        case .more:      return morePush ?? .dashboard
        }
    }

    /// Everything that arrives from outside the app comes through here.
    ///
    /// Two vocabularies, and they are not interchangeable. `nexus://attendance` is the app's own
    /// scheme, spoken by the widgets, the Live Activity and Shortcuts, and it names a SCREEN.
    /// `https://nexus.znetworks.id/f/…` is a Universal Link — a real web address that somebody was
    /// sent and tapped — and it names a form. The https half is why this no longer returns the
    /// moment the scheme is not `nexus`; that one guard was what dropped every tapped form link.
    func open(_ url: URL) {
        // Coalesced rather than switched as an Optional, and lowercased because a scheme is
        // case-insensitive by spec while a Swift string literal is not.
        switch (url.scheme ?? "").lowercased() {
        case "file":
            if MeetingUploads.extensions.contains(url.pathExtension.lowercased()) { meetingFile = url }
        case "nexus": openScheme(url)
        case "https": openWeb(url)
        default:      break
        }
    }

    /// `nexus://attendance`, and every other screen by its own name — the host is matched against
    /// NXScreen's raw values, so a screen added there is reachable by URL without touching this.
    private func openScheme(_ url: URL) {
        let name = url.host ?? url.pathComponents.first { $0 != "/" } ?? ""
        // Not a screen: there is nothing behind the login screen to navigate to while signed out.
        if name.lowercased() == "reminders" { open(.reminders); return }
        if name.lowercased() == "meetings", let id = url.pathComponents.first(where: { $0 != "/" }) { open(.meeting(id)); return }
        if name.lowercased() == "admin", URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "gideon" && $0.value == "performance" }) == true { open(.gideonPerformance); return }
        if name.lowercased() == "register" { requestSignup(from: url); return }
        if name.lowercased() == "forgot-password" { requestPasswordReset(from: url); return }
        // `nexus://attendance?permit=today` — the Live Activity's "File a permit" while outside the
        // office: the same prefilled composer the outside pushes open.
        if name.lowercased() == "attendance",
           URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.contains(where: { $0.name == "permit" && $0.value == "today" }) == true {
            open(.permitToday)
            return
        }
        // `nexus://calendar` is the Calendar's own name; `nexus://teamCalendar` (the screen's raw
        // value) keeps working for links written before 0.1.7. Either may name a day: `?date=YYYY-MM-DD`,
        // and a calendar widget's row a task as well: `&task=<id>` (an undated task: `?task=` alone).
        // A widget link also says whose tasks it showed: `&scope=me|division|all`; anything else is
        // ignored, so an older or hand-written link opens the Calendar as it was left.
        if name.lowercased() == "folders", let id = url.pathComponents.first(where: { $0 != "/" }) { open(.calendarLink("/calendar?folder=" + NativeAPI.escape(id))); return }
        if name.lowercased() == "calendar" || name.lowercased() == "teamcalendar" {
            if let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedQuery, query.contains("folder=") { open(.calendarLink("/calendar?" + query)); return }
            let query = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems
            let date = query?.first { $0.name == "date" }?.value
            if let task = query?.first(where: { $0.name == "task" })?.value, !task.isEmpty { calendarTaskId = task }
            if let scope = query?.first(where: { $0.name == "scope" })?.value?.lowercased(),
               ["me", "division", "all"].contains(scope) {
                calendarScope = scope
            }
            if let day = NotificationTarget.calendarDay(date) {
                open(.calendarDay(day))
            } else if calendarOnScreen == nil {
                go(.teamCalendar)
            }
            return
        }
        // `nexus://projects/<id>?view=form&event=…&date=…` — a project, on the tab the link names.
        if name.lowercased() == "projects" {
            let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
            let rest = url.pathComponents.filter { $0 != "/" }
            if let id = rest.first, !id.isEmpty {
                projectLink = NXProjectLink(projectId: id, query: comps?.queryItems ?? [])
                open(.project(id))
                return
            }
        }
        guard let screen = NXScreen(rawValue: name) else { return }
        go(screen)
    }

    /// `https://nexus.znetworks.id/f/<id-or-slug>` and `/v/<slug>` — the two web paths this app
    /// claims, and the only two.
    ///
    /// Narrow on purpose, in both directions. `Config.isNexusHost` rather than a suffix match, for
    /// exactly the reason it was written: a host that merely ENDS with the right letters belongs to
    /// whoever registered it. And two path shapes rather than a general web router, because the
    /// AASA claims `/f/*` and `/v/*` and nothing else — a handler that understood more than the app
    /// actually claims could only ever be dead code, while one that understood less would open the
    /// app onto whatever it was already showing.
    ///
    /// `/s/<slug>` — the EXTERNAL half of vault sharing — is deliberately absent from both this
    /// function and the AASA. Apple decides whether to open an app from the path alone, so a single
    /// prefix would mean a client with no account tapping a link and being handed a sign-in screen
    /// by an app they never installed on purpose. Two prefixes is how that distinction gets made.
    ///
    /// `pathComponents` arrives percent-DECODED, which is what the API client wants: it encodes the
    /// id once when it builds the request, so a slug with a space in it survives the round trip and
    /// nothing is ever double-encoded.
    private func openWeb(_ url: URL) {
        guard Config.isNexusHost(url) else { return }
        let parts = url.pathComponents.filter { $0 != "/" }
        // `/register?code=…`, the web's sign-up page. Only reachable here once the AASA claims
        // `/register`; until then Safari opens it on the web, which does the same job.
        if parts == ["register"] { requestSignup(from: url); return }
        // `/forgot-password?email=…&invited=1`, the invite email's "set your password" link. Same
        // caveat: the AASA does not claim `/forgot-password` yet, so today only the nexus://
        // spelling reaches this; the https one opens the web page, which does the same job.
        if parts == ["forgot-password"] { requestPasswordReset(from: url); return }
        // Exactly two: `/f/<id>` is a single segment on the web too (the SPA route is `/f/$formId`).
        // A deeper path under /f/ is not a form and must not be answered with somebody else's.
        guard parts.count == 2, !parts[1].isEmpty else { return }
        switch parts[0] {
        case "f": formRequest = NXFormRequest(id: parts[1])
        case "v": vaultRequest = NXVaultRequest(id: parts[1])
        default:  return
        }
    }

    /// Both spellings of the sign-up link end here. The Keychain rather than AuthStore, because the
    /// router has no AuthStore to ask — and the Keychain is what AuthStore itself restores from.
    private func requestSignup(from url: URL) {
        guard Keychain.load() == nil else { return }
        let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?.first { $0.name == "code" }?.value ?? ""
        signupRequest = NXSignupRequest(code: raw.trimmingCharacters(in: .whitespacesAndNewlines).uppercased())
    }

    /// Both spellings of the reset / set-your-password link. `invited` is read the way the web
    /// page's search params would be: "1" (or "true") means yes, anything else or absent means no.
    private func requestPasswordReset(from url: URL) {
        guard Keychain.load() == nil else { return }
        let items = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []
        let email = items.first { $0.name == "email" }?.value ?? ""
        let invitedRaw = items.first { $0.name == "invited" }?.value?.lowercased() ?? ""
        let invited = invitedRaw == "1" || invitedRaw == "true"
        passwordResetRequest = NXPasswordResetRequest(email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                                                      invited: invited)
    }
}
