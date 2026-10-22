import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export type Config = {
  version: 1;
  build: string[];
  e2e: string[];
  maxAttempts: number;
  timeoutMs: number;
};

export const defaultConfig: Config = {
  version: 1,
  build: ['npm', 'run', 'build'],
  e2e: ['npm', 'run', 'test:e2e'],
  maxAttempts: 3,
  timeoutMs: 600_000,
};

export function parseConfig(value: unknown): Config {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('knight.json must be an object.');
  }
  const obj = value as Record<string, unknown>;
  const keys = new Set(['version', 'build', 'e2e', 'maxAttempts', 'timeoutMs']);
  for (const key of Object.keys(obj)) {
    if (!keys.has(key)) throw new Error(`Unknown knight.json field: ${key}`);
  }
  if (obj.version !== 1) throw new Error('knight.json version must be 1.');
  const argv = (key: string): string[] => {
    const value = obj[key];
    if (!Array.isArray(value) || !value.length || value.length > 100 ||
        value.some(v => typeof v !== 'string' || v.length > 16_384 || v.includes('\0')) ||
        !value[0].trim()) {
      throw new Error(`${key} must be a nonempty command argument array (no shell interpolation).`);
    }
    return value as string[];
  };
  const integer = (key: string, min: number, max: number, fallback: number): number => {
    const value = obj[key] ?? fallback;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${key} must be an integer from ${min} to ${max}.`);
    }
    return value;
  };
  return {
    version: 1, build: argv('build'), e2e: argv('e2e'),
    maxAttempts: integer('maxAttempts', 1, 5, 3),
    timeoutMs: integer('timeoutMs', 100, 3_600_000, 600_000),
  };
}

export async function loadConfig(repo: string): Promise<Config> {
  return parseConfig(JSON.parse(await readFile(join(repo, 'knight.json'), 'utf8')));
}
