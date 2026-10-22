# Verification record

This file records observed results, not a guarantee for every machine or model.
Current verification is on Linux with Node 24.19.0 and Codex CLI 0.163.0.

## Commands

- `npm run build` — compiles strict TypeScript against the pinned Pi Durable 1.4.0 APIs.
- `npm run test:e2e` — real CLI processes, Git worktrees, SQLite storage, a
  deterministic Codex executable fixture, and real build/E2E subprocesses.
- `npm run test:live` — real installed Codex with ChatGPT sign-in; fixes a
  calculator in a separate worktree and checks the executable's outputs.
- `npm audit` — dependency advisory check at verification time.
- `npm pack --dry-run` — inspect the package allowlist for private artifacts.

## Observed local results (2026-10-22)

- Build: passed.
- Offline E2E: **15 passed, 0 failed, 0 skipped**. Coverage includes both repair
  paths, bounded failure, process crashes and descendant cleanup, explicit
  replay, cancellation, timeouts, output bounds, duplicate/conflicting IDs,
  immutable gate commands, path/symlink rejection, initialization, and
  subscription-mode enforcement.
- Dependency audit, including development dependencies: **0 reported vulnerabilities**.
- Package allowlist: runtime JavaScript, package metadata, README, security
  policy, verification record, and license only; no state, credentials, or test workspaces.
- Packed tarball installed into a separate temporary npm prefix; installed
  `knight --version` and `knight --help` both passed.

## Live authentication limitation (2026-10-22)

The managed workspace's `codex login status` reports ChatGPT sign-in. A real
request to ChatGPT returned HTTP 401 and a token-refresh failure. Codex did not
implement the fixture change. The live E2E failed, and Knight correctly marked
the run failed without executing its build or E2E gates.

The cloud workspace also mounts Codex's home read-only by default. The live
probe was granted access to that directory for Codex's normal installation
metadata writes; the later failure was authentication, not filesystem access.
No credential was read, copied, or added to the repository. Knight keeps its
Codex state databases and logs in each private run directory.

**The real subscription coding path remains unverified until this test passes
with a usable local Codex sign-in.** Do not treat passing fixture-based E2E as
proof that the model-backed workflow is working.

GitHub reports no repository rulesets. The connected integration cannot read
branch-protection settings (HTTP 403), so those protections are unverified.
