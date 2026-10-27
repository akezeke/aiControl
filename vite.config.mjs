import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('./client', import.meta.url)),
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    middlewareMode: true,
    hmr: false,
    fs: {
      strict: true,
      allow: [fileURLToPath(new URL('./client', import.meta.url))],
      deny: ['**/.local/**', '**/.env*', '**/*.{key,pem,crt}', '**/server/**', '**/scripts/**'],
    },
  },
});
