package id.znetworks.nexus.feature.social

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.outlet.OutletFormat
import kotlinx.serialization.json.*

@Composable
internal fun SocialOverview(d: SocialMonth) {
    val platforms = d.overview.rows("platforms")
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val columns = if (maxWidth >= 600.dp) 2 else 1
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            platforms.chunked(columns).forEach { row ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    row.forEach { SocialPlatformCard(it, Modifier.weight(1f)) }
                    if (row.size < columns) Spacer(Modifier.weight(1f))
                }
            }
        }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(stringResource(R.string.sm_contents), style = MaterialTheme.typography.titleMedium)
            platforms.forEach { platform ->
                Text(platform.text("name"))
                SocialMetric(platform, "posts", "postsTargetToDate", R.string.sm_posts)
            }
            Text(stringResource(R.string.sm_target_help), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable
private fun SocialPlatformCard(platform: JsonObject, modifier: Modifier) {
    Card(modifier) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(platform.text("name") + if (platform.flag("archived")) " · " + stringResource(R.string.sm_archived) else "", style = MaterialTheme.typography.titleMedium)
            SocialMetric(platform, "engagement", "engagementTargetToDate", R.string.sm_engagement)
            Text(if (platform.number("engagementTargetToDate") == null) stringResource(R.string.sm_no_engagement_target)
                else stringResource(R.string.sm_month_target, OutletFormat.count(platform.number("engagementTargetMonth"))))
            val values = (platform["trend"] as? JsonArray).orEmpty().map { (it as? JsonPrimitive)?.floatOrNull ?: 0f }
            val color = MaterialTheme.colorScheme.primary
            Canvas(Modifier.fillMaxWidth().height(40.dp)) {
                if (values.isNotEmpty()) {
                    val high = values.maxOrNull()?.coerceAtLeast(1f) ?: 1f
                    val path = Path()
                    values.forEachIndexed { i, n ->
                        val x = size.width * i / (values.size - 1).coerceAtLeast(1); val y = size.height * (1 - n / high)
                        if (i == 0) path.moveTo(x, y) else path.lineTo(x, y)
                    }
                    drawPath(path, color, style = Stroke(2.dp.toPx()))
                    path.lineTo(size.width, size.height); path.lineTo(0f, size.height); path.close()
                    drawPath(path, color.copy(alpha = 0.08f))
                }
            }
            listOf("views", "likes", "comments", "shares").chunked(2).forEach { pair ->
                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    pair.forEach { key -> Column(Modifier.weight(1f)) {
                        Text(stringResource(metricLabel(key)), style = MaterialTheme.typography.labelSmall)
                        Text(OutletFormat.count(platform.number(key)))
                    } }
                }
            }
        }
    }
}
