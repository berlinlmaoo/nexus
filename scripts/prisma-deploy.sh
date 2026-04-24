#!/bin/sh
set -eu

if [ -d "prisma/migrations" ] && find "prisma/migrations" -mindepth 1 -maxdepth 1 -type d | grep -q .; then
  echo "Applying committed Prisma migrations"
  npx prisma migrate deploy
else
  echo "No committed Prisma migrations found. Falling back to guarded schema sync with prisma db push."
  echo "This matches the current repository state, but future schema changes should be committed as migrations."
  npx prisma db push
fi
