#!/usr/bin/env bash
# Knight Manager: SessionStart(compact) Hook
# Injects recovery state as additionalContext after compaction.

KNIGHT_DIR="$HOME/.claude/knight"
SESSIONS_DIR="$KNIGHT_DIR/sessions"

# Find the most recent active session
for session_dir in "$SESSIONS_DIR"/*/; do
  [ -d "$session_dir" ] || continue
  state_file="$session_dir/loop-state.json"
  [ -f "$state_file" ] || continue

  phase=$(python3 -c "import json; print(json.load(open('$state_file'))['current_phase'])" 2>/dev/null)
  if [ "$phase" != "complete" ] && [ -n "$phase" ]; then
    RECOVERY_FILE="$session_dir/recovery-state.md"
    if [ -f "$RECOVERY_FILE" ]; then
      cat "$RECOVERY_FILE"
    else
      echo "Knight Manager: Active session found at $session_dir but no recovery-state.md."
      echo "Read $state_file to resume."
    fi
    exit 0
  fi
done

# No active session
exit 0
