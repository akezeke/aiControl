// The character generator: one skeleton and one set of poses for everyone. The class sets the silhouette (provider and model); the session id sets the person, their build, hair, armour and weapon.
import { Rig, shade, blend, mix } from './rig.js';
import { Shape, limb } from './shapes.js';
import { rng } from './roster.js';

// A class has its own range of light, and each person one out of it.
const AURA = { sage: [0x6fe3c0, 0x4fd8f0, 0xb8f5a0], duelist: [0xff6a3d, 0xff3050, 0xff4fb0], rogue: [0xc8e05a, 0xe8f040, 0xb070ff], knight: [0xffcf4d, 0xfff0b0, 0x7cc8ff], gunner: [0xff9a3c, 0xffc040, 0x40e0e8] };
// Bold, far apart in hue and never the earth tones a dark side of orange falls into: anyone should be picked out at a glance on a painted ground.
const CLOTH = [0xc8202a, 0x12a158, 0x2460c8, 0xe8b808, 0x0e9a9a, 0xe6dfc8, 0x2a2c32, 0xe8650f, 0x7cb518, 0x6d3bb8, 0xd81e7a, 0x19b8d6, 0x8f1238, 0x0f5a3c, 0xf28ca8, 0x3a3fb0], TRIM = [0xf5cf4a, 0xf0e8d2, 0xff7a4d, 0x7fe8c0, 0xc8e84a, 0xd4dce2, 0x2fd8e8, 0xff4fa0, 0xe8303a, 0x9cf03c], SKIN = [0xf1c6a0, 0xd9a273, 0xa8724a, 0x7d4f33, 0xf6d9c3], HAIR = [0xe8c14a, 0x1e1a18, 0xb8361f, 0xe6e0d0, 0x2f7f5a, 0xd9722a, 0x2fa8a0, 0xd04a9a, 0x5a6ae0, 0x6fd04a, 0xf07a1a, 0xf2f0ff], STEEL = [0xc6ced4, 0x9aa6ae, 0xe3c45a, 0x5f6c76, 0xb8302c, 0x1e8a6a, 0xe8e4d8];
const LEATHER = 0x2b2a2e, WOOD = 0x6b4a2a, GUNMETAL = 0x35332c, BLACK = 0x1a1612, EDGE = 0xf0ecdc, EDGE_DARK = 0x8f8a78;
// Bodies go to extremes, as they should from a battle's distance: [height, shoulders, limb bulk]. A class is known by its outline before its colours.
const BUILD = { sage: [1.04, .78, .78], duelist: [1.06, .88, .84], rogue: [.92, .74, .78], knight: [1.1, 1.5, 1.5], gunner: [1, 1.12, 1.18] };
// How far the weapon tips from the wrist: blades reach up and forward, guns straight at the enemy.
const HOLD = { sage: .25, duelist: .95, rogue: 1.15, knight: .85, gunner: 1.4 };
const FORWARD = { rx: Math.PI / 2 };
// What a class wears: the main fabric, a plainer one under it, and what runs along its hems.
const FABRIC = {
  sage: { main: ['brocade', 'damask', 'stars', 'folds', 'stripes'], under: ['weave', 'folds'], hem: ['glyphs', 'band', 'chevron'], head: ['stars', 'damask', 'folds'] },
  duelist: { main: ['harlequin', 'brocade', 'stripes', 'damask'], under: ['weave', 'stripes', 'plaid'], hem: ['band', 'chevron'], head: ['weave', 'damask'] },
  rogue: { main: ['quilt', 'leather', 'stripes', 'plaid'], under: ['weave', 'leather', 'stripes'], hem: ['chevron', 'band'], head: ['weave', 'quilt'] },
  knight: { main: ['engraved', 'scale'], under: ['quilt', 'weave'], hem: ['band', 'glyphs'], head: ['engraved', 'weave'] },
  gunner: { main: ['quilt', 'plaid', 'camo', 'stripes'], under: ['camo', 'weave', 'plaid'], hem: ['chevron', 'band'], head: ['camo', 'weave'] },
};
const lightness = colour => (.3 * (colour >> 16 & 255) + .59 * (colour >> 8 & 255) + .11 * (colour & 255)) / 255;

