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
swiftc Sources/SessionIdentity.swift Tests/SessionIdentity/main.swift -o "$NATIVE_CHECK_TMP/identity"
"$NATIVE_CHECK_TMP/identity"
swiftc Sources/GideonPerformanceModels.swift Tests/GideonPerformance/main.swift -o "$NATIVE_CHECK_TMP/performance"
"$NATIVE_CHECK_TMP/performance" Tests/GideonPerformance/response.json
swiftc Sources/GideonTaskModels.swift Tests/GideonTasks/main.swift -o "$NATIVE_CHECK_TMP/gideon-tasks"
"$NATIVE_CHECK_TMP/gideon-tasks"
swiftc Sources/GideonCreditModels.swift Tests/GideonCredits/Stub.swift Tests/GideonCredits/main.swift -o "$NATIVE_CHECK_TMP/credits"
"$NATIVE_CHECK_TMP/credits"
swiftc Sources/ChatSystemText.swift Sources/MessagesModels.swift Sources/ChatAttachment.swift Tests/ChatSystemText/Stub.swift Tests/ChatSystemText/main.swift -o "$NATIVE_CHECK_TMP/chat"
"$NATIVE_CHECK_TMP/chat"
swiftc Sources/AppDateLocale.swift Sources/NativeRefusal.swift Sources/LocalizationRun21.swift Tests/GideonCredits/Stub.swift Tests/NativeRefusal/main.swift -o "$NATIVE_CHECK_TMP/refusals"
"$NATIVE_CHECK_TMP/refusals"
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
swiftc Sources/GideonTaskModels.swift Sources/MeetingModels.swift Sources/MeetingStore.swift Tests/Meetings/Stub.swift Tests/Meetings/main.swift -o "$NATIVE_CHECK_TMP/meetings"
"$NATIVE_CHECK_TMP/meetings"
swiftc Sources/Shared/CalendarCore.swift Tests/CalendarFolders/main.swift -o "$NATIVE_CHECK_TMP/calendar-folders"
"$NATIVE_CHECK_TMP/calendar-folders"
swiftc Sources/Shared/CalendarCore.swift Tests/CalendarGolden/main.swift -o "$NATIVE_CHECK_TMP/calendar-golden"
"$NATIVE_CHECK_TMP/calendar-golden" Tests/CalendarGolden
# Exercise NativeAPI through the app's actual URL-building branch (no networking or credentials).
python3 - "$NATIVE_CHECK_TMP" <<'PY'
from pathlib import Path
import sys
client = Path('Sources/APIClient.swift').read_text()
start = client.index('        let url: URL', client.index('func makeRequest('))
end = client.index('        var req = URLRequest(url: url)', start)
stub = Path('Tests/NativeRequests/Stub.swift').read_text().replace('        // BUILD_REQUEST_URL', client[start:end])
Path(sys.argv[1], 'request-stub.swift').write_text(stub)
gideon = Path('Sources/Gideon.swift').read_text()
a = gideon.index('        var url = Config.baseURL', gideon.index('private static func authed('))
b = gideon.index('        var request = URLRequest(url: url)', a)
enc = gideon[gideon.index('    private static func enc(_ s: String)'):].splitlines()[0].replace('private static', 'static')
probe = 'struct Config { static let baseURL = URL(string: "https://native.invalid")! }\nstruct GideonRequestProbe {\n    static func url(_ path: String, query: String? = nil) -> URL {\n' + gideon[a:b] + '        return url\n    }\n' + enc + '\n}\n'
with Path(sys.argv[1], 'request-stub.swift').open('a') as f: f.write(probe)

PY
swiftc Sources/NativeAPI.swift "$NATIVE_CHECK_TMP/request-stub.swift" Tests/NativeRequests/main.swift -o "$NATIVE_CHECK_TMP/requests"
"$NATIVE_CHECK_TMP/requests"
# Decode the real loose-value model with tool extras (long text, numeric/null cell changes).
python3 - "$NATIVE_CHECK_TMP" <<'PY'
from pathlib import Path
import sys
s=Path('Sources/Gideon.swift').read_text();a=s.index('struct GideonLoose:');b=s.index('/// One thing GIDEON did',a)
Path(sys.argv[1],'loose.swift').write_text('import Foundation\n'+s[a:b])
PY
swiftc "$NATIVE_CHECK_TMP/loose.swift" Sources/GideonActionModels.swift Tests/GideonTools/main.swift -o "$NATIVE_CHECK_TMP/tools"
"$NATIVE_CHECK_TMP/tools"
swiftc Sources/PresenceModels.swift Sources/PresenceStore.swift Tests/Presence/Stub.swift Tests/Presence/main.swift -o "$NATIVE_CHECK_TMP/presence"
"$NATIVE_CHECK_TMP/presence"
# Use the real history converter and SSE DTO; review must discard even unexpected memory metadata.
python3 - "$NATIVE_CHECK_TMP" <<'PY'
from pathlib import Path
import sys
s=Path('Sources/Gideon.swift').read_text()
def block(start):
 a=s.index(start);b=s.index('{',a);depth=1;i=b+1
 while depth:
  if s[i]=='{':depth+=1
  elif s[i]=='}':depth-=1
  i+=1
 return s[a:i]
history=block('struct GideonHistoryResponse:')
event=block('private struct GideonEvent:').replace('private struct','struct',1)
convert=block('static func historyTurns(')
Path(sys.argv[1],'memory-history.swift').write_text('import Foundation\n'+history+'\n'+event+'\nenum GideonHistoryProbe {\n'+convert+'\n}\n')
PY
swiftc Sources/GideonMemoryModels.swift Sources/GideonMemoryStore.swift "$NATIVE_CHECK_TMP/memory-history.swift" Tests/GideonMemory/Stub.swift Tests/GideonMemory/main.swift -o "$NATIVE_CHECK_TMP/memory"
"$NATIVE_CHECK_TMP/memory"

swiftc Sources/Sheets/SheetGridZoom.swift Tests/SheetZoom/main.swift -o "$NATIVE_CHECK_TMP/sheet-zoom"
"$NATIVE_CHECK_TMP/sheet-zoom"

python3 - "$NATIVE_CHECK_TMP" <<'PYFORM'
from pathlib import Path
import sys
s=Path('Sources/FormBuilderModels.swift').read_text()
pure=s[:s.index('/// The link a form is shared by.')]
Path(sys.argv[1],'form-wire.swift').write_text(pure+'\nstruct FormLink { static func url(slug: String?, id: String) -> URL { URL(string: "https://forms.invalid/" + id)! } }\n')
PYFORM
swiftc "$NATIVE_CHECK_TMP/form-wire.swift" Sources/FormCoedit.swift Tests/FormCoedit/main.swift -o "$NATIVE_CHECK_TMP/form-coedit"
"$NATIVE_CHECK_TMP/form-coedit"
swiftc Sources/StartupModalQueue.swift Tests/StartupModalQueue/main.swift -o "$NATIVE_CHECK_TMP/startup-modals"
"$NATIVE_CHECK_TMP/startup-modals"
