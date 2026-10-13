package id.znetworks.nexus.feature.projects

import androidx.compose.ui.graphics.Color

/**
 * A project's sections are its status options and its board columns (dev web lib/status-options.ts, iOS
 * StatusOptions.swift). "To Do / On Progress / Done" are only section names: nothing here is hard-coded to them.
 */
object StatusOptions {
    enum class Group { TODO, IN_PROGRESS, COMPLETE }

    fun groupOf(taskStatus: String?): Group = when (taskStatus?.uppercase()) {
        "IN_PROGRESS", "IN_REVIEW" -> Group.IN_PROGRESS
        "DONE", "CANCELLED" -> Group.COMPLETE
        else -> Group.TODO
    }

    /** Any section with a status: the project uses status options (else the legacy look, plain sections). */
    fun inUse(lanes: List<Lane>) = lanes.any { it.taskStatus != null }

    /** By group, then position, then the original order; legacy projects keep the position order. */
    fun ordered(lanes: List<Lane>): List<Lane> {
        val indexed = lanes.withIndex().toList()
        return if (!inUse(lanes)) indexed.sortedWith(compareBy({ it.value.position ?: Int.MAX_VALUE }, { it.index })).map { it.value }
        else indexed.sortedWith(compareBy({ groupOf(it.value.taskStatus).ordinal }, { it.value.position ?: Int.MAX_VALUE }, { it.index })).map { it.value }
    }

    /** Where a new task starts: the first To-do option, else the first. */
    fun defaultOption(lanes: List<Lane>): Lane? {
        val o = ordered(lanes)
        return o.firstOrNull { inUse(lanes) && groupOf(it.taskStatus) == Group.TODO && it.taskStatus != null } ?: o.firstOrNull()
    }

    private val ALIASES = mapOf("sky" to "blue", "emerald" to "green", "amber" to "yellow", "rose" to "red", "violet" to "purple", "slate" to "gray", "grey" to "gray")
    val KEYS = listOf("gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red")

    /** A colour key: the option's own, normalised, else by its status. */
    fun colorKey(color: String?, taskStatus: String?): String {
        val k = color?.trim()?.lowercase()?.let { ALIASES[it] ?: it }
        if (k != null && k in KEYS) return k
        return when (taskStatus?.uppercase()) {
            "IN_PROGRESS" -> "blue"; "IN_REVIEW" -> "yellow"; "DONE" -> "green"; "CANCELLED" -> "red"; else -> "gray"
        }
    }

    /** One palette entry (Notion's nine): the lane tint, the pill fill, the text on it, the dot. */
    data class Tone(val lane: Color, val bg: Color, val fg: Color, val dot: Color)

    private fun c(hex: Long) = Color(0xFF000000 or hex)

    private val LIGHT = mapOf(
        "gray" to Tone(c(0xf9f9f8), c(0xe3e2e0), c(0x32302c), c(0x91918e)),
        "brown" to Tone(c(0xfbf8f6), c(0xeee0da), c(0x44291d), c(0x9f6b53)),
        "orange" to Tone(c(0xfdf6f0), c(0xfadec9), c(0x49290e), c(0xd9730d)),
        "yellow" to Tone(c(0xfcf8ec), c(0xfbecc8), c(0x402c1b), c(0xcb912f)),
        "red" to Tone(c(0xfdf5f4), c(0xffe2dd), c(0x5d1715), c(0xd44c47)),
        "green" to Tone(c(0xf5f9f4), c(0xdbeddb), c(0x1c3829), c(0x448361)),
        "blue" to Tone(c(0xf3f8fb), c(0xd3e5ef), c(0x183347), c(0x337ea9)),
        "purple" to Tone(c(0xf9f6fb), c(0xe8deee), c(0x412454), c(0x9065b0)),
        "pink" to Tone(c(0xfcf5f8), c(0xf5e0e9), c(0x4c2337), c(0xc14c8a)),
    )
    private val DARK_DOT_FG = mapOf(
        "gray" to (0x9b9a97L to 0xc9c8c5L), "brown" to (0xa27763L to 0xdfab95L), "orange" to (0xd9730dL to 0xffa344L),
        "yellow" to (0xcb912fL to 0xffdc49L), "red" to (0xff7369L to 0xff9d96L), "green" to (0x4dab9aL to 0x7dd3b8L),
        "blue" to (0x529ccaL to 0x8cc4ecL), "purple" to (0x9a6dd7L to 0xc7a6f0L), "pink" to (0xe255a1L to 0xf19bc9L),
    )

    fun tone(key: String, dark: Boolean): Tone {
        val k = if (key in KEYS) key else "gray"
        if (!dark) return LIGHT.getValue(k)
        val (dot, fg) = DARK_DOT_FG.getValue(k)
        val d = c(dot)
        return Tone(lane = d.copy(alpha = 0.07f), bg = d.copy(alpha = 0.22f), fg = c(fg), dot = d)
    }

    /** "Kategori" / "Category" / "Kategori 2": the select field the old sections became (12 Oct). */
    private val CATEGORY = Regex("^(kategori|category)( \\d+)?$", RegexOption.IGNORE_CASE)
    fun isCategory(f: CustomFieldDef) = f.kind == "SELECT" && CATEGORY.matches(f.name.trim())

    /** An option's colour key: `optionColors[value]`, else the palette minus gray/brown by index, else hashed. */
    fun optionColor(f: CustomFieldDef, value: String): String {
        val own = (f.options as? kotlinx.serialization.json.JsonObject)?.get("optionColors")
            ?.let { it as? kotlinx.serialization.json.JsonObject }?.get(value)
            ?.let { (it as? kotlinx.serialization.json.JsonPrimitive)?.content }
        if (own != null) return colorKey(own, null)
        val rot = KEYS.drop(2)
        val i = f.choices.indexOf(value)
        return if (i >= 0) rot[i % rot.size] else rot[Math.floorMod(value.hashCode(), rot.size)]
    }

    /** The status a new option in [group] gets from its name (web rule). */
    fun statusFor(group: Group, name: String): String = when (group) {
        Group.TODO -> "TODO"
        Group.IN_PROGRESS -> if (Regex("review|revisi|approval|\\bcek\\b|check|\\bqc\\b", RegexOption.IGNORE_CASE).containsMatchIn(name)) "IN_REVIEW" else "IN_PROGRESS"
        Group.COMPLETE -> if (Regex("cancel|batal|gagal", RegexOption.IGNORE_CASE).containsMatchIn(name)) "CANCELLED" else "DONE"
    }
}
