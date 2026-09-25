import assert from 'node:assert/strict';
import test from 'node:test';

import {
  extractShadowVerificationCommands,
  isSafeShadowVerificationCommand,
} from '../src/neal/shadow-verification.js';

test('Shadow verification accepts bounded checks and rejects runtime or mutating commands', () => {
  assert.equal(isSafeShadowVerificationCommand('php -l app/Foo.php'), true);
  assert.equal(isSafeShadowVerificationCommand('pnpm test'), true);
  assert.equal(isSafeShadowVerificationCommand('php artisan route:list --name=logs.user-activities'), true);

  assert.equal(isSafeShadowVerificationCommand('php artisan migrate'), false);
  assert.equal(isSafeShadowVerificationCommand('pnpm dev'), false);
  assert.equal(isSafeShadowVerificationCommand('curl https://example.com/health'), false);
  assert.equal(isSafeShadowVerificationCommand('pnpm test && rm -rf tmp'), false);
  assert.equal(isSafeShadowVerificationCommand('bash -c "pnpm test"'), false);
});

test('Shadow verification extracts only safe commands from the active scope', () => {
  const plan = [
    '# Test plan',
    '',
    '## Execution Shape',
    '',
    'multi_scope',
    '',
    '### Scope 1: first',
    '- Goal: first scope',
    '- Verification: `pnpm lint` and `pnpm dev`.',
    '- Success Condition: first done',
    '',
    '### Scope 2: second',
    '- Goal: second scope',
    '- Verification: `php -l app/Foo.php`, `php artisan route:list --name=logs.user-activities`, `php artisan migrate`, and `curl https://example.com`.',
    '- Success Condition: second done',
    '',
  ].join('\n');

  assert.deepEqual(extractShadowVerificationCommands(plan, 1), ['pnpm lint']);
  assert.deepEqual(extractShadowVerificationCommands(plan, 2), [
    'php -l app/Foo.php',
    'php artisan route:list --name=logs.user-activities',
  ]);
});

test('Shadow verification falls back to a one-shot plan body when no numbered scopes exist', () => {
  const plan = [
    '# Test plan',
    '',
    '## Execution Shape',
    '',
    'one_shot',
    '',
    '- Goal: implement',
    '- Verification: `cargo check` and `cargo test`.',
    '- Success Condition: done',
    '',
  ].join('\n');

  assert.deepEqual(extractShadowVerificationCommands(plan, 1), ['cargo check', 'cargo test']);
});
