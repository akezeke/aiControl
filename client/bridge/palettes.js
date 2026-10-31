// The room's colours, chosen with the buttons on the captain's arm; adding one takes one entry here.
// `lamp` is its button's colour.
// What catches the eye stays clear of the signal hues; a surface may share one only if it's dark. Chairs stay dull so they never bloom.
// `space` is the view outside: the wash, the clouds dark and bright, and the planet's low bands, high bands and dark belt.
const DEEP_BLUE = ['#305081', '#45277c', '#b550bc', '#6f7cce', '#bcd4fd', '#ad7cd4'];
export const PALETTES = {
  neon: { name: 'Neon', lamp: '#ff4fd0', wall: '#22378e', ceiling: '#1c2c78', bay: '#2a44a4', trim: '#4d6be0', console: '#1c2268', mount: '#171b52', rail: '#5f74d8', chair: '#3a3d6a', seat: '#565a8a', door: '#3a55c8', pit: '#181450', deck: '#323a96', neon: '#ff4fd0', tones: ['#e4eaff', '#ff6ac4', '#6a8cff'], ambient: 1.15, space: DEEP_BLUE },
  violet: { name: 'Violet', lamp: '#b48cff', wall: '#5a38a8', ceiling: '#4a2f92', bay: '#6a48b8', trim: '#8f74e0', console: '#241a6a', mount: '#241a62', rail: '#7f66d0', chair: '#4a3c70', seat: '#6a5a8e', door: '#3a2a8c', pit: '#281a6e', deck: '#603eaa', neon: '#58b4ff', tones: ['#e6dcff', '#58b4ff', '#b48cff'], ambient: 1.15, space: DEEP_BLUE },
  arctic: { name: 'Arctic', lamp: '#e6ebf2', wall: '#e6ebf2', ceiling: '#dfe5ee', bay: '#cfd8e6', trim: '#9fb0c8', console: '#1450c8', mount: '#0f2a6e', rail: '#6f8cc4', chair: '#4a5a78', seat: '#747e92', door: '#5f8ae0', pit: '#143caa', deck: '#78a5e1', neon: '#3f9dff', tones: ['#ffffff', '#7fb4ff', '#3f7dff'], ambient: .6, space: DEEP_BLUE },
  // From Lospec, every colour out of the palette named. Endesga 32, by ENDESGA.
  cobalt: { name: 'Cobalt', lamp: '#0099db', wall: '#124e89', ceiling: '#262b44', bay: '#0099db', trim: '#0099db', console: '#181425', mount: '#262b44', rail: '#0099db', chair: '#3a4466', seat: '#5a6988', door: '#0099db', pit: '#262b44', deck: '#124e89', neon: '#ffffff', tones: ['#ffffff', '#0099db', '#c0cbdc'], ambient: 1.15, space: ['#124e89', '#262b44', '#0099db', '#124e89', '#c0cbdc', '#0099db'] },
  // Apollo, by AdamCYounis.
  jungle: { name: 'Jungle', lamp: '#a8ca58', wall: '#468232', ceiling: '#25562e', bay: '#468232', trim: '#a8ca58', console: '#19332d', mount: '#19332d', rail: '#a8ca58', chair: '#394a50', seat: '#577277', door: '#75a743', pit: '#19332d', deck: '#25562e', neon: '#ebede9', tones: ['#ebede9', '#a8ca58', '#4f8fba'], ambient: 1.15, space: ['#19332d', '#25562e', '#75a743', '#25562e', '#a8ca58', '#468232'] },
  rust: { name: 'Rust', lamp: '#73bed3', wall: '#602c2c', ceiling: '#341c27', bay: '#7a4841', trim: '#4f8fba', console: '#241527', mount: '#341c27', rail: '#73bed3', chair: '#394a50', seat: '#577277', door: '#7a4841', pit: '#241527', deck: '#4d2b32', neon: '#73bed3', tones: ['#ebede9', '#73bed3', '#4f8fba'], ambient: 1.15, space: ['#341c27', '#4d2b32', '#a53030', '#602c2c', '#da863e', '#cf573c'] },
  radar: { name: 'Radar', lamp: '#a8ca58', wall: '#253a5e', ceiling: '#172038', bay: '#3c5e8b', trim: '#a8ca58', console: '#10141f', mount: '#151d28', rail: '#a8ca58', chair: '#394a50', seat: '#577277', door: '#3c5e8b', pit: '#151d28', deck: '#253a5e', neon: '#a8ca58', tones: ['#ebede9', '#a8ca58', '#4f8fba'], ambient: 1.15, space: ['#172038', '#19332d', '#468232', '#25562e', '#a8ca58', '#75a743'] },
  // Resurrect 64, by Kerrie Lake.
  lagoon: { name: 'Lagoon', lamp: '#8fd3ff', wall: '#0b5e65', ceiling: '#165a4c', bay: '#165a4c', trim: '#4d9be6', console: '#313638', mount: '#374e4a', rail: '#8fd3ff', chair: '#374e4a', seat: '#547e64', door: '#4d65b4', pit: '#313638', deck: '#374e4a', neon: '#8fd3ff', tones: ['#ffffff', '#8fd3ff', '#4d9be6'], ambient: 1.15, space: ['#0b5e65', '#165a4c', '#0b8a8f', '#0b5e65', '#8ff8e2', '#0eaf9b'] },
};
export const paletteFor = name => PALETTES[name] || PALETTES.neon;
const storageKey = 'ai-control-bridge-colour';
export function savedColour() {
  try { const name = localStorage.getItem(storageKey); return PALETTES[name] ? name : 'neon'; }
  catch { return 'neon'; }
}
export function saveColour(name) {
  try { localStorage.setItem(storageKey, name); } catch { /* Private browsing can disable storage. */ }
}
// The only colours allowed to compete for attention.
export const SIGNALS = { need: '#ff4a33', working: '#39e0c8', idle: '#9fb4e0', near: '#ff8426' };
