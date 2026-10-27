import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { readFileSync, writeFileSync } from 'node:fs';

const scrypt = promisify(scryptCb);
const hash = value => createHash('sha256').update(value).digest('hex');
export const idleMs = 10 * 60_000;

export async function savePassword(file, password) {
  const isPin = typeof password === 'string' && /^\d{4,8}$/.test(password);
  if (typeof password !== 'string' || (!isPin && password.length < 12) || password.length > 1024) throw new Error('Use a 4–8 digit PIN or a password with 12–1024 characters.');
  const salt = randomBytes(32).toString('hex');
  const derived = await scrypt(password, salt, 64);
  const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
  await writeFile(temporary, JSON.stringify({ salt, hash: derived.toString('hex'), kind: isPin ? 'pin' : 'password' }) + '\n', { mode: 0o600 });
  await rename(temporary, file);
}

export class Auth {
  sessions = new Map();
  attempts = new Map();
  constructor(file, { secure = true, now = Date.now } = {}) {
    this.file = file; this.secure = secure; this.now = now;
    this.cookieName = secure ? '__Host-ai_control' : 'ai_control_local';
  }
  cookie(token, maxAge = 8 * 3600) {
    return `${this.cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.secure ? '; Secure' : ''}`;
  }
  async kind() { return JSON.parse(await readFile(this.file, 'utf8')).kind === 'pin' ? 'pin' : 'password'; }
  async change(current, next, ip) { await this.verify(current, ip); await savePassword(this.file, next); this.sessions.clear(); }
  async verify(password, ip) {
    const now = this.now();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const attempt = this.attempts.get(ip) ?? { count: 0, until: now + 15 * 60_000 };
    if (attempt.count >= 5 || this.attempts.size > 1000) throw Object.assign(new Error('Too many attempts. Try again in 15 minutes.'), { status: 429 });
    attempt.count++; this.attempts.set(ip, attempt);
    const record = JSON.parse(await readFile(this.file, 'utf8'));
    const candidate = await scrypt(typeof password === 'string' && password.length <= 1024 ? password : '', record.salt, 64);
    if (!timingSafeEqual(candidate, Buffer.from(record.hash, 'hex'))) throw Object.assign(new Error('Incorrect PIN or password.'), { status: 401 });
    this.attempts.delete(ip);
    return record;
  }
  async login(password, ip) {
    const record = await this.verify(password, ip), now = this.now();
    const token = randomBytes(32).toString('hex');
    const session = { csrf: randomBytes(32).toString('hex'), touched: now, created: now, credential: record.hash };
    for (const [key, value] of this.sessions) if (now - value.touched > idleMs) this.sessions.delete(key);
    if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value);
    this.sessions.set(hash(token), session);
    return { token, session };
  }
  async get(req) {
    const token = req.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${this.cookieName}=`))?.slice(this.cookieName.length + 1);
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
    const key = hash(token), session = this.sessions.get(key), now = this.now();
    if (!session) return null;
    if (now - session.touched >= idleMs || session.credential !== JSON.parse(await readFile(this.file, 'utf8')).hash) {
      this.sessions.delete(key); return null;
    }
    return { ...session, key, token, idleRemainingMs: idleMs - (now - session.touched) };
  }
  // ponytail: saved only on clean shutdown, so auto-restarts keep you logged in; a crash logs out.
  restore(file) { try { this.sessions = new Map(JSON.parse(readFileSync(file, 'utf8'))); } catch { /* no saved logins */ } }
  persist(file) { writeFileSync(file, JSON.stringify([...this.sessions]), { mode: 0o600 }); }
  touch(session) { const value = this.sessions.get(session.key); if (value) value.touched = this.now(); }
  logout(session) { if (session) this.sessions.delete(session.key); }
}
