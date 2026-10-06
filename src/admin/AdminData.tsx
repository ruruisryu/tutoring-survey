import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useBackend } from '../app/BackendContext';
import { useAuth } from '../app/AuthContext';
import { isApiError, type ApiError } from '../lib/backend/errors';
import type { AppSettings, Catalog } from '../lib/types';
import { T } from '../copy/ko';

interface AdminData {
  settings: AppSettings | null;
  catalog: Catalog | null;
  catalogError: boolean;
  reloadSettings: () => Promise<void>;
  reloadCatalog: () => Promise<void>;
  /** 관리자 RPC. 로그인이 만료되면 재로그인 창을 띄우고 오류를 그대로 던진다. */
  call: <T>(fn: string, args?: Record<string, unknown>) => Promise<T>;
}

const Ctx = createContext<AdminData | null>(null);

export function useAdminData() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AdminDataProvider 밖에서 사용할 수 없습니다.');
  return v;
}

export function AdminDataProvider({ children }: { children: ReactNode }) {
  const backend = useBackend();
  const { requestReauth } = useAuth();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [catalogError, setCatalogError] = useState(false);

  const call = useCallback(
    async <T,>(fn: string, args?: Record<string, unknown>) => {
      try {
        return await backend.rpc<T>(fn, args);
      } catch (e) {
        if (isApiError(e) && e.kind === 'auth') requestReauth();
        throw e;
      }
    },
    [backend, requestReauth],
  );

  const reloadSettings = useCallback(async () => {
    try {
      setSettings(await call<AppSettings>('admin_get_settings'));
    } catch {
      /* 화면별로 다시 시도 */
    }
  }, [call]);

  const reloadCatalog = useCallback(async () => {
    try {
      setCatalogError(false);
      setCatalog(await call<Catalog>('admin_catalog'));
    } catch {
      setCatalogError(true);
    }
  }, [call]);

  useEffect(() => {
    void reloadSettings();
    void reloadCatalog();
  }, [reloadSettings, reloadCatalog]);

  const value = useMemo(
    () => ({ settings, catalog, catalogError, reloadSettings, reloadCatalog, call }),
    [settings, catalog, catalogError, reloadSettings, reloadCatalog, call],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** 관리자 화면 공통 오류 문구 */
export function adminErrorText(e: unknown): string {
  if (!isApiError(e)) return T.common.serverError;
  const err = e as ApiError;
  if (err.kind === 'network') return T.common.networkError;
  if (err.kind === 'auth') return T.admin.login.expired;
  const map: Record<string, string> = {
    conflict: T.admin.detail.conflict,
    in_use: T.admin.courses.deleteInUse,
    duplicate_name: '같은 이름의 과목이 이미 있습니다.',
    privacy_incomplete: T.admin.settings.privacyIncomplete,
    confirm_mismatch: T.admin.detail.deleteMismatch,
    not_found: T.admin.detail.notFound,
    forbidden: T.admin.login.notAdmin,
    no_draft: '발행할 초안이 없습니다.',
    validation_failed: '입력값을 확인해주세요.',
    invalid_questions: '질문 설정을 확인해주세요.',
  };
  return map[err.code] ?? T.common.serverError;
}
