// 개발 전용: 브라우저 안의 PGlite 에 실제 마이그레이션을 적용해 Supabase 대신 쓴다.
// `npm run dev:localdb` 에서만 불러오며, 운영 빌드에는 포함되지 않는다.
import { PGlite } from '@electric-sql/pglite';
import { ApiError } from '../errors';
import type { AuthEvent, AuthSession, Backend } from '../types';
import { callRpc, queryAs, runSqlFiles, type Identity } from './engine';
import shim from '../../../../supabase/local/shim.sql?raw';
import seed from '../../../../supabase/local/seed.dev.sql?raw';

const migrationModules = import.meta.glob('../../../../supabase/migrations/*.sql', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

const SESSION_KEY = 'sueop-dev-session';

declare global {
  interface Window {
    __dev?: {
      failNext: number; // 다음 n번의 서버 호출을 네트워크 오류로 만든다
      delayMs: number; // 서버 호출 지연
      expireSession: () => void;
      reset: () => Promise<void>;
    };
  }
}

function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export async function createLocalBackend(): Promise<Backend> {
  const files = [
    { name: 'shim.sql', sql: shim },
    ...Object.keys(migrationModules)
      .sort()
      .map((k) => ({ name: k.split('/').pop()!, sql: migrationModules[k] })),
    { name: 'seed.dev.sql', sql: seed },
  ];
  const version = hash(files.map((f) => f.sql).join('\n'));

  let db: PGlite;
  try {
    db = new PGlite('idb://sueop-junbisil-dev');
    await db.waitReady;
  } catch {
    db = new PGlite();
    await db.waitReady;
  }
  await db.exec('create schema if not exists devmeta; create table if not exists devmeta.info (version text)');
  const current = (await db.query<{ version: string }>('select version from devmeta.info')).rows[0]?.version;
  if (current !== version) {
    // 마이그레이션이 바뀌었으면 개발 DB 를 처음부터 다시 만든다.
    await db.exec('drop schema if exists public cascade; drop schema if exists auth cascade; create schema public;');
    await runSqlFiles(db, files);
    await db.exec('delete from devmeta.info');
    await db.query('insert into devmeta.info (version) values ($1)', [version]);
  }

  const devPassword = import.meta.env.VITE_DEV_PASSWORD as string | undefined;
  const listeners = new Set<(e: AuthEvent, s: AuthSession | null) => void>();
  const emit = (e: AuthEvent, s: AuthSession | null) => listeners.forEach((l) => l(e, s));

  const readSession = (): (AuthSession & { expired?: boolean; recovery?: boolean }) | null => {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  };
  const writeSession = (s: (AuthSession & { expired?: boolean; recovery?: boolean }) | null) => {
    try {
      if (s) sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
      else sessionStorage.removeItem(SESSION_KEY);
    } catch {
      /* 세션 저장소를 쓸 수 없으면 새로고침 시 로그아웃된다 */
    }
  };

  window.__dev = {
    failNext: 0,
    delayMs: 0,
    expireSession() {
      const s = readSession();
      if (s) writeSession({ ...s, expired: true });
    },
    async reset() {
      await db.exec('delete from devmeta.info');
      location.reload();
    },
  };

  // 개발용: 파일 내용은 이 탭의 메모리에만 둔다 (새로고침하면 사라짐). 메타데이터는 PGlite 의 storage.objects.
  const blobs = new Map<string, Blob>();
  const currentIdentity = (): Identity => {
    const s = readSession();
    return s && !s.expired ? { role: 'authenticated', userId: s.userId, email: s.email } : { role: 'anon' };
  };

  const backend: Backend = {
    kind: 'localdb',
    storage: {
      async upload(path, file) {
        if (window.__dev?.failNext) {
          window.__dev.failNext--;
          throw new ApiError('network', { kind: 'network' });
        }
        await queryAs(db, currentIdentity(), `insert into storage.objects (bucket_id, name) values ('exam-photos', $1)`, [path]);
        blobs.set(path, file);
      },
      async signedUrls(paths) {
        const rows = await queryAs<{ name: string }>(db, currentIdentity(), `select name from storage.objects where bucket_id = 'exam-photos' and name = any($1::text[])`, [paths]);
        return Object.fromEntries(rows.filter((r) => blobs.has(r.name)).map((r) => [r.name, URL.createObjectURL(blobs.get(r.name)!)]));
      },
      async remove(paths) {
        await queryAs(db, currentIdentity(), `delete from storage.objects where bucket_id = 'exam-photos' and name = any($1::text[])`, [paths]);
        paths.forEach((p) => blobs.delete(p));
      },
    },
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      const dev = window.__dev!;
      if (dev.delayMs) await new Promise((r) => setTimeout(r, dev.delayMs));
      if (dev.failNext > 0) {
        dev.failNext--;
        throw new ApiError('network', { kind: 'network' });
      }
      const s = readSession();
      if (s?.expired && fn !== 'get_public_form' && fn !== 'submit_consultation') {
        throw new ApiError('session_expired', { kind: 'auth' });
      }
      const identity: Identity = s && !s.expired ? { role: 'authenticated', userId: s.userId, email: s.email } : { role: 'anon' };
      return callRpc<T>(db, identity, fn, args, { headers: { 'x-forwarded-for': '127.0.0.1' } });
    },
    auth: {
      async getSession() {
        const s = readSession();
        return s ? { userId: s.userId, email: s.email } : null;
      },
      onChange(cb) {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      async signIn(email, password) {
        const user = (await db.query<{ id: string; email: string }>('select id, email from auth.users where email = $1', [email.trim().toLowerCase()])).rows[0];
        const override = sessionStorage.getItem(`${SESSION_KEY}:pw:${email.trim().toLowerCase()}`);
        if (!user || !devPassword || password !== (override ?? devPassword)) throw new ApiError('invalid_credentials', { kind: 'auth' });
        const s = { userId: user.id, email: user.email };
        writeSession(s);
        emit('SIGNED_IN', s);
      },
      async signOut() {
        writeSession(null);
        emit('SIGNED_OUT', null);
      },
      async requestPasswordReset(email) {
        const user = (await db.query<{ email: string }>('select email from auth.users where email = $1', [email.trim().toLowerCase()])).rows[0];
        if (user) {
          // 개발 DB 는 메일을 보내지 않는다. 콘솔에 재설정 주소를 남긴다.
          console.info(`[개발용] 비밀번호 재설정 주소: ${location.pathname}#/admin/reset?token_hash=dev-${encodeURIComponent(user.email)}&type=recovery`);
        }
      },
      async verifyRecovery(tokenHash) {
        const email = decodeURIComponent(tokenHash.replace(/^dev-/, ''));
        const user = (await db.query<{ id: string; email: string }>('select id, email from auth.users where email = $1', [email])).rows[0];
        if (!tokenHash.startsWith('dev-') || !user) throw new ApiError('recovery_failed', { kind: 'auth' });
        const s = { userId: user.id, email: user.email, recovery: true };
        writeSession(s);
        emit('PASSWORD_RECOVERY', s);
      },
      async updatePassword(password) {
        const s = readSession();
        if (!s || s.expired) throw new ApiError('session_expired', { kind: 'auth' });
        sessionStorage.setItem(`${SESSION_KEY}:pw:${s.email}`, password);
        writeSession({ userId: s.userId, email: s.email });
        emit('USER_UPDATED', s);
      },
    },
  };
  return backend;
}
