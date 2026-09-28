import test from 'node:test';
import assert from 'node:assert/strict';

import {
  clampSidebarWidth,
  issueLane,
  studioIssueVisualState,
  studioSidebarStorageKey,
} from '../ui/src/studio-model.js';

test('Studio sidebar width clamps to supported bounds', () => {
  assert.equal(clampSidebarWidth(120), 280);
  assert.equal(clampSidebarWidth(420), 420);
  assert.equal(clampSidebarWidth(900), 560);
});

test('Studio sidebar persistence is scoped to the workspace', () => {
  assert.equal(
    studioSidebarStorageKey('/tmp/project-a'),
    'neal.studio.sidebarWidth:/tmp/project-a',
  );
  assert.notEqual(
    studioSidebarStorageKey('/tmp/project-a'),
    studioSidebarStorageKey('/tmp/project-b'),
  );
});

test('Studio issue lane projects planning and ready states from planner runs', () => {
  assert.equal(
    issueLane({ topLevelMode: 'plan', status: 'running', uiLane: 'running' }),
    'planning',
  );
  assert.equal(
    issueLane({ topLevelMode: 'plan', status: 'done', uiLane: 'done' }),
    'ready',
  );
  assert.equal(
    issueLane({ topLevelMode: 'execute', status: 'done', uiLane: 'done' }),
    'done',
  );
});

test('Studio visual hierarchy keeps latest and attention issues prominent', () => {
  const latestDone = studioIssueVisualState({
    processed: true,
    readyWithoutRun: false,
    currentRun: { topLevelMode: 'execute', status: 'done', uiLane: 'done' },
  }, 0);
  assert.equal(latestDone.latest, true);
  assert.equal(latestDone.passive, false);
  assert.match(latestDone.className, /latest/);

  const oldDone = studioIssueVisualState({
    processed: true,
    readyWithoutRun: false,
    currentRun: { topLevelMode: 'execute', status: 'done', uiLane: 'done' },
  }, 3);
  assert.equal(oldDone.passive, true);

  const oldReady = studioIssueVisualState({
    processed: false,
    readyWithoutRun: true,
    currentRun: null,
  }, 2);
  assert.equal(oldReady.lane, 'ready');
  assert.equal(oldReady.passive, true);

  const oldFailed = studioIssueVisualState({
    processed: true,
    readyWithoutRun: false,
    currentRun: { topLevelMode: 'execute', status: 'failed', uiLane: 'failed' },
  }, 5);
  assert.equal(oldFailed.attention, true);
  assert.equal(oldFailed.passive, false);

  const oldUnprocessed = studioIssueVisualState({
    processed: false,
    readyWithoutRun: false,
    currentRun: null,
  }, 6);
  assert.equal(oldUnprocessed.lane, 'unprocessed');
  assert.equal(oldUnprocessed.passive, false);
});

test('Studio visual state marks the selected issue active without changing its lane', () => {
  const visual = studioIssueVisualState({
    active: true,
    processed: true,
    readyWithoutRun: false,
    currentRun: { topLevelMode: 'execute', status: 'running', uiLane: 'running' },
  }, 1);

  assert.equal(visual.lane, 'running');
  assert.equal(visual.passive, false);
  assert.match(visual.className, /active/);
  assert.match(visual.className, /status-running/);
});