// Hair, grown from the same cap. Each style reads differently from the side, which is how the battle usually sees it.
const HAIRDOS = {
  spikes(g, c, r) { for (let i = 0; i < 8; i++) { const a = i / 8 * Math.PI * 2 + r(), tip = .24 + r() * .2; g.tube([[Math.cos(a) * .1, .3, Math.sin(a) * .1 - .03], [Math.cos(a) * .17, .36 + tip * .5, Math.sin(a) * .17 - .05], [Math.cos(a) * .24, .3 + tip, Math.sin(a) * .24 - .1]], [.075, .05, 0], c, { sides: 4, c2: shade(c, 1.2) }); } },
  swept(g, c) { for (const [x, y, z] of [[-.1, .34, -.3], [.1, .34, -.3], [0, .4, -.34], [-.15, .24, -.3], [.15, .24, -.3]]) g.tube([[x * .6, .32, .05], [x, y + .05, -.14], [x, y, z]], [.07, .06, 0], c, { sides: 4, c2: shade(c, .78) }); },
  pony(g, c) { g.ball(.06, .06, .06, shade(c, .8), { y: .28, z: -.19, rings: 3, sides: 5 }).tube([[0, .29, -.2], [0, .3, -.36], [0, .12, -.46], [0, -.2, -.44]], [.075, .085, .06, 0], c, { sides: 5, c2: shade(c, .8) }); },
  long(g, c) { g.lathe([[.19, .22], [.215, .05], [.22, -.2], [.16, -.42], [.0001, -.46]], c, { z: -.09, sz: .55, sides: 8, c2: shade(c, .72) }); for (const s of [-1, 1]) g.tube([[s * .17, .22, .05], [s * .19, .02, .06], [s * .16, -.2, .03]], [.05, .05, 0], c, { sides: 4 }); },
  bob(g, c) { g.ball(.215, .17, .215, c, { y: .13, z: -.02, top: .5, low: .7, rings: 3, c2: shade(c, .72) }); },
  mohawk(g, c) { g.plate([[0, .42], [.1, .46], [.2, .42], [.28, .3], [.32, .12], [.3, -.03], [-.04, .22]], .05, shade(c, 1.15), { y: .12, z: -.02, ry: Math.PI / 2, c2: c }); },
  topknot(g, c) { g.ball(.085, .09, .085, c, { y: .46, z: -.05, rings: 4, sides: 6 }).lathe([[.05, .39], [.045, .35]], shade(c, .6), { z: -.05, sides: 6 }); },
  twintails(g, c) { for (const s of [-1, 1]) g.ball(.05, .05, .05, shade(c, .75), { x: s * .17, y: .3, z: -.04, rings: 3, sides: 5 }).tube([[s * .18, .3, -.05], [s * .3, .26, -.09], [s * .34, 0, -.1], [s * .28, -.26, -.06]], [.05, .08, .06, 0], c, { sides: 5, c2: shade(c, .8) }); },
  braid(g, c) { for (let i = 0; i < 5; i++) g.ball(.07 - i * .007, .07, .07 - i * .007, i % 2 ? c : shade(c, .82), { y: .22 - i * .11, z: -.2 - (i < 2 ? i * .04 : .05), rings: 3, sides: 5 }); },
  crop() {},
};
function headFor(g, { skin, hair, eye, r, style, bare }) {
  g.ball(.165, .185, .175, skin, { y: .2, sides: 9, rings: 5, c2: shade(skin, .92) });
  g.lathe([[.135, .16], [.125, .08], [.075, .01], [.0001, -.01]], skin, { z: .025, sz: 1.08, sides: 8, c2: shade(skin, .85) });
  g.lathe([[.075, .03], [.08, -.14]], shade(skin, .82), { sides: 6, z: -.02 });
  for (const s of [-1, 1]) {
    g.box(.05, .042, .02, eye, { x: s * .068, y: .19, z: .158 });
    g.box(.065, .018, .02, shade(hair, .8), { x: s * .068, y: .228 + r() * .006, z: .155, rz: s * (r() * .25 - .08) });
    g.ball(.022, .04, .03, shade(skin, .92), { x: s * .165, y: .17, rings: 3, sides: 5 });
  }
  g.spike(.022, .045, shade(skin, .88), { y: .13, z: .175, rx: Math.PI / 2 - .3 });
  if (bare) return g;
  g.ball(.178, .165, .19, hair, { y: .225, z: -.012, low: .12, rings: 3, sides: 9, c2: shade(hair, .8) });
  if (r() < .6) g.plate([[-.15, .03], [.15, .03], [.13 - r() * .08, -.07], [.02, -.04], [-.1, -.1]], .03, hair, { y: .33, z: .165, rx: -.25 });
  HAIRDOS[style](g, hair, r);
  if (r() < .14) g.ball(.1, .08, .06, hair, { y: .04, z: .13, top: .4, rings: 3, sides: 6, c2: shade(hair, .8) });
  return g;
}

