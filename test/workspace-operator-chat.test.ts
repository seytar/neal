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
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
});
