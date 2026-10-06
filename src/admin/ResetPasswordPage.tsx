import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { T } from '../copy/ko';
import { useAuth } from '../app/AuthContext';
import { useBackend } from '../app/BackendContext';
import { isApiError } from '../lib/backend/errors';
import { Button, Field, Notice, TextInput, useDocumentTitle } from '../components/ui';

export function ResetPasswordPage() {
  const R = T.admin.reset;
  const [params] = useSearchParams();
  const tokenHash = params.get('token_hash');
  const { session } = useAuth();
  const [verified, setVerified] = useState(false);
  const updateMode = verified || (params.get('mode') === 'update' && !!session);
  useDocumentTitle(updateMode || tokenHash ? R.verifyTitle : R.requestTitle);

  return (
    <div className="flex min-h-dvh items-start justify-center bg-bg px-4 pt-16 sm:pt-24">
      <main className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">{updateMode || tokenHash ? R.verifyTitle : R.requestTitle}</h1>
        <div className="mt-6 rounded-card border border-line bg-surface p-5">
          {updateMode ? <UpdateForm /> : tokenHash ? <VerifyStep tokenHash={tokenHash} onVerified={() => setVerified(true)} /> : <RequestForm />}
        </div>
        <p className="mt-4 text-center text-[15px]">
          <Link to="/admin/login" className="text-accent-strong underline underline-offset-4">
            {R.backToLogin}
          </Link>
        </p>
      </main>
    </div>
  );
}

function RequestForm() {
  const R = T.admin.reset;
  const backend = useBackend();
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return setError(T.errors.required);
    setBusy(true);
    setError(null);
    try {
      await backend.auth.requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(isApiError(err) && err.kind === 'network' ? T.common.networkError : T.common.serverError);
    } finally {
      setBusy(false);
    }
  };
  if (sent) return <Notice tone="success" role="status">{R.requestSent}</Notice>;
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      <p className="text-[15px] leading-relaxed text-muted">{R.requestHelp}</p>
      <Field id="reset-email" label={T.admin.login.email} required error={error}>
        {(a) => <TextInput {...a} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Button type="submit" block loading={busy}>
        {R.requestSubmit}
      </Button>
    </form>
  );
}

/** 메일 링크를 연 것만으로 토큰이 소모되지 않도록 버튼을 눌러야 확인한다 (메일 보안 검사기의 선 방문 대비) */
function VerifyStep({ tokenHash, onVerified }: { tokenHash: string; onVerified: () => void }) {
  const R = T.admin.reset;
  const backend = useBackend();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-5">
      <p className="text-[15px] leading-relaxed text-muted">{R.verifyHelp}</p>
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <Button
        block
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await backend.auth.verifyRecovery(tokenHash);
            onVerified();
          } catch (e) {
            setError(isApiError(e) && e.kind === 'network' ? T.common.networkError : R.verifyFailed);
          } finally {
            setBusy(false);
          }
        }}
      >
        {R.verifyButton}
      </Button>
    </div>
  );
}

function UpdateForm() {
  const R = T.admin.reset;
  const backend = useBackend();
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ pw?: string; pw2?: string; form?: string }>({});
  const [done, setDone] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: typeof errors = {};
    if (pw.length < 8) errs.pw = R.tooShort;
    if (pw !== pw2) errs.pw2 = R.mismatch;
    setErrors(errs);
    if (Object.keys(errs).length) {
      document.getElementById(errs.pw ? 'new-password' : 'new-password-2')?.focus();
      return;
    }
    setBusy(true);
    try {
      await backend.auth.updatePassword(pw);
      setDone(true);
      await refresh();
      setTimeout(() => navigate('/admin', { replace: true }), 1200);
    } catch (err) {
      setErrors({ form: isApiError(err) && err.kind === 'network' ? T.common.networkError : R.verifyFailed });
    } finally {
      setBusy(false);
    }
  };

  if (done) return <Notice tone="success" role="status">{R.updated}</Notice>;
  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {errors.form && (
        <Notice tone="danger" role="alert">
          {errors.form}
        </Notice>
      )}
      <Field id="new-password" label={R.newPassword} required help={R.newPasswordHelp} error={errors.pw}>
        {(a) => <TextInput {...a} type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} />}
      </Field>
      <Field id="new-password-2" label={R.confirmPassword} required error={errors.pw2}>
        {(a) => <TextInput {...a} type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
      </Field>
      <Button type="submit" block loading={busy}>
        {R.updateSubmit}
      </Button>
    </form>
  );
}
