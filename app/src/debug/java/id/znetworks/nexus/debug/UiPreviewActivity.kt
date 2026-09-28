package id.znetworks.nexus.debug

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
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
}
