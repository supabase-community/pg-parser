import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit:node',
      environment: 'node',
      include: ['src/**/*.{test,spec}.ts'],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit:vercel-edge',
      environment: 'edge-runtime',
      include: ['src/**/*.{test,spec}.ts'],
    },
  },
  {
    extends: './vitest.config.ts',
    test: {
      name: 'unit:browser',
      include: ['src/**/*.{test,spec}.ts'],
      browser: {
        enabled: true,
        provider: 'playwright',
        headless: true,
        screenshotFailures: false,
        instances: [
          { browser: 'chromium' },
          { browser: 'firefox' },
          { browser: 'webkit' },
        ],
      },
    },
  },
]);
