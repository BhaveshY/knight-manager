#!/usr/bin/env bash
# Knight Manager: PreCompact Hook
# Snapshots current state before context compaction so the Manager can resume.

KNIGHT_DIR="$HOME/.claude/knight"
SESSIONS_DIR="$KNIGHT_DIR/sessions"

# Find the most recent active session (not marked complete)
ACTIVE_SESSION=""
for session_dir in "$SESSIONS_DIR"/*/; do
  [ -d "$session_dir" ] || continue
  state_file="$session_dir/loop-state.json"
  [ -f "$state_file" ] || continue

  # Check if session is still active (not complete)
  phase=$(python3 -c "import json; print(json.load(open('$state_file'))['current_phase'])" 2>/dev/null)
  if [ "$phase" != "complete" ] && [ -n "$phase" ]; then
    ACTIVE_SESSION="$session_dir"
    break
  fi
done

# No active session — nothing to snapshot
[ -z "$ACTIVE_SESSION" ] && exit 0

STATE_FILE="$ACTIVE_SESSION/loop-state.json"
NOTES_FILE="$ACTIVE_SESSION/shared-notes.md"
RECOVERY_FILE="$ACTIVE_SESSION/recovery-state.md"

# Read current state
PHASE=$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['current_phase'])" 2>/dev/null)
ATTEMPT=$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['current_phase_attempt'])" 2>/dev/null)
BACKTRACKS=$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['total_backtracks'])" 2>/dev/null)
CHECKPOINT=$(python3 -c "import json; print(json.load(open('$STATE_FILE')).get('checkpoint', 'unknown'))" 2>/dev/null)
SESSION_ID=$(python3 -c "import json; print(json.load(open('$STATE_FILE'))['session_id'])" 2>/dev/null)

# Get last 30 lines of shared notes for context
RECENT_NOTES=""
if [ -f "$NOTES_FILE" ]; then
  RECENT_NOTES=$(tail -30 "$NOTES_FILE")
fi

# Write recovery state
cat > "$RECOVERY_FILE" << EOF
# Knight Manager Recovery State

**Session**: $SESSION_ID
**Session directory**: $ACTIVE_SESSION
**Phase**: $PHASE (attempt $ATTEMPT)
**Total backtracks**: $BACKTRACKS
**Checkpoint**: $CHECKPOINT

## Recovery Instructions

You are The Knight Manager. Context was compacted. Resume your work:

1. Read the full state: $STATE_FILE
2. You were in the **$PHASE** phase (attempt $ATTEMPT)
3. Resume from where you left off — do NOT restart the pipeline
4. Read SKILL.md and REFERENCE.md if you need protocol details

## Recent Progress
$RECENT_NOTES
EOF

exit 0
