# CalendarCore golden test (Linux, no Xcode)

Runs `Sources/Shared/CalendarCore.swift` on the server golden output (`server/`, copied from nexus
`src/lib/calendar/fixtures/golden`) and compares with the web client golden (`client/`, from nexus
`apps/nexus-lovable-ui/src/lib/calendar/fixtures/golden-client`). Same files as the web and Android.

    docker run --rm -v $PWD:/w -w /w swift:5.10-jammy sh -c "swiftc -O Sources/Shared/CalendarCore.swift Tests/CalendarGolden/main.swift -o /tmp/g && /tmp/g Tests/CalendarGolden"

This folder is not part of any Xcode target.
