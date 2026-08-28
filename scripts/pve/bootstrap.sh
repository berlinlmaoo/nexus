#!/bin/sh
# bootstrap.sh — install Claude Code + the Nexus control tooling.
#
#   sh scripts/pve/bootstrap.sh vm      # inside the VM that runs Nexus
#   sh scripts/pve/bootstrap.sh host    # on the Proxmox host (pve)
#
# Both modes are idempotent: re-running only fills in what is missing.
set -eu

MODE="${1:-}"
ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)"
NODE_MAJOR="${NODE_MAJOR:-22}"

die() { echo "!! $*" >&2; exit 1; }
info() { echo "==> $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

case "$MODE" in
  vm|host) ;;
  *) die "Usage: sh scripts/pve/bootstrap.sh vm|host" ;;
esac

[ "$(id -u)" = "0" ] || die "Run as root (or via sudo)."

have apt-get || die "This bootstrap targets Debian/Ubuntu (apt-get not found)."

install_packages() {
  info "Installing base packages"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl git jq ca-certificates ripgrep >/dev/null
  echo "    curl git jq ca-certificates ripgrep"
}

install_node() {
  if have node; then
    current="$(node --version | sed 's/^v//' | cut -d. -f1)"
    if [ "$current" -ge 18 ] 2>/dev/null; then
      echo "    node $(node --version) already present"
      return 0
    fi
    echo "    node $(node --version) is too old (need >= 18), upgrading"
  fi
  info "Installing Node.js $NODE_MAJOR"
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs >/dev/null
  echo "    node $(node --version)"
}

install_claude() {
  if have claude; then
    echo "    claude already installed: $(claude --version 2>/dev/null || echo unknown)"
    return 0
  fi
  info "Installing Claude Code"
  npm install -g @anthropic-ai/claude-code >/dev/null
  have claude || die "claude not on PATH after install — check npm prefix: npm prefix -g"
  echo "    $(claude --version)"
}

link_tool() {
  tool="$1"
  target="$ROOT_DIR/scripts/pve/$tool"
  [ -f "$target" ] || die "Missing $target"
  chmod +x "$target"
  ln -sf "$target" "/usr/local/bin/$tool"
  echo "    /usr/local/bin/$tool -> $target"
}

bootstrap_vm() {
  info "Mode: VM (Nexus application host)"
  install_packages
  install_node
  install_claude

  have docker || die "Docker not found in this VM. Install Docker Engine + the compose plugin first."
  docker compose version >/dev/null 2>&1 || die "The 'docker compose' plugin is missing."
  echo "    $(docker --version)"
  echo "    $(docker compose version)"

  info "Linking nexusctl"
  link_tool nexusctl

  if [ ! -f "$ROOT_DIR/.env.production" ]; then
    echo
    echo "  !! $ROOT_DIR/.env.production is missing."
    echo "     cp $ROOT_DIR/.env.example $ROOT_DIR/.env.production && \$EDITOR \$_"
    echo "     then verify with: nexusctl env-check"
  fi

  cat <<'NEXT'

Done. Next steps in this VM:

  1. claude            # sign in once, then Claude Code has full access here
  2. nexusctl env-check
  3. nexusctl status

Useful:
  nexusctl logs app -f     tail the app
  nexusctl deploy          pull + build + migrate + restart + health
  nexusctl rollback        restore the previous app image
NEXT
}

bootstrap_host() {
  info "Mode: Proxmox host (pve)"
  have qm || die "This does not look like a Proxmox host ('qm' not found)."

  cat <<'WARN'

  !! You are installing an agent with root on the hypervisor.
     It can reach every VM and container on this node, not just Nexus.
     pvectl limits itself to ALLOWED_VMIDS, but a shell is still a shell.
     Prefer running day-to-day work from inside the VM where you can.

WARN
  printf '  Continue? [y/N] '
  read -r answer
  case "$answer" in y|Y|yes|YES) ;; *) echo "Aborted."; exit 0 ;; esac

  install_packages
  install_node
  install_claude

  info "Linking pvectl"
  link_tool pvectl

  if [ ! -f /etc/nexus-pve.conf ]; then
    info "Creating /etc/nexus-pve.conf"
    cp "$ROOT_DIR/scripts/pve/pve.conf.example" /etc/nexus-pve.conf
    chmod 600 /etc/nexus-pve.conf
    echo "    edit it and set NEXUS_VMID / ALLOWED_VMIDS before using pvectl"
  else
    echo "    /etc/nexus-pve.conf already exists — left untouched"
  fi

  cat <<'NEXT'

Done. Next steps on the host:

  1. $EDITOR /etc/nexus-pve.conf     # set NEXUS_VMID, NEXUS_VM_TYPE, ALLOWED_VMIDS
  2. pvectl list                     # confirm the VMID is the right guest
  3. DRY_RUN=1 pvectl deploy         # rehearse without touching anything
  4. claude                          # sign in

Useful:
  pvectl status              guest status + config
  pvectl snapshot            take a snapshot before risky work
  pvectl ctl -- status       run nexusctl inside the guest
  pvectl deploy              snapshot, then deploy, with a rollback hint
NEXT
}

case "$MODE" in
  vm)   bootstrap_vm ;;
  host) bootstrap_host ;;
esac
