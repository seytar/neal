import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createInitialState, getDefaultAgentConfig, getRunStatePath, saveState } from '../src/neal/state.js';
import {
  aggregateUsageMetrics,
  buildAllUsageSnapshot,
  buildRunUsageSnapshot,
  renderHumanAllUsage,
  renderHumanRunUsage,
} from '../src/neal/usage.js';
import type { OrchestrationState } from '../src/neal/types.js';
import type { RunEvent } from '../src/neal/verification-events.js';

async function createRun(
  cwd: string,
  runId: string,
  events: RunEvent[],
  mutate?: (state: OrchestrationState) => OrchestrationState,
) {
  const stateDir = join(cwd, '.neal');
  const runDir = join(stateDir, 'runs', runId);
  await mkdir(runDir, { recursive: true });
  const planDoc = join(cwd, `${runId}.md`);
  await writeFile(planDoc, '# Plan\n', 'utf8');

  const initial = await createInitialState(
    {
      cwd,
      planDoc,
      stateDir,
      runDir,
      topLevelMode: 'execute',
      allowedDirtyPaths: [],
      agentConfig: getDefaultAgentConfig(cwd),
      progressJsonPath: join(runDir, 'plan-progress.json'),
      progressMarkdownPath: join(runDir, 'PLAN_PROGRESS.md'),
      reviewMarkdownPath: join(runDir, 'REVIEW.md'),
      recoveryMarkdownPath: join(runDir, 'RECOVERY.md'),
      maxRounds: 3,
    },
    'base',
  );
  const state = mutate?.(initial) ?? initial;
  await saveState(getRunStatePath(runDir), state);
  await writeFile(join(runDir, 'events.ndjson'), events.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  return state;
}

function event(ts: string, type: string, data: Record<string, unknown> = {}): RunEvent {
  return { ts, type, data };
}

test('usage run snapshot reads live events and latest follows the current run pointer', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'neal-usage-current-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  const currentId = '2026-09-21T12-00-00.000Z-current';
  await createRun(cwd, currentId, [
    event('2026-09-21T12:00:00.000Z', 'provider.turn_completed', {
      provider: 'openai-compatible',
      role: 'coder',
    }),
    event('2026-09-21T12:00:01.000Z', 'provider.usage_reported', {
      provider: 'openai-compatible',
      role: 'coder',
      usage: {
        inputTokens: { total: 1000, noCache: 800, cacheRead: 200, cacheWrite: 0 },
        outputTokens: { total: 100, text: 90, reasoning: 10 },
      },
      costUsd: 0.001,
      costSource: 'rate',
    }),
  ]);

  await createRun(cwd, '2026-09-21T13-00-00.000Z-other', [
    event('2026-09-21T13:00:00.000Z', 'provider.usage_reported', {
      provider: 'anthropic-claude',
      role: 'structured-advisor',
      usage: { input_tokens: 50, output_tokens: 5 },
    }),
  ]);

  const snapshot = await buildRunUsageSnapshot({ cwd, runId: 'latest' });
  assert.equal(snapshot.runId, currentId);
  assert.equal(snapshot.metrics.providers[0]?.usage.inputTokens, 1000);
  assert.equal(snapshot.metrics.providers[0]?.usage.cachedInputTokens, 200);
  assert.equal(snapshot.metrics.providers[0]?.usage.outputTokens, 100);
  const rendered = renderHumanRunUsage(snapshot);
  assert.match(rendered, /openai-compatible \/ coder/);
  assert.match(rendered, /1,000/);
  assert.match(rendered, /\$0\.0010\*/);
});

test('usage --all aggregation sums run metrics without double-counting turn_completed usage', async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), 'neal-usage-all-'));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await createRun(cwd, 'run-a', [
    event('2026-09-21T12:00:00.000Z', 'provider.turn_completed', {
      provider: 'openai-compatible',
      role: 'coder',
      usage: { input_tokens: 9999, output_tokens: 9999 },
      costUsd: 99,
      costSource: 'rate',
    }),
    event('2026-09-21T12:00:01.000Z', 'provider.usage_reported', {
      provider: 'openai-compatible',
      role: 'coder',
      usage: { input_tokens: 100, output_tokens: 20 },
      costUsd: 0.01,
      costSource: 'rate',
    }),
  ]);

  await createRun(cwd, 'run-b', [
    event('2026-09-21T13:00:00.000Z', 'provider.usage_reported', {
      provider: 'openai-compatible',
      role: 'coder',
      usage: { input_tokens: 50, output_tokens: 10 },
    }),
    event('2026-09-21T13:00:01.000Z', 'provider.usage_reported', {
      provider: 'anthropic-claude',
      role: 'structured-advisor',
      label: 'plan-review',
      usage: { input_tokens: 40, output_tokens: 5 },
      costUsd: 0.02,
      costSource: 'provider',
    }),
  ]);

  const snapshot = await buildAllUsageSnapshot({ cwd });
  assert.equal(snapshot.runCount, 2);
  const compatible = snapshot.totals.providers.find(
    (provider) => provider.provider === 'openai-compatible' && provider.role === 'coder',
  );
  assert.ok(compatible);
  assert.equal(compatible.usage.inputTokens, 150);
  assert.equal(compatible.usage.outputTokens, 30);
  assert.equal(compatible.costUsd, 0.01);
  assert.equal(compatible.costCoverage, 'partial');
  assert.equal(snapshot.totals.costCoverage, 'partial');
  assert.ok(snapshot.totals.totalCostUsd !== null && Math.abs(snapshot.totals.totalCostUsd - 0.03) < 1e-9);

  const rendered = renderHumanAllUsage(snapshot);
  assert.match(rendered, /Runs: 2/);
  assert.match(rendered, /partial/);
  assert.doesNotMatch(rendered, /99\.0000/);
});

test('aggregateUsageMetrics preserves unknown cost instead of inventing dollars', () => {
  const aggregate = aggregateUsageMetrics([
    {
      observedStartedAt: null,
      observedCompletedAt: null,
      observedDurationMs: null,
      providerTurns: 1,
      commandCount: 0,
      nonZeroCommandCount: 0,
      resolvedNonZeroCommandCount: 0,
      unresolvedNonZeroCommandCount: 0,
      toolEventCount: 0,
      fileChangeEventCount: 0,
      phases: [],
      providers: [
        {
          provider: 'openai-compatible',
          role: 'coder',
          label: null,
          turns: 1,
          usage: {
            inputTokens: 100,
            cachedInputTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            outputTokens: 20,
            reasoningOutputTokens: 0,
            totalTokens: 0,
          },
          costUsd: null,
          costSource: null,
        },
      ],
      totalCostUsd: null,
      costCoverage: 'none',
    },
  ]);

  assert.equal(aggregate.totalCostUsd, null);
  assert.equal(aggregate.costCoverage, 'none');
});
