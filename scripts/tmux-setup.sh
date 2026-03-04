#!/usr/bin/env bash
# Knight Manager: tmux dashboard setup
# Creates a status pane showing session progress.
# Usage: bash tmux-setup.sh <session-dir>

SESSION_DIR="${1:?Usage: tmux-setup.sh <session-dir>}"
STATE_FILE="$SESSION_DIR/loop-state.json"

# Only works inside tmux
if [ -z "$TMUX" ]; then
  echo "Not in a tmux session. Skipping dashboard setup."
  exit 0
fi

# Create a small bottom pane for the dashboard
tmux split-window -v -l 14 "bash -c 'while true; do bash ~/.claude/skills/knight-manager/scripts/tmux-render.sh \"$SESSION_DIR\"; sleep 3; done'"
tmux select-pane -t 0  # Return focus to main pane

echo "Knight dashboard started in bottom pane."
