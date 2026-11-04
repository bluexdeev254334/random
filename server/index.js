import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import os from 'node:os';
import Database from 'better-sqlite3';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { UAParser } from 'ua-parser-js';

const app = express();
const port = Number(process.env.PORT || 3001);
const databasePath = path.resolve(process.env.DB_PATH || 'data/app.db');
const userCookie = 'draw_session';
const adminCookie = 'admin_session';
const siteName = process.env.SITE_NAME || 'Lớp học 11B7';
const seatCount = 35;

if (process.env.TRUST_PROXY) {
  const proxySetting = process.env.TRUST_PROXY.trim();
  const proxyHops = Number(proxySetting);
  app.set('trust proxy', proxySetting !== '' && Number.isInteger(proxyHops) ? proxyHops : proxySetting);
}
fs.mkdirSync(path.dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS roles (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    level INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS permissions (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE IF NOT EXISTS role_permissions (
    role_id INTEGER NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id INTEGER NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
  );
  CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    role_id INTEGER NOT NULL REFERENCES roles(id),
    is_active INTEGER NOT NULL DEFAULT 1,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS user_sessions (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    token_hash TEXT NOT NULL UNIQUE,
    ip TEXT NOT NULL,
    user_agent TEXT NOT NULL,
    browser TEXT NOT NULL,
    os TEXT NOT NULL,
    device TEXT NOT NULL,
    created_at TEXT NOT NULL,
    ended_at TEXT,
    has_spun INTEGER NOT NULL DEFAULT 0,
    last_result INTEGER
  );
  CREATE TABLE IF NOT EXISTS access_logs (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    session_id INTEGER NOT NULL REFERENCES user_sessions(id),
    ip TEXT NOT NULL,
    visited_at TEXT NOT NULL,
    completed_spin INTEGER NOT NULL DEFAULT 0,
    selected_number INTEGER
  );
  CREATE TABLE IF NOT EXISTS spin_numbers (
    number INTEGER PRIMARY KEY CHECK(number BETWEEN 1 AND 35),
    status TEXT NOT NULL CHECK(status IN ('available', 'used')),
    selected_by_user_id INTEGER REFERENCES users(id),
    session_id INTEGER REFERENCES user_sessions(id),
    selected_at TEXT
  );
  CREATE TABLE IF NOT EXISTS spin_history (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id),
    session_id INTEGER NOT NULL REFERENCES user_sessions(id),
    name TEXT NOT NULL,
    ip TEXT NOT NULL,
    selected_number INTEGER NOT NULL UNIQUE REFERENCES spin_numbers(number),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS blocked_ips (
    ip TEXT PRIMARY KEY,
    blocked_by INTEGER REFERENCES admins(id),
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS classroom_layout (
    id INTEGER PRIMARY KEY,
    version_name TEXT NOT NULL,
    json_data TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS system_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_by INTEGER REFERENCES admins(id),
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_audit_logs (
    id INTEGER PRIMARY KEY,
    admin_id INTEGER REFERENCES admins(id),
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_ip ON user_sessions(ip);
  CREATE INDEX IF NOT EXISTS idx_access_visited ON access_logs(visited_at);
  CREATE INDEX IF NOT EXISTS idx_spin_ip ON spin_history(ip);
  CREATE INDEX IF NOT EXISTS idx_spin_user ON spin_history(user_id);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON admin_audit_logs(created_at);
`);

const permissionNames = [
  'dashboard:view', 'users:view', 'users:manage', 'spins:view', 'spins:manage', 'ips:manage',
  'classroom:manage', 'settings:manage', 'audit:view', 'database:manage', 'admin:manage',
];
const rolePermissions = {
  super_admin: permissionNames,
  admin: ['dashboard:view', 'users:view', 'users:manage', 'spins:view', 'spins:manage', 'ips:manage', 'classroom:manage', 'settings:manage', 'audit:view'],
  moderator: ['dashboard:view', 'users:view', 'spins:view', 'ips:manage', 'audit:view'],
  viewer: ['dashboard:view', 'users:view', 'spins:view', 'audit:view'],
};
const insertRole = db.prepare('INSERT OR IGNORE INTO roles(name, level) VALUES (?, ?)');
[['super_admin', 4], ['admin', 3], ['moderator', 2], ['viewer', 1]].forEach((role) => insertRole.run(...role));
const insertPermission = db.prepare('INSERT OR IGNORE INTO permissions(name) VALUES (?)');
permissionNames.forEach((name) => insertPermission.run(name));
for (const [roleName, names] of Object.entries(rolePermissions)) {
  const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName);
  for (const name of names) {
    const permission = db.prepare('SELECT id FROM permissions WHERE name = ?').get(name);
    db.prepare('INSERT OR IGNORE INTO role_permissions(role_id, permission_id) VALUES (?, ?)').run(role.id, permission.id);
  }
}

function ensureColumn(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((entry) => entry.name === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

ensureColumn('admins', 'role_id', 'INTEGER REFERENCES roles(id)');
ensureColumn('admin_sessions', 'token_hash', 'TEXT');
ensureColumn('user_sessions', 'token_hash', 'TEXT');
if (db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'admin_roles'").get()) {
  db.prepare('UPDATE admins SET role_id = (SELECT role_id FROM admin_roles WHERE admin_id = admins.id ORDER BY role_id DESC LIMIT 1) WHERE role_id IS NULL').run();
}
db.prepare("UPDATE admins SET role_id = (SELECT id FROM roles WHERE name = 'super_admin') WHERE role_id IS NULL").run();
const adminSessionColumns = db.prepare('PRAGMA table_info(admin_sessions)').all().map((entry) => entry.name);
if (adminSessionColumns.includes('id') && adminSessionColumns.includes('token')) {
  for (const session of db.prepare('SELECT id, token FROM admin_sessions WHERE token IS NOT NULL AND token_hash IS NULL').all()) {
    db.prepare('UPDATE admin_sessions SET token_hash = ?, token = NULL WHERE id = ?')
      .run(crypto.createHash('sha256').update(session.token).digest('hex'), session.id);
  }
}
const userSessionColumns = db.prepare('PRAGMA table_info(user_sessions)').all().map((entry) => entry.name);
if (userSessionColumns.includes('session_token')) {
  for (const session of db.prepare('SELECT id, session_token FROM user_sessions WHERE session_token IS NOT NULL AND token_hash IS NULL').all()) {
    db.prepare('UPDATE user_sessions SET token_hash = ?, session_token = NULL WHERE id = ?')
      .run(crypto.createHash('sha256').update(session.session_token).digest('hex'), session.id);
  }
}

const defaultSettings = {
  site_name: siteName,
  site_logo: '',
  accent_color: '#2457cc',
  font_family: 'Manrope',
  spin_limit_mode: 'ip',
  maintenance_mode: 'false',
  wheel_sound_enabled: 'true',
  wheel_duration_ms: '4700',
  max_failed_logins: '5',
  history_retention_days: '365',
  public_notice: '',
};
const insertSetting = db.prepare('INSERT OR IGNORE INTO system_settings(key, value, updated_at) VALUES (?, ?, ?)');
for (const [key, value] of Object.entries(defaultSettings)) insertSetting.run(key, value, new Date().toISOString());

const insertNumber = db.prepare('INSERT OR IGNORE INTO spin_numbers(number, status) VALUES (?, ?)');
for (let number = 1; number <= seatCount; number += 1) insertNumber.run(number, 'available');

const defaultLayout = {
  teacher: 'Bàn giáo viên',
  door: 'Cửa ra vào',
  teams: [
    { name: 'Tổ 4', desks: Array.from({ length: 5 }, () => ({ seats: [] })) },
    { name: 'Tổ 3', desks: Array.from({ length: 5 }, () => ({ seats: [] })) },
    { name: 'Tổ 2', desks: Array.from({ length: 6 }, () => ({ seats: [] })) },
    { name: 'Tổ 1', desks: Array.from({ length: 5 }, () => ({ seats: [] })) },
  ],
};
const activeLayout = db.prepare('SELECT id, json_data FROM classroom_layout WHERE is_default = 1 ORDER BY id DESC LIMIT 1').get();
const activeTeams = activeLayout ? JSON.parse(activeLayout.json_data).teams : [];
const activeSeats = Array.isArray(activeTeams) ? activeTeams.flatMap((team) => (team.desks || []).flatMap((desk) => desk.seats || [])) : [];
const activeSeatsAreValid = activeSeats.length === 0
  || (activeSeats.length === seatCount && new Set(activeSeats).size === seatCount
    && activeSeats.every((number) => Number.isInteger(number) && number >= 1 && number <= seatCount));
const validDefaultLayout = activeTeams.map((team) => (team.desks || []).length).join(',') === '5,5,6,5'
  && activeSeatsAreValid;
if (!validDefaultLayout) {
  if (activeLayout) db.prepare('UPDATE classroom_layout SET is_default = 0 WHERE id = ?').run(activeLayout.id);
  db.prepare('INSERT INTO classroom_layout(version_name, json_data, is_default, created_at) VALUES (?, ?, 1, ?)')
    .run('Mặc định', JSON.stringify(defaultLayout), new Date().toISOString());
}

if (!db.prepare('SELECT id FROM admins LIMIT 1').get()) {
  if (!process.env.ADMIN_USERNAME || !process.env.ADMIN_PASSWORD || process.env.ADMIN_PASSWORD.length < 12) {
    throw new Error('Set ADMIN_USERNAME and an ADMIN_PASSWORD of at least 12 characters in .env to bootstrap the first Super Admin.');
  }
  const superRoleId = db.prepare('SELECT id FROM roles WHERE name = ?').get('super_admin').id;
  db.prepare('INSERT INTO admins(username, password_hash, full_name, role_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(process.env.ADMIN_USERNAME, bcrypt.hashSync(process.env.ADMIN_PASSWORD, 12), process.env.ADMIN_FULL_NAME || 'Super Admin', superRoleId, new Date().toISOString());
}

app.disable('x-powered-by');
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      styleSrcAttr: ["'unsafe-inline'"],
      fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: true, legacyHeaders: false }));
app.use('/api/admin/login', rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false }));

function now() {
  return new Date().toISOString();
}

function requestIp(req) {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function parseAgent(value = '') {
  const parser = new UAParser(value);
  const browser = parser.getBrowser();
  const os = parser.getOS();
  const device = parser.getDevice();
  return {
    browser: browser.name || 'Không rõ',
    os: os.name || 'Không rõ',
    device: [device.vendor, device.model].filter(Boolean).join(' ') || (device.type || 'Máy tính'),
  };
}

function setting(key, fallback = '') {
  return db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key)?.value ?? fallback;
}

function validateLayout(layout) {
  if (!layout || typeof layout !== 'object' || Array.isArray(layout)) return false;
  if (typeof layout.teacher !== 'string' || !layout.teacher.trim() || layout.teacher.length > 100) return false;
  if (typeof layout.door !== 'string' || !layout.door.trim() || layout.door.length > 100) return false;
  if (!Array.isArray(layout.teams) || layout.teams.length !== 4) return false;
  const teamNames = layout.teams.map((team) => typeof team?.name === 'string' ? team.name.trim() : '');
  if (teamNames.some((name) => !name || name.length > 40) || new Set(teamNames).size !== teamNames.length) return false;
  const teamsAreValid = layout.teams.every((team) => Array.isArray(team.desks) && team.desks.length > 0
    && team.desks.every((desk) => desk && Array.isArray(desk.seats) && desk.seats.length > 0));
  if (!teamsAreValid) return false;
  const desks = layout.teams.flatMap((team) => team.desks);
  if (desks.length !== 21) return false;
  const numbers = desks.flatMap((desk) => desk.seats);
  return numbers.length === seatCount
    && new Set(numbers).size === seatCount
    && numbers.every((number) => Number.isInteger(number) && number >= 1 && number <= seatCount);
}

function pruneHistory() {
  const retentionDays = Number(setting('history_retention_days', '365'));
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 3650) {
    throw new Error('Configured history retention must be an integer from 1 to 3650 days.');
  }
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const prune = db.transaction(() => {
    db.prepare('DELETE FROM access_logs WHERE visited_at < ?').run(cutoff);
    db.prepare(`
      DELETE FROM user_sessions
      WHERE created_at < ?
        AND NOT EXISTS (SELECT 1 FROM access_logs WHERE access_logs.session_id = user_sessions.id)
        AND NOT EXISTS (SELECT 1 FROM spin_history WHERE spin_history.session_id = user_sessions.id)
    `).run(cutoff);
    db.prepare(`
      DELETE FROM users
      WHERE NOT EXISTS (SELECT 1 FROM user_sessions WHERE user_sessions.user_id = users.id)
        AND NOT EXISTS (SELECT 1 FROM spin_history WHERE spin_history.user_id = users.id)
    `).run();
  });
  prune.immediate();
}

pruneHistory();
const retentionTimer = setInterval(() => {
  try {
    pruneHistory();
  } catch (error) {
    console.error('History retention cleanup failed:', error);
  }
}, 24 * 60 * 60 * 1000);
retentionTimer.unref();

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function audit(adminId, action, details = {}) {
  db.prepare('INSERT INTO admin_audit_logs(admin_id, action, details, created_at) VALUES (?, ?, ?, ?)')
    .run(adminId, action, JSON.stringify(details), now());
}

function adminAuth(req, res, next) {
  const token = req.cookies[adminCookie];
  if (!token) return res.status(401).json({ error: 'Vui lòng đăng nhập quản trị.' });
  const session = db.prepare(`
    SELECT a.id, a.username, a.full_name, a.role_id, r.name AS role_name
    FROM admin_sessions s JOIN admins a ON a.id = s.admin_id JOIN roles r ON r.id = a.role_id
    WHERE s.token_hash = ? AND s.expires_at > ? AND a.is_active = 1
  `).get(hashToken(token), now());
  if (!session) return res.status(401).json({ error: 'Phiên quản trị đã hết hạn.' });
  req.admin = session;
  next();
}

function permit(permissionName) {
  return (req, res, next) => {
    const allowed = db.prepare(`
      SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND p.name = ?
    `).get(req.admin.role_id, permissionName);
    if (!allowed) return res.status(403).json({ error: 'Bạn không có quyền thực hiện thao tác này.' });
    next();
  };
}

function sameOrigin(req, res, next) {
  const origin = req.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== req.get('host')) return res.status(403).json({ error: 'Yêu cầu không cùng nguồn.' });
    } catch {
      return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ.' });
    }
  }
  next();
}

function currentUser(req) {
  const token = req.cookies[userCookie];
  if (!token) return null;
  return db.prepare(`
    SELECT s.*, u.name, u.id AS user_id FROM user_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ?
  `).get(hashToken(token));
}

function availableNumbers() {
  return db.prepare("SELECT number FROM spin_numbers WHERE status = 'available' ORDER BY number").all().map(({ number }) => number);
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, database: 'sqlite', time: now() });
});

app.get('/api/public/state', (req, res) => {
  const user = currentUser(req);
  const publicSettings = {
    siteName: setting('site_name', siteName),
    siteLogo: setting('site_logo'),
    accentColor: setting('accent_color', '#2457cc'),
    fontFamily: setting('font_family', 'Manrope'),
    soundEnabled: setting('wheel_sound_enabled', 'true') === 'true',
    wheelDuration: Number(setting('wheel_duration_ms', '4700')),
    publicNotice: setting('public_notice'),
    spinLimitMode: setting('spin_limit_mode', 'ip'),
  };
  if (!user) return res.json({ ok: true, user: null, hasSpun: false, lastResult: null, remaining: availableNumbers(), settings: publicSettings });
  const ip = requestIp(req);
  const agent = req.get('user-agent') || '';
  const parsed = parseAgent(agent);
  const stamp = now();
  db.prepare('UPDATE users SET ip = ?, last_seen_at = ? WHERE id = ?').run(ip, stamp, user.user_id);
  db.prepare('UPDATE user_sessions SET ip = ?, user_agent = ?, browser = ?, os = ?, device = ?, ended_at = NULL WHERE id = ?')
    .run(ip, agent, parsed.browser, parsed.os, parsed.device, user.id);
  db.prepare('INSERT INTO access_logs(user_id, session_id, ip, visited_at) VALUES (?, ?, ?, ?)').run(user.user_id, user.id, ip, stamp);
  const mode = setting('spin_limit_mode', 'ip');
  const hasSpun = !!user.has_spun || (mode === 'account'
    ? !!db.prepare('SELECT id FROM spin_history WHERE user_id = ?').get(user.user_id)
    : !!db.prepare('SELECT id FROM spin_history WHERE ip = ?').get(ip));
  const lastResult = db.prepare('SELECT selected_number FROM spin_history WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(user.user_id)?.selected_number ?? null;
  res.json({ ok: true, user: { id: user.user_id, name: user.name }, hasSpun, lastResult, remaining: availableNumbers(), settings: publicSettings });
});

app.post('/api/public/session/end', sameOrigin, (req, res) => {
  const token = req.cookies[userCookie];
  if (token) db.prepare('UPDATE user_sessions SET ended_at = ? WHERE token_hash = ? AND ended_at IS NULL').run(now(), hashToken(token));
  res.json({ ok: true });
});

app.post('/api/public/session', sameOrigin, (req, res) => {
  const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > 100) return res.status(400).json({ error: 'Nhập họ tên từ 1 đến 100 ký tự.' });
  const ip = requestIp(req);
  const agent = req.get('user-agent') || '';
  const parsed = parseAgent(agent);
  const stamp = now();
  const existing = currentUser(req);
  let userId = existing?.user_id;
  if (userId) {
    db.prepare('UPDATE users SET name = ?, last_seen_at = ? WHERE id = ?').run(name, stamp, userId);
    db.prepare('UPDATE user_sessions SET ip = ?, user_agent = ?, browser = ?, os = ?, device = ?, ended_at = NULL WHERE id = ?')
      .run(ip, agent, parsed.browser, parsed.os, parsed.device, existing.id);
    db.prepare('INSERT INTO access_logs(user_id, session_id, ip, visited_at) VALUES (?, ?, ?, ?)').run(userId, existing.id, ip, stamp);
  } else {
    const created = db.prepare('INSERT INTO users(name, ip, created_at, last_seen_at) VALUES (?, ?, ?, ?)').run(name, ip, stamp, stamp);
    userId = Number(created.lastInsertRowid);
    const token = crypto.randomBytes(32).toString('hex');
    const session = db.prepare(`
      INSERT INTO user_sessions(user_id, token_hash, ip, user_agent, browser, os, device, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(userId, hashToken(token), ip, agent, parsed.browser, parsed.os, parsed.device, stamp);
    res.cookie(userCookie, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 180 * 24 * 60 * 60 * 1000 });
    const sessionId = Number(session.lastInsertRowid);
    db.prepare('INSERT INTO access_logs(user_id, session_id, ip, visited_at) VALUES (?, ?, ?, ?)').run(userId, sessionId, ip, stamp);
  }
  const user = db.prepare('SELECT id, name FROM users WHERE id = ?').get(userId);
  const mode = setting('spin_limit_mode', 'ip');
  const activeSession = currentUser(req);
  const hasSpun = !!activeSession?.has_spun || (mode === 'account'
    ? !!db.prepare('SELECT id FROM spin_history WHERE user_id = ?').get(userId)
    : !!db.prepare('SELECT id FROM spin_history WHERE ip = ?').get(ip));
  const lastResult = db.prepare('SELECT selected_number FROM spin_history WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId)?.selected_number ?? null;
  res.json({
    ok: true,
    user,
    hasSpun,
    lastResult,
    remaining: availableNumbers(),
    settings: {
      siteName: setting('site_name', siteName),
      siteLogo: setting('site_logo'),
      accentColor: setting('accent_color', '#2457cc'),
      fontFamily: setting('font_family', 'Manrope'),
      soundEnabled: setting('wheel_sound_enabled', 'true') === 'true',
      wheelDuration: Number(setting('wheel_duration_ms', '4700')),
      publicNotice: setting('public_notice'),
      spinLimitMode: setting('spin_limit_mode', 'ip'),
    },
  });
});

app.post('/api/public/spin', sameOrigin, (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: 'Nhập tên trước khi quay số.' });
  const ip = requestIp(req);
  if (db.prepare('SELECT ip FROM blocked_ips WHERE ip = ?').get(ip)) return res.status(403).json({ error: 'Địa chỉ IP này đang bị khóa.' });
  if (setting('maintenance_mode', 'false') === 'true') return res.status(503).json({ error: 'Website đang trong chế độ bảo trì.' });

  try {
    const result = db.transaction(() => {
      const mode = setting('spin_limit_mode', 'ip');
      const alreadySpun = mode === 'account'
        ? db.prepare('SELECT id FROM spin_history WHERE user_id = ?').get(user.user_id)
        : db.prepare('SELECT id FROM spin_history WHERE ip = ?').get(ip);
      if (alreadySpun || user.has_spun) {
        const message = mode === 'account'
          ? 'Tài khoản này đã hoàn thành lượt quay.'
          : 'Bạn đã hoàn thành lượt quay. Mỗi địa chỉ IP chỉ được tham gia một lần.';
        throw Object.assign(new Error(message), { status: 409 });
      }
      const numbers = availableNumbers();
      if (numbers.length === 0) throw Object.assign(new Error('Tất cả 35 số đã được chọn. Lượt quay đã hoàn tất.'), { status: 410 });
      const selectedNumber = numbers[crypto.randomInt(numbers.length)];
      const stamp = now();
      db.prepare("UPDATE spin_numbers SET status = 'used', selected_by_user_id = ?, session_id = ?, selected_at = ? WHERE number = ? AND status = 'available'")
        .run(user.user_id, user.id, stamp, selectedNumber);
      db.prepare('INSERT INTO spin_history(user_id, session_id, name, ip, selected_number, created_at) VALUES (?, ?, ?, ?, ?, ?)')
        .run(user.user_id, user.id, user.name, ip, selectedNumber, stamp);
      db.prepare('UPDATE user_sessions SET has_spun = 1, last_result = ? WHERE id = ?').run(selectedNumber, user.id);
      db.prepare('UPDATE access_logs SET completed_spin = 1, selected_number = ? WHERE session_id = ?').run(selectedNumber, user.id);
      return selectedNumber;
    }).immediate();
    res.json({ ok: true, selectedNumber: result, remaining: availableNumbers() });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.status ? error.message : 'Không thể xử lý lượt quay.' });
  }
});

