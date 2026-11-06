import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { release } from 'node:os';

const client = fileURLToPath(new URL('./client', import.meta.url));
// Windows drives under WSL (/mnt/c) send no file-change events, so Vite would keep serving modules from before an edit.
const polling = /microsoft/i.test(release()) && client.startsWith('/mnt/');

export default defineConfig({
  root: client,
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: { input: { main: `${client}/index.html`, image: `${client}/image-window.html` } } },
  // The server runs Vite as middleware. Add-ons found only when a scene loads would re-bundle three mid-session: a second copy of three
  // and a failed import of that scene. Listed here, they're bundled at start-up with three. Add any new add-on a scene imports.
  optimizeDeps: { include: ['three', ...['postprocessing/EffectComposer', 'postprocessing/RenderPass', 'postprocessing/UnrealBloomPass', 'postprocessing/OutputPass', 'postprocessing/ShaderPass', 'environments/RoomEnvironment', 'geometries/RoundedBoxGeometry', 'utils/BufferGeometryUtils'].map(path => `three/addons/${path}.js`)] },
  server: {
    middlewareMode: true,
    hmr: false,
    watch: polling ? { usePolling: true, interval: 1000 } : undefined,
    fs: {
      strict: true,
      allow: [client],
      deny: ['**/.local/**', '**/.env*', '**/*.{key,pem,crt}', '**/server/**', '**/scripts/**'],
    },
  },
});
