import { Navigate, NavLink, Outlet, Route, Routes, useLocation } from 'react-router';
import { T } from '../copy/ko';
import { useAuth } from '../app/AuthContext';
import { Button, LoadingBlock, cx } from '../components/ui';
import { LoginPage, ReauthDialog } from './LoginPage';
import { ResetPasswordPage } from './ResetPasswordPage';
import { DashboardPage } from './DashboardPage';
import { ResponsesPage } from './ResponsesPage';
import { ResponseDetailPage } from './ResponseDetailPage';
import { CoursesPage } from './CoursesPage';
import { FormsPage } from './FormsPage';
import { TemplateEditorPage } from './TemplateEditorPage';
import { SettingsPage } from './SettingsPage';
import { AdminDataProvider, useAdminData } from './AdminData';

export default function AdminRoutes() {
  return (
    <Routes>
      <Route path="login" element={<LoginPage />} />
      <Route path="reset" element={<ResetPasswordPage />} />
      <Route element={<AdminGate />}>
        <Route index element={<DashboardPage />} />
        <Route path="responses" element={<ResponsesPage />} />
        <Route path="responses/:id" element={<ResponseDetailPage />} />
        <Route path="courses" element={<CoursesPage />} />
        <Route path="forms" element={<FormsPage />} />
        <Route path="forms/:templateId" element={<TemplateEditorPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Route>
    </Routes>
  );
}

function AdminGate() {
  const { loading, session, isAdmin, signOut } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingBlock />;
  if (!session) return <Navigate to={`/admin/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16">
        <h1 className="text-2xl font-bold">{T.admin.login.title}</h1>
        <p className="mt-4 leading-relaxed" role="alert">
          {T.admin.login.notAdmin}
        </p>
        <Button variant="secondary" className="mt-6" onClick={() => void signOut()}>
          {T.admin.signOut}
        </Button>
      </div>
    );
  }
  return (
    <AdminDataProvider>
      <AdminLayout />
    </AdminDataProvider>
  );
}

const NAV = [
  { to: '/admin', label: T.admin.nav.dashboard, end: true },
  { to: '/admin/responses', label: T.admin.nav.responses },
  { to: '/admin/courses', label: T.admin.nav.courses },
  { to: '/admin/forms', label: T.admin.nav.forms },
  { to: '/admin/settings', label: T.admin.nav.settings },
];

function AdminLayout() {
  const { session, signOut } = useAuth();
  const { settings } = useAdminData();
  return (
    <div className="min-h-dvh bg-bg">
      <a href="#admin-main" className="sr-only-focusable fixed left-3 top-3 z-50 rounded-lg bg-surface px-4 py-2 font-semibold shadow">
        본문으로 건너뛰기
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-4 pt-3 sm:px-6 lg:pt-0">
          <p className="font-bold tracking-tight lg:py-4">{settings?.service_name || '수업 준비실'}</p>
          <div className="flex items-center gap-3 text-[14px] text-muted lg:order-last">
            <span className="hidden max-w-48 truncate sm:inline">{session?.email}</span>
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              {T.admin.signOut}
            </Button>
          </div>
          <nav aria-label="관리자 메뉴" className="-mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:-mx-6 sm:w-[calc(100%+3rem)] sm:px-6 lg:mx-0 lg:w-auto lg:flex-1 lg:px-0">
            <ul className="flex gap-1">
              {NAV.map((n) => (
                <li key={n.to}>
                  <NavLink
                    to={n.to}
                    end={n.end}
                    className={({ isActive }) =>
                      cx(
                        'inline-flex min-h-12 items-center border-b-[3px] px-3 text-[15px] font-semibold whitespace-nowrap',
                        isActive ? 'border-accent text-accent-strong' : 'border-transparent text-muted hover:text-ink',
                      )
                    }
                  >
                    {n.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </header>
      <main id="admin-main" className="mx-auto max-w-[1280px] px-4 pb-20 pt-6 sm:px-6 sm:pt-8">
        <Outlet />
      </main>
      <ReauthDialog />
    </div>
  );
}
