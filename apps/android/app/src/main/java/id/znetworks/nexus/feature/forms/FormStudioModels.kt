package id.znetworks.nexus.feature.forms

import id.znetworks.nexus.R
import id.znetworks.nexus.feature.projects.CustomFieldDef
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.doubleOrNull
import java.time.Instant
import java.time.OffsetDateTime
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit

// The form studio's data (web FormStudio.tsx / form-model.ts, 12–13 Oct 2026; iOS FormBuilderModels.swift "Studio").
// Like the fields, `branding` and `settings` are untyped JSON: each keeps the object it was loaded from and only
// the builder's own keys are laid over it, so a key a newer web build adds rides along.

/** QUESTION_KINDS in form-model.ts: the type menu. RUPIAH is a number question with the Rupiah format. */
enum class FormQuestionKind(val value: String, val label: Int, val hint: Int, val basic: Boolean) {
    TEXT("text", R.string.fs_k_text, R.string.fs_kh_text, true),
    TEXTAREA("textarea", R.string.fs_k_textarea, R.string.fs_kh_textarea, true),
    DROPDOWN("dropdown", R.string.fs_k_dropdown, R.string.fs_kh_dropdown, true),
    MULTI_SELECT("multi_select", R.string.fs_k_multi, R.string.fs_kh_multi, true),
    CHECKBOX("checkbox", R.string.fs_checkbox, R.string.fs_kh_checkbox, true),
    NUMBER("number", R.string.fs_k_number, R.string.fs_kh_number, false),
    RUPIAH("rupiah", R.string.fs_k_rupiah, 0, false),
    DATE("date", R.string.fs_k_date, R.string.fs_kh_date, false),
    EMAIL("email", R.string.fs_k_email, 0, false),
    PHONE("phone", R.string.fs_k_phone, R.string.fs_kh_phone, false),
    URL("url", R.string.fs_k_url, R.string.fs_kh_url, false),
    FILE("file", R.string.fs_k_file, R.string.fs_kh_file, false);

    /** What `type` stores: a Rupiah question is a number. */
    val storedType: String get() = if (this == RUPIAH) "number" else value

    /** A hint that is not a sentence (shown as is, never translated). */
    val literalHint: String? get() = when (this) { RUPIAH -> "Rp 1.500.000"; EMAIL -> "name@company.com"; else -> null }

    companion object {
        fun of(type: String): FormQuestionKind? = entries.firstOrNull { it.value == type && it != RUPIAH }
    }
}

/** `branding`: an emoji icon and a cover ("preset:<key>" or an image URL). Other keys ride along. */
data class FormBranding(val icon: String, val cover: String, val raw: JsonObject) {
    /** The web's setBranding: emptied keys go, an empty object becomes null. */
    fun json(): JsonElement {
        val o = raw.toMutableMap()
        if (icon.isEmpty()) o.remove("icon") else o["icon"] = JsonPrimitive(icon)
        if (cover.isEmpty()) o.remove("cover") else o["cover"] = JsonPrimitive(cover)
        return if (o.isEmpty()) JsonNull else JsonObject(o)
    }

    /** The preset gradient the cover names, or null (none, or an image). */
    val preset: CoverPreset? get() = if (cover.startsWith("preset:")) COVERS.firstOrNull { it.key == cover.removePrefix("preset:") } else null

    data class CoverPreset(val key: String, val label: Int, val colors: List<Long>)

