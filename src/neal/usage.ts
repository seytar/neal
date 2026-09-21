import { readFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';

import { listRuns, resolveRunStatePath } from './run-registry.js';
import {
  summarizeRunMetrics,
  type RunMetricProviderSummary,
  type RunMetricsSummary,
  type RunUsageTotals,
} from './run-metrics.js';
import { loadState } from './state.js';
import type { OrchestrationState } from './types.js';
import type { RunEvent } from './verification-events.js';

export type UsageCostCoverage = 'complete' | 'partial' | 'none';

export type UsageAggregateProviderSummary = {
  provider: string;
  role: string;
  label: string | null;
  turns: number;
  usage: RunUsageTotals;
  costUsd: number | null;
  costSource: 'provider' | 'rate' | 'mixed' | null;
  costCoverage: UsageCostCoverage;
  pricedUsageSegments: number;
  usageSegments: number;
};

export type UsageAggregateSummary = {
  providers: UsageAggregateProviderSummary[];
  totalCostUsd: number | null;
  costCoverage: UsageCostCoverage;
  pricedUsageSegments: number;
  usageSegments: number;
};

export type NealRunUsageSnapshot = {
  ok: true;
  scope: 'run';
  cwd: string;
  runId: string;
  runDir: string;
  planDoc: string;
  topLevelMode: OrchestrationState['topLevelMode'];
  executionProfile: OrchestrationState['executionProfile'];
  status: OrchestrationState['status'];
  phase: OrchestrationState['phase'];
  events: {
    path: string;
    parsedLines: number;
    malformedLines: number;
  };
  metrics: RunMetricsSummary;
};

export type NealAllUsageSnapshot = {
  ok: true;
  scope: 'all';
  cwd: string;
  runCount: number;
  runs: NealRunUsageSnapshot[];
  totals: UsageAggregateSummary;
};

const EMPTY_USAGE: RunUsageTotals = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  totalTokens: 0,
};

function hasUsage(usage: RunUsageTotals) {
  return Object.values(usage).some((value) => value > 0);
}

function addUsage(target: RunUsageTotals, source: RunUsageTotals) {
  target.inputTokens += source.inputTokens;
  target.cachedInputTokens += source.cachedInputTokens;
  target.cacheCreationInputTokens += source.cacheCreationInputTokens;
  target.cacheReadInputTokens += source.cacheReadInputTokens;
  target.outputTokens += source.outputTokens;
  target.reasoningOutputTokens += source.reasoningOutputTokens;
  target.totalTokens += source.totalTokens;
}

function aggregateProviderKey(provider: RunMetricProviderSummary) {
  return `${provider.provider}\0${provider.role}\0${provider.label ?? ''}`;
}

function mergeCostSource(
  current: UsageAggregateProviderSummary['costSource'],
  next: RunMetricProviderSummary['costSource'],
): UsageAggregateProviderSummary['costSource'] {
  if (next === null) {
    return current;
  }
  if (current === null || current === next) {
    return next;
  }
  return 'mixed';
}

function coverage(priced: number, total: number): UsageCostCoverage {
  if (priced === 0) {
    return 'none';
  }
  return priced === total ? 'complete' : 'partial';
}

