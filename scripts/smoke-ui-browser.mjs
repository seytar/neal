import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { extname, join, resolve } from 'node:path';

const cwd = process.cwd();
const distRoot = resolve(cwd, 'dist/neal/ui-web');
const workspaceRoot = '/tmp/neal-studio-smoke';
const longTitle = 'Issue 28 - Bodycam Konum Geçmişinin MapLibre Üzerinde İstemci Taraflı Kümelenmesi';

function findBrowser() {
  for (const candidate of ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable']) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (probe.status === 0) {
      return candidate;
    }
  }
  return null;
}

function json(res, body) {
  const payload = JSON.stringify(body);
  res.writeHead(200, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function contentType(path) {
  if (path.endsWith('.html')) return 'text/html; charset=utf-8';
  if (path.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (path.endsWith('.css')) return 'text/css; charset=utf-8';
  if (path.endsWith('.svg')) return 'image/svg+xml';
  return 'application/octet-stream';
}

function smokeScript(mode) {
  const common = `
    setTimeout(() => {
      const title = document.querySelector('.run-title');
      if (title) {
        document.body.dataset.smokeTitleWhiteSpace = getComputedStyle(title).whiteSpace;
      }
      const runList = document.querySelector('.run-list');
      if (runList) {
        const runListStyle = getComputedStyle(runList);
        document.body.dataset.smokeIssueListOverflowY = runListStyle.overflowY;
        document.body.dataset.smokeIssueListScrollbarColor = runListStyle.scrollbarColor || '';
      }
      document.body.dataset.smokeBodyOverflow = getComputedStyle(document.body).overflow;

      const pills = Array.from(document.querySelectorAll('.pill'))
        .map((pill) => pill.textContent.trim())
        .filter(Boolean);
      document.body.dataset.smokeStatusPills = pills.join('|');

      const blockerNotice = document.querySelector('.notice');
      if (blockerNotice) {
        document.body.dataset.smokeBlockerReason = blockerNotice.textContent.trim();
      }

      const originalTab = Array.from(document.querySelectorAll('.tab'))
        .find((tab) => tab.textContent.trim() === 'Original');
      document.body.dataset.smokeOriginalTab = originalTab ? 'true' : 'false';
      if (originalTab) {
        originalTab.click();
        setTimeout(() => {
          const originalSource = Array.from(document.querySelectorAll('.source-label'))
            .find((label) => label.textContent.includes('Original plan'));
          document.body.dataset.smokeOriginalSource = originalSource ? 'true' : 'false';
        }, 250);
      }

      const newTaskButton = Array.from(document.querySelectorAll('.new-run-button'))
        .find((button) => button.textContent.trim() === '+ New Task');
      document.body.dataset.smokeNewTaskButton = newTaskButton ? 'true' : 'false';

      const askNealButton = document.querySelector('.sidebar-ask-neal-button');
      document.body.dataset.smokeAskNealButton = askNealButton ? 'true' : 'false';
      if (askNealButton) {
        askNealButton.click();
        setTimeout(() => {
          document.body.dataset.smokeAskNealPanel =
            document.querySelector('.operator-chat-panel') ? 'true' : 'false';
          document.body.dataset.smokeAskNealWorkspaceScope =
            Array.from(document.querySelectorAll('.operator-chat-scope button'))
              .some((button) => button.textContent.trim() === 'Workspace' && button.classList.contains('active'))
              ? 'true'
              : 'false';
          document.body.dataset.smokeAskNealShortcut =
            Array.from(document.querySelectorAll('.operator-chat-shortcuts button'))
              .some((button) => button.textContent.trim() === 'What needs my attention?')
              ? 'true'
              : 'false';
        }, 250);
      }
  `;

  if (mode === 'drag') {
    return `${common}
      const handle = document.querySelector('.sidebar-resizer');
      if (handle) {
        handle.dispatchEvent(new PointerEvent('pointerdown', { clientX: 340, bubbles: true }));
        window.dispatchEvent(new PointerEvent('pointermove', { clientX: 440, bubbles: true }));
        window.dispatchEvent(new PointerEvent('pointerup', { clientX: 440, bubbles: true }));
      }
      setTimeout(() => {
        document.body.dataset.smokeStoredWidth =
          localStorage.getItem('neal.studio.sidebarWidth:${workspaceRoot}') || '';
      }, 150);
    }, 1000);
    `;
  }

  return `${common}
      const layout = document.querySelector('.studio-layout');
      if (layout) {
        document.body.dataset.smokeLayoutWidth =
          layout.style.getPropertyValue('--sidebar-width').trim();
      }
    }, 1200);
  `;
}

const browser = findBrowser();
if (!browser) {
  console.log('[neal-studio-browser-smoke] SKIP: Chromium/Chrome was not found on PATH.');
  process.exit(0);
}

const config = {
  workspaceRoot,
  sources: {
    repo: { exists: false, path: workspaceRoot + '/neal.yml' },
    user: { exists: false, path: workspaceRoot + '/user-config.yml' },
  },
  precedence: [],
  roles: {
    planner: {
      provider: 'openai-compatible',
      model: 'smoke',
      effort: null,
      sources: {
        provider: { kind: 'default', path: null, key: 'agent.planner.provider' },
        model: { kind: 'default', path: null, key: 'agent.planner.model' },
        effort: { kind: 'default', path: null, key: 'agent.planner.effort' },
      },
    },
    coder: {
      provider: 'openai-compatible',
      model: 'smoke',
      effort: null,
      sources: {
        provider: { kind: 'default', path: null, key: 'agent.coder.provider' },
        model: { kind: 'default', path: null, key: 'agent.coder.model' },
        effort: { kind: 'default', path: null, key: 'agent.coder.effort' },
      },
    },
    reviewer: {
      provider: 'openai-compatible',
      model: 'smoke',
      effort: null,
      sources: {
        provider: { kind: 'default', path: null, key: 'agent.reviewer.provider' },
        model: { kind: 'default', path: null, key: 'agent.reviewer.model' },
        effort: { kind: 'default', path: null, key: 'agent.reviewer.effort' },
      },
    },
  },
  roleOptions: {
    planner: ['openai-compatible'],
    coder: ['openai-compatible'],
    reviewer: ['openai-compatible'],
  },
  providerEfforts: { 'openai-compatible': [] },
  runtime: {
    review_level: {
      value: 'moderate',
      source: { kind: 'default', path: null, key: 'neal.review_level' },
    },
  },
  openaiCompatible: {
    baseUrl: 'http://127.0.0.1',
    apiKeyEnv: 'SMOKE_KEY',
    apiKeyConfigured: true,
    credentialSource: { kind: 'environment', path: null, key: 'SMOKE_KEY' },
    defaultModel: 'smoke',
    structuredOutputMode: null,
    sources: {
      baseUrl: { kind: 'default', path: null, key: 'providers.openai_compatible.base_url' },
      apiKeyEnv: { kind: 'default', path: null, key: 'providers.openai_compatible.api_key_env' },
      defaultModel: { kind: 'default', path: null, key: 'providers.openai_compatible.default_model' },
      structuredOutputMode: { kind: 'default', path: null, key: 'providers.openai_compatible.structured_output_mode' },
    },
  },
};

const runId = 'smoke-run-28';
const planDoc = workspaceRoot + '/documentation/issues/28.md';
const run = {
  runId,
  planDoc,
  topLevelMode: 'execute',
  status: 'blocked',
  effectiveStatus: 'blocked',
  publicStatus: 'blocked',
  phase: 'blocked',
  publicPhase: 'blocked',
  currentScopeNumber: 1,
  waitingForOperatorGuidance: false,
  pendingOperatorGuidance: false,
  manualGate: null,
  nextAction: 'Resume this run: neal resume --run ' + runId,
  uiLane: 'action_required',
};

const issue = {
  key: planDoc,
  planDoc,
  displayPath: 'documentation/issues/28.md',
  title: longTitle,
  source: 'workspace',
  executable: true,
  workspaceUpdatedAtMs: Date.now(),
  runs: [run],
  currentRun: run,
  processed: true,
  readyWithoutRun: false,
  action: null,
};

const runArtifacts = {
  originalPlanPath: workspaceRoot + '/.neal/runs/' + runId + '/PLAN_ORIGINAL.md',
  runStatePath: workspaceRoot + '/.neal/runs/' + runId + '/RUN_STATE.json',
  eventsPath: workspaceRoot + '/.neal/runs/' + runId + '/events.ndjson',
  runNarrativeMarkdownPath: workspaceRoot + '/.neal/runs/' + runId + '/RUN_NARRATIVE.md',
  reviewMarkdownPath: workspaceRoot + '/.neal/runs/' + runId + '/REVIEW.md',
  progressMarkdownPath: workspaceRoot + '/.neal/runs/' + runId + '/PLAN_PROGRESS.md',
  recoveryMarkdownPath: workspaceRoot + '/.neal/runs/' + runId + '/RECOVERY.md',
};

const runDetail = {
  uiTitle: longTitle,
  uiLane: 'action_required',
  action: null,
  guidanceOptions: [],
  executionCommands: {
    shadow: 'neal shadow execute documentation/issues/28.md',
    normal: 'neal execute documentation/issues/28.md',
  },
  status: {
    ...run,
    nextAction: 'Resume this run: neal resume --run ' + runId,
    blockedGuidance: null,
    blocker: {
      active: true,
      reason: 'Smoke blocker reason.',
      source: 'RUN_STATE.json blocker reason',
      artifactPaths: [],
    },
    resumeDecision: {
      kind: 'continue',
      reason: 'The blocked phase can be restored.',
      resumeCommand: 'neal resume --run ' + runId,
    },
    findings: {
      total: 0,
      openBlocking: 0,
      openNonBlocking: 0,
      fixed: 0,
      rejected: 0,
      deferred: 0,
    },
    build: { agentConfig: {} },
    artifacts: runArtifacts,
  },
};

const server = createServer((req, res) => {
  void (async () => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');

    if (url.pathname === '/api/config') {
      json(res, config);
      return;
    }
    if (url.pathname === '/api/commands') {
      json(res, { version: 'smoke', commands: [], helpText: '' });
      return;
    }
    if (url.pathname === '/api/issues') {
      json(res, { issuesPath: 'documentation/issues', truncated: false, issues: [issue] });
      return;
    }
    if (url.pathname === '/api/issues/file') {
      json(res, {
        path: issue.displayPath,
        title: longTitle,
        content: '# ' + longTitle + '\n\nSmoke issue body.\n',
      });
      return;
    }
    if (url.pathname === '/api/runs/' + runId) {
      json(res, runDetail);
      return;
    }
    if (url.pathname === '/api/runs/' + runId + '/chat') {
      json(res, {
        path: workspaceRoot + '/.neal/runs/' + runId + '/OPERATOR_CHAT.ndjson',
        messages: [],
        truncated: false,
      });
      return;
    }
    if (url.pathname === '/api/workspace/chat') {
      json(res, {
        path: workspaceRoot + '/.neal/STUDIO_OPERATOR_CHAT.ndjson',
        messages: [],
        truncated: false,
      });
      return;
    }
    if (url.pathname === '/api/runs/' + runId + '/activity') {
      json(res, {
        runId,
        phase: 'blocked',
        status: 'blocked',
        terminalFooterLine: '[neal] smoke | activity: blocked | status: blocked',
        nextAction: runDetail.status.nextAction,
        lastMeaningfulEvent: { type: 'run.blocked', summary: 'run blocked' },
        phaseElapsedMs: 1000,
        sampledAt: Date.now(),
        health: { classification: 'blocked' },
        action: null,
        path: runArtifacts.eventsPath,
        events: [],
      });
      return;
    }
    if (url.pathname === '/api/runs/' + runId + '/artifacts/progress') {
      json(res, {
        path: runArtifacts.progressMarkdownPath,
        content: '# Plan Progress\n\nSmoke progress.\n',
      });
      return;
    }
    if (url.pathname === '/api/runs/' + runId + '/artifacts/original') {
      json(res, {
        path: runArtifacts.originalPlanPath,
        content: '# Original Plan\n\nImmutable smoke input.\n',
      });
      return;
    }

    const requestPath = url.pathname === '/' ? '/index.html' : url.pathname;
    const filePath = join(distRoot, requestPath.replace(/^\/+/, ''));
    let body = await readFile(filePath);

    if (filePath.endsWith('index.html')) {
      const mode = url.searchParams.get('smoke') === 'drag' ? 'drag' : 'reload';
      const html = body.toString('utf8').replace(
        '</head>',
        '<script>' + smokeScript(mode) + '</script></head>',
      );
      body = Buffer.from(html);
    }

    res.writeHead(200, {
      'content-type': contentType(filePath),
      'cache-control': 'no-store',
      'content-length': body.length,
    });
    res.end(body);
  })().catch((error) => {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(error?.stack || error));
  });
});

await new Promise((resolveListen, rejectListen) => {
  server.once('error', rejectListen);
  server.listen(0, '127.0.0.1', resolveListen);
});

const address = server.address();
assert.ok(address && typeof address !== 'string');
const baseUrl = 'http://127.0.0.1:' + address.port;
const profileDir = await mkdtemp(join(tmpdir(), 'neal-studio-chromium-'));

async function dumpDom(url) {
  return new Promise((resolveDump, rejectDump) => {
    const child = spawn(browser, [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--user-data-dir=' + profileDir,
      '--virtual-time-budget=3000',
      '--dump-dom',
      url,
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectDump);
    child.once('close', (code) => {
      if (code !== 0) {
        rejectDump(new Error('Browser smoke exited ' + code + ':\n' + stderr));
        return;
      }
      resolveDump(stdout);
    });
  });
}

try {
  const first = await dumpDom(baseUrl + '/?smoke=drag');
  assert.match(first, new RegExp(longTitle));
  assert.match(first, /neal/i);
  assert.match(first, /studio/i);
  assert.match(first, /data-smoke-title-white-space="normal"/);
  assert.match(first, /data-smoke-issue-list-overflow-y="auto"/);
  assert.match(first, /data-smoke-issue-list-scrollbar-color="[^"]+"/);
  assert.match(first, /data-smoke-body-overflow="hidden"/);
  assert.match(first, /data-smoke-status-pills="[^"]*Action required[^"]*"/);
  assert.match(first, /data-smoke-blocker-reason="ReasonSmoke blocker reason\."/);
  assert.match(first, /data-smoke-original-tab="true"/);
  assert.match(first, /data-smoke-original-source="true"/);
  assert.match(first, /data-smoke-new-task-button="true"/);
  assert.match(first, /data-smoke-ask-neal-button="true"/);
  assert.match(first, /data-smoke-ask-neal-panel="true"/);
  assert.match(first, /data-smoke-ask-neal-workspace-scope="true"/);
  assert.match(first, /data-smoke-ask-neal-shortcut="true"/);
  assert.match(first, /data-smoke-stored-width="440"/);

  const second = await dumpDom(baseUrl + '/?smoke=reload');
  assert.match(second, /data-smoke-layout-width="440px"/);

  console.log('[neal-studio-browser-smoke] PASS');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profileDir, { recursive: true, force: true });
}
