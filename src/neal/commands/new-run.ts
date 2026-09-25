import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';

import { parseNewRunArgs } from '../cli.js';
import { assertWriterProvidersConfigured } from '../config.js';
import { assertGitRepositoryWithCommit } from '../git.js';
import { loadOrInitialize } from '../orchestrator.js';
import { assertAgentConfigSupportsShadowRun, assertAgentConfigSupportsWriterRun } from '../providers/registry.js';
import type { AgentConfig, ExecutionProfile } from '../types.js';
import { executeRun, withPreparedWriterRun } from './runtime.js';
import { getExecuteRunResultExitCode, setWriterCommandExitCode } from './writer-exit-codes.js';

const PARSE_ONLY_AGENT_CONFIG: AgentConfig = {
  planner: {
    provider: 'openai-codex',
    model: null,
  },
  coder: {
    provider: 'openai-codex',
    model: null,
  },
  reviewer: {
    provider: 'anthropic-claude',
    model: null,
  },
};

export type NewRunCommandOptions = {
  executionProfile?: ExecutionProfile;
};

export async function runNewRunCommand(args: string[], options: NewRunCommandOptions = {}): Promise<void> {
  const parsedArgs = parseNewRunArgs(args, PARSE_ONLY_AGENT_CONFIG);
  const executionProfile = options.executionProfile ?? 'normal';
  const cwd = process.cwd();
  const agentConfig = assertWriterProvidersConfigured(cwd, {
    context: `new ${parsedArgs.topLevelMode} writer run`,
  });
  const parsed = {
    ...parsedArgs,
    agentConfig,
  };
  if (executionProfile === 'shadow') {
    if (parsed.topLevelMode !== 'execute') {
      throw new Error('Shadow mode currently supports execute runs only.');
    }
    assertAgentConfigSupportsShadowRun(parsed.agentConfig, { context: 'new shadow execute writer run' });
  } else {
    assertAgentConfigSupportsWriterRun(parsed.agentConfig, { context: `new ${parsed.topLevelMode} writer run` });
  }

  const planDoc = resolve(cwd, parsed.planDoc);
  await assertGitRepositoryWithCommit(cwd, `neal ${parsed.topLevelMode}`);
  await requireExistingPlanFile(planDoc, parsed.planDoc);
  const result = await withPreparedWriterRun(
    {
      cwd,
      topLevelMode: parsed.topLevelMode,
      getLockPlanDoc: () => planDoc,
    },
    async (prepared, markInitialized) => {
      const loaded = await loadOrInitialize(planDoc, cwd, parsed.agentConfig, undefined, parsed.topLevelMode, {
        allowedDirtyPaths: parsed.topLevelMode === 'execute' ? [planDoc] : [],
        runDir: prepared.runDir,
        executionProfile,
        // Preserve generated commits until private validation is explicitly accepted.
        autoSquashOnCompletion: executionProfile === 'shadow' ? false : parsed.squashOnCompletion,
      });
      markInitialized();
      if (loaded.state.executionProfile === 'shadow') {
        assertAgentConfigSupportsShadowRun(loaded.state.agentConfig, { context: 'new shadow execute writer run' });
      } else {
        assertAgentConfigSupportsWriterRun(loaded.state.agentConfig, { context: `new ${loaded.state.topLevelMode} writer run` });
      }
      return executeRun(loaded.state, loaded.statePath, loaded.logger, {
        // The `--no-squash` flag only seeds the run state; once persisted, the
        // state is the single source of truth so `neal resume` sees the same
        // preference this process does.
        autoSquashOnCompletion: loaded.state.autoSquashOnCompletion,
      });
    },
  );
  setWriterCommandExitCode(getExecuteRunResultExitCode(result));
}

async function requireExistingPlanFile(planDoc: string, displayPath: string): Promise<void> {
  let planStat;
  try {
    planStat = await stat(planDoc);
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      throw new Error(`Plan file does not exist: ${displayPath}`);
    }
    throw error;
  }

  if (!planStat.isFile()) {
    throw new Error(`Plan path is not a file: ${displayPath}`);
  }
}
