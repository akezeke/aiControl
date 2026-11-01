// The sidebar's world map, the old RPG's corner map: grey lands on a see-through sea, each project's party a block of dots on the land it fights on, and while a fight is open, the camera's red dot and its yellow cone of view.
// scripts/fantasy-frames.mjs draws the lands (world.svg) round these same spots.
import { buildFights } from './roster.js';

export const WORLD = 64;
// Each place's spots in map pixels, one per hour: a place that takes a second or third project fights it at another hour, nearby on the same land.
export const SITES = {
  wrecks: { day: [12, 10], dusk: [6, 16], night: [20, 7] },
  meadow: { day: [20, 27], dusk: [13, 23], night: [23, 34] },
  wood: { day: [29, 48], dusk: [23, 43], night: [33, 55] },
  reactor: { day: [47, 11], dusk: [40, 16], night: [55, 8] },
  mesa: { day: [51, 32], dusk: [45, 27], night: [54, 40] },
  ember: { day: [11, 52], dusk: [7, 58], night: [17, 57] },
};
// Dots three map pixels apart (two wide plus a gap), the camera seven back from its party.
const PITCH = 3, BACK = 7;

export const fieldSpot = (place, time) => { const hours = SITES[place] ?? SITES.meadow; return hours[time] ?? hours.day; };

// Pure: the middle of each party member's dot, and of each party, in map pixels. A party stands in a square block on its field's spot; minions aren't on the map.
// The world is square, WORLD map pixels a side, each drawn three CSS pixels wide in the sidebar.
export function worldSpots(sessions = [], fields = null) {
  const members = new Map(), parties = new Map();
  for (const fight of buildFights(sessions, () => false, fields)) {
    const [x, y] = fieldSpot(fight.place, fight.time), n = fight.members.length, cols = Math.ceil(Math.sqrt(n)), rows = Math.ceil(n / cols);
    const left = Math.floor(x - (cols - 1) * PITCH / 2), top = Math.floor(y - (rows - 1) * PITCH / 2);
    parties.set(fight.project, [x, y]);
    fight.members.forEach((member, i) => members.set(member.id, [left + i % cols * PITCH, top + Math.floor(i / cols) * PITCH]));
  }
  return { members, parties };
}

// Pure: where the camera stands, a few pixels back from the party it looks at, and which way it looks, in degrees from east, clockwise. Yaw 0 is the camera south of the party, looking north.
export function lookMark([x, y], yaw) {
  return { x: Math.round(x + Math.sin(yaw) * BACK), y: Math.round(y + Math.cos(yaw) * BACK), turn: Math.round(Math.atan2(-Math.cos(yaw), -Math.sin(yaw)) * 180 / Math.PI / 3) * 3 };
}

// ---- On the page. The console (theme-console.js) owns the contacts; this only says where they stand.
let parties = new Map(), look = null, drawn = '';
export function dressMap(screen, snapshot) {
  if (!screen || !snapshot) return;
  const spots = worldSpots(snapshot.sessions, snapshot.battlefields);
  parties = spots.parties;
  for (const contact of screen.querySelectorAll('.console-contact')) {
    const at = spots.members.get(contact.dataset.sessionId);
    contact.toggleAttribute('data-off-world', !at);
    contact.toggleAttribute('data-south', !!at && at[1] > WORLD / 2);
    if (at) { contact.style.setProperty('--world-x', `${at[0] / WORLD * 100}%`); contact.style.setProperty('--world-y', `${at[1] / WORLD * 100}%`); }
  }
  screen.setAttribute('data-world', '');
  drawn = ''; lookFrom(screen, look?.project, look?.yaw);
}

// Called every frame a fight is open, with null when it closes; cheap when nothing's moved.
export function lookFrom(screen, project = null, yaw = 0) {
  look = project ? { project, yaw } : null;
  const at = look && parties.get(project), mark = at && lookMark(at, yaw), key = mark ? `${mark.x},${mark.y},${mark.turn}` : '';
  if (key === drawn || !screen) return;
  drawn = key;
  let node = screen.querySelector(':scope > .world-look');
  if (!mark) { node?.remove(); return; }
  if (!node) { node = document.createElement('span'); node.className = 'world-look'; node.setAttribute('aria-hidden', 'true'); screen.append(node); }
  node.style.left = `${mark.x / WORLD * 100}%`; node.style.top = `${mark.y / WORLD * 100}%`; node.style.setProperty('--turn', `${mark.turn}deg`);
}
