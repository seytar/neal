import { createNextScopeEntryReset } from './orchestrator/transitions.js';
import type { CoderRunPromptArgs } from './providers/types.js';
import { shouldAdvanceTopLevelScopeNumber } from './scopes.js';
import type { ExecutionProfile, OrchestrationState } from './types.js';

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


export function reopenShadowRunFromPrivateFeedback(
  state: OrchestrationState,
  feedback: string,
  feedbackPath: string,
): OrchestrationState {
  const feedbackNumber = state.privateValidationFeedbackCount + 1;
  return {
    ...state,
    ...createNextScopeEntryReset(state.finalCommit),
    currentScopeNumber: shouldAdvanceTopLevelScopeNumber(state)
      ? state.currentScopeNumber + 1
      : state.currentScopeNumber,
    coderRetryCount: 0,
    splitPlanCountForCurrentScope: 0,
    finalCompletionReviewVerdict: {
      action: 'continue_execution',
      summary: 'Private validation reported a failure that requires corrective work.',
      rationale: 'The operator supplied sanitized evidence from private validation after static acceptance.',
      missingWork: {
        summary: feedback,
        requiredOutcome: 'Resolve the sanitized private-validation failure without assuming access to the private source tree.',
        verification: 'Return to static acceptance, then require the operator to run private validation again.',
      },
      squashCommitMessage: null,
    },
    finalCompletionResolvedAction: 'continue_execution',
    finalCompletionContinueExecutionCapReached: false,
    privateValidationAcceptedAt: null,
    privateValidationNote: null,
    privateValidationFeedbackCount: feedbackNumber,
    privateValidationFeedbackPath: feedbackPath,
    blockedFromPhase: null,
    blockerReason: null,
  };
}

export function acceptShadowPrivateValidation(
  state: OrchestrationState,
  note: string | null,
  acceptedAt: string,
): OrchestrationState {
  return {
    ...state,
    phase: 'done',
    status: 'done',
    privateValidationAcceptedAt: acceptedAt,
    privateValidationNote: note,
  };
}
