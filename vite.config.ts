import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// In development the UI runs on Vite (5173) and every backend path is proxied to the API.
// In production `vite build` writes to dist/web, which the Express server serves itself.
const apiTarget = `http://localhost:${process.env.PORT ?? '4000'}`;

export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: {
    outDir: '../dist/web',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': apiTarget,
      '/docs': apiTarget,
      '/openapi.json': apiTarget,
      '/health': apiTarget,
      '/socket.io': { target: apiTarget, ws: true },
    },
  },
});
