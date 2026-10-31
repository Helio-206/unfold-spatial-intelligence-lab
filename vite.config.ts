import { defineConfig } from 'vite';

const apiTarget = process.env.UNFOLD_API_TARGET ?? 'http://127.0.0.1:8787';

export default defineConfig({
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
