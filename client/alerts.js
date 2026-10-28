// Attention signals. The favicon badge is always on; notifications (with vibration) and the theme's
// sound are opt-in. Orbit chimes, MU/TH/UR chatters like a teletype, EVA speaks.
const key = 'ai-control-alerts';
export const alertSettings = { notify: false, sound: false };
try { Object.assign(alertSettings, JSON.parse(localStorage.getItem(key) || '{}')); } catch { /* defaults */ }
export function saveAlerts() { try { localStorage.setItem(key, JSON.stringify(alertSettings)); } catch { /* per tab only */ } }
// Notifications need HTTPS (or localhost) for the service worker that shows them on phones too.
export const canNotify = () => !!globalThis.isSecureContext && 'Notification' in globalThis && 'serviceWorker' in navigator;

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
  alien: kind => { for (let i = 0; i < (kind === 'input' ? 7 : 3); i++) tone(i % 2 ? 1480 : 1760, i * .065, .04, 'square', .025); },
  command: kind => speak({ input: 'Orders required', ready: 'Unit ready', on: 'EVA online' }[kind]) || tone(440, 0, .2, 'sawtooth', .04),
};
export function playSound(kind) {
  try { audio?.resume(); (sounds[document.documentElement.dataset.theme] || sounds.modern)(kind); } catch { /* audio unavailable */ }
}

let worker;
export async function enableNotifications() {
  if (!canNotify()) return false;
  worker ??= navigator.serviceWorker.register('/sw.js');
  return await Notification.requestPermission() === 'granted';
}
// Clicking a notification asks the page to open that session.
export function listenForOpen(open) {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('message', event => { if (typeof event.data?.open === 'string') open(event.data.open); });
  if (alertSettings.notify && canNotify()) worker ??= navigator.serviceWorker.register('/sw.js');
}

export async function signal(events) {
  if (!events.length) return;
  const event = events.find(item => item.kind === 'input') || events[0];
  if (alertSettings.sound) playSound(event.kind);
  if (!alertSettings.notify || !canNotify() || Notification.permission !== 'granted' || (!document.hidden && document.hasFocus())) return;
  try {
    const registration = await (worker ??= navigator.serviceWorker.register('/sw.js'));
    await registration.showNotification(event.kind === 'input' ? 'Needs you' : 'Done', { body: events.length > 1 ? `${event.session.title} · +${events.length - 1} more` : event.session.title, tag: event.session.id, icon: '/favicon.svg', renotify: true, vibrate: event.kind === 'input' ? [120, 60, 120] : [80] });
  } catch { /* blocked or unsupported */ }
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
