package id.znetworks.nexus.feature.outlet

import id.znetworks.nexus.core.i18n.AppLanguage
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

/*
 * Outlet Sales Dashboard (the OUTLET-SALES handoff spec, owner 10 Oct 2026): one project = one outlet,
 * events per night with a report, and the month's typed targets. The server works out every total, percent and
 * status; this file only reads them (leniently, like the pipeline) and writes them the way the outlet team asked.
 */

internal fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull && it.isString }?.content
internal fun JsonElement?.num(): Double? = (this as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { it.doubleOrNull ?: it.content.toDoubleOrNull() }
private fun JsonElement?.obj() = this as? JsonObject

object OutletStatus {
    const val UPCOMING = "UPCOMING"
    const val WAITING = "WAITING_REPORT"
    const val REPORTED = "REPORTED"
}

data class OutletPerson(val id: String?, val name: String?) {
    companion object { fun of(e: JsonElement?) = e.obj()?.let { OutletPerson(it["id"].str(), it["name"].str()) } }
}

/** One night. Numbers are null when not filled (0 is a real zero); texts are "" when empty. */
data class OutletEvent(val raw: JsonObject) {
    val id get() = raw["id"].str().orEmpty()
    val date get() = raw["date"].str().orEmpty().take(10)
    val name get() = raw["name"].str().orEmpty()
    fun number(key: String): Double? = when {
        key.startsWith("value:") -> (raw["values"] as? JsonObject)?.get(key.removePrefix("value:")).num() ?: raw[key.removePrefix("value:")].num()
        key.startsWith("community:") -> (raw["communityTotals"] as? JsonObject)?.get(key.removePrefix("community:")).num()
        else -> raw[key].num()
    }
    fun text(key: String): String = raw[key].str().orEmpty()
    val sales get() = number("sales")
    val pax get() = number("pax")
    val salesTarget get() = number("salesTarget")
    val paxTarget get() = number("paxTarget")
    val salesPct get() = number("salesPct")?.toInt()
    val paxPct get() = number("paxPct")?.toInt()
    val rsvpTotal get() = number("rsvpTotal")
    val hostingTotal get() = number("hostingTotal")
    val status get() = raw["status"].str() ?: OutletStatus.UPCOMING
    val missing: List<String> get() = (raw["missing"] as? JsonArray).orEmpty().mapNotNull { it.str() }
    val reportedAt get() = raw["reportedAt"].str()
    val reportedBy get() = OutletPerson.of(raw["reportedBy"])
    val updatedAt get() = raw["updatedAt"].str()
    val updatedBy get() = OutletPerson.of(raw["updatedBy"])
    val isReported get() = status == OutletStatus.REPORTED
}

data class OutletTarget(val raw: JsonObject) {
    val month get() = raw["month"].str().orEmpty()
    val salesTarget get() = raw["salesTarget"].num()
    val paxTarget get() = raw["paxTarget"].num()
    val updatedBy get() = OutletPerson.of(raw["updatedBy"])
}

data class OutletSummary(val raw: JsonObject) {
    private fun n(k: String) = raw[k].num()
    val sales get() = n("sales") ?: 0.0
    val pax get() = n("pax") ?: 0.0
    val salesTarget get() = n("salesTarget")
    val paxTarget get() = n("paxTarget")
    val salesPct get() = n("salesPct")?.toInt()
    val paxPct get() = n("paxPct")?.toInt()
    val eventCount get() = n("eventCount")?.toInt() ?: 0
    val reportedCount get() = n("reportedCount")?.toInt() ?: 0
    val waitingCount get() = n("waitingCount")?.toInt() ?: 0
    val upcomingCount get() = n("upcomingCount")?.toInt() ?: 0
    val rsvpTotal get() = n("rsvpTotal")
    val hostingTotal get() = n("hostingTotal")
}

/** GET …/outlet-sales?month=: the month, its events, older nights still waiting, and the form. */
data class OutletMonth(val raw: JsonObject) {
    val canManageTargets get() = (raw["canManageTargets"] as? JsonPrimitive)?.booleanOrNull == true
    val month get() = raw["month"].str().orEmpty()
    val today get() = raw["today"].str()
    val target get() = raw["target"].obj()?.let(::OutletTarget)
    val summary get() = OutletSummary(raw["summary"].obj() ?: JsonObject(emptyMap()))
    val events: List<OutletEvent> get() = list("events")
    val waitingEarlier: List<OutletEvent> get() = list("waitingEarlier")
    val form get() = raw["form"].obj()?.let(OutletForm::of)?.takeIf { it.sections.isNotEmpty() } ?: OutletForm.DEFAULT
    private fun list(k: String) = (raw[k] as? JsonArray).orEmpty().mapNotNull { e -> e.obj()?.let(::OutletEvent)?.takeIf { it.id.isNotEmpty() } }

    /** Every night waiting for its report, this month's and older ones, oldest first. */
    val allWaiting get() = (waitingEarlier + events.filter { it.status == OutletStatus.WAITING }).distinctBy { it.id }.sortedBy { it.date }
}

data class OutletText(val en: String, val id: String) {
    fun pick(indonesian: Boolean) = if (indonesian) id.ifBlank { en } else en.ifBlank { id }
    companion object {
        fun of(e: JsonElement?) = e.obj()?.let { OutletText(it["en"].str().orEmpty(), it["id"].str().orEmpty()) }
            ?: e.str()?.let { OutletText(it, it) }
    }
}

data class OutletField(val key: String, val type: String, val label: OutletText, val required: Boolean, val max: Double?, val hint: OutletText?) {
    val isNumber get() = type == "money" || type == "count"
}

data class OutletSection(val key: String, val title: OutletText, val total: String?, val fields: List<OutletField>)

/** The report form, drawn from the server's `form` (§5). Unknown field types are left out. */
data class OutletForm(val sections: List<OutletSection>) {
    val fields get() = sections.flatMap { it.fields }
    fun field(key: String) = fields.firstOrNull { it.key == key }

    companion object {
        val TYPES = setOf("text", "date", "money", "count", "longtext")

        fun of(o: JsonObject) = OutletForm((o["sections"] as? JsonArray).orEmpty().mapNotNull { s ->
            val so = s.obj() ?: return@mapNotNull null
            val fields = (so["fields"] as? JsonArray).orEmpty().mapNotNull { f ->
                val fo = f.obj() ?: return@mapNotNull null
                val key = fo["key"].str() ?: return@mapNotNull null
                val type = fo["type"].str()?.takeIf { it in TYPES } ?: return@mapNotNull null
                OutletField(key, type, OutletText.of(fo["label"]) ?: OutletText(key, key), (fo["required"] as? JsonPrimitive)?.booleanOrNull == true,
                    fo["max"].num()?.takeIf { it > 0 }, OutletText.of(fo["hint"]))
            }
            OutletSection(so["key"].str().orEmpty(), OutletText.of(so["title"]) ?: OutletText("", ""), so["total"].str(), fields).takeIf { fields.isNotEmpty() }
        })

        /** The server's OUTLET_FORM v1, for a response without one. */
        val DEFAULT: OutletForm by lazy { of(NexusJson.parseToJsonElement(DEFAULT_JSON) as JsonObject) }

        private const val DEFAULT_JSON = """{"version":1,"sections":[
{"key":"event","title":{"en":"Event","id":"Event"},"fields":[
 {"key":"name","type":"text","label":{"en":"Event name","id":"Nama event"},"required":true,"max":120},
 {"key":"date","type":"date","label":{"en":"Day/Date","id":"Hari/Tanggal"},"required":true,"max":0}]},
{"key":"sales","title":{"en":"Sales","id":"Sales"},"fields":[
 {"key":"sales","type":"money","label":{"en":"Sales","id":"Sales"},"max":1e12,"hint":{"en":"Total revenue, after tax, service charge and discounts","id":"Total revenue, setelah pajak, service charge & diskon"}},
 {"key":"salesTarget","type":"money","label":{"en":"Sales target","id":"Target sales"},"max":1e12}]},
{"key":"pax","title":{"en":"Pax","id":"Pax"},"fields":[
 {"key":"pax","type":"count","label":{"en":"Pax","id":"Pax"},"max":1000000,"hint":{"en":"People who actually came","id":"Jumlah orang yang datang"}},
 {"key":"paxTarget","type":"count","label":{"en":"Pax target","id":"Target pax"},"max":1000000}]},
{"key":"rsvp","title":{"en":"RSVP – TOTAL","id":"RSVP – TOTAL"},"total":"rsvpTotal","fields":[
 {"key":"rsvpWalkIn","type":"count","label":{"en":"Walk-in RSVP","id":"Walk-in RSVP"}},
 {"key":"rsvpTeam","type":"count","label":{"en":"RSVP Team","id":"RSVP Team"}},
 {"key":"rsvpPr","type":"count","label":{"en":"RSVP PR","id":"RSVP PR"}},
 {"key":"rsvpEo","type":"count","label":{"en":"RSVP EO","id":"RSVP EO"}}]},
{"key":"hosting","title":{"en":"HOSTING – TOTAL","id":"HOSTING – TOTAL"},"total":"hostingTotal","fields":[
 {"key":"hostingTeam","type":"count","label":{"en":"Hosting Team","id":"Hosting Team"}},
 {"key":"hostingPr","type":"count","label":{"en":"Hosting PR","id":"Hosting PR"}},
 {"key":"hostingEo","type":"count","label":{"en":"Hosting EO","id":"Hosting EO"}}]},
{"key":"success","title":{"en":"What worked","id":"Hal yang berhasil"},"fields":[
 {"key":"successWhat","type":"longtext","label":{"en":"What","id":"Apa"},"max":2000},
 {"key":"successWhy","type":"longtext","label":{"en":"Why it worked","id":"Kenapa berhasil"},"max":2000},
 {"key":"successRepeat","type":"longtext","label":{"en":"How to make it happen again","id":"Gimana biar bisa terulang lagi"},"max":2000}]},
{"key":"fail","title":{"en":"What didn't work","id":"Hal yang gagal"},"fields":[
 {"key":"failWhat","type":"longtext","label":{"en":"What","id":"Apa"},"max":2000},
 {"key":"failWhy","type":"longtext","label":{"en":"Why it didn't work","id":"Kenapa gagal"},"max":2000},
 {"key":"failPrevent","type":"longtext","label":{"en":"How to keep it from happening again","id":"Gimana biar tidak kejadian lagi"},"max":2000}]}]}"""
    }
}

/** Numbers, rupiah, days and months in the outlet team's shapes (§6), in the app's language. */
object OutletFormat {
    fun isId(locale: Locale = Locale.getDefault()) = locale.language == "in" || locale.language == "id"
    private fun loc(id: Boolean) = if (id) Locale.forLanguageTag("id-ID") else AppLanguage.ENGLISH_FORMATS

    /** 3.000 (ID) / 3,000 (EN); null → "—". */
    fun count(v: Double?, id: Boolean = isId()): String {
        if (v == null) return "—"
        val s = String.format(Locale.US, "%,d", v.toLong())
        return if (id) s.replace(',', '.') else s
    }

    /** Rp8.000.000 (ID) / Rp8,000,000 (EN), no decimals, no space; null → "—". */
    fun money(v: Double?, id: Boolean = isId()) = if (v == null) "—" else "Rp" + count(v, id)

    /** floor(actual × 100 / target); null without a target or an actual. */
    fun pct(actual: Double?, target: Double?): Int? =
        if (actual == null || target == null || target <= 0.0) null else Math.floor(actual * 100.0 / target).toInt()

    /**
     * "Rp8.000.000 / Rp20.000.000 (40%)". No target → the actual alone; a target but no actual → "— / Rp20.000.000".
     * [pct] is the server's when it sent one.
     */
    fun vsTarget(actual: Double?, target: Double?, money: Boolean, id: Boolean = isId(), pct: Int? = pct(actual, target)): String {
        val f: (Double?) -> String = { if (money) money(it, id) else count(it, id) }
        if (target == null) return f(actual)
        if (actual == null) return "— / ${f(target)}"
        return "${f(actual)} / ${f(target)}" + (pct?.let { " ($it%)" } ?: "")
    }

    fun parseDate(iso: String?): LocalDate? = iso?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }

    /** "Minggu, 4 Oktober" / "Sunday, 4 October"; the year only when it isn't [thisYear]. */
    fun longDay(iso: String, thisYear: Int, id: Boolean = isId()): String {
        val d = parseDate(iso) ?: return iso
        val l = loc(id)
        val wd = d.dayOfWeek.getDisplayName(TextStyle.FULL, l).replaceFirstChar { it.titlecase(l) }
        val mo = d.month.getDisplayName(TextStyle.FULL, l).replaceFirstChar { it.titlecase(l) }
        return "$wd, ${d.dayOfMonth} $mo" + if (d.year != thisYear) " ${d.year}" else ""
    }

    /** "Min, 4 Okt" / "Sun, 4 Oct"; the year only when it isn't [thisYear]. */
    fun shortDay(iso: String, thisYear: Int, id: Boolean = isId()): String {
        val d = parseDate(iso) ?: return iso
        val l = loc(id)
        val wd = if (id) ID_SHORT_DAYS[d.dayOfWeek.value - 1] else d.dayOfWeek.getDisplayName(TextStyle.SHORT, l).take(3)
        val mo = if (id) ID_SHORT_MONTHS[d.monthValue - 1] else d.month.getDisplayName(TextStyle.SHORT, l).take(3)
        return "$wd, ${d.dayOfMonth} $mo" + if (d.year != thisYear) " ${d.year}" else ""
    }

    /** "Oktober 2026" / "October 2026". */
    fun monthLabel(ym: String, id: Boolean = isId()): String {
        val m = runCatching { YearMonth.parse(ym) }.getOrNull() ?: return ym
        val l = loc(id)
        return m.month.getDisplayName(TextStyle.FULL, l).replaceFirstChar { it.titlecase(l) } + " " + m.year
    }

    /** "5 Okt, 16.30" (ID) / "5 Oct, 16:30" (EN), in WIB. */
    fun stamp(iso: String?, id: Boolean = isId()): String? {
        val t = iso?.let { runCatching { java.time.Instant.parse(it) }.getOrNull() } ?: return null
        val z = t.atZone(java.time.ZoneId.of("Asia/Jakarta"))
        val mo = if (id) ID_SHORT_MONTHS[z.monthValue - 1] else z.month.getDisplayName(TextStyle.SHORT, AppLanguage.ENGLISH_FORMATS).take(3)
        return "${z.dayOfMonth} $mo, " + DateTimeFormatter.ofPattern(if (id) "HH.mm" else "HH:mm").format(z)
    }

    private val ID_SHORT_DAYS = listOf("Sen", "Sel", "Rab", "Kam", "Jum", "Sab", "Min")
    private val ID_SHORT_MONTHS = listOf("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")

    /** What a money/count box holds → the number to send: digits only ("8.000.000" → 8000000); blank → null. */
    fun parseNumber(text: String): Double? = text.filter { it.isDigit() }.takeIf { it.isNotEmpty() }?.toDoubleOrNull()

    /** The box text for a number: thousands separators for money and counts alike. */
    fun box(v: Double?, id: Boolean = isId()) = if (v == null) "" else count(v, id)

    /** Σ of the filled parts, null when none is filled (the server's rsvpTotal / hostingTotal). */
    fun total(parts: List<Double?>): Double? = parts.filterNotNull().takeIf { it.isNotEmpty() }?.sum()

    /** The six weeks of a month grid, Monday first. */
    fun grid(ym: YearMonth): List<LocalDate> {
        val first = ym.atDay(1)
        val start = first.minusDays((first.dayOfWeek.value - 1).toLong())
        return (0 until 42).map { start.plusDays(it.toLong()) }
    }
}

