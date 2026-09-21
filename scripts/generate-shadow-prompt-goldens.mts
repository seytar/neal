import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

process.env.NEAL_RENDER_MATRIX_IMPORT_ONLY = '1';

const { getSpecCells, readModuleBytes } = await import('../test/prompt-render-integrity.test.ts');
const { serializeRenderMatrix, sha256Hex } = await import('../src/neal/prompts/specs.ts');

const outDir = join(process.cwd(), 'tmp', 'shadow-prompt-goldens');
await mkdir(outDir, { recursive: true });

const versions = {
  completion_coder: 3,
  completion_reviewer: 7,
} as const;

const manifest: Record<string, unknown> = {};

for (const [specId, version] of Object.entries(versions)) {
  const cells = getSpecCells(specId as keyof typeof versions);
  const serialized = serializeRenderMatrix(cells);
  await writeFile(join(outDir, `${specId}.v${version}.txt`), serialized, 'utf8');
  manifest[specId] = {
    version,
    renderSha: sha256Hex(serialized),
    keys: cells.map((cell) => cell.key),
    charCount: serialized.length,
  };
}

manifest.specializedModuleSha = sha256Hex(readModuleBytes('src/neal/prompts/specialized.ts'));
await writeFile(join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));