app.get('/api/public/history', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.json({ items: [] });
  const items = db.prepare('SELECT selected_number, created_at FROM spin_history WHERE user_id = ? ORDER BY id DESC').all(user.user_id);
  res.json({ items });
});

app.get('/api/public/layout', (req, res) => {
  const row = db.prepare('SELECT json_data FROM classroom_layout WHERE is_default = 1 ORDER BY id DESC LIMIT 1').get();
  res.json({ layout: JSON.parse(row.json_data) });
});

app.post('/api/admin/login', sameOrigin, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  const admin = db.prepare('SELECT * FROM admins WHERE username = ?').get(username);
  if (!admin || !admin.is_active) return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
  if (admin.locked_until > Date.now()) return res.status(423).json({ error: 'Tài khoản đang tạm khóa do đăng nhập sai nhiều lần.' });
  if (!bcrypt.compareSync(password, admin.password_hash)) {
    const attempts = admin.failed_attempts + 1;
    const maxAttempts = Number(setting('max_failed_logins', '5'));
    db.prepare('UPDATE admins SET failed_attempts = ?, locked_until = ? WHERE id = ?')
      .run(attempts, attempts >= maxAttempts ? Date.now() + 15 * 60_000 : 0, admin.id);
    return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không đúng.' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
  db.prepare('INSERT INTO admin_sessions(token_hash, admin_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .run(hashToken(token), admin.id, expiresAt, now());
  db.prepare('UPDATE admins SET failed_attempts = 0, locked_until = 0 WHERE id = ?').run(admin.id);
  audit(admin.id, 'admin.login', { username });
  res.cookie(adminCookie, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 8 * 60 * 60_000 });
  res.json({ ok: true, admin: { id: admin.id, username: admin.username, fullName: admin.full_name, role: db.prepare('SELECT name FROM roles WHERE id = ?').get(admin.role_id).name } });
});