export function aggregateUsageMetrics(metrics: RunMetricsSummary[]): UsageAggregateSummary {
  const buckets = new Map<string, UsageAggregateProviderSummary>();
  let totalCost = 0;
  let hasCost = false;
  let usageSegments = 0;
  let pricedUsageSegments = 0;

  for (const runMetrics of metrics) {
    for (const provider of runMetrics.providers) {
      const key = aggregateProviderKey(provider);
      const existing = buckets.get(key) ?? {
        provider: provider.provider,
        role: provider.role,
        label: provider.label,
        turns: 0,
        usage: { ...EMPTY_USAGE },
        costUsd: null,
        costSource: null,
        costCoverage: 'none' as const,
        pricedUsageSegments: 0,
        usageSegments: 0,
      };

      existing.turns += provider.turns;
      addUsage(existing.usage, provider.usage);
      existing.costSource = mergeCostSource(existing.costSource, provider.costSource);

      if (hasUsage(provider.usage)) {
        existing.usageSegments += 1;
        usageSegments += 1;
        if (provider.costUsd !== null) {
          existing.pricedUsageSegments += 1;
          pricedUsageSegments += 1;
        }
      }

      if (provider.costUsd !== null) {
        existing.costUsd = (existing.costUsd ?? 0) + provider.costUsd;
        totalCost += provider.costUsd;
        hasCost = true;
      }

      existing.costCoverage = coverage(existing.pricedUsageSegments, existing.usageSegments);
      buckets.set(key, existing);
    }
  }

  const providers = [...buckets.values()].sort((left, right) => {
    const turnOrder = right.turns - left.turns;
    if (turnOrder !== 0) {
      return turnOrder;
    }
    const providerOrder = left.provider.localeCompare(right.provider);
    if (providerOrder !== 0) {
      return providerOrder;
    }
    return left.role.localeCompare(right.role);
  });

  return {
    providers,
    totalCostUsd: hasCost ? totalCost : null,
    costCoverage: coverage(pricedUsageSegments, usageSegments),
    pricedUsageSegments,
    usageSegments,
  };
}

async function readRunEvents(runDir: string) {
  const path = join(runDir, 'events.ndjson');
  let content: string;
  try {
    content = await readFile(path, 'utf8');
  } catch (error) {
    if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { path, events: [] as RunEvent[], parsedLines: 0, malformedLines: 0 };
    }
    throw error;
  }

  const events: RunEvent[] = [];
  let malformedLines = 0;
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        events.push(parsed as RunEvent);
      } else {
        malformedLines += 1;
      }
    } catch {
      malformedLines += 1;
    }
  }

  return { path, events, parsedLines: events.length, malformedLines };
}

async function buildRunSnapshotFromStatePath(cwd: string, statePath: string): Promise<NealRunUsageSnapshot> {
  const state = await loadState(statePath);
  const loaded = await readRunEvents(state.runDir);
  return {
    ok: true,
    scope: 'run',
    cwd: resolve(cwd),
    runId: basename(state.runDir),
    runDir: state.runDir,
    planDoc: state.planDoc,
    topLevelMode: state.topLevelMode,
    executionProfile: state.executionProfile,
    status: state.status,
    phase: state.phase,
    events: {
      path: loaded.path,
      parsedLines: loaded.parsedLines,
      malformedLines: loaded.malformedLines,
    },
    metrics: summarizeRunMetrics(loaded.events),
  };
}

export async function buildRunUsageSnapshot(args: {
  cwd: string;
  runId?: string | null;
}): Promise<NealRunUsageSnapshot> {
  const resolution = await resolveRunStatePath({
    cwd: args.cwd,
    runId: args.runId ?? null,
  });
  return buildRunSnapshotFromStatePath(args.cwd, resolution.statePath);
}

export async function buildAllUsageSnapshot(args: {
  cwd: string;
}): Promise<NealAllUsageSnapshot> {
  const cwd = resolve(args.cwd);
  const runs = await listRuns(cwd);
  const snapshots = await Promise.all(
    runs.map((run) => buildRunSnapshotFromStatePath(cwd, run.statePath)),
  );
  return {
    ok: true,
    scope: 'all',
    cwd,
    runCount: snapshots.length,
    runs: snapshots,
    totals: aggregateUsageMetrics(snapshots.map((snapshot) => snapshot.metrics)),
  };
}

function formatNumber(value: number) {
  return value === 0 ? '-' : value.toLocaleString('en-US');
}

function effectiveTotalTokens(usage: RunUsageTotals) {
  return usage.totalTokens > 0 ? usage.totalTokens : usage.inputTokens + usage.outputTokens;
}

function formatCost(
  value: number | null,
  source: UsageAggregateProviderSummary['costSource'],
  coverageValue: UsageCostCoverage,
) {
  if (value === null) {
    return '-';
  }
  const suffix = source === 'rate' ? '*' : source === 'mixed' ? '†' : '';
  const partial = coverageValue === 'partial' ? ' partial' : '';
  return `$${value.toFixed(4)}${suffix}${partial}`;
}

