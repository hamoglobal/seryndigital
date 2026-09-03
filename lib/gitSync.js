// lib/gitSync.js
//
// Pure, side-effect-free implementation of syncToGitHub — moved out of
// scripts/git-sync.mjs so it can be safely imported from Next.js server
// code (lib/usersStore.js, for pushing role changes). scripts/git-sync.mjs
// keeps a `node scripts/git-sync.mjs` CLI self-invoke
// (`fileURLToPath(import.meta.url) === process.argv[1]`) at its own module
// top level; importing that file directly from a Next.js route caused
// Next's webpack bundling of import.meta.url/process.argv to break in a way
// that threw "TypeError: s is not a function" during `next build`'s page
// data collection for /api/admin/users. This file has no top-level
// self-invocation at all, so it's safe to import from anywhere.
//
// Commits + pushes data/export/*.json to GitHub. Called automatically at the
// end of the 11:00 daily ingestion job and whenever an admin changes a
// user's role (lib/usersStore.js).
//
// Design note: this does its git work in a FRESH shallow clone under the
// OS temp dir on every run, rather than operating git directly on this
// project's own folder. That folder is a Windows path bridged into the
// sandbox, which has shown flaky unlink/rename behavior for git's lock
// files (stale .git/index.lock etc.). A disposable clone sidesteps that
// entirely and is cheap since the repo is small.
//
// Auth: HTTPS + a GitHub fine-grained Personal Access Token (contents:
// read/write on this repo only), stored at .ssh/github_pat.txt (git-ignored,
// never committed, 0600 perms). IMPORTANT: never log the raw remote URL or
// raw err.message — both can contain the token in plain text. Always redact
// via redactToken() first.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const projectRoot = process.cwd();
const tokenPath = path.join(projectRoot, '.ssh', 'github_pat.txt');
const REPO_PATH = 'hamoglobal/seryndigital.git';

function readToken() {
  return fs.readFileSync(tokenPath, 'utf8').trim();
}

function redactToken(str, token) {
  return token ? str.split(token).join('***REDACTED***') : str;
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

export function syncToGitHub({ message } = {}) {
  if (!fs.existsSync(tokenPath)) {
    console.log('[git-sync] no GitHub PAT file found (.ssh/github_pat.txt) — skipping (GitHub push not set up).');
    return { skipped: true, reason: 'no-token' };
  }
  const exportDir = path.join(projectRoot, 'data', 'export');
  if (!fs.existsSync(exportDir)) {
    console.log('[git-sync] no data/export directory — nothing to sync.');
    return { skipped: true, reason: 'no-export-dir' };
  }

  const token = readToken();
  const remoteUrl = `https://x-access-token:${token}@github.com/${REPO_PATH}`;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seryn-git-sync-'));
  try {
    git(['clone', '--depth', '1', '--quiet', remoteUrl, tmpDir]);
    fs.mkdirSync(path.join(tmpDir, 'data', 'export'), { recursive: true });
    for (const f of fs.readdirSync(exportDir)) {
      fs.copyFileSync(path.join(exportDir, f), path.join(tmpDir, 'data', 'export', f));
    }

    git(['config', 'user.email', 'marketinghamoglobal@gmail.com'], tmpDir);
    git(['config', 'user.name', 'Seryn MK'], tmpDir);
    git(['add', 'data/export'], tmpDir);

    const status = git(['status', '--porcelain', '--', 'data/export'], tmpDir).trim();
    if (!status) {
      console.log('[git-sync] no data changes to commit.');
      return { skipped: true, reason: 'no-changes' };
    }

    const commitMsg = message || `data: auto-update from ingestion (${new Date().toISOString().slice(0, 10)})`;
    git(['commit', '--quiet', '-m', commitMsg], tmpDir);
    git(['push', '--quiet', remoteUrl, 'HEAD:main'], tmpDir);
    console.log(`[git-sync] committed & pushed: ${commitMsg}`);
    return { skipped: false, pushed: true };
  } catch (err) {
    const safeMessage = redactToken(err.message, token);
    console.error(`[git-sync] failed: ${safeMessage}`);
    return { skipped: false, pushed: false, error: safeMessage };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