app.post('/api/admin/logout', sameOrigin, (req, res) => {
  const token = req.cookies[adminCookie];
  if (token) {
    const session = db.prepare('SELECT admin_id FROM admin_sessions WHERE token_hash = ?').get(hashToken(token));
    if (session) audit(session.admin_id, 'admin.logout');
    db.prepare('DELETE FROM admin_sessions WHERE token_hash = ?').run(hashToken(token));
  }
  res.clearCookie(adminCookie, { sameSite: 'strict' });
  res.json({ ok: true });
});

app.get('/api/admin/session', adminAuth, permit('dashboard:view'), (req, res) => {
  res.json({ admin: { id: req.admin.id, username: req.admin.username, fullName: req.admin.full_name, role: req.admin.role_name } });
});

app.get('/api/admin/stats', adminAuth, permit('dashboard:view'), (req, res) => {
  const count = (sql, ...args) => db.prepare(sql).get(...args).count;
  const totals = {
    access: count('SELECT COUNT(*) AS count FROM access_logs'),
    users: count('SELECT COUNT(*) AS count FROM users'),
    spun: count('SELECT COUNT(DISTINCT user_id) AS count FROM spin_history'),
    successfulSpins: count('SELECT COUNT(*) AS count FROM spin_history'),
    lockedIps: count('SELECT COUNT(DISTINCT ip) AS count FROM spin_history'),
    remaining: count("SELECT COUNT(*) AS count FROM spin_numbers WHERE status = 'available'"),
  };
  totals.pending = Math.max(0, totals.users - totals.spun);
  const dailySummary = db.prepare("SELECT date(visited_at) AS date, COUNT(*) AS count FROM access_logs GROUP BY date(visited_at) ORDER BY date DESC LIMIT 14").all().reverse();
  const wheelSummary = db.prepare('SELECT selected_number AS number, COUNT(*) AS count FROM spin_history GROUP BY selected_number ORDER BY number').all();
  const recentActivity = db.prepare('SELECT l.action, l.details, l.created_at, a.username FROM admin_audit_logs l LEFT JOIN admins a ON a.id = l.admin_id ORDER BY l.id DESC LIMIT 10').all();
  res.json({ totals, dailySummary, wheelSummary, recentActivity });
});