/**
 * The form's working copy: key → text as typed. [changes] is only what differs from the event as loaded, so two
 * people filling different parts never overwrite each other (§4 PATCH).
 */
object OutletDraft {
    fun of(e: OutletEvent?, form: OutletForm, newDate: String): Map<String, String> = form.fields.associate { f ->
        f.key to when {
            e == null && f.key == "date" -> newDate
            e == null -> ""
            f.isNumber -> OutletFormat.box(e.number(f.key))
            f.key == "date" -> e.date
            f.key == "name" -> e.name
            else -> e.text(f.key)
        }
    }

    /** The value to send for [f] from its box: a number or JSON null, a trimmed text. */
    fun value(f: OutletField, text: String): JsonElement =
        if (f.isNumber) OutletFormat.parseNumber(text)?.let { JsonPrimitive(it.toLong()) } ?: JsonNull else JsonPrimitive(text.trim())

    fun changes(form: OutletForm, original: Map<String, String>, draft: Map<String, String>): JsonObject = JsonObject(
        form.fields.mapNotNull { f ->
            val a = original[f.key].orEmpty(); val b = draft[f.key].orEmpty()
            val same = if (f.isNumber) OutletFormat.parseNumber(a) == OutletFormat.parseNumber(b) else a.trim() == b.trim()
            if (same) null else f.key to value(f, b)
        }.toMap(),
    )

    /** Everything filled, for a new event (empty boxes are simply left out). */
    fun all(form: OutletForm, draft: Map<String, String>): JsonObject = JsonObject(
        form.fields.mapNotNull { f -> draft[f.key]?.takeIf { it.isNotBlank() }?.let { f.key to value(f, it) } }.toMap(),
    )
}
