import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@aero/protocol': path.resolve(__dirname, 'packages/protocol/src/index.ts'),
      '@aero/motion-core': path.resolve(__dirname, 'packages/motion-core/src/index.ts'),
      '@aero/activity-engine': path.resolve(__dirname, 'packages/activity-engine/src/index.ts'),
      '@aero/music-engine': path.resolve(__dirname, 'packages/music-engine/src/index.ts'),
    },
  },
  test: {
    include: ['packages/**/*.test.ts', 'apps/web/src/**/*.test.ts', 'apps/web/src/**/*.test.tsx', 'tests/**/*.test.ts'],
    environment: 'node',
    environmentMatchGlobs: [['apps/web/**', 'jsdom']],
  },
});
