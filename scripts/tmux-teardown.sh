#!/usr/bin/env bash
# Knight Manager: tmux dashboard teardown
# Kills the dashboard pane when the session completes.

if [ -z "$TMUX" ]; then
  exit 0
fi

# Kill the bottom pane (dashboard) if it exists
PANE_COUNT=$(tmux list-panes | wc -l)
if [ "$PANE_COUNT" -gt 1 ]; then
  tmux kill-pane -t 1 2>/dev/null
fi

echo "Knight dashboard stopped."
