// 개발·테스트 전용 PGlite 실행기.
// 실제 마이그레이션 SQL 을 그대로 실행하고, Supabase 처럼 역할(anon/authenticated)과 JWT 클레임을 바꿔 가며 함수를 호출한다.
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { ApiError } from '../errors';

export type Identity = { role: 'anon' } | { role: 'authenticated'; userId: string; email?: string };

const NAME_RE = /^[a-z][a-z0-9_]*$/;

type ArgTypes = Map<string, string>;
const signatureCache = new WeakMap<PGlite, Map<string, ArgTypes>>();

async function argTypes(db: PGlite, fn: string): Promise<ArgTypes> {
  let cache = signatureCache.get(db);
  if (!cache) {
    cache = new Map();
    signatureCache.set(db, cache);
  }
  const hit = cache.get(fn);
  if (hit) return hit;
  const res = await db.query<{ name: string; type: string }>(
    `select a.name, format_type(a.type, null) as type
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace,
       lateral unnest(p.proargnames, p.proargtypes::oid[]) as a(name, type)
      where n.nspname = 'public' and p.proname = $1`,
    [fn],
  );
  if (res.rows.length === 0) {
    // 인자 없는 함수인지 확인
    const exists = await db.query(`select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname=$1`, [fn]);
    if (exists.rows.length === 0) throw new ApiError('function_not_found', { detail: fn });
  }
  const map: ArgTypes = new Map(res.rows.map((r) => [r.name, r.type]));
  cache.set(fn, map);
  return map;
}

function serialize(value: unknown, type: string): unknown {
  if (value === null || value === undefined) return null;
  if (type === 'jsonb' || type === 'json') return JSON.stringify(value);
  if (type.endsWith('[]')) {
    if (!Array.isArray(value)) throw new ApiError('invalid_request');
    return `{${value.map((v) => `"${String(v).replace(/(["\\])/g, '\\$1')}"`).join(',')}}`;
  }
  return value;
}

export interface CallOptions {
  headers?: Record<string, string>;
}

async function applyIdentity(tx: Transaction, identity: Identity, opts: CallOptions) {
  await tx.exec(`set local role ${identity.role}`);
  const claims =
    identity.role === 'anon'
      ? { role: 'anon' }
      : { role: 'authenticated', sub: identity.userId, email: identity.email ?? '' };
  await tx.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify(claims)]);
  await tx.query(`select set_config('request.headers', $1, true)`, [JSON.stringify(opts.headers ?? {})]);
}

/** Supabase 의 supabase.rpc(name, args) 와 같은 의미로 함수를 호출한다. */
export async function callRpc<T>(
  db: PGlite,
  identity: Identity,
  fn: string,
  args: Record<string, unknown> = {},
  opts: CallOptions = {},
): Promise<T> {
  if (!NAME_RE.test(fn)) throw new ApiError('invalid_request');
  const types = await argTypes(db, fn);
  const keys = Object.keys(args);
  for (const k of keys) {
    if (!NAME_RE.test(k) || !types.has(k)) throw new ApiError('invalid_request', { detail: `unknown arg ${k}` });
  }
  const placeholders = keys.map((k, i) => `${k} => $${i + 1}::${types.get(k)}`).join(', ');
  const params = keys.map((k) => serialize(args[k], types.get(k)!));
  try {
    return await db.transaction(async (tx) => {
      await applyIdentity(tx, identity, opts);
      const res = await tx.query<{ result: T }>(`select public.${fn}(${placeholders}) as result`, params);
      return res.rows[0]?.result as T;
    });
  } catch (e) {
    throw toApiError(e);
  }
}

/** 임의 SQL 을 특정 역할로 실행 (테스트에서 RLS 확인용) */
export async function queryAs<T>(db: PGlite, identity: Identity, sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    return await db.transaction(async (tx) => {
      await applyIdentity(tx, identity, {});
      const res = await tx.query<T>(sql, params);
      return res.rows;
    });
  } catch (e) {
    throw toApiError(e);
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  const err = e as { message?: string; detail?: string; code?: string };
  const code = err.code === '42501' ? (err.message === 'forbidden' ? 'forbidden' : 'permission_denied') : err.message ?? 'unknown_error';
  const kind = err.code === '42501' ? 'forbidden' : 'server';
  return new ApiError(code, { detail: err.detail, kind });
}

export async function runSqlFiles(db: PGlite, files: { name: string; sql: string }[]) {
  for (const f of files) {
    try {
      await db.exec(f.sql);
    } catch (e) {
      const err = e as Error;
      throw new Error(`SQL 실행 실패: ${f.name}: ${err.message}`);
    }
  }
}
