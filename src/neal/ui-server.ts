import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { buildRunChangesSnapshot } from './changes.js';
import { buildUsageLines } from './cli.js';
import { runNewRunCommand } from './commands/new-run.js';
import { runResumeRunCommand } from './commands/resume-run.js';
import { runShadowCommand } from './commands/shadow.js';
import { resolveRunStatePath } from './run-registry.js';
import {
  buildStatusListSnapshot,
  buildStatusSnapshot,
  type NealStatusListRun,
  type NealStatusSnapshot,
} from './status.js';
import { buildRunUsageSnapshot } from './usage.js';
import { getAppVersion } from './version.js';

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 7331;
const MAX_REQUEST_BODY_BYTES = 128 * 1024;
const MAX_ARTIFACT_BYTES = 512 * 1024;

export type NealUiLane =
  | 'running'
  | 'needs_you'
  | 'private_validation'
  | 'failed'
  | 'done';

export type NealUiActionState = {
  runId: string;
  label: string;
  command: string;
  status: 'running' | 'succeeded' | 'failed';
  startedAt: string;
  completedAt: string | null;
  error: string | null;
  resultRunId?: string | null;
  planDoc?: string | null;
};

export type NealUiServerHandle = {
  server: Server;
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
};

type UiServerContext = {
  cwd: string;
  token: string;
  actions: Map<string, NealUiActionState>;
};

class UiHttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

type UiClassifiableRun = Pick<
  NealStatusListRun,
  | 'phase'
  | 'status'
  | 'effectiveStatus'
  | 'waitingForOperatorGuidance'
  | 'pendingOperatorGuidance'
  | 'manualGate'
> & {
  resumeDecision?: NealStatusSnapshot['resumeDecision'];
};

export function classifyUiRun(run: UiClassifiableRun): NealUiLane {
  if (run.phase === 'awaiting_private_validation') {
    return 'private_validation';
  }
  if (run.status === 'done') {
    return 'done';
  }
  if (
    run.waitingForOperatorGuidance ||
    run.pendingOperatorGuidance ||
    run.manualGate !== null ||
    run.effectiveStatus === 'paused' ||
    run.resumeDecision?.kind === 'continue'
  ) {
    return 'needs_you';
  }
  if (run.status === 'failed' || run.status === 'blocked' || run.effectiveStatus === 'blocked') {
    return 'failed';
  }
  return 'running';
}

function json(res: ServerResponse, statusCode: number, body: unknown) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function text(res: ServerResponse, statusCode: number, body: string, contentType: string) {
  res.writeHead(statusCode, {
    'Content-Type': contentType,
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BODY_BYTES) {
      throw new UiHttpError(413, 'Request body is too large.');
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return {};
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new UiHttpError(400, 'Request body must be valid JSON.');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new UiHttpError(400, 'Request body must be a JSON object.');
  }
  return parsed as Record<string, unknown>;
}

function requireString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new UiHttpError(400, `${key} must be a non-empty string.`);
  }
  return value.trim();
}

function optionalString(body: Record<string, unknown>, key: string) {
  const value = body[key];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw new UiHttpError(400, `${key} must be a string.`);
  }
  return value.trim() || null;
}

function requireWriteToken(req: IncomingMessage, token: string) {
  const supplied = req.headers['x-neal-ui-token'];
  if (typeof supplied !== 'string' || supplied !== token) {
    throw new UiHttpError(403, 'Invalid Neal UI write token.');
  }
}

function decodeSegment(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new UiHttpError(400, 'Invalid URL encoding.');
  }
}