// Head wear: one of a few for each class, all still that class at a glance.
const WEAR = {
  sage: [
    (g, c) => { g.lathe([[.4, .32], [.37, .34], [.2, .38], [.17, .42], [.09, .68, c.dark], [.0001, .96, c.cloth]].reverse().map(([a, y, k]) => [a, y, k]), c.cloth, { sides: 8, lean: -.18, c2: c.dark, cloth: c.hat }); g.lathe([[.19, .42], [.2, .36]], c.trim, { sides: 8, cloth: c.hem }); },
    (g, c) => { g.ball(.235, .22, .245, c.cloth, { y: .2, z: -.03, low: .3, sides: 9, rings: 4, c2: c.dark, cloth: c.hat }); g.lathe([[.16, -.03], [.28, -.13], [.3, -.2]], c.cloth, { z: -.02, sz: .9, sides: 8, c2: c.trim, cloth: c.hat }); },
    (g, c) => { g.lathe([[.195, .33], [.2, .29]], c.trim, { sides: 10, y: 0, cloth: c.hem }); g.gem(.05, .13, c.aura, { lit: true, y: .34, z: .19, rx: Math.PI / 2 }); },
    (g, c) => { for (let i = 0; i < 3; i++) g.lathe([[.21 - i * .03, .33 + i * .07], [.2 - i * .035, .29 + i * .07]], i % 2 ? c.trim : c.cloth, { sides: 9, rz: i % 2 ? .1 : -.07 }); g.gem(.045, .12, c.aura, { lit: true, y: .34, z: .2, rx: Math.PI / 2 }); },
  ],
  knight: [
    (g, c) => { g.ball(.21, .235, .225, c.steel, { y: .21, low: .35, sides: 9, rings: 4, c2: shade(c.steel, .75), cloth: c.hat }); g.box(.32, .035, .03, c.aura, { y: .18, z: .205 }); g.plate([[0, .06], [.12, .22], [.3, .28], [.48, .2], [.5, .06], [.3, -.02]], .025, c.trim, { y: .36, z: -.32, ry: Math.PI / 2 }); },
    (g, c) => { g.ball(.205, .225, .22, c.steel, { y: .22, low: .55, sides: 9, rings: 4, c2: shade(c.steel, .75), cloth: c.hat }); g.box(.29, .05, .04, BLACK, { y: .17, z: .205 }); for (const s of [-1, 1]) g.tube([[s * .17, .32, 0], [s * .33, .42, .02], [s * .34, .62, .08]], [.055, .04, 0], c.trim, { sides: 5, c2: EDGE }); },
    (g, c) => { g.lathe([[.0001, .62], [.17, .42], [.215, .24], [.22, .03], [.2, -.05]], c.steel, { sides: 8, flat: true, c2: shade(c.steel, .72), cloth: c.hat }); g.box(.05, .34, .04, c.trim, { y: .22, z: .205 }); g.box(.3, .035, .03, c.aura, { y: .2, z: .195 }); },
    (g, c) => { g.ball(.195, .17, .205, c.steel, { y: .25, low: .1, sides: 9, rings: 3, c2: shade(c.steel, .8), cloth: c.hat }); g.lathe([[.21, .27], [.215, .22]], c.trim, { sides: 9 }); g.plate([[-.05, 0], [.05, 0], [.02, -.17], [-.02, -.17]], .02, c.trim, { y: .25, z: .2 }); },
  ],
  duelist: [
    (g, c) => { g.lathe([[.5, .34], [.46, .36], [.2, .4], [.0001, .4]].reverse(), c.dark, { sides: 10, rz: .12 }); g.ball(.2, .17, .21, c.cloth, { y: .37, low: 0, rings: 3, sides: 8, rz: .12, cloth: c.hat }); g.plate([[0, 0], [.08, .2], [.05, .5], [-.03, .65], [-.07, .3]], .012, c.aura, { x: .22, y: .46, z: -.1, rz: -.5, rx: -.5, c2: shade(c.aura, .7) }); },
    (g, c) => { g.ball(.19, .135, .2, c.cloth, { y: .265, low: .1, rings: 3, sides: 9, cloth: c.hat }); g.tube([[-.04, .3, -.19], [-.09, .24, -.32], [-.14, .05, -.38]], [.04, .05, 0], c.cloth, { sides: 4 }); g.tube([[.04, .3, -.19], [.09, .28, -.3], [.13, .12, -.36]], [.04, .05, 0], c.trim, { sides: 4 }); },
    (g, c) => { g.lathe([[.47, .335], [.4, .36], [.22, .38], [.19, .55], [.0001, .6]].reverse(), c.dark, { sides: 3, turn: .5, flat: true }); g.lathe([[.2, .4], [.19, .375]], c.trim, { sides: 9 }); },
    (g, c) => { g.ball(.235, .13, .24, c.cloth, { y: .3, x: .05, rz: -.2, low: .3, rings: 3, sides: 9, c2: c.dark, cloth: c.hat }); g.ball(.03, .03, .03, c.aura, { x: -.08, y: .31, z: .18, rings: 2, sides: 5 }); },
  ],
  rogue: [
    (g, c) => { g.ball(.23, .235, .24, c.dark, { y: .2, z: -.03, low: .45, sides: 9, rings: 4, cloth: c.hood }); g.tube([[0, .36, -.2], [0, .28, -.4], [0, .06, -.55]], [.12, .07, 0], c.dark, { sides: 5 }); g.ball(.17, .08, .17, c.dark, { y: .03, z: .03, low: .7, top: .6, rings: 3, sides: 8 }); g.box(.25, .15, .03, BLACK, { y: .19, z: .2 }).box(.06, .03, .02, c.aura, { x: -.06, y: .2, z: .22 }).box(.06, .03, .02, c.aura, { x: .06, y: .2, z: .22 }); },
    (g, c) => { g.lathe([[.17, .13], [.15, .06], [.09, -.01]], c.dark, { z: .03, sides: 8, c2: shade(c.dark, .75) }); },
    (g, c) => { g.lathe([[.19, .3], [.19, .22]], c.aura, { sides: 10 }); for (const s of [-1, 1]) g.tube([[s * .03, .26, -.18], [s * .14, .2, -.38], [s * .2, .03, -.48]], [.04, .035, 0], c.aura, { sides: 4, c2: shade(c.aura, .6) }); },
    (g, c) => { g.ball(.2, .12, .2, c.dark, { y: .29, low: 0, rings: 2, sides: 8, cloth: c.hood }); g.box(.33, .065, .045, BLACK, { y: .19, z: .16 }); g.box(.07, .038, .02, c.aura, { x: -.07, y: .19, z: .185 }).box(.07, .038, .02, c.aura, { x: .07, y: .19, z: .185 }); },
  ],
  // The barrel ends `GUN_TIP` along the hand: shots start there.
  gunner: [
    (g, c) => { g.lathe([[.195, .29], [.195, .25]], GUNMETAL, { sides: 10 }); for (const s of [-1, 1]) g.lathe([[.06, .025], [.065, -.025]], c.aura, { x: s * .075, y: .29, z: .17, rx: Math.PI / 2, sides: 7 }); },
    (g, c) => { g.ball(.19, .12, .2, c.cloth, { y: .28, low: 0, rings: 2, sides: 9, cloth: c.hat }); g.plate([[-.14, 0], [.14, 0], [.11, .15], [-.11, .15]], .018, c.dark, { y: .285, z: .15, rx: 1.3 }); },
    (g, c) => { g.ball(.215, .21, .225, GUNMETAL, { y: .21, low: .35, sides: 9, rings: 4 }); g.box(.33, .09, .05, c.aura, { y: .19, z: .19, c2: shade(c.aura, .6) }); g.tube([[.2, .3, -.04], [.26, .45, -.08], [.26, .66, -.1]], [.02, .012, .008], GUNMETAL, { sides: 4 }); },
    (g, c) => { g.lathe([[.19, .05], [.19, -.03]], GUNMETAL, { x: 0, y: .2, rz: Math.PI / 2, sz: .35, sides: 7 }); g.tube([[-.17, .25, 0], [0, .4, 0], [.17, .25, 0]], [.018, .018, .018], GUNMETAL, { sides: 4 }); g.tube([[.18, .14, .03], [.14, .05, .13], [.05, .07, .17]], [.012, .01, .008], GUNMETAL, { sides: 4 }); },
  ],
};
const HAIRLESS = { knight: new Set([0, 1, 2]), rogue: new Set([0]), gunner: new Set([2]), sage: new Set([0, 1]) };

