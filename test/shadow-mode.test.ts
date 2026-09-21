import test from 'node:test';
import assert from 'node:assert/strict';

import { assertAgentConfigSupportsShadowRun } from '../src/neal/providers/registry.js';
import { applyExecutionProfilePrompt, getExecutionCoderToolPolicy } from '../src/neal/shadow-mode.js';

test('shadow profile mechanically disables coder shell while normal mode is unchanged', () => {
  assert.equal(getExecutionCoderToolPolicy('normal'), undefined);
  assert.deepEqual(getExecutionCoderToolPolicy('shadow'), { allowRun: false });
  assert.equal(applyExecutionProfilePrompt('implement', 'normal'), 'implement');
  const shadow = applyExecutionProfilePrompt('implement', 'shadow');
  assert.match(shadow, /Shell\/command execution is mechanically disabled/);
  assert.match(shadow, /Do not claim runtime verification passed/);
});

test('shadow capability accepts shell-disable coders and rejects Codex coder', () => {
  assert.doesNotThrow(() => assertAgentConfigSupportsShadowRun({
    planner: { provider: 'anthropic-claude', model: null },
    coder: { provider: 'openai-compatible', model: null },
    reviewer: { provider: 'openai-codex', model: null },
  }));

  assert.throws(() => assertAgentConfigSupportsShadowRun({
    planner: { provider: 'anthropic-claude', model: null },
    coder: { provider: 'openai-codex', model: null },
    reviewer: { provider: 'anthropic-claude', model: null },
  }), /missing shell disable/);
});
