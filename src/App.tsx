import { createHashRouter, Outlet, RouterProvider } from 'react-router';
import { BackendProvider } from './app/BackendContext';
import { AuthProvider } from './app/AuthContext';
import { HomePage, NotFoundPage } from './app/HomePage';
import { SurveyPage } from './parent/SurveyPage';
import { LoadingBlock } from './components/ui';

function Root() {
  return (
    <BackendProvider>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </BackendProvider>
  );
}

/**
 * GitHub Pages 같은 정적 호스팅에서는 /저장소이름/#/경로 형태의 해시 라우팅을 쓴다.
 * 새로고침이나 직접 링크로 들어와도 서버는 index.html 만 돌려주면 된다.
 * 관리자 화면은 학부모가 내려받지 않도록 따로 불러온다.
 */
const router = createHashRouter([
  {
    element: <Root />,
    hydrateFallbackElement: <LoadingBlock />,
    children: [
      { path: '/', element: <HomePage /> },
      { path: '/s/:token', element: <SurveyPage /> },
      { path: '/admin/*', lazy: async () => ({ Component: (await import('./admin/AdminRoutes')).default }) },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

export function App() {
  return <RouterProvider router={router} />;
}
