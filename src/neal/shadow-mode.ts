import type { CoderRunPromptArgs } from './providers/types.js';
import type { ExecutionProfile } from './types.js';

export function getExecutionCoderToolPolicy(
  executionProfile: ExecutionProfile,
): CoderRunPromptArgs['toolPolicy'] | undefined {
  return executionProfile === 'shadow' ? { allowRun: false } : undefined;
}

export function applyExecutionProfilePrompt(prompt: string, executionProfile: ExecutionProfile): string {
  if (executionProfile !== 'shadow') {
    return prompt;
  }

  return [
    prompt,
    '',
    'Shadow mode constraints:',
    '- Shell/command execution is mechanically disabled for this turn.',
    '- You may inspect and edit files in the checkout using non-shell tools.',
    '- Do not run or claim to have run tests, builds, linters, migrations, executables, services, or runtime checks.',
    '- Do not claim runtime verification passed. State plainly when verification was not run.',
    '- Missing runtime evidence is expected in Shadow mode and is not, by itself, a blocker to completing the static implementation.',
    '- Runtime verification happens later in the private source tree after static review.',
  ].join('\n');
}
