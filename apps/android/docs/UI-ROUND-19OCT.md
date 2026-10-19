# Android UI round — 19 Oct 2026

Started 10:30 WIB on `feat/ui-round-android-19oct`. Approved scope: U-1 through U-11 in `CODEX-INPUT/ui-round-19oct.md`. DEV only; Pixel_7 with a window and host GPU. Author and committer Berlin <bagasputro.bp@gmail.com>; versionCode remains 13. No push or publication.

Base: latest available `origin/dev` f5accfb8, then fast-forwarded to the reviewed Android fixes and final QA report at 48986331. A refresh failed because the configured origin bundle `C:\work\nexus-dev.bundle` is absent. A current DEV bundle is needed to verify the base against newer server/web commits.

| Item | Status | Commit / evidence | Remaining |
|---|---|---|---|
| U-1 Status | In progress | — | Deployed manual contract accepts text/start/end and always sets Away. Server: supply the approved writable Online/Away contract. No recently-used statuses appear in the supplied contract or deployed response; optional recent section omitted. |
| U-2 Memory | Pending | — | Include physical-device animation review. |
| U-3 Notifications | Pending verification | Existing Android card already has loading/error/Retry states. | — |
| U-4 Tickets board | Pending | — | — |
| U-5 Vault | Pending | Plurals fixed during final QA: 3e3f03de. | Approved menu layout. |
| U-6 Meeting notes | Pending | — | — |
| U-7 GIDEON toolbar | Pending | — | — |
| U-8 Messages tabs | Pending | — | — |
| U-9 Timeline/Table | Pending | — | — |
| U-10 Spreadsheet zoom | Pending | — | Include physical-device pinch review. |
| U-11 Calendar counts | Pending verification | Phone grid already omits the count. | Check wide layout. |

10:30 progress: final QA finished at 10:28 (829 tests green; 532 states, 814 captures). Its private fixtures were removed and Pixel_7 stopped before this round. Restarted Pixel_7 visibly with host GPU for this round.