function extractGuidanceMessage(command: string) {
  const match = command.match(/--message "((?:\\.|[^"])*)"$/);
  if (!match?.[1]) {
    return null;
  }
  return match[1].replace(/\\([\\$"`])/g, '$1');
}

async function buildRunDetail(ctx: UiServerContext, runId: string) {
  const resolution = await resolveRunStatePath({ cwd: ctx.cwd, runId });
  const status = await buildStatusSnapshot({
    cwd: ctx.cwd,
    statePath: resolution.statePath,
  });

  const displayPlanPath = relative(ctx.cwd, status.planDoc) || status.planDoc;

  return {
    status,
    uiLane: classifyUiRun(status),
    action: ctx.actions.get(runId) ?? null,
    executionCommands: {
      shadow: `neal shadow execute ${shellQuoteForDisplay(displayPlanPath)}`,
      normal: `neal execute ${shellQuoteForDisplay(displayPlanPath)}`,
    },
    guidanceOptions: (status.blockedGuidance?.options ?? []).map((option) => ({
      label: option.label,
      description: option.description,
      message: extractGuidanceMessage(option.command),
    })),
  };
}

function anyActionRunning(ctx: UiServerContext) {
  return [...ctx.actions.values()].some((action) => action.status === 'running');
}

function startAction(
  ctx: UiServerContext,
  runId: string,
  label: string,
  command: string,
  action: () => Promise<{ resultRunId?: string | null; planDoc?: string | null } | void>,
) {
  if (anyActionRunning(ctx)) {
    throw new UiHttpError(409, 'Another Neal UI writer action is already running.');
  }

  const state: NealUiActionState = {
    runId,
    label,
    command,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    error: null,
  };
  ctx.actions.set(runId, state);

  void (async () => {
    const previousExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      const result = await action();
      ctx.actions.set(runId, {
        ...state,
        status: 'succeeded',
        completedAt: new Date().toISOString(),
        ...(result ?? {}),
      });
    } catch (error) {
      ctx.actions.set(runId, {
        ...state,
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: getErrorMessage(error),
      });
    } finally {
      process.exitCode = previousExitCode;
    }
  })();

  return state;
}

function shellQuoteForDisplay(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function getUiCommandCatalog() {
  const lines = buildUsageLines(getAppVersion());
  const commands = lines.flatMap((line) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('Usage: ')) {
      return [trimmed.slice('Usage: '.length)];
    }
    if (trimmed.startsWith('or: ')) {
      return [trimmed.slice('or: '.length)];
    }
    return [];
  });

  return {
    version: getAppVersion(),
    commands,
    helpText: lines.join('\n'),
  };
}

type UiActivityEvent = {
  ts: string | null;
  type: string;
  summary: string;
};

function summarizeUiEvent(value: unknown): UiActivityEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const event = value as { ts?: unknown; type?: unknown; data?: unknown };
  if (typeof event.type !== 'string' || event.type.trim() === '') {
    return null;
  }
  const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data)
    ? event.data as Record<string, unknown>
    : {};
  const candidates = [
    data.message,
    data.summary,
    data.label,
    data.phase,
    data.provider,
    data.command,
    data.path,
    data.status,
  ];
  const detail = candidates.find((candidate) => typeof candidate === 'string' && candidate.trim() !== '');
  return {
    ts: typeof event.ts === 'string' ? event.ts : null,
    type: event.type,
    summary: typeof detail === 'string' ? detail.trim().slice(0, 240) : event.type,
  };
}

async function readUiActivityTail(path: string, maxEvents = 60) {
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  });
  if (!info || !info.isFile()) {
    return { path, events: [] as UiActivityEvent[] };
  }

  const bytesToRead = Math.min(info.size, 256 * 1024);
  const start = Math.max(0, info.size - bytesToRead);
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(bytesToRead);
    await handle.read(buffer, 0, bytesToRead, start);
    let content = buffer.toString('utf8');
    if (start > 0) {
      const firstNewline = content.indexOf('\n');
      content = firstNewline >= 0 ? content.slice(firstNewline + 1) : '';
    }
    const events = content
      .split('\n')
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const summarized = summarizeUiEvent(JSON.parse(line));
          return summarized ? [summarized] : [];
        } catch {
          return [];
        }
      })
      .slice(-maxEvents);
    return { path, events };
  } finally {
    await handle.close();
  }
}

function requireUiPlanId(body: Record<string, unknown>) {
  const value = requireString(body, 'planId');
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(value)) {
    throw new UiHttpError(400, 'planId must contain only letters, numbers, underscore, or dash.');
  }
  return value;
}

