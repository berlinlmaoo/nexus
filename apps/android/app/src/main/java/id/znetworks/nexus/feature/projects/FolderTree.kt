package id.znetworks.nexus.feature.projects

/**
 * The project-folder tree's rules, mirrored from the server's lib/folder-tree.ts (FOLDERS-DND, 10 Oct 2026):
 * at most [MAX_DEPTH] levels, and a folder never goes inside itself or one of its own subfolders. The server
 * checks again; these only decide what the screen offers.
 */
class FolderTree(val folders: List<ProjectFolder>, val projects: List<Project> = emptyList()) {
    private val byId = folders.associateBy { it.id }

    /** A parent that isn't in the list counts as none (the folder shows at the top level). */
    private fun parentOf(f: ProjectFolder) = f.parentFolderId?.takeIf { it != f.id && byId.containsKey(it) }

    fun roots() = sorted(folders.filter { parentOf(it) == null })
    fun children(id: String) = sorted(folders.filter { parentOf(it) == id })
    fun projectsIn(id: String) = projects.filter { it.folderId == id }
    /** Projects with no folder, or whose folder isn't in the list. */
    fun loose() = projects.filter { p -> p.folderId == null || !byId.containsKey(p.folderId) }

    /** 1 for a top-level folder. Stops on a cycle in bad data instead of looping. */
    fun depth(id: String): Int {
        var d = 0; var cur: String? = id; val seen = HashSet<String>()
        while (cur != null && seen.add(cur)) { d++; cur = byId[cur]?.let(::parentOf) }
        return d
    }

    /** Levels in the subtree under and including [id]: 1 for a folder with no subfolders. */
    fun height(id: String, seen: MutableSet<String> = HashSet()): Int {
        if (!seen.add(id)) return 0
        return 1 + (children(id).maxOfOrNull { height(it.id, seen) } ?: 0)
    }

    /** [id] is [ancestor] or somewhere under it. */
    fun isWithin(id: String, ancestor: String): Boolean {
        var cur: String? = id; val seen = HashSet<String>()
        while (cur != null && seen.add(cur)) { if (cur == ancestor) return true; cur = byId[cur]?.let(::parentOf) }
        return false
    }

    /** Folder [moved] may go into [target] (null = top level). */
    fun canMoveFolder(moved: String, target: String?): Boolean {
        val f = byId[moved] ?: return false
        if (target == null) return parentOf(f) != null
        if (target == parentOf(f) || isWithin(target, moved)) return false
        return depth(target) + height(moved) <= MAX_DEPTH
    }

    fun canMoveProject(p: Project, target: String?) = if (target == null) p.folderId != null else target != p.folderId && byId.containsKey(target)

    /** "New subfolder" is offered while the folder is above the last level. */
    fun canHaveSubfolder(id: String) = depth(id) < MAX_DEPTH

    /** "Clients › ACME › Launch" — how a folder is named in "Move to…". */
    fun path(id: String): String {
        val names = ArrayList<String>(); var cur: String? = id; val seen = HashSet<String>()
        while (cur != null && seen.add(cur)) { val f = byId[cur] ?: break; names.add(f.name); cur = parentOf(f) }
        return names.reversed().joinToString(" › ")
    }

    /** Every folder in tree order (parents before their subfolders), for the "Move to…" list. */
    fun inOrder(): List<ProjectFolder> {
        val out = ArrayList<ProjectFolder>(); val seen = HashSet<String>()
        fun walk(f: ProjectFolder) { if (!seen.add(f.id)) return; out.add(f); children(f.id).forEach(::walk) }
        roots().forEach(::walk)
        return out
    }

    fun folderTargets(moved: String) = inOrder().filter { canMoveFolder(moved, it.id) }
    fun projectTargets(p: Project) = inOrder().filter { canMoveProject(p, it.id) }

    /** A project somewhere under [id]; staff only see folders that lead to one (the web hides empty ones from them). */
    fun hasProjects(id: String, seen: MutableSet<String> = HashSet()): Boolean {
        if (!seen.add(id)) return false
        return projectsIn(id).isNotEmpty() || children(id).any { hasProjects(it.id, seen) }
    }

    /** What a closed folder's count says: its own projects and subfolders. */
    fun count(id: String) = projectsIn(id).size + children(id).size

    private fun sorted(l: List<ProjectFolder>) = l.sortedWith(compareBy({ it.position ?: Int.MAX_VALUE }, { it.name.lowercase() }))

    companion object {
        const val MAX_DEPTH = 4
    }
}
