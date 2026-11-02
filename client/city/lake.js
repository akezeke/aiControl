// A lake's shape: an ellipse with a few slow waves round it, so that no two share a shoreline. Pure, and in the city's own coordinates.
const WAVES = [[2, .14], [3, .08], [5, .04]], FULL = 1 + WAVES.reduce((sum, [, size]) => sum + size, 0);
// A big lake's path goes round at this distance from the shore, this wide. Its ground keeps this much past the path.
export const TRAIL_OFF = 10, TRAIL_W = 3;
const ROOM = 5, DRIFT = .03, LONGEST = 1.4, POND_BANK = 4, JETTY_OUT = 22, JETTY_W = 5, ISLET_FROM = 5;
// A seed's neighbouring hashes differ by a constant, which would give every lake the same waves at a turn: stirred, they don't.
const stir = n => { n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d); n = Math.imul(n ^ (n >>> 12), 0x297a2d39); return (n ^ (n >>> 15)) >>> 0; };
const AXES = [[1, 0, 0], [-1, 0, Math.PI], [0, 1, Math.PI / 2], [0, -1, -Math.PI / 2]];

export function lakeOf(h, x, z, w, d, big) {
  const waves = WAVES.map(([n, size], i) => [n, size, stir(h(200 + i)) % 628 / 100]);
  const swell = a => waves.reduce((sum, [n, size, phase]) => sum + size * Math.sin(n * a + phase), 1) / FULL;
  // Off-centre by a little, and never so far that the path runs out of its ground.
  const driftX = big ? ((h(210) % 201) / 100 - 1) * DRIFT * w : 0, driftZ = big ? ((h(211) % 201) / 100 - 1) * DRIFT * d : 0, cx = x + w / 2 + driftX, cz = z + d / 2 + driftZ;
  const fit = (size, drift) => big ? size / 2 - TRAIL_OFF - TRAIL_W - ROOM - Math.abs(drift) : size / 2 - POND_BANK;
  const fitX = fit(w, driftX), fitZ = fit(d, driftZ), ra = big ? Math.min(fitX, fitZ * LONGEST) : fitX, rb = big ? Math.min(fitZ, fitX * LONGEST) : fitZ;
  const at = (a, past) => { const s = swell(a), X = ra * Math.cos(a) * s, Z = rb * Math.sin(a) * s, r = Math.hypot(X, Z), k = (r + past) / r; return [cx + X * k, cz + Z * k]; };
  // How far past the shore, along the line from the middle: below zero is water.
  const past = (X, Z) => { const dx = X - cx, dz = Z - cz, u = dx / ra, v = dz / rb, q = Math.hypot(u, v); return q ? Math.hypot(dx, dz) * (1 - swell(Math.atan2(v, u)) / q) : -ra * swell(0); };
  const lake = { big, x, z, w, d, cx, cz, ra, rb, at, past, land: past, trail: big ? TRAIL_OFF : 0, jetty: null, islet: null };
  if (!big) return lake;
  // The jetty comes in from one side, straight towards the middle; a path leads to it from the street, and a second comes in from the side.
  const [ax, az, facing] = AXES[h(212) % 4], mx = Math.round(cx), mz = Math.round(cz), cells = [];
  let shore = Math.max(w, d); while (shore > 0 && past(mx + ax * shore, mz + az * shore) >= 0) shore--;
  const half = JETTY_W >> 1;
  for (let u = shore + 2; u > shore - JETTY_OUT; u--) for (let v = -half; v <= half; v++) cells.push(ax ? [mx + ax * u, mz + v] : [mx + v, mz + az * u]);
  lake.jetty = { ax, az, facing, mx, mz, shore, half, cells, end: ax ? [mx + ax * (shore - JETTY_OUT + 1), mz] : [mx, mz + az * (shore - JETTY_OUT + 1)] };
  lake.spur = h(213) % 2 ? 1 : -1;
  if (h(214) % 2) {
    const r = ISLET_FROM + h(215) % 4, reach = -past(cx, cz) * .22, ix = Math.round(cx - ax * reach), iz = Math.round(cz - az * reach);
    lake.islet = { x: ix, z: iz, r };
    lake.land = (X, Z) => Math.max(past(X, Z), r - Math.hypot(X - ix, Z - iz));
  }
  return lake;
}
