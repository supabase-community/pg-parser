import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit:node',
      environment: 'node',
      include: ['src/**/*.{test,spec}.ts'],
    },
  },
  {
    test: {
      name: 'unit:vercel-edge',
      environment: 'edge-runtime',
      include: ['src/**/*.{test,spec}.ts'],
    },
  },
  {
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
