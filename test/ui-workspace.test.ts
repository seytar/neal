import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';

import {
  buildUiDiscoveredIssueEntries,
  isUiExecutablePlan,
  listUiIssueFiles,
  mergeUiIssuesForDisplay,
} from '../src/neal/ui-server.js';

const validPlan = `# Ready Issue

## Execution Shape

executionShape: one_shot

## Goal

Ship the prepared change.
`;

async function withWorkspace(
  fn: (cwd: string, issuesDir: string) => Promise<void>,
) {
  const cwd = await mkdtemp(join(tmpdir(), 'neal-studio-workspace-'));
  const issuesDir = join(cwd, 'documentation', 'issues');
  await mkdir(join(issuesDir, 'nested'), { recursive: true });
  try {
    await fn(cwd, issuesDir);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

test('Studio recursively discovers Markdown issues and ignores non-Markdown files', async () => {
  await withWorkspace(async (cwd, issuesDir) => {
    await writeFile(join(issuesDir, '28-raw.md'), '# Raw Issue\n');
    await writeFile(join(issuesDir, '27-ready.md'), validPlan);
    await writeFile(join(issuesDir, 'nested', '26-deep.md'), '# Nested Issue\n');
    await writeFile(join(issuesDir, 'nested', 'notes.txt'), 'not an issue');

    const discovered = await listUiIssueFiles(cwd, 'documentation/issues');
    const relativeFiles = discovered.files.map((file) => relative(cwd, file)).sort();

    assert.equal(discovered.displayPath, 'documentation/issues');
    assert.equal(discovered.truncated, false);
    assert.deepEqual(relativeFiles, [
      'documentation/issues/27-ready.md',
      'documentation/issues/28-raw.md',
      'documentation/issues/nested/26-deep.md',
    ]);
  });
});

test('Studio distinguishes raw issues from canonical executable plans', async () => {
  await withWorkspace(async (_cwd, issuesDir) => {
    const rawPath = join(issuesDir, 'raw.md');
    const readyPath = join(issuesDir, 'ready.md');
    await writeFile(rawPath, '# Raw Issue\n\nNeeds analysis.\n');
    await writeFile(readyPath, validPlan);

    assert.equal(await isUiExecutablePlan(rawPath), false);
    assert.equal(await isUiExecutablePlan(readyPath), true);
  });
});

test('Studio merges discovered issues with attempts and preserves history-only runs', async () => {
  await withWorkspace(async (cwd, issuesDir) => {
    const rawPath = join(issuesDir, '28-raw.md');
    const readyPath = join(issuesDir, '29-ready.md');
    await writeFile(rawPath, '# Raw Issue\n');
    await writeFile(readyPath, validPlan);

    const rawDate = new Date(1_000);
    const readyDate = new Date(3_000);
    await utimes(rawPath, rawDate, rawDate);
    await utimes(readyPath, readyDate, readyDate);

    const discoveredFiles = await listUiIssueFiles(cwd, 'documentation/issues');
    const discoveredEntries = await buildUiDiscoveredIssueEntries(cwd, discoveredFiles.files);

    const legacyPath = join(cwd, 'old', 'legacy-plan.md');
    const runs = [
      {
        runId: 'raw-new',
        planDoc: rawPath,
        updatedAt: new Date(9_000).toISOString(),
        uiTitle: 'Raw Issue',
      },
      {
        runId: 'raw-old',
        planDoc: rawPath,
        updatedAt: new Date(8_000).toISOString(),
        uiTitle: 'Raw Issue',
      },
      {
        runId: 'legacy',
        planDoc: legacyPath,
        updatedAt: new Date(2_000).toISOString(),
        uiTitle: 'Legacy History',
      },
    ];

    const issues = mergeUiIssuesForDisplay(cwd, discoveredEntries, runs);

    assert.equal(issues.length, 3);

    const raw = issues.find((issue) => issue.planDoc === rawPath);
    assert.ok(raw);
    assert.equal(raw.processed, true);
    assert.equal(raw.readyWithoutRun, false);
    assert.equal(raw.runs.length, 2);
    assert.equal(raw.currentRun?.runId, 'raw-new');

    const ready = issues.find((issue) => issue.planDoc === readyPath);
    assert.ok(ready);
    assert.equal(ready.processed, false);
    assert.equal(ready.readyWithoutRun, true);
    assert.equal(ready.runs.length, 0);

    const legacy = issues.find((issue) => issue.planDoc === legacyPath);
    assert.ok(legacy);
    assert.equal(legacy.source, 'history');
    assert.equal(legacy.processed, true);
    assert.equal(legacy.runs.length, 1);

    assert.deepEqual(
      issues.map((issue) => issue.title),
      ['Ready Issue', 'Legacy History', 'Raw Issue'],
      'workspace mtime should drive existing issue ordering; run time is fallback for history-only plans',
    );
  });
});

test('Studio newest-first sorting does not group by status', async () => {
  await withWorkspace(async (cwd, issuesDir) => {
    const newestPath = join(issuesDir, 'newest.md');
    const olderPath = join(issuesDir, 'older.md');
    await writeFile(newestPath, '# Newest Done Issue\n');
    await writeFile(olderPath, '# Older Unprocessed Issue\n');

    await utimes(olderPath, new Date(10_000), new Date(10_000));
    await utimes(newestPath, new Date(20_000), new Date(20_000));

    const discoveredFiles = await listUiIssueFiles(cwd, 'documentation/issues');
    const discoveredEntries = await buildUiDiscoveredIssueEntries(cwd, discoveredFiles.files);
    const runs = [{
      runId: 'done-run',
      planDoc: newestPath,
      updatedAt: new Date(30_000).toISOString(),
      uiTitle: 'Newest Done Issue',
    }];

    const issues = mergeUiIssuesForDisplay(cwd, discoveredEntries, runs);

    assert.equal(issues[0]?.title, 'Newest Done Issue');
    assert.equal(issues[1]?.title, 'Older Unprocessed Issue');
  });
});
