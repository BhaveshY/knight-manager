# Knight Manager

An autonomous development lifecycle orchestrator for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). It takes a vague idea and delivers a verified implementation by coordinating 9 specialized sub-agents through a closed-loop state machine with backtracking, diagnostics, and compaction resilience.

## How it works

The Manager runs an adaptive pipeline that detects whether you're starting from scratch (greenfield) or modifying an existing project (brownfield), then routes through the appropriate phases:

```
DETECT -> GRILL -> [SCAFFOLD | EXPLORE] -> ARCHITECT -> BUILD -> REVIEW -> DESLOPIFY -> TEST -> VERIFY -> COMPLETE
```

- **Greenfield** (no existing project files): GRILL -> SCAFFOLD -> ARCHITECT -> ...
- **Brownfield** (existing repo): GRILL -> EXPLORE -> ARCHITECT -> ...

Each phase has a gate condition. If a gate fails, the Manager consults a backtrack matrix to determine which earlier phase to re-run, attaching a diagnostic bundle so the target agent knows exactly what went wrong.

### Pipeline phases

| Phase | What happens |
|-------|-------------|
| **DETECT** | Manager reads the working directory to classify greenfield vs brownfield |
| **GRILL** | Interrogates the user to extract complete requirements from the vague request |
| **SCAFFOLD** | (Greenfield) Bootstraps the project: package manager, deps, configs |
| **EXPLORE** | (Brownfield) Two parallel agents analyze architecture and relevant code |
| **ARCHITECT** | Creates an implementation plan backed by research citations and shared contracts |
| **BUILD** | Engineers implement tasks sequentially, reading contracts and shared notes |
| **REVIEW** | Two parallel reviewers check for bugs/security and plan alignment |
| **DESLOPIFY** | Single cleanup pass: simplify complexity, improve naming, extract reuse |
| **TEST** | Creates and runs tests, checks env vars, reports pass rate and coverage |
| **VERIFY** | Independent final gate: build, lint, types, tests, requirements checklist |

## Agents

| Agent | Role | Model |
|-------|------|-------|
| **Knight Griller** | Requirements interrogator | opus |
| **Knight Scaffold** | Project bootstrapper (greenfield) | opus |
| **Knight Explorer** | Codebase analyst (brownfield, 2x parallel) | sonnet |
| **Knight Architect** | Planner, researcher, contract definer | opus |
| **Knight Engineer** | Implementation specialist (1 per task) | opus |
| **Knight Reviewer** | Code review specialist (2x parallel) | sonnet |
| **Knight Deslopifier** | Code cleanup specialist | opus |
| **Knight Tester** | Test creator and runner | opus |
| **Knight Verifier** | Final independent gate checker | opus |

All agents are dispatched as `general-purpose` subagents via the Claude Code Agent tool. Each reads its instructions from `agents/knight-*.md` and writes structured output to the session directory.

## Key features

- **Adaptive pipeline** -- greenfield and brownfield projects take different paths through the same state machine
- **Backtrack matrix** -- a deterministic table mapping every failure type at every phase to the correct earlier phase, with cascade rules that re-run all downstream phases
- **Compaction resilience** -- pre-compact and post-compact hooks snapshot the full pipeline state to `recovery-state.md` so the Manager can resume after context compaction without losing progress
- **Shared contracts** -- the Architect defines TypeScript/Python interfaces in `contracts/` that all Engineers and Reviewers reference, preventing integration drift
- **Shared notes** -- every agent appends to `shared-notes.md`, giving later agents context about what earlier agents did
- **Diagnostic bundles** -- on backtrack, the Manager writes a JSON diagnostic with the failure type, evidence, file snippets, and previous attempt count
- **Safety limits** -- max 3 retries per target, max 10 total backtracks per session; after limits hit, escalates to user with options
- **Confidence scoring** -- each phase reports a numeric confidence score (griller: requirement count, architect: source quality, tester: pass rate, etc.)
- **Parallel agents** -- Explorer and Reviewer phases launch 2 agents concurrently for throughput

## Installation

1. Copy or clone the repo into your Claude Code skills directory:

```sh
git clone https://github.com/BhaveshY/knight-manager.git ~/.claude/skills/knight-manager
```

2. Add the compaction hooks to `~/.claude/settings.json`:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "type": "command",
        "command": "bash ~/.claude/skills/knight-manager/hooks/pre-compact.sh"
      }
    ],
    "PostCompact": [
      {
        "type": "command",
        "command": "bash ~/.claude/skills/knight-manager/hooks/post-compact.sh"
      }
    ]
  }
}
```

These hooks let the Manager survive context compaction by writing and reading `recovery-state.md`.

## Usage

```
/knight "build me a real-time chat app with WebSocket support"
```

The Manager will:
1. Detect project type (greenfield/brownfield)
2. Grill you for requirements (3-5 questions)
3. Scaffold or explore the codebase
4. Create a researched implementation plan and ask for your approval
5. Build, review, clean up, test, and verify
6. Present a session summary when done

You can also resume an interrupted session -- the Manager checks `~/.claude/knight/sessions/` on startup and picks up where it left off.

## Session files

Each run creates a session directory at `~/.claude/knight/sessions/knight-YYYYMMDD-HHmmss/` containing:

| File | Purpose |
|------|---------|
| `loop-state.json` | Pipeline state: current phase, attempt counts, backtrack history, build tasks |
| `shared-notes.md` | Running log appended by every agent |
| `requirements.md` | Output of the Griller phase |
| `exploration.md` | (Brownfield) Merged output of the two Explorer agents |
| `env-checklist.md` | (Greenfield) Environment variables and setup checklist |
| `plan.md` | Architect's implementation plan with research citations |
| `contracts/` | Shared type definitions and interfaces |
| `review-issues.json` | Merged review findings from both Reviewer agents |
| `deslopify-result.json` | Cleanup pass results |
| `test-result.json` | Test pass rate, coverage, failures |
| `verify-result.json` | Final gate results: build, lint, types, tests, requirements |
| `recovery-state.md` | Compaction recovery snapshot (written by pre-compact hook) |
| `diagnostics/` | Backtrack diagnostic bundles (`backtrack-NNN.json`) |
| `session-summary.md` | Final summary written on completion |

## Project structure

```
knight-manager/
  SKILL.md                         # Main skill prompt (the Manager)
  REFERENCE.md                     # Phase protocols, backtrack matrix, schemas
  agents/
    knight-architect.md            # Planner and contract definer
    knight-deslopifier.md          # Code cleanup specialist
    knight-engineer.md             # Implementation specialist
    knight-explorer.md             # Codebase analyst (brownfield)
    knight-griller.md              # Requirements interrogator
    knight-reviewer.md             # Code review specialist
    knight-scaffold.md             # Project bootstrapper (greenfield)
    knight-tester.md               # Test creator and runner
    knight-verifier.md             # Final gate checker
  hooks/
    pre-compact.sh                 # Snapshots state before compaction
    post-compact.sh                # Triggers recovery after compaction
  scripts/
    tmux-render.sh                 # Status rendering for tmux
    tmux-setup.sh                  # tmux session setup
    tmux-teardown.sh               # tmux session cleanup
  templates/
    plan.md                        # Plan output template
    requirements.md                # Requirements output template
    session-summary.md             # Session summary template
```

## License

MIT
