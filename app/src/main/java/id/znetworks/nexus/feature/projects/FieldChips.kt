package id.znetworks.nexus.feature.projects

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import id.znetworks.nexus.core.net.NexusJson
import id.znetworks.nexus.ui.theme.Nx
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.text.NumberFormat
import java.time.format.DateTimeFormatter
import java.util.Locale

/** A custom-field value as a card chip (port of the web `customFieldChip`, iOS CustomFieldChips). */
data class FieldChip(val id: String, val label: String, val tone: Tone) {
    enum class Tone { NEUTRAL, SUCCESS, WARNING, DANGER, INFO }
}

object FieldChips {
    private val idr = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("id-ID")).apply {
        currency = java.util.Currency.getInstance("IDR"); maximumFractionDigits = 0
    }

    /** Web `cfStatusTone`. */
    fun statusTone(v: String): FieldChip.Tone {
        val s = v.lowercase().map { if (it == '_' || it == '-') ' ' else it }.joinToString("").split(' ').filter { it.isNotEmpty() }.joinToString(" ")
        return when (s) {
            "done", "complete", "completed", "selesai" -> FieldChip.Tone.SUCCESS
            "on progress", "in progress", "progress", "ongoing", "sedang berjalan" -> FieldChip.Tone.WARNING
            "blocked", "stuck", "terhambat" -> FieldChip.Tone.DANGER
            "not started", "todo", "to do" -> FieldChip.Tone.NEUTRAL
            else -> FieldChip.Tone.INFO
        }
    }

    /** A value stored as JSON text (older rows) or as JSON itself: both read the same. */
    private fun parsed(v: JsonElement?): JsonElement? = when {
        v is JsonPrimitive && v.isString -> v.content.trim().let { t ->
            if (t.startsWith("[") || t.startsWith("{")) runCatching { NexusJson.parseToJsonElement(t) }.getOrDefault(v) else v
        }
        else -> v
    }

    fun chip(v: CustomFieldValue): FieldChip? {
        val id = v.customFieldId ?: return null
        val type = v.customField?.type.orEmpty().uppercase()
        val value = parsed(v.value) ?: return null
        val raw = (value as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
        return when (type) {
            "NUMBER" -> {
                val digits = raw.filter { it.isDigit() }
                if (digits.isEmpty()) return null
                val currency = ((v.customField?.options as? JsonObject)?.get("format") as? JsonPrimitive)?.contentOrNull == "currency-idr"
                FieldChip(id, if (currency) digits.toLongOrNull()?.let { idr.format(it) } ?: raw else raw, FieldChip.Tone.NEUTRAL)
            }
            "STATUS" -> raw.takeIf { it.isNotEmpty() }?.let { FieldChip(id, it, statusTone(it)) }
            "MULTI_SELECT" -> when (value) {
                is JsonArray -> value.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.joinToString(", ")
                else -> raw
            }.takeIf { it.isNotEmpty() }?.let { FieldChip(id, it, FieldChip.Tone.NEUTRAL) }
            "PLACE" -> ((value as? JsonObject)?.get("label") as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotEmpty() }?.let { FieldChip(id, it, FieldChip.Tone.NEUTRAL) }
            "DATE", "CREATED" -> raw.takeIf { it.isNotEmpty() }?.let {
                FieldChip(id, dueDate(it)?.format(DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())) ?: it, FieldChip.Tone.NEUTRAL)
            }
            else -> (valueText(value) ?: raw).takeIf { it.isNotEmpty() }?.let { FieldChip(id, it, FieldChip.Tone.NEUTRAL) }
        }
    }
}

/** A wrapping row of a task's custom-field chips on board / list cards. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun FieldChipRow(values: List<CustomFieldValue>) {
    val chips = values.mapNotNull(FieldChips::chip)
    if (chips.isEmpty()) return
    val c = Nx.colors
    FlowRow(horizontalArrangement = Arrangement.spacedBy(5.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        chips.forEach { ch ->
            val fg: Color = when (ch.tone) {
                FieldChip.Tone.SUCCESS -> c.success; FieldChip.Tone.WARNING -> c.warning; FieldChip.Tone.DANGER -> c.danger
                FieldChip.Tone.INFO -> c.blue; FieldChip.Tone.NEUTRAL -> c.mutedFg
            }
            Text(ch.label, fontSize = 10.sp, fontWeight = FontWeight.SemiBold, color = fg, maxLines = 1,
                modifier = Modifier.background(fg.copy(alpha = 0.12f), CircleShape).padding(horizontal = 7.dp, vertical = 3.dp))
        }
    }
}
