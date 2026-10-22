import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from '../helpers.mjs';

test('real ChatGPT-authenticated Codex edits a worktree and passes build plus executable E2E', { timeout: 240_000 }, async t => {
  const f = await fixture(t, {}, { live: true, keep: process.env.KNIGHT_KEEP_LIVE === '1' });
  const originalChecks = await readFile(join(f.repo, 'verify.mjs'), 'utf8');
  const result = await f.run('run', 'Fix calculator.mjs so the calculator CLI adds two integer arguments instead of concatenating strings. Preserve all assertions in verify.mjs and do not change knight.json. This small repository has no dependencies to install. Verify with node build.mjs and node verify.mjs.', '--id', 'demo');
  assert.equal(result.code, 0, `${result.stdout}\n${result.stderr}`);
  const run = await f.status();
  assert.equal(run.status, 'complete');
  assert.equal(await readFile(join(f.workspace, 'verify.mjs'), 'utf8'), originalChecks);
  assert.deepEqual(run.executions.slice(-3).map(e => [e.step, e.status]), [['implement', 'passed'], ['build', 'passed'], ['e2e', 'passed']]);
  assert.equal(f.git('status', '--porcelain'), '');
  const log = await readFile(join(f.state, run.executions.find(e => e.step === 'implement').log), 'utf8');
  assert.match(log, /turn.completed/);
  if (process.env.KNIGHT_KEEP_LIVE === '1') console.log(`Live evidence retained at ${f.temp}`);
});
