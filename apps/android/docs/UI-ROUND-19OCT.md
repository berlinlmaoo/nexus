# Android UI round — 19 Oct 2026

Started 10:30 WIB on `feat/ui-round-android-19oct`. Approved scope: U-1 through U-13 (including the appended action-card and empty-chat items) in `CODEX-INPUT/ui-round-19oct.md`. DEV only; Pixel_7 with a window and host GPU. Author and committer Berlin <bagasputro.bp@gmail.com>; versionCode remains 13. No push or publication.

Base: latest available `origin/dev` f5accfb8, then fast-forwarded to the reviewed Android fixes and final QA report at 48986331. A refresh failed because the configured origin bundle `C:\work\nexus-dev.bundle` is absent. A current DEV bundle is needed to verify the base against newer server/web commits.

| Item | Status | Commit / evidence | Remaining |
|---|---|---|---|
| U-1 Status | Partial: editor verified; availability needs server contract | 7f4461cf. [EN light](../../../../nexus-shots/ui-round-19oct/en-light/u1-status.png), [EN dark](../../../../nexus-shots/ui-round-19oct/en-dark/u1-status.png), [ID light](../../../../nexus-shots/ui-round-19oct/id-light/u1-status.png), [ID dark](../../../../nexus-shots/ui-round-19oct/id-dark/u1-status.png). | Deployed manual contract accepts text/start/end and always sets Away; availability choices are visibly disabled with an explanatory caption. Server: supply the approved writable Online/Away contract. No recently-used statuses appear in the supplied contract or deployed response; optional recent section omitted. |
| U-2 Memory | Done; physical animation review remains | 0a9453de, 1561e527. [EN light](../../../../nexus-shots/ui-round-19oct/en-light/u2-summary.png), [EN dark](../../../../nexus-shots/ui-round-19oct/en-dark/u2-summary.png), [ID light](../../../../nexus-shots/ui-round-19oct/id-light/u2-summary.png), [ID dark](../../../../nexus-shots/ui-round-19oct/id-dark/u2-summary.png). | Physical phone: push/loading/reveal timing. [Transition recording](../../../../nexus-shots/ui-round-19oct/u2-memory-transition.mp4). |
| U-3 Notifications | Done: existing loading/error/Retry implementation verified | [EN light](../../../../nexus-shots/ui-round-19oct/en-light/u3-notifications-error.png), [EN dark](../../../../nexus-shots/ui-round-19oct/en-dark/u3-notifications-error.png), [ID light](../../../../nexus-shots/ui-round-19oct/id-light/u3-notifications-error.png), [ID dark](../../../../nexus-shots/ui-round-19oct/id-dark/u3-notifications-error.png). Recovery captures alongside each. | No app change needed. Offline failure and native Retry restore the setting in all four variants; no preference toggles changed. |
| U-4 Tickets board | Pending | — | — |
| U-5 Vault | Pending | Plurals fixed during final QA: 3e3f03de. | Approved menu layout. |
| U-6 Meeting notes | Pending | — | — |
| U-7 GIDEON toolbar | Pending | — | — |
| U-8 Messages tabs | Pending | — | — |
| U-9 Timeline/Table | Pending | — | — |
| U-10 Spreadsheet zoom | Pending | — | Include physical-device pinch review. |
| U-11 Calendar counts | Pending verification | Phone grid already omits the count. | Check wide layout. |

10:30 progress: final QA finished at 10:28 (829 tests green; 532 states, 814 captures). Its private fixtures were removed and Pixel_7 stopped before this round. Restarted Pixel_7 visibly with host GPU for this round.

10:40 U-1: **833 tests + assembleDebug PASS**. All four variants reviewed. Native Save persisted the emoji and three-hour shoot preset; DEV readback confirmed the duration, and the original own status was restored. One Cancel/Save top bar, separate availability, vertical quick picks, duration/start menus and an Until summary. Removed the two retired presets from Android resources. The existing sheet guard now explicitly allows the owner-approved status editor; destructive confirmations remain centred.

11:12 U-2: **837 tests + assembleDebug PASS**. Grouped settings, direct nickname/role/about saves, a pushed summary, relative update time, dot-grid/loading-text shimmer, section reveal and a bottom composer are implemented. DEV responded immediately, so the recorded fast path reveals data without a forced delay; slow-loading shimmer/reveal still needs the listed physical-device review. Native writes for all three field kinds, summary add/edit/delete, and editing a profile memory through the summary passed. Forget-all alerts were opened and cancelled in all four variants. Only this run's exact-ID memories were removed; the original memory and pause policy were preserved.

Profile interoperability: settings memories use stable prefixes `Nickname: `, `Role / occupation: ` and `More about me: ` with PERSON/FACT/PREFERENCE respectively. Summary labels follow the app language, and summary editing changes the value while retaining the prefix/kind. Existing English/Indonesian aliases are recognised. Web/iOS should use the same text convention until the API provides explicit profile-field identifiers.

11:22 U-3: offline error and Retry recovery verified in all four variants. Emulator network toggles restored to their original enabled state. U-4 implementation is green at 3abfd419; native board checks follow. The task now includes U-12, U-13 and a final branch bundle handoff; these are included. Phase 2 waits for the owner’s client contracts.
