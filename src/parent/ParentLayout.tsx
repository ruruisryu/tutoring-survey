import type { ReactNode } from 'react';
import { T } from '../copy/ko';
import type { PublicSettings } from '../lib/types';

export function parentHeaderText(settings: Pick<PublicSettings, 'teacher_name'> | null | undefined) {
  const name = settings?.teacher_name?.trim();
  return name ? T.parent.headerWithTeacher(name) : T.parent.headerDefault;
}

export function ParentLayout({ settings, children }: { settings?: PublicSettings | null; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-bg">
      <a href="#main" className="sr-only-focusable fixed left-3 top-3 z-50 rounded-lg bg-surface px-4 py-2 font-semibold shadow">
        본문으로 건너뛰기
      </a>
      <header className="border-b border-line bg-bg/95">
        <div className="mx-auto flex min-h-14 max-w-[720px] items-center px-4 sm:px-6">
          <p className="text-[15px] font-semibold tracking-tight text-ink">{parentHeaderText(settings)}</p>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-[720px] px-4 pb-24 pt-6 sm:px-6 sm:pt-10">
        {children}
      </main>
    </div>
  );
}
