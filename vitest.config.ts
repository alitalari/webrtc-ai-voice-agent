import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Unit/integration tests live next to or under each package.
    // End-to-end tests live in /e2e and run via `vitest run --project e2e`
    // once a real server + browser harness exists (Phase 1+).
    include: ['packages/**/*.test.ts', 'apps/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/**/src/**', 'apps/**/src/**'],
    },
  },
});
