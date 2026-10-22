#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { randomUUID } from 'node:crypto';
import { access, lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import lockfile from 'proper-lockfile';
import { defaultConfig, loadConfig } from './config.js';
import { capture, checkCodex } from './process.js';
import { drive } from './runtime.js';
import { atomicJson, privateDirectory, readStatus, runDirectory, type Run } from './state.js';

const help = `Knight Manager — durable local Codex workflows

  knight init [--repo PATH]                     Create knight.json and ignore local state
  knight doctor [--repo PATH]                   Check Git and ChatGPT Codex sign-in
  knight run "GOAL" [--repo PATH] [--id NAME]     Implement → build → E2E in a new worktree
  knight status ID [--repo PATH] [--json]        Show the last committed status snapshot
  knight resume ID [--repo PATH]                Recover saved work
  knight resume ID --retry-interrupted          Explicitly replay the interrupted step
  knight cancel ID [--repo PATH]                Cancel a stopped run; retain its worktree

Requires Linux, Node 24+, Git, Codex CLI 0.163.0+, and codex login with ChatGPT.
Run from a clean, trusted Git repository with a committed knight.json.
Use Ctrl-C to stop an active run before cancelling it.
`;

async function main(): Promise<void> {
  process.umask(0o077);
  const { values, positionals } = parseArgs({
    allowPositionals: true, strict: true,
    options: {
      repo: { type: 'string' }, id: { type: 'string' }, json: { type: 'boolean' },
      'retry-interrupted': { type: 'boolean' }, help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
  if (values.version) { console.log('2.0.0'); return; }
  if (values.help || !positionals.length) { console.log(help); return; }
  if (process.platform !== 'linux' || Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error('This release supports Linux with Node 24 or newer.');
  }
  const command = positionals[0]!;
  if (!['init', 'doctor', 'run', 'status', 'resume', 'cancel'].includes(command)) throw new Error(`Unknown command: ${command}`);
  if ((values.id && command !== 'run') || (values['retry-interrupted'] && command !== 'resume') ||
      (values.json && command !== 'status')) throw new Error('An option is not valid for this command. See knight --help.');
  const argumentCount = ['run', 'status', 'resume', 'cancel'].includes(command) ? 2 : 1;
  if (positionals.length !== argumentCount) throw new Error(`Invalid arguments for ${command}. See knight --help.`);
  const cwd = await realpath(resolve(values.repo ?? process.cwd()));
  const repo = await realpath(capture(['git', 'rev-parse', '--show-toplevel'], cwd));

  if (command === 'init') {
    const config = join(repo, 'knight.json');
    await writeFile(config, `${JSON.stringify(defaultConfig, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
    const ignorePath = join(repo, '.gitignore');
    const ignoreStat = await lstat(ignorePath).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (ignoreStat?.isSymbolicLink()) throw new Error('.gitignore must not be a symlink.');
    const ignored = ignoreStat ? await readFile(ignorePath, 'utf8') : '';
    await writeFile(ignorePath, `${ignored}${ignored.endsWith('\n') || !ignored ? '' : '\n'}\n# Knight local state and credentials\n.knight/\n.codex/\n.env\n.env.*\n!.env.example\n`);
    console.log('Created knight.json. Review its build and E2E commands, then commit the configuration and .gitignore.');
    return;
  }
  if (command === 'doctor') {
    checkCodex(repo);
    console.log('Installed: Linux, Node, Git, and Codex. Reported sign-in: ChatGPT. Live authentication is checked when a run starts.');
    return;
  }

  let initial: Run | null = null;
  let directory: string;
  if (command === 'run') {
    const goal = positionals[1]!.trim();
    if (!goal || goal.length > 32_000) throw new Error('Goal must contain 1–32000 characters.');
    const config = await loadConfig(repo);
    const stateInfo = await lstat(join(repo, '.knight')).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (stateInfo?.isSymbolicLink()) throw new Error('State directory must not be a symlink.');
    try { capture(['git', 'check-ignore', '--quiet', '.knight/'], repo); }
    catch { throw new Error('Add .knight/ to .gitignore before starting a run.'); }
    capture(['git', 'ls-files', '--error-unmatch', 'knight.json'], repo);
    if (capture(['git', 'status', '--porcelain', '--untracked-files=normal'], repo)) {
      throw new Error('Repository must be clean. Commit or save your changes before starting a run.');
    }
    checkCodex(repo);
    const id = values.id ?? `${new Date().toISOString().replace(/[^0-9]/g, '').slice(0, 14)}-${randomUUID().slice(0, 8)}`;
    directory = await runDirectory(repo, id, true);
    const now = new Date().toISOString();
    initial = {
      id, goal, repo, directory, workspace: join(directory, 'workspace'),
      baseCommit: capture(['git', 'rev-parse', 'HEAD'], repo), config,
      createdAt: now, updatedAt: now, status: 'pending', step: 'prepare',
      attempt: 1, taskId: null, executions: [], message: 'Ready to start.',
    };
  } else {
    directory = await runDirectory(repo, positionals[1]!, false);
  }
  if (command === 'status') {
    const run = await readStatus(directory);
    if (values.json) console.log(JSON.stringify(run));
    else show(run);
    return;
  }

  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(directory, {
      realpath: false, stale: 5000, update: 1000, retries: 0,
      onCompromised: () => { process.stderr.write('Run lock lost; stopping.\n'); process.exit(1); },
    });
  } catch {
    throw new Error('Run is locked by another process. After a crash, wait 5 seconds before resuming.');
  }
  try {
    await privateDirectory(join(directory, 'logs'));
    // The manifest recovers a crash between allocating a run and its first Pi commit.
    const manifest = join(directory, 'manifest.json');
    if (initial) {
      const exists = await access(manifest).then(() => true, () => false);
      if (!exists) await atomicJson(manifest, initial);
      else {
        const admitted = JSON.parse(await readFile(manifest, 'utf8')) as Run;
        if (admitted.goal !== initial.goal || admitted.baseCommit !== initial.baseCommit ||
            JSON.stringify(admitted.config) !== JSON.stringify(initial.config)) {
          throw new Error('Run ID already exists with a different goal, base commit, or configuration. Use a new ID.');
        }
        initial = admitted;
      }
    } else {
      initial = JSON.parse(await readFile(manifest, 'utf8')) as Run;
      if (initial.repo !== repo || initial.directory !== directory) throw new Error('Run belongs to a different repository.');
    }
    const run = await drive(directory, initial, values['retry-interrupted'] ?? false, command === 'cancel');
    show(run);
    process.exitCode = run.status === 'complete' || run.status === 'cancelled' ? 0 : run.status === 'blocked' ? 2 : 1;
  } finally {
    await release();
  }
}

function show(run: Run): void {
  console.log(`${run.id}: ${run.status}\n${run.message}\nWorktree: ${run.workspace}\nLogs: ${join(run.directory, 'logs')}`);
}

main().catch(error => {
  console.error(`knight: ${(error as Error).message}`);
  if (!process.exitCode) process.exitCode = 1;
});
