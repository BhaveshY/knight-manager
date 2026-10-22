import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile, stat, writeFile, symlink, mkdir, rm, readdir, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, delay, until, processStopped } from '../helpers.mjs';

test('CLI completes an isolated workflow with durable receipts and idempotent run IDs', async t => {
  const f = await fixture(t);
  const goal = 'Fix addition; $(touch injected) `touch injected`';
  const result = await f.run('run', goal, '--id', 'demo');
  assert.equal(result.code, 0, result.stderr);
  const run = await f.status();
  assert.equal(run.status, 'complete');
  assert.deepEqual(run.executions.map(e => [e.step, e.status]), ['prepare', 'implement', 'build', 'e2e'].map(step => [step, 'passed']));
  assert.equal(f.git('status', '--porcelain'), '');
  assert.match(await readFile(join(f.repo, 'calculator.mjs'), 'utf8'), /argv\[2\] \+ process.argv\[3\]/);
  assert.match(await readFile(join(f.workspace, 'calculator.mjs'), 'utf8'), /Number/);
  assert.equal((await readFile(join(f.state, 'session.sqlite'))).subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal((await stat(f.state)).mode & 0o077, 0);
  assert.equal((await stat(join(f.state, 'session.sqlite'))).mode & 0o077, 0);
  assert.equal((await stat(join(f.state, 'logs/002-implement.log'))).mode & 0o077, 0);
  const calls = (await readFile(join(f.workspace, 'codex-calls.jsonl'), 'utf8')).trim().split('\n');
  assert.equal(JSON.parse(calls[0]).input.includes(goal), true);
  await assert.rejects(stat(join(f.workspace, 'injected')), { code: 'ENOENT' });
  assert.equal((await f.run('run', goal, '--id', 'demo')).code, 0);
  assert.equal((await f.status()).executions.length, 4);
  assert.notEqual((await f.run('run', 'Different goal', '--id', 'demo')).code, 0);
});

for (const [label, scenario, gate] of [['build', { syntaxAfter: 2 }, 'build'], ['E2E', { fixAfter: 2 }, 'e2e']]) {
  test(`a failed ${label} gate feeds diagnostics to Codex and reruns both checks`, async t => {
    const f = await fixture(t, scenario);
    const result = await f.run('run', 'Fix addition', '--id', 'demo');
    assert.equal(result.code, 0, result.stderr);
    const run = await f.status();
    assert.equal(run.attempt, 2);
    assert.equal(run.executions.find(e => e.status === 'failed').step, gate);
    assert.deepEqual(run.executions.slice(-3).map(e => [e.step, e.status]), [['implement', 'passed'], ['build', 'passed'], ['e2e', 'passed']]);
    const calls = (await readFile(join(f.workspace, 'codex-calls.jsonl'), 'utf8')).trim().split('\n').map(JSON.parse);
    assert.match(calls[1].input, /Previous .* failed/);
    assert.match(calls[1].input, /<diagnostics>/);
  });
}

test('repair budget terminates with failure and never accepts modified check configuration', async t => {
  const f = await fixture(t, { fixAfter: 99, changeConfig: true }, { config: { maxAttempts: 2 } });
  const result = await f.run('run', 'Fix addition', '--id', 'demo');
  assert.equal(result.code, 1, result.stderr);
  const run = await f.status();
  assert.equal(run.status, 'failed');
  assert.equal(run.attempt, 2);
  assert.equal(run.executions.filter(e => e.step === 'implement').length, 2);
  assert.equal(run.executions.at(-1).step, 'e2e');
  assert.equal((await f.run('resume', 'demo')).code, 1);
});

test('Codex failure cannot pass by running successful gates', async t => {
  const f = await fixture(t, { codexFailure: true });
  assert.equal((await f.run('run', 'Fix addition', '--id', 'demo')).code, 1);
  const run = await f.status();
  assert.equal(run.status, 'failed');
  assert.equal(run.executions.at(-1).result.exitCode, 17);
  assert.equal(run.executions.some(e => e.step === 'build'), false);
});

test('SIGKILL recovery stops descendants, preserves completed steps, and requires explicit replay', async t => {
  const f = await fixture(t, { hangOnce: true });
  const child = f.start('run', 'Fix addition', '--id', 'demo');
  await until(async () => (await readFile(join(f.workspace, 'child-pids.json'), 'utf8')).length > 0);
  const pids = JSON.parse(await readFile(join(f.workspace, 'child-pids.json'), 'utf8'));
  const locked = await f.run('resume', 'demo');
  assert.notEqual(locked.code, 0);
  assert.match(locked.stderr, /locked/);
  child.kill('SIGKILL');
  await once(child, 'exit');
  await until(async () => (await Promise.all(pids.map(processStopped))).every(Boolean));
  await delay(5200);
  const blocked = await f.run('resume', 'demo');
  assert.equal(blocked.code, 2, blocked.stderr);
  assert.equal((await f.status()).status, 'blocked');
  const resumed = await f.run('resume', 'demo', '--retry-interrupted');
  assert.equal(resumed.code, 0, resumed.stderr);
  const run = await f.status();
  assert.equal(run.status, 'complete');
  assert.equal(run.executions.filter(e => e.step === 'implement').length, 1);
  assert.deepEqual(run.executions.filter(e => e.step === 'build').map(e => e.status), ['interrupted', 'passed']);
});

test('Ctrl-C stops work and a stopped run can be cancelled without replay', async t => {
  const f = await fixture(t, { hangOnce: true });
  const child = f.start('run', 'Fix addition', '--id', 'demo');
  await until(async () => (await readFile(join(f.workspace, 'child-pids.json'), 'utf8')).length > 0);
  child.kill('SIGINT');
  await once(child, 'exit');
  const result = await f.run('cancel', 'demo');
  assert.equal(result.code, 0, result.stderr);
  const run = await f.status();
  assert.equal(run.status, 'cancelled');
  assert.equal(run.executions.at(-1).status, 'interrupted');
  assert.equal(run.executions.some(e => e.step === 'e2e'), false);
});

test('timeouts fail the gate and terminate command descendants', async t => {
  const f = await fixture(t, { timeout: true }, { config: { timeoutMs: 1200, maxAttempts: 1 } });
  assert.equal((await f.run('run', 'Fix addition', '--id', 'demo')).code, 1);
  const run = await f.status();
  assert.match(run.executions.at(-1).result.error, /timed out/);
  const pids = JSON.parse(await readFile(join(f.workspace, 'child-pids.json'), 'utf8'));
  await until(async () => (await Promise.all(pids.map(processStopped))).every(Boolean));
});

test('excessive output fails instead of silently discarding verification evidence', async t => {
  const f = await fixture(t, { outputFlood: true }, { config: { maxAttempts: 1 } });
  assert.equal((await f.run('run', 'Fix addition', '--id', 'demo')).code, 1);
  const run = await f.status();
  assert.match(run.executions.at(-1).result.error, /log limit/);
  assert.equal((await stat(join(f.state, run.executions.at(-1).log))).size, 2 * 1024 * 1024);
});

test('dirty repositories, malformed configuration, and path traversal are rejected before execution', async t => {
  const f = await fixture(t);
  assert.notEqual((await f.run('run', 'Fix addition', '--id', '../escape')).code, 0);
  await writeFile(join(f.repo, 'uncommitted'), 'keep me');
  assert.match((await f.run('run', 'Fix addition', '--id', 'demo')).stderr, /must be clean/);
  await writeFile(join(f.repo, 'knight.json'), JSON.stringify({ ...f.config, build: 'echo insecure' }));
  assert.match((await f.run('run', 'Fix addition', '--id', 'demo')).stderr, /argument array/);
  assert.equal(await readFile(join(f.repo, 'uncommitted'), 'utf8'), 'keep me');
});

test('symlinked state directory cannot redirect local data writes', async t => {
  const f = await fixture(t);
  const target = join(f.temp, 'redirect');
  await mkdir(target);
  await symlink(target, join(f.repo, '.knight'));
  assert.match((await f.run('run', 'Fix addition', '--id', 'demo')).stderr, /symlink/);
  assert.deepEqual(await readdir(target), []);
});

test('doctor checks the reported subscription sign-in method and CLI help is available', async t => {
  const f = await fixture(t);
  const result = await f.run('doctor');
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /ChatGPT/);
  assert.equal((await f.run('--help')).code, 0);
});

