import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const DEV_TOKEN = 'dev-token';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: false,
    rollupOptions: {
      output: {
        // Split the React runtime from application code so the framework can
        // be cached independently and the chunks load in parallel.
        manualChunks(id: string) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react')) {
            return 'react-vendor';
          }
          return undefined;
        },
      },
    },
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
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'server/**/*.test.mjs'],
    // Generous defaults keep the suite reliable on a loaded workstation or CI
    // runner; individual tests normally finish in well under a second.
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
