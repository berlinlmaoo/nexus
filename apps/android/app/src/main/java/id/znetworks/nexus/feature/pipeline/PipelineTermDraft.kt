package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.session.Session

/** Only credentials identify this draft's owner; refreshed profile metadata does not change ownership. */
internal class PipelineTermOwner(private val serverBase: String, session: Session?) {
    private val token = session?.token
    private val cookieName = session?.cookieName
    private val userId = session?.userId

    fun accepts(currentBase: String, current: Session?): Boolean = current != null && token != null &&
        serverBase == currentBase && token == current.token && cookieName == current.cookieName && userId == current.userId
}

/** The opening values remain fixed while realtime refreshes the deal beneath the dialog. */
data class PipelineTermFields(val label: String = "", val amount: String, val date: String? = null)

/** Owned by the retained board ViewModel, including an in-flight submission and discard prompt. */
data class PipelineTermDraft(
    val key: String,
    val dealId: String,
    val termId: String?,
    val initial: PipelineTermFields,
    val fields: PipelineTermFields = initial,
    val busy: Boolean = false,
    val discard: Boolean = false,
    val attempt: Int = 0,
) {
    val dirty: Boolean get() = fields != initial
    val amount: Double? get() = PipelineFormat.parseMoney(fields.amount)?.takeIf { it.isFinite() && it >= 0 }
    val valid: Boolean get() = amount != null && (termId == null || fields.date != null)

    fun edit(next: PipelineTermFields): PipelineTermDraft = if (busy) this else copy(fields = next)
    fun requestClose(): PipelineTermDraft? = when { busy -> this; dirty -> copy(discard = true); else -> null }
    fun keepEditing(): PipelineTermDraft = copy(discard = false)
    fun discardChanges(): PipelineTermDraft? = if (busy) this else null
    fun submit(): PipelineTermDraft? = if (busy || !valid) null else copy(busy = true, discard = false, attempt = attempt + 1)

    /** A delayed result belongs to its original dialog and attempt, never a later opened dialog. */
    fun completed(sent: PipelineTermDraft, success: Boolean): PipelineTermDraft? =
        if (key != sent.key || attempt != sent.attempt || !busy) this
        else if (success) null else copy(busy = false)
}
