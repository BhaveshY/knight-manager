// A separate supervisor observes IPC disconnect even when Knight receives SIGKILL.
// Each command owns a POSIX process group so timeouts also stop its descendants.
import { spawn, type ChildProcess } from 'node:child_process';
import { closeSync, constants, openSync, writeSync } from 'node:fs';
import type { Command, Result } from './process.js';

const MAX_LOG_BYTES = 2 * 1024 * 1024;
let child: ChildProcess | undefined;
let fd: number | undefined;
let timer: NodeJS.Timeout | undefined;
let killer: NodeJS.Timeout | undefined;
let failure: string | null = null;
let finished = false;

function killGroup(signal: NodeJS.Signals): void {
  if (!child?.pid) return;
  try { process.kill(-child.pid, signal); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') failure ??= 'Could not stop command process group.';
  }
}

function stop(reason: string): void {
  failure ??= reason;
  killGroup('SIGTERM');
  killer ??= setTimeout(() => killGroup('SIGKILL'), 500);
}

function finish(result: Result): void {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  clearTimeout(killer);
  killGroup('SIGKILL');
  if (fd !== undefined) closeSync(fd);
  if (process.connected) process.send?.(result, undefined, {}, () => process.disconnect());
}

process.on('disconnect', () => { killGroup('SIGKILL'); process.exit(0); });
process.on('SIGTERM', () => stop('Supervisor interrupted.'));
process.on('SIGINT', () => stop('Supervisor interrupted.'));
process.on('message', message => {
  if ((message as { type?: string }).type === 'abort') { stop('Interrupted.'); return; }
  if (child || finished) return;
  const command = message as Command;
  try {
    fd = openSync(command.log, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    child = spawn(command.argv[0]!, command.argv.slice(1), {
      cwd: command.cwd, env: process.env, shell: false, detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let bytes = 0;
    const record = (chunk: Buffer) => {
      if (fd === undefined || finished) return;
      const available = Math.max(0, MAX_LOG_BYTES - bytes);
      try { writeSync(fd, chunk.subarray(0, available)); }
      catch { stop('Could not write the command log.'); }
      bytes += chunk.length;
      if (bytes > MAX_LOG_BYTES) stop('Command exceeded the 2 MiB log limit.');
    };
    child.stdout!.on('data', record);
    child.stderr!.on('data', record);
    child.stdin!.on('error', () => { /* EPIPE is reported by the command exit. */ });
    child.stdin!.end(command.input);
    child.on('error', error => finish({ exitCode: null, signal: null, error: error.message }));
    child.on('close', (code, signal) => finish({ exitCode: code, signal, error: failure }));
    timer = setTimeout(() => stop(`Command timed out after ${command.timeoutMs} ms.`), command.timeoutMs);
  } catch (error) {
    finish({ exitCode: null, signal: null, error: (error as Error).message });
  }
});
