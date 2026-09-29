package id.znetworks.nexus.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.ui.unit.dp
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
                        "leave" -> {
                            var picked by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(setOf(java.time.LocalDate.of(2026, 10, 1), java.time.LocalDate.of(2026, 10, 2), java.time.LocalDate.of(2026, 10, 6))) }
                            androidx.compose.foundation.layout.Column(androidx.compose.ui.Modifier.padding(16.dp)) {
                                id.znetworks.nexus.feature.attendance.requests.MultiDatePicker(picked, { d -> picked = id.znetworks.nexus.feature.attendance.requests.MultiDateLogic.toggle(picked, d, 4).first })
                                androidx.compose.material3.Text("${picked.size} / 4 · " + id.znetworks.nexus.feature.attendance.requests.MultiDateLogic.blocks(picked).joinToString())
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
}
