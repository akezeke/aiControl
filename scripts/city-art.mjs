// Renders the Metropolis wallpaper (client/backdrop/city-still.js) to client/public/city-bg.png.
// Run: node scripts/city-art.mjs
import { writeFileSync } from 'node:fs';
import { crc32, deflateSync } from 'node:zlib';
import { H, W, drawStill } from '../client/backdrop/city-still.js';

const data = new Uint8ClampedArray(W * H * 4);
drawStill(data);

const chunk = (type, body) => {
  const head = Buffer.alloc(8); head.writeUInt32BE(body.length); head.write(type, 4);
  const tail = Buffer.alloc(4); tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])));
  return Buffer.concat([head, body, tail]);
};
const header = Buffer.alloc(13); header.writeUInt32BE(W); header.writeUInt32BE(H, 4); header.set([8, 6, 0, 0, 0], 8);
const rows = Buffer.alloc((W * 4 + 1) * H);
for (let y = 0; y < H; y++) rows.set(data.subarray(y * W * 4, (y + 1) * W * 4), y * (W * 4 + 1) + 1);
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
writeFileSync(new URL('../client/public/city-bg.png', import.meta.url), png);
console.log(`city-bg.png ${W}x${H}, ${png.length} bytes`);
