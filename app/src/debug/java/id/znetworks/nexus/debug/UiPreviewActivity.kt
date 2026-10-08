package id.znetworks.nexus.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.verticalScroll
import id.znetworks.nexus.ui.shell.Tab
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.ui.Modifier
import id.znetworks.nexus.core.i18n.AppLanguage
import id.znetworks.nexus.core.session.Session
import id.znetworks.nexus.feature.auth.AccountScreen
import id.znetworks.nexus.feature.forms.Submission
import id.znetworks.nexus.feature.forms.SubmissionBoardView
import id.znetworks.nexus.feature.forms.Submissions
import id.znetworks.nexus.ui.shell.MoreScreen
import id.znetworks.nexus.ui.theme.NexusTheme
import id.znetworks.nexus.ui.theme.Nx

/**
 * Debug only: `adb shell am start -n id.znetworks.nexus/.debug.UiPreviewActivity --es screen more|account|board`.
 * Draws one screen with sample data so its layout can be checked on an emulator with nobody signed in.
 */
class UiPreviewActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        AppLanguage.apply(this)
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val screen = intent.getStringExtra("screen") ?: "more"
        setContent {
            NexusTheme {
                Box(Modifier.fillMaxSize().background(Nx.colors.background).safeDrawingPadding()) {
                    when (screen) {
                        "account" -> AccountScreen(onBack = {})
                        "nav8" -> Nav8Preview()
                        "restore" -> RestorePreview()
                        // Offboarding (8 Oct): the dialog never submits here (submit throws, nothing is posted).
                        "offboard" -> id.znetworks.nexus.feature.admin.OffboardDialog("Rina Saputri", "2025-02-03T02:00:00.000Z", onDismiss = {}, onOpenChart = {}, onDone = {}) { _, _, _ -> error("preview") }
                        "reinstate" -> id.znetworks.nexus.feature.admin.ReinstateDialog(id.znetworks.nexus.feature.admin.AdminUserRow("a", "Rina Saputri", deactivatedAt = "2026-10-08T09:00:00Z",
                            formerMemberships = listOf(id.znetworks.nexus.feature.admin.FormerMembership("w", "Z Networks", "2026-10-10T00:00:00.000Z", "RESIGNED"))), onDismiss = {}, onBack = {}) {}
                        "lefttags" -> androidx.compose.foundation.layout.Column(Modifier.padding(16.dp), verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(10.dp)) {
                            id.znetworks.nexus.ui.components.LeftTag("2026-10-10T00:00:00.000Z")
                            id.znetworks.nexus.ui.components.LeftTag("2026-10-10", compact = true)
                        }
                        "addpeople" -> id.znetworks.nexus.feature.chat.AddPeopleDialog(
                            id.znetworks.nexus.feature.chat.Conversation("c", "GROUP", "Tim Kreatif", members = listOf(id.znetworks.nexus.feature.chat.ChatMember(userId = "u1", user = id.znetworks.nexus.feature.chat.ChatUser("u1", "Rina")))),
                            listOf("u1" to "Rina", "u2" to "Dimas Pratama", "u3" to "Sari Wulandari", "u4" to "Bayu").map { (k, n) -> id.znetworks.nexus.feature.projects.RosterMember(userId = k, name = n) },
                            "me", onDismiss = {}, onAdd = {})
                        "board" -> SubmissionBoardView(sampleBoard, onOpen = {})
                        "composer" -> id.znetworks.nexus.feature.admin.AnnouncementComposer(
                            id.znetworks.nexus.feature.admin.AdminMoreApi((application as id.znetworks.nexus.NexusApplication).container.api), onDismiss = {}, onPosted = {})
                        "sp", "warning" -> {
                            val host = androidx.compose.runtime.remember {
                                id.znetworks.nexus.feature.inbox.AnnouncementHost(id.znetworks.nexus.feature.inbox.InboxApi((application as id.znetworks.nexus.NexusApplication).container.api)).also {
                                    it.queue.value = listOf(if (screen == "sp") id.znetworks.nexus.feature.inbox.Announcement("a", "Surat Peringatan 1", "Please read the attached letter.", kind = "sp",
                                        attachmentUrl = "/api/files/attachments/announcements/x.pdf", attachmentName = "SP1-Ana.pdf", authorName = "BoD")
                                    else id.znetworks.nexus.feature.inbox.Announcement("w", "Attendance warning", "Your check-out selfie on 27 September doesn't show your face.", kind = "warning"))
                                }
                            }
                            id.znetworks.nexus.feature.inbox.AnnouncementDialog(host)
                        }
                        "always" -> id.znetworks.nexus.feature.attendance.trail.AlwaysLocationDialog(onDismiss = {}, onReady = {})
                        "range" -> id.znetworks.nexus.feature.attendance.requests.LeaveRangeDialog(java.time.LocalDate.now().plusDays(1), java.time.LocalDate.now().plusDays(4),
                            java.time.LocalDate.now(), onPick = { _, _ -> }, onDismiss = {})
                        "org-edit", "org-person" -> {
                            val tree = androidx.compose.runtime.remember {
                                id.znetworks.nexus.feature.admin.orgchart.OrgTree(id.znetworks.nexus.core.net.NexusJson.decodeFromString(
                                    id.znetworks.nexus.feature.admin.orgchart.OrgChartData.serializer(), assets.open("org-chart-2026-10-05.json").bufferedReader().readText()))
                            }
                            val api = id.znetworks.nexus.feature.admin.orgchart.OrgChartApi((application as id.znetworks.nexus.NexusApplication).container.api)
                            val fa = tree.units.first { it.name == "Finance & Tech" }
                            if (screen == "org-edit") id.znetworks.nexus.feature.admin.orgchart.UnitSheet(tree, api, fa, fa.parentId, {}, {}, {}, {})
                            else id.znetworks.nexus.feature.admin.orgchart.PersonSheet(tree, api, tree.people.first { it.name?.startsWith("Mey") == true }, {}, {})
                        }
                        "org", "org-pats", "org-full" -> {
                            val tree = androidx.compose.runtime.remember {
                                id.znetworks.nexus.feature.admin.orgchart.OrgTree(id.znetworks.nexus.core.net.NexusJson.decodeFromString(
                                    id.znetworks.nexus.feature.admin.orgchart.OrgChartData.serializer(), assets.open("org-chart-2026-10-05.json").bufferedReader().readText()))
                            }
                            val pats = tree.units.first { it.name == "PATS" }.id
                            val mode = when (screen) { "org-pats" -> id.znetworks.nexus.feature.admin.orgchart.ChartMode.FOKUS; "org-full" -> id.znetworks.nexus.feature.admin.orgchart.ChartMode.LENGKAP; else -> id.znetworks.nexus.feature.admin.orgchart.ChartMode.RINGKAS }
                            id.znetworks.nexus.feature.admin.orgchart.ChartCanvas(tree, mode, if (screen == "org-pats") pats else null, 0,
                                androidx.compose.ui.Modifier.fillMaxSize(), onCard = {}, onPerson = {})
                        }
                        "cal-month", "cal-person", "cal-people", "cal-filters", "cal-tablet", "cal-loading", "cal-failed" -> {
                            val vm: id.znetworks.nexus.feature.calendar.CalendarViewModel = androidx.lifecycle.viewmodel.compose.viewModel()
                            val st = androidx.compose.runtime.remember { calState(screen) }
                            // The real shell puts an 80 dp NavigationBar under the Calendar on phones: keep that space here too (audit 2 #18).
                            androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxSize()) {
                                val phone = maxWidth < 600.dp
                                // ...and an 80 dp NavigationRail beside it from 600 dp.
                                androidx.compose.foundation.layout.Row(Modifier.fillMaxSize()) {
                                    if (!phone) Box(Modifier.fillMaxHeight().width(80.dp).background(Nx.colors.card))
                                    androidx.compose.foundation.layout.Column(Modifier.weight(1f).fillMaxHeight()) {
                                        Box(Modifier.weight(1f)) { id.znetworks.nexus.feature.calendar.CalendarPreviewLayout(st, vm, filters = screen == "cal-filters") }
                                        if (phone) Box(Modifier.fillMaxWidth().height(80.dp).background(Nx.colors.card))
                                    }
                                }
                            }
                        }
                        "pdf" -> id.znetworks.nexus.ui.components.PdfPages(samplePdf()) {}
                        else -> MoreScreen(Session("t", "c", "u", "Berlin Preview", "preview@example.com"), onLogout = {}, open = {}, onOpenWhatsNew = {})
                    }
                }
            }
        }
    }

    private val sampleBoard = Submissions(
        listOf(
            Submission("1", createdAt = "2026-09-20T12:14:00Z", formName = "Pengajuan Finance Management", projectName = "Finance", taskTitle = "Google AI Ultra", procStatus = "On Progress"),
            Submission("2", createdAt = "2026-09-20T12:12:00Z", formName = "Pengajuan Finance Management", projectName = "Finance", taskTitle = "ChatGPT Akun 1,2,3", procStatus = "On Progress"),
            Submission("3", createdAt = "2026-09-08T11:55:00Z", formName = "Pengajuan Finance Management", projectName = "Finance", taskTitle = "Claude API Balance", procStatus = "Done"),
            Submission("4", createdAt = "2026-09-07T09:58:00Z", formName = "Reimburse", projectName = "Finance", taskTitle = null),
        ),
        statusColumns = listOf("On Progress", "Done"),
    )

    /** A two-page PDF drawn on the device, for the in-app viewer. */
    private fun samplePdf(): java.io.File {
        val f = java.io.File(cacheDir, "sample.pdf")
        val doc = android.graphics.pdf.PdfDocument()
        repeat(2) { i ->
            val page = doc.startPage(android.graphics.pdf.PdfDocument.PageInfo.Builder(595, 842, i + 1).create())
            val p = android.graphics.Paint().apply { textSize = 28f }
            page.canvas.drawText("SURAT PERINGATAN — page ${i + 1}", 60f, 100f, p)
            page.canvas.drawRect(60f, 140f, 535f, 400f, android.graphics.Paint().apply { color = android.graphics.Color.rgb(230, 80, 80) })
            doc.finishPage(page)
        }
        f.outputStream().use { doc.writeTo(it) }; doc.close()
        return f
    }

    /** A Calendar state from the server golden files (18 Sep: BoD; 3 Oct: staff, Finance masked), at 5 Oct 12:00 WIB. */
    private fun calState(screen: String): id.znetworks.nexus.feature.calendar.CalState {
        val j = id.znetworks.nexus.core.net.NexusJson
        val structure0 = j.decodeFromString(id.znetworks.nexus.feature.calendar.CalStructure.serializer(),
            assets.open("calendar/structure.json").bufferedReader().readText().trim().let { "{\"access\":\"all\",${it.substring(1)}" })
        val gerald = structure0.people.first { it.name == "Geraldo Valentino" }
        val structure = structure0.copy(me = id.znetworks.nexus.feature.calendar.CalMe(gerald.userId, gerald.role, gerald.homeUnitIds))
        val sep = screen == "cal-person" || screen == "cal-people"
        val file = if (sep) "items-2026-09-18.bod.json" else "items-2026-10-03.staff.json"
        val day = if (sep) "2026-09-18" else "2026-10-03"
        val body = """{"today":"2026-10-05","now":"2026-10-05T05:00:00.000Z","access":"all","structureVersion":null,"rules":{"overdueWindowDays":14,"urgentDays":3},
            "items":${assets.open("calendar/$file").bufferedReader().readText()},"people":{},"holidays":[{"day":"2026-10-01","name":"Hari Kesaktian Pancasila"}],"truncated":false}"""
        val items = j.decodeFromString(id.znetworks.nexus.feature.calendar.CalItems.serializer(), body)
        // cal-loading / cal-failed: October's items held while November is on screen (audit P1).
        val other = screen == "cal-loading" || screen == "cal-failed"
        val people = screen == "cal-people"
        val loadedRange = if (people) id.znetworks.nexus.feature.calendar.CalendarCore.mondayOf(day).let { it to id.znetworks.nexus.feature.calendar.CalendarCore.addDays(it, 6) }
            else id.znetworks.nexus.feature.calendar.CalendarCore.gridRange(day)
        return id.znetworks.nexus.feature.calendar.CalState(structure = structure, items = items, loading = other, day = if (other) "2026-11-10" else day,
            itemsRange = loadedRange, rangeError = if (screen == "cal-failed") "No internet connection." else null,
            view = if (screen == "cal-people") id.znetworks.nexus.feature.calendar.CalView.PEOPLE else id.znetworks.nexus.feature.calendar.CalView.MONTH,
            lens = if (screen == "cal-person") id.znetworks.nexus.feature.calendar.CalLens.PERSON else id.znetworks.nexus.feature.calendar.CalLens.DIVISION)
    }
}

