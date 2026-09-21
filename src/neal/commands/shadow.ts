import process from 'node:process';

import { writeExecutionArtifacts } from '../orchestrator/artifacts.js';
import { writeCheckpointRetrospective } from '../retrospective.js';
import { acquireActiveRunLock } from '../run-lock.js';
import { saveState } from '../state.js';
import { runNewRunCommand } from './new-run.js';
import { resolveWriterRunSelection, withActiveRunLock } from './runtime.js';

type ShadowAcceptArgs = { runId: string | null; note: string | null };

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
    case 'accept':
      await acceptPrivateValidation(args);
      return;
    default:
      throw new Error('Usage: neal shadow execute <plan.md> [--no-squash] | neal shadow accept [--run <run-id>] [--note "..."]');
  }
}
