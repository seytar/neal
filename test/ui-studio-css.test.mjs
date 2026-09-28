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
    'action_required',
    'private_validation',
    'blocked',
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


test('Studio keeps viewport fixed while the issue list scrolls independently', () => {
  const bodyRule = css.match(/body\s*\{([\s\S]*?)\}/)?.[1] || '';
  const layoutRule = css.match(/\.layout\s*\{([\s\S]*?)\}/)?.[1] || '';
  const sidebarRule = css.match(/\.sidebar\s*\{([\s\S]*?)\}/)?.[1] || '';
  const runListRule = css.match(/\.run-list\s*\{([\s\S]*?)\}/)?.[1] || '';
  const mainRule = css.match(/\.main\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(bodyRule, /overflow:\s*hidden/);
  assert.match(layoutRule, /height:\s*100vh/);
  assert.match(sidebarRule, /overflow:\s*hidden/);
  assert.match(sidebarRule, /flex-direction:\s*column/);
  assert.match(runListRule, /overflow-y:\s*auto/);
  assert.match(runListRule, /flex:\s*1\s+1\s+auto/);
  assert.match(runListRule, /overscroll-behavior:\s*contain/);
  assert.match(mainRule, /height:\s*100vh/);
  assert.match(mainRule, /overflow:\s*auto/);
});


test('Studio defines a consistent custom scrollbar system', () => {
  const rootRule = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] || '';
  const universalRule = css.match(/\*\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(rootRule, /--studio-scroll-track:/);
  assert.match(rootRule, /--studio-scroll-thumb:/);
  assert.match(rootRule, /--studio-scroll-thumb-hover:/);
  assert.match(rootRule, /--studio-scroll-thumb-active:/);

  assert.match(universalRule, /scrollbar-width:\s*thin/);
  assert.match(universalRule, /scrollbar-color:/);

  assert.match(css, /\*::-webkit-scrollbar\s*\{/);
  assert.match(css, /\*::-webkit-scrollbar-track\s*\{/);
  assert.match(css, /\*::-webkit-scrollbar-thumb\s*\{/);
  assert.match(css, /\*::-webkit-scrollbar-thumb:hover\s*\{/);
  assert.match(css, /\*::-webkit-scrollbar-thumb:active\s*\{/);
  assert.match(css, /\.run-list::-webkit-scrollbar\s*\{/);
});
