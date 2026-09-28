import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve as resolvePath } from 'node:path';

import {
  artifactPathFor,
  classifyUiRun,
  getUiIssueTitleFromPlanContent,
  resolveUiIssuesPath,
} from '../src/neal/ui-server.js';
import type { NealStatusSnapshot } from '../src/neal/status.js';

const base = {
  phase: 'coder_scope' as const,
  status: 'running' as const,
  effectiveStatus: 'running' as const,
  waitingForOperatorGuidance: false,
  pendingOperatorGuidance: false,
  manualGate: null,
};

test('UI lane highlights Shadow private validation separately', () => {
  assert.equal(
    classifyUiRun({
      ...base,
      phase: 'awaiting_private_validation',
      status: 'paused',
      effectiveStatus: 'paused',
    }),
    'private_validation',
  );
});

test('UI lane highlights operator guidance and manual gates', () => {
  assert.equal(
    classifyUiRun({
      ...base,
      status: 'blocked',
      effectiveStatus: 'waiting_for_operator',
      waitingForOperatorGuidance: true,
    }),
    'needs_you',
  );

  assert.equal(
    classifyUiRun({
      ...base,
      phase: 'manual_gate',
      status: 'blocked',
      effectiveStatus: 'waiting_for_manual_gate',
      manualGate: {
        id: 'gate-1',
        title: 'Approve deployment',
        reason: 'Operator approval is required.',
        instructionsPath: '/tmp/GATE-gate-1.md',
        lastCheckedAt: null,
        lastFailure: null,
        resumeCommand: 'neal resume --run run-1',
      },
    }),
    'needs_you',
  );
});

test('UI lane treats resumable pauses as operator work and terminal states distinctly', () => {
  assert.equal(
    classifyUiRun({
      ...base,
      status: 'paused',
      effectiveStatus: 'paused',
    }),
    'needs_you',
  );

  assert.equal(
    classifyUiRun({
      ...base,
      status: 'failed',
      effectiveStatus: 'failed',
    }),
    'failed',
  );

  assert.equal(
    classifyUiRun({
      ...base,
      phase: 'done',
      status: 'done',
      effectiveStatus: 'done',
    }),
    'done',
  );

  assert.equal(classifyUiRun(base), 'running');
});


test('UI issue titles come from the first Markdown H1', () => {
  assert.equal(
    getUiIssueTitleFromPlanContent([
      '# Issue 27 location log verification',
      '',
      '## Objective',
      '',
      'Keep the existing backend behavior.',
    ].join('\n')),
    'Issue 27 location log verification',
  );

  assert.equal(getUiIssueTitleFromPlanContent('## Objective\n\nNo H1 here.'), null);
});


test('UI issues path is repository-relative and cannot escape the checkout', () => {
  const cwd = '/tmp/neal-ui-workspace';
  assert.deepEqual(
    resolveUiIssuesPath(cwd, 'documentation/issues'),
    {
      root: resolvePath(cwd, 'documentation/issues'),
      displayPath: 'documentation/issues',
    },
  );

  assert.throws(
    () => resolveUiIssuesPath(cwd, '../outside'),
    /inside the repository root/,
  );
  assert.throws(
    () => resolveUiIssuesPath(cwd, '/tmp/outside'),
    /relative to the repository root/,
  );
});


test('Studio maps Original and Plan to distinct artifacts without legacy fallback', () => {
  const status = {
    planDoc: '/repo/current-plan.md',
    artifacts: {
      originalPlanPath: '/repo/.neal/runs/run-1/PLAN_ORIGINAL.md',
      progressMarkdownPath: '/repo/.neal/runs/run-1/PLAN_PROGRESS.md',
      reviewMarkdownPath: '/repo/.neal/runs/run-1/REVIEW.md',
      recoveryMarkdownPath: '/repo/.neal/runs/run-1/RECOVERY.md',
      runNarrativeMarkdownPath: '/repo/.neal/runs/run-1/RUN_NARRATIVE.md',
    },
    manualGate: null,
  } as unknown as NealStatusSnapshot;

  assert.equal(
    artifactPathFor(status, 'original'),
    '/repo/.neal/runs/run-1/PLAN_ORIGINAL.md',
  );
  assert.equal(artifactPathFor(status, 'plan'), '/repo/current-plan.md');

  const legacyStatus = {
    ...status,
    artifacts: {
      ...status.artifacts,
      originalPlanPath: null,
    },
  } as NealStatusSnapshot;

  assert.equal(artifactPathFor(legacyStatus, 'original'), null);
  assert.equal(artifactPathFor(legacyStatus, 'plan'), '/repo/current-plan.md');
});
