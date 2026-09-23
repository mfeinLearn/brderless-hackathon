import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { bootIfDirect, isDirectRun, loadProjectEnv, startServer } from '../server/index';

const VAR = 'HELPDESK_LOAD_ENV_TEST';

describe('loadProjectEnv', () => {
  let dir: string;

  afterEach(() => {
    delete process.env[VAR];
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('loads a .env file and leaves the process alone when the file is missing', () => {
    dir = mkdtempSync(join(tmpdir(), 'helpdesk-env-'));
    const envPath = join(dir, '.env');
    writeFileSync(envPath, `${VAR}=from-file\n`);
    delete process.env[VAR];

    loadProjectEnv(envPath);
    expect(process.env[VAR]).toBe('from-file');

    delete process.env[VAR];
    loadProjectEnv(join(dir, 'missing.env'));
    expect(process.env[VAR]).toBeUndefined();
  });

  it('does not override a variable that is already set', () => {
    dir = mkdtempSync(join(tmpdir(), 'helpdesk-env-'));
    const envPath = join(dir, '.env');
    writeFileSync(envPath, `${VAR}=from-file\n`);
    process.env[VAR] = 'from-shell';

    loadProjectEnv(envPath);
    expect(process.env[VAR]).toBe('from-shell');
  });
});

describe('startServer', () => {
  let server: Server | undefined;
  const previousPort = process.env.API_PORT;

  afterEach(async () => {
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((err) => (err ? reject(err) : resolve()));
      });
    }
    server = undefined;
    if (previousPort === undefined) delete process.env.API_PORT;
    else process.env.API_PORT = previousPort;
  });

  it('uses port 3001 when API_PORT is unset', async () => {
    delete process.env.API_PORT;
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      logs.push(String(msg));
    });

    server = startServer();
    await new Promise<void>((resolve) => server?.once('listening', () => resolve()));

    expect(logs.some((line) => line.includes('http://localhost:3001'))).toBe(true);
    spy.mockRestore();
  });

  it('listens and logs the provider from the environment', async () => {
    process.env.API_PORT = '0';
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      logs.push(String(msg));
    });

    server = startServer();
    await new Promise<void>((resolve) => server?.once('listening', () => resolve()));

    expect(logs.some((line) => line.startsWith('HelpDesk Copilot API listening on http://localhost:'))).toBe(
      true
    );
    expect(logs.some((line) => line.startsWith('LLM provider:'))).toBe(true);
    spy.mockRestore();
  });
});

describe('isDirectRun', () => {
  it('is true only when this module is the process entry script', () => {
    const script = '/tmp/helpdesk-server-index.ts';
    const url = new URL(`file://${script}`).href;
    expect(isDirectRun(url, script)).toBe(true);
    expect(isDirectRun(url, '/tmp/other.ts')).toBe(false);
    expect(isDirectRun(url, '')).toBe(false);
  });

  it('boots only when this file is the entry script', async () => {
    const previousPort = process.env.API_PORT;
    const previousProvider = process.env.LLM_PROVIDER;
    process.env.API_PORT = '0';
    delete process.env.LLM_PROVIDER;
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      logs.push(String(msg));
    });
    const script = '/tmp/helpdesk-server-index.ts';
    const url = new URL(`file://${script}`).href;

    expect(bootIfDirect(url, '/tmp/other.ts')).toBeUndefined();
    const server = bootIfDirect(url, script);
    await new Promise<void>((resolve) => server?.once('listening', () => resolve()));
    expect(logs.some((line) => line.includes('LLM provider: mock'))).toBe(true);

    await new Promise<void>((resolve, reject) => {
      server?.close((err) => (err ? reject(err) : resolve()));
    });
    spy.mockRestore();
    if (previousPort === undefined) delete process.env.API_PORT;
    else process.env.API_PORT = previousPort;
    if (previousProvider === undefined) delete process.env.LLM_PROVIDER;
    else process.env.LLM_PROVIDER = previousProvider;
  });
});
