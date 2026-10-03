import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';
import { fileURLToPath } from 'url';

const configDirectory = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(configDirectory, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3001',
      '/signup': 'http://127.0.0.1:3001',
      '/login': 'http://127.0.0.1:3001',
      '/logout': 'http://127.0.0.1:3001',
      '/forgot-password': 'http://127.0.0.1:3001',
      '/reset-password': 'http://127.0.0.1:3001',
      '/me': 'http://127.0.0.1:3001',
      '/password': 'http://127.0.0.1:3001',
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    globals: true,
  },
});
