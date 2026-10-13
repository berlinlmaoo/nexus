package id.znetworks.nexus.feature.projects

/**
 * Project access levels (dev web 13 Oct 2026, iOS ProjectAccess.swift): Full access / Can edit / Can comment /
 * Can view. The server sends the viewer's level on GET /api/projects/:id and a level per member. An older server
 * sends none: then nothing is gated (the server still refuses what it refuses).
 */
enum class AccessLevel(val code: String, val rank: Int) {
    VIEW("VIEW", 1), COMMENT("COMMENT", 2), EDIT("EDIT", 3), FULL("FULL", 4);

    companion object {
        /** Lenient: an unknown or missing level is null (= not gated). */
        fun of(code: String?): AccessLevel? = entries.firstOrNull { it.code.equals(code?.trim(), true) }
        /** What a member row gets: LEAD → Full, GUEST → Can comment, VIEWER → Can view, else its level (never Full from it), default Can edit. */
        fun ofMember(role: String?, accessLevel: String?): AccessLevel = when (role?.uppercase()) {
            "LEAD" -> FULL
            "GUEST" -> COMMENT
            "VIEWER" -> VIEW
            else -> of(accessLevel)?.takeIf { it != FULL } ?: EDIT
        }
    }
}

/** What the viewer may do on one project. */
data class ProjectAccess(val level: AccessLevel?, val viewerCanManage: Boolean?) {
    val canEdit: Boolean get() = level == null || level.rank >= AccessLevel.EDIT.rank
    val canComment: Boolean get() = level == null || level.rank >= AccessLevel.COMMENT.rank
    /** Statuses / columns, project settings. */
    val canManage: Boolean get() = if (level != null) level == AccessLevel.FULL else viewerCanManage ?: true
    val canDelete: Boolean get() = if (level != null) level == AccessLevel.FULL || level == AccessLevel.EDIT else viewerCanManage != false
    /** The read-only chip by the title: only Can view / Can comment. */
    val readOnlyChip: AccessLevel? get() = level?.takeIf { it == AccessLevel.VIEW || it == AccessLevel.COMMENT }

    companion object {
        fun of(d: ProjectDetail?): ProjectAccess = ProjectAccess(AccessLevel.of(d?.viewerAccessLevel), d?.viewerCanManage)
    }
}

object AccessText {
    /** The role an older server reads for a level (LEAD = Project Owner = Full access). */
    fun roleFor(l: AccessLevel): String = when (l) { AccessLevel.FULL -> "LEAD"; AccessLevel.EDIT -> "MEMBER"; AccessLevel.COMMENT -> "GUEST"; AccessLevel.VIEW -> "VIEWER" }
    /** The levels offered, most first. */
    val LEVELS = listOf(AccessLevel.FULL, AccessLevel.EDIT, AccessLevel.COMMENT, AccessLevel.VIEW)
}
