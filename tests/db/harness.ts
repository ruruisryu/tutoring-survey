import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { callRpc, queryAs, runSqlFiles, type Identity, type CallOptions } from '../../src/lib/backend/localdb/engine';

const root = join(import.meta.dirname, '..', '..', 'supabase');

export function sqlFiles(withDevSeed: boolean) {
  const migrations = readdirSync(join(root, 'migrations'))
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => ({ name: f, sql: readFileSync(join(root, 'migrations', f), 'utf8') }));
  const files = [{ name: 'shim.sql', sql: readFileSync(join(root, 'local', 'shim.sql'), 'utf8') }, ...migrations];
  if (withDevSeed) files.push({ name: 'seed.dev.sql', sql: readFileSync(join(root, 'local', 'seed.dev.sql'), 'utf8') });
  return files;
}

export const ADMIN: Identity = { role: 'authenticated', userId: '00000000-0000-4000-8000-0000000000a1', email: 'admin@dev.localhost' };
export const MEMBER: Identity = { role: 'authenticated', userId: '00000000-0000-4000-8000-0000000000b2', email: 'member@dev.localhost' };
export const ANON: Identity = { role: 'anon' };

export const TOKENS = {
  math: 'devmathsingle00000000000000000000000000',
  science: 'devsciencesingle0000000000000000000000',
  integrated: 'devintegratedscience00000000000000000000',
  multi: 'devmultiplecourses000000000000000000000',
  closedCourse: 'devclosedcourse0000000000000000000000000',
  inactive: 'devinactivelink0000000000000000000000000',
};

export async function createDb(withDevSeed = true) {
  const db = new PGlite();
  await runSqlFiles(db, sqlFiles(withDevSeed));
  return {
    db,
    rpc: <T = any>(who: Identity, fn: string, args: Record<string, unknown> = {}, opts?: CallOptions) =>
      callRpc<T>(db, who, fn, args, opts),
    sql: <T = any>(who: Identity, q: string, params: unknown[] = []) => queryAs<T>(db, who, q, params),
    root: <T = any>(q: string, params: unknown[] = []) => db.query<T>(q, params).then((r) => r.rows),
  };
}
export type TestDb = Awaited<ReturnType<typeof createDb>>;
