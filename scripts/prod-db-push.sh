#!/usr/bin/env bash
# Apply the (verified 100% additive) new tables to the PROD database.
# Adds: UserXp, XpTransaction, UserStreak, Quest, QuestClaim, Conversation,
# ConversationMember, Message (+enum/index/FK). No DROP/ALTER on existing tables.
# Prod DB already backed up at backups/prod-20260602/db-nexus.dump
set -euo pipefail

NET=$(docker inspect nexus-app --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{"\n"}}{{end}}' | head -n1)
DBURL=$(docker inspect nexus-app --format '{{range .Config.Env}}{{println .}}{{end}}' | grep '^DATABASE_URL=' | cut -d= -f2-)

count() { docker exec nexus-postgres psql -U nexus_user -d nexus_db -t -c "SELECT count(*) FROM information_schema.tables WHERE table_schema='public';" | tr -d ' '; }

echo "network: ${NET}"
echo "tables BEFORE: $(count)"
echo "=== applying prisma db push (additive) ==="
docker run --rm --network "$NET" -e DATABASE_URL="$DBURL" nexus-app:beta sh -c 'npx prisma db push'
echo "tables AFTER: $(count)"
