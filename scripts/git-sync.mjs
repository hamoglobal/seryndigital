#!/usr/bin/env node
// scripts/git-sync.mjs
//
// Commits + pushes data/export/*.json to GitHub. Called automatically at the
// end of the 11:00 daily ingestion job (watch-ingest.mjs); can also be run
// standalone (`npm run git-sync` style: `node scripts/git-sync.mjs`).
//
// Design note: this does its git work in a FRESH shallow clone under the
// OS temp dir on every run, rather than operating git directly on this
// project's own folder. That folder is a Windows path bridged into the
// sandbox, which has shown flaky unlink/rename behavior for git's lock
// files (stale .git/index.lock etc.). A disposable clone sidesteps that
// entirely and is cheap since the repo is small.
//
// Auth: an SSH deploy key lives at .ssh/seryn_deploy_key (git-ignored, never
// committed) with write access to the repo. .ssh/git-ssh-wrapper.sh wraps ssh
// with that key + the sandbox's outbound proxy. We override GIT_SSH_COMMAND
// (env takes precedence over core.sshCommand) and single-quote the wrapper
// path ourselves, since git invokes GIT_SSH_COMMAND's value as literal shell
// text without adding quoting, and this project's path contains a space
// ("APP Seryn").
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const wrapperPath = path.join(projectRoot, '.ssh', 'git-ssh-wrapper.sh');
const REMOTE = 'git@github.com:hamoglobal/seryndigital.git';

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, GIT_SSH_COMMAND: `'${wrapperPath}'` },
  });
}

export function syncToGitHub({ message } = {}) {
  if (!fs.existsSync(wrapperPath)) {
    console.log('[git-sync] no SSH deploy key wrapper found — skipping (GitHub push not set up).');
    return { skipped: true, reason: 'no-ssh-key' };
  }
  const exportDir = path.join(projectRoot, 'data', 'export');
  if (!fs.existsSync(exportDir)) {
    console.log('[git-sync] no data/export directory — nothing to sync.');
    return { skipped: true, reason: 'no-export-dir' };
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seryn-git-sync-'));
  try {
    git(['clone', '--depth', '1', '--quiet', REMOTE, tmpDir]);
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
    git(['push', '--quiet', 'origin', 'HEAD:main'], tmpDir);
    console.log(`[git-sync] committed & pushed: ${commitMsg}`);
    return { skipped: false, pushed: true };
  } catch (err) {
    console.error(`[git-sync] failed: ${err.message}`);
    return { skipped: false, pushed: false, error: err.message };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  syncToGitHub();
}
