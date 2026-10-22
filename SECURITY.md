# Security policy

Knight 2 is a **local, single-user tool for trusted repositories**. It is not a
service, a multi-tenant sandbox, or a way to safely execute hostile projects.
Only the current 2.x release is supported. Linux is the verified platform.

## Execution boundaries

- Knight asks the installed Codex CLI to use its existing ChatGPT sign-in. It
  does not read, copy, store, or publish Codex credential files. API-key
  environment overrides are removed from the Codex subprocess, and its login
  method is explicitly restricted to ChatGPT.
- Codex runs in a detached Git worktree with `workspace-write`, network access
  disabled for its shell tools, and approval policy `never`. The CLI still
  needs network access to ChatGPT. Knight never enables a sandbox bypass.
  User config is not loaded; host-enforced Codex policies still apply.
- A worktree protects the starting checkout from accidental edits. It is not
  a security boundary: worktrees share Git metadata, Codex can read outside
  its writable roots, and commands inherit the local user's environment.
- Build and E2E argument arrays are captured at admission. Changes to the
  worktree's `knight.json` cannot replace those commands. The commands run as
  the current user **outside Codex's sandbox**. Review the repository, its
  install scripts, and its checks before running it; use a disposable machine
  without production credentials for untrusted code.
- Passing a gate means its process exited zero, without timeout, signal,
  supervisor failure, or output overflow. It does not prove the generated
  code is correct or that its tests are sufficient. Review the diff and any
  changes to tests before accepting the work.
- Knight does not commit, push, merge, deploy, or publish generated work.
  The Codex prompt forbids these operations, but prompts are not access control.

## Local data and interruptions

`.knight/` is required to be Git-ignored. Run directories are private (`0700`),
and database, manifest, status, and log files are private (`0600` through the
process umask). Symlinked state directories are rejected. No credentials,
prompts, run logs, or live-test worktrees belong in an issue or pull request.
Logs may contain source code or secrets emitted by a command; permissions and
ignores do not redact or encrypt their contents. Keep backups private too.

Only one writer can own a run. A heartbeat lock expires five seconds after a
crash. Use local storage, not a shared/network filesystem. SQLite persists Pi
Durable tasks and documents. `status.json` is an atomic display snapshot of a
committed document; it can lag a commit if the process dies before export.
`resume` recovers from SQLite and refreshes the snapshot.

External effects are not exactly-once. If a process dies after a command starts
but before its receipt is committed, Knight marks it interrupted and requires
`resume --retry-interrupted`. Inspect the existing worktree and logs before
rerunning. Do not use this workflow for payments, deployments, or other
irreversible actions. The supervisor stops ordinary process-group descendants
on timeout, interrupt, or parent disconnect; a malicious program can escape a
process group. Abrupt machine/power failure can lose recent SQLite WAL commits.

## Repository controls

CI uses read-only GitHub permissions, does not persist checkout credentials,
pins Actions by commit, and never receives Codex credentials. It runs the build,
offline process-level E2E suite, dependency audit, and packaging check. Dependabot
tracks npm dependencies and Actions. A live subscription test must run locally;
never put a ChatGPT session credential in GitHub Actions secrets.

Recommended GitHub settings are a ruleset requiring `build-and-e2e`, review
before merge, no force pushes to `main`, secret scanning, and push protection.
Those are hosting settings; adding this file or CI does not enable them.

## Reporting

Use this repository's GitHub **Security → Report a vulnerability** action if
private reporting is enabled. If it is unavailable, open an issue asking the
maintainer for a private reporting channel without posting exploit details,
credentials, or private run artifacts. Do not disclose secrets in public issues.
