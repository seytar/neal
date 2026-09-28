import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const css = await readFile(new URL('../ui/src/styles.css', import.meta.url), 'utf8');

test('Studio CSS defines visual states for every issue lane', () => {
  for (const lane of [
    'planning',
    'ready',
    'unprocessed',
    'running',
    'needs_you',
    'private_validation',
    'failed',
    'done',
  ]) {
    assert.match(css, new RegExp('\\.pill\\.' + lane + '\\s*\\{'));
    assert.match(css, new RegExp('\\.run-item\\.status-' + lane + '\\s*\\{'));
  }
});

test('Studio CSS keeps issue titles fully wrapped instead of truncated', () => {
  const titleRule = css.match(/\.run-title\s*\{([\s\S]*?)\}/)?.[1] || '';
  assert.match(titleRule, /white-space:\s*normal/);
  assert.match(titleRule, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(titleRule, /text-overflow:\s*ellipsis/);
});

test('Studio CSS exposes a dedicated resize handle and passive state', () => {
  assert.match(css, /\.sidebar-resizer\s*\{/);
  assert.match(css, /cursor:\s*col-resize/);
  assert.match(css, /\.run-item\.passive\s*\{/);
});