    companion object {
        fun of(raw: JsonElement?): FormBranding {
            val o = raw as? JsonObject ?: JsonObject(emptyMap())
            return FormBranding(o["icon"].str().orEmpty(), o["cover"].str().orEmpty(), o)
        }

        /** COVER_PRESETS in form-model.ts. */
        val COVERS = listOf(
            CoverPreset("paper", R.string.fs_cover_paper, listOf(0xFFF4F1EA, 0xFFE7E1D5)),
            CoverPreset("mist", R.string.fs_cover_mist, listOf(0xFFE8EDF3, 0xFFD5DEE8)),
            CoverPreset("lilac", R.string.fs_cover_lilac, listOf(0xFFECE8FD, 0xFFD9D1FB)),
            CoverPreset("mint", R.string.fs_cover_mint, listOf(0xFFE3F4EC, 0xFFC9EADB)),
            CoverPreset("peach", R.string.fs_cover_peach, listOf(0xFFFDEBE1, 0xFFF9D3C0)),
            CoverPreset("sky", R.string.fs_cover_sky, listOf(0xFF8EC5FC, 0xFFE0C3FC)),
            CoverPreset("dusk", R.string.fs_cover_dusk, listOf(0xFF5B4BC4, 0xFF9D6BD6, 0xFFE7A3B4)),
            CoverPreset("forest", R.string.fs_cover_forest, listOf(0xFF1F4E3D, 0xFF3F7D5C)),
            CoverPreset("ink", R.string.fs_cover_ink, listOf(0xFF1D1F24, 0xFF3A3E48)),
        )

        /** ICON_CHOICES in form-model.ts. */
        val ICONS = listOf("📝", "📋", "🧾", "💸", "💰", "🧮", "📦", "🛒", "🎟️", "📅", "🗓️", "⏰", "✈️", "🚗", "🏢", "🏠", "🎤", "🎬", "🎨", "📸",
            "🎧", "💡", "🛠️", "🧰", "📣", "📨", "📞", "🤝", "✅", "❓", "🔒", "⭐", "🔥", "🌱", "🍽️", "☕", "🎓", "🩺", "⚖️", "🧑‍💻")
    }
}

/** `settings`: what people see after sending, a response limit, who is notified. Other keys ride along. */
data class FormStudioSettings(
    val submitLabel: String, val confirmationTitle: String, val confirmationMessage: String,
    /** 0 = no limit. */
    val responseLimit: Int,
    val notifyUserIds: List<String>,
    val raw: JsonObject,
) {
    /** The web's setSettings: empty strings, empty lists and "no limit" drop their key; nothing left = null. */
    fun json(): JsonElement {
        val o = raw.toMutableMap()
        fun put(k: String, v: String) { if (v.isEmpty()) o.remove(k) else o[k] = JsonPrimitive(v) }
        put("submitLabel", submitLabel); put("confirmationTitle", confirmationTitle); put("confirmationMessage", confirmationMessage)
        if (responseLimit > 0) o["responseLimit"] = JsonPrimitive(responseLimit) else o.remove("responseLimit")
        if (notifyUserIds.isEmpty()) o.remove("notifyUserIds") else o["notifyUserIds"] = JsonArray(notifyUserIds.map(::JsonPrimitive))
        return if (o.isEmpty()) JsonNull else JsonObject(o)
    }

    /** Duplicating to another project: the people to notify belong to this one. */
    fun duplicateJson(): JsonElement = copy(notifyUserIds = emptyList(), raw = JsonObject(raw - "notifyUserIds")).json()

    companion object {
        /** Character caps of the After sending inputs (web maxLength). */
        const val MAX_SUBMIT = 40
        const val MAX_TITLE = 120
        const val MAX_MESSAGE = 1000

        fun of(raw: JsonElement?): FormStudioSettings {
            val o = raw as? JsonObject ?: JsonObject(emptyMap())
            val limit = (o["responseLimit"] as? JsonPrimitive)?.takeIf { !it.isString }?.doubleOrNull?.takeIf { it >= 1 }?.toInt() ?: 0
            return FormStudioSettings(o["submitLabel"].str().orEmpty(), o["confirmationTitle"].str().orEmpty(), o["confirmationMessage"].str().orEmpty(),
                limit, (o["notifyUserIds"] as? JsonArray)?.mapNotNull { it.str() }.orEmpty(), o)
        }
    }
}

