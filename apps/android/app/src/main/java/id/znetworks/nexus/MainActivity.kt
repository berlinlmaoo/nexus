package id.znetworks.nexus

import android.content.Intent
import android.os.Bundle
import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.feature.update.UpdateFlowHost
import id.znetworks.nexus.feature.inbox.InboxApi
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.zIndex
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.res.stringResource
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
        // English unless the person chose Indonesian (owner, 29 Sep): never the phone's language.
        id.znetworks.nexus.core.i18n.AppLanguage.apply(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        val container = (application as NexusApplication).container
        val gate = container.versionGate
        route(intent)
        runTour(intent)
        setContent {
            val session by container.sessionStore.session.collectAsStateWithLifecycle()
            val gateState by gate.state.collectAsStateWithLifecycle()
            val queueState by container.attendanceQueue.state.collectAsStateWithLifecycle()
            val theme by container.appearance.theme.collectAsStateWithLifecycle()
            val scope = rememberCoroutineScope()
            val current = session

            // A sign-in re-reads the policy at once, as on iOS.
            LaunchedEffect(current?.userId) { if (current != null) gate.checkPolicy(force = true) }

            // The in-app update's progress, over the lock screen or the app.
            NexusTheme(theme) { UpdateFlowHost() }
            when {
                // The lock wins over everything, signed in or not.
                gateState.required != null -> NexusTheme(theme) {
                    UpdateRequiredScreen(
                        gateState,
                        onCheckAgain = { scope.launch { gate.checkPolicy(force = true) } },
                        // The lock screen carries a line about taps held for the update (REQ-ATT-43).
                        heldMessage = if (queueState.isHeldForUpdate) stringResource(R.string.held_body) else null,
                    )
                }
                current == null -> LoginScreen()
                else -> NexusTheme(theme) {
                    androidx.compose.runtime.key(current.userId) { SignedInShell(session = current, gateState = gateState, onSignOut = container.auth::signOut) }
                    val grace = gateState.grace
                    if (gateState.graceNoticeDue && grace != null) {
                        GraceNoticeDialog(grace, gateState.storeUrl, onDismiss = gate::graceNoticeSeen)
                    }
                }
            }
            // The DEV server (DEV-REDESIGN.md) is marked on every screen, drawn last so it sits on top, signed in or not.
            if (id.znetworks.nexus.core.net.NexusConfig.env == id.znetworks.nexus.core.net.ServerEnv.DEV) androidx.compose.foundation.layout.Box(
                androidx.compose.ui.Modifier.fillMaxSize().statusBarsPadding().zIndex(10f),
                contentAlignment = androidx.compose.ui.Alignment.TopCenter,
            ) { id.znetworks.nexus.ui.components.DevBadge() }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        route(intent)
        runTour(intent)
    }

    /**
     * The UI tour (DEBUG only, scripts/ui-tour-android.sh): sign out, sign in on the DEV server, or open one screen
     * (the shell opens [TourMode.go]); every outcome is a NEXUS_TOUR logcat line the script waits for.
     */
    private fun runTour(intent: Intent?) {
        id.znetworks.nexus.core.tour.TourMode.read(intent, BuildConfig.DEBUG)
        val tour = id.znetworks.nexus.core.tour.TourMode
        if (!tour.active) return
        val container = (application as NexusApplication).container
        // The tour always talks to the DEV server: switched once (saved), then the script launches again.
        if (tour.wantsDev && id.znetworks.nexus.core.net.NexusConfig.env != id.znetworks.nexus.core.net.ServerEnv.DEV) {
            id.znetworks.nexus.core.net.ServerEnvStore.save(this, id.znetworks.nexus.core.net.ServerEnv.DEV)
            tour.status("server-switched")
            finishAffinity(); Runtime.getRuntime().exit(0)
            return
        }
        when (tour.step) {
            "session" -> container.appScope.launch {
                // Reuse the QA runner's single login. This file is written through run-as into the
                // debug app's private directory, consumed once, and never put into intent extras/logs.
                val file = java.io.File(filesDir, "tour-login.json")
                if (!BuildConfig.DEBUG || !tour.wantsDev || id.znetworks.nexus.core.net.NexusConfig.env != id.znetworks.nexus.core.net.ServerEnv.DEV) return@launch
                try {
                    val login = id.znetworks.nexus.core.net.NexusJson.decodeFromString(id.znetworks.nexus.feature.auth.LoginResponse.serializer(), file.readText())
                    container.auth.signedInWith(login)
                    tour.status("signed-in")
                } catch (_: Exception) { tour.status("session-import-failed") }
                finally { file.delete() }
            }
            "signout" -> {
                if (container.sessionStore.current != null) container.auth.signOut()
                container.appScope.launch { kotlinx.coroutines.delay(2500); tour.status("signed-out") }
            }
            "login" -> container.appScope.launch {
                if (container.sessionStore.current != null) { tour.status("signed-in"); return@launch }
                try {
                    container.auth.login(tour.email.orEmpty(), tour.password.orEmpty())
                    kotlinx.coroutines.delay(2000); tour.status("signed-in")
                } catch (e: Exception) {
                    tour.status("login-failed " + (e.message ?: e::class.java.simpleName).replace('\n', ' '))
                }
            }
            else -> if (container.sessionStore.current == null) tour.status("not-signed-in")
        }
    }

    /**
     * `nexus://…` links and notification taps (extras `type`, `link`, `taskId`, `projectId`).
     * The router holds the target until its screen claims it, across a sign-in if need be.
     */
    private fun route(intent: Intent?) {
        intent ?: return
        val router = (application as NexusApplication).container.router
        val data = intent.data
        val target = when {
            data != null -> Links.parse(data.toString())
            intent.hasExtra(EXTRA_TYPE) || intent.hasExtra(EXTRA_LINK) -> Links.forNotification(
                intent.getStringExtra(EXTRA_TYPE), intent.getStringExtra(EXTRA_LINK),
                intent.getStringExtra(EXTRA_TASK_ID), intent.getStringExtra(EXTRA_PROJECT_ID),
            )
            else -> null
        }
        target?.let(router::open)
        // A tapped push marks its inbox row read, as the inbox does.
        intent.getStringExtra(EXTRA_NOTIFICATION_ID)?.let { id ->
            val c = (application as NexusApplication).container
            c.appScope.launch { runCatching { InboxApi(c.api).markRead(id) } }
        }
        intent.removeExtra(EXTRA_NOTIFICATION_ID)
        // Handled once: a configuration change must not replay it.
        intent.data = null
        intent.removeExtra(EXTRA_TYPE)
        intent.removeExtra(EXTRA_LINK)
    }

    companion object {
        const val EXTRA_TYPE = "type"
        const val EXTRA_LINK = "link"
        const val EXTRA_TASK_ID = "taskId"
        const val EXTRA_PROJECT_ID = "projectId"
        const val EXTRA_NOTIFICATION_ID = "notificationId"
    }
}
