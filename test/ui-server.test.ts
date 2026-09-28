import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve as resolvePath } from 'node:path';

import {
  classifyUiRun,
  getUiIssueTitleFromPlanContent,
  resolveUiIssuesPath,
} from '../src/neal/ui-server.js';

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
