import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    host: '0.0.0.0',
    allowedHosts: ['terminal.local'],
    proxy: { '/api': { target: 'http://127.0.0.1:3001', changeOrigin: false } },
  },
  build: { outDir: 'dist', sourcemap: false },
});
