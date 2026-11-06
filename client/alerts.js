// Attention signals. The favicon badge is always on; notifications (with vibration) and the theme's
// sound are opt-in. Orbit chimes, MU/TH/UR chatters like a teletype, EVA speaks.
const key = 'ai-control-alerts';
export const alertSettings = { notify: false, sound: false };
try { Object.assign(alertSettings, JSON.parse(localStorage.getItem(key) || '{}')); } catch { /* defaults */ }
export function saveAlerts() { try { localStorage.setItem(key, JSON.stringify(alertSettings)); } catch { /* per tab only */ } }
// Notifications need HTTPS (or localhost) for the service worker that shows them on phones too.
export const canNotify = () => !!globalThis.isSecureContext && 'Notification' in globalThis && 'serviceWorker' in navigator && 'PushManager' in globalThis;

const needsInput = status => status === 'question' || status === 'permission';
// 'input' when a session starts waiting for you, 'ready' when a top-level session finishes working.
export function statusEvents(previous, sessions) {
  const events = [];
  for (const session of sessions) {
    const before = previous.get(session.id);
    if (before && before !== session.status) {
      if (needsInput(session.status) && !needsInput(before)) events.push({ kind: 'input', session });
      else if (before === 'working' && session.status === 'idle' && !session.parentId) events.push({ kind: 'ready', session });
    }
    previous.set(session.id, session.status);
  }
  return events;
}

let audio;
function tone(frequency, start, duration, type = 'sine', gain = .07) {
  audio ??= new AudioContext();
  const oscillator = audio.createOscillator(), amp = audio.createGain(), t = audio.currentTime + start;
  oscillator.type = type; oscillator.frequency.value = frequency;
  amp.gain.setValueAtTime(0, t); amp.gain.linearRampToValueAtTime(gain, t + .008); amp.gain.exponentialRampToValueAtTime(.0001, t + duration);
  oscillator.connect(amp).connect(audio.destination); oscillator.start(t); oscillator.stop(t + duration + .05);
}
function speak(text) {
  if (!globalThis.speechSynthesis) return false;
  const line = new SpeechSynthesisUtterance(text); line.rate = .95; line.pitch = .55;
  speechSynthesis.cancel(); speechSynthesis.speak(line); return true;
}
const sounds = {
  modern: kind => kind === 'input' ? (tone(880, 0, .4), tone(1318.5, .14, .6)) : tone(659.3, 0, .5),
  // An original cartoon mallet cue, played only through the opt-in Sound control.
  simpsons: kind => { const notes = kind === 'input' ? [783.99, 1046.5, 783.99] : [523.25, 783.99, 1046.5]; notes.forEach((note, i) => tone(note, i * .1, .22, 'triangle', .055)); },
  alien: kind => { for (let i = 0; i < (kind === 'input' ? 7 : 3); i++) tone(i % 2 ? 1480 : 1760, i * .065, .04, 'square', .025); },
  // A short comm chirp when someone needs you, a lower tone when they're done.
  bridge: kind => kind === 'input' ? (tone(1174.66, 0, .08, 'sine', .06), tone(1567.98, .09, .16, 'sine', .06)) : tone(392, 0, .35, 'triangle', .06),
  // Two square-wave blips when someone needs you, one when they're done.
  city: kind => kind === 'input' ? (tone(880, 0, .07, 'square', .03), tone(880, .12, .07, 'square', .03)) : tone(523.25, 0, .12, 'square', .03),
  // A menu's rising confirm when someone needs you, a short fanfare when they're done.
  fantasy: kind => (kind === 'input' ? [659.25, 880] : [523.25, 659.25, 783.99, 1046.5]).forEach((note, i) => tone(note, i * .08, .1, 'square', .03)),
  command: kind => speak({ input: 'Orders required', ready: 'Unit ready', on: 'EVA online' }[kind]) || tone(440, 0, .2, 'sawtooth', .04),
  // An original, quiet dungeon bell; enabled only through the existing Sound control.
  diablo: kind => { const notes = kind === 'input' ? [146.83, 155.56] : [146.83, 220]; notes.forEach((note, i) => { tone(note, i * .22, 1.1, 'triangle', .055); tone(note * 3, i * .22, .65, 'sine', .018); }); },
  // A short, original lute-like arpeggio. As with every theme, sound stays opt-in.
  // A castle horn: a drum thump, then a brassy call when someone needs you (two rising notes) or a short fanfare when they're done.
  bricks: kind => { tone(70, 0, .25, 'sine', .12); (kind === 'input' ? [329.63, 440] : [392, 523.25, 659.25]).forEach((note, i) => { tone(note, .12 + i * .17, .3, 'sawtooth', .035); tone(note * 2, .12 + i * .17, .22, 'square', .012); }); },
  heroes: kind => { const notes = kind === 'input' ? [392, 493.88, 587.33, 783.99] : [523.25, 659.25, 783.99]; notes.forEach((note, i) => { tone(note, i * .11, .48, 'triangle', .065); tone(note * 2, i * .11, .16, 'sine', .015); }); },
};
export function playSound(kind) {
  try { audio?.resume(); (sounds[document.documentElement.dataset.theme] || sounds.modern)(kind); } catch { /* audio unavailable */ }
}

let worker;
function getWorker() {
  return worker ??= navigator.serviceWorker.register('/sw.js').catch(error => { worker = null; throw error; });
}
async function registerPush(api) {
  const registration = await getWorker();
  await navigator.serviceWorker.ready;
  const { publicKey } = await api('push/key');
  const bytes = Uint8Array.from(atob(publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
  const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
  await api('push/subscribe', subscription.toJSON());
}
export async function enableNotifications(api) {
  if (!canNotify()) throw new Error(globalThis.isSecureContext ? 'Add AI Control to your Home Screen to enable notifications' : 'Notifications need HTTPS');
  if (await Notification.requestPermission() !== 'granted') throw new Error('Notifications are blocked for this app');
  await registerPush(api);
  return true;
}
export async function disableNotifications(api) {
  const registration = await getWorker();
  const subscription = await registration.pushManager.getSubscription();
  if (subscription) { await api('push/unsubscribe', { endpoint: subscription.endpoint }); await subscription.unsubscribe(); }
}
export function restoreNotifications(api) {
  if (alertSettings.notify && canNotify() && Notification.permission === 'granted') registerPush(api).catch(() => {});
}
// Clicking a notification asks the page to open that session.
export function listenForOpen(open) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', event => { if (typeof event.data?.open === 'string') open(event.data.open); });
}

export async function signal(events) {
  if (!events.length) return;
  const event = events.find(item => item.kind === 'input') || events[0];
  if (alertSettings.sound) playSound(event.kind);
}

// Favicon with an amber dot while anything needs you.
let plainIcon, badgeIcon;
export async function faviconBadge(count) {
  const link = document.querySelector('link[rel=icon]');
  if (!link || link.dataset.badge === String(count > 0)) return;
  link.dataset.badge = String(count > 0);
  plainIcon ??= link.href;
  if (!badgeIcon) {
    const svg = await fetch(plainIcon).then(response => response.text()).catch(() => '');
    if (!svg.includes('</svg>')) return;
    badgeIcon = `data:image/svg+xml,${encodeURIComponent(svg.replace('</svg>', '<circle cx="32" cy="8" r="8" fill="#f5a524" stroke="#111" stroke-width="2"/></svg>'))}`;
  }
  link.href = link.dataset.badge === 'true' ? badgeIcon : plainIcon;
}
