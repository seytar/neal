import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

process.env.NEAL_RENDER_MATRIX_IMPORT_ONLY = '1';

const { getSpecCells, readModuleBytes } = await import('../test/prompt-render-integrity.test.ts');
const { serializeRenderMatrix, sha256Hex } = await import('../src/neal/prompts/specs.ts');

const outDir = join(process.cwd(), 'tmp', 'shadow-prompt-goldens');
await mkdir(outDir, { recursive: true });

const cells = getSpecCells('completion_coder');
const serialized = serializeRenderMatrix(cells);
await writeFile(join(outDir, 'completion_coder.v3.txt'), serialized, 'utf8');
await writeFile(
  join(outDir, 'manifest.json'),
  JSON.stringify({
    completion_coder: {
      version: 3,
      renderSha: sha256Hex(serialized),
      keys: cells.map((cell) => cell.key),
      charCount: serialized.length,
    },
    specializedModuleSha: sha256Hex(readModuleBytes('src/neal/prompts/specialized.ts')),
  }, null, 2) + '\n',
  'utf8',
);
