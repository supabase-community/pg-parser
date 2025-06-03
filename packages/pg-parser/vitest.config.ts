import { defineConfig } from 'vite';
import { textLoaderPlugin } from './test/plugins/text-loader.js';

export default defineConfig({
  plugins: [textLoaderPlugin('.sql')],
});