app.get('/api/admin/users', adminAuth, permit('users:view'), (req, res) => {
  const search = `%${String(req.query.search || '').slice(0, 100)}%`;
  const from = String(req.query.from || '');
  const to = String(req.query.to || '');
  const rows = db.prepare(`
    SELECT u.id, u.name, u.ip, u.created_at, u.last_seen_at,
      COUNT(DISTINCT al.id) AS access_count,
      MAX(CASE WHEN sh.id IS NOT NULL THEN 1 ELSE 0 END) AS completed_spin,
      MAX(us.browser) AS browser, MAX(us.os) AS os, MAX(us.device) AS device
    FROM users u
    LEFT JOIN access_logs al ON al.user_id = u.id
    LEFT JOIN spin_history sh ON sh.user_id = u.id
    LEFT JOIN user_sessions us ON us.user_id = u.id
    WHERE u.name LIKE ? AND (? = '' OR date(u.last_seen_at) >= date(?)) AND (? = '' OR date(u.last_seen_at) <= date(?))
    GROUP BY u.id ORDER BY u.last_seen_at DESC
  `).all(search, from, from, to, to);
  res.json({ rows });
});

app.get('/api/admin/access-logs', adminAuth, permit('users:view'), (req, res) => {
  const rows = db.prepare(`
    SELECT al.id, u.name, al.ip, al.visited_at, al.completed_spin, al.selected_number,
      us.browser, us.os, us.device, us.ended_at
    FROM access_logs al JOIN users u ON u.id = al.user_id JOIN user_sessions us ON us.id = al.session_id
    ORDER BY al.id DESC LIMIT 500
  `).all();
  res.json({ rows });
});