/** Everything the studio edits and autosaves (the web's FormDraft). */
data class FormStudioDraft(
    val name: String, val description: String, val isPublic: Boolean, val requireAuth: Boolean,
    val schedule: BuilderSchedule, val fields: List<BuilderField>, val branding: FormBranding, val settings: FormStudioSettings,
) {
    companion object {
        /** The web's new form: one required question that names the task. Anyone with the link, sign-in to send. */
        fun blank(firstQuestion: String) = FormStudioDraft("", "", isPublic = true, requireAuth = true, schedule = BuilderSchedule.of(null),
            fields = listOf(BuilderField.of(JsonObject(mapOf("id" to JsonPrimitive(BuilderField.newId()), "name" to JsonPrimitive(firstQuestion),
                "label" to JsonPrimitive(firstQuestion), "type" to JsonPrimitive("text"), "required" to JsonPrimitive(true),
                "mapping" to JsonObject(mapOf("target" to JsonPrimitive("task_title"))))))),
            branding = FormBranding.of(null), settings = FormStudioSettings.of(null))

        /** The web's load: the stored fields intact (advanced keys included). */
        fun of(f: BuilderForm) = FormStudioDraft(f.name, f.description.orEmpty(), f.isPublic, f.requireAuth, BuilderSchedule.of(f.schedule),
            f.fields.map(BuilderField::of), FormBranding.of(f.branding), FormStudioSettings.of(f.settings))
    }
}

/** The web's SaveState: idle · pending · saving · saved · error. */
sealed interface FormSaveState {
    data object Idle : FormSaveState
    data object Pending : FormSaveState
    data object Saving : FormSaveState
    data object Saved : FormSaveState
    data class Failed(val message: String) : FormSaveState
}

/** A deleted question and the conditions that read it, for Undo. */
data class DeletedQuestion(val field: BuilderField, val index: Int, val dependents: Map<String, BuilderCondition>)

/** Where a question's answer goes, for its chip: a field's name, a vocabulary label, or the raw target. */
sealed interface MappingLabel {
    data class Named(val name: String) : MappingLabel
    data class Vocab(val res: Int) : MappingLabel
    data class Raw(val target: String) : MappingLabel
}

/** The studio's pure rules (form-model.ts, iOS FormStudioLogic + FormBuilderView), kept apart so they are JVM-tested. */
object FormStudioLogic {
    /** A condition or rule that reads an option the question no longer has: it can never match. */
    fun staleOption(f: BuilderField, op: String, value: String): Boolean {
        if (!f.hasOptions || !FormVocab.needsValue(op)) return false
        val v = value.trim()
        if (v.isEmpty()) return false
        return v !in f.options.map { it.trim() }.filter { it.isNotEmpty() }
    }

    /**
     * The questions [selfId] may depend on: every other question except those already shown only because of it,
     * directly or down a chain (picking one would make a loop where neither can ever show).
     */
    fun logicParents(fields: List<BuilderField>, selfId: String): List<BuilderField> {
        val byId = fields.associateBy { it.id }
        fun leadsToSelf(start: String): Boolean {
            val seen = HashSet<String>()
            var cur = byId[start]
            while (cur != null) {
                val parent = cur.showIf?.fieldId?.takeIf { it.isNotEmpty() } ?: return false
                if (parent == selfId) return true
                if (!seen.add(cur.id)) return false
                cur = byId[parent]
            }
            return false
        }
        return fields.filter { it.id != selfId && !leadsToSelf(it.id) }
    }

    /** "Show only when" switched on: the closest allowed question above with options, else the one above, else the first allowed. */
    fun defaultParent(fields: List<BuilderField>, selfId: String): BuilderField? {
        val parents = logicParents(fields, selfId)
        val mine = fields.indexOfFirst { it.id == selfId }.let { if (it < 0) fields.size else it }
        val above = parents.filter { p -> fields.indexOfFirst { it.id == p.id } < mine }
        return above.lastOrNull { it.hasOptions } ?: above.lastOrNull() ?: parents.firstOrNull()
    }

    /**
     * Removes question [id]. Questions shown only after it would never show again (their condition reads a missing
     * answer), so their condition goes with it; [restore] puts both back.
     */
    fun remove(fields: List<BuilderField>, id: String): Pair<List<BuilderField>, DeletedQuestion>? {
        val i = fields.indexOfFirst { it.id == id }
        if (i < 0) return null
        val dependents = fields.filter { it.showIf?.fieldId == id }.associate { it.id to it.showIf!! }
        val next = fields.filterIndexed { k, _ -> k != i }.map { if (it.id in dependents) it.copy(showIf = null) else it }
        return next to DeletedQuestion(fields[i], i, dependents)
    }

