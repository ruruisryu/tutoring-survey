import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { useBackend } from './BackendContext';
import type { AuthSession } from '../lib/backend/types';
import { isApiError } from '../lib/backend/errors';

interface AuthState {
  loading: boolean;
  session: AuthSession | null;
  isAdmin: boolean;
  /** 로그인 만료로 다시 로그인이 필요한 상태 (작성 중인 화면은 그대로 둔다) */
  reauthNeeded: boolean;
  requestReauth: () => void;
  refresh: () => Promise<void>;
  signOut: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider 밖에서 사용할 수 없습니다.');
  return v;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [reauthNeeded, setReauthNeeded] = useState(false);
  const recovering = useRef(false);

  const check = useCallback(
    async (s: AuthSession | null) => {
      setSession(s);
      if (!s) {
        setIsAdmin(false);
        setLoading(false);
        return;
      }
      try {
        setIsAdmin(await backend.rpc<boolean>('am_i_admin'));
        setReauthNeeded(false);
      } catch (e) {
        setIsAdmin(false);
        if (isApiError(e) && e.kind === 'auth') setSession(null);
      } finally {
        setLoading(false);
      }
    },
    [backend],
  );

  useEffect(() => {
    let alive = true;
    backend.auth.getSession().then((s) => {
      if (!alive) return;
      // 기본 메일 템플릿: ?auth=recovery&code=... 로 돌아온 경우 (PKCE 교환 후 세션이 생김)
      const url = new URL(window.location.href);
      if (s && url.searchParams.get('auth') === 'recovery' && !recovering.current) {
        recovering.current = true;
        url.search = '';
        window.history.replaceState(null, '', url.toString());
        setSession(s);
        setLoading(false);
        navigate('/admin/reset?mode=update', { replace: true });
        return;
      }
      void check(s);
    });
    const off = backend.auth.onChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        recovering.current = true;
        setSession(s);
        setLoading(false);
        // ?auth=recovery&code=... 를 주소에서 지우고 새 비밀번호 화면으로 이동
        const url = new URL(window.location.href);
        url.search = '';
        window.history.replaceState(null, '', url.toString());
        navigate('/admin/reset?mode=update', { replace: true });
        return;
      }
      if (event === 'SIGNED_OUT') {
        setSession(null);
        setIsAdmin(false);
        return;
      }
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') void check(s);
    });
    return () => {
      alive = false;
      off();
    };
  }, [backend, check, navigate]);

  // 아래 함수들은 항상 같은 참조를 유지해야 한다. 바뀌면 관리자 화면이 데이터를 다시 불러오면서
  // 로그인 만료 중에 작성하던 메모가 사라질 수 있다.
  const requestReauth = useCallback(() => setReauthNeeded(true), []);
  const refresh = useCallback(async () => check(await backend.auth.getSession()), [backend, check]);
  const signOut = useCallback(async () => {
    await backend.auth.signOut();
    setSession(null);
    setIsAdmin(false);
    setReauthNeeded(false);
  }, [backend]);

  const value = useMemo<AuthState>(
    () => ({ loading, session, isAdmin, reauthNeeded, requestReauth, refresh, signOut }),
    [loading, session, isAdmin, reauthNeeded, requestReauth, refresh, signOut],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
