package id.znetworks.nexus.debug

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MoreHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import id.znetworks.nexus.R
import id.znetworks.nexus.feature.pipeline.*
import id.znetworks.nexus.feature.projects.*
import id.znetworks.nexus.ui.components.BoardLane
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.json.*
import java.util.Locale

/** Production P1-P3 components with synthetic data only; no account or network request is used. */
@Composable
internal fun FixesLabelsPreview(screen: String, customTitle: String?) {
    val indonesian = Locale.getDefault().language in listOf("id", "in")
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when (screen) {
            "fixes-22oct-switcher" -> {
                val names = listOfNotNull(customTitle) + if (indonesian) listOf(
                    "Dashboard Pipeline Penjualan Perusahaan Internasional", "Perencanaan Pipeline Operasional Tahunan", "Semua Pipeline",
                ) else listOf("International Company Annual Sales Pipeline Dashboard", "Annual Operations Pipeline Planning", "All Pipelines")
                val boards = names.mapIndexed { index, name -> PipelineBoard("preview-$index", name, null, null, "ACTIVE", index + 2) }
                names.forEachIndexed { index, name ->
                    Text("P1 · ${index + 1}", color = Nx.colors.mutedFg, modifier = Modifier.padding(horizontal = 12.dp))
                    Box(Modifier.padding(horizontal = 12.dp).width(240.dp)) { PipelineBoardSwitcher(name, "preview-$index", boards) {} }
                }
                // A single long word is ellipsized only after the exact 75% font floor is reached.
                Box(Modifier.padding(horizontal = 12.dp).width(180.dp)) {
                    PipelineBoardSwitcher("InternationalForecastingPipelineCompany", "preview-0", boards) {}
                }
            }
            "fixes-22oct-kpis" -> {
                Text("P2", color = Nx.colors.mutedFg, modifier = Modifier.padding(horizontal = 12.dp))
                Kpis(PipelineSummary(buildJsonObject {
                    put("openValue", 145_000_000); put("weightedValue", 92_000_000); put("wonValue", 32_000_000)
                    put("receivable", 12_000_000); put("receivableOverdue", 1_000_000); put("realProfit", 8_000_000)
                    put("realCost", 24_000_000); put("openCount", 12); put("activeCount", 3); put("lostCount", 2)
                    put("costEligibleCount", 3); put("costDealCount", 3); put("criticalCount", 2); put("attentionCount", 4)
                    put("readyCount", 3); put("blockedCount", 1); put("deliverablesOnTrack", 8); put("deliverablesDone", 2)
                }))
            }
            else -> {
                StatusOptions.Group.entries.forEachIndexed { index, status ->
                    val name = statusGroupLabel(status)
                    val group = TaskGroup("preview-$index", name, listOf("gray", "blue", "green")[index], laneId = "preview-$index")
                    var collapsed by remember(index) { mutableStateOf(false) }
                    var action by remember(index) { mutableStateOf("") }
                    Text("P3 · ${status.name}", color = Nx.colors.mutedFg, modifier = Modifier.padding(horizontal = 12.dp))
                    Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 12.dp)) {
                        BoardLane(collapsed, Modifier.width(284.dp).height(130.dp)) {
                            GroupColumnHeader(group, name, if (index == 0) "123" else "8", collapsed, { collapsed = !collapsed },
                                options = { IconButton(onClick = { action = "options" }) { Icon(Icons.Filled.MoreHoriz, stringResource(R.string.col_options)) } },
                                onAdd = { action = "add" })
                            Text(action, color = Nx.colors.mutedFg)
                        }
                    }
                }
            }
        }
    }
}
