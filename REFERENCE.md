# Knight Manager — Phase Protocols & Reference

This document contains detailed phase protocols, agent dispatch prompts, gate conditions, and the backtrack decision matrix. The Manager (SKILL.md) references this for all phase execution details.

---

## Phase 0: DETECT

**Action**: Manager reads working directory directly (no subagent needed).

**Detection logic**:
- Check for: `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `Makefile`, `.git`
- If NONE found → `project_type: "greenfield"`
- If ANY found → `project_type: "brownfield"`

**Output**: Set `project_type` and `project_dir` in `loop-state.json`

---

## Phase 1: GRILL

**Agent**: `knight-griller`
**Mode**: Foreground (interactive — needs user answers)
**Model**: Default (opus for quality)

**Dispatch prompt template**:
```
You are the Knight Griller. Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-griller.md

Session directory: {session_dir}
User's request: "{user_request}"
Project type: {project_type}

{if backtrack}
This is a BACKTRACK from {source_phase}. Read the diagnostic at:
{session_dir}/diagnostics/backtrack-{NNN}.json
Ask ONLY about the gap identified. Do not re-ask resolved questions.
{/if}

Write your output to: {session_dir}/requirements.md
```

**Gate**: Requirements completeness score >= 0.8 (set by griller in output)

---

## Phase 2a: SCAFFOLD (greenfield only)

**Agent**: `knight-scaffold`
**Mode**: Foreground
**Model**: Default

**Dispatch prompt template**:
```
You are the Knight Scaffold. Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-scaffold.md

Session directory: {session_dir}
Read requirements from: {session_dir}/requirements.md
Working directory: {project_dir}

Initialize the project, install dependencies, create configs.
Write env checklist to: {session_dir}/env-checklist.md
Update: {session_dir}/shared-notes.md with what you did.
```

**Gate**: Binary — project directory has package manager lock file AND `env-checklist.md` exists. If env vars are needed, ask user to confirm they're set.

---

## Phase 2b: EXPLORE (brownfield only)

**Agent**: `knight-explorer` (2 instances in parallel)
**Mode**: Foreground (both launched concurrently via Agent tool)
**Model**: sonnet (cost-efficient for read-only exploration)

**Dispatch**: Launch 2 explorer subagents in parallel:

**Explorer A — Architecture & Patterns**:
```
You are the Knight Explorer (Architecture Focus). Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-explorer.md

Session directory: {session_dir}
Read requirements from: {session_dir}/requirements.md
Project directory: {project_dir}

Focus on: project structure, architecture patterns, conventions, import style, error handling.
Write your output to: {session_dir}/exploration-architecture.md
```

**Explorer B — Relevant Code & Features**:
```
You are the Knight Explorer (Code Focus). Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-explorer.md

Session directory: {session_dir}
Read requirements from: {session_dir}/requirements.md
Project directory: {project_dir}

Focus on: files to modify, similar features as templates, shared utilities, test structure.
Write your output to: {session_dir}/exploration-code.md
```

**After both complete**: Manager merges `exploration-architecture.md` and `exploration-code.md` into a single `exploration.md`.

**Gate**: `exploration.md` exists and has content sections for: conventions, patterns, relevant files, test approach.

---

## Phase 3: ARCHITECT

**Agent**: `knight-architect`
**Mode**: Foreground
**Model**: Default (opus for planning quality)

**Dispatch prompt template**:
```
You are the Knight Architect. Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-architect.md

Session directory: {session_dir}
Read requirements: {session_dir}/requirements.md
{if greenfield}Read scaffold notes: {session_dir}/shared-notes.md{/if}
{if brownfield}Read exploration: {session_dir}/exploration.md{/if}

Create the implementation plan with research citations.
Define shared contracts in: {session_dir}/contracts/
Write plan to: {session_dir}/plan.md
Update: {session_dir}/shared-notes.md

