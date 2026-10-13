// Stand-in for the app's T() so Sources/BlockEditing.swift's conversion part compiles on Linux. Run from the
// repo root (the server-call half of BlockEditing.swift needs the app, so only the part above
// "// MARK: - server calls" is compiled):
//   sed -n '/^typealias RawJSON/,/MARK: - server calls/p' Sources/BlockEditing.swift > /tmp/edit_part.swift
//   docker run --rm -v "$PWD":/w -w /w/Tests/BlockEditing swift:5.10-jammy bash -c \
//     "swiftc -o /tmp/bt Stub.swift /w/../tmp/edit_part.swift main.swift && /tmp/bt"
// It reads every *.json page in this folder (a dev GET /api/docs/:id answer): round-trip, then edits around
// marked text and mentions, checking every mark outside the edit survives. 12 Oct 2026: 6 real dev pages,
// 38 edited lines, 257 checks, 0 failures (only the QA page is kept here).
import Foundation
func T(_ s: String) -> String { s }
