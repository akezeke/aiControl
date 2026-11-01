// The enemy generator: the session title picks a family, and the title and turn pick the body plan and everything about it. Minions and the waiting hourglass are built the same way.
import { Rig, shade } from './rig.js';
import { Shape, limb } from './shapes.js';
import { rng } from './roster.js';

// [hide, glow]: strong hues that clash on purpose, as monsters should.
const VENOM = [[0xc8202a, 0xffe066], [0x12a158, 0xff7a1f], [0x2460c8, 0xffd34d], [0x0e9a9a, 0xff6a4d], [0x6d3bb8, 0xc6ff4d], [0xe8b808, 0xe0242a], [0xe6dfc8, 0xe0242a], [0x26282c, 0xff5a1f], [0x7cb518, 0xf3ead2], [0xe8650f, 0x4de0d0], [0x56687a, 0xd9ff5c]];
const BONE = 0xefe8d2, DARK = 0x12100c;
const TAU = Math.PI * 2, ok = () => {};

// A row of glowing eyes on a curved front. `count` of them, at (x spread, y), forward by z.
function eyes(g, count, spread, y, z, size, glow) {
  for (let i = 0; i < count; i++) { const x = count > 1 ? (i / (count - 1) - .5) * spread : 0; g.ball(size, size, size * .6, glow, { x, y: y + (count > 3 && i % 2 ? size * 1.4 : 0), z, rings: 2, sides: 5 }); }
  return g;
}
// Horns of several shapes; `s` is the side.
const HORNS = [
  (g, x, y, z, s, c) => g.tube([[s * x, y, z], [s * (x + .14), y + .22, z - .03], [s * (x + .1), y + .5, z - .08]], [.075, .05, 0], c, { sides: 5 }),
  (g, x, y, z, s, c) => g.tube([[s * x, y, z], [s * (x + .24), y + .08, z - .08], [s * (x + .44), y + .02, z - .04], [s * (x + .48), y + .24, z + .05]], [.075, .06, .04, 0], c, { sides: 5 }),
  (g, x, y, z, s, c) => g.tube([[s * x, y, z], [s * (x + .04), y + .16, z - .24], [s * (x + .02), y + .22, z - .56]], [.07, .05, 0], c, { sides: 5 }),
  () => {},
];

