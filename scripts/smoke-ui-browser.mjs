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
        document.body.dataset.smokeIssueListOverflowY = getComputedStyle(runList).overflowY;
      }
      document.body.dataset.smokeBodyOverflow = getComputedStyle(document.body).overflow;
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

const issue = {
  key: workspaceRoot + '/documentation/issues/28.md',
  planDoc: workspaceRoot + '/documentation/issues/28.md',
  displayPath: 'documentation/issues/28.md',
  title: longTitle,
  source: 'workspace',
  executable: false,
  workspaceUpdatedAtMs: Date.now(),
  runs: [],
  currentRun: null,
  processed: false,
  readyWithoutRun: false,
  action: null,
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
  assert.match(first, /data-smoke-body-overflow="hidden"/);
  assert.match(first, /data-smoke-stored-width="440"/);

  const second = await dumpDom(baseUrl + '/?smoke=reload');
  assert.match(second, /data-smoke-layout-width="440px"/);

  console.log('[neal-studio-browser-smoke] PASS');
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
  await rm(profileDir, { recursive: true, force: true });
}
