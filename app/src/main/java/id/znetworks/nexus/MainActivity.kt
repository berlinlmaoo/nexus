package id.znetworks.nexus

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.runtime.getValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import id.znetworks.nexus.feature.auth.LoginScreen
import id.znetworks.nexus.ui.shell.SignedInShell
import id.znetworks.nexus.ui.theme.NexusTheme

/**
 * Single activity. AppCompat (not plain ComponentActivity) so the in-app language switch via
 * `AppCompatDelegate.setApplicationLocales` applies immediately, back to API 26.
 */
class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as NexusApplication).container
        setContent {
            val session by container.sessionStore.session.collectAsStateWithLifecycle()
            val current = session
            if (current == null) {
                LoginScreen()
            } else {
                NexusTheme {
                    SignedInShell(session = current, onSignOut = container.auth::signOut)
                }
            }
        }
    }
}
