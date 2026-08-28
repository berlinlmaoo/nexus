# Controlling Nexus on Proxmox

How to run and operate Nexus when it lives in a guest on a Proxmox host, and
how to give Claude Code enough access to do the operating with you.

## Why two agents

Claude Code sessions started from the web run in an isolated cloud container.
That container has **no network route to your LAN** — private ranges resolve to
its own empty network, not yours. So a web session can read and change the
*code*, but it can never reach the VM, the Docker daemon, or the Proxmox API.

The fix is to run Claude Code where the access already is:

```
┌─ Proxmox host (pve) ────────────────────────────────────┐
│                                                          │
│   claude + pvectl          ┌─ Guest: Nexus ───────────┐  │
│   ├ snapshots              │   claude + nexusctl      │  │
│   ├ start/stop the guest   │   ├ docker compose       │  │
│   └ pvectl ctl -- …  ──────┼─► ├ logs, health, deploy │  │
│                            │   └ postgres, backups    │  │
│                            └──────────────────────────┘  │
└──────────────────────────────────────────────────────────┘
             ▲
             │  git push / pull  (GitHub is the source of truth)
             ▼
   Claude Code on the web — writes code, reviews, opens PRs
```

Day-to-day work belongs in the **guest**. Reach for the **host** agent only for
things the guest cannot do to itself: snapshots, power, and rollback.

## Install

Both bootstraps are idempotent — re-run them any time.

### In the guest (the VM that runs Nexus)

Docker Engine and the compose plugin must already be installed.

```sh
cd /opt/nexus            # wherever the repo is checked out
sudo sh scripts/pve/bootstrap.sh vm
```

Installs `curl git jq ca-certificates ripgrep`, Node.js 22 (if missing or older
than 18), Claude Code, and links `nexusctl` into `/usr/local/bin`.

Then:

```sh
claude                   # sign in once
nexusctl env-check       # verify .env.production
nexusctl status
```

### On the Proxmox host

```sh
sudo sh scripts/pve/bootstrap.sh host
sudo $EDITOR /etc/nexus-pve.conf     # set NEXUS_VMID, NEXUS_VM_TYPE, ALLOWED_VMIDS
pvectl list                          # confirm the VMID is the guest you meant
DRY_RUN=1 pvectl deploy              # rehearse; nothing is executed
```

The bootstrap prints a warning and asks for confirmation first, because an agent
on the hypervisor has root over **every** guest on the node.

## `nexusctl` — inside the guest

Wraps `docker-compose.prod.yml` and `.env.production`, so it behaves the same as
the repo's existing `deploy.sh` / `healthcheck.sh` / `backup_postgres.sh`.

| Command | What it does |
|---|---|
| `status` | compose ps, disk usage, docker usage, health |
| `health` | `GET /api/health` |
| `logs [svc] [-f]` | tail logs, 200 lines by default (`LOG_TAIL` to change) |
| `up` / `down` | start postgres then app / stop both (data kept) |
| `restart [svc...]` | restart app, or the named services |
| `deploy` | pull → build → migrate → restart → verify health |
| `rollback` | restore the previous app image (`nexus-app:prev`) |
| `migrate` | run the Prisma deploy flow only |
| `backup` | run `backup_postgres.sh` |
| `psql` / `shell` | shell into postgres / the app container |
| `env-check` | check required variables are present |
| `prune` | drop dangling images and build cache |

Overrides: `ENV_FILE`, `COMPOSE_FILE`, `DEPLOY_BRANCH`, `ALLOW_DIRTY=1`, `LOG_TAIL`.

`deploy` refuses to run on a dirty working tree unless you pass `ALLOW_DIRTY=1`,
and tags the outgoing image `nexus-app:prev` before building so `rollback` has
somewhere to go.

> `rollback` restores the **app image only**. It does not undo migrations. If a
> deploy changed the schema, roll the whole guest back from a snapshot instead.

## `pvectl` — on the Proxmox host

Read-only by default. Everything that mutates state is gated.

| Command | Notes |
|---|---|
| `list` `status` `resources` `snapshots` | read-only |
| `start` `shutdown` `reboot` | whitelisted VMID only |
| `stop` | hard stop — typed confirmation |
| `snapshot [name]` | auto-named `auto-<timestamp>` if omitted |
| `rollback <name>` | **destructive** — typed confirmation |
| `delsnap <name>` | typed confirmation |
| `exec -- <cmd>` | run a shell command in the guest |
| `ctl -- <args>` | run `nexusctl` in the guest |
| `deploy` | snapshot, then `nexusctl deploy`, with a rollback hint |

### Guardrails

- **VMID whitelist.** Every mutating command checks the target against
  `ALLOWED_VMIDS`. A VMID that is not listed is refused, so a typo cannot take
  down an unrelated guest.
- **Typed confirmation.** `stop`, `rollback`, and `delsnap` require you to type
  an exact string. `ASSUME_YES=1` skips it for scripted use.
- **Non-interactive stdin aborts.** A piped or empty stdin fails loudly rather
  than silently proceeding.
- **`DRY_RUN=1`** prints shell-quoted commands instead of running them.
- **No destroy.** There is deliberately no command that deletes a VM or a disk.

### Reaching into the guest

| Guest type | Transport | Output |
|---|---|---|
| LXC | `pct exec` | streams |
| VM + `NEXUS_VM_SSH` set | `ssh` | streams |
| VM, no SSH | `qm guest exec` | buffered until the command exits |

Set `NEXUS_VM_SSH=root@<guest-ip>` in `/etc/nexus-pve.conf` for full VMs.
Without it, a multi-minute deploy prints nothing until it finishes, and the
guest needs `qemu-guest-agent` installed and running.

## Typical flows

**Ship a change**

```sh
# from the web session: write code, commit, push
# in the guest:
nexusctl deploy
```

**Ship a risky change (schema, dependency bump)**

```sh
# on the host — snapshots first, so a bad migration is recoverable:
pvectl deploy
# if it goes wrong:
pvectl rollback predeploy-<timestamp>
```

**Something is broken right now**

```sh
nexusctl status
nexusctl logs app -f
nexusctl restart
```

## Known inconsistency

`healthcheck.sh` defaults to `APP_PORT=3000`, but `docker-compose.prod.yml`
binds `127.0.0.1:${APP_PORT:-3003}->3000`. They only agree when
`.env.production` sets `APP_PORT` explicitly — which it should. `nexusctl`
follows the compose default (3003) so it probes the port that is actually bound.
Worth reconciling in `healthcheck.sh` separately.