const BODIES = {
  bug: [
    // Beetle: a domed shell over six legs, with a horn or mandibles.
    k => {
      const { r, skin, dark, glow, rig, inner } = k, wide = .62 + r() * .22, long = .72 + r() * .3;
      const shell = new Shape().ball(wide, .48, long, skin, { y: .86, z: -.28, low: .55, sides: 10, rings: 4, c2: dark }).ball(wide * .92, .22, long * .95, dark, { y: .72, z: -.28, top: .1, sides: 10, rings: 3 });
      shell.plate([[-.02, -long], [.02, -long], [.02, long], [-.02, long]], .03, glow, { rx: Math.PI / 2, y: 1.33, z: -.3 });
      shell.ball(.44, .32, .36, dark, { y: .84, z: .55, sides: 8, rings: 4 }); eyes(shell, 2, .4, .92, .84, .07, glow);
      if (r() < .5) { shell.tube([[0, .98, .75], [0, 1.2, 1.05], [0, 1.56, 1.1], [0, 1.7, .9]], [.11, .08, .05, 0], BONE, { sides: 5, c2: shade(BONE, .8) }); } else for (const s of [-1, 1]) shell.tube([[s * .2, .72, .82], [s * .32, .7, 1.1], [s * .1, .68, 1.3]], [.07, .05, 0], BONE, { sides: 5 });
      if (r() > .4) for (let i = 0; i < 3; i++) shell.spike(.09, .32 + r() * .26, glow, { y: 1.26 - i * .04, z: -.05 - i * .36, rx: -.3, sides: 5 });
      rig.part(inner, shell);
      const legs = [];
      for (const s of [-1, 1]) for (let i = 0; i < 3; i++) legs.push(k.joint(s * wide * .75, .72, -.4 + i * .42, new Shape().tube([[0, 0, 0], [s * .48, .22, 0], [s * .82, -.28, i * .1 - .1], [s * .92, -.72, i * .15 - .15]], [.07, .055, .04, .012], dark, { sides: 5, c2: skin })));
      return { h: 1.5, anim: (t, kick) => legs.forEach((leg, i) => { leg.rotation.z = Math.sin(t * 7 + i * 2) * (.09 + kick * .2); }) };
    },
    // Mantis: upright, with scythe arms and wings folded down its back.
    k => {
      const { r, skin, dark, glow, rig, inner } = k;
      const thorax = new Shape().ball(.34, .4, .68, dark, { y: .95, z: -.6, sides: 8, rings: 4, c2: skin }).tube([[0, .95, -.1], [0, 1.25, .08], [0, 1.72, .14]], [.24, .17, .14], skin, { sides: 7 });
      thorax.lathe([[.0001, .2], [.24, .08], [.17, -.1], [.0001, -.24]], skin, { y: 1.9, z: .2, sz: .6, sides: 5, flat: true, c2: dark });
      for (const s of [-1, 1]) thorax.ball(.09, .1, .08, glow, { x: s * .17, y: 1.98, z: .24, rings: 3, sides: 5 });
      for (const s of [-1, 1]) thorax.tube([[s * .08, 2.06, .18], [s * .22, 2.4, .1], [s * .4, 2.6, -.06]], [.018, .014, .005], dark, { sides: 3 });
      for (const s of [-1, 1]) thorax.plate([[-.12, 0], [.14, 0], [.34, -.5], [.24, -1.24], [0, -1.5], [-.2, -.9]], .012, shade(skin, 1.25), { x: s * .26, y: 1.45, z: -.3, rx: -.6, ry: s * .22, c2: glow });
      rig.part(inner, thorax);
      for (const s of [-1, 1]) for (const z of [-.3, -.85]) k.joint(s * .2, .86, z, new Shape().tube([[0, 0, 0], [s * .5, .26, 0], [s * .82, -.86, 0]], [.05, .04, .012], dark, { sides: 4 }));
      const arms = [-1, 1].map(s => k.joint(s * .24, 1.55, .14, new Shape().tube([[0, 0, 0], [s * .26, .22, .22], [s * .22, .02, .62]], [.08, .07, .05], skin, { sides: 5 }).plate([[-.05, 0], [.07, 0], [.1, .44], [.05, .86], [-.02, 1.05], [.02, .42]], .025, BONE, { x: s * .22, z: .62, rx: Math.PI / 2 + .9, c2: shade(BONE, .7) })));
      return { h: 2.6, anim: (t, kick) => arms.forEach((arm, i) => { arm.rotation.x = -.15 + Math.sin(t * 1.3 + i) * .14 - kick * .9; }) };
    },
    // Spider: a heavy marked abdomen and eight arched legs.
    k => {
      const { r, skin, dark, glow, rig, inner } = k, size = .68 + r() * .24;
      const body = new Shape().ball(size, size * .82, size * 1.05, skin, { y: 1.04, z: -.5, sides: 10, rings: 5, c2: dark }).ball(.36, .28, .38, dark, { y: .92, z: .3, sides: 8, rings: 4 });
      const marks = r() * 3 | 0;
      if (marks === 0) body.gem(.2, .55, glow, { y: 1.04 + size * .8, z: -.6, rx: Math.PI / 2 });
      else if (marks === 1) for (let i = 0; i < 3; i++) body.ball(.1, .05, .1, glow, { y: 1.04 + size * .8 - i * .05, z: -.3 - i * .3, rings: 2, sides: 6 });
      else for (const s of [-1, 1]) body.tube([[s * .22, 1.04 + size * .76, -.15], [s * .34, 1.04 + size * .66, -.6], [s * .16, 1.04 + size * .72, -1]], [.05, .05, 0], glow, { sides: 4 });
      eyes(body, 6, .34, .98, .63, .042, glow);
      for (const s of [-1, 1]) body.tube([[s * .1, .84, .6], [s * .13, .72, .78], [s * .07, .56, .82]], [.06, .045, 0], BONE, { sides: 4 });
      rig.part(inner, body);
      const legs = [];
      for (const s of [-1, 1]) for (let i = 0; i < 4; i++) { const f = (i - 1.5) * .34; legs.push(k.joint(s * .24, .94, .3 + f * .28, new Shape().tube([[0, 0, 0], [s * .55, .58, f * .55], [s * 1.08, .32, f * 1.1], [s * 1.36, -.92, f * 1.5]], [.065, .05, .036, .008], dark, { sides: 4, c2: skin }))); }
      return { h: 1.9, anim: (t, kick) => legs.forEach((leg, i) => { leg.rotation.z = Math.sin(t * 5 + i * 1.7) * (.05 + kick * .18); }) };
    },
  ],
  golem: [
    // Rock: heaped boulders and a crack of light through the chest.
    k => {
      const { r, skin, dark, glow, rig, inner } = k;
      const chest = new Shape().rock(.9, skin, r, { y: 1.55, sy: .82, sz: .68, c2: dark, sides: 7, rough: .16 }).rock(.5, dark, r, { y: .72, sz: .7, sy: .8 }).rock(.36, skin, r, { y: 2.4, sz: .9, sy: .8, c2: dark });
      eyes(chest, r() < .3 ? 1 : 2, .24, 2.42, .31, .055, glow);
      chest.plate([[-.1, .36], [.06, .22], [-.04, .06], [.14, -.14], [-.02, -.32], [.0, -.08], [-.16, .08], [-.02, .22]], .03, glow, { y: 1.58, z: .6 });
      for (let i = 0; i < 5; i++) { const a = r() * TAU, s = .18 + r() * .22; chest.rock(s, shade(skin, .8 + r() * .35), r, { x: Math.cos(a) * .76, y: 2.02 + r() * .22, z: Math.sin(a) * .4, sides: 5, rings: 3 }); }
      for (const s of [-1, 1]) chest.rock(.3, dark, r, { x: s * .36, y: .28, sz: 1.2, sy: .9 });
      rig.part(inner, chest);
      const fists = [-1, 1].map(s => k.joint(s * 1.18, 1.42, .2, new Shape().rock(.34, skin, r, { y: .36, c2: dark, sides: 5, rings: 3 }).rock(.44, skin, r, { y: -.16, c2: dark })));
      return { h: 2.75, anim: (t, kick) => fists.forEach((fist, i) => { fist.position.y = 1.42 + Math.sin(t * 1.6 + i * 2) * .13; fist.position.z = .2 + kick * .7; }) };
    },
    // Iron: a riveted boiler on pipe arms, with a furnace for a heart.
    k => {
      const { r, skin, dark, glow, rig, inner } = k, metal = shade(skin, 1.1);
      const chest = new Shape().lathe([[.0001, 1], [.55, .94], [.78, .6], [.78, -.3], [.55, -.6], [.0001, -.64]], metal, { y: 1.42, sides: 9, sz: .76, flat: true, c2: dark });
      for (let i = 0; i < 2; i++) chest.lathe([[.8, .03], [.8, -.03]], dark, { y: 1.1 + i * .7, sides: 9, sz: .77 });
      chest.lathe([[.28, .05], [.28, -.05]], dark, { y: 1.46, z: .58, rx: Math.PI / 2, sides: 8 }).lathe([[.2, .03], [.2, -.03]], glow, { y: 1.46, z: .62, rx: Math.PI / 2, sides: 8 });
      chest.lathe([[.0001, .3], [.26, .25], [.3, 0], [.26, -.15]], shade(metal, .9), { y: 2.52, sides: 7, flat: true }); chest.box(.42, .075, .08, glow, { y: 2.54, z: .26 });
      for (const s of [-1, 1]) { chest.lathe([[.13, .45], [.15, 0], [.26, -.45], [.3, -.5], [.0001, -.5]], dark, { x: s * .38, y: .47, sides: 7, c2: metal }); chest.tube([[s * .3, 2.3, -.22], [s * .35, 2.8, -.36], [s * .42, 3.06, -.4]], [.09, .08, .1], dark, { sides: 6 }); }
      rig.part(inner, chest);
      const fists = [-1, 1].map(s => k.joint(s * .78, 2.05, 0, new Shape().tube([[0, 0, 0], [s * .34, -.14, 0], [s * .42, -.56, .08]], [.13, .1, .1], dark, { sides: 6 }).lathe([[.0001, .24], [.26, .16], [.3, -.1], [.2, -.26], [.0001, -.28]], metal, { x: s * .42, y: -.76, z: .08, sides: 6, flat: true, c2: dark })));
      return { h: 3, anim: (t, kick) => fists.forEach((fist, i) => { fist.rotation.x = Math.sin(t * 1.5 + i * 3) * .16 - kick * 1; }) };
    },
    // Crystal: shards growing from a dark core, and hands that float free.
    k => {
      const { r, skin, dark, glow, rig, inner } = k;
      const body = new Shape().rock(.62, dark, r, { y: 1.45, sy: 1.2, sz: .8, c2: DARK, sides: 6 });
      for (let i = 0; i < 11; i++) { const a = i / 11 * TAU, up = r() * .8 + .1, len = .5 + r() * .9; body.gem(.12 + r() * .16, len, i % 3 ? skin : glow, { x: Math.cos(a) * .42, y: 1.42 + up, z: Math.sin(a) * .28, rz: -Math.cos(a) * .9, rx: Math.sin(a) * .7, sides: 5 }); }
      body.gem(.22, .78, glow, { y: 2.58, sides: 6 }); eyes(body, 2, .26, 2.2, .4, .05, glow); body.gem(.14, .56, skin, { x: -.24, y: .36, sides: 4 }).gem(.14, .56, skin, { x: .24, y: .36, sides: 4 });
      rig.part(inner, body);
      const hands = [-1, 1].map(s => k.joint(s * 1.28, 1.6, .25, new Shape().gem(.26, .74, skin, { sides: 5 }).gem(.1, .34, glow, { x: s * .14, y: .18, rz: s * .6, sides: 4 })));
      return { h: 3, anim: (t, kick) => hands.forEach((hand, i) => { hand.position.y = 1.6 + Math.sin(t * 1.3 + i * 2.6) * .22; hand.rotation.y = t * .7; hand.position.z = .25 + kick * .9; }) };
    },
  ],
  sentinel: [
    // An eye held in a ring of blades.
    k => {
      const { r, skin, dark, glow, inner } = k, count = 3 + (r() * 5 | 0);
      const core = k.joint(0, 1.65, 0, new Shape().ball(.62, .62, .62, skin, { sides: 10, rings: 6, c2: dark }).ball(.34, .34, .14, 0xf0ecdc, { z: .54, rings: 3, sides: 8 }).ball(.17, .17, .08, glow, { z: .65, rings: 2, sides: 7 }));
      const ring = new Shape();
      for (let i = 0; i < count; i++) { const a = i / count * TAU; ring.plate([[-.14, -.12], [.14, -.12], [.1, .2], [0, .46], [-.1, .2]], .05, dark, { x: Math.cos(a) * .98, z: Math.sin(a) * .98, ry: -a + Math.PI / 2, rx: Math.PI / 2 - .3, ridge: .04, c2: skin }); ring.gem(.06, .18, glow, { x: Math.cos(a) * .86, z: Math.sin(a) * .86, sides: 4 }); }
      const spin = k.joint(0, 1.65, 0, ring); void inner;
      return { h: 2.5, anim: t => { spin.rotation.y = t * .9; spin.rotation.z = Math.sin(t * .6) * .28; core.position.y = 1.65 + Math.sin(t * 1.3) * .12; spin.position.y = core.position.y; } };
    },
    // A standing stone with an eye cut in it, and a slab that hovers over it.
    k => {
      const { r, skin, dark, glow, rig, inner } = k;
      const stone = new Shape().lathe([[.0001, 2.55], [.3, 2.32], [.46, 1.6], [.6, .3], [.72, 0]], skin, { sides: 4, turn: Math.PI / 4, sz: .72, flat: true, c2: dark });
      stone.plate([[-.24, 0], [0, .15], [.24, 0], [0, -.15]], .03, 0xf0ecdc, { y: 1.72, z: .32 }).ball(.1, .1, .06, glow, { y: 1.72, z: .355, rings: 2, sides: 6 });
      for (let i = 0; i < 3; i++) stone.box(.46 - i * .1, .04, .02, glow, { y: .5 + i * .3, z: .42 - i * .03 });
      rig.part(inner, stone);
      const slab = k.joint(0, 3.1, 0, new Shape().lathe([[.0001, .13], [.5, .06], [.5, -.06], [.0001, -.13]], dark, { sides: 4, turn: Math.PI / 4, flat: true, c2: skin }).gem(.1, .32, glow, { y: -.25, sides: 4 }));
      return { h: 3.2, anim: t => { slab.rotation.y = t * .5; slab.position.y = 3.1 + Math.sin(t * 1.2) * .1; } };
    },
    // A floating mask with blades for a crown.
    k => {
      const { r, skin, dark, glow, inner } = k;
      const mask = new Shape().lathe([[.0001, .78], [.42, .6], [.54, .2], [.46, -.34], [.2, -.8], [.0001, -.92]], 0xe8dfc4, { sz: .42, sides: 8, c2: skin, flat: true });
      for (const s of [-1, 1]) mask.plate([[-.15, .04], [.15, .1], [.12, -.08], [-.1, -.08]], .02, DARK, { x: s * .22, y: .16, z: .2, rz: s * -.25 }).ball(.05, .05, .03, glow, { x: s * .22, y: .16, z: .225, rings: 2, sides: 5 });
      mask.plate([[-.02, .25], [.02, .25], [.09, -.25], [-.09, -.25]], .02, dark, { y: -.14, z: .225 });
      const blades = 3 + (r() * 4 | 0);
      for (let i = 0; i < blades; i++) { const a = (i / (blades - 1) - .5) * 2; mask.plate([[-.08, 0], [.08, 0], [.03, .6 + r() * .3], [-.03, .6 + r() * .3]], .03, dark, { x: a * .4, y: .56, z: -.04, rz: -a * .55, ridge: .02, c2: glow }); }
      const head = k.joint(0, 1.8, 0, mask), orbs = [0, 1, 2].map(i => k.joint(0, 1.2, 0, new Shape().gem(.12, .36, glow, { sides: 4 }).gem(.05, .16, skin, { y: .24, sides: 4 })));
      void inner;
      return { h: 2.9, anim: t => { head.position.y = 1.8 + Math.sin(t * 1.2) * .1; head.rotation.y = Math.sin(t * .7) * .2; orbs.forEach((orb, i) => { const a = t * 1.2 + i / 3 * TAU; orb.position.x = Math.cos(a) * 1.05; orb.position.z = Math.sin(a) * .9; orb.position.y = 1.15 + Math.sin(t + i * 2) * .2; orb.rotation.y = t; }); } };
    },
  ],
  wraith: [
    // A hooded cloak, tatters for a hem, and something carried in the off hand.
    k => {
      const { r, skin, dark, glow, inner } = k, g = new Shape();
      g.lathe([[.0001, 2.46], [.24, 2.34], [.4, 2.02], [.5, 1.6], [.66, .9], [.85, .3], [.9, .18]], skin, { sz: .72, sides: 9, c2: dark, lean: .06 });
      g.ball(.32, .34, .34, dark, { y: 2.08, z: .1, sides: 8, rings: 4 }); g.ball(.25, .26, .14, DARK, { y: 2.04, z: .32, rings: 3, sides: 7 });
      const face = r() * 3 | 0;
      if (face === 0) eyes(g, 2, .17, 2.08, .42, .05, glow);
      else if (face === 1) { g.ball(.15, .17, .1, 0xe8dfc4, { y: 2.06, z: .37, rings: 3, sides: 7 }); eyes(g, 2, .14, 2.09, .46, .035, glow); } else eyes(g, 1, 0, 2.08, .42, .09, glow);
      for (let i = 0; i < 9; i++) { const a = i / 9 * TAU, len = .28 + r() * .34; g.tube([[Math.cos(a) * .82, .26, Math.sin(a) * .6], [Math.cos(a) * .9, .05, Math.sin(a) * .66], [Math.cos(a) * .86, .24 - len, Math.sin(a) * .62]], [.16, .1, 0], dark, { sides: 4 }); }
      const all = k.joint(0, 0, 0, g), side = r() * 3 | 0, hand = new Shape().ball(.11, .15, .11, 0xe8dfc4, { rings: 3, sides: 6 });
      if (side === 0) hand.box(.54, .08, .42, glow, { y: .2, rz: .1 }).box(.5, .03, .38, 0xf0ecdc, { y: .26, rz: .1 });
      else if (side === 1) hand.lathe([[.0001, .04], [.14, -.05], [.14, -.34], [.0001, -.42]], glow, { y: -.14, sides: 6 }).lathe([[.06, .1], [.02, .04]], dark, { y: -.06, sides: 5 });
      else hand.lathe([[.03, .9], [.035, -1.3]], 0x4a3628, { sides: 5 }).plate([[0, 0], [.2, .22], [.7, .2], [1.1, -.1], [.6, .02], [.14, -.06]], .02, 0xd8d2c0, { y: .85, c2: glow });
      const held = k.joint(.92, 1.42, .35, hand), other = k.joint(-.86, 1.32, .3, new Shape().ball(.11, .15, .11, 0xe8dfc4, { rings: 3, sides: 6 }));
      void inner;
      return { h: 2.6, anim: t => { all.position.y = Math.sin(t * 1.3) * .1; held.position.y = 1.42 + Math.sin(t * 1.9) * .1; other.position.y = 1.32 + Math.sin(t * 1.6 + 2) * .1; } };
    },
    // A wisp: a flame of a body with a skull in it and no legs at all.
    k => {
      const { r, skin, dark, glow, inner } = k, g = new Shape().lathe([[.0001, 2.7, glow], [.2, 2.3], [.46, 1.9], [.58, 1.4], [.44, .9], [.16, .45], [.0001, .1]], skin, { sides: 8, c2: dark, lean: -.1 });
      for (let i = 0; i < 4; i++) { const a = i / 4 * TAU + r(); g.tube([[Math.cos(a) * .4, 1.8, Math.sin(a) * .4], [Math.cos(a) * .62, 2.2, Math.sin(a) * .6], [Math.cos(a) * .36, 2.7 + r() * .4, Math.sin(a) * .36]], [.16, .11, 0], i % 2 ? glow : skin, { sides: 5 }); }
      g.ball(.3, .33, .32, 0xe8dfc4, { y: 1.62, z: .3, rings: 4, sides: 8 }); for (const s of [-1, 1]) g.ball(.08, .09, .05, DARK, { x: s * .12, y: 1.66, z: .58, rings: 2, sides: 5 }).ball(.035, .035, .02, glow, { x: s * .12, y: 1.66, z: .625, rings: 2, sides: 4 });
      for (let i = 0; i < 4; i++) g.box(.05, .08, .03, DARK, { x: (i - 1.5) * .08, y: 1.42, z: .56 });
      const all = k.joint(0, 0, 0, g), sparks = [0, 1].map(i => k.joint(0, 1.5, 0, new Shape().gem(.1, .3, glow, { sides: 4 }))); void inner;
      return { h: 3, anim: t => { all.position.y = Math.sin(t * 1.6) * .1; all.rotation.y = Math.sin(t * .8) * .14; sparks.forEach((spark, i) => { const a = t * 2 + i * Math.PI; spark.position.set(Math.cos(a) * 1, 1.5 + Math.sin(t * 2 + i) * .4, Math.sin(a) * 1); }); } };
    },
  ],
  drone: [
    // Quad rotors on a shallow hull with a gun or two under it.
    k => {
      const { r, skin, dark, glow, rig, inner } = k, b = new Shape().ball(.72, .24, .86, skin, { y: 1.5, sides: 10, rings: 4, c2: dark });
      b.ball(.28, .17, .26, 0x12100c, { y: 1.46, z: .68, rings: 3, sides: 7 }).ball(.11, .1, .05, glow, { y: 1.46, z: .93, rings: 2, sides: 6 });
      for (const s of [-1, 1]) b.lathe([[.06, .4], [.07, -.3]], dark, { x: s * .32, y: 1.22, z: .36, rx: Math.PI / 2, sides: 6 });
      b.spike(.12, .3, glow, { y: 1.72, z: -.1, sides: 5 });
      const rotors = [];
      for (const [x, z] of [[-1, -.75], [1, -.75], [-1, .7], [1, .7]]) {
        b.tube([[x * .4, 1.56, z * .55], [x * .98, 1.72, z]], [.05, .04], dark, { sides: 4 }); b.lathe([[.1, .13], [.13, -.12]], skin, { x: x * 1, y: 1.74, z, sides: 7 });
        rotors.push(k.joint(x, 1.9, z, new Shape().plate([[-.5, -.05], [.5, -.05], [.5, .05], [-.5, .05]], .012, glow, { rx: Math.PI / 2 }).plate([[-.05, -.5], [.05, -.5], [.05, .5], [-.05, .5]], .012, glow, { rx: Math.PI / 2 })));
      }
      rig.part(inner, b);
      return { h: 2, anim: (t, kick, body) => { rotors.forEach(rotor => { rotor.rotation.y = t * 23; }); body.position.y = Math.sin(t * 1.8) * .1; } };
    },
    // A saucer, turning, with a beam lens underneath.
    k => {
      const { r, skin, dark, glow, rig, inner } = k, g = new Shape().lathe([[.0001, .2, glow], [.34, .16, glow], [.44, .06], [1.1, -.04], [1.14, -.1], [.58, -.26], [.0001, -.3]], skin, { sides: 12, y: 1.6, c2: dark });
      const lights = 6 + (r() * 4 | 0);
      for (let i = 0; i < lights; i++) { const a = i / lights * TAU; g.ball(.05, .05, .05, glow, { x: Math.cos(a) * .96, y: 1.53, z: Math.sin(a) * .96, rings: 2, sides: 5 }); }
      g.lathe([[.22, -.25], [.12, -.44], [.0001, -.5]], glow, { y: 1.6, sides: 7 });
      for (const s of [-1, 1]) g.tube([[s * .45, 1.4, 0], [s * .55, 1.1, .08], [s * .4, .78, .22]], [.05, .035, 0], dark, { sides: 4 });
      const spin = k.joint(0, 0, 0, g); void rig; void inner;
      return { h: 2, anim: t => { spin.rotation.y = t * 1.3; spin.position.y = Math.sin(t * 1.5) * .12; spin.rotation.z = Math.sin(t * .8) * .06; } };
    },
    // A walker: a cannon hull on three bent legs.
    k => {
      const { r, skin, dark, glow, rig, inner } = k;
      const hull = new Shape().lathe([[.0001, .46], [.5, .34], [.62, 0], [.48, -.3], [.0001, -.38]], skin, { y: 1.55, sides: 7, flat: true, c2: dark });
      hull.box(.46, .09, .06, glow, { y: 1.7, z: .49 });
      hull.lathe([[.14, .55], [.17, -.5]], dark, { y: 1.42, z: .84, rx: Math.PI / 2, sides: 7 }).lathe([[.2, .05], [.2, -.05]], glow, { y: 1.42, z: 1.38, rx: Math.PI / 2, sides: 7 });
      rig.part(inner, hull);
      const legs = [0, 1, 2].map(i => { const a = i / 3 * TAU + Math.PI / 2, c = Math.cos(a), s = Math.sin(a); return k.joint(c * .45, 1.3, s * .45, new Shape().tube([[0, 0, 0], [c * .68, .3, s * .68], [c * 1.18, -.46, s * 1.18], [c * 1.25, -1.28, s * 1.25]], [.08, .07, .055, .025], dark, { sides: 5, c2: skin })); });
      return { h: 2.1, anim: (t, kick) => legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 2.5 + i * 2) * (.02 + kick * .12); }) };
    },
  ],
  slime: [
    // A heaped blob with two big eyes.
    k => {
      const { r, skin, dark, glow } = k, wide = .96 + r() * .32;
      const b = new Shape().lathe([[.0001, 1.3, shade(skin, 1.25)], [.3, 1.2], [.68 * wide, .84], [wide, .42], [1.04 * wide, .14], [.92 * wide, 0], [.0001, 0]], skin, { sides: 12, c2: dark });
      for (const s of [-1, 1]) { const size = .17 + r() * .08; b.ball(size, size * 1.2, size * .55, 0xf3ead2, { x: s * .26, y: .78, z: .7 * wide - .03, rings: 3, sides: 7 }); b.ball(size * .5, size * .68, size * .3, DARK, { x: s * .26, y: .75, z: .74 * wide, rings: 2, sides: 6 }); }
      const crown = r();
      if (crown < .3) b.spike(.1, .34, glow, { y: 1.34, sides: 5 });
      else if (crown < .55) for (let i = 0; i < 5; i++) { const a = i / 5 * TAU; b.plate([[-.07, 0], [.07, 0], [0, .24]], .03, glow, { x: Math.cos(a) * .22, y: 1.16, z: Math.sin(a) * .22, ry: -a + Math.PI / 2 }); }
      else if (crown < .8) b.tube([[0, 1.25, 0], [.14, 1.52, -.05], [.26, 1.62, .04]], [.05, .03, .08], glow, { sides: 4 });
      const blob = k.joint(0, 0, 0, b), drops = [0, 1, 2].map(i => k.joint(0, .3, 0, new Shape().ball(.11, .14, .11, skin, { rings: 3, sides: 6, c2: glow })));
      return { h: 1.6, anim: t => { const s = Math.sin(t * 2.6) * .07; blob.scale.set(1 + s, 1 - s, 1 + s); drops.forEach((drop, i) => { const a = t * .8 + i * 2.1; drop.position.set(Math.cos(a) * 1.5, .22 + Math.abs(Math.sin(t * 2 + i)) * .4, Math.sin(a) * 1.3); }); } };
    },
    // A stack of three that wobble out of step, and one eye on the top.
    k => {
      const { r, skin, dark, glow } = k, parts = [[.92, .5, 0], [.68, .42, .66], [.46, .36, 1.2]].map(([w, h, y], i) => {
        const g = new Shape().ball(w, h, w, i % 2 ? shade(skin, 1.15) : skin, { sides: 10, rings: 4, c2: dark });
        if (i === 2) g.ball(.22, .22, .12, 0xf3ead2, { y: .03, z: w - .05, rings: 3, sides: 7 }).ball(.1, .11, .06, DARK, { y: .03, z: w + .02, rings: 2, sides: 6 });
        return k.joint(0, y + h * .5, 0, g);
      });
      parts[0].userData.y = parts[0].position.y; void glow; void r;
      return { h: 2, anim: t => parts.forEach((part, i) => { part.position.x = Math.sin(t * 2.2 + i * 1.3) * .07 * i; part.position.z = Math.cos(t * 1.8 + i) * .05 * i; const s = Math.sin(t * 2.6 + i) * .05; part.scale.set(1 + s, 1 - s, 1 + s); }) };
    },
    // A jelly hung from a bell, with long trailing arms.
    k => {
      const { r, skin, dark, glow } = k, bell = new Shape().ball(.92, .68, .92, skin, { y: 1.72, low: .1, sides: 10, rings: 4, c2: glow });
      bell.ball(.34, .3, .34, glow, { y: 1.68, rings: 3, sides: 7 }); for (const s of [-1, 1]) bell.ball(.1, .12, .06, DARK, { x: s * .3, y: 1.92, z: .78, rings: 2, sides: 5 });
      const all = k.joint(0, 0, 0, bell), count = 6 + (r() * 3 | 0), arms = Array.from({ length: Math.min(8, count) }, (_, i) => { const a = i / Math.min(8, count) * TAU; return k.joint(Math.cos(a) * .66, 1.68, Math.sin(a) * .66, new Shape().tube([[0, 0, 0], [Math.cos(a) * .1, -.5, Math.sin(a) * .1], [-Math.cos(a) * .06, -1, -Math.sin(a) * .06], [Math.cos(a) * .06, -1.5, Math.sin(a) * .06]], [.09, .07, .05, 0], dark, { sides: 4, c2: glow })); });
      return { h: 2.5, anim: t => { const y = Math.sin(t * 1.5) * .12, s = Math.sin(t * 1.5) * .06; all.position.y = y; all.scale.set(1 + s, 1 - s, 1 + s); arms.forEach((arm, i) => { arm.position.y = 1.68 + y; arm.rotation.x = Math.sin(t * 2 + i) * .12; arm.rotation.z = Math.cos(t * 1.7 + i * 2) * .12; }); } };
    },
  ],
  serpent: [
    // A cobra: coiled at the base, reared up, with a hood.
    k => {
      const { r, skin, dark, glow, rig, inner } = k, segs = 6 + (r() * 3 | 0), coil = new Shape();
      coil.tube(Array.from({ length: 13 }, (_, i) => { const a = i / 12 * TAU * 1.6; return [Math.cos(a) * (.82 - i * .025), .24 + i * .035, Math.sin(a) * (.82 - i * .025)]; }), [.26, .3, .24], skin, { sides: 6, c2: dark });
      rig.part(inner, coil);
      const parts = [];
      for (let i = 0; i < segs; i++) { const w = .28 - i * .012, g = new Shape().ball(w, .22, w, i % 2 ? skin : dark, { rings: 3, sides: 7 }); if (i % 2 === 0) g.spike(.075, .22, glow, { y: .08, z: -w + .03, rx: -1, sides: 4 }); parts.push(k.joint(0, .55 + i * .28, 0, g)); }
      const hd = new Shape().plate([[0, -.42], [.4, -.1], [.52, .28], [.3, .62], [0, .55], [-.3, .62], [-.52, .28], [-.4, -.1]], .05, dark, { z: -.14, c2: skin, ridge: .04 }).ball(.27, .17, .36, skin, { z: .2, y: .1, rings: 3, sides: 7, c2: dark });
      eyes(hd, 2, .3, .18, .47, .045, glow); hd.tube([[-.11, 0, .46], [-.11, -.16, .52], [-.09, -.28, .5]], [.03, .02, 0], BONE, { sides: 4 }).tube([[.11, 0, .46], [.11, -.16, .52], [.09, -.28, .5]], [.03, .02, 0], BONE, { sides: 4 });
      const head = k.joint(0, .55 + segs * .28, 0, hd);
      return { h: .75 + segs * .28, anim: (t, kick) => { parts.forEach((p, i) => { p.position.z = Math.sin(t * 1.8 + i * .7) * .05 * i; p.position.x = Math.cos(t * 1.1 + i * .6) * .035 * i; }); const lastAt = parts.at(-1).position; head.position.z = lastAt.z + .1 + kick * .4; head.position.x = lastAt.x; } };
    },
    // A hydra: one trunk, two or three heads on their own necks.
    k => {
      const { r, skin, dark, glow, rig, inner } = k, count = 2 + (r() * 2 | 0), trunk = new Shape().ball(.8, .62, .85, skin, { y: .62, sides: 10, rings: 4, c2: dark });
      for (let i = 0; i < 5; i++) trunk.spike(.1, .26 + r() * .2, glow, { y: 1.1, z: -.1 - i * .17, rx: -.5 - i * .1, sides: 4 });
      trunk.tube([[0, .45, -.65], [.1, .25, -1.15], [-.1, .12, -1.6], [0, .05, -2]], [.3, .2, .1, 0], skin, { sides: 5, c2: dark });
      rig.part(inner, trunk);
      const heads = Array.from({ length: count }, (_, i) => {
        const x = count > 1 ? (i / (count - 1) - .5) * 1.1 : 0, g = new Shape().tube([[0, 0, 0], [x * .3, .55, .1], [x * .15, 1.1, .1], [0, 1.45, .2]], [.2, .17, .15, .13], i % 2 ? dark : skin, { sides: 6 });
        g.ball(.2, .16, .32, skin, { y: 1.5, z: .34, rings: 3, sides: 7, c2: dark }).ball(.16, .07, .26, dark, { y: 1.37, z: .36, rings: 2, sides: 6 });
        eyes(g, 2, .26, 1.57, .52, .04, glow); HORNS[r() * 3 | 0](g, .1, 1.58, .2, -1, BONE); HORNS[r() * 3 | 0](g, .1, 1.58, .2, 1, BONE);
        return k.joint(x, 1, .3, g);
      });
      return { h: 2.75, anim: (t, kick) => heads.forEach((head, i) => { head.rotation.x = Math.sin(t * 1.3 + i * 2) * .12 + kick * .5; head.rotation.z = Math.cos(t * 1.1 + i * 2.5) * .1; }) };
    },
    // A wyrm: a long rising body with sail fins and wings.
    k => {
      const { r, skin, dark, glow, rig, inner } = k, segs = 6 + (r() * 2 | 0), parts = [];
      const base = new Shape().tube([[0, .2, -1.8], [.2, .24, -1.2], [-.1, .28, -.6], [0, .36, 0]], [.02, .2, .34, .36], skin, { sides: 6, c2: dark });
      rig.part(inner, base);
      for (let i = 0; i < segs; i++) { const w = .33 - i * .02, g = new Shape().ball(w, .25, w, i % 2 ? skin : dark, { rings: 3, sides: 7 }); if (i < segs - 1) g.plate([[0, -.1], [-.08, .1], [-.3, .3], [-.42, -.04]], .015, glow, { ry: Math.PI / 2, y: .08, z: -w + .1, c2: shade(glow, .6) }); parts.push(k.joint(0, .4 + i * .29, 0, g)); }
      const wings = [-1, 1].map(s => k.joint(s * .25, 1.2, -.12, new Shape().plate([[0, 0], [s * .5, .5], [s * 1.26, .72], [s * 1.6, .12], [s * 1.16, -.08], [s * .9, -.5], [s * .5, -.28]], .012, shade(skin, 1.2), { c2: dark, ridge: .03 })));
      const hd = new Shape().ball(.22, .17, .4, skin, { z: .24, rings: 3, sides: 7, c2: dark }).ball(.17, .07, .3, dark, { y: -.15, z: .26, rings: 2, sides: 6 }); eyes(hd, 2, .28, .08, .46, .045, glow);
      const horn = HORNS[r() * 3 | 0]; horn(hd, .09, .12, .02, -1, BONE); horn(hd, .09, .12, .02, 1, BONE);
      const head = k.joint(0, .4 + segs * .29, 0, hd);
      return { h: .85 + segs * .29, anim: (t, kick) => { parts.forEach((p, i) => { p.position.z = Math.sin(t * 1.5 + i * .6) * .04 * i; p.position.x = Math.cos(t * .9 + i * .5) * .03 * i; }); const lastAt = parts.at(-1).position; head.position.z = lastAt.z + .1 + kick * .4; head.position.x = lastAt.x; wings.forEach((wing, i) => { wing.rotation.z = (i ? -1 : 1) * Math.sin(t * 2.3) * .28; wing.rotation.y = (i ? 1 : -1) * .5; }); } };
    },
  ],
};

