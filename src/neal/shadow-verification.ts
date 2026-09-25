import { readFile } from 'node:fs/promises';

import { getCurrentExecutionScopeDescriptor } from './scopes.js';
import type { OrchestrationState } from './types.js';

const MAX_VERIFICATION_COMMAND_CHARS = 1000;
const SHELL_CONTROL_PATTERN = /[\n\r;&|<>]|\$\(|\$\{|\x60/;
const SHELL_WRAPPER_PATTERN = /^(?:ba|z|fi|da)?sh\b|^cmd(?:\.exe)?\s+\/c\b|^powershell(?:\.exe)?\b|^pwsh\b/i;
const MUTATING_OR_RUNTIME_PATTERN =
  /\b(?:serve|server|start|dev|watch|migrate|migration|seed|deploy|publish|install|update|upgrade|docker|compose|kubectl|helm|curl|wget|ssh|scp|rsync|nc|netcat|sudo|su|rm|mv|cp|chmod|chown|kill|pkill|reboot|shutdown)\b/i;
const DIRECT_VERIFICATION_RUNNER_PATTERN =
  /^(?:\.\/)?(?:vendor\/bin\/)?(?:phpunit|pest|pytest|vitest|jest|eslint|mypy|phpstan|psalm|golangci-lint)(?:\s|$)/i;
const BIOME_OR_RUFF_PATTERN = /^(?:biome|ruff)\s+(?:check|lint|format)(?:\s|$)/i;
const PACKAGE_MANAGER_PATTERN =
  /^(?:pnpm|npm|yarn|bun)\s+(?:run\s+)?(?:test|tests|check|lint|typecheck|build|verify|validation)(?:\s|$)/i;
const CARGO_PATTERN = /^cargo\s+(?:test|check|clippy|build|fmt)(?:\s|$)/i;
const GO_PATTERN = /^go\s+(?:test|vet|build)(?:\s|$)/i;
const JVM_OR_DOTNET_PATTERN =
  /^(?:(?:\.\/)?gradlew|gradle|mvn|dotnet)\s+(?:test|check|build|verify)(?:\s|$)/i;
const PYTHON_PYTEST_PATTERN = /^(?:python|python3)\s+-m\s+pytest(?:\s|$)/i;
const PHP_LINT_PATTERN = /^php\s+-l\s+\S+/i;
const PHP_TEST_SCRIPT_PATTERN = /^php\s+tests?\/[A-Za-z0-9_./-]+\.php(?:\s|$)/i;
const PHP_VENDOR_TEST_PATTERN = /^php\s+vendor\/bin\/(?:phpunit|pest)(?:\s|$)/i;
const ARTISAN_VERIFICATION_PATTERN = /^php\s+artisan\s+(?:test|route:list)(?:\s|$)/i;

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
    DIRECT_VERIFICATION_RUNNER_PATTERN.test(normalized) ||
    BIOME_OR_RUFF_PATTERN.test(normalized) ||
    PACKAGE_MANAGER_PATTERN.test(normalized) ||
    CARGO_PATTERN.test(normalized) ||
    GO_PATTERN.test(normalized) ||
    JVM_OR_DOTNET_PATTERN.test(normalized) ||
    PYTHON_PYTEST_PATTERN.test(normalized) ||
    PHP_LINT_PATTERN.test(normalized) ||
    PHP_TEST_SCRIPT_PATTERN.test(normalized) ||
    PHP_VENDOR_TEST_PATTERN.test(normalized) ||
    ARTISAN_VERIFICATION_PATTERN.test(normalized)
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
