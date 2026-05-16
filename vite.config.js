import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      // API routes
      '/api': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
      },
      // Bare protocol (scramjet needs this)
      '/bare': {
        target: 'http://127.0.0.1:3001',
        changeOrigin: true,
        ws: true,
      },
    },
  },
});
