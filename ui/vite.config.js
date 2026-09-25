import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { defineConfig } from 'vite';

const uiRoot = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: uiRoot,
  build: {
    outDir: resolve(uiRoot, '../dist/neal/ui-web'),
    emptyOutDir: false,
    target: 'es2022',
  },
});
