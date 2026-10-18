package id.znetworks.nexus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont

/**
 * The house empty state (iOS `EmptyState`): icon + title + WHY it is empty + the next step, with
 * an action button. `Text("No data")` is not acceptable anywhere (owner, 21 Sep 2026), so
 * [actionLabel] and [onAction] are required.
 */
@Composable
fun EmptyState(
    icon: ImageVector,
    title: String,
    message: String,
    actionLabel: String,
    onAction: () -> Unit,
    modifier: Modifier = Modifier,
    actionEnabled: Boolean = true,
) {
    val c = Nx.colors
    // Calm, as the dev web's EmptyState (12 Oct 2026): one muted glyph in a soft circle, a plain title, the
    // reason, and the next step as the page's primary button (near-black, rounded 8).
    Column(
        modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 40.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(Modifier.size(44.dp).background(c.muted, CircleShape), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = c.mutedFg, modifier = Modifier.size(20.dp))
        }
        Spacer(Modifier.height(12.dp))
        Text(title, fontFamily = TextFont, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, color = c.foreground, textAlign = TextAlign.Center)
        Spacer(Modifier.height(4.dp))
        Text(message, fontFamily = TextFont, fontSize = 14.sp, color = c.mutedFg, textAlign = TextAlign.Center, lineHeight = 20.sp)
        Spacer(Modifier.height(16.dp))
        NxButton(actionLabel, onAction, kind = NxButtonKind.PRIMARY, enabled = actionEnabled)
    }
}