app.get('/api/admin/history', adminAuth, permit('spins:view'), (req, res) => {
  const rows = db.prepare('SELECT id, name, selected_number, ip, created_at FROM spin_history ORDER BY id DESC').all();
  res.json({ rows });
});

app.post('/api/admin/ips/:ip/unlock', sameOrigin, adminAuth, permit('ips:manage'), (req, res) => {
  const ip = req.params.ip;
  const selected = db.prepare('SELECT selected_number FROM spin_history WHERE ip = ?').all(ip);
  const unlock = db.transaction(() => {
    for (const row of selected) db.prepare("UPDATE spin_numbers SET status = 'available', selected_by_user_id = NULL, session_id = NULL, selected_at = NULL WHERE number = ?").run(row.selected_number);
    db.prepare('DELETE FROM spin_history WHERE ip = ?').run(ip);
    db.prepare('UPDATE user_sessions SET has_spun = 0, last_result = NULL WHERE ip = ?').run(ip);
    db.prepare('UPDATE access_logs SET completed_spin = 0, selected_number = NULL WHERE ip = ?').run(ip);
    db.prepare('DELETE FROM blocked_ips WHERE ip = ?').run(ip);
    audit(req.admin.id, 'ip.unlock', { ip });
  });
  unlock.immediate();
  res.json({ ok: true });
});

