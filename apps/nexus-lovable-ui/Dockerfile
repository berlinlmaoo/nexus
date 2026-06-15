# Stage 1: Build
FROM oven/bun:1-alpine AS builder

WORKDIR /app

# Install dependencies first (cache layer)
COPY package.json bun.lock bunfig.toml tsconfig.json vite.config.ts wrangler.jsonc components.json ./
COPY .env* ./ 2>/dev/null || true
RUN bun install --frozen-lockfile

# Copy source and build
COPY src ./src
RUN bun run build

# Stage 2: Serve
FROM oven/bun:1-alpine

WORKDIR /app

# Copy built artifacts and necessary files for preview
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json bun.lock bunfig.toml vite.config.ts wrangler.jsonc ./

# Vite preview port
EXPOSE 4173

# Bind to all interfaces so Docker can reach it
CMD ["bun", "run", "preview", "--", "--host", "0.0.0.0"]
