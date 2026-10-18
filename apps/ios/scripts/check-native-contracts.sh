#!/bin/bash
# Small native wire-contract and concurrent-edit checks. No simulator, server credentials or writes.
set -euo pipefail
IOS_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NATIVE_CHECK_TMP="$(mktemp -d "${TMPDIR:-/tmp}/nexus-native-checks.XXXXXX")"
trap 'rm -rf "$NATIVE_CHECK_TMP"' EXIT
cd "$IOS_ROOT"
swiftc Sources/LegalModels.swift Tests/LegalModels/main.swift -o "$NATIVE_CHECK_TMP/legal"
"$NATIVE_CHECK_TMP/legal"
swiftc Sources/TaskEditSafety.swift Tests/TaskEditSafety/main.swift -o "$NATIVE_CHECK_TMP/tasks"
"$NATIVE_CHECK_TMP/tasks"
swiftc Sources/GideonCreditModels.swift Tests/GideonCredits/Stub.swift Tests/GideonCredits/main.swift -o "$NATIVE_CHECK_TMP/credits"
"$NATIVE_CHECK_TMP/credits"
swiftc Sources/ChatSystemText.swift Sources/MessagesModels.swift Sources/ChatAttachment.swift Tests/ChatSystemText/Stub.swift Tests/ChatSystemText/main.swift -o "$NATIVE_CHECK_TMP/chat"
"$NATIVE_CHECK_TMP/chat"
# The block-conversion code is Foundation-only; the rest of the file is the app's networking/editor state.
python3 - "$NATIVE_CHECK_TMP" <<'PY'
from pathlib import Path
import re, sys
out = Path(sys.argv[1])
s = Path('Sources/BlockEditing.swift').read_text()
pure = s[s.index('typealias RawJSON'):s.index('// MARK: - server calls')]
link = re.search(r'struct ExistingLink: Identifiable, Hashable \{.*?\n\}', Path('Sources/QAInteractKit.swift').read_text(), re.S)
if not link: raise SystemExit('ExistingLink model not found')
(out/'conversion.swift').write_text('import Foundation\n'+pure+'\n'+link.group(0)+'\n')
PY
swiftc "$NATIVE_CHECK_TMP/conversion.swift" Tests/BlockEditing/Stub.swift Tests/BlockEditing/main.swift -o "$NATIVE_CHECK_TMP/blocks"
(cd Tests/BlockEditing && "$NATIVE_CHECK_TMP/blocks")
