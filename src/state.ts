import { defineDoc } from '@earendil-works/pi-durable';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Config } from './config.js';
import type { Result } from './process.js';

export type Step = 'prepare' | 'implement' | 'build' | 'e2e';
export type Execution = {
  step: Step;
  attempt: number;
  status: 'running' | 'passed' | 'failed' | 'interrupted';
  startedAt: string;
  endedAt: string | null;
  log: string;
  result: Result | null;
};
export type Run = {
  id: string;
  goal: string;
  repo: string;
  directory: string;
  workspace: string;
  baseCommit: string;
  config: Config;
  createdAt: string;
  updatedAt: string;
  status: 'pending' | 'running' | 'blocked' | 'failed' | 'complete' | 'cancelled';
  step: Step;
  attempt: number;
  taskId: number | null;
  executions: Execution[];
  message: string;
};

export const RunDoc = defineDoc<{ run: Run | null }>({
  kind: 'knight.run', version: 1, scope: 'conversation', history: 'latest', fork: 'initial',
  initial: () => ({ run: null }), checkpointWhen: () => true,
});

export function runId(value: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) {
    throw new Error('Run ID must be 1–64 letters, digits, underscores or hyphens, starting with a letter or digit.');
  }
  return value;
}

export async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`State directory must not be a symlink: ${path}`);
  if ((stat.mode & 0o077) !== 0) throw new Error(`State directory must be private (chmod 700): ${path}`);
}

export async function runDirectory(repo: string, id: string, create: boolean): Promise<string> {
  const state = join(repo, '.knight');
  const runs = join(state, 'runs');
  const directory = join(runs, runId(id));
  for (const path of [state, runs, directory]) {
    if (create) await privateDirectory(path);
    else {
      const stat = await lstat(path);
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid run directory.');
    }
  }
  return directory;
}

export async function atomicJson(path: string, value: unknown): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await rename(temporary, path);
}

export async function publish(run: Run): Promise<void> {
  await atomicJson(join(run.directory, 'status.json'), run);
}

export async function readStatus(directory: string): Promise<Run> {
  const run = JSON.parse(await readFile(join(directory, 'status.json'), 'utf8')) as Run;
  if (run.directory !== resolve(directory)) throw new Error('Run state does not match its directory.');
  return run;
}