test('init creates configuration without overwriting existing configuration or following symlinks', async t => {
  const f = await fixture(t);
  await rm(join(f.repo, 'knight.json'));
  const result = await f.run('init');
  assert.equal(result.code, 0, result.stderr);
  const config = await readFile(join(f.repo, 'knight.json'), 'utf8');
  assert.deepEqual(JSON.parse(config).e2e, ['npm', 'run', 'test:e2e']);
  assert.match(await readFile(join(f.repo, '.gitignore'), 'utf8'), /\.knight\//);
  assert.notEqual((await f.run('init')).code, 0);
  assert.equal(await readFile(join(f.repo, 'knight.json'), 'utf8'), config);
  await rm(join(f.repo, 'knight.json'));
  await rm(join(f.repo, '.gitignore'));
  const target = join(f.temp, 'outside-ignore');
  await writeFile(target, 'do not change');
  await symlink(target, join(f.repo, '.gitignore'));
  assert.notEqual((await f.run('init')).code, 0);
  assert.equal(await readFile(target, 'utf8'), 'do not change');
});

test('missing executables fail the real process gate and cannot report completion', async t => {
  const f = await fixture(t, {}, { config: { build: ['knight-command-that-does-not-exist'], maxAttempts: 1 } });
  assert.equal((await f.run('run', 'Fix addition', '--id', 'demo')).code, 1);
  const run = await f.status();
  assert.equal(run.status, 'failed');
  assert.match(run.executions.at(-1).result.error, /ENOENT/);
  assert.equal(run.executions.some(e => e.step === 'e2e'), false);
});

test('a non-subscription Codex sign-in is rejected before work is admitted', async t => {
  const f = await fixture(t);
  await writeFile(join(f.temp, 'bin/codex'), `#!/usr/bin/env node\nif (process.argv.includes('--version')) console.log('codex-cli 0.163.0'); else console.log('Logged in using an API key');\n`);
  await chmod(join(f.temp, 'bin/codex'), 0o755);
  assert.match((await f.run('doctor')).stderr, /not signed in with ChatGPT/);
  assert.notEqual((await f.run('run', 'Fix addition', '--id', 'demo')).code, 0);
  await assert.rejects(stat(f.state), { code: 'ENOENT' });
});
