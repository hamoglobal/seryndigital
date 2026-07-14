#!/usr/bin/env node
// scripts/git-sync.mjs
//
// Commits + pushes data/export/*.json to GitHub. Called automatically at the
// end of the 11:00 daily ingestion job (watch-ingest.mjs) so the repo always
// reflects the latest ingested data, and can also be run standalone.
//
// Auth: an SSH deploy key lives at .ssh/seryn_deploy_key (git-ignored, never
// committed). .ssh/git-ssh-wrapper.sh wraps ssh with that key + the sandbox's
// outbound proxy. We must override GIT_SSH_COMMAND (env takes precedence over
// core.sshCommand) and single-quote the wrapper path ourselves, because the
// project lives under a path containing a space ("APP Seryn") and git invokes
// GIT_SSH_COMMAND's value as literal shell text without adding quoting itself.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const wrapperPath = path.join(projectRoot, '.ssh', 'git-ssh-wrapper.sh');

function git(args, opts = {}) {
  return execFileSync('git', args, {
    cwd: projectRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_SSH_COMMAND: `'${wrapperPath}'`,
    },
    ...opts,
  });
}

export function syncToGitHub({ message } = {}) {
  if (!fs.existsSync(path.join(projectRoot, '.git'))) {
    console.log('[git-sync] no .git directory found — skipping (not set up yet).');
    return { skipped: true, reason: 'no-git-repo' };
  }
  if (!fs.existsSync(wrapperPath)) {
    console.log('[git-sync] no SSH deploy key wrapper found — skipping.');
    return { skipped: true, reason: 'no-ssh-key' };
  }

  git(['add', 'data/export']);
  const status = git(['status', '--porcelain', '--', 'data/export']).trim();
  if (!status) {
    console.log('[git-sync] no data changes to commit.');
    return { skipped: true, reason: 'no-changes' };
  }

  const commitMsg = message || `data: auto-update from ingestion (${new Date().toISOString().slice(0, 10)})`;
  git(['commit', '-m', commitMsg]);
  console.log(`[git-sync] committed: ${commitMsg}`);

  try {
    git(['push', 'origin', 'HEAD:main']);
    console.log('[git-sync] pushed to origin/main.');
    return { skipped: false, pushed: true };
  } catch (err) {
    console.error(`[git-sync] push failed: ${err.message}`);
    return { skipped: false, pushed: false, error: err.message };
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  syncToGitHub();
}
