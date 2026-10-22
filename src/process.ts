import { execFileSync, fork, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export type Command = {
  argv: string[];
  cwd: string;
  input: string;
  log: string;
  timeoutMs: number;
  codex: boolean;
};
export type Result = { exitCode: number | null; signal: string | null; error: string | null };

export function capture(argv: string[], cwd: string): string {
  try {
    return execFileSync(argv[0]!, argv.slice(1), {
      cwd, encoding: 'utf8', timeout: 15_000, maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    throw new Error(`Could not run ${argv[0]} ${argv[1] ?? ''}. Check installation, permissions, and repository state.`);
  }
}

export function checkCodex(repo: string): void {
  const version = capture(['codex', '--version'], repo).match(/codex-cli (\d+)\.(\d+)\.(\d+)/);
  if (!version || (Number(version[1]) === 0 && Number(version[2]) < 163)) {
    throw new Error('Codex CLI 0.163.0 or newer is required.');
  }
  // Codex writes login status to stderr. Do not read or copy its credential files.
  let output = '';
  try {
    const status = spawnSync('codex', ['login', 'status'], {
      cwd: repo, encoding: 'utf8', timeout: 15_000, maxBuffer: 64 * 1024,
      env: subscriptionEnv(),
    });
    if (status.status === 0) output = `${status.stdout ?? ''}\n${status.stderr ?? ''}`;
  } catch { /* Report only the authentication mode, never raw credential output. */ }
  if (!output.includes('Logged in using ChatGPT')) {
    throw new Error('Codex is not signed in with ChatGPT. Run codex login locally, then knight doctor.');
  }
}

// The subprocess keeps the existing subscription authentication and proxy settings.
export function subscriptionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  return env;
}

export function execute(command: Command, signal: AbortSignal): Promise<Result> {
  if (signal.aborted) return Promise.reject(new Error('Interrupted'));
  return new Promise((resolve, reject) => {
    const worker = fork(fileURLToPath(new URL('./worker.js', import.meta.url)), [], {
      stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
      env: command.codex ? subscriptionEnv() : process.env,
    });
    const abort = () => { if (worker.connected) worker.send({ type: 'abort' }); };
    signal.addEventListener('abort', abort, { once: true });
    let result: Result | undefined;
    worker.on('message', message => { result = message as Result; });
    worker.on('error', reject);
    worker.on('exit', () => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) reject(new Error('Interrupted'));
      else resolve(result ?? { exitCode: null, signal: null, error: 'Command supervisor exited without a receipt.' });
    });
    worker.send(command);
  });
}
