#!/usr/bin/env node
// A deterministic executable at the Codex process boundary for offline E2E.
// The separate live suite uses the installed, authenticated Codex executable.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const args = process.argv.slice(2);
if (args[0] === '--version') { console.log('codex-cli 0.163.0'); process.exit(0); }
assert.equal(process.env.OPENAI_API_KEY, undefined);
assert.equal(process.env.CODEX_API_KEY, undefined);
if (args[0] === 'login') { console.error('Logged in using ChatGPT'); process.exit(0); }
assert.equal(args[0], 'exec');
assert(args.includes('--ignore-user-config'));
assert(args.includes('--ephemeral'));
assert.equal(args[args.indexOf('--sandbox') + 1], 'workspace-write');
assert(args.includes('approval_policy="never"'));
assert(args.includes('sandbox_workspace_write.network_access=false'));
assert(!args.includes('--dangerously-bypass-approvals-and-sandbox'));
assert.equal(args.at(-1), '-');
let input = '';
for await (const chunk of process.stdin) input += chunk;
appendFileSync('codex-calls.jsonl', `${JSON.stringify({ args, input })}\n`);
const scenario = JSON.parse(readFileSync('scenario.json', 'utf8'));
const count = existsSync('attempt.txt') ? Number(readFileSync('attempt.txt', 'utf8')) + 1 : 1;
writeFileSync('attempt.txt', String(count));
if (scenario.codexFailure) { console.error('Provider unavailable'); process.exit(17); }
if (scenario.changeConfig) writeFileSync('knight.json', '{"build":["true"],"e2e":["true"]}');
if (count < (scenario.fixAfter ?? 1)) writeFileSync('calculator.mjs', "console.log('wrong');\n");
else if (count < (scenario.syntaxAfter ?? 1)) writeFileSync('calculator.mjs', 'not valid javascript @!');
else writeFileSync('calculator.mjs', 'console.log(Number(process.argv[2]) + Number(process.argv[3]));\n');
console.log(JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }));
