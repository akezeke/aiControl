// Every monitor's screen in one draw a page. A screen keeps a canvas of its own that room.js and slack.js draw on as before (a
// CanvasTexture that's never put on a material, so never uploaded); whatever changed is copied into its cell of a shared 2048²
// texture just before the frame is drawn, with the mipmaps made once for the lot. A page's screens are one mesh, built again
// when one comes, goes or moves. They don't take clicks: the bezel just behind does.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

export const SCREEN_W = 432, SCREEN_H = 256;
// Each cell has an 8 px gutter of its own, so the first few mipmap levels don't take in the neighbours.
const PAGE = 2048, PAD = 8, CELL_W = SCREEN_W + PAD * 2, CELL_H = SCREEN_H + PAD * 2, COLS = Math.floor(PAGE / CELL_W), CELLS = COLS * Math.floor(PAGE / CELL_H);

export function createScreens(root, renderer) {
  const pages = [], at = new THREE.Vector2(), toRoot = new THREE.Matrix4(), place = new THREE.Matrix4();
  let moved = false;
  // GL space: the cell's corner from the bottom left.
  const corner = cell => [cell % COLS * CELL_W + PAD, Math.floor(cell / COLS) * CELL_H + PAD];
  const addPage = () => {
    // Storage only, made up front while it still wants mipmaps (see flush); the cells are copied in.
    const texture = Object.assign(new THREE.DataTexture(null, PAGE, PAGE), { colorSpace: THREE.SRGBColorSpace, flipY: true, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter, anisotropy: 4 });
    texture.source.dataReady = false; texture.needsUpdate = true; renderer.initTexture(texture);
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ map: texture }));
    mesh.raycast = () => {}; root.add(mesh);
    const page = { texture, mesh, cells: new Array(CELLS).fill(null), key: '' };
    pages.push(page);
    return page;
  };
  // The glass, `width` × `height` metres facing +z in `anchor`'s frame, its cell's part of the page.
  const glass = (screen, cell) => {
    const [x, y] = corner(cell), geometry = new THREE.PlaneGeometry(screen.width, screen.height), uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, (x + 0.5 + uv.getX(i) * (SCREEN_W - 1)) / PAGE, (y + 0.5 + uv.getY(i) * (SCREEN_H - 1)) / PAGE);
    return geometry.applyMatrix4(place.multiplyMatrices(toRoot, screen.anchor.matrixWorld));
  };
  const build = page => {
    toRoot.copy(root.matrixWorld).invert();
    const screens = page.cells.map(screen => screen && (screen.anchor.updateWorldMatrix(true, false), screen));
    const key = screens.map(screen => screen ? place.multiplyMatrices(toRoot, screen.anchor.matrixWorld).elements.map(v => v.toFixed(3)).join() : '').join(';');
    if (key === page.key) return;
    page.key = key; page.mesh.geometry.dispose();
    const parts = screens.flatMap((screen, cell) => screen ? [glass(screen, cell)] : []);
    page.mesh.geometry = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
    parts.forEach(part => part.dispose());
  };

  return {
    // A canvasTexture of SCREEN_W × SCREEN_H, shown `width` × `height` metres at `anchor` (facing its +z). Returns its handle.
    add(anchor, texture, width, height) {
      const page = pages.find(page => page.cells.includes(null)) || addPage(), cell = page.cells.indexOf(null);
      const screen = { anchor, texture, width, height, page, cell, copied: -1 };
      page.cells[cell] = screen; moved = true;
      return screen;
    },
    remove(screen) { if (screen && screen.page.cells[screen.cell] === screen) { screen.page.cells[screen.cell] = null; moved = true; } },
    // Something may have moved (room.sync): the meshes are checked before the next frame.
    moved() { moved = true; },
    // Each frame, before it's drawn: the meshes if anything moved, then the screens drawn on since the last frame.
    flush() {
      if (moved) { moved = false; pages.forEach(build); }
      for (const page of pages) {
        const due = page.cells.filter(screen => screen && screen.copied !== screen.texture.version);
        // Every copy would make the page's mipmaps; only the last one needs to.
        due.forEach((screen, i) => {
          page.texture.generateMipmaps = i === due.length - 1;
          renderer.copyTextureToTexture(screen.texture, page.texture, null, at.set(...corner(screen.cell)));
          screen.copied = screen.texture.version;
        });
        page.texture.generateMipmaps = true;
      }
    },
  };
}
