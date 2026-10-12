# iOS / iPadOS / macOS — dev redesign status

Owner decision (12 Oct 2026): the app ships TOGETHER with the redesigned web. Branch `dev` only (never
`main`); the NEXUS_DEV_SERVER flag + server switch (Settings › Server, or long-press the login title) point
the build at https://nexus-prod.tail765d02.ts.net:8443.

Build on the Mac: `git fetch && git switch dev && git pull && xcodegen generate`, then ⌘B / ⌘R.
Nothing here has been compiled: Linux can only `swiftc -parse` each file (all changed files pass).

Checks that run without Xcode:
- `./scripts/check-localization.sh` — fails on a duplicate Indonesian key across `Sources/Localization*.swift`
  (the same check is the pre-build script in project.yml). New strings live in
  `Sources/LocalizationRedesign.swift`.

## Phase 1 — logic + copy

_In progress._

## Phase 2 — board like web / Notion

_Not started._

## Phase 3 — block editor, GIDEON, templates, iPad/Mac

_Not started._

## Verify on device first

_Filled in as phases land._
