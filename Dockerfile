FROM node:20-alpine AS base

ARG PNPM_VERSION=9.15.9

# Install pnpm
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate

# Install ffmpeg with libass for subtitle burn-in, and fonts for CJK subtitles
RUN apk add --no-cache ffmpeg font-noto-cjk

# --- Dependencies ---
FROM base AS deps
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# --- Build ---
FROM deps AS builder
COPY . .
RUN pnpm run build

# --- Production ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

# Copy built assets
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/drizzle ./drizzle

RUN mkdir -p /app/data /app/uploads

EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV DATABASE_URL="file:/app/data/aicomic.db"
ENV UPLOAD_DIR="/app/uploads"

CMD ["node", "server.js"]