// Weapons point along +z from the hand, and they're big: longer than the arm that holds them.
const WEAPONS = {
  knight: [
    (g, c) => { g.plate([[-.2, 0], [.2, 0], [.19, 1.95], [.04, 2.3], [-.19, 2.05]], .05, EDGE, { ...FORWARD, z: .22, ridge: .04, c2: EDGE_DARK }); g.lathe([[.05, .22], [.055, -.26]], LEATHER, { ...FORWARD, sides: 6 }).box(.52, .1, .12, c.trim, { z: .22 }); },
    (g, c) => { g.plate([[-.26, 0], [-.3, .34], [-.15, .5], [-.22, 1], [-.14, 1.9], [0, 2.5], [.14, 1.9], [.22, 1], [.15, .5], [.3, .34], [.26, 0]], .05, EDGE, { ...FORWARD, z: .24, ridge: .04, c2: EDGE_DARK }); g.lathe([[.05, .24], [.055, -.28]], LEATHER, { ...FORWARD, sides: 5 }); g.box(.68, .1, .13, c.trim, { z: .24 }); },
    (g, c) => { g.lathe([[.038, 1.8], [.042, 0]], WOOD, { ...FORWARD, z: -.5, sides: 5 }); g.plate([[0, -.08], [.46, -.34], [.56, -.04], [.54, .26], [.46, .4], [0, .1]], .05, EDGE, { rx: Math.PI / 2, ry: 0, z: 1.3, x: .02, ridge: .03, c2: EDGE_DARK }); g.lathe([[.07, .08], [.07, -.08]], c.trim, { ...FORWARD, z: 1.3, sides: 6 }); },
    (g, c) => { g.lathe([[.038, 1.75], [.042, 0]], WOOD, { ...FORWARD, z: -.5, sides: 5 }); g.lathe([[.16, .3, c.steel], [.2, .25], [.2, -.25], [.16, -.3, c.steel]], c.trim, { z: 1.25, rz: Math.PI / 2, sides: 8, flat: true, c2: c.steel }); g.spike(.12, .22, c.steel, { z: 1.25, y: .2 }); },
    (g, c) => { g.lathe([[.032, 1.2], [.036, -1]], WOOD, { ...FORWARD, z: .5, sides: 5 }); g.plate([[-.12, 0], [.12, 0], [.05, .68], [0, .76], [-.05, .68]], .025, EDGE, { ...FORWARD, z: 1.68, ridge: .025, c2: EDGE_DARK }); g.lathe([[.1, .05], [.05, -.05]], c.trim, { ...FORWARD, z: 1.66, sides: 6 }); },
  ],
  sage: [
    (g, c) => { g.tube([[0, 0, -.5], [.02, 0, .4], [-.02, 0, 1.3]], [.04, .032, .03], WOOD, { sides: 5 }); g.lathe([[.12, .04], [.16, -.04]], c.trim, { ...FORWARD, z: 1.32, sides: 6 }); g.gem(.15, .46, c.aura, { lit: true, ...FORWARD, z: 1.58, sides: 5 }); },
    (g, c) => { g.tube([[0, 0, -.5], [0, 0, 1.3]], [.038, .03], WOOD, { sides: 5 }); g.plate([[-.1, 0], [.1, 0], [.3, .15], [.33, .4], [.25, .62], [.2, .36], [.1, .2], [-.1, .2], [-.2, .36], [-.25, .62], [-.33, .4], [-.3, .15]], .03, c.trim, { ...FORWARD, z: 1.28, c2: shade(c.trim, .75) }); g.gem(.08, .24, c.aura, { lit: true, ...FORWARD, z: 1.68, sides: 5 }); },
    (g, c) => { g.tube([[0, 0, -.5], [0, 0, 1.2]], [.036, .03], shade(c.steel, .7), { sides: 5 }); g.lathe([[.27, .025], [.27, -.025]], c.trim, { ...FORWARD, z: 1.48, rz: Math.PI / 2, sz: .15, sides: 10 }); g.ball(.12, .12, .12, c.aura, { z: 1.48, rings: 3, sides: 6 }); },
    (g, c) => { g.tube([[.02, 0, -.5], [-.06, .02, .25], [.06, -.02, .9], [-.02, 0, 1.25], [.12, 0, 1.45], [.22, 0, 1.4]], [.05, .04, .04, .035, .025, .012], 0x5a4228, { sides: 5 }); g.ball(.09, .09, .09, c.aura, { x: .03, z: 1.56, rings: 3, sides: 6 }); g.ball(.05, .05, .05, c.aura, { x: .22, z: 1.33, rings: 2, sides: 5 }); },
  ],
  duelist: [
    (g, c) => { g.plate([[-.03, 0], [.03, 0], [.008, 1.95], [-.008, 1.95]], .014, EDGE, { ...FORWARD, z: .17, c2: EDGE_DARK }); g.ball(.13, .13, .07, c.trim, { z: .13, rx: Math.PI / 2, top: .35, low: 1, rings: 3, sides: 8 }); g.lathe([[.03, .1], [.03, -.16]], LEATHER, { ...FORWARD, sides: 5 }); },
    (g, c) => { g.plate([[-.09, 0], [.08, 0], [.2, .7], [.25, 1.3], [.12, 1.78], [.06, 1.3], [-.03, .7]], .024, EDGE, { ...FORWARD, z: .15, ridge: .016, c2: EDGE_DARK }); g.tube([[0, -.11, .1], [0, -.17, .02], [0, -.09, -.1], [0, 0, -.14]], [.016, .016, .016, .016], c.trim, { sides: 4 }); g.box(.09, .06, .22, LEATHER, { z: 0 }); },
    (g, c) => { g.plate([[-.03, 0], [.03, 0], [.07, .6], [.06, 1.2], [-.01, 1.5], [.01, .8]], .018, EDGE, { ...FORWARD, z: .2, ridge: .012, c2: EDGE_DARK }); g.lathe([[.08, .012], [.08, -.012]], c.trim, { ...FORWARD, z: .19, sides: 8 }); g.lathe([[.028, .19], [.03, -.17]], BLACK, { ...FORWARD, sides: 5 }); },
    (g, c) => { for (const s of [-1, 1]) g.plate([[-.04, 0], [.04, 0], [.012, .8], [-.012, .8]], .016, EDGE, { rx: s * Math.PI / 2, z: s * .17, c2: EDGE_DARK }); g.lathe([[.032, .17], [.032, -.17]], c.trim, { ...FORWARD, sides: 6 }); },
  ],
  rogue: [
    (g, c) => { g.plate([[-.05, 0], [.05, 0], [.015, .52], [-.015, .52]], .022, EDGE, { ...FORWARD, z: .12, ridge: .012, c2: EDGE_DARK }); g.box(.2, .04, .05, c.aura, { z: .1 }); },
    (g, c) => { g.plate([[-.045, 0], [.04, 0], [.07, .15], [.02, .3], [.06, .45], [.01, .68], [-.03, .45], [-.015, .3], [-.05, .15]], .022, EDGE, { ...FORWARD, z: .1, c2: EDGE_DARK }); g.ball(.05, .05, .05, c.aura, { z: .08, rings: 3, sides: 5 }); },
    (g, c) => { for (const x of [-.07, 0, .07]) g.tube([[x, -.03, .04], [x * 1.4, -.04, .24], [x * 1.1, .04, .42]], [.022, .018, 0], EDGE, { sides: 4, c2: EDGE_DARK }); g.box(.2, .1, .1, c.dark, {}); },
    () => null,
  ],
  gunner: [
    (g, c) => { g.lathe([[.06, .5], [.065, -.5]], GUNMETAL, { ...FORWARD, z: .72, sides: 7, sx: .85 }); g.lathe([[.038, .46], [.04, -.34]], BLACK, { ...FORWARD, z: 1.54, sides: 6 }); g.box(.09, .24, .08, c.aura, { rx: Math.PI / 2, z: .78, y: .1 }); g.box(.08, .14, .24, WOOD, { y: -.12, z: .12, rx: .2 }); g.box(.09, .1, .4, WOOD, { y: -.04, z: .02 }); },
    (g, c) => { g.lathe([[.15, .22], [.06, .12], [.065, -.95]], c.trim, { ...FORWARD, z: 1.3, sides: 8, c2: shade(c.trim, .6) }); g.box(.09, .14, .5, WOOD, { z: .1, y: -.03, c2: shade(WOOD, .7) }); g.tube([[0, .05, .4], [0, .13, .32], [0, .1, .18]], [.02, .02, .02], GUNMETAL, { sides: 4 }); },
    (g, c) => { g.lathe([[.11, .06, c.aura], [.13, 0], [.14, -.75]], GUNMETAL, { ...FORWARD, z: .68, sides: 8 }); for (const s of [-1, 1]) g.box(.05, .22, .16, c.aura, { x: s * .14, z: .5 }); g.lathe([[.15, .05], [.15, -.05]], c.trim, { ...FORWARD, z: .34, sides: 8 }); },
    (g, c) => { g.lathe([[.05, .34], [.055, -.2]], GUNMETAL, { ...FORWARD, z: .34, sides: 6 }); g.box(.08, .2, .1, WOOD, { y: -.1, z: .05, rx: .2 }); g.box(.05, .05, .12, c.aura, { y: .06, z: .4 }); },
  ],
};

