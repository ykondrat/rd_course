import { types } from 'pg';

export function installPgTypeParsers(): void {
  types.setTypeParser(20, (v: string | null) => (v === null ? null : Number(v)));
  types.setTypeParser(1184, (v: string | null) => (v === null ? null : new Date(v).toISOString()));
}
