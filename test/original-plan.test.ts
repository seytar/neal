import './helpers/orchestrator-env.js';

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  initializeOrchestration,
  loadRunForResume,
} from '../src/neal/orchestrator.js';
import { getDefaultAgentConfig } from '../src/neal/state.js';
import { getPlanDocumentBackupPath } from '../src/neal/storage-paths.js';
import { runGit, writeRepoConfig } from './helpers/orchestrator-harness.js';

const ORIGINAL_PLAN = `# Original Plan

## Execution Shape

executionShape: one_shot

## Goal

Preserve the supplied plan exactly.
`;

async function createRepo() {
  const root = await mkdtemp(join(tmpdir(), 'neal-original-plan-'));
  await runGit(root, 'init', 'repo');
  const cwd = join(root, 'repo');
  await runGit(cwd, 'config', 'user.name', 'Neal Test');
  await runGit(cwd, 'config', 'user.email', 'neal@example.com');
  await runGit(cwd, 'config', 'commit.gpgsign', 'false');
  await writeRepoConfig(cwd);

  const planDoc = join(cwd, 'PLAN.md');
  await writeFile(planDoc, ORIGINAL_PLAN, 'utf8');
  await runGit(cwd, 'add', 'PLAN.md', 'neal.yml');
  await runGit(cwd, 'commit', '-m', 'base plan');

  return { cwd, planDoc };
}

for (const topLevelMode of ['plan', 'execute'] as const) {
  test(`new ${topLevelMode} runs preserve an immutable original plan snapshot`, async () => {
    const { cwd, planDoc } = await createRepo();
    const runDir = join(cwd, '.neal', 'runs', `original-${topLevelMode}`);

    const initialized = await initializeOrchestration(
      planDoc,
      cwd,
      getDefaultAgentConfig(cwd),
      topLevelMode,
      { runDir },
    );

    const expectedBackupPath = getPlanDocumentBackupPath(runDir);
    assert.equal(initialized.state.planDocBackupPath, expectedBackupPath);
    assert.equal(await readFile(expectedBackupPath, 'utf8'), ORIGINAL_PLAN);

    await writeFile(
      planDoc,
      ORIGINAL_PLAN.replace('Preserve the supplied plan exactly.', 'Refined working plan.'),
      'utf8',
    );

    assert.equal(await readFile(expectedBackupPath, 'utf8'), ORIGINAL_PLAN);

    const resumed = await loadRunForResume(initialized.statePath);
    assert.equal(resumed.state.planDocBackupPath, expectedBackupPath);
    assert.equal(await readFile(expectedBackupPath, 'utf8'), ORIGINAL_PLAN);
  });
}
