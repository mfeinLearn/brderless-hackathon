import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import express, { type Express } from 'express';
import type { Server } from 'node:http';

/** Load a `.env` file when it exists. Variables already set in the shell win. */
export function loadProjectEnv(envPath = resolve(process.cwd(), '.env')): void {
  if (existsSync(envPath)) process.loadEnvFile(envPath);
}

export function isDirectRun(moduleUrl: string, argv1 = process.argv[1]): boolean {
  if (!argv1) return false;
  return moduleUrl === pathToFileURL(resolve(argv1)).href;
}

loadProjectEnv();

const { api } = await import('./routes');

export const app: Express = express();
app.use(express.json());
app.use('/api', api);

export function startServer(): Server {
  const port = Number(process.env.API_PORT ?? 3001);
  return app.listen(port, () => {
    console.log(`HelpDesk Copilot API listening on http://localhost:${port}`);
    console.log(`LLM provider: ${process.env.LLM_PROVIDER ?? 'mock'}`);
  });
}

export function bootIfDirect(moduleUrl = import.meta.url, argv1 = process.argv[1]): Server | undefined {
  if (!isDirectRun(moduleUrl, argv1)) return;
  return startServer();
}

bootIfDirect();
