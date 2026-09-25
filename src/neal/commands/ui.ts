import { spawn } from 'node:child_process';
import process from 'node:process';

import { startNealUiServer } from '../ui-server.js';

type UiArgs = {
  port: number;
  open: boolean;
};

function parseUiArgs(args: string[]): UiArgs {
  if (args[0] !== 'ui') {
    throw new Error(`Unknown argument: ${args[0] ?? ''}`);
  }

  let port = 7331;
  let open = true;
  let index = 1;

  while (index < args.length) {
    const flag = args[index];
    if (flag === '--no-open') {
      open = false;
      index += 1;
      continue;
    }
    if (flag === '--port') {
      const value = args[index + 1];
      if (!value || !/^\d+$/.test(value)) {
        throw new Error('neal ui --port requires an integer port.');
      }
      port = Number(value);
      if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('neal ui --port must be between 0 and 65535.');
      }
      index += 2;
      continue;
    }
    throw new Error(`Unsupported neal ui argument: ${flag}`);
  }

  return { port, open };
}

function openBrowser(url: string) {
  let command: string;
  let args: string[];

  switch (process.platform) {
    case 'darwin':
      command = 'open';
      args = [url];
      break;
    case 'win32':
      command = 'cmd';
      args = ['/c', 'start', '', url];
      break;
    default:
      command = 'xdg-open';
      args = [url];
      break;
  }

  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {
    // The URL is always printed, so browser launch failure is non-fatal.
  });
  child.unref();
}

export async function runUiCommand(args: string[]): Promise<void> {
  const parsed = parseUiArgs(args);
  const handle = await startNealUiServer({
    cwd: process.cwd(),
    port: parsed.port,
  });

  process.stdout.write(
    [
      '[neal] Control Center is running.',
      `[neal] ${handle.url}`,
      '[neal] Press Ctrl+C to stop.',
      '',
    ].join('\n'),
  );

  if (parsed.open) {
    openBrowser(handle.url);
  }
}