function buildUiPlanPath(cwd: string, planId: string) {
  return join(cwd, '.neal', 'ui-plans', `${planId}.md`);
}

function renderUiSeedPlan(title: string, description: string) {
  return [
    `# ${title}`,
    '',
    '## Objective',
    '',
    description.trim(),
    '',
    '> Created from Neal Control Center. The planner should refine this seed into the canonical executable Neal plan format.',
    '',
  ].join('\n');
}

async function findNewestRunForPlan(cwd: string, planDoc: string, topLevelMode: 'plan' | 'execute') {
  const snapshot = await buildStatusListSnapshot({ cwd });
  const normalized = resolve(planDoc);
  return snapshot.runs.find(
    (run) => resolve(run.planDoc) === normalized && run.topLevelMode === topLevelMode,
  )?.runId ?? null;
}

async function runShadowFeedback(runId: string, feedback: string) {
  const dir = await mkdtemp(join(tmpdir(), 'neal-ui-shadow-feedback-'));
  const path = join(dir, 'feedback.txt');
  try {
    await writeFile(path, feedback, { encoding: 'utf8', mode: 0o600 });
    await runShadowCommand(['shadow', 'feedback', '--run', runId, '--file', path]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function readArtifact(path: string) {
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error && typeof error === 'object' && (error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new UiHttpError(404, 'Artifact does not exist.');
    }
    throw error;
  }

  if (!info.isFile()) {
    throw new UiHttpError(404, 'Artifact is not a file.');
  }
  if (info.size > MAX_ARTIFACT_BYTES) {
    throw new UiHttpError(413, `Artifact exceeds ${MAX_ARTIFACT_BYTES} bytes.`);
  }
  return readFile(path, 'utf8');
}

function artifactPathFor(status: NealStatusSnapshot, kind: string) {
  switch (kind) {
    case 'plan':
      return status.planDoc;
    case 'progress':
      return status.artifacts.progressMarkdownPath;
    case 'review':
      return status.artifacts.reviewMarkdownPath;
    case 'recovery':
      return status.artifacts.recoveryMarkdownPath;
    case 'narrative':
      return status.artifacts.runNarrativeMarkdownPath;
    case 'manual-gate':
      return status.manualGate?.instructionsPath ?? null;
    default:
      throw new UiHttpError(404, 'Unknown artifact.');
  }
}

function contentTypeFor(path: string) {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.json':
      return 'application/json; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

async function resolveUiStaticRoot() {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(here, 'ui-web'),
    resolve(here, '../../dist/neal/ui-web'),
  ];

  for (const candidate of candidates) {
    try {
      const info = await stat(join(candidate, 'index.html'));
      if (info.isFile()) {
        return candidate;
      }
    } catch {
      // Try the next build location.
    }
  }

  throw new Error(
    'Neal UI assets are missing. Build Neal first with `pnpm build`, then run `neal ui` again.',
  );
}

async function serveUiAsset(
  res: ServerResponse,
  staticRoot: string,
  pathname: string,
  token: string,
) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const resolvedPath = resolve(staticRoot, relativePath);
  const relativeAssetPath = relative(staticRoot, resolvedPath);
  if (relativeAssetPath.startsWith('..') || isAbsolute(relativeAssetPath)) {
    throw new UiHttpError(404, 'Asset not found.');
  }

  let pathToRead = resolvedPath;
  try {
    const info = await stat(pathToRead);
    if (!info.isFile()) {
      throw new Error('not a file');
    }
  } catch {
    pathToRead = join(staticRoot, 'index.html');
  }

  if (pathToRead.endsWith('index.html')) {
    const html = await readFile(pathToRead, 'utf8');
    const injected = html.replace(
      '</head>',
      `<script>window.__NEAL_UI_TOKEN__=${JSON.stringify(token)};</script></head>`,
    );
    text(res, 200, injected, 'text/html; charset=utf-8');
    return;
  }

  const body = await readFile(pathToRead);
  res.writeHead(200, {
    'Content-Type': contentTypeFor(pathToRead),
    'Cache-Control': 'no-store',
    'Content-Length': body.length,
  });
  res.end(body);
}

async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: UiServerContext,
  pathname: string,
) {
  if (req.method === 'GET' && pathname === '/api/commands') {
    json(res, 200, getUiCommandCatalog());
    return;
  }

  if (req.method === 'GET' && pathname === '/api/new-run/status') {
    json(res, 200, ctx.actions.get('__new_run__') ?? null);
    return;
  }

  if (req.method === 'POST' && pathname === '/api/new-run/plan') {
    requireWriteToken(req, ctx.token);
    const body = await readJsonBody(req);
    const description = requireString(body, 'description');
    const title = optionalString(body, 'title') ?? description.split(/\r?\n/)[0]?.trim().slice(0, 80) ?? 'New task';
    const planId = requireUiPlanId(body);
    const planDoc = buildUiPlanPath(ctx.cwd, planId);
    await mkdir(dirname(planDoc), { recursive: true });
    await writeFile(planDoc, renderUiSeedPlan(title, description), { encoding: 'utf8', flag: 'wx' });

    const displayPath = relative(ctx.cwd, planDoc) || planDoc;
    const command = `neal plan ${shellQuoteForDisplay(displayPath)}`;
    const action = startAction(ctx, '__new_run__', 'Plan new task', command, async () => {
      await runNewRunCommand(['plan', displayPath]);
      return {
        resultRunId: await findNewestRunForPlan(ctx.cwd, planDoc, 'plan'),
        planDoc,
      };
    });
    json(res, 202, { ...action, planDoc, displayPath });
    return;
  }

  if (req.method === 'GET' && pathname === '/api/runs') {
    const snapshot = await buildStatusListSnapshot({ cwd: ctx.cwd });
    json(res, 200, {
      ...snapshot,
      runs: snapshot.runs.map((run) => ({
        ...run,
        uiLane: classifyUiRun(run),
        action: ctx.actions.get(run.runId) ?? null,
      })),
    });
    return;
  }

  const parts = pathname.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'runs' || !parts[2]) {
    throw new UiHttpError(404, 'API route not found.');
  }
  const runId = decodeSegment(parts[2]);

  if (req.method === 'GET' && parts.length === 3) {
    json(res, 200, await buildRunDetail(ctx, runId));
    return;
  }

  if (req.method === 'GET' && parts[3] === 'activity' && parts.length === 4) {
    const detail = await buildRunDetail(ctx, runId);
    json(res, 200, {
      runId,
      phase: detail.status.publicPhase,
      status: detail.status.publicStatus,
      nextAction: detail.status.nextAction,
      lastMeaningfulEvent: detail.status.lastMeaningfulEvent,
      action: detail.action,
      ...(await readUiActivityTail(detail.status.artifacts.eventsPath)),
    });
    return;
  }

  if (req.method === 'GET' && parts[3] === 'changes' && parts.length === 4) {
    json(res, 200, await buildRunChangesSnapshot({ cwd: ctx.cwd, runId }));
    return;
  }

  if (req.method === 'GET' && parts[3] === 'usage' && parts.length === 4) {
    json(res, 200, await buildRunUsageSnapshot({ cwd: ctx.cwd, runId }));
    return;
  }

  if (req.method === 'GET' && parts[3] === 'artifacts' && parts[4] && parts.length === 5) {
    const detail = await buildRunDetail(ctx, runId);
    const path = artifactPathFor(detail.status, decodeSegment(parts[4]));
    if (!path) {
      throw new UiHttpError(404, 'Artifact is not available for this run.');
    }
    json(res, 200, { path, content: await readArtifact(path) });
    return;
  }

  if (req.method === 'POST' && parts[3] === 'actions' && parts[4] && parts.length === 5) {
    requireWriteToken(req, ctx.token);
    const actionName = decodeSegment(parts[4]);
    const body = await readJsonBody(req);

    switch (actionName) {
      case 'execute-shadow': {
        const detail = await buildRunDetail(ctx, runId);
        const planDoc = detail.status.planDoc;
        const displayPath = relative(ctx.cwd, planDoc) || planDoc;
        const command = `neal shadow execute ${shellQuoteForDisplay(displayPath)}`;
        const state = startAction(ctx, runId, 'Execute Shadow plan', command, async () => {
          await runShadowCommand(['shadow', 'execute', displayPath]);
          return {
            resultRunId: await findNewestRunForPlan(ctx.cwd, planDoc, 'execute'),
            planDoc,
          };
        });
        json(res, 202, state);
        return;
      }
      case 'execute-normal': {
        const detail = await buildRunDetail(ctx, runId);
        const planDoc = detail.status.planDoc;
        const displayPath = relative(ctx.cwd, planDoc) || planDoc;
        const command = `neal execute ${shellQuoteForDisplay(displayPath)}`;
        const state = startAction(ctx, runId, 'Execute plan', command, async () => {
          await runNewRunCommand(['execute', displayPath]);
          return {
            resultRunId: await findNewestRunForPlan(ctx.cwd, planDoc, 'execute'),
            planDoc,
          };
        });
        json(res, 202, state);
        return;
      }
      case 'resume': {
        const command = `neal resume --run ${runId}`;
        const state = startAction(ctx, runId, 'Resume', command, () =>
          runResumeRunCommand(['resume', '--run', runId]),
        );
        json(res, 202, state);
        return;
      }
      case 'guidance': {
        const message = requireString(body, 'message');
        const command = `neal resume --run ${runId} --message ${shellQuoteForDisplay(message)}`;
        const state = startAction(ctx, runId, 'Apply operator guidance', command, () =>
          runResumeRunCommand(['resume', '--run', runId, '--message', message]),
        );
        json(res, 202, state);
        return;
      }
      case 'shadow-accept': {
        const note = optionalString(body, 'note');
        const args = ['shadow', 'accept', '--run', runId];
        if (note) {
          args.push('--note', note);
        }
        const command = `neal shadow accept --run ${runId}${note ? ` --note ${shellQuoteForDisplay(note)}` : ''}`;
        const state = startAction(ctx, runId, 'Accept private validation', command, () =>
          runShadowCommand(args),
        );
        json(res, 202, state);
        return;
      }
      case 'shadow-feedback': {
        const feedback = requireString(body, 'feedback');
        const command = `neal shadow feedback --run ${runId} --file <temporary-sanitized-feedback-file>`;
        const state = startAction(ctx, runId, 'Apply private validation feedback', command, () =>
          runShadowFeedback(runId, feedback),
        );
        json(res, 202, state);
        return;
      }
      default:
        throw new UiHttpError(404, 'Unknown Neal UI action.');
    }
  }

  throw new UiHttpError(404, 'API route not found.');
}

