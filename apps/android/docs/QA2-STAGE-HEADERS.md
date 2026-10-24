# QA2 Android: Pipeline stage headers

Baseline: `994436651c882a46a8675d53d68aa63bcd3837c9`. Fix: `bd31204c5f9754098f692c3393d8d67b8224087e` on the isolated `fix/qaf2-android-stagehdr` branch. The tested application tree matches this fix commit.

The phone and tablet board use the same stage-header component. Baseline captures showed `Won – Contract Pe…` on the English phone, `Won — Kontrak P…` on the Indonesian phone, and `Proposa…` on both tablet variants when a large monetary total shared the row.

## Change

Stage names retain a normal size of **13sp**, use at most **two whole-word lines**, and shrink to **9.75sp (75%)** before ellipsis. The existing project-title fitter supplies the word boundaries and size selection; its project-title defaults remain unchanged. An extreme custom name can still receive ellipsis after reaching the minimum size.

The count and Add action stay beside the stage name. Monetary totals occupy a separate wrapping row. The header grows with its content and has a minimum main-row height of **48dp**, preserving the Add action's **48 × 48dp** target. Lost / Cancelled retains its existing absence of an Add action.

## Verification

| Check | Result |
| --- | --- |
| `testDebugUnitTest assembleDebug` | **1,001 tests; 0 failures, errors or skipped tests.** |
| Phone, EN/light and ID/dark | All eight stages captured separately; complete localized names, counts and expected Add actions. Long Proposal and Won names have no ellipsis or broken-word wrapping. |
| Tablet, EN/light and ID/dark | All eight stages covered across left/middle/right panels plus centered Negotiation/Negosiasi and Closing captures. Centered captures close the earlier edge-clipping evidence gap. |
| Add touch bounds | Phone **126 × 126px** at density 2.625; tablet **108 × 108px** at density 2.25: both **48 × 48dp**. |
| Counts and totals | Stage counts remain `1, 1, 0, 1, 0, 0, 0, 0`. Nonzero totals remain EN `Rp10M` / `Rp988B`, ID `Rp10Jt` / `Rp988M`. |
| Layout regressions | Six new tests cover phone/tablet width budgets, six-digit counts, long totals, EN/ID stage names, font scale 1.3, whole-word wrapping, the exact 75% floor, extreme fallback and unchanged project-title defaults. |

Fixed APK: `stagehdr-debug.apk`.

SHA-256: `9DD8EB0166F4D1565EBA1853706E8F217BFECFF9844380BDF130CC4BA60EEF95`.

## Private evidence

Evidence remains outside the repository under `C:/Users/Berlin/qa2-android-evidence/`:

- `build-stagehdr.json` and `build-stagehdr.log`: source, APK hash and test results.
- `stagehdr-baseline-captures.json`, `stagehdr-fixed-captures.json`, `stagehdr-centered.json`: capture/source indexes and centered-column bounds.
- `en-light/stagehdr-baseline-phone-en-stage3.{png,json}` and the corresponding `id-dark/stagehdr-baseline-phone-id-stage3.{png,json}`: phone baseline failures.
- `en-light/stagehdr-baseline-tablet-en-middle.{png,json}` and `id-dark/stagehdr-baseline-tablet-id-middle.{png,json}`: tablet baseline truncation.
- `en-light/stagehdr-fixed-phone-en-stage0..7.{png,json}` and `id-dark/stagehdr-fixed-phone-id-stage0..7.{png,json}`: all phone stages.
- `en-light/stagehdr-fixed-tablet-en-{left,middle,right}.{png,json}` and the corresponding `id-dark/stagehdr-fixed-tablet-id-*` files: tablet panels.
- `en-light/stagehdr-fixed-tablet-en-center-stage{2,5}.{png,json}` and `id-dark/stagehdr-fixed-tablet-id-center-stage{2,5}.{png,json}`: full Negotiation/Negosiasi and Closing headers and controls.

## Scope and limits

This branch changes stage-header presentation and the fitter's optional normal-size parameter. QA used owned Pipeline fixtures on DEV. No persona, XP or leaderboard mutations were made for this stage-header work. No APK publication or version change was performed.

Native captures cover EN/light and ID/dark on phone and tablet. EN/dark, ID/light, native font-scale 1.3 and extreme custom stage names were not separately captured; font scaling and extreme fallback are covered by deterministic layout tests.
