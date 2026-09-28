import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  assertAgentConfigSupportsShadowRun,
  assertAgentConfigSupportsWriterRun,
} from '../src/neal/providers/registry.js';
import {
  acceptShadowPrivateValidation,
  applyExecutionProfilePrompt,
  applyShadowCompletionSummaryPrompt,
  getExecutionCoderToolPolicy,
  reopenShadowRunFromPrivateFeedback,
} from '../src/neal/shadow-mode.js';
import { createInitialState } from '../src/neal/state.js';

test('shadow profile mechanically disables coder shell while normal mode is unchanged', () => {
  assert.equal(getExecutionCoderToolPolicy('normal'), undefined);
  assert.deepEqual(getExecutionCoderToolPolicy('shadow'), { allowRun: false });
  assert.equal(applyExecutionProfilePrompt('implement', 'normal'), 'implement');
  const shadow = applyExecutionProfilePrompt('implement', 'shadow');
  assert.match(shadow, /Shell\/command execution is mechanically disabled/);
  assert.match(shadow, /Do not claim runtime verification passed/);
});

test('Shadow completion summary overlay keeps local verification truthful', () => {
  const canonical = [
    'before',
    'Shadow mode is active: shell execution was intentionally disabled during implementation.',
    'Judge planGoalSatisfied by static implementation completeness. Private runtime validation is a later explicit gate.',
    'The absence of runtime/build/test command evidence is expected in Shadow mode and must not by itself become a remainingKnownGap.',
    'State clearly in verificationSummary that runtime verification was not run in Neal.',
    'after',
  ].join('\n');

  assert.equal(applyShadowCompletionSummaryPrompt(canonical, 'normal'), canonical);
  const shadow = applyShadowCompletionSummaryPrompt(canonical, 'shadow');
  assert.match(shadow, /local verification commands that actually ran/);
  assert.match(shadow, /private\/live runtime validation that is still pending/);
  assert.doesNotMatch(shadow, /runtime verification was not run in Neal/);
});

test('Shadow verify exposes only Neal-approved verification commands', () => {
  const commands = ['pnpm test', 'php -l app/Foo.php'];
  assert.deepEqual(getExecutionCoderToolPolicy('shadow', 'verify', commands), {
    allowRun: true,
    allowedRunCommands: commands,
  });
  assert.deepEqual(getExecutionCoderToolPolicy('shadow', 'verify', []), { allowRun: false });

  const prompt = applyExecutionProfilePrompt('implement', 'shadow', 'verify', commands);
  assert.match(prompt, /verify policy/);
  assert.match(prompt, /pnpm test/);
  assert.match(prompt, /php -l app\/Foo\.php/);
  assert.match(prompt, /Do not start applications, servers, watchers/);
  assert.match(prompt, /Do not create a manual gate solely because private\/live runtime evidence is unavailable/);
});

test('Shadow does not pin planner or reviewer providers', () => {
  const planners = ['openai-codex', 'anthropic-claude', 'openai-compatible'] as const;
  const reviewers = ['openai-codex', 'anthropic-claude', 'openai-compatible'] as const;

  for (const planner of planners) {
    assert.doesNotThrow(() => assertAgentConfigSupportsShadowRun({
      planner: { provider: planner, model: null },
      coder: { provider: 'openai-compatible', model: null },
      reviewer: { provider: 'openai-codex', model: null },
    }));
  }

  for (const reviewer of reviewers) {
    assert.doesNotThrow(() => assertAgentConfigSupportsShadowRun({
      planner: { provider: 'openai-codex', model: null },
      coder: { provider: 'anthropic-claude', model: null },
      reviewer: { provider: reviewer, model: null },
    }));
  }
});

test('normal writer mode keeps providers that are not Shadow-shell-disable capable', () => {
  const config = {
    planner: { provider: 'openai-codex' as const, model: null },
    coder: { provider: 'openai-codex' as const, model: null },
    reviewer: { provider: 'anthropic-claude' as const, model: null },
  };

  assert.doesNotThrow(() => assertAgentConfigSupportsWriterRun(config));
  assert.throws(() => assertAgentConfigSupportsShadowRun(config), /missing shell disable/);
});

