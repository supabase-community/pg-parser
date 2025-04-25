import { defineWorkspace } from 'vitest/config';

export default defineWorkspace([
  {
    test: {
      name: 'unit:node',
      environment: 'node',
      include: ['src/**/*.{test,spec}.ts'],
    },
  },
]);
