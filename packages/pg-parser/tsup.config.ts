import { defineConfig } from 'tsup';

export default defineConfig([
  {
    entry: [
      'src/index.ts',
      'src/types/15.ts',
      'src/types/16.ts',
      'src/types/17.ts',
    ],
    format: ['cjs', 'esm'],
    outDir: 'dist',
    sourcemap: true,
    dts: true,
    minify: false,
    splitting: true,
    external: [/wasm\/.*$/],
  },
]);
