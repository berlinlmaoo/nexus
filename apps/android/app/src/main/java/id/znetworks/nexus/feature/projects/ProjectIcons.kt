package id.znetworks.nexus.feature.projects

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.update

/**
 * One store of project icons, id → icon (owner, 14 Oct 2026: one project mark everywhere): fed by every project
 * list and project read, so places that only know a project's id (a project chat room, …) draw its mark too.
 */
object ProjectIcons {
    private val store = MutableStateFlow<Map<String, String?>>(emptyMap())
    val icons: StateFlow<Map<String, String?>> = store

    fun put(projects: List<Project>) = store.update { it + projects.associate { p -> p.id to p.icon } }
    fun put(id: String, icon: String?) = store.update { it + (id to icon) }
    fun clear() = store.update { emptyMap() }
}
