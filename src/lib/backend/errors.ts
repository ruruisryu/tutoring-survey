export interface FieldError {
  path: string;
  code: string;
}

/** 서버(RPC) 오류를 화면에서 다루기 쉬운 형태로 통일한다. */
export class ApiError extends Error {
  readonly code: string;
  readonly detail: string | undefined;
  readonly kind: 'server' | 'network' | 'auth' | 'forbidden';

  constructor(code: string, opts: { detail?: string; kind?: ApiError['kind'] } = {}) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.detail = opts.detail;
    this.kind = opts.kind ?? 'server';
  }

  /** validation_failed 의 detail 에 담긴 [{path, code}] 목록 */
  get fieldErrors(): FieldError[] {
    if (this.code !== 'validation_failed' || !this.detail) return [];
    try {
      const parsed: unknown = JSON.parse(this.detail);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(
        (e): e is FieldError =>
          typeof e === 'object' && e !== null && typeof (e as FieldError).path === 'string' && typeof (e as FieldError).code === 'string',
      );
    } catch {
      return [];
    }
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
