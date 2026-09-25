import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Two build targets from one source:
 *
 *   npm run build        → app/tilecraft.html — one self-contained file that
 *                          works straight off disk (file://). No server, no
 *                          install, which is what you want from a tool you
 *                          reach for in the five minutes before printing.
 *   npm run build:split  → dist/ — a conventional hashed-asset bundle for
 *                          hosting somewhere.
 */
export default defineConfig(({ mode }) => {
  const single = mode !== 'split';
  return {
    base: './',
    plugins: [react(), ...(single ? [viteSingleFile()] : [])],
    build: {
      outDir: single ? 'app' : 'dist',
      emptyOutDir: true,
      target: 'es2022',
      assetsInlineLimit: 100 * 1024 * 1024,
      chunkSizeWarningLimit: 4096,
      cssCodeSplit: false,
    },
  };
});
