package id.znetworks.nexus.feature.attendance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * REQ-ATT-01 / UPDATES 28 Sep §6, as a build-time guard: "grep the codebase for check-in/out call
 * sites; only the capture flow reaches them". Fails the moment a new path to check-in/out, or a
 * selfie that skipped the face check, appears anywhere in the app.
 */
class AttendanceGuardTest {
    private val root = File("src/main/java").takeIf { it.isDirectory } ?: File("app/src/main/java")
    private val sources = root.walkTopDown().filter { it.extension == "kt" }.associateWith { it.readText() }

    private fun filesMatching(re: Regex) =
        sources.filter { (_, text) -> text.lines().any { l -> !l.trimStart().startsWith("//") && !l.trimStart().startsWith("*") && re.containsMatchIn(l) } }
            .keys.map { it.name }.toSortedSet()

    @Test fun sourcesFound() = assertTrue("no sources under ${root.absolutePath}", sources.size > 20)

    @Test fun onlyTheCaptureFlowAndTheQueueCallCheckInOut() {
        assertEquals(sortedSetOf("AttendanceQueue.kt", "AttendanceViewModel.kt"),
            filesMatching(Regex("""\.check(In|Out)\(""")))
    }

    @Test fun onlyTheFaceCheckMakesALiveSelfie() {
        // The class declaration is in the same file; any other constructor call is a bypass.
        assertEquals(sortedSetOf("LivenessCaptureScreen.kt"), filesMatching(Regex("""LiveSelfie\(""")))
    }

    @Test fun queuedSelfiesComeOnlyFromTheCaptureFlow() {
        // The attendance queue is fed by the capture flow alone (TrailMachine's own enqueue is for
        // location points and never sees a photo).
        assertEquals(sortedSetOf("AttendanceViewModel.kt"), filesMatching(Regex("""[qQ]ueue\.enqueue\(""")))
    }

    @Test fun nothingButTheAppOpensAttendance() {
        // No notification action, shortcut or widget may check in/out (REQ-ATT-40): the only
        // notification action anywhere is the permit composer (the outside-office push, and the
        // Work session notification once 90 min outside, UPDATES §9). One permit link per action.
        val actions = filesMatching(Regex("""addAction\("""))
        assertEquals(sortedSetOf("Push.kt", "WorkTrailService.kt"), actions)
        for (name in actions) {
            val src = sources.entries.first { it.key.name == name }.value
            assertEquals(name, Regex("""addAction\(""").findAll(src).count(), Regex("""nexus://attendance\?permit=today""").findAll(src).count())
        }
    }
}