const SHIELDS = [
  (g, c) => g.plate([[-.34, .42], [.34, .42], [.36, -.02], [.2, -.42], [0, -.62], [-.2, -.42], [-.36, -.02]], .05, c.trim, { ry: Math.PI / 2, x: .16, y: -.22, ridge: .07, c2: c.steel }).gem(.08, .2, c.aura, { lit: true, x: .24, y: -.14 }),
  (g, c) => { g.lathe([[.0001, .1, c.steel], [.18, .08], [.42, .02, c.trim], [.42, -.02, c.trim], [.0001, -.04]], c.trim, { rz: -Math.PI / 2, x: .15, y: -.22, sides: 10 }); g.spike(.06, .14, EDGE, { x: .24, y: -.22, rz: -Math.PI / 2 }); },
  (g, c) => g.plate([[-.27, .62], [.27, .62], [.27, -.72], [-.27, -.72]], .06, c.steel, { ry: Math.PI / 2, x: .16, y: -.22, ridge: .04, c2: c.trim }).box(.05, 1.1, .08, c.trim, { x: .24, y: -.22 }),
  (g, c) => g.plate([[-.2, .22], [.2, .22], [.13, -.2], [0, -.3], [-.13, -.2]], .04, c.trim, { ry: Math.PI / 2, x: .14, y: -.18, ridge: .03, c2: c.steel }),
];

