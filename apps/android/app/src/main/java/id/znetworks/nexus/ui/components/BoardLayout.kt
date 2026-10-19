package id.znetworks.nexus.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.ui.theme.Nx

/** Shared phone lanes for project and ticket boards. */
@Composable
fun BoardColumns(state: LazyListState = rememberLazyListState(), content: LazyListScope.() -> Unit) {
    LazyRow(state = state, contentPadding = PaddingValues(12.dp), horizontalArrangement = Arrangement.spacedBy(10.dp), modifier = Modifier.fillMaxSize(), content = content)
}

@Composable
fun BoardLane(collapsed: Boolean = false, modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(modifier.width(if (collapsed) 64.dp else (LocalConfiguration.current.screenWidthDp - 48).dp.coerceIn(284.dp, 348.dp))
        .fillMaxHeight().clip(RoundedCornerShape(12.dp)).background(Nx.colors.muted.copy(alpha = 0.6f)).padding(8.dp), content = content)
}