app.post('/api/admin/ips/:ip/block', sameOrigin, adminAuth, permit('ips:manage'), (req, res) => {
  const ip = req.params.ip;
  db.prepare('INSERT OR REPLACE INTO blocked_ips(ip, blocked_by, created_at) VALUES (?, ?, ?)').run(ip, req.admin.id, now());
  audit(req.admin.id, 'ip.block', { ip });
  res.json({ ok: true });
});

app.post('/api/admin/users/:id/reset', sameOrigin, adminAuth, permit('spins:manage'), (req, res) => {
  const userId = Number(req.params.id);
  const selected = db.prepare('SELECT selected_number FROM spin_history WHERE user_id = ?').all(userId);
  const reset = db.transaction(() => {
    for (const row of selected) db.prepare("UPDATE spin_numbers SET status = 'available', selected_by_user_id = NULL, session_id = NULL, selected_at = NULL WHERE number = ?").run(row.selected_number);
    db.prepare('DELETE FROM spin_history WHERE user_id = ?').run(userId);
    db.prepare('UPDATE user_sessions SET has_spun = 0, last_result = NULL WHERE user_id = ?').run(userId);
    db.prepare('UPDATE access_logs SET completed_spin = 0, selected_number = NULL WHERE user_id = ?').run(userId);
    audit(req.admin.id, 'user.spin.reset', { userId });
  });
  reset.immediate();
  res.json({ ok: true });
});

app.post('/api/admin/spin/reset', sameOrigin, adminAuth, permit('spins:manage'), (req, res) => {
  const reset = db.transaction(() => {
    db.prepare("UPDATE spin_numbers SET status = 'available', selected_by_user_id = NULL, session_id = NULL, selected_at = NULL").run();
    db.prepare('DELETE FROM spin_history').run();
    db.prepare('UPDATE user_sessions SET has_spun = 0, last_result = NULL').run();
    db.prepare('UPDATE access_logs SET completed_spin = 0, selected_number = NULL').run();
    audit(req.admin.id, 'spin.reset', { by: req.admin.username });
  });
  reset.immediate();
  res.json({ ok: true });
});

app.get('/api/admin/export/csv', adminAuth, permit('users:view'), (req, res) => {
  const rows = db.prepare(`
    SELECT u.id, u.name, u.ip, u.created_at, sh.selected_number, sh.created_at AS spun_at
    FROM users u LEFT JOIN spin_history sh ON sh.user_id = u.id ORDER BY u.id
  `).all();
  const csv = [['id', 'name', 'ip', 'registered_at', 'selected_number', 'spun_at'], ...rows.map((row) => Object.values(row))]
    .map((row) => row.map((value) => {
      const field = String(value ?? '');
      const safeField = /^[\t\r\n ]*[=+\-@]/.test(field) ? `'${field}` : field;
      return `"${safeField.replace(/"/g, '""')}"`;
    }).join(','))
    .join('\r\n');
  res.setHeader('content-type', 'text/csv; charset=utf-8');
  res.setHeader('content-disposition', 'attachment; filename="class-draw.csv"');
  res.send(`\uFEFF${csv}`);
});

app.get('/api/admin/settings', adminAuth, permit('settings:manage'), (req, res) => {
  res.json({ settings: db.prepare('SELECT key, value FROM system_settings ORDER BY key').all() });
});