// What each person came out wearing, for their picture in the menus.
export const WORN = new Map();
export function makeCharacter(member, scene, shared, taken) {
  const cls = member.cls, r = rng(member.id), pick = list => list[r() * list.length | 0], [baseTall, baseBroad, baseBulk] = BUILD[cls];
  // Nobody in a fight shares a colour.
  const free = CLOTH.filter(colour => !taken.has(colour)), drawn = pick(free.length ? free : CLOTH), cloth = member.cloth ?? drawn; taken.add(cloth); WORN.set(member.id, cloth);
  // A second colour for sleeves, legs and boots, and armour takes on some of the person's own.
  const second = pick(CLOTH.filter(colour => colour !== cloth)), plain = pick(STEEL), c = { cloth, second, dark: shade(cloth, .55), trim: pick(TRIM), steel: r() < .65 ? blend(plain, cloth, .55) : plain, aura: pick(AURA[cls]) }, skin = pick(SKIN), hair = pick(HAIR), knight = cls === 'knight', sage = cls === 'sage';
  const tall = baseTall * (.96 + r() * .1), broad = baseBroad * (.9 + r() * .22), waist = .62 + r() * .3, bulk = baseBulk * (.9 + r() * .26), headSize = (.9 + r() * .12) * (knight ? .86 : 1), hipsWide = (.85 + r() * .2) * (knight ? 1.15 : 1), hands = (knight ? 1.5 : 1.2) * (.95 + r() * .25), feet = (knight ? 1.5 : 1.25) * (.95 + r() * .2);
  const rig = new Rig(scene, shared), body = rig.joint(rig.root, 'body', 0, 0, 0); body.scale.setScalar(tall);
  const top = knight ? c.steel : cloth, topDark = knight ? shade(c.steel, .7) : c.dark, sleeve = knight ? shade(c.steel, .92) : pick([cloth, c.dark, second]), legs = knight ? shade(second, .8) : pick([c.dark, second, shade(second, .7), LEATHER]), boots = knight ? c.steel : pick([LEATHER, BLACK, second, shade(second, .7)]), gloves = knight ? c.trim : pick([skin, skin, LEATHER, c.trim]);

  // Fabrics draw from their own stream, so what someone looks like otherwise doesn't change with them. A pattern is either stitched in the person's trim or woven in a shade of the cloth itself.
  const w = rng(`cloth${member.id}`), any = list => list[w() * list.length | 0], rack = FABRIC[cls], main = any(rack.main), under = any(rack.under), hem = any(rack.hem), bold = w() < .55;
  const inkOn = base => bold && Math.abs(lightness(c.trim) - lightness(base)) > .12 ? c.trim : lightness(base) > .5 ? shade(base, .6) : blend(base, 0xffffff, .34);
  const worn = (base, pat) => base === skin ? undefined : base === LEATHER || base === BLACK ? { pat: 'leather' } : { pat, ink: inkOn(base) };
  c.hat = worn(knight ? c.steel : cloth, any(rack.head)); c.hood = worn(c.dark, any(rack.head)); c.hem = { pat: hem, ink: lightness(c.trim) > .45 ? c.dark : blend(c.trim, 0xffffff, .5) };

  const chest = new Shape().lathe([[.0001, .68], [.15 * broad, .66], [.3 * broad, .58], [.34 * broad, .44], [.29 * broad * waist, .24], [.23 * hipsWide, .06], [.22 * hipsWide, -.02]], top, { sz: .62, sides: 10, c2: topDark, cloth: worn(top, main) });
  chest.lathe([[.235 * hipsWide, .1], [.24 * hipsWide, .03]], cls === 'sage' ? c.trim : LEATHER, { sz: .68, sides: 10, cloth: cls === 'sage' ? c.hem : { pat: 'leather' } });
  const collar = r();
  if (collar < .4) chest.lathe([[.1, .72], [.17, .63], [.2, .6]], c.trim, { sz: .85, sides: 8, z: -.01, cloth: c.hem });
  else if (collar < .7) chest.plate([[-.18 * broad, .6], [.18 * broad, .6], [0, .24]], .012, c.trim, { z: .19 });
  if (knight) { chest.lathe([[.1 * broad, .62], [.3 * broad, .52], [.3 * broad, .36], [.2 * broad, .18], [.0001, .1]], c.steel, { z: .03, sz: .68, sides: 8, flat: true, c2: shade(c.steel, .68), cloth: worn(c.steel, main) }).gem(.075, .2, c.aura, { lit: true, y: .44, z: .24 }); }
  if (cls === 'gunner') { const pack = r(); if (pack < .4) { for (const s of [-1, 1]) chest.lathe([[.0001, .32], [.11, .26], [.11, -.18], [.0001, -.24]], GUNMETAL, { x: s * .13, y: .42, z: -.28, sides: 7 }); chest.box(.1, .28, .05, c.aura, { y: .42, z: -.21 }); } else if (pack < .75) { chest.box(.42, .46, .18, GUNMETAL, { y: .42, z: -.26, w2: .34 }); chest.lathe([[.07, .3], [.07, -.3]], c.aura, { y: .42, z: -.38, rz: Math.PI / 2, sides: 6 }); } else chest.ball(.22, .24, .13, LEATHER, { y: .36, z: -.24, sides: 7, rings: 4 }); chest.tube([[-.28 * broad, .6, .13], [0, .34, .2], [.26 * broad, .08, .15]], [.025, .025, .025], LEATHER, { sides: 4 }); }
  if (cls === 'rogue') chest.tube([[-.27 * broad, .58, .14], [0, .32, .19], [.22, .08, .15]], [.03, .03, .03], LEATHER, { sides: 4 }).tube([[.27 * broad, .58, -.14], [0, .32, -.2], [-.22, .08, -.15]], [.03, .03, .03], LEATHER, { sides: 4 });

  const hips = rig.joint(body, 'hips', 0, 1.02, 0, new Shape().ball(.235 * hipsWide, .14, .17, shade(top, .78), { y: -.02, sides: 8, rings: 4, cloth: worn(shade(top, .78), under) }));
  const torso = rig.joint(hips, 'torso', 0, .06, 0, chest);
  // Pauldrons and mantles sit on the torso, so they read as armour instead of part of the arm.
  const shoulders = new Shape(), shoulderStyle = r();
  for (const s of [-1, 1]) {
    if (knight) {
      if (shoulderStyle < .4) shoulders.ball(.25, .2, .25, c.trim, { x: s * .42 * broad, y: .64, low: .3, rings: 3, sides: 8, c2: c.steel, cloth: worn(c.trim, main) });
      else if (shoulderStyle < .75) { shoulders.ball(.23, .17, .23, c.steel, { x: s * .42 * broad, y: .64, low: .25, rings: 3, sides: 8, cloth: worn(c.steel, main) }); shoulders.spike(.07, .3, c.trim, { x: s * .52 * broad, y: .8, rz: s * -.6, sides: 5 }); shoulders.spike(.06, .22, c.trim, { x: s * .36 * broad, y: .84, rz: s * -.2, sides: 5 }); }
      else for (let i = 0; i < 3; i++) shoulders.ball(.22 - i * .012, .08, .22, i % 2 ? c.steel : c.trim, { x: s * (.38 + i * .05) * broad, y: .7 - i * .09, rz: s * -.35, low: .2, rings: 2, sides: 8 });
    } else if (cls === 'gunner' && shoulderStyle < .5) shoulders.ball(.15, .12, .15, GUNMETAL, { x: s * .37 * broad, y: .66, low: .2, rings: 2, sides: 7 });
    else if (cls === 'duelist' && s > 0 && shoulderStyle < .55) shoulders.ball(.17, .1, .18, c.trim, { x: s * .37 * broad, y: .67, low: .25, rings: 2, sides: 7 });
    else if (cls === 'rogue' && shoulderStyle < .4) shoulders.ball(.13, .08, .13, LEATHER, { x: s * .34 * broad, y: .65, low: .25, rings: 2, sides: 6 });
  }
  if (sage && shoulderStyle < .6) shoulders.lathe([[.13, .69], [.32 * broad, .62], [.45 * broad, .46]], c.trim, { sz: .72, sides: 10, c2: shade(c.trim, .7), cloth: { pat: main, ink: c.hem.ink } });
  if (shoulders.p.length) rig.part(torso, shoulders);

  // What hangs behind: long capes for duelists, and sometimes a mantle, a scarf or a tabard for the rest.
  const backStyle = r();
  if (cls === 'duelist') {
    const long = backStyle < .4, half = backStyle > .72;
    const shape = long ? [[-.3, 0], [.3, 0], [.5, -1.08], [.26, -1.28], [0, -1.15], [-.26, -1.28], [-.5, -1.08]] : half ? [[-.28, 0], [.1, 0], [.04, -.72], [-.2, -.88], [-.42, -.6]] : [[-.26, 0], [.26, 0], [.34, -.62], [.14, -.9], [0, -.72], [-.14, -.9], [-.34, -.62]];
    rig.joint(torso, 'cape', 0, .64, -.18, new Shape().plate(shape, .03, shade(cloth, .8), { c2: c.trim, ridge: .03, cloth: worn(shade(cloth, .8), main) }));
  } else if (cls === 'rogue') rig.joint(torso, 'cape', .08, .68, -.14, new Shape().plate([[-.08, 0], [.08, 0], [.13, -.38], [.06, -.86], [-.01, -.62], [-.12, -.42]], .02, c.aura, { c2: shade(c.aura, .55), ridge: .01, cloth: worn(c.aura, 'stripes') }));
  else if (knight && backStyle < .55) rig.joint(torso, 'cape', 0, .62, -.2, new Shape().plate([[-.34, 0], [.34, 0], [.5, -.95], [.2, -1.14], [-.2, -1.14], [-.5, -.95]], .03, cloth, { c2: c.dark, ridge: .03, cloth: worn(cloth, any(['damask', 'folds', 'brocade'])) }));
  else if (sage && backStyle < .45) rig.joint(torso, 'cape', 0, .64, -.18, new Shape().plate([[-.24, 0], [.24, 0], [.3, -.9], [0, -1.05], [-.3, -.9]], .03, c.dark, { c2: c.trim, ridge: .02, cloth: worn(c.dark, main) }));
  if (rig.J.cape) rig.J.cape.rotation.x = .12;

  const wearIndex = r() * WEAR[cls].length | 0, bare = HAIRLESS[cls]?.has(wearIndex), style = pick(Object.keys(HAIRDOS)), eye = cls === 'rogue' ? c.aura : pick([BLACK, BLACK, 0x28402a, 0x4a2a14]), hg = headFor(new Shape(), { skin, hair, eye, r, style, bare });
  // Some of each class go without a hat, so hair stays part of the variety.
  if (bare || r() < .72) WEAR[cls][wearIndex](hg, c);
  const head = rig.joint(torso, 'head', 0, .68, 0, hg); head.scale.setScalar(headSize);

  for (const s of [-1, 1]) {
    const k = s < 0 ? 'R' : 'L', wide = sage ? 1.05 : cls === 'rogue' ? .9 : 1, arm = bulk * wide;
    const upper = limb(new Shape(), .095 * arm, .075 * arm, .4, sleeve, { c2: shade(sleeve, .8), cloth: worn(sleeve, knight ? main : under) }), a = rig.joint(torso, 'a' + k, s * .37 * broad, .62, 0, upper);
    const forearm = knight ? shade(c.steel, .9) : sage ? cloth : pick([sleeve, skin]), lower = limb(new Shape(), .075 * arm, sage ? .15 : .06 * arm, .38, forearm, { c2: sage ? c.dark : undefined, cloth: worn(forearm, sage || knight ? main : under) });
    if (knight) lower.lathe([[.09, -.14], [.09, -.3]], c.trim, { sides: 7, cloth: c.hem });
    else if (r() < .4) { const cuff = pick([LEATHER, c.trim]); lower.lathe([[.075, -.26], [.08, -.36]], cuff, { sides: 7, cloth: cuff === LEATHER ? { pat: 'leather' } : c.hem }); }
    lower.ball(.085 * hands, .09 * hands, .095 * hands, gloves, { y: -.45, sides: 7, rings: 3, c2: shade(gloves, .75), cloth: gloves === skin ? undefined : { pat: 'leather' } });
    if (knight && k === 'L') SHIELDS[r() * SHIELDS.length | 0](lower, c);
    if (cls === 'gunner' && k === 'L' && r() < .5) lower.box(.13, .2, .15, GUNMETAL, { y: -.2 }).box(.14, .05, .1, c.aura, { y: -.2, z: .03 });
    const fore = rig.joint(a, 'f' + k, 0, -.42, 0, lower);
    if (k === 'R') {
      const hand = new Shape(), style = r() * WEAPONS[cls].length | 0; WEAPONS[cls][style](hand, c);
      if (!hand.p.length) WEAPONS[cls][0](hand, c);
      const wrist = rig.joint(fore, 'wR', 0, -.47, 0, hand); wrist.rotation.x = HOLD[cls];
      if (cls === 'gunner') wrist.tip = GUN_TIP[style];
    } else if (cls === 'rogue' || (cls === 'gunner' && r() < .3)) { const hand = new Shape(); WEAPONS[cls][cls === 'rogue' ? r() * 3 | 0 : 3](hand, c); const wrist = rig.joint(fore, 'wL', 0, -.47, 0, hand); wrist.rotation.x = HOLD[cls]; if (cls === 'gunner') wrist.tip = GUN_TIP[3]; }
    if (rig.J['w' + k]) rig.J['w' + k].hold = HOLD[cls];
    const thigh = rig.joint(hips, 't' + k, s * .125 * hipsWide, -.04, 0, limb(new Shape(), .115 * bulk, .085 * bulk, .46, legs, { c2: shade(legs, .85), cloth: worn(legs, under) }));
    const boot = knight ? { pat: main, ink: inkOn(boots) } : { pat: 'leather' }, shin = limb(new Shape(), .085 * bulk, .065, .42, legs, { cloth: worn(legs, under) }).lathe([[.09, -.2], [.1, -.32], [.085, -.44]], boots, { sides: 7, cloth: boot }).ball(.1 * feet, .085 * feet, .21 * feet, boots, { y: -.47, z: .08 * feet, top: .9, low: .4, sides: 7, rings: 3, c2: shade(boots, .6), cloth: boot });
    if (knight) shin.spike(.07, .12, c.trim, { y: -.12, z: .08, rx: .9, sides: 5 });
    rig.joint(thigh, 's' + k, 0, -.46, 0, shin);
  }
  const skirt = new Shape();
  if (sage) { const long = r(); skirt.lathe([[.235 * hipsWide, 0], [.28, -.3], [long < .5 ? .46 : .36, -.86], [long < .5 ? .47 : .38, -.9], [.0001, -.9]], cloth, { sz: .72, sides: 10, c2: c.dark, cloth: worn(cloth, main) }); const wide = long < .5 ? .47 : .38; skirt.lathe([[wide - .015, -.7], [wide, -.9]], c.trim, { sz: .73, sides: 10, cloth: c.hem });
    // A panel down the front, lying on the robe as it flares.
    if (w() < .6) { const near = .235 * hipsWide * .72 + .012, far = wide * .72 + .014; skirt.plate([[-.07, 0], [.07, 0], [.11, -.7], [-.11, -.7]], .006, second, { z: near, rx: -Math.atan2(far - near, .7), cloth: { pat: any(['brocade', 'damask', 'stripes']), ink: inkOn(second) } }); } } else if (cls === 'duelist' || (cls === 'gunner' && r() < .6)) skirt.lathe([[.24 * hipsWide, 0], [.3, -.2], [.32, -.42], [.0001, -.42]], shade(top, .82), { sz: .72, sides: 9, c2: c.dark, cloth: worn(shade(top, .82), main) });
  else if (knight) for (const x of [-.14, .14]) skirt.plate([[-.12, 0], [.12, 0], [.1, -.34], [-.1, -.34]], .03, c.steel, { x: x, z: .14, rx: -.08, c2: c.trim, cloth: worn(c.steel, main) });
  if (skirt.p.length) rig.part(hips, skirt);
  rig.build();
  return { rig, aura: c.aura, cape: rig.J.cape ? rig.J.cape.rotation.x : 0, tall };
}

