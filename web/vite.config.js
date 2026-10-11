import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// In development the API runs on :4000 (node src/server.js) and Vite proxies to it.
const api = { target: 'http://localhost:4000', changeOrigin: true };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/matches': api, '/clubs': api, '/health': api } },
  build: { outDir: 'dist' },
});