{if backtrack}
This is a BACKTRACK. Read diagnostic: {session_dir}/diagnostics/backtrack-{NNN}.json
Revise ONLY the section identified in the diagnostic.
{/if}
```

**Gate**: `plan.md` exists with: task decomposition, file map, research citations (>= 2 tier-1 sources), contracts/ directory created. Then: ask user for approval via `AskUserQuestion` (unless `auto_approve: true` in loop-state).

---

## Phase 4: BUILD

**Agent**: `knight-engineer` (dispatched per task from plan)
**Mode**: Foreground (sequential by default), background only for explicitly independent tasks (max 2)
**Model**: Default

**Dispatch prompt template** (per task):
```
You are the Knight Engineer. Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-engineer.md

Session directory: {session_dir}
Task: {task_number} of {total_tasks}
Task description: {task_description}
Files to create/modify: {file_list}

Read the plan: {session_dir}/plan.md
Read contracts: {session_dir}/contracts/
Read shared notes: {session_dir}/shared-notes.md (for previous engineers' context)

Implement the task. Use types from contracts/.
After implementation: update {session_dir}/shared-notes.md with what you built.

{if backtrack}
This is a BACKTRACK. Read diagnostic: {session_dir}/diagnostics/backtrack-{NNN}.json
Fix ONLY the issue identified. Do not refactor unrelated code.
{/if}
```

**Gate**: All tasks complete. Each engineer's `build-task-{N}-result.json` shows `"compiled": true`. Project compiles/runs without errors. Each engineer updated shared-notes.

---

## Phase 5: REVIEW

**Agent**: `knight-reviewer` (2 instances in parallel)
**Mode**: Foreground (both launched concurrently via Agent tool)
**Model**: sonnet (analysis task, launched 2x in parallel for cost efficiency)

**Dispatch**: Launch 2 reviewer subagents in parallel:

**Reviewer A — Bugs & Security**:
```
You are the Knight Reviewer (Bugs & Security Focus). Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-reviewer.md

Session directory: {session_dir}
Read plan: {session_dir}/plan.md
Read contracts: {session_dir}/contracts/
Read requirements: {session_dir}/requirements.md

Focus on: bugs, logic errors, security vulnerabilities, crash risks, data loss risks.
Only report issues scoring >= 80 on the confidence rubric.

Write issues to: {session_dir}/review-issues-bugs.json
Format: [{"severity": "critical|major|minor", "file": "...", "line": N, "issue": "...", "suggestion": "...", "confidence": N}]
```

**Reviewer B — Plan Alignment & Contracts**:
```
You are the Knight Reviewer (Alignment Focus). Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-reviewer.md

Session directory: {session_dir}
Read plan: {session_dir}/plan.md
Read contracts: {session_dir}/contracts/
Read requirements: {session_dir}/requirements.md

Focus on: plan alignment, contract compliance, missing requirements, architectural deviations.
Only report issues scoring >= 80 on the confidence rubric.

Write issues to: {session_dir}/review-issues-alignment.json
Format: [{"severity": "critical|major|minor", "file": "...", "line": N, "issue": "...", "suggestion": "...", "confidence": N}]
```

**After both complete**: Manager merges `review-issues-bugs.json` and `review-issues-alignment.json` into a single `review-issues.json`, deduplicating by file+line. Updates `shared-notes.md` with summary.

**Gate**: 0 critical issues in `review-issues.json`. If critical issues found → backtrack per matrix.

---

## Phase 6: DESLOPIFY

**Agent**: `knight-deslopifier`
**Mode**: Foreground
**Model**: Default

**Dispatch prompt template**:
```
You are the Knight Deslopifier. Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-deslopifier.md

Session directory: {session_dir}
Read plan: {session_dir}/plan.md
Read review issues (non-critical): {session_dir}/review-issues.json

Apply small, safe refactors: simplify complexity, improve naming, extract reuse, fix performance.
Do NOT change behavior. Do NOT introduce new features.

Write results to: {session_dir}/deslopify-result.json
Update: {session_dir}/shared-notes.md with changes made.
```

**Gate**: Compilation check only — `deslopify-result.json` must show `"compiled": true`. Test regressions are caught by the TESTER phase (not here).

---

## Phase 7: TEST

**Agent**: `knight-tester`
**Mode**: Foreground
**Model**: Default

**Dispatch prompt template**:
```
You are the Knight Tester. Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-tester.md

Session directory: {session_dir}
Read requirements: {session_dir}/requirements.md
Read plan: {session_dir}/plan.md
Read env checklist: {session_dir}/env-checklist.md (if exists)

FIRST: Check env vars from env-checklist.md. If any required vars are missing,
write "ENV_MISSING" to {session_dir}/test-result.json and list what's missing.
Do NOT proceed with tests if env vars are missing.

Create unit tests + integration test stubs (with mocks for external APIs).
Run the test suite.

Write results to: {session_dir}/test-result.json
Format: {"pass_rate": N, "coverage": N, "failures": [...], "env_status": "ok|missing"}
Update: {session_dir}/shared-notes.md
```

**Gate**: `pass_rate == 100%` AND `env_status == "ok"`. If env missing → escalate to user. If failures → backtrack per matrix.

---

## Phase 8: VERIFY

**Agent**: `knight-verifier`
**Mode**: Foreground
**Model**: Default

**Dispatch prompt template**:
```
You are the Knight Verifier. Read the agent instructions at:
~/.claude/skills/knight-manager/agents/knight-verifier.md

Session directory: {session_dir}
Read requirements: {session_dir}/requirements.md
Read plan: {session_dir}/plan.md

Run independently (do not trust previous agents' reports):
1. Build the project
2. Run linter
3. Run type checker
4. Run full test suite
5. Check requirements line-by-line against requirements.md

Write results to: {session_dir}/verify-result.json
Format: {"build": "pass|fail", "lint": "pass|fail", "types": "pass|fail",
         "tests": "pass|fail", "requirements_checklist": [{"req": "...", "met": bool}],
         "overall": "pass|fail", "details": "..."}
Update: {session_dir}/shared-notes.md
```

**Gate**: ALL checks pass (`overall == "pass"`). If any fail → backtrack per matrix.

---

## Backtrack Decision Matrix

> **The backtrack matrix is authoritative.** Verifier's `suggested_backtrack` and other agents' recommendations are advisory — the Manager always follows the matrix.

```
FAILURE POINT    | FAILURE TYPE                        | BACKTRACK TARGET
─────────────────┼─────────────────────────────────────┼─────────────────────
GRILL            | Completeness < 0.8 after 3 attempts | → USER (escalate)
─────────────────┼─────────────────────────────────────┼─────────────────────
SCAFFOLD         | Project doesn't build               | → SCAFFOLD (retry, max 3)
SCAFFOLD         | Missing dependency unclear           | → USER (ask)
─────────────────┼─────────────────────────────────────┼─────────────────────
EXPLORE          | Incomplete analysis                  | → EXPLORE (retry with narrower scope)
─────────────────┼─────────────────────────────────────┼─────────────────────
ARCHITECT        | Plan unclear to eng                  | → ARCHITECT (clarify)
ARCHITECT        | Codebase mismatch                    | → EXPLORER (re-analyze)
─────────────────┼─────────────────────────────────────┼─────────────────────
ENGINEER         | Contract mismatch                    | → ARCHITECT (fix contract)
ENGINEER         | Dependency issue                     | → SCAFFOLD (fix deps)
─────────────────┼─────────────────────────────────────┼─────────────────────
REVIEWER         | Critical bug                         | → ENGINEER (with issues)
REVIEWER         | Plan misalignment                    | → ARCHITECT (revise)
REVIEWER         | Missing requirement                  | → GRILLER (fill gap)
─────────────────┼─────────────────────────────────────┼─────────────────────
DESLOPIFIER      | Introduced bug                       | → DESLOPIFIER (revert+redo)
DESLOPIFIER      | Merge conflict                       | → ENGINEER (resolve)
─────────────────┼─────────────────────────────────────┼─────────────────────
TESTER           | Test failures                        | → ENGINEER (stack traces)
TESTER           | Test regression after deslopify      | → DESLOPIFIER (revert+redo)
TESTER           | Low coverage                         | → TESTER (add tests)
TESTER           | Missing env vars                     | → USER (ask for keys)
TESTER           | Edge case unclear                    | → GRILLER (clarify)
─────────────────┼─────────────────────────────────────┼─────────────────────
VERIFIER         | Build fails                          | → ENGINEER (build log)
VERIFIER         | Lint errors                          | → ENGINEER (lint output)
VERIFIER         | Type errors                          | → ENGINEER (type errors)
VERIFIER         | Test regression                      | → ENGINEER (test + diff)
VERIFIER         | Req checklist fail                   | → ARCHITECT (revise plan)
```

### Cascade Rules

When backtracking to an earlier phase, ALL subsequent phases must re-run:
```
GRILLER backtrack     → re-run ARCHITECT → BUILD → REVIEW → DESLOPIFY → TEST → VERIFY
SCAFFOLD backtrack    → re-run ARCHITECT → BUILD → REVIEW → DESLOPIFY → TEST → VERIFY
EXPLORER backtrack    → re-run ARCHITECT → BUILD → REVIEW → DESLOPIFY → TEST → VERIFY
ARCHITECT backtrack   → re-run BUILD → REVIEW → DESLOPIFY → TEST → VERIFY
ENGINEER backtrack    → re-run from REVIEW → DESLOPIFY → TEST → VERIFY
DESLOPIFIER backtrack → re-run DESLOPIFY → TEST → VERIFY
```

### Safety Limits

- **Max 3 retries** per backtrack target per phase
- **Max 10 total backtracks** per session
- After limits: escalate to user with full diagnostic bundle

---

## Diagnostic Bundle Format

```json
{
  "backtrack_id": 3,
  "timestamp": "2026-03-04T19:15:00Z",
  "from_phase": "reviewer",
  "to_phase": "engineer",
  "failure_type": "critical_bug",
  "description": "Missing error handler for WebSocket disconnect",
  "evidence": {
    "file": "src/ws-handler.ts",
    "line": 45,
    "snippet": "ws.on('message', ...) // no error/close handler",
    "suggestion": "Add ws.on('error') and ws.on('close') handlers"
  },
  "previous_attempts": 0,
  "context_files": ["src/ws-handler.ts", "contracts/types.ts"]
}
```

---

## Confidence Scoring Reference

| Agent       | Metrics                                                           |
|-------------|-------------------------------------------------------------------|
| Griller     | # functional reqs, # edge cases, # architect-decides items       |
| Scaffold    | Binary: project builds and deps install (1.0 or 0.0)            |
| Architect   | tier1_sources>=2 (0.4) + context7_validated (0.3) + alternatives_compared (0.2) + risks_documented (0.1) |
| Explorer    | Files analyzed, patterns documented, conventions found           |
| Engineer    | Compiles, tests pass, follows contracts, matches plan task       |
| Reviewer    | Issue count by severity (independently counted)                  |
| Deslopifier | Complexity delta, no new test failures                           |
| Tester      | Pass rate (%), coverage (%)                                      |
| Verifier    | Binary per check: build/lint/test/types/reqs                    |

---

## Loop State Schema

```json
{
  "session_id": "knight-YYYYMMDD-HHmmss",
  "project_type": "greenfield|brownfield",
  "project_dir": "/absolute/path/to/project",
  "user_request": "original user request text",
  "current_phase": "detect|grill|scaffold|explore|architect|build|review|deslopify|test|verify|complete",
  "current_phase_attempt": 1,
  "total_backtracks": 0,
  "max_backtracks": 10,
  "tokens_used_estimate": 0,
  "auto_approve": false,
  "phase_history": [
    {
      "phase": "grill",
      "attempts": 1,
      "confidence": 0.92,
      "status": "complete|in_progress|failed"
    }
  ],
  "backtrack_history": [
    {
      "id": 1,
      "from": "reviewer",
      "to": "engineer",
      "reason": "missing error handler",
      "resolved": true
    }
  ],
  "build_tasks": [
    {
      "task_number": 1,
      "description": "...",
      "files": ["..."],
      "status": "pending|in_progress|complete",
      "parallel_safe": false
    }
  ],
  "active_subagent": null,
  "checkpoint": "Human-readable description of current state"
}
```
