export interface AuthSession {
  userId: string;
  email: string;
}

export type AuthEvent = 'SIGNED_IN' | 'SIGNED_OUT' | 'PASSWORD_RECOVERY' | 'TOKEN_REFRESHED' | 'USER_UPDATED' | 'INITIAL';

export interface Backend {
  kind: 'supabase' | 'localdb';
  /** 서버 함수 호출. 실패하면 ApiError 를 던진다. */
  rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T>;
  auth: {
    getSession(): Promise<AuthSession | null>;
    onChange(cb: (event: AuthEvent, session: AuthSession | null) => void): () => void;
    signIn(email: string, password: string): Promise<void>;
    signOut(): Promise<void>;
    requestPasswordReset(email: string): Promise<void>;
    /** 메일 링크의 token_hash 로 재설정 세션을 만든다 */
    verifyRecovery(tokenHash: string): Promise<void>;
    updatePassword(password: string): Promise<void>;
  };
}
