import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../ui/src/main.jsx', import.meta.url), 'utf8');

test('Studio exposes Original and current Plan as distinct artifact tabs', () => {
  assert.match(
    source,
    /const BASE_TABS = \['progress', 'original', 'plan', 'review', 'recovery', 'narrative', 'changes', 'usage'\]/,
  );
  assert.match(source, /label: 'Original plan'/);
  assert.match(source, /Immutable snapshot of the plan file as it was supplied when this Neal run started\./);
  assert.match(source, /label: 'Current plan'/);
  assert.match(source, /Original plan snapshot is unavailable for this legacy run\./);
});

test('Studio blocked-run panel makes the reason and recovery actions visible', () => {
  assert.match(source, /const blocker = studioBlockerSummary\(status\)/);
  assert.match(source, /Neal stopped and needs an action/);
  assert.match(source, /<strong>Reason<\/strong>/);
  assert.match(source, /Open recovery/);
  assert.match(source, /Open review/);
  assert.match(source, /Raw Neal status:/);
});


test('Studio exposes the Neal brand mark and favicon asset', async () => {
  assert.match(source, /className="brand-mark"/);
  assert.match(source, /src="\/neal-mark\.svg"/);

  const index = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');
  assert.match(index, /rel="icon" href="\/neal-mark\.svg"/);
});
