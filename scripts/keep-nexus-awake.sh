#!/bin/zsh
set -eu

export PATH="/usr/bin:/bin:/usr/sbin:/sbin"

# Keep the Mac awake for Nexus while allowing the display to sleep.
exec /usr/bin/caffeinate -ims