function providerDisplay(provider: {
  provider: string;
  role: string;
  label: string | null;
}) {
  return `${provider.provider} / ${provider.role}${provider.label ? `:${provider.label}` : ''}`;
}

function renderTable(providers: UsageAggregateProviderSummary[]) {
  if (providers.length === 0) {
    return ['No provider usage events recorded.'];
  }

  return [
    '| Provider / role | Turns | Input | Cached | Cache write | Cache read | Output | Reasoning | Total | Cost |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...providers.map((provider) => {
      const usage = provider.usage;
      return `| ${providerDisplay(provider)} | ${provider.turns} | ${formatNumber(usage.inputTokens)} | ${formatNumber(usage.cachedInputTokens)} | ${formatNumber(usage.cacheCreationInputTokens)} | ${formatNumber(usage.cacheReadInputTokens)} | ${formatNumber(usage.outputTokens)} | ${formatNumber(usage.reasoningOutputTokens)} | ${formatNumber(effectiveTotalTokens(usage))} | ${formatCost(provider.costUsd, provider.costSource, provider.costCoverage)} |`;
    }),
  ];
}

function renderCostSummary(summary: UsageAggregateSummary) {
  if (summary.totalCostUsd === null || summary.costCoverage === 'none') {
    return 'Estimated cost: unknown';
  }
  if (summary.costCoverage === 'partial') {
    return `Estimated cost (partial, ${summary.pricedUsageSegments}/${summary.usageSegments} usage buckets priced): $${summary.totalCostUsd.toFixed(4)}`;
  }
  return `Estimated cost: $${summary.totalCostUsd.toFixed(4)}`;
}

function displayPath(cwd: string, path: string) {
  if (!isAbsolute(path)) {
    return path;
  }
  const rel = relative(cwd, path);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : path;
}

export function renderHumanRunUsage(snapshot: NealRunUsageSnapshot) {
  const aggregate = aggregateUsageMetrics([snapshot.metrics]);
  const lines = [
    '# Neal Usage',
    '',
    `Run: ${snapshot.runId}`,
    `Plan: ${displayPath(snapshot.cwd, snapshot.planDoc)}`,
    `Mode: ${snapshot.topLevelMode}${snapshot.executionProfile === 'shadow' ? ' (shadow)' : ''}`,
    `Status: ${snapshot.status} / ${snapshot.phase}`,
    renderCostSummary(aggregate),
    '',
    ...renderTable(aggregate.providers),
  ];

  if (aggregate.providers.some((provider) => provider.costSource === 'rate' || provider.costSource === 'mixed')) {
    lines.push('', '* Rate-estimated cost; provider billing remains authoritative.');
  }
  if (aggregate.providers.some((provider) => provider.costSource === 'mixed')) {
    lines.push('† Mixed provider-reported and rate-estimated cost sources.');
  }
  if (snapshot.events.malformedLines > 0) {
    lines.push('', `Warning: ignored ${snapshot.events.malformedLines} malformed events.ndjson line(s).`);
  }

  return lines.join('\n');
}

export function renderHumanAllUsage(snapshot: NealAllUsageSnapshot) {
  const lines = [
    '# Neal Usage',
    '',
    `Runs: ${snapshot.runCount}`,
    renderCostSummary(snapshot.totals),
    '',
    ...renderTable(snapshot.totals.providers),
  ];

  if (snapshot.totals.providers.some((provider) => provider.costSource === 'rate' || provider.costSource === 'mixed')) {
    lines.push('', '* Rate-estimated cost; provider billing remains authoritative.');
  }
  if (snapshot.totals.providers.some((provider) => provider.costSource === 'mixed')) {
    lines.push('† Mixed provider-reported and rate-estimated cost sources.');
  }
  const malformed = snapshot.runs.reduce((sum, run) => sum + run.events.malformedLines, 0);
  if (malformed > 0) {
    lines.push('', `Warning: ignored ${malformed} malformed events.ndjson line(s) across selected runs.`);
  }

  return lines.join('\n');
}
