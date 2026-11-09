import { readFile, writeFile, rename } from 'node:fs/promises';
import { generateVAPIDKeys, sendNotification } from 'web-push';
import { statusEvents } from '../client/alerts.js';
import { normalizeNotificationPolicy, notificationAllowed } from '../client/notification-policy.js';
import { fail } from './requests.mjs';

function validSubscription(value) {
  try {
    const url = new URL(value.endpoint);
    const host = url.hostname;
    const trusted = host === 'fcm.googleapis.com' || host === 'updates.push.services.mozilla.com' || host.endsWith('.push.apple.com') || host.endsWith('.notify.windows.com');
    return url.protocol === 'https:' && !url.port && !url.username && !url.password && trusted && value.endpoint.length <= 2048 &&
      /^[A-Za-z0-9_-]{87}$/.test(value.keys.p256dh) && Buffer.from(value.keys.p256dh, 'base64url').length === 65 &&
      /^[A-Za-z0-9_-]{22}$/.test(value.keys.auth) && Buffer.from(value.keys.auth, 'base64url').length === 16;
  } catch { return false; }
}

export class PushNotifications {
  constructor(file, { send = sendNotification, credentialFile, now = Date.now } = {}) { this.file = file; this.send = send; this.credentialFile = credentialFile; this.now = now; this.policy = normalizeNotificationPolicy(); this.previous = new Map(); this.subscriptions = new Map(); this.pending = Promise.resolve(); }
  setPolicy(policy) { this.policy = normalizeNotificationPolicy(policy); }
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.file, 'utf8'));
      this.keys = saved.keys; this.credential = saved.credential;
      for (const sub of saved.subscriptions || []) if (validSubscription(sub)) this.subscriptions.set(sub.endpoint, sub);
      if (!this.keys?.publicKey || !this.keys?.privateKey) throw new Error('Invalid push keys');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.keys = generateVAPIDKeys(); await this.save();
    }
    await this.syncCredential();
    return this;
  }
  async syncCredential() {
    if (!this.credentialFile) return;
    const credential = JSON.parse(await readFile(this.credentialFile, 'utf8')).hash;
    if (this.credential !== credential) { this.credential = credential; this.subscriptions.clear(); await this.save(); }
  }
  get publicKey() { return this.keys.publicKey; }
  save() {
    const data = JSON.stringify({ keys: this.keys, credential: this.credential, subscriptions: [...this.subscriptions.values()] });
    this.pending = this.pending.catch(() => {}).then(async () => { await writeFile(`${this.file}.tmp`, data, { mode: 0o600 }); await rename(`${this.file}.tmp`, this.file); });
    return this.pending;
  }
  async subscribe(sub) {
    await this.syncCredential();
    if (!validSubscription(sub)) throw fail('Invalid push subscription.', 400);
    if (!this.subscriptions.has(sub.endpoint) && this.subscriptions.size >= 100) throw fail('Too many push subscriptions.', 400);
    this.subscriptions.set(sub.endpoint, { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } }); await this.save();
  }
  async unsubscribe(endpoint) { if (this.subscriptions.delete(endpoint)) await this.save(); }
  async update(sessions) {
    await this.syncCredential();
    const events = statusEvents(this.previous, sessions);
    const ids = new Set(sessions.map(session => session.id));
    for (const id of this.previous.keys()) if (!ids.has(id)) this.previous.delete(id);
    const now = this.now();
    for (const event of events) {
      if (!notificationAllowed(event, this.policy, now)) continue;
      // Keep push payloads small and readable, even when a session title comes from a long prompt.
      const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
      const payload = JSON.stringify({ kind: event.kind, id: event.session.id, status: event.session.status, title: text(event.session.title), project: text(event.session.project) });
      await Promise.all([...this.subscriptions.values()].map(async sub => {
        try { await this.send(sub, payload, { vapidDetails: { subject: 'https://github.com/akezeke/aiControl', ...this.keys }, TTL: 60, timeout: 10000 }); }
        catch (error) { if (error.statusCode === 404 || error.statusCode === 410) await this.unsubscribe(sub.endpoint); else console.error('[Push]', error.message); }
      }));
    }
  }
}
