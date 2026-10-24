# QA2 Android: leaderboard and folder names

Baseline: `994436651c882a46a8675d53d68aa63bcd3837c9`. This delivery uses the isolated `fix/qaf2-android-names` branch and these application commits:

- `ba91549a4e65d15505a54900af55eeb9c1f884c2`: whole-word fitting for leaderboard rows, podium names and folder names.
- `f4e87dd6abc7439eba58cb225fe76ab0dcf77f8f`: give normal long folder names a full first row when inline controls leave too little space.
- `a02279d9da7925bb392e059944a0b69c3d975094`: keep leaderboard ranks on one line at larger font scales.

Main QA2 restoration fixes and Pipeline stage-header changes are separate deliveries. The optional normal-size parameter added to the shared project-title fitter is identical to the Stage branch's additive change; existing project-title defaults remain unchanged.

## Behavior

Names use at most **two whole-word lines**, with active `TextAutoSize.StepBased` sizing and a **75% minimum** before ellipsis. Original normal sizes remain **15sp** for leaderboard rows, **13sp** for podium names and **16sp** for folders. Podium names retain two reserved lines for alignment. Existing font weights, colors, avatars, rank and score placement remain intact.

The existing word-boundary fitter prepares the lines using the actual text style and available width. Quarter-sp auto-size steps include both the exact normal size and minimum. Fitted text retains real two-line capacity in Compose; an oversized word at the minimum receives a single-line ellipsis rather than splitting inside the word.

Folder names keep inline controls when the full name fits. Otherwise, the name receives the first row beside the caret and folder icon, while the same count, Calendar, drag and More controls move to an end-aligned second row. Calendar, drag and More retain **48dp** targets, and collapse, menu and drop callbacks remain unchanged.

Native font-scale testing exposed a two-digit rank wrapping vertically in its existing **22dp** slot. Rank text now stays on one line, retaining its normal **14sp** style and shrinking to **10.5sp** before clipping. This change does not alter name or folder fitting.

## Verification

`testDebugUnitTest assembleDebug` passed on the final application source: **1,008 tests; zero failures, errors or skipped tests**. Thirteen new tests cover phone/tablet budgets, font scale 1.3, EN/ID names, tied podium labels, deep folder widths, extreme words and Unicode, the exact size grid, adaptive control geometry and the real Compose dependency's effective two-line behavior. The existing folder-tap regression remains in place.

Actual PNG review covered these cases; hierarchy text alone was not treated as visual proof:

| Case | Baseline observation | Fixed observation |
| --- | --- | --- |
| Phone, EN/light and ID/dark: existing 29-character leaderboard name | One-line ellipsis in both variants. | Complete in two whole-word lines; avatar, level, rank and score remain visible. |
| Phone, both variants: owned 44- and 49-character, seven-word folder names | Both names truncated in each variant. | Both complete in two whole-word lines, with count and all controls visible below. |
| Phone, both variants: existing 26-character podium name | Already complete in two lines. | Remains complete; podium alignment, avatars, tied-rank presentation and scores retained. |
| Tablet, both variants: both people targets and both folders | Already fitting. | All names remain complete; folder controls stay inline. |
| Phone font scale 1.3, both variants | Initial Names build showed complete target names but exposed the rank wrap. | Final rank retakes show the two-digit rank on one line and the complete row name. Unchanged podium and both folder targets were also captured complete at 1.3. |

The normal-font matrix contains **16 frames**: four cases in each phone/tablet and EN/light/ID/dark combination. Six additional phone frames cover podium, row and both folders at font scale 1.3. Six final row retakes cover normal-font phone/tablet in both variants and font-scale 1.3 phone in both variants.

Phone EN/light interaction checks also confirmed opening and closing an owned empty folder, its empty hint and count, opening and dismissing its menu, Calendar navigation with the exact owned folder filter, and tapping the current leaderboard row to its matching profile. Calendar intentionally displays a generic Folder chip for an empty folder; the saved filter ID was separately checked. Calendar and More targets measured **126 × 126px** at density 2.625, equal to **48 × 48dp**. The unchanged drag target is 48dp in source; no drag action was performed.

## Artifact and evidence provenance

Final APK: `names-rank-debug.apk`, application source `a02279d9da7925bb392e059944a0b69c3d975094`.

SHA-256: `ECDB4AA9FD86A504BA970D2AB9D2FCA96B726FEC84923960F6F99E68D5D8DAAF`.

The full normal-font matrix, initial font-scale extras and interactions used application source `f4e87dd6abc7439eba58cb225fe76ab0dcf77f8f`, APK SHA-256 `397BC6DB3DF8CA467D61727A2A723B1E1CEC96F7D4868B10C1E0286DFAD1BA7B`. Its folder and podium implementation is unchanged in the final rank-only commit. The six final row retakes use the final source and final APK above.

Baseline screenshots used Stage-only application source `bd31204c5f9754098f692c3393d8d67b8224087e`, whose existing leaderboard and folder renderers match baseline `994436651`; baseline APK SHA-256 is `9DD8EB0166F4D1565EBA1853706E8F217BFECFF9844380BDF130CC4BA60EEF95`.

Private evidence remains outside Git under `C:/Users/Berlin/qa2-android-evidence/`:

- `build-names.json`, `build-names-rank.json` and corresponding build logs.
- `names-baseline-v3-captures.json`: authoritative 16-frame baseline index.
- `names-final-complete-captures.json`: authoritative 16-frame normal-font index, including the accepted phone EN probe frames.
- `names-final-font13-captures.json`: six initial phone font-scale frames, including the rank finding.
- `names-rank-final-retakes.json`: six final row captures with exact final source/APK provenance.
- `names-final-interactions.json` and `en-light/names-final-phone-en-{folder-open,folder-closed,folder-menu,folder-calendar,row-profile}.{png,json}`: bounded interaction evidence.
- `names-independent-review-private.json`: independent PNG inspection and image hashes.

## Scope and limits

Native coverage is **EN/light and ID/dark**, phone and tablet at normal font, with **phone-only** font-scale 1.3 extras. EN/dark, ID/light and native tablet font-scale 1.3 were not separately captured. Deterministic tests cover additional width, tie, Unicode and extreme-name cases.

Real people targets were existing names of 29 characters in a row and 26 characters on the podium. No extreme person renames, XP changes, profile edits or Message sends were performed. The two normal long folders were owned QA fixtures. No private names, account identifiers, screenshots or hierarchy dumps are included in this report or branch. Ellipsis remains the last resort for names that cannot fit two lines at the minimum size. No version change or APK publication was performed.