// Teeth round a jaw's edge, from side to side at the given height.
const teeth = (g, count, spread, y, z, down, c = BONE) => { for (let i = 0; i < count; i++) { const t = count > 1 ? i / (count - 1) - .5 : 0; g.spike(.038, .12, c, { x: t * spread, y, z: z - Math.abs(t) * spread * .5, rx: down ? Math.PI : 0, sides: 3 }); } return g; };

// Whatever walks on two legs and carries a gun: a helmet, a uniform, a crouch. They're the only enemies that come in squads of equals.
function trooper(k, gear) {
  const { r, skin, dark, glow, rig, inner } = k, flesh = [0xd9a273, 0xa8724a, 0xf1c6a0][r() * 3 | 0], cloth = gear.suit ? 0x2a2620 : skin, under = gear.suit ? 0xe9dcc0 : dark, metal = shade(skin, 1.28);
  const hips = rig.joint(inner, null, 0, .86, 0, new Shape().ball(.22, .14, .16, dark, { sides: 7, rings: 3 }));
  hips.rotation.y = .3;
  const chest = new Shape().lathe([[.0001, .66], [.14, .64], [.3, .55], [.3, .4], [.23, .2], [.2, .02]], cloth, { sz: .66, sides: 9, c2: shade(cloth, .75) });
  chest.lathe([[.21, .1], [.21, .04]], LEATHER_BELT, { sz: .72, sides: 9 });
  if (gear.suit) chest.plate([[-.09, .62], [.09, .62], [0, .2]], .01, under, { z: .18 }).plate([[-.022, .6], [.022, .6], [.03, .28], [0, .22], [-.03, .28]], .012, glow, { z: .195 });
  else { chest.box(.4, .34, .26, shade(skin, .82), { y: .38, c2: dark }); for (const s of [-1, 1]) chest.ball(.16, .12, .16, metal, { x: s * .31, y: .56, low: .2, rings: 2, sides: 7 }); chest.box(.3, .34, .14, dark, { y: .36, z: -.18 }); }
  const torso = rig.joint(hips, null, 0, .05, 0, chest); torso.rotation.x = .34; torso.rotation.y = -.3;
  const hd = new Shape().ball(.135, .15, .14, flesh, { y: .16, sides: 8, rings: 4 });
  if (gear.helmet === 0) hd.ball(.18, .15, .2, metal, { y: .2, low: .15, sides: 9, rings: 3, c2: skin }).plate([[-.15, 0], [.15, 0], [.12, .08], [-.12, .08]], .02, metal, { y: .17, z: .17, rx: 1.2 }).box(.24, .05, .05, DARK, { y: .15, z: .13 });
  else if (gear.helmet === 1) hd.ball(.19, .18, .2, shade(skin, .7), { y: .17, low: .55, sides: 9, rings: 3 }).box(.26, .09, .05, glow, { y: .18, z: .16 });
  else if (gear.helmet === 2) hd.ball(.16, .11, .17, [0xb8361f, 0x1e1a18, 0xe8c14a][r() * 3 | 0], { y: .25, low: .1, sides: 8, rings: 3 });
  else hd.ball(.18, .09, .19, skin, { y: .24, low: 0, sides: 8, rings: 2 }).plate([[-.13, 0], [.13, 0], [.1, .13], [-.1, .13]], .015, dark, { y: .25, z: .13, rx: 1.3 });
  rig.joint(torso, null, 0, .66, .04, hd);
  for (const s of [-1, 1]) {
    const arm = rig.joint(torso, null, s * .31, .55, 0, limb(new Shape(), .08, .065, .3, gear.suit ? cloth : skin, { c2: dark }));
    arm.rotation.x = s < 0 ? -1.2 : -.95; arm.rotation.z = s < 0 ? -.1 : .3;
    const fore = limb(new Shape(), .065, .055, .3, gear.suit ? cloth : shade(skin, .9)).ball(.08, .085, .085, LEATHER_BELT, { y: -.36, rings: 3, sides: 6 });
    if (s < 0) gear.weapon(fore);
    const lower = rig.joint(arm, null, 0, -.32, 0, fore); lower.rotation.x = s < 0 ? -.3 : -.9;
    const thigh = rig.joint(hips, null, s * .12, -.03, 0, limb(new Shape(), .1, .08, .38, cloth, { c2: dark })); thigh.rotation.x = s < 0 ? -.9 : .55;
    const shin = limb(new Shape(), .08, .06, .36, cloth).ball(.095, .085, .2, BOOT, { y: -.42, z: .06, top: .9, low: .4, sides: 7, rings: 3 }).lathe([[.09, -.2], [.09, -.38]], BOOT, { sides: 7 });
    rig.joint(thigh, null, 0, -.39, 0, shin).rotation.x = s < 0 ? .75 : .2;
  }
  return { h: 2, anim: (t, kick) => { hips.position.y = .86 + Math.sin(t * 2) * .012 - kick * .08; torso.rotation.x = .34 + Math.sin(t * 2 + 1) * .03 + kick * .3; } };
}
const LEATHER_BELT = 0x3a2a1c, BOOT = 0x2a2016;
BODIES.soldier = [
  k => trooper(k, { helmet: 0, weapon: g => g.lathe([[.045, .32], [.05, -.42]], DARK, { rx: Math.PI / 2, y: -.38, z: .28, sides: 6 }).box(.07, .16, .08, shade(k.skin, .6), { y: -.48, z: .12 }).box(.06, .1, .28, 0x4a3628, { y: -.38, z: -.2 }) }),
  k => trooper(k, { helmet: 1, weapon: g => g.lathe([[.02, .5], [.03, -.5]], 0x2a2620, { rx: Math.PI / 2, y: -.38, z: .46, sides: 5 }).ball(.08, .08, .08, k.glow, { y: -.38, z: .98, rings: 2, sides: 5 }) }),
  k => trooper(k, { helmet: 2, suit: true, weapon: g => g.lathe([[.025, .7], [.03, -.7]], 0x8a8878, { rx: Math.PI / 2, y: -.38, z: .55, sides: 5, c2: k.glow }) }),
  k => trooper(k, { helmet: 3, weapon: g => g.lathe([[.08, .3], [.1, -.34]], DARK, { rx: Math.PI / 2, y: -.38, z: .3, sides: 6 }).lathe([[.12, .04], [.12, -.04]], k.glow, { rx: Math.PI / 2, y: -.38, z: .6, sides: 6 }) }),
];
BODIES.beast = [
  // A hunched brute walking on its knuckles: an enormous chest and arms, little legs, a jaw full of teeth, a spined tail.
  k => {
    const { r, skin, dark, glow, rig, inner } = k, horn = HORNS[r() * 3 | 0];
    const body = new Shape().ball(1.02, .98, .92, skin, { y: 1.72, z: -.05, sides: 11, rings: 6, c2: dark }).ball(.72, .62, .76, dark, { y: 1, z: -.45, sides: 9, rings: 4, c2: skin });
    for (const s of [-1, 1]) body.lathe([[.3, .24], [.34, -.24], [.5, -.66], [.56, -.72], [.0001, -.74]], skin, { x: s * .52, y: .74, z: -.6, sides: 8, c2: dark });
    body.tube([[-.5, 1.28, .78], [-.2, 1.1, .9], [.3, 1.05, .9], [.68, 1.2, .72]], [.05, .05, .05, .05], glow, { sides: 4 }).lathe([[1, .06], [1, -.06]], glow, { y: 1.05, z: -.05, sz: .82, sides: 11 });
    body.tube([[0, 1.15, -1.1], [.1, 1, -1.8], [-.15, 1.15, -2.45], [.1, 1.65, -2.95], [.2, 2.3, -3.1]], [.44, .3, .2, .12, 0], skin, { sides: 6, c2: dark });
    for (let i = 0; i < 7; i++) body.spike(.12, .34 + r() * .24, glow, { y: 1.28 + i * .13, z: -1.2 - i * .28, rx: -.95, sides: 4 });
    rig.part(inner, body);
    const hd = new Shape().ball(.5, .42, .52, skin, { y: .12, sides: 9, rings: 4, c2: dark }).lathe([[.0001, -.05], [.38, -.12], [.42, -.26], [.0001, -.3]], DARK, { z: .3, sides: 8 }).ball(.4, .1, .42, shade(skin, .75), { y: -.34, z: .34, rings: 2, sides: 8 });
    teeth(hd, 6, .56, -.04, .68, true); teeth(hd, 5, .46, -.32, .66, false); eyes(hd, 2, .48, .26, .46, .07, glow);
    hd.tube([[0, -.2, .5], [.04, -.42, .86], [-.06, -.72, 1]], [.11, .08, 0], VENOM_TONGUE, { sides: 5 });
    horn(hd, .3, .38, .02, -1, BONE); horn(hd, .3, .38, .02, 1, BONE);
    const head = rig.joint(inner, null, 0, 2.22, .72, hd);
    const arms = [-1, 1].map(s => { const fist = new Shape().ball(.5, .62, .5, skin, { y: -.16, sides: 9, rings: 4, c2: dark }).tube([[s * .06, -.5, 0], [s * .12, -1.1, .22], [s * .1, -1.4, .3]], [.34, .28, .24], skin, { sides: 7, c2: dark }).ball(.4, .32, .44, skin, { x: s * .1, y: -1.54, z: .4, sides: 8, rings: 3, c2: dark }); for (let i = 0; i < 3; i++) fist.spike(.07, .22, BONE, { x: s * .1 + (i - 1) * .2, y: -1.6, z: .76, rx: Math.PI / 2 + .3, sides: 3 }); fist.lathe([[.32, .05], [.32, -.07]], glow, { x: s * .1, y: -1.2, z: .24, sides: 7 }); return rig.joint(inner, null, s * 1.02, 2.1, .1, fist); });
    return { h: 3.2, anim: (t, kick) => { head.rotation.x = Math.sin(t * 1.4) * .06 - kick * .4; arms.forEach((arm, i) => { arm.rotation.x = Math.sin(t * 1.4 + i * 3) * .05 - kick * .75; }); } };
  },
  // A hound: low and long, with whips growing off its shoulders.
  k => {
    const { r, skin, dark, glow, rig, inner } = k;
    const body = new Shape().ball(.46, .5, 1.12, skin, { y: 1.16, sides: 9, rings: 5, c2: dark }).ball(.5, .46, .5, shade(skin, .9), { y: 1.28, z: .66, sides: 8, rings: 4, c2: dark });
    body.tube([[0, 1.18, -1.05], [.1, 1.4, -1.7], [-.1, 1.95, -2.05], [0, 2.5, -1.85]], [.13, .1, .07, 0], dark, { sides: 5 });
    rig.part(inner, body);
    const hd = new Shape().ball(.3, .28, .36, skin, { sides: 8, rings: 4, c2: dark }).lathe([[.2, .02], [.16, -.3]], dark, { rx: Math.PI / 2, y: -.05, z: .28, sz: .75, sides: 7 });
    teeth(hd, 4, .3, -.14, .56, true); eyes(hd, 2, .38, .1, .3, .06, glow); for (const s of [-1, 1]) hd.spike(.1, .34, dark, { x: s * .18, y: .2, z: -.12, rz: s * -.3, sides: 4 });
    const head = rig.joint(inner, null, 0, 1.46, 1.24, hd);
    const legs = [[-1, .6], [1, .6], [-1, -.72], [1, -.72]].map(([s, z]) => rig.joint(inner, null, s * .34, 1, z, new Shape().tube([[0, 0, 0], [s * .08, -.36, z > 0 ? .12 : -.2], [s * .06, -.7, z > 0 ? .02 : .02], [s * .06, -1, .14]], [.18, .12, .08, .08], skin, { sides: 6, c2: dark }).ball(.11, .07, .2, dark, { x: s * .06, y: -.98, z: .2, rings: 2, sides: 6 })));
    const whips = [-1, 1].map(s => rig.joint(inner, null, s * .34, 1.6, .3, new Shape().tube([[0, 0, 0], [s * .34, .5, -.1], [s * .68, .86, .15], [s * .9, .62, .55], [s * .9, .26, .78]], [.1, .08, .06, .04, 0], glow, { sides: 5, c2: dark })));
    return { h: 2.6, anim: (t, kick) => { legs.forEach((leg, i) => { leg.rotation.x = Math.sin(t * 2.2 + i * 1.6) * (.03 + kick * .24); }); whips.forEach((whip, i) => { whip.rotation.z = Math.sin(t * 2.4 + i * 2) * .14; whip.rotation.x = Math.cos(t * 1.9 + i) * .12 - kick * .6; }); head.rotation.x = Math.sin(t * 1.5) * .05 - kick * .3; } };
  },
  // A tusker: a round grey-sided barrel on pillars, a heavy head and curling tusks.
  k => {
    const { r, skin, dark, glow, rig, inner } = k, body = new Shape().ball(.96, .92, 1.28, skin, { y: 1.62, sides: 10, rings: 5, c2: dark });
    for (const [s, z] of [[-1, .66], [1, .66], [-1, -.72], [1, -.72]]) body.lathe([[.32, .4], [.34, -.4], [.4, -.72], [.0001, -.74]], dark, { x: s * .62, y: .72, z, sides: 8, c2: skin });
    body.plate([[-.78, .3], [.78, .3], [.86, -.4], [.0, -.54], [-.86, -.4]], .05, glow, { y: 1.8, z: -.3, rx: Math.PI / 2 - .25, ridge: .04, c2: shade(glow, .6) });
    body.tube([[0, 1.72, -1.2], [.1, 1.56, -1.6], [0, 1.1, -1.8]], [.12, .09, 0], dark, { sides: 5 });
    rig.part(inner, body);
    const hd = new Shape().ball(.56, .54, .54, skin, { sides: 9, rings: 4, c2: dark }).tube([[0, -.2, .42], [0, -.5, .72], [.04, -.95, .8], [.02, -1.3, .66]], [.2, .15, .11, .06], skin, { sides: 6, c2: dark });
    eyes(hd, 2, .58, .1, .47, .06, glow);
    for (const s of [-1, 1]) { hd.tube([[s * .28, -.24, .34], [s * .46, -.6, .62], [s * .58, -.72, 1.05], [s * .44, -.42, 1.3]], [.09, .08, .055, 0], BONE, { sides: 5 }); hd.plate([[0, .34], [.3, .3], [.5, 0], [.34, -.3], [0, -.2]], .03, shade(skin, .82), { x: s * .46, ry: s > 0 ? 0 : Math.PI, c2: dark }); }
    const head = rig.joint(inner, null, 0, 1.92, 1.32, hd);
    return { h: 2.7, anim: (t, kick) => { head.rotation.x = Math.sin(t * 1.1) * .05 - kick * .3; head.rotation.y = Math.sin(t * .7) * .08; } };
  },
  // A maw plant: a fat bulb with a mouth for a top, and thick vines holding it up.
  k => {
    const { r, skin, dark, glow, rig, inner } = k;
    const base = new Shape(); for (let i = 0; i < 7; i++) { const a = i / 7 * TAU + r(); base.plate([[-.28, 0], [.28, 0], [.14, 1.1], [0, 1.4], [-.14, 1.1]], .025, dark, { x: Math.cos(a) * .55, y: .06, z: Math.sin(a) * .55, ry: Math.PI / 2 - a, rx: 1.2, ridge: .04, c2: skin }); }
    rig.part(inner, base);
    const bulb = new Shape().lathe([[.62, .95, glow], [.54, .9, DARK], [.0001, .62, DARK]], DARK, { sides: 10 }).lathe([[.72, 1.05, glow], [.92, .72], [1.04, .2], [.82, -.46], [.3, -.8], [.0001, -.84]], skin, { sides: 10, c2: dark });
    for (let i = 0; i < 9; i++) { const a = i / 9 * TAU; bulb.spike(.075, .3, BONE, { x: Math.cos(a) * .6, y: .84, z: Math.sin(a) * .6, rz: -Math.cos(a) * .7, rx: Math.sin(a) * .7, sides: 3 }); }
    for (let i = 0; i < 7; i++) { const a = r() * TAU, up = r() * 1 - .3; bulb.ball(.1, .1, .1, glow, { x: Math.cos(a) * (.98 - Math.abs(up) * .3), y: up, z: Math.sin(a) * (.98 - Math.abs(up) * .3), rings: 2, sides: 5 }); }
    const top = rig.joint(inner, null, 0, 1.2, 0, bulb);
    const vines = Array.from({ length: 5 }, (_, i) => { const a = i / 5 * TAU + .4, c = Math.cos(a), s = Math.sin(a); return rig.joint(inner, null, c * .55, 1, s * .55, new Shape().tube([[0, 0, 0], [c * .55, .55, s * .55], [c * 1.15, .3, s * 1.15], [c * 1.45, .85, s * 1.45], [c * 1.6, 1.4, s * 1.6]], [.14, .12, .09, .06, 0], skin, { sides: 5, c2: glow })); });
    return { h: 2.5, anim: (t, kick) => { top.scale.setScalar(1 + Math.sin(t * 2) * .025); top.rotation.x = kick * .35; vines.forEach((vine, i) => { vine.rotation.x = Math.sin(t * 1.6 + i * 1.4) * .12 - kick * .3; vine.rotation.z = Math.cos(t * 1.3 + i * 2) * .1; }); } };
  },
];
BODIES.critter = [
  // A little crested bird sitting on a mound of dirt.
  k => {
    const { r, skin, dark, glow, rig, inner } = k, mound = new Shape().lathe([[.0001, .46, 0x5a4228], [.38, .42, 0x4a3628], [.62, .16], [.72, 0], [.0001, 0]], 0x332618, { sides: 9, flat: true, c2: 0x2a2016 });
    for (let i = 0; i < 6; i++) { const a = r() * TAU; mound.rock(.06 + r() * .05, 0x6a5a3e, r, { x: Math.cos(a) * .5, y: .1, z: Math.sin(a) * .5, sides: 4, rings: 2 }); }
    rig.part(inner, mound);
    const b = new Shape().ball(.3, .26, .36, skin, { y: .68, sides: 9, rings: 4, c2: dark }).ball(.19, .2, .2, shade(skin, 1.15), { y: .98, z: .2, sides: 8, rings: 4, c2: skin });
    b.spike(.065, .22, glow, { y: .95, z: .38, rx: Math.PI / 2 + .25, sides: 4 }); eyes(b, 2, .26, 1.02, .34, .035, DARK);
    for (const s of [-1, 1]) b.plate([[0, .05], [.24, .1], [.28, -.1], [.08, -.2]], .015, dark, { x: s * .2, y: .72, ry: s > 0 ? -1.3 : 1.3 + Math.PI, c2: shade(dark, 1.3) });
    b.plate([[-.08, 0], [.08, 0], [.24, .5], [.1, .4], [.06, .72], [-.03, .46], [-.12, .62], [-.14, .32]], .02, glow, { y: 1.1, z: .12, ry: Math.PI / 2, c2: shade(glow, .7), ridge: .025 });
    b.tube([[0, .68, -.28], [0, .86, -.54], [0, 1.2, -.54], [0, 1.5, -.42]], [.1, .13, .12, 0], glow, { sides: 5, c2: dark });
    const bird = rig.joint(inner, null, 0, 0, 0, b);
    return { h: 1.5, anim: (t, kick) => { bird.position.y = Math.abs(Math.sin(t * 3.2)) * .035 + kick * .1; bird.rotation.x = Math.sin(t * 1.3) * .04 + kick * .3; bird.rotation.y = Math.sin(t * .7) * .28; } };
  },
  // A quilled ball that rolls in place.
  k => {
    const { r, skin, dark, glow } = k, b = new Shape().ball(.5, .47, .55, dark, { sides: 9, rings: 5, c2: DARK });
    for (let i = 0; i < 22; i++) { const u = r() * TAU, v = Math.acos(r() * 1.5 - .6); b.spike(.09, .36 + r() * .2, i % 4 ? skin : glow, { x: Math.cos(u) * Math.sin(v) * .4, y: Math.cos(v) * .38, z: -.1 + Math.sin(u) * Math.sin(v) * .3, rz: -Math.cos(u) * Math.sin(v) * 1.2, rx: Math.sin(u) * Math.sin(v) * 1.2, sides: 3 }); }
    b.ball(.26, .22, .16, shade(skin, 1.25), { y: -.05, z: .44, sides: 7, rings: 3 }); eyes(b, 2, .22, 0, .56, .05, glow); b.spike(.05, .1, DARK, { y: -.14, z: .57, rx: Math.PI / 2, sides: 4 });
    const ball = k.joint(0, .58, 0, b);
    return { h: 1.4, anim: (t, kick) => { ball.position.y = .58 + Math.abs(Math.sin(t * 2.6)) * .12; ball.rotation.z = Math.sin(t * 1.3) * .12; ball.position.z = kick * .4; } };
  },
  // A floating ember with a grin, burning off its own top.
  k => {
    const { r, skin, dark, glow } = k, b = new Shape().ball(.58, .55, .58, skin, { sides: 10, rings: 5, c2: dark });
    for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; b.tube([[Math.cos(a) * .3, .34, Math.sin(a) * .3], [Math.cos(a) * .36, .72, Math.sin(a) * .36], [Math.cos(a) * .1, 1 + r() * .3, Math.sin(a) * .1]], [.15, .1, 0], glow, { sides: 4, c2: shade(glow, .7) }); }
    for (const s of [-1, 1]) b.plate([[-.1, .06], [.1, .02], [.09, -.06], [-.09, -.05]], .02, DARK, { x: s * .2, y: .14, z: .52, rz: s * -.35 });
    b.plate([[-.3, .05], [-.1, -.02], [.1, -.02], [.3, .05], [.2, -.14], [0, -.2], [-.2, -.14]], .02, DARK, { y: -.12, z: .54 }); teeth(b, 4, .3, -.1, .57, true);
    const ember = k.joint(0, 1, 0, b);
    return { h: 2, anim: (t, kick) => { ember.position.y = 1 + Math.sin(t * 2) * .12; const s = 1 + Math.sin(t * 5.5) * .03 + kick * .25; ember.scale.setScalar(s); ember.rotation.y = Math.sin(t * .9) * .22; } };
  },
  // A ringed worm out of the ground, its mouth at the top.
  k => {
    const { r, skin, dark, glow, rig, inner } = k, hole = new Shape().lathe([[.0001, .12, DARK], [.62, .12, DARK], [.78, .14], [1.02, 0], [.0001, 0]], 0x3a2e20, { sides: 9, flat: true });
    rig.part(inner, hole);
    const parts = Array.from({ length: 5 }, (_, i) => { const w = .46 - i * .03; return k.joint(0, .28 + i * .34, 0, new Shape().ball(w, .23, w, i % 2 ? dark : skin, { sides: 8, rings: 3 })); });
    const hd = new Shape().ball(.34, .24, .34, skin, { sides: 8, rings: 3, c2: dark }).lathe([[.28, .17], [.0001, -.04]], DARK, { sides: 8, y: .08 });
    for (let i = 0; i < 7; i++) { const a = i / 7 * TAU; hd.spike(.05, .24, BONE, { x: Math.cos(a) * .27, y: .18, z: Math.sin(a) * .27, rz: Math.cos(a) * .7, rx: -Math.sin(a) * .7, sides: 3 }); }
    eyes(hd, 2, .4, .12, .3, .04, glow);
    const head = k.joint(0, 1.98, .06, hd);
    return { h: 2.3, anim: (t, kick) => { parts.forEach((p, i) => { p.position.x = Math.sin(t * 1.7 + i * .75) * .05 * i; p.position.z = Math.cos(t * 1.4 + i * .6) * .05 * i + kick * .08 * i; }); const lastAt = parts.at(-1).position; head.position.x = lastAt.x; head.position.z = lastAt.z + .06; head.rotation.x = .3 + Math.sin(t * 1.7) * .1 + kick * .4; } };
  },
];
// A pale, smooth lump of a thing: a pear of a body, stubby arms and wings too small to carry it.
BODIES.slime.push(k => {
  const { r, skin, glow, rig, inner } = k, pale = [0xe8dcc8, 0xd8e2c0, 0xf0d4b0][r() * 3 | 0], under = shade(pale, .7);
  const b = new Shape().lathe([[.0001, 2.42], [.42, 2.3], [.68, 1.9], [.98, 1.2], [1.14, .55], [1, .14], [.56, 0], [.0001, 0]], pale, { sides: 10, sz: .82, flat: true, c2: under });
  b.plate([[-.8, 0], [.8, 0], [1.3, -.08], [.2, -.22], [-.7, -.2]], .05, under, { y: .18, rx: Math.PI / 2 });
  for (const s of [-1, 1]) { b.ball(.1, .1, .06, DARK, { x: s * .24, y: 1.92, z: .5, rings: 2, sides: 5 }); b.ball(.04, .04, .03, glow, { x: s * .24, y: 1.92, z: .55, rings: 2, sides: 4 }); b.plate([[0, .2], [.12, .9], [.4, .62], [.36, .18], [.14, -.14]], .02, shade(skin, 1.1), { x: s * .22, y: 2.05, z: -.42, ry: s > 0 ? .5 : Math.PI - .5, c2: glow, ridge: .03 }); }
  rig.part(inner, b);
  const arms = [-1, 1].map(s => k.joint(s * .88, 1.5, .1, new Shape().plate([[-.16, .18], [.2, .2], [.46, -.34], [.36, -.68], [.02, -.66], [-.14, -.3]], .16, pale, { x: s * .14, rz: s > 0 ? 0 : Math.PI / 8, c2: under, ridge: .08 })));
  return { h: 2.6, anim: (t, kick) => arms.forEach((arm, i) => { arm.rotation.x = Math.sin(t * 1.1 + i * 2.2) * .24 - kick * 1; arm.rotation.z = (i ? -1 : 1) * (.15 + Math.sin(t * 1.4 + i) * .08); }) };
});
const VENOM_TONGUE = 0xc2453a;
export const PLANS = Object.fromEntries(Object.entries(BODIES).map(([family, plans]) => [family, plans.length]));
// How tall a family stands: some loom over the party, some barely reach its knees.
const HEIGHT = { beast: [3.5, 4.2], golem: [3.2, 3.9], serpent: [3, 3.8], wraith: [2.7, 3.3], sentinel: [2.4, 3], slime: [1.7, 2.8], bug: [1.8, 2.8], drone: [1.9, 2.5], soldier: [2.1, 2.2], critter: [1.1, 1.6] };

