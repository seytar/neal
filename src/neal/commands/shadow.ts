import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';

import { writeTextAtomic } from '../atomic-write.js';
import { assertGitRepositoryWithCommit } from '../git.js';
import { RunLogger } from '../logger.js';
import { writeExecutionArtifacts } from '../orchestrator/artifacts.js';
import { createNextScopeEntryReset } from '../orchestrator/transitions.js';
import { assertAgentConfigSupportsShadowRun } from '../providers/registry.js';
import { writeCheckpointRetrospective } from '../retrospective.js';
import { acquireActiveRunLock } from '../run-lock.js';
import { shouldAdvanceTopLevelScopeNumber } from '../scopes.js';
import { saveState } from '../state.js';
import { runNewRunCommand } from './new-run.js';
import { executeRun, resolveWriterRunSelection, withActiveRunLock } from './runtime.js';
import { getExecuteRunResultExitCode, setWriterCommandExitCode } from './writer-exit-codes.js';

const MAX_PRIVATE_FEEDBACK_BYTES = 64 * 1024;

type ShadowAcceptArgs = { runId: string | null; note: string | null };
type ShadowFeedbackArgs = { runId: string | null; file: string | null };

function parseShadowAcceptArgs(args: string[]): ShadowAcceptArgs {
  let runId: string | null = null;
  let note: string | null = null;
  let index = 2;
  while (index < args.length) {
    const flag = args[index];
    if (flag === '--run') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('neal shadow accept --run requires a run id');
      runId = value;
      index += 2;
      continue;
    }
    if (flag === '--note') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) throw new Error('neal shadow accept --note requires text');
      note = value.trim() || null;
      index += 2;
      continue;
    }
    throw new Error(`Unsupported neal shadow accept argument: ${flag}`);
  }
  return { runId, note };
}

function parseShadowFeedbackArgs(args: string[]): ShadowFeedbackArgs {
  let runId: string | null = null;
  let file: string | null = null;
  let index = 2;
  while (index < args.length) {
    const flag = args[index];
    if (flag === '--run') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('neal shadow feedback --run requires a run id');
      runId = value;
      index += 2;
      continue;
    }
    if (flag === '--file') {
      const value = args[index + 1];
      if (!value || value.startsWith('--')) throw new Error('neal shadow feedback --file requires a path');
      file = value;
      index += 2;
      continue;
    }
    throw new Error(`Unsupported neal shadow feedback argument: ${flag}`);
  }
  if (!file) {
    throw new Error('Usage: neal shadow feedback --file <sanitized-feedback.txt> [--run <run-id>]');
  }
  return { runId, file };
}

async function readSanitizedPrivateFeedback(path: string) {
  const content = await readFile(path, 'utf8');
  if (!content.trim()) {
    throw new Error('Private validation feedback file is empty.');
  }
  if (Buffer.byteLength(content, 'utf8') > MAX_PRIVATE_FEEDBACK_BYTES) {
    throw new Error(`Private validation feedback exceeds ${MAX_PRIVATE_FEEDBACK_BYTES} bytes.`);
  }
  return content.trimEnd();
}

