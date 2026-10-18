package id.znetworks.nexus.ui.components

import android.content.res.Resources
import id.znetworks.nexus.R
import id.znetworks.nexus.core.net.ApiError

/**
 * The sentence a person sees for a failed call (API.md §1.7). The server's own sentence always
 * wins and is shown word for word: it is often Indonesian and already says what to do.
 */
/**
 * Project access refusals as sentences (web lib/failure.ts, iOS AccessRefusal): the codes of the access levels
 * (13 Oct) and the older "MEMBER role" / "LEAD role" lines. Null when it is not one.
 */
fun ApiError.accessRefusal(res: Resources): String? {
    val h = this as? ApiError.Http ?: return null
    val msg = h.serverMessage.orEmpty()
    return when {
        h.code == "LAST_OWNER" -> res.getString(R.string.acc_last_owner)
        h.code == "NEEDS_EDIT_ACCESS" || Regex("MEMBER role", RegexOption.IGNORE_CASE).containsMatchIn(msg) -> res.getString(R.string.acc_needs_edit)
        h.code == "NEEDS_COMMENT_ACCESS" -> res.getString(R.string.acc_needs_comment)
        h.code == "NEEDS_FULL_ACCESS" || Regex("LEAD role", RegexOption.IGNORE_CASE).containsMatchIn(msg) -> res.getString(R.string.acc_full_only)
        else -> null
    }
}

/** A refused write in words: an access refusal, else the server's sentence, else [fallback]. */
fun ApiError.sentence(res: Resources, fallback: Int): String =
    conflictOrVault(res) ?: accessRefusal(res) ?: (this as? ApiError.Http)?.serverMessage ?: res.getString(fallback)

private fun ApiError.conflictOrVault(res: Resources): String? {
    val key = when ((this as? ApiError.Http)?.code) {
        "ASSIGNEES_CHANGED" -> R.string.r21_assignees_changed
        "DESCRIPTION_CHANGED", "DOC_CHANGED", "FORM_CHANGED" -> R.string.r21_text_changed
        "SHEET_STRUCTURE_CHANGED" -> R.string.r21_sheet_changed
        "TOO_MANY_TAGS" -> R.string.r21_tags_limit
        "VAULT_FULL" -> R.string.r21_vault_full
        "FOLDER_GONE" -> R.string.r21_folder_gone
        "CYCLE" -> R.string.r21_folder_cycle
        "GONE" -> R.string.r21_file_gone
        else -> return null
    }
    return res.getString(key)
}

fun ApiError.describe(res: Resources): String = when (this) {
    is ApiError.Http -> conflictOrVault(res) ?: accessRefusal(res) ?: serverMessage
        ?: if (ApiError.isEdgeOnly(status)) res.getString(R.string.error_cant_reach)
        else res.getString(R.string.error_server_status, status)
    is ApiError.UpgradeRequired -> serverMessage ?: res.getString(R.string.update_required_title)
    is ApiError.Transport -> res.getString(R.string.error_cant_reach)
    is ApiError.Decoding -> res.getString(R.string.error_decoding)
    ApiError.Unauthorized -> res.getString(R.string.error_signed_out)
}
