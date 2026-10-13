#!/bin/bash
# Fails when an Indonesian translation key appears twice across Sources/Localization*.swift.
#
# A Swift dictionary LITERAL traps at runtime on a duplicate key ("Dictionary literal contains duplicate
# keys"), and the Indonesian tables are only built once someone picks Bahasa Indonesia — 0.1.5 crashed on
# every launch for those users. project.yml runs the same check as a pre-build script; this copy is for
# Linux / before a commit:  ./scripts/check-localization.sh
cd "$(dirname "$0")/.." || exit 2
# Byte-wise compare: in a UTF-8 locale macOS sort/uniq collate "Choose" and "Choose…" as equal.
export LC_ALL=C
DUP=$(cat Sources/Localization*.swift | grep -oE '"([^"\\]|\\.)*"[[:space:]]*:' | sed -E 's/[[:space:]]*:$//' | sort | uniq -d)
if [ -n "$DUP" ]; then
  echo "error: duplicate localization keys:"
  echo "$DUP" | sed 's/^/  /'
  exit 1
fi
echo "localization: $(cat Sources/Localization*.swift | grep -cE '^[[:space:]]*"([^"\\]|\\.)*"[[:space:]]*:') keys, no duplicates"
