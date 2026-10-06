import type { Backend } from './types';
import { createSupabaseBackend } from './supabase';

export type BackendState = { status: 'ready'; backend: Backend } | { status: 'unconfigured' };

let pending: Promise<BackendState> | null = null;

/**
 * 사용할 백엔드를 고른다.
 *  - 개발 서버를 `--mode localdb` 로 띄웠을 때만 브라우저 안의 개발용 DB(PGlite)
 *  - 그 밖에는 Supabase. 주소·공개 키가 없으면 설정 안내 화면을 보여준다.
 */
export function getBackend(): Promise<BackendState> {
  pending ??= (async (): Promise<BackendState> => {
    if (import.meta.env.DEV && import.meta.env.MODE === 'localdb') {
      const { createLocalBackend } = await import('./localdb/browser');
      return { status: 'ready', backend: await createLocalBackend() };
    }
    const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
    const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string | undefined;
    if (!url || !key) return { status: 'unconfigured' };
    return { status: 'ready', backend: createSupabaseBackend(url, key) };
  })();
  return pending;
}
