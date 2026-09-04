// lib/usersStore.js
//
// Flat-file store for Google-login users + their access role, backing the
// admin "danh sách user / set quyền" page. Deliberately NOT a table in
// data/seryn.db: that SQLite file is rebuilt from data/export/*.json on
// every container start (see scripts/import-json.mjs), so anything written
// only there would vanish on the next deploy. Instead this lives at
// data/export/users.json — same git-tracked snapshot folder as the report
// data — and role changes are pushed to GitHub immediately via
// scripts/git-sync.mjs so they survive the next Render deploy.
//
// Roles: 'pending' (logged in, not yet approved — sees the waiting screen),
// 'viewer' (full dashboard access), 'admin' (dashboard + /admin user
// management). Emails listed in the ADMIN_EMAILS env var (comma-separated)
// are auto-promoted to 'admin' the first time they sign in; emails listed in
// VIEWER_EMAILS (comma-separated) are auto-promoted to 'viewer' the same
// way. Anyone else stays 'pending' until an admin approves them from /admin.
import fs from 'node:fs';
import path from 'node:path';
import { syncToGitHub } from './gitSync.js';

const USERS_PATH = process.env.SERYN_USERS_PATH || path.join(process.cwd(), 'data', 'export', 'users.json');

function adminEmailSet() {
  return new Set(
    (process.env.ADMIN_EMAILS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

function viewerEmailSet() {
  return new Set(
    (process.env.VIEWER_EMAILS || '')
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** Role this email should auto-get on login per ADMIN_EMAILS/VIEWER_EMAILS, or null if neither lists it. */
function autoRoleFor(norm) {
  if (adminEmailSet().has(norm)) return 'admin';
  if (viewerEmailSet().has(norm)) return 'viewer';
  return null;
}

function readAll() {
  try {
    const raw = fs.readFileSync(USERS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(users) {
  fs.mkdirSync(path.dirname(USERS_PATH), { recursive: true });
  fs.writeFileSync(USERS_PATH, JSON.stringify(users, null, 2) + '\n');
}

/** Best-effort push of the users snapshot to GitHub so a role change survives the next deploy. */
async function persist(reason) {
  try {
    // syncToGitHub copies the whole data/export/ folder (including users.json) and
    // pushes it in one commit — same mechanism the daily ingest pipeline already uses.
    await syncToGitHub({ message: `chore: ${reason}` });
  } catch (err) {
    console.error('[usersStore] git-sync failed (role change is saved locally but not yet pushed):', err?.message || err);
  }
}

export function listUsers() {
  return readAll().sort((a, b) => (b.lastLoginAt || '').localeCompare(a.lastLoginAt || ''));
}

export function getUserByEmail(email) {
  if (!email) return null;
  const norm = email.toLowerCase();
  return readAll().find(u => u.email.toLowerCase() === norm) || null;
}

/** Called from the NextAuth signIn callback on every successful Google login. */
export async function upsertUserOnLogin({ email, name, image }) {
  if (!email) return null;
  const norm = email.toLowerCase();
  const users = readAll();
  const now = new Date().toISOString();
  const existing = users.find(u => u.email.toLowerCase() === norm);

  if (existing) {
    existing.name = name || existing.name;
    existing.image = image || existing.image;
    existing.lastLoginAt = now;
    // Re-apply ADMIN_EMAILS/VIEWER_EMAILS on every login, not just at first
    // creation. This recovers auto-admins/auto-viewers if the users.json
    // snapshot was ever lost (e.g. an earlier deploy where the git-sync push
    // was silently failing) and the record got re-created as 'pending'.
    // Never downgrades — admin > viewer > pending, and a role an admin set
    // by hand (e.g. manually demoting someone) is only overridden upward,
    // never replaced with a lower auto-role.
    const rank = { pending: 0, viewer: 1, admin: 2 };
    const auto = autoRoleFor(norm);
    const shouldUpgrade = auto && rank[auto] > rank[existing.role];
    if (shouldUpgrade) existing.role = auto;
    writeAll(users);
    // Push on every login, not just new-user creation — lastLoginAt (and
    // possibly role, above) changed, and this is the only reliable place to
    // catch up a git remote that's missing users.json entirely (e.g. after
    // the git-sync push was broken and has just been fixed).
    await persist(shouldUpgrade ? `auto-promote ${email} to ${auto}` : `login ${email}`);
    return existing;
  }

  const role = autoRoleFor(norm) || 'pending';
  const record = { email, name: name || '', image: image || '', role, createdAt: now, lastLoginAt: now };
  users.push(record);
  writeAll(users);
  // A brand-new user (especially an auto-admin) is worth pushing right away
  // so the record isn't lost if the container restarts before an admin acts.
  await persist(`add user ${email} (role=${role})`);
  return record;
}

/** Called from the admin API when an admin changes someone's role. */
export async function setUserRole(email, role) {
  if (!['pending', 'viewer', 'admin'].includes(role)) {
    throw new Error(`Invalid role: ${role}`);
  }
  const users = readAll();
  const norm = email.toLowerCase();
  const existing = users.find(u => u.email.toLowerCase() === norm);
  if (!existing) throw new Error(`No such user: ${email}`);
  existing.role = role;
  writeAll(users);
  await persist(`set role of ${email} to ${role}`);
  return existing;
}
