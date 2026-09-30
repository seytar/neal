import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  readWorkspaceChatHistory,
  validateWorkspaceChatReply,
  type WorkspaceChatReply,
} from '../src/neal/workspace-operator-chat.js';

const baseReply: WorkspaceChatReply = {
  answer: 'One run needs your attention first.',
  observation: 'run-2 is action-required while run-1 is still running normally.',
  attention: 'action_needed',
  recommendation: 'focus_run',
  recommendationReason: 'run-2 has an operator-facing next action.',
  decisionOptions: ['Open run-2', 'Inspect the workspace summary first'],
  focusRunIds: ['run-2'],
  taskProposal: null,
};

test('workspace chat validates decision support and known focus runs', () => {
  assert.deepEqual(
    validateWorkspaceChatReply(baseReply, new Set(['run-1', 'run-2'])),
    baseReply,
  );

  assert.throws(
    () => validateWorkspaceChatReply(
      { ...baseReply, focusRunIds: ['missing-run'] },
      new Set(['run-1', 'run-2']),
    ),
    /unknown run id/,
  );

  assert.throws(
    () => validateWorkspaceChatReply({
      ...baseReply,
      recommendation: 'focus_run',
      focusRunIds: [],
    }),
    /requires at least one focusRunId/,
  );

  assert.throws(
    () => validateWorkspaceChatReply({
      ...baseReply,
      decisionOptions: ['same', 'same'],
    }),
    /decisionOptions/,
  );
});

test('workspace chat history is workspace-scoped and sanitizes legacy or tampered fields', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'neal-workspace-chat-'));
  try {
    const nealDir = join(cwd, '.neal');
    await mkdir(nealDir, { recursive: true });
    await writeFile(
      join(nealDir, 'STUDIO_OPERATOR_CHAT.ndjson'),
      [
        JSON.stringify({
          id: 'u1',
          ts: '2026-09-30T00:00:00.000Z',
          role: 'user',
          text: 'What needs my attention?',
        }),
        '{bad-json',
        JSON.stringify({
          id: 'a1',
          ts: '2026-09-30T00:00:01.000Z',
          role: 'assistant',
          text: 'Focus on run-2.',
          observation: 'run-2 is waiting.',
          attention: 'action_needed',
          recommendation: 'focus_run',
          recommendationReason: 'It needs operator input.',
          decisionOptions: ['Open run-2'],
          focusRunIds: ['run-2'],
          taskProposal: null,
        }),
        JSON.stringify({
          id: 'a2',
          ts: '2026-09-30T00:00:02.000Z',
          role: 'assistant',
          text: 'Tampered.',
          attention: 'panic',
          recommendation: 'delete_everything',
          decisionOptions: ['A', 'A', '', 7],
          focusRunIds: ['run-9', 'run-9'],
          taskProposal: { title: '', description: '', preferredExecutionMode: 'bad' },
        }),
        '',
      ].join('\n'),
      'utf8',
    );

    const history = await readWorkspaceChatHistory(cwd);
    assert.equal(history.truncated, false);
    assert.deepEqual(history.messages.map((message) => message.id), ['u1', 'a1', 'a2']);
    assert.deepEqual(history.messages[2], {
      id: 'a2',
      ts: '2026-09-30T00:00:02.000Z',
      role: 'assistant',
      text: 'Tampered.',
      observation: null,
      attention: 'normal',
      recommendation: 'none',
      recommendationReason: null,
      decisionOptions: ['A'],
      focusRunIds: ['run-9'],
      taskProposal: null,
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});


test('workspace chat validates new task proposals separately from execution', () => {
  const proposal = {
    ...baseReply,
    attention: 'decision_needed' as const,
    recommendation: 'create_task' as const,
    recommendationReason: 'The task is concrete enough to hand to the planner.',
    decisionOptions: ['Create and plan', 'Edit the draft first'],
    focusRunIds: [],
    taskProposal: {
      title: 'Add map clustering',
      description: 'Add client-side clustering while preserving the existing map workflow.',
      preferredExecutionMode: 'shadow' as const,
    },
  };

  assert.deepEqual(validateWorkspaceChatReply(proposal), proposal);

  assert.throws(
    () => validateWorkspaceChatReply({ ...proposal, taskProposal: null }),
    /create_task recommendation requires taskProposal/,
  );

  assert.throws(
    () => validateWorkspaceChatReply({
      ...baseReply,
      taskProposal: proposal.taskProposal,
    }),
    /taskProposal is only allowed with create_task recommendation/,
  );

  assert.throws(
    () => validateWorkspaceChatReply({
      ...proposal,
      taskProposal: { ...proposal.taskProposal, preferredExecutionMode: 'unsafe' },
    }),
    /taskProposal is invalid/,
  );
});