/** 8 Oct: the new tab bar (and its old-server fallback), More's badges, the crew board's
 *  "outside now" cell, the outside-approver inbox row, muted/unread conversations and links. */
@androidx.compose.runtime.Composable
private fun Nav8Preview() {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val badges = (ctx.applicationContext as id.znetworks.nexus.NexusApplication).container.badges
    androidx.compose.runtime.LaunchedEffect(Unit) { badges.setInbox(5); badges.setChat(12) }
    val inbox by badges.inboxUnread.collectAsStateWithLifecycle()
    val today = java.time.LocalDate.now()
    val days = (6 downTo 0).map { today.minusDays(it.toLong()) }
    val t = id.znetworks.nexus.feature.attendance.history.AttTone.PRESENT
    fun member(key: String, name: String, outside: Boolean) = id.znetworks.nexus.feature.attendance.history.BoardMember(
        key, name, days.associate { it.toString() to t },
        mapOf(today.toString() to id.znetworks.nexus.feature.attendance.history.HistoryRow(attendanceDate = today.toString(),
            checkInAt = today.atTime(8, 2).atZone(java.time.ZoneId.of("Asia/Jakarta")).toInstant().toString(),
            outsideSince = if (outside) today.atTime(10, 12).atZone(java.time.ZoneId.of("Asia/Jakarta")).toInstant().toString() else null)))
    val me = id.znetworks.nexus.feature.chat.ChatMember(userId = "me", user = id.znetworks.nexus.feature.chat.ChatUser("me", "Staff"))
    fun conv(key: String, name: String, unread: Int, muted: Boolean, text: String) = id.znetworks.nexus.feature.chat.Conversation(
        key, "GROUP", name, members = listOf(me), unreadCount = unread,
        mutedUntil = if (muted) "2099-01-01T00:00:00Z" else null,
        lastMessage = id.znetworks.nexus.feature.chat.Message("m$key", content = text, createdAt = java.time.Instant.now().toString(),
            user = id.znetworks.nexus.feature.chat.ChatUser("u", "Rina")))
    androidx.compose.foundation.layout.Column(Modifier.fillMaxSize()) {
        id.znetworks.nexus.ui.shell.ShellBar(id.znetworks.nexus.ui.shell.ShellTabs.routes(true).map { r -> Tab.entries.first { it.route == r } }, Tab.CALENDAR,
            { if (it == Tab.MORE) id.znetworks.nexus.core.Badges.label(inbox) else null }, rail = false) {}
        androidx.compose.foundation.layout.Spacer(Modifier.height(8.dp))
        id.znetworks.nexus.ui.shell.ShellBar(id.znetworks.nexus.ui.shell.ShellTabs.routes(false).map { r -> Tab.entries.first { it.route == r } }, Tab.HOME,
            { if (it == Tab.INBOX) id.znetworks.nexus.core.Badges.label(inbox) else null }, rail = false) {}
        id.znetworks.nexus.feature.attendance.history.Grid(listOf(member("a", "Rina", true), member("b", "Dimas", false)), days, today, { _, _ -> }, compact = false,
            modifier = Modifier.padding(12.dp).height(110.dp))
        id.znetworks.nexus.feature.inbox.InboxRow(id.znetworks.nexus.feature.inbox.InboxItem("i1", "attendance_outside_approver",
            "Rina is outside the office", "Since 10:12 · 2 hours", createdAt = java.time.Instant.now().toString())) {}
        id.znetworks.nexus.feature.chat.ConversationRow(conv("c1", "Tim Kreatif", 3, false, "📷 Foto"), "me") {}
        id.znetworks.nexus.feature.chat.ConversationRow(conv("c2", "Pengumuman kantor", 9, true, "Rapat jam 3"), "me") {}
        Box(Modifier.padding(12.dp).background(Nx.colors.card, androidx.compose.foundation.shape.RoundedCornerShape(18.dp)).padding(12.dp)) {
            androidx.compose.material3.Text(id.znetworks.nexus.feature.chat.highlight("@Dimas cek brief di https://nexus.znetworks.id/calendar ya", Nx.colors.violetText, Nx.colors.foreground), color = Nx.colors.foreground)
        }
        Box(Modifier.weight(1f)) { MoreScreen(Session("t", "c", "u", "Staff Preview", "preview@example.com"), onLogout = {}, open = {}, onOpenWhatsNew = {}) }
    }
}

