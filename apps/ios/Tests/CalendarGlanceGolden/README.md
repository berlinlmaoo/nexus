# CalendarGlance golden test (Linux, no Xcode)

Runs `Sources/Shared/CalendarGlance.swift` (what the calendar widgets and watch complications draw) on
the web fixtures (`input/`, copied from nexus `apps/nexus-lovable-ui/src/lib/calendar/fixtures/glance`) at
four moments around a WIB midnight and a month end, and compares with the web golden (`golden/`, from
`fixtures/golden-glance`, built by `glance.test.mjs`). Same files as Android.

    docker run --rm -v $PWD:/w -w /w swift:5.10-jammy sh -c "swiftc -O Sources/Shared/CalendarCore.swift Sources/Shared/AttendanceSnapshot.swift Sources/Shared/CalendarGlance.swift Tests/CalendarGlanceGolden/main.swift -o /tmp/g && /tmp/g Tests/CalendarGlanceGolden"

This folder is not part of any Xcode target.