app.post('/api/admin/settings', adminAuth, permit('settings:manage'), sameOrigin, (req, res) => {
  const allowed = new Set(Object.keys(defaultSettings));
  const { key, value } = req.body || {};
  if (!allowed.has(key) || typeof value !== 'string' || value.length > 500) return res.status(400).json({ error: 'Cấu hình không hợp lệ.' });
  if (['spin_limit_mode', 'max_failed_logins'].includes(key) && req.admin.role_name !== 'super_admin') {
    return res.status(403).json({ error: 'Chỉ Super Admin có thể thay đổi cấu hình bảo mật.' });
  }
  if (key === 'spin_limit_mode' && !['ip', 'account'].includes(value)) return res.status(400).json({ error: 'Chế độ giới hạn không hợp lệ.' });
  if (key === 'accent_color' && !/^#[0-9a-f]{6}$/i.test(value)) return res.status(400).json({ error: 'Mã màu không hợp lệ.' });
  if (key === 'font_family' && !['Manrope', 'Arial', 'Verdana', 'Tahoma', 'system-ui'].includes(value)) return res.status(400).json({ error: 'Font chữ không hợp lệ.' });
  if (key === 'site_logo' && value && (!value.startsWith('/') || value.startsWith('//') || value.length > 300)) return res.status(400).json({ error: 'Logo phải là đường dẫn nội bộ hợp lệ.' });
  if (key === 'wheel_duration_ms' && (!Number.isInteger(Number(value)) || Number(value) < 1500 || Number(value) > 10000)) return res.status(400).json({ error: 'Thời lượng vòng quay phải từ 1500 đến 10000 ms.' });
  if (key === 'history_retention_days' && (!Number.isInteger(Number(value)) || Number(value) < 1 || Number(value) > 3650)) return res.status(400).json({ error: 'Thời gian lưu lịch sử phải từ 1 đến 3650 ngày.' });
  if (key === 'max_failed_logins' && (!Number.isInteger(Number(value)) || Number(value) < 3 || Number(value) > 20)) return res.status(400).json({ error: 'Số lần đăng nhập sai phải từ 3 đến 20.' });
  if (['wheel_sound_enabled', 'maintenance_mode'].includes(key) && !['true', 'false'].includes(value)) return res.status(400).json({ error: 'Giá trị bật/tắt không hợp lệ.' });
  if (key === 'site_name' && (!value.trim() || value.length > 100)) return res.status(400).json({ error: 'Tên website phải có từ 1 đến 100 ký tự.' });
  if (key === 'public_notice' && value.length > 300) return res.status(400).json({ error: 'Thông báo không được vượt quá 300 ký tự.' });
  db.prepare('UPDATE system_settings SET value = ?, updated_by = ?, updated_at = ? WHERE key = ?').run(value, req.admin.id, now(), key);
  audit(req.admin.id, 'settings.update', { key, value });
  res.json({ ok: true });
});

app.get('/api/admin/database/backup', adminAuth, permit('database:manage'), async (req, res) => {
  const backupPath = path.join(os.tmpdir(), `11b7-draw-${crypto.randomBytes(12).toString('hex')}.db`);
  try {
    await db.backup(backupPath);
    audit(req.admin.id, 'database.backup', { file: path.basename(backupPath) });
    res.download(backupPath, 'classroom-backup.db', () => fs.rm(backupPath, { force: true }, () => {}));
  } catch {
    fs.rm(backupPath, { force: true }, () => {});
    res.status(500).json({ error: 'Không thể tạo bản sao lưu.' });
  }
});

app.get('/api/admin/layout', adminAuth, permit('classroom:manage'), (req, res) => {
  const rows = db.prepare('SELECT id, version_name, json_data, created_at, is_default FROM classroom_layout ORDER BY id DESC').all();
  res.json({ layouts: rows.map((row) => ({ ...row, layout: JSON.parse(row.json_data) })) });
});

app.put('/api/admin/layout', adminAuth, permit('classroom:manage'), sameOrigin, (req, res) => {
  const layout = req.body?.layout;
  if (!validateLayout(layout)) return res.status(400).json({ error: 'Sơ đồ cần có 4 tổ, tổng cộng 21 bàn và mỗi số 1-35 xuất hiện đúng một lần.' });
  const versionName = String(req.body.versionName || '').trim();
  if (!versionName || versionName.length > 80) return res.status(400).json({ error: 'Tên phiên bản phải có từ 1 đến 80 ký tự.' });
  const transaction = db.transaction(() => {
    db.prepare('UPDATE classroom_layout SET is_default = 0').run();
    db.prepare('INSERT INTO classroom_layout(version_name, json_data, is_default, created_at) VALUES (?, ?, 1, ?)')
      .run(versionName, JSON.stringify(layout), now());
    audit(req.admin.id, 'classroom.layout.update', { versionName });
  });
  transaction.immediate();
  res.json({ ok: true });
});

app.post('/api/admin/layout/:id/restore', adminAuth, permit('classroom:manage'), sameOrigin, (req, res) => {
  const versionId = Number(req.params.id);
  if (!Number.isSafeInteger(versionId) || versionId < 1) return res.status(400).json({ error: 'Phiên bản sơ đồ không hợp lệ.' });
  const version = db.prepare('SELECT version_name, json_data FROM classroom_layout WHERE id = ?').get(versionId);
  if (!version) return res.status(404).json({ error: 'Không tìm thấy phiên bản sơ đồ.' });
  const layout = JSON.parse(version.json_data);
  if (!validateLayout(layout)) return res.status(400).json({ error: 'Phiên bản sơ đồ không còn hợp lệ.' });
  const restoredName = `Khôi phục: ${version.version_name}`.slice(0, 80);
  const restore = db.transaction(() => {
    db.prepare('UPDATE classroom_layout SET is_default = 0').run();
    db.prepare('INSERT INTO classroom_layout(version_name, json_data, is_default, created_at) VALUES (?, ?, 1, ?)')
      .run(restoredName, JSON.stringify(layout), now());
    audit(req.admin.id, 'classroom.layout.restore', { versionId, versionName: version.version_name });
  });
  restore.immediate();
  res.json({ ok: true });
});
app.get('/api/admin/audit', adminAuth, permit('audit:view'), (req, res) => {
  const rows = db.prepare('SELECT l.id, a.username, l.action, l.details, l.created_at FROM admin_audit_logs l LEFT JOIN admins a ON a.id = l.admin_id ORDER BY l.id DESC LIMIT 500').all();
  res.json({ rows });
});

app.get('/api/admin/admins', adminAuth, permit('admin:manage'), (req, res) => {
  const rows = db.prepare('SELECT a.id, a.username, a.full_name, a.is_active, r.name AS role FROM admins a JOIN roles r ON r.id = a.role_id ORDER BY a.id').all();
  res.json({ rows });
});

app.post('/api/admin/admins', adminAuth, permit('admin:manage'), sameOrigin, (req, res) => {
  const username = String(req.body?.username || '').trim();
  const fullName = String(req.body?.fullName || '').trim();
  const password = String(req.body?.password || '');
  const roleName = String(req.body?.role || 'viewer');
  const role = db.prepare('SELECT id FROM roles WHERE name = ?').get(roleName);
  if (!/^[\w.-]{3,40}$/.test(username) || fullName.length < 1 || fullName.length > 100 || password.length < 12 || !role) {
    return res.status(400).json({ error: 'Thông tin admin không hợp lệ; mật khẩu cần tối thiểu 12 ký tự.' });
  }
  const result = db.prepare('INSERT INTO admins(username, password_hash, full_name, role_id, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(username, bcrypt.hashSync(password, 12), fullName, role.id, now());
  audit(req.admin.id, 'admin.create', { targetId: result.lastInsertRowid, username, role: roleName });
  res.status(201).json({ ok: true });
});

app.patch('/api/admin/admins/:id', adminAuth, permit('admin:manage'), sameOrigin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id && req.body?.isActive === false) return res.status(400).json({ error: 'Không thể tự khóa tài khoản đang đăng nhập.' });
  const target = db.prepare('SELECT * FROM admins WHERE id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  if (req.body?.fullName !== undefined && (typeof req.body.fullName !== 'string' || !req.body.fullName.trim() || req.body.fullName.length > 100)) {
    return res.status(400).json({ error: 'Họ tên phải có từ 1 đến 100 ký tự.' });
  }
  if (req.body?.password !== undefined && (typeof req.body.password !== 'string' || req.body.password.length < 12 || req.body.password.length > 128)) {
    return res.status(400).json({ error: 'Mật khẩu mới cần từ 12 đến 128 ký tự.' });
  }
  if (req.body?.isActive !== undefined && typeof req.body.isActive !== 'boolean') return res.status(400).json({ error: 'Trạng thái tài khoản không hợp lệ.' });
  const role = req.body?.role ? db.prepare('SELECT id, name FROM roles WHERE name = ?').get(String(req.body.role)) : null;
  if (req.body?.role && !role) return res.status(400).json({ error: 'Vai trò không hợp lệ.' });
  const roleName = role?.name || db.prepare('SELECT name FROM roles WHERE id = ?').get(target.role_id).name;
  const targetRoleName = db.prepare('SELECT name FROM roles WHERE id = ?').get(target.role_id).name;
  const nextActive = typeof req.body?.isActive === 'boolean' ? req.body.isActive : Boolean(target.is_active);
  if (targetRoleName === 'super_admin' && target.is_active === 1 && (roleName !== 'super_admin' || !nextActive)) {
    const count = db.prepare("SELECT COUNT(*) AS count FROM admins a JOIN roles r ON r.id = a.role_id WHERE r.name = 'super_admin' AND a.is_active = 1").get().count;
    if (count < 2) return res.status(400).json({ error: 'Phải duy trì ít nhất một Super Admin đang hoạt động.' });
  }
  db.prepare('UPDATE admins SET full_name = COALESCE(?, full_name), role_id = COALESCE(?, role_id), is_active = COALESCE(?, is_active) WHERE id = ?')
    .run(req.body?.fullName ? String(req.body.fullName).slice(0, 100) : null, role?.id ?? null, typeof req.body?.isActive === 'boolean' ? Number(req.body.isActive) : null, id);
  const privilegeChanged = role || typeof req.body?.isActive === 'boolean' || req.body?.password !== undefined;
  if (req.body?.password !== undefined) {
    db.prepare('UPDATE admins SET password_hash = ? WHERE id = ?').run(bcrypt.hashSync(req.body.password, 12), id);
  }
  if (privilegeChanged) db.prepare('DELETE FROM admin_sessions WHERE admin_id = ?').run(id);
  audit(req.admin.id, 'admin.update', { targetId: id });
  res.json({ ok: true });
});

app.delete('/api/admin/admins/:id', adminAuth, permit('admin:manage'), sameOrigin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.admin.id) return res.status(400).json({ error: 'Không thể xóa tài khoản đang đăng nhập.' });
  const target = db.prepare('SELECT a.id, r.name AS role FROM admins a JOIN roles r ON r.id = a.role_id WHERE a.id = ?').get(id);
  if (!target) return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
  if (target.role === 'super_admin' && db.prepare("SELECT COUNT(*) AS count FROM admins a JOIN roles r ON r.id = a.role_id WHERE r.name = 'super_admin' AND a.is_active = 1").get().count < 2) {
    return res.status(400).json({ error: 'Phải duy trì ít nhất một Super Admin đang hoạt động.' });
  }
  audit(req.admin.id, 'admin.delete', { targetId: id });
  db.prepare('DELETE FROM admins WHERE id = ?').run(id);
  res.json({ ok: true });
});

app.use('/api', (req, res) => res.status(404).json({ error: 'Không tìm thấy API.' }));

const distPath = path.resolve('dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*splat', (req, res) => res.sendFile(path.join(distPath, 'index.html')));
}

app.listen(port, '0.0.0.0', () => console.log(`API listening on http://localhost:${port}`));