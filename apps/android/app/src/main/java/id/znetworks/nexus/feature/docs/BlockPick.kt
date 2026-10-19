package id.znetworks.nexus.feature.docs

import androidx.compose.runtime.Composable
import id.znetworks.nexus.feature.gideon.GPicker

/** Reuse the native searchable picker and present labels rather than stored operation keys. */
@Composable internal fun BlockPick(label: String, value: String?, options: List<Pair<String, String>>, enabled: Boolean = true, onPick: (String) -> Unit) {
    GPicker(label, options.firstOrNull { it.first == value }?.second, options, enabled, onPick)
}