test('shadow capability accepts shell-disable coders and rejects Codex coder', () => {
  assert.doesNotThrow(() => assertAgentConfigSupportsShadowRun({
    planner: { provider: 'anthropic-claude', model: null },
    coder: { provider: 'openai-compatible', model: null },
    reviewer: { provider: 'openai-codex', model: null },
  }));

  // Shadow mode is capability-driven, not provider-name-driven. Claude also
  // mechanically removes Bash when allowRun:false, so it remains a valid coder.
  assert.doesNotThrow(() => assertAgentConfigSupportsShadowRun({
    planner: { provider: 'anthropic-claude', model: null },
    coder: { provider: 'anthropic-claude', model: null },
    reviewer: { provider: 'openai-codex', model: null },
  }));

  assert.throws(() => assertAgentConfigSupportsShadowRun({
    planner: { provider: 'anthropic-claude', model: null },
    coder: { provider: 'openai-codex', model: null },
    reviewer: { provider: 'anthropic-claude', model: null },
  }), /missing shell disable/);
});


async function createShadowWaitingState() {
  const cwd = await mkdtemp(join(tmpdir(), 'neal-shadow-mode-'));
  const runDir = join(cwd, '.neal', 'runs', 'shadow-run');
  const state = await createInitialState(
    {
      cwd,
      planDoc: join(cwd, 'PLAN.md'),
      stateDir: join(cwd, '.neal'),
      runDir,
      topLevelMode: 'execute',
      executionProfile: 'shadow',
      allowedDirtyPaths: [],
      agentConfig: {
        planner: { provider: 'anthropic-claude', model: null },
        coder: { provider: 'openai-compatible', model: null },
        reviewer: { provider: 'openai-codex', model: null },
      },
      progressJsonPath: join(runDir, 'plan-progress.json'),
      progressMarkdownPath: join(runDir, 'PLAN_PROGRESS.md'),
      reviewMarkdownPath: join(runDir, 'REVIEW.md'),
      recoveryMarkdownPath: join(runDir, 'RECOVERY.md'),
      maxRounds: 5,
    },
    '1111111111111111111111111111111111111111',
  );
  assert.equal(state.shadowExecutionPolicy, 'verify');

  return {
    ...state,
    phase: 'awaiting_private_validation' as const,
    status: 'paused' as const,
    finalCommit: '2222222222222222222222222222222222222222',
    finalCompletionResolvedAction: 'accept_complete' as const,
  };
}

test('private feedback reopens the same Shadow run as corrective work', async () => {
  const state = await createShadowWaitingState();
  const next = reopenShadowRunFromPrivateFeedback(
    state,
    'targeted private test failed: expected retry, observed early return',
    join(state.runDir, 'PRIVATE_VALIDATION_FEEDBACK-1.md'),
  );

  assert.equal(next.executionProfile, 'shadow');
  assert.equal(next.phase, 'coder_scope');
  assert.equal(next.status, 'running');
  assert.equal(next.baseCommit, state.finalCommit);
  assert.equal(next.privateValidationFeedbackCount, 1);
  assert.match(next.privateValidationFeedbackPath ?? '', /PRIVATE_VALIDATION_FEEDBACK-1\.md$/);
  assert.equal(next.finalCompletionReviewVerdict?.action, 'continue_execution');
  assert.match(next.finalCompletionReviewVerdict?.missingWork?.summary ?? '', /private test failed/);
  assert.equal(next.finalCompletionResolvedAction, 'continue_execution');
  assert.equal(next.privateValidationAcceptedAt, null);
});

test('private acceptance is the only Shadow transition from static acceptance to done', async () => {
  const state = await createShadowWaitingState();
  const accepted = acceptShadowPrivateValidation(
    state,
    'private test suite passed',
    '2026-09-21T08:00:00.000Z',
  );

  assert.equal(accepted.phase, 'done');
  assert.equal(accepted.status, 'done');
  assert.equal(accepted.privateValidationAcceptedAt, '2026-09-21T08:00:00.000Z');
  assert.equal(accepted.privateValidationNote, 'private test suite passed');
});
