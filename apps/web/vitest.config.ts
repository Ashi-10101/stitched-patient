import path from 'node:path';
import { defineConfig } from 'vitest/config';

// Node environment: no DOM, and tests open no HTTP or WebSocket connection.
// `scripts/` (calibration run) is intentionally outside `include`.
export default defineConfig({
  esbuild: {
    jsx: 'automatic',
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
