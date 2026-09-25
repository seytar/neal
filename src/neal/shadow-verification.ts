import { readFile } from 'node:fs/promises';

import { getCurrentExecutionScopeDescriptor } from './scopes.js';
import type { OrchestrationState } from './types.js';
import { isVerificationCommand } from './verification-events.js';

const MAX_VERIFICATION_COMMAND_CHARS = 1000;
const SHELL_CONTROL_PATTERN = /[\n\r;&|<>]|\$\(|\$\{|\x60/;
const SHELL_WRAPPER_PATTERN = /^(?:ba|z|fi|da)?sh\b|^cmd(?:\.exe)?\s+\/c\b|^powershell(?:\.exe)?\b|^pwsh\b/i;
const MUTATING_OR_RUNTIME_PATTERN =
  /\b(?:serve|server|start|dev|watch|migrate|migration|seed|deploy|publish|install|update|upgrade|docker|compose|kubectl|helm|curl|wget|ssh|scp|rsync|nc|netcat|sudo|su|rm|mv|cp|chmod|chown|kill|pkill|reboot|shutdown)\b/i;
const KNOWN_VERIFICATION_RUNNER_PATTERN =
  /(?:^|[\\/])(?:phpunit|pest|pytest|vitest|jest|eslint|biome|ruff|mypy|golangci-lint)(?:\s|$)|\b(?:cargo|go|pnpm|npm|yarn|bun|gradle|gradlew|mvn|dotnet)\s+(?:run\s+)?(?:test|tests|check|lint|typecheck|build|verify|validation)\b/i;
const PHP_LINT_PATTERN = /^php\s+-l\s+\S+/i;
const ARTISAN_ROUTE_LIST_PATTERN = /^php\s+artisan\s+route:list(?:\s|$)/i;

export function isSafeShadowVerificationCommand(command: string) {
  const normalized = command.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_VERIFICATION_COMMAND_CHARS ||
    SHELL_CONTROL_PATTERN.test(normalized) ||
    SHELL_WRAPPER_PATTERN.test(normalized) ||
    MUTATING_OR_RUNTIME_PATTERN.test(normalized)
  ) {
    return false;
  }

  return (
    isVerificationCommand(normalized) ||
    KNOWN_VERIFICATION_RUNNER_PATTERN.test(normalized) ||
    PHP_LINT_PATTERN.test(normalized) ||
    ARTISAN_ROUTE_LIST_PATTERN.test(normalized)
  );
}

function scopeBody(planDocument: string, planScopeNumber: number) {
  const lines = planDocument.split(/\r?\n/);
  const numberedStarts = lines
    .map((line, index) => {
      const match = line.trim().match(/^### Scope (\d+):/);
      return match ? { index, number: Number.parseInt(match[1] ?? '', 10) } : null;
    })
    .filter((entry): entry is { index: number; number: number } => entry !== null);

  if (numberedStarts.length > 0) {
    const targetIndex = numberedStarts.findIndex((entry) => entry.number === planScopeNumber);
    if (targetIndex === -1) {
      return '';
    }
    const start = numberedStarts[targetIndex]!.index + 1;
    const end = numberedStarts[targetIndex + 1]?.index ?? lines.length;
    return lines.slice(start, end).join('\n');
  }

  const recurring = lines.findIndex((line) => line.trim() === '### Recurring Scope');
  if (recurring >= 0) {
    const nextHeading = lines.findIndex(
      (line, index) => index > recurring && /^###\s+/.test(line.trim()),
    );
    return lines.slice(recurring + 1, nextHeading >= 0 ? nextHeading : lines.length).join('\n');
  }

  return planDocument;
}

function verificationText(scope: string) {
  const lines = scope.split(/\r?\n/);
  const parts: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const start = line.match(/^\s*-\s+Verification\s*:\s*(.*)$/i);
    if (start) {
      collecting = true;
      parts.push(start[1] ?? '');
      continue;
    }

    if (!collecting) {
      continue;
    }

    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed) || /^-\s+[^:]+\s*:/.test(trimmed)) {
      break;
    }
    parts.push(line);
  }

  return parts.join('\n');
}

export function extractShadowVerificationCommands(planDocument: string, planScopeNumber: number) {
  const text = verificationText(scopeBody(planDocument, planScopeNumber));
  const candidates: string[] = [];
  const inlineCodePattern = /`([^`\r\n]+)`/g;
  let match: RegExpExecArray | null;

  while ((match = inlineCodePattern.exec(text)) !== null) {
    candidates.push(match[1] ?? '');
  }

  if (candidates.length === 0 && text.trim()) {
    candidates.push(text.trim());
  }

  return [...new Set(candidates.map((command) => command.trim()).filter(isSafeShadowVerificationCommand))];
}

export async function getShadowVerificationCommandsForState(
  state: Pick<
    OrchestrationState,
    | 'executionProfile'
    | 'shadowExecutionPolicy'
    | 'planDoc'
    | 'executionShape'
    | 'currentScopeNumber'
    | 'derivedFromScopeNumber'
    | 'derivedPlanPath'
    | 'derivedPlanStatus'
    | 'derivedScopeIndex'
  >,
) {
  if (state.executionProfile !== 'shadow' || state.shadowExecutionPolicy !== 'verify') {
    return [];
  }

  const descriptor = await getCurrentExecutionScopeDescriptor(state);
  const planDocument = await readFile(descriptor.planPath, 'utf8');
  return extractShadowVerificationCommands(planDocument, descriptor.planScopeNumber);
}
