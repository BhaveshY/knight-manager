# Knight Manager

A local development runner built on **Pi Durable** and the **Codex CLI**.
Give it a goal in a trusted Git repository. Knight creates a separate worktree,
asks Codex to implement the change using your ChatGPT subscription, and runs
the project's build and end-to-end checks. Failed checks feed a bounded repair
loop. Every step has a persisted receipt.

```text
clean Git commit → isolated worktree → Codex → build → E2E → ready for review
                                         ↑       failure ↲
                                         └──── repair (bounded)
```

This replaces the old Claude prompt pack with an executable workflow.

## Install

Requires **Linux, Node 24+, Git, and Codex CLI 0.163.0+**. macOS and Windows are
not supported by this release. Install Codex using its [official instructions](https://github.com/openai/codex),
then sign in locally with `codex login` using ChatGPT. Knight requires no API key.
Subscription entitlements, usage limits, and network access still apply.

```sh
git clone https://github.com/BhaveshY/knight-manager.git
cd knight-manager
npm ci --ignore-scripts
npm run build
node dist/cli.js --help
```

Use the absolute path to `dist/cli.js` from another project, or run `npm link`
to make `knight` available on your PATH. The package is not published to npm.

## Run a project

```sh
cd /path/to/your/project
knight init
# Review knight.json and set commands that build and test this project.
git add knight.json .gitignore
git commit -m "Configure Knight build and E2E gates"
knight doctor
knight run "Fix the checkout flow and verify it end to end" --id checkout-fix
knight status checkout-fix
```

Start from a clean checkout with `knight.json` committed. Uncommitted source
files, ignored files, `.env`, and existing `node_modules` are not copied into
the new worktree. Put required dependency setup in your build command, or
prepare an offline build environment before running. Build and E2E commands
run on the host; Codex's shell network is disabled.

`doctor` checks the installed CLI and its reported sign-in method. Only an
actual coding run proves that the saved sign-in can authenticate to ChatGPT.

The run prints the worktree and log paths. Inspect all changed and untracked
files there, including tests. Keep or integrate the changes with your normal
Git workflow. Knight never commits, pushes, or merges on your behalf.

## Configuration

```json
{
  "version": 1,
  "build": ["npm", "run", "build"],
  "e2e": ["npm", "run", "test:e2e"],
  "maxAttempts": 3,
  "timeoutMs": 600000
}
```

Commands are argument arrays passed directly to the executable. Shell syntax,
variable expansion, and `&&` are not interpreted. Put multi-command setup in
a reviewed project script. Both gates are required. Unknown fields and malformed
commands are rejected. `maxAttempts` is 1–5 (including the initial coding
attempt); `timeoutMs` is 100–3,600,000 per command. Each command's combined output
is capped at 2 MiB; overflow fails the step. Codex failures stop immediately;
build/E2E failures trigger repair until the attempt budget is exhausted.

The admitted goal, base commit, and configuration are immutable for a run ID.
Repeating the same request returns its saved result. A different request with
that ID is rejected. Start a new ID after changing the goal or configuration.

## Recover work

```sh
knight status checkout-fix --json
knight resume checkout-fix
# If a step was interrupted, inspect its worktree and logs first:
knight resume checkout-fix --retry-interrupted
```

Pi Durable 1.4.0 owns the SQLite-backed task and document checkpoints. Finished
steps are not replayed. An interrupted external command has an uncertain
outcome, so recovery blocks it until you explicitly request a retry. A retry
uses the existing worktree and runs that step again. There is no exactly-once
guarantee for external side effects.

Ctrl-C stops the active command and retains the run. After a hard crash, wait
five seconds for the writer lock to expire. To abandon a stopped run:

```sh
knight cancel checkout-fix
```

Worktrees and logs are retained even after failure or cancellation. To remove
one after reviewing or saving its changes, use `git worktree remove` on the
printed workspace path, then delete that run's state directory. Knight does
not automatically discard work.

Exit codes: `0` for completed/cancelled runs and successful read commands, `1`
for failed runs or invalid commands, `2` for recovery awaiting explicit replay,
and `130` for an interrupted foreground run. `status` reports the latest exported
committed snapshot; `resume` refreshes it from SQLite after a crash.

## Verify this project

```sh
npm run build
npm run test:e2e
# Uses your real Codex sign-in and subscription:
npm run test:live
```

All tests exercise the public CLI through real OS processes, temporary Git
repositories, worktrees, and SQLite files. There are no unit tests. The offline
E2E suite substitutes a deterministic **Codex executable fixture** to reproduce
failures, timeouts, and crashes. It does not prove model behavior or subscription
access. The separate live E2E asks the real Codex CLI to fix a calculator, runs
the build and executable checks, and verifies that the starting checkout and
test assertions remain unchanged. A failed live test is a failure, never a skip
or a substitute response. See [verification evidence](docs/verification.md).

## Code map

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | CLI, preflight, immutable admission, writer lock |
| `src/runtime.ts` | Pi Durable workflow, Codex invocation, repair and recovery |
| `src/state.ts` | Typed durable state, private directories, status export |
| `src/process.ts`, `src/worker.ts` | Argument-based execution and process supervision |
| `src/config.ts` | Strict build/E2E configuration |
| `test/e2e/`, `test/live/` | CLI E2E coverage and real subscription check |

Read [SECURITY.md](SECURITY.md) for the execution and credential boundaries.
MIT licensed.
