import { createNextScopeEntryReset } from './orchestrator/transitions.js';
import type { CoderRunPromptArgs } from './providers/types.js';
import { shouldAdvanceTopLevelScopeNumber } from './scopes.js';
import type { ExecutionProfile, OrchestrationState, ShadowExecutionPolicy } from './types.js';

export function getExecutionCoderToolPolicy(
  executionProfile: ExecutionProfile,
  shadowExecutionPolicy: ShadowExecutionPolicy = 'strict',
  allowedVerificationCommands: readonly string[] = [],
): CoderRunPromptArgs['toolPolicy'] | undefined {
  if (executionProfile !== 'shadow') {
    return undefined;
  }

  if (shadowExecutionPolicy === 'verify' && allowedVerificationCommands.length > 0) {
    return {
      allowRun: true,
      allowedRunCommands: [...allowedVerificationCommands],
    };
  }

  return { allowRun: false };
}

export function applyExecutionProfilePrompt(
  prompt: string,
  executionProfile: ExecutionProfile,
  shadowExecutionPolicy: ShadowExecutionPolicy = 'strict',
  allowedVerificationCommands: readonly string[] = [],
): string {
  if (executionProfile !== 'shadow') {
    return prompt;
  }

  if (shadowExecutionPolicy === 'verify') {
    const commandLines = allowedVerificationCommands.length > 0
      ? [
          '- You may run only these Neal-approved current-scope verification commands, exactly as written:',
          ...allowedVerificationCommands.map((command) => `  - \`${command}\``),
        ]
      : ['- No current-scope verification command was approved, so shell/command execution remains unavailable.'];

    return [
      prompt,
      '',
      'Shadow mode constraints (verify policy):',
      '- Arbitrary shell execution is mechanically restricted. You may inspect and edit files in the checkout using the normal jailed tools.',
      ...commandLines,
      '- Do not start applications, servers, watchers, containers, migrations, deploys, network probes, or other live/runtime services.',
      '- Do not claim private runtime verification passed. Distinguish any local verification that actually ran from private/live validation that did not.',
      '- Missing private runtime evidence is expected in Shadow mode and is not, by itself, a blocker to completing the static implementation.',
      '- Do not create a manual gate solely because private/live runtime evidence is unavailable in the Shadow checkout; that evidence belongs to the later private-validation gate.',
    ].join('\n');
  }

  return [
    prompt,
    '',
    'Shadow mode constraints (strict policy):',
    '- Shell/command execution is mechanically disabled for this turn.',
    '- You may inspect and edit files in the checkout using non-shell tools.',
    '- Do not run or claim to have run tests, builds, linters, migrations, executables, services, or runtime checks.',
    '- Do not claim runtime verification passed. State plainly when verification was not run.',
    '- Missing runtime evidence is expected in Shadow mode and is not, by itself, a blocker to completing the static implementation.',
    '- Runtime verification happens later in the private source tree after static review.',
  ].join('\n');
}



export function applyReviewerExecutionProfilePrompt(
  prompt: string,
  executionProfile: ExecutionProfile,
): string {
  if (executionProfile !== 'shadow') {
    return prompt;
  }

  return [
    prompt,
    '',
    'Shadow review constraints:',
    '- Shadow mode is active. Review the implementation statically and use any verification evidence that actually exists, but treat private/live runtime validation as a later explicit gate.',
    '- The absence of evidence that requires a private dependency tree, live application server, credentials, database, external store, network access, or other unavailable runtime state is not by itself a blocking finding in this scope review.',
    '- Do not require the coder to open a manual gate solely to obtain private/live runtime evidence. If the implementation is statically correct, leave that evidence for Shadow private validation after static acceptance.',
    '- Static correctness defects, missing implementation, unsafe code, and verification tooling or test gaps that are visible in the repository remain ordinary review findings and may still block.',
    '- Do not use meaningfulProgressAction=block_for_operator solely because private/live runtime evidence is pending.',
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
