# Seryn Digital dashboard — Next.js app backed by Node's built-in node:sqlite
# (no native/C++ build step needed for the DB layer).
FROM node:22-slim

# lib/gitSync.js shells out to the `git` binary at runtime (to push role
# changes / users.json to GitHub so they survive the next deploy). The
# node:22-slim base image does NOT include git, so without this the git-sync
# call fails silently with ENOENT on every push attempt (caught and only
# logged to console.error, so it looked like nothing was wrong). ca-certificates
# is required too, or the HTTPS clone/push to github.com fails TLS verification.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

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
