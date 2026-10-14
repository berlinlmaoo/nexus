package id.znetworks.nexus.feature.attendance

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        // Project rule: a POST there sends real notifications / runs real jobs on production.
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
        // …and the flag comes from the platform: Location.isMock (API 31+) / isFromMockProvider, and
        // every fix that is sent is built from a real Location by toFix() (Fake GPS, owner 28 Sep).
        val provider = sources.entries.first { it.key.name == "LocationProvider.kt" }.value
        assertTrue(provider.contains("simulated = isMockLocation()"))
        assertTrue(provider.contains("isMock else isFromMockProvider"))
        assertEquals(sortedSetOf("LocationProvider.kt"), filesMatching(Regex("""\bLocationFix\(""")).minus("AttendanceModels.kt").toSortedSet())
    }

    @Test fun noSecretsInLogs() {
        assertEquals(sortedSetOf<String>(), filesMatching(Regex("""Log\.[divwe]\(.*(token|cookie|password|selfie)""", RegexOption.IGNORE_CASE)))
    }

    @Test fun noConfettiAnywhere() {
        // owner, 28 Sep (UPDATES §11): steps inside the button, a tick and a light haptic; confetti is out.
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
        // owner 28 Sep (iOS b186172): the person's own logout goes through workdayOpen(); a 401 still ends
        // the session in AuthRepository (not from a screen).
        val shell = sources.entries.first { it.key.name == "SignedInShell.kt" }.value
        assertEquals(1, Regex("""onSignOut\(\)""").findAll(shell).count())
        assertTrue(shell.contains("if (container.signOutBlocked()) logoutBlocked = true else onSignOut()"))
        // A server switch (DEV-REDESIGN.md) signs out too, behind the same rule.
        assertEquals(sortedSetOf("AppContainer.kt", "MainActivity.kt"), filesMatching(Regex("""auth::signOut|auth\.signOut\(""")))
        val container = sources.entries.first { it.key.name == "AppContainer.kt" }.value
        assertTrue(container.substringAfter("suspend fun switchServer").substringBefore("auth.signOut()").contains("signOutBlocked()"))
    }

    @Test fun checkInNeedsLocationAllTheTime() {
        // owner 28 Sep (iOS 77818ba): no check-in without "all the time" + precise while the server's flag is on.
        val screen = sources.entries.first { it.key.name == "AttendanceScreen.kt" }.value
        assertTrue(screen.contains("kind == AttendanceKind.CHECK_IN && config.requireAlwaysLocation && id.znetworks.nexus.feature.attendance.trail.AlwaysLocation.missing(context) != null"))
        val shell = sources.entries.first { it.key.name == "SignedInShell.kt" }.value
        assertTrue(shell.contains("container.workdayOpen() &&")) // asked again on every return mid-workday
    }

    @Test fun idsFromLinksAreEncodedInRoutes() {
        // Audit R3 (build 5): an id with "/" from a link or push must not change the route and crash.
        val shell = sources.entries.first { it.key.name == "SignedInShell.kt" }.value
        val block = shell.substringAfter("is Target.Project ->").substringBefore("is Target.Announcement ->")
        assertEquals(0, Regex("\\\$\\{t\\.[a-zA-Z]+\\}|\"[a-z-]+/\\\$it").findAll(block).count())
    }

    @Test fun signOutEmptiesTheFileCaches() {
        // Audit R4 (build 5): every cache folder the FileProvider shares from is emptied at sign-out,
        // except the offline copy, which OfflineSync wipes itself.
        val paths = File(root.parentFile, "res/xml").listFiles().orEmpty().filter { it.name.contains("path") }.joinToString { it.readText() }
        val shared = Regex("""cache-path name="[^"]+" path="([^"/]+)/"""").findAll(paths).map { it.groupValues[1] }.toSet() - "offline"
        assertTrue(id.znetworks.nexus.core.SignOutFiles.dirs.toSet().containsAll(shared))
        // The Calendar's disk cache (audit #21) holds another person's tasks: it goes too.
        assertTrue("calendar" in id.znetworks.nexus.core.SignOutFiles.dirs)
        val container = sources.entries.first { it.key.name == "AppContainer.kt" }.value
        assertTrue(container.contains("SignOutFiles.dirs.forEach { File(context.cacheDir, it).deleteRecursively() }"))
    }

    @Test fun typingTheReflectionNeverClosesTheKeyboard() {
        // owner 29 Sep (point 6): a scroll-based dismiss closed the keyboard at every letter (the
        // bring-into-view scroll counts as user input). Only a finger drag may close it; the shell's
        // padding is consumed so imePadding leaves no gap above the keyboard.
        val screen = sources.entries.first { it.key.name == "AttendanceScreen.kt" }.value
        assertTrue(!screen.contains("NestedScrollSource.UserInput"))
        assertTrue(screen.contains(".dismissKeyboardOnDrag {"))
        val shell = sources.entries.first { it.key.name == "SignedInShell.kt" }.value
        assertTrue(shell.contains(".padding(padding).consumeWindowInsets(padding)"))
    }

    @Test fun controlRoomKeyboardAlwaysCloses() {
        // Batch 2 B (owner 29 Sep): every Control Room text field has a keyboard action (Done), apart from the
        // announcement body (new lines), and every admin screen root closes the keyboard on a tap or drag.
        val admin = sources.filterKeys { it.parentFile.name == "admin" }
        admin.forEach { (f, src) ->
            Regex("""OutlinedTextField\(""").findAll(src).forEach { m ->
                val call = src.substring(m.range.first, (m.range.first + 700).coerceAtMost(src.length)).substringBefore("\n        }")
                val line = src.substring(m.range.first).substringBefore("\n")
                if (!line.contains("an_body")) assertTrue("${f.name}: $line", call.contains("keyboardOptions"))
            }
            assertEquals(f.name, 0, Regex("""Column\(Modifier\.fillMaxSize\(\)\.background\(c\.background\)\) \{""").findAll(src).count())
        }
    }

    @Test fun destructiveMenuItemsAskInACentredDialog() {
        // owner 29 Sep (iOS 173ffff): confirmations are plain centred alerts. A red (destructive) menu item may
        // only open one, never call the server itself; no confirmation lives in a bottom sheet.
        sources.forEach { (f, src) ->
            src.lines().filter { it.contains("DropdownMenuItem(") && it.contains("color = c.danger") }.forEach { l ->
                assertFalse("${f.name}: $l", Regex("""api\.|vm\.|scope\.launch""").containsMatchIn(l.substringAfter("color = c.danger").substringBefore("PendingConfirm(")))
            }
        }
        assertEquals(sortedSetOf("HomeScreen.kt", "ThreadsScreen.kt", "WhatsNew.kt"), filesMatching(Regex("""ModalBottomSheet\(""")))
    }

    @Test fun orgChartNeverWritesPositions() {
        // Spec 5 Oct 2026: layoutX/Y, boxLayout and POST …/layout are the web's; the phone reads them only.
        val api = sources.entries.first { it.key.name == "OrgChartApi.kt" }.value
        val code = api.lines().filterNot { it.trimStart().startsWith("*") || it.trimStart().startsWith("//") }.joinToString("\n")
        assertFalse(Regex("layoutX|layoutY|boxLayout|org-chart/layout").containsMatchIn(code))
    }

    @Test fun orgChartTextComesFromResources() {
        // owner 5 Oct: every text in English AND Indonesian. The org chart's words live in strings.xml
        // (values = English, values-in = Indonesian); only data (unit and people names) is shown as is.
        val files = sources.filterKeys { it.parentFile.name == "orgchart" }
        assertTrue(files.size >= 3)
        files.forEach { (f, src) ->
            val code = src.lines().filterNot { it.trimStart().startsWith("*") || it.trimStart().startsWith("//") || it.trimStart().startsWith("/**") }.joinToString("\n")
            val literal = Regex("""(Text|FieldLabel|onSaved|onError|run)\("[^"$]*[A-Za-z]{3}""").find(code)
            assertTrue("${f.name}: ${literal?.value}", literal == null)
            val indonesian = Regex(""""[^"\n]*\b(orang|bagian|Tambah|Hapus|Simpan|Batal|belum|di bawah|Lepas|Tutup|Ganti)\b[^"\n]*"""").find(code)
            assertTrue("${f.name}: ${indonesian?.value}", indonesian == null)
        }
    }
}
