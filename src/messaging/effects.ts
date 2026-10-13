import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const STATE_DIR = join(process.cwd(), '.rabbitmq-state');

export function statePath(name: string): string {
  mkdirSync(STATE_DIR, { recursive: true });

  return join(STATE_DIR, name);
}

export function resetState(...names: string[]): void {
  for (const n of names) rmSync(statePath(n), { force: true });
}

export interface EffectRow {
  eventId: string;
  data: unknown;
  at: number;
}

export function applyEffect(file: string, eventId: string, data: unknown): void {
  const row: EffectRow = { eventId, data, at: Date.now() };

  appendFileSync(statePath(file), `${JSON.stringify(row)}\n`);
}

export function readEffects(file: string): EffectRow[] {
  const path = statePath(file);

  if (!existsSync(path)) return [];

  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line) as EffectRow);
}

export function effectStats(file: string): { total: number; unique: number; dups: string[] } {
  const rows = readEffects(file);
  const counts = new Map<string, number>();

  for (const r of rows) counts.set(r.eventId, (counts.get(r.eventId) ?? 0) + 1);

  return {
    total: rows.length,
    unique: counts.size,
    dups: [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`),
  };
}

export function seen(file: string, eventId: string): boolean {
  const path = statePath(file);

  if (!existsSync(path)) return false;

  return readFileSync(path, 'utf8').split('\n').includes(eventId);
}

export function remember(file: string, eventId: string): void {
  appendFileSync(statePath(file), `${eventId}\n`);
}
