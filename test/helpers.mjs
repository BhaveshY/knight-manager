import { execFile, execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

export const root = dirname(dirname(fileURLToPath(import.meta.url)));
export const cliPath = join(root, 'dist/cli.js');
const exec = promisify(execFile);
export const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function fixture(t, scenario = {}, options = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'knight-e2e-'));
  const repo = join(temp, 'repo with spaces');
  const bin = join(temp, 'bin');
  await mkdir(repo);
  await mkdir(bin);
  if (!options.live) {
    await copyFile(join(root, 'test/fixtures/codex.mjs'), join(bin, 'codex'));
    await chmod(join(bin, 'codex'), 0o755);
  }
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
  if (!options.live) { env.OPENAI_API_KEY = 'fixture-must-not-reach-codex'; env.CODEX_API_KEY = 'fixture-must-not-reach-codex'; }
  const config = {
    version: 1, build: [process.execPath, 'build.mjs'], e2e: [process.execPath, 'verify.mjs'],
    maxAttempts: 3, timeoutMs: options.live ? 180_000 : 15_000,
    ...options.config,
  };
  const files = {
    '.gitignore': '.knight/\n.env\n',
    'knight.json': JSON.stringify(config),
    'scenario.json': JSON.stringify(scenario),
    'calculator.mjs': 'console.log(process.argv[2] + process.argv[3]);\n',
    'build.mjs': `import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const scenario = JSON.parse(readFileSync('scenario.json', 'utf8'));
if (scenario.outputFlood) process.stdout.write('x'.repeat(3 * 1024 * 1024));
if (scenario.timeout || (scenario.hangOnce && !existsSync('build-started'))) {
  writeFileSync('build-started', 'started');
  const grandchild = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });
  writeFileSync('child-pids.json', JSON.stringify([process.pid, grandchild.pid]));
  await new Promise(() => {});
}
execFileSync(process.execPath, ['--check', 'calculator.mjs'], { stdio: 'inherit' });
console.log('Build passed');
`,
    'verify.mjs': `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
for (const [a, b, expected] of [['7', '5', '12'], ['-3', '2', '-1']]) {
  const actual = execFileSync(process.execPath, ['calculator.mjs', a, b], { encoding: 'utf8' }).trim();
  assert.equal(actual, expected, 'calculator must add numbers');
}
console.log('E2E passed: calculator executable returns correct sums');
`,
  };
  for (const [name, text] of Object.entries(files)) await writeFile(join(repo, name), text);
  const git = (...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main');
  git('add', '.');
  git('-c', 'user.name=Knight E2E', '-c', 'user.email=e2e@example.invalid', 'commit', '-m', 'Fixture');
  const children = new Set();
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await once(child, 'exit'); }
    }
    if (!options.keep) await rm(temp, { recursive: true, force: true });
  });
  const run = async (...args) => {
    try {
      const result = await exec(process.execPath, [cliPath, ...args, '--repo', repo], { env, timeout: options.live ? 240_000 : 40_000, maxBuffer: 4 * 1024 * 1024 });
      return { code: 0, ...result };
    } catch (error) { return { code: error.code, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }; }
  };
  const start = (...args) => {
    const child = spawn(process.execPath, [cliPath, ...args, '--repo', repo], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    child.stdout.resume(); child.stderr.resume();
    return child;
  };
  const status = async (id = 'demo') => JSON.parse((await run('status', id, '--json')).stdout);
  return { temp, repo, env, git, run, start, status, config, state: join(repo, '.knight/runs/demo'), workspace: join(repo, '.knight/runs/demo/workspace') };
}

export async function until(callback, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { if (await callback()) return; } catch { /* State may not exist yet. */ }
    await delay(50);
  }
  throw new Error('Timed out waiting for observable process state.');
}

export async function processStopped(pid) {
  try {
    const stat = await readFile(`/proc/${pid}/stat`, 'utf8');
    return /^.*\) Z /.test(stat);
  } catch (error) { return error.code === 'ENOENT'; }
}
