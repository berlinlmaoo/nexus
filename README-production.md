# Nexus Production Deployment

This guide turns Nexus into a production-ready, low-cost, self-hosted deployment on:

- Mac mini as the primary production host
- Synology NAS as the backup and optional file sync target
- Cloudflare Tunnel as the only public ingress

## Final architecture

- `https://nexus.patsgroup.id` terminates at Cloudflare Tunnel
- `cloudflared` runs on the Mac mini host as a macOS service
- `cloudflared` forwards traffic to `http://127.0.0.1:3000`
- Docker Compose on the Mac mini runs:
  - `app` = Nexus Next.js monolith
  - `postgres` = primary PostgreSQL database
  - `migrate` = one-off Prisma deploy task
- PostgreSQL is private on the Docker network only
- Daily PostgreSQL backups are created on the Mac mini and synced to the NAS
- Uploads are stored locally on the Mac mini and can be synced to the NAS with `sync_uploads_to_nas.sh`

## Production files

- `Dockerfile.prod`
- `docker-compose.prod.yml`
- `.env.example`
- `deploy.sh`
- `backup_postgres.sh`
- `restore_postgres.sh`
- `healthcheck.sh`
- `sync_uploads_to_nas.sh`
- `scripts/prisma-deploy.sh`
- `deploy/cloudflared/config.example.yml`
- `deploy/cloudflared/com.patsgroup.nexus.cloudflared.plist.example`

## 1. Prepare the Mac mini

Clone the repository and create the production env file:

```bash
cp /Users/jagainmacmini1/Documents/nexus/.env.example /Users/jagainmacmini1/Documents/nexus/.env.production
```

Fill in at least:

- `AUTH_SECRET`
- `POSTGRES_PASSWORD`
- `DATABASE_URL`
- `NEXTAUTH_URL=https://nexus.patsgroup.id`
- `NEXT_PUBLIC_APP_URL=https://nexus.patsgroup.id`
- SMTP settings if OTP/email delivery is needed
- NAS SSH backup settings if you want automatic sync to the NAS

Create local data directories:

```bash
mkdir -p /Users/jagainmacmini1/Documents/nexus/var/postgres \
  /Users/jagainmacmini1/Documents/nexus/var/uploads/attachments \
  /Users/jagainmacmini1/Documents/nexus/var/uploads/attendance \
  /Users/jagainmacmini1/Documents/nexus/var/uploads/project-icons \
  /Users/jagainmacmini1/Documents/nexus/backups/postgres/daily \
  /Users/jagainmacmini1/Documents/nexus/backups/postgres/weekly
```

## 2. Deploy Nexus on the Mac mini

```bash
cd /Users/jagainmacmini1/Documents/nexus
chmod +x deploy.sh backup_postgres.sh restore_postgres.sh healthcheck.sh sync_uploads_to_nas.sh scripts/prisma-deploy.sh
./deploy.sh
```

This will:

1. build the production image
2. start PostgreSQL
3. wait for database readiness
4. apply Prisma schema changes
5. start the app
6. run the healthcheck

## 3. Cloudflare Tunnel on the Mac mini

Install `cloudflared` on the host:

```bash
brew install cloudflared
```

Authenticate and create the tunnel:

```bash
cloudflared tunnel login
cloudflared tunnel create nexus-prod
cloudflared tunnel route dns nexus-prod nexus.patsgroup.id
```

Copy the config example:

```bash
mkdir -p ~/.cloudflared
cp deploy/cloudflared/config.example.yml ~/.cloudflared/config.yml
```

Edit:

- tunnel UUID
- credentials file path

Then run a foreground test:

```bash
cloudflared tunnel --config ~/.cloudflared/config.yml run
```

If that works, install it as a macOS service:

```bash
sudo cp deploy/cloudflared/com.patsgroup.nexus.cloudflared.plist.example /Library/LaunchDaemons/com.patsgroup.nexus.cloudflared.plist
sudo launchctl bootstrap system /Library/LaunchDaemons/com.patsgroup.nexus.cloudflared.plist
sudo launchctl enable system/com.patsgroup.nexus.cloudflared
sudo launchctl kickstart -k system/com.patsgroup.nexus.cloudflared
```

## 4. Backups

Run a manual backup:

```bash
./backup_postgres.sh
```

Behavior:

- keeps the latest 7 daily backups
- keeps the latest 4 weekly backups
- stores them in:
  - `./backups/postgres/daily`
  - `./backups/postgres/weekly`
- if NAS SSH settings are present, syncs to the NAS after each backup

Recommended macOS cron replacement:

```bash
crontab -e
```

Example schedule:

```cron
0 2 * * * cd /Users/jagainmacmini1/Documents/nexus && ENV_FILE=/Users/jagainmacmini1/Documents/nexus/.env.production ./backup_postgres.sh >> /Users/jagainmacmini1/Documents/nexus/backups/postgres/backup.log 2>&1
15 2 * * * cd /Users/jagainmacmini1/Documents/nexus && ENV_FILE=/Users/jagainmacmini1/Documents/nexus/.env.production ./sync_uploads_to_nas.sh >> /Users/jagainmacmini1/Documents/nexus/backups/postgres/uploads-sync.log 2>&1
```

## 5. Restore workflow

Restore a backup:

```bash
./restore_postgres.sh ./backups/postgres/daily/nexus_YYYY-MM-DD_HHMMSS.sql.gz --yes
```

The restore script:

1. stops the app
2. recreates the target database
3. restores the SQL dump
4. runs the Prisma deploy flow
5. starts the app again

## 6. Prisma production flow

The repo currently does not contain committed Prisma migrations.

Because of that, `scripts/prisma-deploy.sh` behaves like this:

- if `prisma/migrations/` exists and contains migrations:
  - runs `npx prisma migrate deploy`
- otherwise:
  - runs `npx prisma db push --skip-generate`

This is the safest practical bridge for the current repo state.
For future schema changes, commit real Prisma migrations so production deploys can rely on `migrate deploy`.

## 7. Smoke tests

```bash
./healthcheck.sh
curl -I http://127.0.0.1:3000/login
curl -I https://nexus.patsgroup.id/login
docker compose --env-file .env.production -f docker-compose.prod.yml ps
docker compose --env-file .env.production -f docker-compose.prod.yml logs --tail=100 app
```

## 8. Rollback

Application rollback:

1. check out the previous known-good git commit
2. rerun `./deploy.sh`

Database rollback:

1. choose the desired backup file
2. run `./restore_postgres.sh <backup-file> --yes`

## 9. Why cloudflared runs on the host

Running `cloudflared` as a host-level macOS service is the simplest and most maintainable choice here:

- no router port forwarding
- the app can stay bound to `127.0.0.1`
- fewer moving Docker parts
- the tunnel survives app container rebuilds
- easier to diagnose separately from the app stack

## 10. Optional NAS standby tunnel

Only do this if you really want a second tunnel path.

For most single-person setups, a second `cloudflared` instance on the NAS adds more operational complexity than value.
The simpler default is:

- primary tunnel on the Mac mini only
- NAS used for backups and file sync
