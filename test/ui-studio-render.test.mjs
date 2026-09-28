import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { StudioIssueCard } from '../ui/src/studio-issue-card.jsx';

test('Studio issue card renders the full long title and all issue metadata', () => {
  const title = 'Issue 28 - Bodycam Konum Geçmişinin MapLibre Üzerinde İstemci Taraflı Kümelenmesi';
  const issue = {
    key: 'issue-28',
    planDoc: '/repo/documentation/issues/28.md',
    displayPath: 'documentation/issues/28-bodycam-location.md',
    title,
    processed: false,
    readyWithoutRun: false,
    currentRun: null,
    runs: [],
  };

  const html = renderToStaticMarkup(React.createElement(StudioIssueCard, {
    issue,
    index: 0,
    selectedIssuePath: issue.planDoc,
    onSelect: () => {},
  }));

  assert.match(html, new RegExp(title));
  assert.match(html, /documentation\/issues\/28-bodycam-location\.md/);
  assert.match(html, /UNPROCESSED/i);
  assert.match(html, /Latest/i);
  assert.match(html, /data-latest="true"/);
  assert.match(html, /data-lane="unprocessed"/);
});

test('Studio issue card exposes passive done state for visual regression checks', () => {
  const issue = {
    key: 'issue-27',
    planDoc: '/repo/documentation/issues/27.md',
    displayPath: 'documentation/issues/27.md',
    title: 'Issue 27 Location Log Surface',
    processed: true,
    readyWithoutRun: false,
    currentRun: {
      topLevelMode: 'execute',
      status: 'done',
      uiLane: 'done',
      publicPhase: 'done',
    },
    runs: [{ runId: 'run-27' }],
  };

  const html = renderToStaticMarkup(React.createElement(StudioIssueCard, {
    issue,
    index: 4,
    selectedIssuePath: null,
    onSelect: () => {},
  }));

  assert.match(html, /data-passive="true"/);
  assert.match(html, /status-done/);
  assert.match(html, /1 attempt/);
});
