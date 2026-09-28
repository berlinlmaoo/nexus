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

    @Test fun neverCallsCronOrNotificationSendingRoutes() {
        // CLAUDE.md: a POST there sends real notifications / runs real jobs on production.
        assertEquals(sortedSetOf<String>(), filesMatching(Regex("""/api/cron|/api/notifications/due-check|/api/notifications/send""")))
    }

    @Test fun locationRunsOnlyThroughTheWorkSession() {
        // The foreground service is started by the trail (after consent, while a record is open) and
        // by the boot receiver (resuming that same record) — nothing else may switch GPS on.
        assertEquals(sortedSetOf("WorkTrail.kt", "WorkTrailService.kt"), filesMatching(Regex("""WorkTrailService\.start\(""")))
        assertEquals(sortedSetOf("WorkTrailService.kt"), filesMatching(Regex("""requestLocationUpdates\(""")))
    }

    @Test fun onlyTheUpdaterInstallsPackages() {
        assertEquals(sortedSetOf("ApkUpdater.kt"), filesMatching(Regex("""PackageInstaller\.SessionParams|packageInstaller\b""")))
        // …and it always runs the verdict (checksum, package, signing key, version) first.
        val updater = sources.entries.first { it.key.name == "ApkUpdater.kt" }.value
        assertTrue(updater.contains("verdict("))
        // Audit T3: the system's confirmation is kept as a step (dialog button + notification), never
        // fired and forgotten from the background.
        assertTrue(updater.contains("confirmationNeeded(confirm, session)"))
        assertTrue(updater.contains("abandonSession("))
    }

    @Test fun theQueueLivesOutsideBackups() {
        // Selfies and tap times must never ride along into a cloud backup or a new phone.
        val container = sources.entries.first { it.key.name == "AppContainer.kt" }.value
        assertTrue(Regex("""AttendanceQueue\(\s*dir = File\(context\.noBackupFilesDir""").containsMatchIn(container))
    }

    @Test fun everyAttendanceSendCarriesTheMockLocationFlag() {
        val api = sources.entries.first { it.key.name == "AttendanceApi.kt" }.value
        assertTrue(api.contains("\"simulated\" to"))
    }

    @Test fun noSecretsInLogs() {
        assertEquals(sortedSetOf<String>(), filesMatching(Regex("""Log\.[divwe]\(.*(token|cookie|password|selfie)""", RegexOption.IGNORE_CASE)))
    }

    @Test fun noConfettiAnywhere() {
        // Berlin, 28 Sep (UPDATES §11): steps inside the button, a tick and a light haptic; confetti is out.
        assertEquals(sortedSetOf<String>(), filesMatching(Regex("confetti|Konfetti|particle", RegexOption.IGNORE_CASE)))
    }

    @Test fun temporaryGooglePasswordStaysOnScreen() {
        // Shown once to the BoD and copied as sensitive; never written to prefs, files or logs.
        assertEquals(sortedSetOf("GoogleWorkspace.kt"), filesMatching(Regex("""temporaryPassword""")))
        val gw = sources.entries.first { it.key.name == "GoogleWorkspace.kt" }.value
        assertTrue(!Regex("""SharedPreferences|getSharedPreferences|writeText|Log\.""").containsMatchIn(gw))
    }

    @Test fun zoneIsJudgedAgainstEveryActiveOffice() {
        // Audit S2: inside ANY active office is inside. A zone call against the record's fence alone
        // would bring back the false "you left the office" alarm when moving to another office.
        val machine = sources.entries.first { it.key.name == "TrailMachine.kt" }.value
        assertEquals(0, Regex("""decisive\([^)]*,\s*(fence|it|state\.fence)\)""").findAll(machine).count())
        assertTrue(machine.contains("state.fences"))
    }

    @Test fun everyPhotoGoesThroughTheCameraPermissionCheck() {
        // Audit T5: ACTION_IMAGE_CAPTURE throws without CAMERA; only rememberCameraCapture launches it.
        assertEquals(sortedSetOf("CameraCapture.kt"), filesMatching(Regex("""TakePicture\(""")))
    }

    @Test fun logoutIsHeldWhileAWorkdayRuns() {
        // Berlin 28 Sep (iOS b186172): the person's own logout goes through workdayOpen(); a 401 still ends
        // the session in AuthRepository (not from a screen).
        val shell = sources.entries.first { it.key.name == "SignedInShell.kt" }.value
        assertEquals(1, Regex("""onSignOut\(\)""").findAll(shell).count())
        assertTrue(shell.contains("if (container.workdayOpen()) logoutBlocked = true else onSignOut()"))
        assertEquals(sortedSetOf("MainActivity.kt"), filesMatching(Regex("""auth::signOut|auth\.signOut\(""")))
    }
}
