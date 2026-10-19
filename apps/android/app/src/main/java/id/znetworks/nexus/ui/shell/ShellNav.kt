package id.znetworks.nexus.ui.shell

import id.znetworks.nexus.R

/**
 * The app's destinations in the dev web's sidebar order (components/AppSidebar.tsx + MobileTabBar.tsx More
 * sheet, 13 Oct 2026): Home · Work · Team · System. One list drives both the phone's More page and the
 * sidebar on wide screens, so the two never drift. Reports and Forms are appended to Work as iOS does (the
 * web reaches them elsewhere); What's New stays under System (the app's own release notes).
 */
internal object ShellNav {
    enum class Group(val label: Int) {
        HOME(R.string.nav_group_home), WORK(R.string.nav_group_work), TEAM(R.string.nav_group_team), SYSTEM(R.string.nav_group_system),
    }

    enum class Badge { NONE, INBOX, CHAT }

    /**
     * One entry. [route] is the NavHost route ("" = an action the shell handles, What's New); [tab] marks the
     * entries that are bottom-bar tabs, so they are switched to rather than pushed.
     */
    enum class Item(val group: Group, val label: Int, val route: String, val tab: Boolean = false, val companyOnly: Boolean = false,
                    val managersOnly: Boolean = false, val badge: Badge = Badge.NONE, val legalOnly: Boolean = false) {
        DASHBOARD(Group.HOME, R.string.nav_dashboard, "home", tab = true),
        MESSAGES(Group.HOME, R.string.mt_messages, "messages", tab = true, badge = Badge.CHAT),
        GIDEON(Group.HOME, R.string.nav_gideon, "gideon"),
        NOTIFICATIONS(Group.HOME, R.string.nav_notifications, "inbox", badge = Badge.INBOX),
        THREADS(Group.HOME, R.string.mt_threads, "threads", companyOnly = true),
        VAULT(Group.HOME, R.string.mt_vault, "vault?folder=&trash=", companyOnly = true),
        MY_TASKS(Group.HOME, R.string.nav_my_tasks, "tasks"),
        SUBMISSIONS(Group.HOME, R.string.mt_submissions, "submissions"),
        CALENDAR(Group.HOME, R.string.mt_calendar, "calendar", tab = true),
        ROOMS(Group.HOME, R.string.mt_rooms, "rooms", companyOnly = true),
        PROJECTS(Group.WORK, R.string.nav_projects, "projects", tab = true),
        // Invitation only (owner, 14 Oct 2026): drawn when the roster says canAccessLegal; the server refuses the rest.
        LEGAL(Group.WORK, R.string.lg_title, "legal", legalOnly = true),
        LEADERBOARD(Group.WORK, R.string.mt_leaderboard, "leaderboard"),
        REPORTS(Group.WORK, R.string.mt_reports, "reports"),
        FORMS(Group.WORK, R.string.mt_forms, "forms"),
        ATTENDANCE(Group.TEAM, R.string.mt_attendance, "attendance"),
        TICKETS(Group.SYSTEM, R.string.nav_tickets, "tickets"),
        SETTINGS(Group.SYSTEM, R.string.nav_settings, "account"),
        WHATS_NEW(Group.SYSTEM, R.string.mt_whats_new, ""),
        CONTROL_ROOM(Group.SYSTEM, R.string.mt_control, "admin", managersOnly = true),
    }

    /**
     * What this person sees, grouped in order. Company-only entries wait until the workspace is known
     * ([company] null = not known yet, hidden); Control Room is for Manager and above (the server re-checks).
     * With the server's calendar flag off the Calendar is not offered and Notifications is a tab. Legal is drawn
     * only for the people invited to it ([legal]).
     */
    fun groups(company: Boolean?, canAdmin: Boolean, calendarOn: Boolean, legal: Boolean = false): List<Pair<Group, List<Item>>> =
        Item.entries
            .filter { !it.companyOnly || company == true }
            .filter { !it.legalOnly || legal }
            .filter { !it.managersOnly || canAdmin }
            .filter { it != Item.CALENDAR || calendarOn }
            .groupBy { it.group }
            .toList()
            .sortedBy { it.first.ordinal }

    /** The entry a route belongs to, for the sidebar's selected row ("vault?folder=…" is Z Vault). */
    fun itemOf(route: String?): Item? {
        val base = route?.substringBefore('?')?.substringBefore('/') ?: return null
        return when (base) {
            "chat", "chat-info", "chat-media", "chat-search" -> Item.MESSAGES
            "project", "form-builder", "folder" -> Item.PROJECTS
            "ticket" -> Item.TICKETS
            "submission" -> Item.SUBMISSIONS
            "report" -> Item.REPORTS
            "form" -> Item.FORMS
            "team-calendar", "calendar-list" -> Item.CALENDAR
            "admin-user", "admin-chart", "org-chart", "admin-att", "admin-offices", "audit", "admin-team" -> Item.CONTROL_ROOM
            "vault-share" -> Item.VAULT
            "legal-doc", "legal-new", "legal-upload", "legal-template", "legal-template-new", "legal-request", "legal-request-links", "legal-invite" -> Item.LEGAL
            "legal-request-form", "my-legal-request" -> Item.SUBMISSIONS
            else -> Item.entries.firstOrNull { it.route.isNotEmpty() && it.route.substringBefore('?') == base }
        }
    }
}
