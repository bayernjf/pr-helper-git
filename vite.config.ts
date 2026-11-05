import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_TOKEN = 'dev-token';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4789',
        changeOrigin: true,
        headers: { 'x-git2-token': DEV_TOKEN },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'server/**/*.test.mjs'],
  },
});
