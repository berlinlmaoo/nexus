package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.KeyboardArrowRight
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.constrainHeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.R
import id.znetworks.nexus.ui.components.WordBoundaryLayout
import id.znetworks.nexus.ui.components.rememberWordMeasure
import id.znetworks.nexus.ui.theme.Nx
import id.znetworks.nexus.ui.theme.TextFont

/** Status/count have priority over the actions; every action retains its full 48 dp target. */
@Composable
internal fun GroupColumnHeader(g: TaskGroup, label: String, calc: String?, collapsed: Boolean, onToggle: () -> Unit,
    options: (@Composable () -> Unit)? = null, onAdd: (() -> Unit)? = null) {
    val c = Nx.colors
    val measureLabel = rememberWordMeasure(TextStyle(fontFamily = TextFont, fontSize = (if (g.colorKey == null) 14 else 13).sp,
        fontWeight = if (g.colorKey == null) FontWeight.SemiBold else FontWeight.Medium))
    val measureCount = rememberWordMeasure(TextStyle(fontSize = 12.sp, fontFamily = TextFont))
    Layout(modifier = Modifier.fillMaxWidth().padding(horizontal = if (collapsed) 0.dp else 4.dp, vertical = 2.dp), content = {
        Box { if (!collapsed) GroupPill(g, label, calc) }
        Row(verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onToggle) { Icon(if (collapsed) Icons.Filled.KeyboardArrowRight else Icons.AutoMirrored.Filled.KeyboardArrowLeft,
                stringResource(if (collapsed) R.string.expand else R.string.collapse), tint = c.mutedFg) }
            if (!collapsed) {
                options?.invoke()
                if (onAdd != null) IconButton(onClick = onAdd) { Icon(Icons.Filled.Add, stringResource(R.string.pp_new_task), tint = c.mutedFg) }
            }
        }
    }) { children, constraints ->
        val actions = children[1].measure(constraints.copy(minWidth = 0, minHeight = 0))
        val compact = (constraints.maxWidth - actions.width).coerceAtLeast(0)
        val chrome = (if (g.colorKey == null) 0.dp else 29.dp).toPx() + if (calc == null) 0f else measureCount(calc) + 8.dp.toPx()
        val below = !collapsed && !WordBoundaryLayout.fits(label, compact - chrome, 2, measureLabel)
        val width = if (below) constraints.maxWidth else compact
        val chip = children[0].measure(Constraints(minWidth = width, maxWidth = width, maxHeight = constraints.maxHeight))
        val topHeight = if (below) chip.height else maxOf(chip.height, actions.height)
        layout(constraints.maxWidth, constraints.constrainHeight(topHeight + if (below) actions.height else 0)) {
            chip.placeRelative(0, (topHeight - chip.height) / 2)
            actions.placeRelative(constraints.maxWidth - actions.width, if (below) topHeight else (topHeight - actions.height) / 2)
        }
    }
}
