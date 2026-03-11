#!/bin/sh
set -eu

mkdir -p data uploads

pnpm exec drizzle-kit push

export HOSTNAME=0.0.0.0
export PORT="${PORT:-3000}"

mkdir -p .next/standalone/.next
ln -sfn /app/.next/static .next/standalone/.next/static

exec node .next/standalone/server.js
