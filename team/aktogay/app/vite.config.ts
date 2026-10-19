import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Для разработки против запущенной платформы: DITTO_BASIC_AUTH (из deploy/compose/.env) и
// DITTO_DEV_URL (по умолчанию http://localhost:8080). В контейнере ту же роль играет nginx (docker/).
const dittoAuth = process.env.DITTO_BASIC_AUTH;

// base: './' — относительные пути, чтобы сборка работала из любой подпапки.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss()],
  server: dittoAuth
    ? {
        proxy: {
          '/ditto': {
            target: process.env.DITTO_DEV_URL ?? 'http://localhost:8080',
            changeOrigin: true,
            rewrite: (p) => p.replace(/^\/ditto/, ''),
            headers: { Authorization: `Basic ${dittoAuth}` },
          },
        },
      }
    : undefined,
  build: {
    chunkSizeWarningLimit: 700,
    rollupOptions: { output: { manualChunks: { recharts: ['recharts'], react: ['react', 'react-dom'] } } },
  },
  test: {
    environment: 'node',
    // Полные смены на нескольких seed — модель с тремя выработками считает чуть дольше 5 с по умолчанию.
    testTimeout: 20000,
    include: ['src/**/*.test.ts'],
  },
});
