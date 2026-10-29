import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { release } from 'node:os';

const client = fileURLToPath(new URL('./client', import.meta.url));
// Windows drives under WSL (/mnt/c) send no file-change events, so Vite would keep serving modules from before an edit.
const polling = /microsoft/i.test(release()) && client.startsWith('/mnt/');

export default defineConfig({
  root: client,
  build: { outDir: '../dist', emptyOutDir: true },
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
