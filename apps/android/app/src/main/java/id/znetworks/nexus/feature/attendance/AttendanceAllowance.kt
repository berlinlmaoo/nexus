package id.znetworks.nexus.feature.attendance

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.theme.Nx

@Composable internal fun AttendanceAllowance(today: AttendanceToday?, grantId: String, onClose: () -> Unit) {
    AlertDialog(onDismissRequest = onClose, title = { Text(stringResource(R.string.qa_dayoff_allowance)) }, text = {
        Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (today == null) CircularProgressIndicator()
            else {
                today.dayOffAllowance?.period?.let { Text(it, color = Nx.colors.mutedFg) }
                today.dayOffQuota?.let { quota -> Text(stringResource(R.string.qa_dayoff_current, (quota - (today.dayOffUsedThisMonth ?: 0)).coerceAtLeast(0), quota)) }
                val grants = today.dayOffAllowance?.grants.orEmpty()
                if (grants.isEmpty()) Text(stringResource(R.string.qa_dayoff_no_bonus), color = Nx.colors.mutedFg)
                grants.forEach { grant -> Column(Modifier.fillMaxWidth().background(if (grant.id == grantId) Nx.colors.accentBg else Nx.colors.card, RoundedCornerShape(8.dp)).padding(10.dp)) {
                    grant.days?.let { Text(stringResource(R.string.qa_dayoff_bonus_days, it)) }
                    grant.reason?.takeIf { it.isNotBlank() }?.let { Text(it, color = Nx.colors.mutedFg) }
                } }
            }
        }
    }, confirmButton = { TextButton(onClick = onClose) { Text(stringResource(R.string.au_close)) } })
}
