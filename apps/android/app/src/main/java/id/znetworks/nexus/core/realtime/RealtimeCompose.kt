package id.znetworks.nexus.core.realtime

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import id.znetworks.nexus.NexusApplication
import kotlinx.coroutines.awaitCancellation
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.conflate
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

@Composable
fun rememberRealtime(): Realtime = (LocalContext.current.applicationContext as NexusApplication).container.realtime

/** Sit in [room] (e.g. `project:<id>`) while this screen is on display and the app in front. */
@Composable
fun RealtimeRoom(room: String?) {
    val rt = rememberRealtime()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    LaunchedEffect(lifecycle, room) {
        if (room == null) return@LaunchedEffect
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            rt.join(room)
            try { awaitCancellation() } finally { rt.leave(room) }
        }
    }
}

/**
 * While on display: [refresh] on every matching ping and after a reconnect (a burst is folded into one),
 * plus fallback polling — every [liveMs] while connected, every [fallbackMs] while not; null = none.
 * A change of connection state restarts the wait, so a drop goes to the short pace at once.
 */
@Composable
@OptIn(kotlinx.coroutines.FlowPreview::class)
fun LiveRefresh(key: Any?, liveMs: Long?, fallbackMs: Long?, matches: (RealtimeEvent) -> Boolean,
                refreshOnResume: Boolean = false, debounceMs: Long = 0, refresh: suspend () -> Unit) {
    val rt = rememberRealtime()
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val match by rememberUpdatedState(matches)
    val run by rememberUpdatedState(refresh)
    LaunchedEffect(lifecycle, key) {
        lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            launch {
                rt.events.filter { it.name == RealtimeEvents.RECONNECTED || match(it) }
                    .debounce(debounceMs).conflate().collect { run(); delay(400) }
            }
            if (refreshOnResume) run()
            while (true) {
                val live = rt.connected
                val wait = (if (live) liveMs else fallbackMs) ?: Long.MAX_VALUE
                val changed = withTimeoutOrNull(wait) { rt.state.first { (it == Realtime.State.CONNECTED) != live } }
                if (changed == null) run()
            }
        }
    }
}
