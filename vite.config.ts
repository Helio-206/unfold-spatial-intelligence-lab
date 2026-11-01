import { resolve } from 'node:path';
import { defineConfig } from 'vite';

const apiTarget = process.env.UNFOLD_API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
  build: {
    rollupOptions: {
      // Two entries: the application shell (SPA routes) and the static landing page served at /landing/.
      input: {
        main: resolve(__dirname, 'index.html'),
        landing: resolve(__dirname, 'landing/index.html'),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
        secure: false,
      },
    },
  },
});
