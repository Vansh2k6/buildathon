import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Minimal KEY=VALUE parser for .env.local. Handles CRLF and optional quotes. */
export function loadEnv(file = '.env.local'): void {
  const lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

export function requireKey(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`FATAL: ${name} missing or empty in .env.local`);
    process.exit(2);
  }
  return v.trim();
}
