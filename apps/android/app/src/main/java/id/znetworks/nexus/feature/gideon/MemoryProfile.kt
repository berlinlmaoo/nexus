package id.znetworks.nexus.feature.gideon

/** Stable text memories: the same fields remain readable in chat and after an app-language change. */
object MemoryProfile {
    enum class Field(val kind: String, val prefix: String, val aliases: List<String>) {
        NICKNAME("PERSON", "Nickname: ", listOf("Nickname: ", "Your nickname: ", "Nama panggilan: ", "Nama panggilanmu: ")),
        ROLE("FACT", "Role / occupation: ", listOf("Role / occupation: ", "Role: ", "Your role / occupation: ", "Peran / pekerjaan: ")),
        ABOUT("PREFERENCE", "More about me: ", listOf("More about me: ", "More about you: ", "About me: ", "Tentang saya: ", "Tentang kamu: ")),
    }
    fun value(field: Field, memory: GMemory?): String = memory?.text?.let { text ->
        field.aliases.firstOrNull { text.startsWith(it, ignoreCase = true) }?.let { text.drop(it.length) }
    }.orEmpty()
    fun find(field: Field, memories: List<GMemory>): GMemory? = memories.filter { m ->
        m.kind == field.kind && m.status == "ACTIVE" && m.source == "SETTINGS" && field.aliases.any { m.text.startsWith(it, ignoreCase = true) }
    }.maxByOrNull { it.updatedAt ?: it.createdAt.orEmpty() }
    fun payload(field: Field, value: String) = field.prefix + value.trim()
    fun limit(field: Field, textMax: Int) = (textMax - field.prefix.length).coerceAtLeast(0)
    fun field(memory: GMemory): Field? = Field.entries.firstOrNull { field ->
        memory.source == "SETTINGS" && memory.kind == field.kind && field.aliases.any { memory.text.startsWith(it, ignoreCase = true) }
    }
}
