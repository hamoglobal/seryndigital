# Seryn Digital dashboard — Next.js app backed by Node's built-in node:sqlite
# (no native/C++ build step needed for the DB layer).
FROM node:22-slim

WORKDIR /app

# Install deps first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci

# App source
COPY . .

# The .db file is git-ignored (never committed) — data/export/*.json is the
# git-tracked snapshot. scripts/import-json.mjs rebuilds data/seryn.db from
# it at container start (see CMD below), so the deployed app always has real
# data even though the binary .db never makes it into the image via git.

RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["sh", "-c", "node scripts/import-json.mjs && npx next start -p ${PORT:-3000}"]