export async function startNealUiServer(args: {
  cwd: string;
  host?: string;
  port?: number;
}): Promise<NealUiServerHandle> {
  const cwd = resolve(args.cwd);
  const host = args.host ?? DEFAULT_HOST;
  const requestedPort = args.port ?? DEFAULT_PORT;
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '::1') {
    throw new Error('Neal UI only supports loopback hosts.');
  }

  const staticRoot = await resolveUiStaticRoot();
  const ctx: UiServerContext = {
    cwd,
    token: randomBytes(32).toString('hex'),
    actions: new Map(),
  };

  const server = createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
        if (url.pathname.startsWith('/api/')) {
          await handleApi(req, res, ctx, url.pathname);
          return;
        }
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          throw new UiHttpError(405, 'Method not allowed.');
        }
        await serveUiAsset(res, staticRoot, url.pathname, ctx.token);
      } catch (error) {
        if (res.headersSent) {
          res.end();
          return;
        }
        const statusCode = error instanceof UiHttpError ? error.statusCode : 500;
        json(res, statusCode, { error: getErrorMessage(error) });
      }
    })();
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      rejectListen(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolveListen();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(requestedPort, host);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Neal UI server did not expose a TCP address.');
  }

  const displayHost = host === '::1' ? '[::1]' : host;
  const url = `http://${displayHost}:${address.port}`;

  return {
    server,
    host,
    port: address.port,
    url,
    close: () =>
      new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      }),
  };
}
