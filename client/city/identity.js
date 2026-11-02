// A session's look, fixed by its id: colour, crown, mass, windows. Pure, and shared by the building generator and the server's naming.
export const COLOURS = [['Red', '#e83b3b', '#0b5e65'], ['Teal', '#0eaf9b', '#cd683d'], ['Gold', '#f9c22b', '#484a77'], ['Pink', '#ed8099', '#0b8a8f'], ['Cream', '#fdcbb0', '#cd683d'], ['Blue', '#4d9be6', '#e6904e'], ['Mint', '#8ff8e2', '#484a77'], ['Violet', '#a884f3', '#f9c22b'], ['Copper', '#cd683d', '#0b5e65'], ['White', '#c7dcd0', '#4d65b4']];
export const CROWNS = ['Spire', 'Mast', 'Dish', 'Helipad', 'Tank', 'Pyramid', 'Clock', 'Dome', 'Ring', 'Flag'];
export const MASSES = ['slab', 'stepped', 'twin', 'podium', 'notched'];
const WINDOWS = ['grid', 'strips', 'fins', 'wide', 'curtain'], TRIMS = ['#fdcbb0', '#fdcbb0', '#ffffff', '#c7dcd0'];

export const fnv = text => { let h = 0x811c9dc5; for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };

const look = (id, c, k) => {
  const pick = (list, salt) => list[fnv(`${salt}:${id}`) % list.length], [colourName, colour, roof] = COLOURS[c];
  return { id, name: `${colourName} ${CROWNS[k]}`, colour, roof, crown: CROWNS[k], mass: pick(MASSES, 'mass'), windows: pick(WINDOWS, 'windows'), trim: ['Cream', 'White'].includes(colourName) ? roof : pick(TRIMS, 'trim'), w: 14 + fnv(`w:${id}`) % 3 * 2 };
};

// Next free colour and next free crown, so live sessions differ in both. Past ten live sessions, only the pair stays unique.
export function tower(id, taken = new Set()) {
  let c = fnv(`colour:${id}`) % COLOURS.length, k = fnv(`crown:${id}`) % CROWNS.length;
  const used = i => [...taken].map(name => name.split(' ')[i]);
  for (let n = 0; n < COLOURS.length && used(0).includes(COLOURS[c][0]); n++) c = (c + 1) % COLOURS.length;
  for (let n = 0; n < CROWNS.length && used(1).includes(CROWNS[k]); n++) k = (k + 1) % CROWNS.length;
  for (let n = 0; n < COLOURS.length * CROWNS.length && taken.has(`${COLOURS[c][0]} ${CROWNS[k]}`); n++) { c = (c + 1) % COLOURS.length; if (c === 0) k = (k + 1) % CROWNS.length; }
  const out = look(id, c, k); taken.add(out.name);
  return out;
}

// A look saved by name stays the same after a reload, whoever else has since moved in.
export function lookOf(id, name) {
  const [colour, crown] = String(name).split(' '), c = COLOURS.findIndex(entry => entry[0] === colour), k = CROWNS.indexOf(crown);
  return c < 0 || k < 0 ? tower(id) : look(id, c, k);
}
