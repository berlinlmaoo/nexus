package id.znetworks.nexus.feature.pipeline

/** Keeps unsaved typing when an earlier save or realtime refresh arrives for the same field. */
internal data class PipelineFieldDraft(val serverValue: String, val text: String = serverValue) {
    fun edit(text: String) = copy(text = text)
    fun refresh(value: String) = PipelineFieldDraft(value, if (text == serverValue) value else text)
    fun pending(): String? = text.takeIf { it != serverValue }
}