const GUN_TIP = [2, 1.52, .74, .68];

// Shoulders, spine and limbs for each stance: [x, y, z] joint angles, and for the hips how far they drop.
export const POSE = {
  hurt: { hips: [.08, .12, 0, -.3], torso: [.42, -.1, 0], head: [.2, .1, 0], aR: [-.5, 0, 0], fR: [-.5, 0, 0], aL: [.3, 0, .1], fL: [-1.4, 0, 0], tL: [-.9, 0, 0], sL: [1, 0, 0], tR: [.45, 0, 0], sR: [.9, 0, 0] },
  // A long lunge: front knee bent, back leg stretched out behind, weapon out in front.
  stance: { hips: [0, .32, 0, -.16], torso: [.16, -.28, 0], head: [-.08, .24, 0], aR: [-.8, 0, 0], fR: [-.6, 0, 0], aL: [-.55, 0, .3], fL: [-.85, 0, 0], tL: [-.75, 0, 0], sL: [.5, 0, 0], tR: [.55, 0, 0], sR: [.05, 0, 0] },
  windup: { hips: [0, .5, 0, -.14], torso: [-.12, .55, 0], head: [0, -.3, 0], aR: [-2.8, 0, 0], fR: [-.5, 0, 0], aL: [-.5, 0, .3], fL: [-.6, 0, 0], tL: [-.6, 0, 0], sL: [.7, 0, 0], tR: [.35, 0, 0], sR: [.5, 0, 0] },
  strike: { hips: [0, -.45, 0, -.24], torso: [.5, -.5, 0], head: [-.25, .3, 0], aR: [-1.05, 0, 0], fR: [-.15, 0, 0], aL: [.5, 0, .5], fL: [-.3, 0, 0], tL: [-1, 0, 0], sL: [.6, 0, 0], tR: [.75, 0, 0], sR: [.55, 0, 0] },
  cast: { hips: [0, .1, 0, 0], torso: [-.18, 0, 0], head: [-.3, 0, 0], aR: [-2.7, 0, -.1], fR: [-.3, 0, 0], aL: [-2.7, 0, .1], fL: [-.3, 0, 0], tL: [-.1, 0, 0], sL: [.15, 0, 0], tR: [.1, 0, 0], sR: [.15, 0, 0] },
  think: { hips: [0, .18, 0, -.04], torso: [0, -.1, 0], head: [-.22, .1, 0], aR: [-1.3, 0, 0], fR: [-.4, 0, 0], aL: [-.2, 0, .1], fL: [-1.9, 0, 0], tL: [-.2, 0, 0], sL: [.3, 0, 0], tR: [.15, 0, 0], sR: [.25, 0, 0] },
  ready: { hips: [0, 0, 0, -.02], torso: [-.06, 0, 0], head: [0, 0, 0], aR: [-1.55, 0, 0], fR: [-.35, 0, 0], aL: [-1.1, 0, .35], fL: [-.9, 0, 0], tL: [-.2, 0, 0], sL: [.3, 0, 0], tR: [.1, 0, 0], sR: [.2, 0, 0] },
  kneel: { hips: [.1, 0, 0, -.52], torso: [.3, 0, 0], head: [.35, 0, 0], aR: [-.55, 0, 0], fR: [-.5, 0, 0], aL: [-.2, 0, .1], fL: [-.6, 0, 0], tL: [-1.45, 0, 0], sL: [1.45, 0, 0], tR: [.15, 0, 0], sR: [1.55, 0, 0] },
  done: { hips: [0, 0, 0, 0], torso: [-.08, .1, 0], head: [-.12, 0, 0], aR: [-2.95, 0, 0], fR: [-.1, 0, 0], aL: [.2, 0, .6], fL: [-1.5, 0, 0], tL: [-.08, 0, 0], sL: [.1, 0, 0], tR: [.1, 0, .04], sR: [.1, 0, 0] },
  wait: { hips: [0, .1, 0, -.04], torso: [.04, 0, 0], head: [.28, 0, 0], aR: [-.5, 0, 0], fR: [-.3, 0, 0], aL: [-.1, 0, .1], fL: [-.3, 0, 0], tL: [-.12, 0, 0], sL: [.18, 0, 0], tR: [.1, 0, 0], sR: [.18, 0, 0] },
  // Weapon up and level at the shoulder, the other hand under it, feet set.
  aim: { hips: [0, .3, 0, -.12], torso: [.06, -.3, 0], head: [0, .3, 0], aR: [-1.5, .3, 0], fR: [-.06, 0, 0], aL: [-1.25, -.2, .35], fL: [-.55, 0, 0], wrist: 1.5, tL: [-.55, 0, 0], sL: [.4, 0, 0], tR: [.4, 0, 0], sR: [.12, 0, 0] },
  // A walk's two halves.
  stepL: { hips: [0, .1, 0, -.04], torso: [.1, -.08, 0], head: [-.05, .08, 0], aR: [.4, 0, 0], fR: [-.4, 0, 0], aL: [-.5, 0, .1], fL: [-.5, 0, 0], tL: [-.7, 0, 0], sL: [.3, 0, 0], tR: [.4, 0, 0], sR: [.35, 0, 0] },
  stepR: { hips: [0, -.1, 0, -.04], torso: [.1, .08, 0], head: [-.05, -.08, 0], aR: [-.5, 0, 0], fR: [-.5, 0, 0], aL: [.4, 0, .1], fL: [-.4, 0, 0], tL: [.4, 0, 0], sL: [.35, 0, 0], tR: [-.7, 0, 0], sR: [.3, 0, 0] },
  // Down and coiled, weapon drawn back behind them for the blow to come.
  gather: { hips: [0, .7, 0, -.34], torso: [.34, .3, 0], head: [-.3, -.6, 0], aR: [.75, 0, -.35], fR: [-.5, 0, 0], aL: [-.9, 0, .4], fL: [-1, 0, 0], tL: [-1.05, 0, 0], sL: [.95, 0, 0], tR: [.6, 0, 0], sR: [.55, 0, 0] },
  // Both hands thrown forward: the spell's gone.
  release: { hips: [0, .1, 0, -.1], torso: [.2, 0, 0], head: [-.1, 0, 0], aR: [-1.55, 0, -.12], fR: [-.05, 0, 0], aL: [-1.55, 0, .12], fL: [-.05, 0, 0], tL: [-.5, 0, 0], sL: [.3, 0, 0], tR: [.5, 0, 0], sR: [.25, 0, 0] },
  // Flat on their back, arms flung out along the ground and the weapon in line with the arm, lying there with them.
  ko: { hips: [-1.5, .3, 0, -.82], torso: [.1, 0, .1], head: [.2, .6, 0], aR: [.1, 0, -.42], fR: [0, 0, 0], aL: [.1, 0, .42], fL: [-.1, 0, 0], wrist: 1.5, tL: [-.2, 0, .1], sL: [.3, 0, 0], tR: [.1, 0, -.1], sR: [.5, 0, 0] },
};
export function setPose(J, pose, k) {
  for (const name in pose) {
    const joint = J[name], v = pose[name];
    if (!joint) continue;
    joint.rotation.x = mix(joint.rotation.x, v[0], k); joint.rotation.y = mix(joint.rotation.y, v[1], k); joint.rotation.z = mix(joint.rotation.z, v[2], k);
    if (name === 'hips') joint.position.y = mix(joint.position.y, 1.02 + v[3], k);
  }
  // A weapon stays at its class's grip unless the pose says otherwise.
  for (const wrist of [J.wR, J.wL]) if (wrist) wrist.rotation.x = mix(wrist.rotation.x, pose.wrist ?? wrist.hold, k);
}
export { blend };
