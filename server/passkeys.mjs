import { randomBytes } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isIP } from 'node:net';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { fail } from './requests.mjs';

const challengeMs = 5 * 60_000;
const id = () => randomBytes(32).toString('base64url');
function rp(origin) {
  const url = new URL(origin);
  return !isIP(url.hostname) && (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === 'localhost')) ? url.hostname : null;
}

export class Passkeys {
  constructor(auth, file = join(dirname(auth.file), 'passkeys.json')) {
    this.auth = auth; this.file = file; this.pending = Promise.resolve(); this.challenges = new Map(); this.attempts = new Map();
    this.cookieName = auth.secure ? '__Host-ai_control_passkey' : 'ai_control_passkey_local';
  }
  cookie(value, maxAge = challengeMs / 1000) { return `${this.cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${this.auth.secure ? '; Secure' : ''}`; }
  browser(req) { return req.headers.cookie?.split(';').map(s => s.trim()).find(s => s.startsWith(`${this.cookieName}=`))?.slice(this.cookieName.length + 1); }
  // Serialize the entire read/verify/write transaction, including counter updates and removals.
  run(task) { const result = this.pending.then(task); this.pending = result.catch(() => {}); return result; }
  async read() {
    const credential = JSON.parse(await readFile(this.auth.file, 'utf8')).hash;
    let saved;
    try { saved = JSON.parse(await readFile(this.file, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    // The CLI replaces auth.json too: old passkeys and in-flight challenges must never survive it.
    return saved?.credential === credential ? saved : { credential, userID: id(), passkeys: [] };
  }
  async save(data) {
    const temporary = `${this.file}.${id()}.tmp`;
    await writeFile(temporary, JSON.stringify(data) + '\n', { mode: 0o600 }); await rename(temporary, this.file);
  }
  requireOrigin(origin) { const rpID = rp(origin); if (!rpID) throw fail('Passkeys need an HTTPS hostname. Use the HTTPS address from setup.', 400); return rpID; }
  challenge(data) {
    const now = this.auth.now();
    for (const [key, value] of this.challenges) if (value.expires <= now) this.challenges.delete(key);
    if (this.challenges.size >= 1000) throw fail('Too many passkey requests. Try again shortly.', 429);
    const challengeId = id(); this.challenges.set(challengeId, { ...data, expires: now + challengeMs }); return challengeId;
  }
  consume(challengeId, type, origin, credential, session) {
    const value = this.challenges.get(challengeId); this.challenges.delete(challengeId);
    if (!value || value.type !== type || value.expires <= this.auth.now() || value.origin !== origin || value.credential !== credential || value.session !== session) throw fail('Passkey request expired. Try again.', 400);
    return value;
  }
  limit(ip) {
    const now = this.auth.now();
    for (const [key, value] of this.attempts) if (value.until <= now) this.attempts.delete(key);
    const attempt = this.attempts.get(ip) || { count: 0, until: now + 15 * 60_000 };
    if (attempt.count >= 30 || this.attempts.size >= 1000) throw fail('Too many passkey requests. Try again in 15 minutes.', 429);
    attempt.count++; this.attempts.set(ip, attempt);
  }
  status(origin) {
    return this.run(async () => { const rpID = rp(origin); return { supported: !!rpID, enabled: !!rpID && (await this.read()).passkeys.some(key => key.rpID === rpID) }; });
  }
  list(origin) {
    return this.run(async () => ({ supported: !!rp(origin), passkeys: (await this.read()).passkeys.filter(key => key.rpID === rp(origin)).map(({ id, createdAt }) => ({ id, createdAt })) }));
  }
  registrationOptions(origin, session, password, ip) {
    return this.run(async () => {
      const rpID = this.requireOrigin(origin), verified = await this.auth.verify(password, ip), data = await this.read();
      if (verified.hash !== data.credential || session.credential !== data.credential) throw fail('Access changed. Unlock again.', 401);
      if (data.passkeys.length >= 50) throw fail('Remove a passkey before adding another.', 400);
      const options = await generateRegistrationOptions({ rpName: 'AI Control', rpID, userName: 'AI Control', userDisplayName: 'AI Control', userID: Buffer.from(data.userID, 'base64url'),
        attestationType: 'none', timeout: 60_000, authenticatorSelection: { authenticatorAttachment: 'platform', residentKey: 'required', userVerification: 'required' },
        excludeCredentials: data.passkeys.filter(key => key.rpID === rpID).map(key => ({ id: key.id, transports: key.transports })),
      });
      await this.save(data);
      return { options, challengeId: this.challenge({ type: 'register', origin, credential: data.credential, session: session.key, challenge: options.challenge }) };
    });
  }
  register(origin, session, payload) {
    return this.run(async () => {
      const rpID = this.requireOrigin(origin), data = await this.read();
      const pending = this.consume(payload?.challengeId, 'register', origin, data.credential, session.key);
      if (session.credential !== data.credential) throw fail('Access changed. Unlock again.', 401);
      let result;
      try { result = await verifyRegistrationResponse({ response: payload?.response, expectedChallenge: pending.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true }); }
      catch { throw fail('Could not verify the passkey. Try again.', 400); }
      if (!result.verified || !result.registrationInfo) throw fail('Could not verify the passkey. Try again.', 400);
      const { credential } = result.registrationInfo;
      if (data.passkeys.some(key => key.id === credential.id)) throw fail('This passkey is already registered.', 400);
      if (data.passkeys.length >= 50) throw fail('Remove a passkey before adding another.', 400);
      data.passkeys.push({ id: credential.id, publicKey: Buffer.from(credential.publicKey).toString('base64url'), counter: credential.counter, transports: credential.transports, rpID, createdAt: this.auth.now() });
      await this.save(data); return { ok: true };
    });
  }
  authenticationOptions(origin, ip) {
    return this.run(async () => {
      const rpID = this.requireOrigin(origin); this.limit(ip);
      const data = await this.read(), keys = data.passkeys.filter(key => key.rpID === rpID);
      if (!keys.length) throw fail('No passkeys registered. Unlock with your PIN or password.', 400);
      const options = await generateAuthenticationOptions({ rpID, timeout: 60_000, userVerification: 'required', allowCredentials: keys.map(key => ({ id: key.id, transports: key.transports })) });
      return { options, challengeId: this.challenge({ type: 'login', origin, credential: data.credential, challenge: options.challenge }) };
    });
  }
  authenticate(origin, challengeId, response) {
    return this.run(async () => {
      const rpID = this.requireOrigin(origin), data = await this.read();
      const pending = this.consume(challengeId, 'login', origin, data.credential);
      const key = data.passkeys.find(key => key.id === response?.id && key.rpID === rpID);
      if (!key || (response.response?.userHandle != null && response.response.userHandle !== data.userID)) throw fail('Could not verify the passkey. Try again.', 400);
      let result;
      try { result = await verifyAuthenticationResponse({ response, expectedChallenge: pending.challenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true,
        credential: { id: key.id, publicKey: Buffer.from(key.publicKey, 'base64url'), counter: key.counter, transports: key.transports },
      }); } catch { throw fail('Could not verify the passkey. Try again.', 400); }
      if (!result.verified) throw fail('Could not verify the passkey. Try again.', 400);
      key.counter = result.authenticationInfo.newCounter; await this.save(data);
      return this.auth.issue(data.credential);
    });
  }
  remove(origin, keyId, password, ip) {
    return this.run(async () => {
      const rpID = this.requireOrigin(origin), verified = await this.auth.verify(password, ip), data = await this.read();
      if (verified.hash !== data.credential) throw fail('Access changed. Unlock again.', 401);
      const index = data.passkeys.findIndex(key => key.id === keyId && key.rpID === rpID);
      if (index === -1) throw fail('Passkey is no longer registered.', 404);
      data.passkeys.splice(index, 1); await this.save(data); return { ok: true };
    });
  }
}
