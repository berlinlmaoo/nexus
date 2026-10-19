# Final Android QA — 19 Oct 2026

Status: in progress. Started 07:57 WIB; report due 10:30 WIB. Branch feat/android-r21; reviewed head 7d4eecc1 retained. DEV only, Pixel_7 / emulator-5556 with a window and host GPU. Baseline testDebugUnitTest + assembleDebug PASS: 822 tests, zero failures/errors/skips. VersionCode 13.

Four variants: EN/light, EN/dark, ID/light, ID/dark. Screenshots are outside Git at nexus-shots/qa-final-19oct. Main screens, details, safe dialogs and cross-session updates are in scope; no attendance check-in, role changes or shared-data edits. A private project/task/form/self-only project chat and a separate QA login isolate write checks. Existing records are inspected without changing them.

| Screen / flow | Issue | Severity | Fixed? |
|---|---|---|---|
| Chat, native screen + second login | Live message arrived with screen open; native reply read back by second login. | None observed | Not required |
| Task, native screen + second login | Title/priority and comment arrived with screen open. | None observed | Not required |
| Presence, native screen + second login | Own status/dot changed with profile open; guarded cleanup restored the previous unexpired manual. | None observed | Not required |
| Capture runner | Early screenshots caught loading/splash frames; waits corrected and affected captures queued for retake. | QA harness only | Yes |

Live updates were observed within about 2.1 seconds including the UI dump. Transport may include the app's polling fallback; no foreground/reopen was used after the second-session write. Full four-variant screen matrix and final cleanup/shutdown results will replace this progress section.
