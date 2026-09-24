package id.znetworks.nexus

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.feature.auth.LoginScreen
import id.znetworks.nexus.ui.shell.SignedInShell
import id.znetworks.nexus.ui.theme.NexusTheme
import id.znetworks.nexus.ui.update.GraceNoticeDialog
import id.znetworks.nexus.ui.update.UpdateRequiredScreen
import kotlinx.coroutines.launch

/**
 * Single activity. AppCompat (not plain ComponentActivity) so the in-app language switch via
 * `AppCompatDelegate.setApplicationLocales` applies immediately, back to API 26.
 */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as NexusApplication).container
        val gate = container.versionGate
        setContent {
            val session by container.sessionStore.session.collectAsStateWithLifecycle()
            val gateState by gate.state.collectAsStateWithLifecycle()
            val scope = rememberCoroutineScope()
            val current = session

            // A sign-in re-reads the policy at once, as on iOS.
            LaunchedEffect(current?.userId) { if (current != null) gate.checkPolicy(force = true) }

            when {
                // The lock wins over everything, signed in or not.
                gateState.required != null -> NexusTheme {
                    UpdateRequiredScreen(gateState, onCheckAgain = { scope.launch { gate.checkPolicy(force = true) } })
                }
                current == null -> LoginScreen()
                else -> NexusTheme {
                    SignedInShell(session = current, gateState = gateState, onSignOut = container.auth::signOut)
                    val grace = gateState.grace
                    if (gateState.graceNoticeDue && grace != null) {
                        GraceNoticeDialog(grace, gateState.storeUrl, onDismiss = gate::graceNoticeSeen)
                    }
                }
            }
        }
    }
}
