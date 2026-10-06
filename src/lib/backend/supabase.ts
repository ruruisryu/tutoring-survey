import { createClient, type AuthChangeEvent, type Session } from '@supabase/supabase-js';
import { ApiError } from './errors';
import type { AuthEvent, AuthSession, Backend } from './types';
import { appBaseUrl } from '../url';


function toSession(s: Session | null): AuthSession | null {
  return s?.user ? { userId: s.user.id, email: s.user.email ?? '' } : null;
}

function mapError(error: { message?: string; code?: string; details?: string | null; status?: number } | null, status?: number): ApiError {
  const message = error?.message ?? 'unknown_error';
  const code = error?.code ?? '';
  if (/Failed to fetch|NetworkError|Load failed|fetch failed|network/i.test(message) && !code) {
    return new ApiError('network', { kind: 'network' });
  }
  if (status === 401 || code === 'PGRST301' || code === 'PGRST303' || /JWT expired|invalid JWT/i.test(message)) {
    return new ApiError('session_expired', { kind: 'auth' });
  }
  if (code === '42501') {
    return new ApiError(message === 'forbidden' ? 'forbidden' : 'permission_denied', { kind: 'forbidden' });
  }
  return new ApiError(message, { detail: error?.details ?? undefined });
}

export function createSupabaseBackend(url: string, key: string): Backend {
  const client = createClient(url, key, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'sueop-junbisil-admin',
    },
  });

  return {
    kind: 'supabase',
    async rpc<T>(fn: string, args: Record<string, unknown> = {}) {
      let res;
      try {
        res = await client.rpc(fn, args);
      } catch {
        throw new ApiError('network', { kind: 'network' });
      }
      if (res.error) throw mapError(res.error, res.status);
      return res.data as T;
    },
    auth: {
      async getSession() {
        const { data } = await client.auth.getSession();
        return toSession(data.session);
      },
      onChange(cb) {
        const { data } = client.auth.onAuthStateChange((event: AuthChangeEvent, session) => {
          const mapped: AuthEvent =
            event === 'INITIAL_SESSION' ? 'INITIAL' : (event as AuthEvent);
          cb(mapped, toSession(session));
        });
        return () => data.subscription.unsubscribe();
      },
      async signIn(email, password) {
        const { error } = await client.auth.signInWithPassword({ email, password });
        if (error) {
          if (/fetch/i.test(error.message)) throw new ApiError('network', { kind: 'network' });
          throw new ApiError('invalid_credentials', { kind: 'auth' });
        }
      },
      async signOut() {
        await client.auth.signOut();
      },
      async requestPasswordReset(email) {
        // 기본 메일 템플릿({{ .ConfirmationURL }})을 쓰면 ?code= 와 함께 이 주소로 돌아온다.
        // README 의 권장 템플릿을 쓰면 #/admin/reset?token_hash= 로 바로 연결된다.
        const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo: `${appBaseUrl()}?auth=recovery` });
        if (error && /fetch/i.test(error.message)) throw new ApiError('network', { kind: 'network' });
        // 계정 존재 여부를 드러내지 않기 위해 그 밖의 오류는 무시한다.
      },
      async verifyRecovery(tokenHash) {
        const { error } = await client.auth.verifyOtp({ type: 'recovery', token_hash: tokenHash });
        if (error) throw new ApiError('recovery_failed', { kind: 'auth' });
      },
      async updatePassword(password) {
        const { error } = await client.auth.updateUser({ password });
        if (error) throw new ApiError(error.message.includes('session') ? 'session_expired' : 'password_update_failed', { kind: 'auth' });
      },
    },
  };
}
