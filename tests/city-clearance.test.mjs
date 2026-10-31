import test from 'node:test';
import assert from 'node:assert/strict';
import { layoutOffice } from '../client/office/layout.js';
import { cityPlan, screen, annexAt } from '../client/city/plan.js';
import { groundCells } from '../client/city/ground.js';
import { tower, CROWNS, MASSES } from '../client/city/identity.js';
import { buildTower, annex, coolingPlant, stackPlant } from '../client/city/generator.js';
import { renderSprite } from '../client/city/sprite.js';

const CROWN_MIX = (k, c, r) => CROWNS[(k + c * 3 + r * 5) % 10], MASS_MIX = (k, c) => MASSES[(k + c) % 5];
// 5 projects with 3, 5, 3, 5, 3 sessions: 2, 3, 2, 3, 2 columns, 24 lots.
function fullCity() {
  const sessions = [3, 5, 3, 5, 3].flatMap((n, p) => [...Array(n).keys()].map(i => ({ id: `s${p}-${i}`, project: `p${p}`, cwd: `/p/p${p}`, status: 'working' })));
  const plan = cityPlan(layoutOffice(sessions, null, 1), {}, null, [{ name: 'Claude Code', connected: true }, { name: 'Codex', connected: true }]);
  assert.equal(plan.hoods.reduce((sum, hood) => sum + hood.lots.length, 0), 24);
  return plan;
}
const at = (who, stack, x, z, view) => { const sprite = renderSprite(stack, view), [sx, sy] = screen(x, z, view); return { who, sprite, left: Math.round(sx) - sprite.originX, top: Math.round(sy) - sprite.originY, depth: sy }; };
// A building on EVERY lot, empty or not: a real plan always keeps one empty, so this is what "every lot full" means.
function placed(p, view) {
  const items = [];
  p.hoods.forEach((hood, c) => hood.lots.forEach((lot, k) => {
    const look = { ...tower(lot.key), w: 18, crown: CROWN_MIX(k, c, hood.row), mass: MASS_MIX(k, c) };
    items.push(at(lot.key, buildTower(look, 'lit', 12).stack, lot.x, lot.z, view));
    for (const i of [0, 1, 2]) { const spot = annexAt(lot, i, view); items.push(at(`${lot.key}+${i}`, annex(look, i, 'lit', 4).stack, spot.x, spot.z, view)); }
  }));
  for (const plant of p.plants) items.push(at(plant.provider, plant.provider === 'claude' ? coolingPlant('#e83b3b') : stackPlant('#0eaf9b'), plant.x, plant.z, view));
  return items;
}
const propsPlaced = (p, view) => groundCells(p).props.map((prop, i) => at(`prop${i}`, prop.stack, prop.x, prop.z, view));
const stamp = (m, it, i, clash) => { const { width: W, height: H, mask } = it.sprite; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[x + y * W]) { const k = `${it.left + x},${it.top + y}`; if (m.has(k) && m.get(k) !== i) clash(k, m.get(k), i); m.set(k, i); } };
for (const view of [0, 1, 2, 3]) test(`view ${view}: no building shares a pixel with another`, () => {
  const items = placed(fullCity(), view), m = new Map(), hits = []; items.forEach((it, i) => stamp(m, it, i, (k, a, b) => hits.push(`${items[a].who}/${items[b].who}`)));
  assert.deepEqual([...new Set(hits)], []); assert.equal(items.length, 98);
});
for (const view of [0, 1, 2, 3]) test(`view ${view}: no prop draws over a building`, () => {
  const p = fullCity(), items = placed(p, view), m = new Map(); items.forEach((it, i) => stamp(m, it, i, () => {}));
  const hits = []; for (const prop of propsPlaced(p, view)) { const { width: W, height: H, mask } = prop.sprite; for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[x + y * W]) { const o = m.get(`${prop.left + x},${prop.top + y}`); if (o !== undefined && prop.depth > items[o].depth) hits.push(items[o].who); } }
  assert.deepEqual([...new Set(hits)], []);
});