async function processPrivateValidationFeedback(args: string[]) {
  const parsed = parseShadowFeedbackArgs(args);
  const selection = await resolveWriterRunSelection({ runId: parsed.runId });
  const state = selection.state;
  if (state.executionProfile !== 'shadow') {
    throw new Error(`Run ${selection.selectedRunId} is not a Shadow mode run.`);
  }
  if (state.phase !== 'awaiting_private_validation' || state.status !== 'paused') {
    throw new Error(
      `Run ${selection.selectedRunId} is not waiting for private validation (phase=${state.phase}, status=${state.status}).`,
    );
  }

  await assertGitRepositoryWithCommit(state.cwd, 'neal shadow feedback');
  assertAgentConfigSupportsShadowRun(state.agentConfig, { context: 'shadow private-validation feedback' });
  const feedback = await readSanitizedPrivateFeedback(parsed.file!);
  const feedbackNumber = state.privateValidationFeedbackCount + 1;
  const feedbackPath = join(state.runDir, `PRIVATE_VALIDATION_FEEDBACK-${feedbackNumber}.md`);

  const lock = await acquireActiveRunLock({
    cwd: state.cwd,
    runId: selection.selectedRunId,
    runStatePath: selection.statePath,
    planDoc: state.planDoc,
    topLevelMode: state.topLevelMode,
  });
  if (!lock.acquired) {
    await lock.release();
    throw new Error(`Run ${selection.selectedRunId} is already active; cannot process private validation feedback concurrently.`);
  }

  await withActiveRunLock(lock, async () => {
    await writeTextAtomic(
      feedbackPath,
      [
        '# Sanitized Private Validation Feedback',
        '',
        '> Supplied by the operator. Neal does not sanitize this content.',
        '',
        feedback,
        '',
      ].join('\n'),
    );

    const reopened = await saveState(selection.statePath, {
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
    });

    await writeExecutionArtifacts(reopened);
    const logger = new RunLogger(state.runDir);
    await logger.event('shadow.private_validation_feedback', {
      feedbackNumber,
      feedbackPath,
      sourceFile: parsed.file,
      nextPhase: reopened.phase,
    });

    process.stdout.write(
      `[neal] Sanitized private-validation feedback recorded for run ${selection.selectedRunId}; reopening corrective Shadow work.\n`,
    );
    const result = await executeRun(reopened, selection.statePath, logger, {
      autoSquashOnCompletion: false,
    });
    setWriterCommandExitCode(getExecuteRunResultExitCode(result));
  });
}

async function acceptPrivateValidation(args: string[]) {
  const parsed = parseShadowAcceptArgs(args);
  const selection = await resolveWriterRunSelection({ runId: parsed.runId });
  const state = selection.state;
  if (state.executionProfile !== 'shadow') throw new Error(`Run ${selection.selectedRunId} is not a Shadow mode run.`);
  if (state.phase !== 'awaiting_private_validation' || state.status !== 'paused') {
    throw new Error(`Run ${selection.selectedRunId} is not waiting for private validation (phase=${state.phase}, status=${state.status}).`);
  }

  const lock = await acquireActiveRunLock({
    cwd: state.cwd,
    runId: selection.selectedRunId,
    runStatePath: selection.statePath,
    planDoc: state.planDoc,
    topLevelMode: state.topLevelMode,
  });
  if (!lock.acquired) {
    await lock.release();
    throw new Error(`Run ${selection.selectedRunId} is already active; cannot accept private validation concurrently.`);
  }

  await withActiveRunLock(lock, async () => {
    const accepted = await saveState(selection.statePath, {
      ...state,
      phase: 'done',
      status: 'done',
      privateValidationAcceptedAt: new Date().toISOString(),
      privateValidationNote: parsed.note,
    });
    await writeExecutionArtifacts(accepted);
    await writeCheckpointRetrospective(accepted, 'done');
    process.stdout.write(
      `[neal] Shadow private validation accepted for run ${selection.selectedRunId}.` +
        (parsed.note ? ` Note: ${parsed.note}` : '') + '\n',
    );
  });
}

export async function runShadowCommand(args: string[]): Promise<void> {
  if (args[0] !== 'shadow') throw new Error(`Unknown argument: ${args[0] ?? ''}`);
  switch (args[1]) {
    case 'execute':
      await runNewRunCommand(['execute', ...args.slice(2)], { executionProfile: 'shadow' });
      return;
    case 'feedback':
      await processPrivateValidationFeedback(args);
      return;
    case 'accept':
      await acceptPrivateValidation(args);
      return;
    default:
      throw new Error(
        'Usage: neal shadow execute <plan.md> [--no-squash] | ' +
          'neal shadow feedback --file <sanitized-feedback.txt> [--run <run-id>] | ' +
          'neal shadow accept [--run <run-id>] [--note "..."]',
      );
  }
}