/** 8 Oct: Restore in Control Room › Audit — pills, the card before and after, the error, the too-old note. Nothing is posted. */
@androidx.compose.runtime.Composable
private fun RestorePreview() {
    val e = id.znetworks.nexus.feature.admin.AuditEntry("a1", action = "delete", entityType = "project", entityId = "p1", entityName = "Rindu Alam Papua")
    val counts = id.znetworks.nexus.feature.admin.AuditRestoreCounts(lists = 7, tasks = 226, files = 155)
    val open = id.znetworks.nexus.feature.admin.AuditRestoreDetail(available = true, dataAsOf = "2026-10-07T19:00:00Z", fromBackup = true, counts = counts)
    val done = id.znetworks.nexus.feature.admin.AuditRestoreDetail(available = false, restoredAt = "2026-10-08T04:12:00Z",
        restoredBy = id.znetworks.nexus.feature.admin.AuditUser(name = "Berlin"), counts = counts)
    val task = e.copy(entityType = "task", entityName = "Brief konten")
    androidx.compose.foundation.layout.Column(Modifier.fillMaxSize().padding(16.dp).verticalScroll(androidx.compose.foundation.rememberScrollState()),
        verticalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(12.dp)) {
        androidx.compose.foundation.layout.Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
            id.znetworks.nexus.feature.admin.RestorePill(true); id.znetworks.nexus.feature.admin.RestorePill(false)
        }
        id.znetworks.nexus.feature.admin.RestoreCard(e, open, null, restoring = false, error = null, onRestore = {}, onOpenLink = { _, _ -> })
        id.znetworks.nexus.feature.admin.RestoreCard(task, open.copy(fromBackup = false, counts = id.znetworks.nexus.feature.admin.AuditRestoreCounts(tasks = 3, comments = 1)), null,
            restoring = true, error = androidx.compose.ui.res.stringResource(id.znetworks.nexus.R.string.au_err_parent_missing), onRestore = {}, onOpenLink = { _, _ -> })
        id.znetworks.nexus.feature.admin.RestoreCard(e, done, null, restoring = false, error = null, onRestore = {}, onOpenLink = { _, _ -> })
        id.znetworks.nexus.feature.admin.RestoreCard(task, open, id.znetworks.nexus.feature.admin.AuditRestoreResult(true, "task", "t1"), restoring = false, error = null, onRestore = {}, onOpenLink = { _, _ -> })
    }
}

