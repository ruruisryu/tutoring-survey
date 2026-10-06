import { Link } from 'react-router';
import { T } from '../copy/ko';
import { useDocumentTitle } from '../components/ui';
import { ParentLayout } from '../parent/ParentLayout';

/** 초대 링크 없이 첫 주소로 들어왔을 때 */
export function HomePage() {
  useDocumentTitle(T.home.title);
  return (
    <ParentLayout>
      <section className="rounded-card border border-line bg-surface px-5 py-8 sm:px-8">
        <h1 className="text-2xl font-bold">{T.home.title}</h1>
        <p className="mt-3 leading-relaxed">{T.home.body}</p>
        <p className="mt-8 text-[15px] text-muted">
          <Link to="/admin" className="underline underline-offset-4">
            {T.home.admin}
          </Link>
        </p>
      </section>
    </ParentLayout>
  );
}

export function NotFoundPage() {
  useDocumentTitle(T.home.notFoundTitle);
  return (
    <ParentLayout>
      <section className="rounded-card border border-line bg-surface px-5 py-8 sm:px-8">
        <h1 className="text-2xl font-bold">{T.home.notFoundTitle}</h1>
        <p className="mt-3 leading-relaxed">{T.home.notFoundBody}</p>
      </section>
    </ParentLayout>
  );
}
