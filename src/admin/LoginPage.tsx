import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { T } from '../copy/ko';
import { useAuth } from '../app/AuthContext';
import { useBackend } from '../app/BackendContext';
import { isApiError } from '../lib/backend/errors';
import { Button, Dialog, Field, Notice, TextInput, useDocumentTitle } from '../components/ui';

function LoginForm({ onDone, compact }: { onDone: () => void; compact?: boolean }) {
  const backend = useBackend();
  const { session } = useAuth();
  const [email, setEmail] = useState(compact ? session?.email ?? '' : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const L = T.admin.login;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await backend.auth.signIn(email.trim(), password);
      onDone();
    } catch (err) {
      setError(isApiError(err) && err.kind === 'network' ? T.common.networkError : L.failed);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {error && (
        <Notice tone="danger" role="alert">
          {error}
        </Notice>
      )}
      <Field id={compact ? 'reauth-email' : 'login-email'} label={L.email} required>
        {(a) => <TextInput {...a} type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field id={compact ? 'reauth-password' : 'login-password'} label={L.password} required>
        {(a) => <TextInput {...a} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Button type="submit" block loading={busy} loadingText={L.submitting}>
        {L.submit}
      </Button>
    </form>
  );
}

export function LoginPage() {
  useDocumentTitle(T.admin.login.title);
  const { session, isAdmin, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next') || '/admin';
  const safeNext = next.startsWith('/admin') ? next : '/admin';
  if (!loading && session && isAdmin) return <Navigate to={safeNext} replace />;
  return (
    <div className="flex min-h-dvh items-start justify-center bg-bg px-4 pt-16 sm:pt-24">
      <main className="w-full max-w-sm">
        <h1 className="text-2xl font-bold">{T.admin.login.title}</h1>
        {session && !isAdmin && !loading && (
          <Notice tone="warn" className="mt-4" role="alert">
            {T.admin.login.notAdmin}
          </Notice>
        )}
        <div className="mt-6 rounded-card border border-line bg-surface p-5">
          <LoginForm
            onDone={async () => {
              await refresh();
              navigate(safeNext, { replace: true });
            }}
          />
        </div>
        <p className="mt-4 text-center text-[15px]">
          <Link to="/admin/reset" className="text-accent-strong underline underline-offset-4">
            {T.admin.login.forgot}
          </Link>
        </p>
      </main>
    </div>
  );
}

/** 로그인 만료 시 화면을 떠나지 않고 다시 로그인 */
export function ReauthDialog() {
  const { reauthNeeded, refresh, signOut } = useAuth();
  return (
    <Dialog open={reauthNeeded} onClose={() => void signOut()} title={T.admin.reauth.title}>
      <p className="mb-4 text-[15px] leading-relaxed">{T.admin.reauth.body}</p>
      <LoginForm compact onDone={() => void refresh()} />
    </Dialog>
  );
}