    fun restore(fields: List<BuilderField>, u: DeletedQuestion): List<BuilderField> {
        val next = fields.map { f -> if (f.showIf == null) u.dependents[f.id]?.let { f.copy(showIf = it) } ?: f else f }.toMutableList()
        next.add(minOf(u.index, next.size), u.field)
        return next
    }

    /** A copy of question [id] right after it; null when it is gone. */
    fun duplicate(fields: List<BuilderField>, id: String): Pair<List<BuilderField>, BuilderField>? {
        val i = fields.indexOfFirst { it.id == id }
        if (i < 0) return null
        val copy = fields[i].duplicated()
        return fields.toMutableList().apply { add(i + 1, copy) } to copy
    }

    /** Swaps question [id] with its neighbour [dir] (−1 up, +1 down); unchanged at either end. */
    fun move(fields: List<BuilderField>, id: String, dir: Int): List<BuilderField> {
        val i = fields.indexOfFirst { it.id == id }
        val j = i + dir
        if (i < 0 || j !in fields.indices) return fields
        return fields.toMutableList().also { val t = it[i]; it[i] = it[j]; it[j] = t }
    }

    /** The answer's destination for the card's chip; null = nowhere (stays in the description). */
    fun mappingLabel(f: BuilderField, customFields: List<CustomFieldDef>, sections: List<String>): MappingLabel? {
        val target = f.mappingTarget
        if (target.isEmpty() || target == "none") return null
        if (target == "custom_field") return customFields.firstOrNull { it.id == f.mappingCustomFieldId }?.let { MappingLabel.Named(it.name) }
            ?: MappingLabel.Vocab(R.string.fs_project_field)
        FormCategory.fieldForSectionQuestion(f.type, target, f.options, customFields, sections)?.let { return MappingLabel.Named(it.name) }
        return FormVocab.MAPPING.firstOrNull { it.first == target }?.let { MappingLabel.Vocab(it.second) } ?: MappingLabel.Raw(target)
    }

    /** Project fields a routing rule may set. */
    fun settableFields(customFields: List<CustomFieldDef>) = customFields.filter { it.kind in FormVocab.SETTABLE_FIELD_TYPES }

    /** "Limit the number of responses" switched on: room above what came in already, at least 50. */
    fun defaultLimit(responseCount: Int) = maxOf(responseCount + 10, 50)

    /**
     * The web's body. Name, description, questions and access always; the schedule, branding and settings only when
     * they changed (the route writes only the keys it is sent), or all of them for a new form (the schedule as null
     * while untouched).
     */
    fun payload(d: FormStudioDraft, base: FormStudioDraft, creating: Boolean, untitled: String): JsonObject = JsonObject(buildMap {
        put("name", JsonPrimitive(d.name.trim().ifEmpty { untitled }))
        put("description", if (d.description.isBlank()) JsonNull else JsonPrimitive(d.description))
        put("fields", JsonArray(d.fields.map { it.cleanJson() }))
        put("isPublic", JsonPrimitive(d.isPublic)); put("requireAuth", JsonPrimitive(d.requireAuth))
        if (creating) put("accessSchedule", if (d.schedule == base.schedule) JsonNull else d.schedule.json())
        else if (d.schedule != base.schedule) put("accessSchedule", d.schedule.json())
        if (creating || d.branding != base.branding) put("branding", d.branding.json())
        if (creating || d.settings != base.settings) put("settings", d.settings.json())
    })

    /**
     * "Duplicate to another project": the builder's CURRENT questions (saved or not), routing rules and project-field
     * links left behind, the people to notify too. The schedule as stored while untouched (null for a form that never
     * had one), the full schedule once it was edited.
     */
    fun duplicatePayload(d: FormStudioDraft, storedSchedule: JsonElement?, name: String, fallback: String, projectId: String): JsonObject = JsonObject(mapOf(
        "name" to JsonPrimitive(name.trim().ifEmpty { d.name.trim() }.ifEmpty { fallback }),
        "description" to (if (d.description.isBlank()) JsonNull else JsonPrimitive(d.description)),
        "fields" to JsonArray(d.fields.map { it.duplicateJson() }),
        "isPublic" to JsonPrimitive(d.isPublic), "requireAuth" to JsonPrimitive(d.requireAuth),
        "projectId" to JsonPrimitive(projectId),
        "accessSchedule" to (if (d.schedule != BuilderSchedule.of(storedSchedule)) d.schedule.json() else storedSchedule ?: JsonNull),
        "branding" to d.branding.json(), "settings" to d.settings.duplicateJson(),
    ))
}

