// The room's colours, chosen with the buttons on the captain's arm; adding one takes one entry here.
// `lamp` is its button's colour.
// All stay clear of the signal hues, and chairs stay dull so they never bloom.
export const PALETTES = {
  neon: { name: 'Neon', lamp: '#ff4fd0', wall: '#22378e', ceiling: '#1c2c78', bay: '#2a44a4', trim: '#4d6be0', console: '#1c2268', mount: '#171b52', rail: '#5f74d8', chair: '#3a3d6a', seat: '#565a8a', door: '#3a55c8', pit: '#181450', deck: '#323a96', neon: '#ff4fd0', tones: ['#e4eaff', '#ff6ac4', '#6a8cff'], ambient: 1.15 },
  violet: { name: 'Violet', lamp: '#b48cff', wall: '#5a38a8', ceiling: '#4a2f92', bay: '#6a48b8', trim: '#8f74e0', console: '#241a6a', mount: '#241a62', rail: '#7f66d0', chair: '#4a3c70', seat: '#6a5a8e', door: '#3a2a8c', pit: '#281a6e', deck: '#603eaa', neon: '#58b4ff', tones: ['#e6dcff', '#58b4ff', '#b48cff'], ambient: 1.15 },
  arctic: { name: 'Arctic', lamp: '#e6ebf2', wall: '#e6ebf2', ceiling: '#dfe5ee', bay: '#cfd8e6', trim: '#9fb0c8', console: '#1450c8', mount: '#0f2a6e', rail: '#6f8cc4', chair: '#4a5a78', seat: '#747e92', door: '#5f8ae0', pit: '#143caa', deck: '#78a5e1', neon: '#3f9dff', tones: ['#ffffff', '#7fb4ff', '#3f7dff'], ambient: .6 },
  // From Lospec, every colour out of the palette named. Endesga 32, by ENDESGA.
  steel: { name: 'Steel', lamp: '#0099db', wall: '#3a4466', ceiling: '#262b44', bay: '#5a6988', trim: '#8b9bb4', console: '#181425', mount: '#262b44', rail: '#8b9bb4', chair: '#3a4466', seat: '#5a6988', door: '#5a6988', pit: '#262b44', deck: '#5a6988', neon: '#0099db', tones: ['#ffffff', '#0099db', '#c0cbdc'], ambient: 1.15 },
  // Apollo, by AdamCYounis.
  harbour: { name: 'Harbour', lamp: '#df84a5', wall: '#3c5e8b', ceiling: '#253a5e', bay: '#4f8fba', trim: '#73bed3', console: '#172038', mount: '#172038', rail: '#73bed3', chair: '#394a50', seat: '#577277', door: '#3c5e8b', pit: '#253a5e', deck: '#4f8fba', neon: '#df84a5', tones: ['#ebede9', '#df84a5', '#73bed3'], ambient: 1.15 },
  moss: { name: 'Moss', lamp: '#a8ca58', wall: '#25562e', ceiling: '#202e37', bay: '#468232', trim: '#75a743', console: '#172038', mount: '#202e37', rail: '#75a743', chair: '#394a50', seat: '#577277', door: '#468232', pit: '#172038', deck: '#25562e', neon: '#d0da91', tones: ['#ebede9', '#a8ca58', '#73bed3'], ambient: 1.15 },
  // Resurrect 64, by Kerrie Lake.
  plum: { name: 'Plum', lamp: '#eaaded', wall: '#45293f', ceiling: '#323353', bay: '#6b3e75', trim: '#905ea9', console: '#323353', mount: '#45293f', rail: '#a884f3', chair: '#484a77', seat: '#7f708a', door: '#6b3e75', pit: '#323353', deck: '#6b3e75', neon: '#8fd3ff', tones: ['#eaaded', '#8fd3ff', '#a884f3'], ambient: 1.15 },
  // Vinik24, by Vinik.
  dusk: { name: 'Dusk', lamp: '#c5ccb8', wall: '#666092', ceiling: '#433455', bay: '#7ca1c0', trim: '#a593a5', console: '#433455', mount: '#433455', rail: '#7ca1c0', chair: '#433455', seat: '#6f6776', door: '#416aa3', pit: '#433455', deck: '#416aa3', neon: '#7ca1c0', tones: ['#c5ccb8', '#8b5580', '#7ca1c0'], ambient: 1.15 },
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