export function makeEnemy(seed, family, scene, shared, size = 1, plan) {
  const r = rng(seed), [skin, glow] = VENOM[r() * VENOM.length | 0], dark = shade(skin, .55), rig = new Rig(scene, shared), inner = rig.joint(rig.root, 'inner', 0, 0, 0);
  const plans = BODIES[family] || BODIES.serpent, kit = { r, skin, glow, dark, rig, inner, joint: (x, y, z, geo) => rig.joint(inner, null, x, y, z, geo) };
  const made = plans[plan ?? (r() * plans.length | 0)](kit), [low, high] = HEIGHT[family] || HEIGHT.serpent, h = (low + r() * (high - low)) * size, scale = h / made.h;
  inner.scale.setScalar(scale);
  rig.build();
  return { rig, inner, scale, anim: (t, kick) => (made.anim || ok)(t, kick, inner), h, family, glow, spits: r() < .5, flash: 0, kick: 0, dodge: 0, born: 0, dying: 0 };
}

export function makeMinion(kind, seed, scene, shared) {
  const r = rng(seed), [skin, glow] = VENOM[r() * VENOM.length | 0], dark = shade(skin, .6), rig = new Rig(scene, shared), g = new Shape(), inner = rig.joint(rig.root, 'inner', 0, 0, 0, g), wings = [];
  inner.scale.setScalar(1.45);
  if (kind === 'bat') {
    g.ball(.15, .16, .17, skin, { rings: 3, sides: 7, c2: dark }); eyes(g, 2, .13, .05, .15, .028, glow);
    for (const s of [-1, 1]) { g.spike(.045, .12, dark, { x: s * .08, y: .14, sides: 4 }); wings.push([rig.joint(inner, null, s * .12, 0, 0, new Shape().plate([[0, .06], [s * .22, .1], [s * .42, -.02], [s * .26, -.06], [s * .18, -.14], [s * .08, -.06]], .012, shade(skin, 1.2), { c2: dark, ridge: .012 })), s]); }
  } else if (kind === 'tome') {
    g.box(.34, .06, .28, skin, { rz: .1, c2: dark }).box(.31, .028, .25, 0xf3ead2, { y: .045, rz: .1 }).gem(.05, .15, glow, { y: .22, sides: 4 });
    for (const s of [-1, 1]) wings.push([rig.joint(inner, null, s * .15, .06, 0, new Shape().plate([[0, .13], [s * .17, .12], [s * .2, -.12], [0, -.13]], .012, shade(skin, 1.1), { rx: Math.PI / 2, c2: 0xf3ead2 })), s * .3]);
  } else {
    const look = r() * 3 | 0;
    g.lathe([[.12, .05], [.13, -.05], [.09, -.2], [.0001, -.24]], skin, { sides: 7, c2: dark }).ball(.14, .13, .13, shade(skin, 1.2), { y: .19, rings: 3, sides: 7 }); eyes(g, 2, .12, .2, .12, .027, glow);
    if (look === 0) for (const s of [-1, 1]) g.spike(.04, .15, glow, { x: s * .09, y: .3, rz: s * -.3, sides: 4 });
    else if (look === 1) g.spike(.06, .22, dark, { y: .3, sides: 5 }); else for (const s of [-1, 1]) g.tube([[s * .1, .24, 0], [s * .22, .3, 0], [s * .27, .22, .03]], [.03, .02, 0], glow, { sides: 3 });
    g.tube([[0, -.12, -.1], [0, -.18, -.26], [0, -.04, -.34]], [.03, .02, 0], dark, { sides: 3 });
    for (const s of [-1, 1]) wings.push([rig.joint(inner, null, s * .1, .08, -.06, new Shape().plate([[0, .05], [s * .16, .1], [s * .2, -.02], [s * .09, -.05]], .01, dark, { c2: glow })), s * .6]);
  }
  rig.build();
  return { rig, wings, phase: r() * TAU, flash: 0, drop: 0, slot: 0 };
}

export function makeHourglass(scene, shared) {
  const rig = new Rig(scene, shared), frame = 0xe9dcc0, sand = 0x56c2a6;
  rig.part(rig.root, new Shape().lathe([[.18, .22], [.13, .13], [.02, 0], [.13, -.13], [.18, -.22]], sand, { sides: 7, c2: 0xffc738 }).lathe([[.22, .25], [.22, .21]], frame, { sides: 7 }).lathe([[.22, -.21], [.22, -.25]], frame, { sides: 7 }));
  return rig.build();
}
