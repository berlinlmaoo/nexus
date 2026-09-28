package id.znetworks.nexus.feature.forms

import android.net.Uri
import id.znetworks.nexus.feature.projects.optionList
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

// API.md §2.6 Forms. FormField as FormFillModels.swift decodes it: everything lenient.

@Serializable
data class FormCondition(val fieldId: String = "", val operator: String = "", val value: String = "")

@Serializable
data class FormField(
    val id: String,
    val name: String? = null,
    val label: String? = null,
    val type: String = "text",
    val required: Boolean = false,
    val placeholder: String? = null,
    val options: JsonElement? = null,
    val attachmentEnabled: Boolean? = null,
    val autofill: String? = null,
    val numberFormat: String? = null,
    val showIf: FormCondition? = null,
) {
    val displayLabel: String get() = label ?: name ?: id
    val choices: List<String> get() = optionList(options)
    val kind: String get() = type.lowercase()
    /** Section headings carry no answer. */
    val isLayout: Boolean get() = kind == "section" || kind == "heading"
}

@Serializable
data class FormDef(
    val id: String,
    val name: String = "",
    val description: String? = null,
    val fields: List<FormField> = emptyList(),
    val isPublic: Boolean? = null,
    val requireAuth: Boolean? = null,
)

@Serializable
data class FormCount(val submissions: Int? = null)

@Serializable
data class FormSummary(val id: String, val name: String = "", val description: String? = null, val slug: String? = null,
                       val isPublic: Boolean? = null, @kotlinx.serialization.SerialName("_count") val count: FormCount? = null)

@Serializable
data class Proof(val id: String? = null, val name: String? = null, val url: String? = null, val mimeType: String? = null, val size: Long? = null)

@Serializable
data class Submission(
    val id: String,
    val createdAt: String? = null,
    val formName: String? = null,
    val projectName: String? = null,
    val taskId: String? = null,
    val taskTitle: String? = null,
    val status: String? = null,
    val stage: String? = null,
    val procStatus: String? = null,
    val proofs: List<Proof> = emptyList(),
    val answers: List<Answer> = emptyList(),
)

@Serializable
data class Answer(val id: String? = null, val label: String? = null, val type: String? = null, val value: JsonElement? = null)

@Serializable
data class Submissions(val submissions: List<Submission> = emptyList(), val statusColumns: List<String> = emptyList())

@Serializable
data class SubmitResult(val task: SubmitTask? = null)

@Serializable
data class SubmitTask(val id: String? = null, val title: String? = null)

/** A file picked for a form: a part name (`file:<fieldId>` or `attachment:<fieldId>`), streamed from disk. */
data class FormUpload(val partName: String, val filename: String, val mime: String, val size: Long, val uri: Uri)

/** One answer, kept in the four JSON shapes the web uses, so empty text and an unticked box stay apart. */
sealed interface FormValue {
    data class Text(val s: String) : FormValue
    data class Choices(val list: List<String>) : FormValue
    data class Flag(val on: Boolean) : FormValue
    data class Files(val files: List<FormUpload>) : FormValue
}

/** Port of iOS FormLogic (itself the web's evalCond/isFilled). */
object FormLogic {
    const val MAX_FILE = 50L shl 20
    const val MAX_REQUEST = 64L shl 20

    /** An absent value is [""] (so `equals ""` holds); an emptied multi-select is []. */
    fun conditionValues(v: FormValue?): List<String> = when (v) {
        null -> listOf("")
        is FormValue.Text -> listOf(v.s)
        is FormValue.Flag -> listOf(if (v.on) "true" else "false")
        is FormValue.Choices -> v.list
        is FormValue.Files -> v.files.map { it.filename }
    }

    /** `false` counts as empty: a required checkbox must actually be ticked. */
    fun isFilled(v: FormValue?): Boolean = when (v) {
        null -> false
        is FormValue.Text -> v.s.isNotEmpty()
        is FormValue.Flag -> v.on
        is FormValue.Choices -> v.list.isNotEmpty()
        is FormValue.Files -> v.files.isNotEmpty()
    }

    /** Five operators; an unknown one shows the field rather than hiding it. */
    fun evaluate(c: FormCondition?, values: Map<String, FormValue>): Boolean {
        if (c == null || c.fieldId.isEmpty()) return true
        val list = conditionValues(values[c.fieldId])
        val joined = list.joinToString(", ")
        return when (c.operator) {
            "equals" -> c.value in list
            "not_equals" -> c.value !in list
            // JS "abc".includes("") is true.
            "contains" -> c.value.isEmpty() || joined.lowercase().contains(c.value.lowercase())
            "is_empty" -> joined.isEmpty()
            "is_not_empty" -> joined.isNotEmpty()
            else -> true
        }
    }

    fun visible(fields: List<FormField>, values: Map<String, FormValue>) = fields.filter { evaluate(it.showIf, values) }

    fun missingRequired(visible: List<FormField>, values: Map<String, FormValue>) =
        visible.filter { it.required && !it.isLayout && !isFilled(values[it.id]) }.map { it.displayLabel }

    /** The `data` part: hidden and layout fields are not submitted; files become comma-joined names. */
    fun data(visible: List<FormField>, values: Map<String, FormValue>, extras: Map<String, FormUpload>): Map<String, Any> = buildMap {
        visible.filterNot { it.isLayout }.forEach { f ->
            when (val v = values[f.id]) {
                is FormValue.Text -> put(f.id, v.s)
                is FormValue.Flag -> put(f.id, v.on)
                is FormValue.Choices -> put(f.id, v.list)
                is FormValue.Files -> put(f.id, v.files.joinToString(",") { it.filename })
                null -> Unit
            }
            extras[f.id]?.let { put("attachment:${f.id}", it.filename) }
        }
    }

    /** `"`, CR and LF break a multipart header. */
    fun safeName(n: String) = n.replace("\"", "").replace("\r", "").replace("\n", "").ifBlank { "file" }
}
