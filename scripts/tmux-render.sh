#!/usr/bin/env bash
# Knight Manager: tmux dashboard renderer
# Called in a loop by tmux-setup.sh to refresh the status display.

SESSION_DIR="${1:?}"
STATE_FILE="$SESSION_DIR/loop-state.json"

[ -f "$STATE_FILE" ] || { echo "Waiting for session to start..."; exit 0; }

# Parse state with Python (available on macOS)
read -r SESSION_ID PROJECT_TYPE CURRENT_PHASE BACKTRACKS MAX_BACKTRACKS TOKENS ATTEMPT CHECKPOINT <<< $(python3 -c "
import json, sys
s = json.load(open('$STATE_FILE'))
print(s['session_id'], s['project_type'], s['current_phase'],
      s['total_backtracks'], s['max_backtracks'],
      s.get('tokens_used_estimate', 0), s['current_phase_attempt'],
      s.get('checkpoint', ''))
" 2>/dev/null)

[ -z "$SESSION_ID" ] && { echo "Error reading state"; exit 0; }

# Phase list and status
PHASES=("grill" "scaffold" "explore" "architect" "build" "review" "deslopify" "test" "verify")
if [ "$PROJECT_TYPE" = "greenfield" ]; then
  SKIP="explore"
else
  SKIP="scaffold"
fi

clear

echo "┌─────────────────────────────────────────────────────────────┐"
echo "│ KNIGHT MANAGER: $SESSION_ID"
printf "│ Project: %-12s │ Tokens: ~%sk\n" "$PROJECT_TYPE" "$((TOKENS / 1000))"
echo "├─────────────────────────────────────────────────────────────┤"

# Get phase history
for phase in "${PHASES[@]}"; do
  [ "$phase" = "$SKIP" ] && continue

  # Check phase status from history
  STATUS=$(python3 -c "
import json
s = json.load(open('$STATE_FILE'))
for h in s.get('phase_history', []):
    if h['phase'] == '$phase':
        print(h['status'], h.get('confidence', '----'), h.get('attempts', 1))
        break
else:
    print('pending ---- 1')
" 2>/dev/null)

  read -r PSTATUS CONF ATTEMPTS <<< "$STATUS"

  if [ "$phase" = "$CURRENT_PHASE" ]; then
    ICON="→"
  elif [ "$PSTATUS" = "complete" ]; then
    ICON="✓"
  else
    ICON=" "
  fi

  PHASE_UPPER=$(echo "$phase" | tr '[:lower:]' '[:upper:]')
  printf "│ [%s] %-11s %s" "$ICON" "$PHASE_UPPER" "$CONF"
  if [ "$ATTEMPTS" -gt 1 ]; then
    printf "  │ (%s attempts)" "$ATTEMPTS"
  fi
  echo ""
done

echo "│"
echo "│ Backtracks: $BACKTRACKS/$MAX_BACKTRACKS | Retries this phase: $((ATTEMPT - 1))/3"
if [ -n "$CHECKPOINT" ] && [ "$CHECKPOINT" != "None" ]; then
  echo "│ $CHECKPOINT"
fi
echo "└─────────────────────────────────────────────────────────────┘"
