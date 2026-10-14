package id.znetworks.nexus.ui.components

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.NexusApplication
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.projects.TabEmpty

/** Whether the viewer is in the company workspace: null while unknown (then company-only things stay hidden). */
@Composable
fun rememberIsCompany(): Boolean? {
    val viewer = (LocalContext.current.applicationContext as NexusApplication).container.viewer
    val v by produceState(viewer.isCompany) { viewer.load(); value = viewer.isCompany }
    return v
}

/**
 * Z Vault and Threads are the company's (owner, 29 Sep 2026; iOS 14b086f): a link or a route to them
 * outside the company workspace shows "Only for Z Networks" instead (the server refuses them with 403).
 */
@Composable
fun CompanyOnly(onBack: () -> Unit, content: @Composable () -> Unit) {
    when (rememberIsCompany()) {
        true -> content()
        null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        false -> Column(Modifier.fillMaxSize()) {
            IconButton(onClick = onBack, modifier = Modifier.padding(4.dp)) { Icon(Icons.AutoMirrored.Filled.ArrowBack, stringResource(R.string.back)) }
            Box(Modifier.fillMaxWidth().weight(1f), contentAlignment = Alignment.Center) { TabEmpty(Icons.Filled.Lock, stringResource(R.string.company_only)) }
        }
    }
}