/** ISO instants (opensAt / closesAt) as the web writes them: UTC with milliseconds. */
object FormInstant {
    private val OUT = DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    fun parse(s: String): Instant? {
        if (s.isBlank()) return null
        return runCatching { Instant.parse(s) }.getOrNull() ?: runCatching { OffsetDateTime.parse(s).toInstant() }.getOrNull()
    }

    fun string(i: Instant): String = OUT.format(i)

    /** "Right away" / "Never" tapped: the start of the next hour. */
    fun nextHour(now: Instant): Instant = now.truncatedTo(ChronoUnit.HOURS).plus(1, ChronoUnit.HOURS)
}

/**
 * The studio's autosave (iOS FormBuilderView): [debounceMs] after the last edit, one save at a time (an edit made during
 * a save is sent right after it). A save that started finishes even when the screen goes away, and its bookkeeping
 * (the new baseline) is kept, so a form being created is never created twice.
 */
class FormAutosave<D : Any>(
    private val scope: CoroutineScope,
    /** Sends [snapshot] (what changed since [base]); throws on failure. [force] = create a form even when nothing changed. */
    private val send: suspend (snapshot: D, base: D, force: Boolean) -> Unit,
    /** True once the form exists on the server. */
    private val hasId: () -> Boolean,
    private val describe: (Throwable) -> String,
    private val debounceMs: Long = 700,
) {
    private val _state = MutableStateFlow<FormSaveState>(FormSaveState.Idle)
    val state = _state.asStateFlow()

    var draft: D? = null; private set
    /** What the server has: the loaded form, the last saved draft, or for a form not created yet the untouched start. */
    var baseline: D? = null; private set
    var inflight = false; private set
    /** Deleted or discarded: nothing more is saved. */
    var stopped = false
    private var again = false
    private var againForce = false
    private var debounce: Job? = null

    val dirty: Boolean get() = draft != null && draft != baseline

    fun start(initial: D, saved: Boolean) {
        draft = initial; baseline = initial
        _state.value = if (saved) FormSaveState.Saved else FormSaveState.Idle
    }

    fun update(d: D) { draft = d; schedule() }

    fun schedule() {
        val base = baseline ?: return
        if (stopped) return
        debounce?.cancel()
        if (draft == base) {
            if (_state.value == FormSaveState.Pending) _state.value = if (hasId()) FormSaveState.Saved else FormSaveState.Idle
            return
        }
        if (!inflight) _state.value = FormSaveState.Pending
        debounce = scope.launch { delay(debounceMs); flush() }
    }

    fun cancelDebounce() { debounce?.cancel() }

    suspend fun flush(force: Boolean = false) {
        if (stopped) return
        val base = baseline ?: return
        val snapshot = draft ?: return
        if (inflight) { again = true; againForce = againForce || force; return }
        if (snapshot == base && !(force && !hasId())) return
        inflight = true
        _state.value = FormSaveState.Saving
        val failure = withContext(NonCancellable) {
            try { send(snapshot, base, force); baseline = snapshot; null }
            catch (e: CancellationException) { throw e }
            catch (e: Exception) { e }
            finally { inflight = false }
        }
        _state.value = when {
            failure != null -> FormSaveState.Failed(describe(failure))
            draft != snapshot -> FormSaveState.Pending.also { schedule() }
            else -> FormSaveState.Saved
        }
        if (again) {
            val forced = againForce
            again = false; againForce = false
            flush(forced)
        }
    }

    /** Waits (up to [maxMs]) for the save on its way, e.g. a first create, before something needs the form to exist. */
    suspend fun awaitIdle(maxMs: Long = 5000) {
        var waited = 0L
        while (inflight && waited < maxMs) { delay(50); waited += 50 }
    }
}

private fun JsonElement?.str(): String? = (this as? JsonPrimitive)?.takeIf { it.isString }?.content
